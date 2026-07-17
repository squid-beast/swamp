-- Close the door that `revoke ... from anon` never closed, and fix the one thing
-- behind it that was actually unlocked.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 1. WHY EVERY REVOKE IN THIS SCHEMA WAS A NO-OP
-- ════════════════════════════════════════════════════════════════════════════
--
-- platform.sql:1757 says:
--
--     revoke all on all routines in schema public from anon;
--
-- and its comment (platform.sql:1750-1754) states the intent plainly: "anon loses
-- table access entirely. It keeps EXECUTE on exactly the functions that are designed
-- to be reached without a session." That is not what happened. anon kept EXECUTE on
-- all of them.
--
-- Postgres grants EXECUTE **to PUBLIC** on every `create function`. anon is a member
-- of PUBLIC. So the ACL on each function looked like:
--
--     =X/postgres            <- PUBLIC. This is the one that admits anon.
--     anon=X/postgres        <- the explicit grant the revoke removed
--     authenticated=X/postgres
--
-- `revoke ... from anon` removes only the second line. The first is untouched, and it
-- is sufficient. The revoke ran, reported success, changed the ACL, and achieved
-- nothing — which is the worst shape a security control can have, because the
-- migration reads as though the door is shut.
--
-- Revoking from `public` is therefore not optional or belt-and-braces. It is the
-- entire mechanism.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 2. WHAT THIS DID AND DID NOT COST
-- ════════════════════════════════════════════════════════════════════════════
--
-- Audited: every anon-reachable SECURITY DEFINER function, by calling each one as
-- `set role anon` rather than by reading it. The finding is narrower than the hole
-- suggests, and worth stating precisely rather than dramatically:
--
-- Nothing else was exploitable, because none of these functions depended on the
-- grant for their security. They are each guarded by something that is not a
-- privilege:
--   * auth.uid() is NULL for anon, so the swamp_base_* / swamp_workspace_* /
--     swamp_accept_invite / swamp_fire_button family raises or returns NULL before
--     touching a row;
--   * a sha256 token lookup fails (swamp_token_context, swamp_api_require);
--   * `returns trigger` functions cannot be called by hand at all, and PostgREST
--     does not publish them.
--
-- Defence in depth is the reason this was a near miss rather than an incident. The
-- grant was the outer door and it was open the whole time; every inner door held.
-- This migration shuts the outer door and fixes the one inner door that did not.
--
-- ════════════════════════════════════════════════════════════════════════════
-- 3. THE ONE THAT WAS ACTUALLY UNLOCKED: swamp_api_table
-- ════════════════════════════════════════════════════════════════════════════
--
-- platform.sql:378:
--
--     if v_t.id is null or v_t.base_id <> (p_ctx->>'baseId')::uuid then
--       raise exception 'swamp: no such table' using errcode = '42P01';
--
-- p_ctx is supplied by the caller. Pass '{}' and `p_ctx->>'baseId'` is NULL;
-- `base_id <> NULL` is NULL, not true; plpgsql's `if` treats NULL as false; the raise
-- is skipped and the row is returned. A WRONG baseId is correctly rejected. A MISSING
-- one is waved through. Reproduced as anon holding no token whatsoever:
--
--     set role anon;
--     select * from public.swamp_api_table('{}'::jsonb, '<any table id>');
--     -> id, base_id, name, icon, sort_order, created_at, updated_at, deleted_at
--
-- Bounded — a table_id is a 122-bit uuid, so there is no enumeration — but
-- swamp_shared_meta hands a valid table_id to every holder of a public share link,
-- and that is a working entry point to another tenant's base_id and table name. No
-- record data, no writes, no escalation.
--
-- This is the same bug as the token-scopes CHECK that never rejected an empty array
-- (`array_length('{}',1) >= 1` is NULL, and a CHECK only rejects on FALSE — see
-- 20260716010000_token_scopes.sql). Same root cause, different consequence: a
-- comparison against NULL is NULL, and every construct in SQL that wants a boolean
-- reads NULL as "no". Where a value can be NULL, `is distinct from` is the operator
-- that means what `<>` looks like it means.

-- ── The guard. `is distinct from` is NULL-safe: NULL is distinct from a uuid, so a
--    missing baseId now fails closed instead of open.
create or replace function public.swamp_api_table(p_ctx jsonb, p_table_id uuid)
returns public.tables
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_t public.tables;
begin
  select * into v_t
    from public.tables
   where id = p_table_id and deleted_at is null;

  -- `is distinct from`, NOT `<>`. p_ctx is caller-shaped: with p_ctx = '{}' the right
  -- operand is NULL, `<>` yields NULL, and `if NULL` does not fire — so a caller who
  -- simply omitted baseId skipped the tenant check entirely.
  if v_t.id is null or v_t.base_id is distinct from (p_ctx->>'baseId')::uuid then
    raise exception 'swamp: no such table' using errcode = '42P01';
  end if;

  return v_t;
end
$$;

-- ── The grants. Everything anon does not need, taken by ALLOWLIST rather than by a
--    hand-written list of the ones we happened to think of.
--
-- The first draft of this migration named 16 functions. A test that enumerated the
-- schema instead of checking that list found ~35 more still reachable — every one a
-- SECURITY INVOKER helper (swamp_to_bool, swamp_writable_keys, swamp_view_filter_json,
-- the trigger functions...). Inert, because INVOKER means RLS binds them and anon holds
-- no table grants, but "inert" was the same word that described this whole hole.
--
-- Hand-listing cannot be complete, and completeness is the only property worth having
-- here. So: revoke from every swamp_* function that is not on the allowlist, derived
-- from the catalog at migration time.
--
-- `from public` is the half that does the work; `from anon` clears the explicit entry
-- so the ACL reads honestly to the next person who looks.
--
-- Verified, not assumed:
--   * An inner callee needs no EXECUTE grant of its own. SECURITY DEFINER functions
--     run as the owner, so revoking the helpers does not break the endpoints that call
--     them — swamp_api_meta/query/count/patch/delete all still answer as anon after
--     these revokes, and the 20 sharing tests still drive the whole anon share path.
--   * Trigger functions are checked at CREATE TRIGGER time, not at fire time.
--   * `authenticated` keeps every grant. It is deliberately not touched below, and it
--     matters most for swamp_base_member_role: that is reached from swamp_base_role_in,
--     which is SECURITY INVOKER and used inside the `bases` RLS policy — and an RLS
--     expression evaluates with the QUERYING role's privileges. Taking EXECUTE from
--     authenticated there would break ordinary reads for everyone.
do $$
declare
  r record;
  -- The complete anon surface. Mirrored in tests/integration/anon-surface.test.ts,
  -- which fails if the schema and this list ever disagree.
  allowed text[] := array[
    'swamp_shared_meta', 'swamp_shared_records',  -- public share links
    'swamp_submit_form',                          -- public form submission
    'swamp_api_meta', 'swamp_api_query', 'swamp_api_get', 'swamp_api_count',
    'swamp_api_insert', 'swamp_api_patch', 'swamp_api_delete',  -- token-authed REST
    'swamp_health'                                -- liveness probe
  ];
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname like 'swamp\_%'
       and not (p.proname = any(allowed))
  loop
    execute format('revoke all on function %s from public, anon', r.sig);
  end loop;
end $$;

-- ── About the door reopening on its own: IT WILL. Read this before adding a function.
--
-- Every `create function` in this schema still hands anon EXECUTE, and nothing here
-- stops that. The revokes above are per-function and cover only the functions that
-- exist today.
--
-- This is stated rather than fixed because the obvious fix does not work, and a line
-- that looks like a fix is worse than none — that is the whole lesson of this file.
-- Measured, not assumed:
--
--     alter default privileges in schema public revoke all on routines from anon;
--       -> no-op. Same PUBLIC bug as above: it removes an `anon=X` entry from the
--          stored default ACL and leaves PUBLIC's, exactly like the revoke it fixes.
--
--     alter default privileges in schema public revoke execute on routines from public;
--     alter default privileges in schema public revoke execute on functions from public;
--       -> also no-op here. Neither changes pg_default_acl, and a function created
--          straight afterwards still comes out with `=X/postgres` in its ACL:
--
--            =X/postgres | postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres
--                ^^^ PUBLIC. anon reaches every new function through this.
--
-- So the rule is a CONVENTION, and conventions need a check, not a comment:
--
--     ══════════════════════════════════════════════════════════════════════
--     EVERY new function in schema public MUST end with:
--
--         revoke all on function public.your_fn(argtypes) from public, anon;
--         grant execute on function public.your_fn(argtypes) to authenticated;
--
--     `from public` is the half that does the work. `from anon` only tidies
--     the ACL. Omit `from public` and the function is reachable by the
--     internet, and no test in this repo will notice.
--     ══════════════════════════════════════════════════════════════════════
--
-- The check that enforces it is tests/integration/anon-surface.test.ts: it enumerates
-- every swamp_* function and fails if anon can execute anything outside the allowlist
-- below. That is what makes the convention real — add a function, forget the revoke,
-- and a test goes red naming your function. Filed as follow-up: make the guard part of
-- CI, and consider auditing the ~33 functions this migration did not examine.

-- ── Prove it, rather than trust it. ──
--
-- The revoke this migration exists to fix ran clean and did nothing for two years, so
-- an assertion is the minimum bar. has_function_privilege resolves PUBLIC membership,
-- which is exactly what the original revoke failed to account for.
do $$
declare
  n text;
begin
  foreach n in array array[
    'public.swamp_accept_invite(text)',
    'public.swamp_api_require(text,text,public.swamp_role)',
    'public.swamp_api_table(jsonb,uuid)',
    'public.swamp_base_role(uuid)',
    'public.swamp_base_role_of(uuid,uuid)',
    'public.swamp_token_context(text)',
    'public.swamp_workspace_role(uuid)',
    'public.swamp_fire_button(uuid,uuid)',
    'public.swamp_resolve_share(text,text)'
  ] loop
    assert not has_function_privilege('anon', n, 'execute'),
           format('anon can still execute %s', n);
  end loop;

  -- The deliberate anon surface must survive. These are the product's public edges:
  -- share links, form submission, and the token-authed REST API. Their credential is
  -- the share id / the token — never the anon key — so anon EXECUTE is the design.
  foreach n in array array[
    'public.swamp_shared_meta(text,text)',
    'public.swamp_shared_records(text,text,jsonb)',
    'public.swamp_submit_form(text,text,jsonb)',
    'public.swamp_api_meta(text)',
    'public.swamp_api_query(text,uuid,jsonb)',
    'public.swamp_api_get(text,uuid,uuid)',
    'public.swamp_api_count(text,uuid,jsonb)',
    'public.swamp_api_insert(text,uuid,jsonb)',
    'public.swamp_api_patch(text,uuid,jsonb)',
    'public.swamp_api_delete(text,uuid,uuid[])'
  ] loop
    assert has_function_privilege('anon', n, 'execute'),
           format('anon LOST %s — the public API needs it', n);
  end loop;
end $$;
