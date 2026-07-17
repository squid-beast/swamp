-- Let a member see who they are working with.
--
-- `profiles` has exactly three policies (20260706000000_init.sql:19-21) and the
-- select one is:
--
--     create policy "profiles: read own" on public.profiles
--       for select using (auth.uid() = id);
--
-- You can read your own profile. Nobody else's. That policy was written when the
-- product was single-player ("owner-scoped datasets", per that file's own header)
-- and it never moved when collaboration landed.
--
-- Three call sites pay for it, all in features/tables/collaboration.ts:
--
--   :226  listMembers  — reads profiles for every member id, then MAPS OVER THE
--                        RESULT. A member whose profile is unreadable is not shown
--                        nameless; they are dropped. The members panel therefore
--                        lists exactly one person: you. Invites work, roles work,
--                        and the panel that exists to show you the team shows you
--                        yourself.
--   :61   listComments — author names fall back to "Someone".
--   :157  record history — the same, for actors.
--
-- One cause, three symptoms, and it also blocks the `user`, `createdBy` and
-- `modifiedBy` field types, which are all "resolve a uuid to a name".
--
-- ── Why a function and not a wider policy ──
--
-- The obvious fix is a policy like "you may read the profile of anyone you share a
-- workspace with". It would work, and it would hand every co-worker your `dob` —
-- profiles carries a date of birth (init.sql:11) and it is real, collected at
-- registration (features/auth/components/register-form.tsx:28) and edited on the
-- profile page. Postgres RLS is row-level; it cannot return a row with a column
-- withheld, and column GRANTs are not per-policy, so a policy exposes the whole row
-- or nothing.
--
-- So: a SECURITY DEFINER function that returns a narrow projection. It is also the
-- house idiom — swamp_query_records, swamp_create_token, swamp_share_view and
-- swamp_accept_invite are all this shape. The table's own policy stays exactly as
-- strict as it is; this function is the only door, and it is a door with a
-- letterbox rather than a hole.
--
-- `dob` is not in the return type. That is the point of the whole design, so if you
-- ever add a column here, ask whether a colleague should have it.

create or replace function public.swamp_visible_profiles(p_user_ids uuid[])
returns table (
  id         uuid,
  first_name text,
  last_name  text,
  email      text,
  avatar_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, p.first_name, p.last_name, p.email, p.avatar_url
    from public.profiles p
   where p.id = any(p_user_ids)
     and (
       -- Yourself, always.
       p.id = auth.uid()

       -- Someone you share a workspace with. Kept separate from the base check
       -- below so that two workspace members can still see each other before the
       -- workspace has any bases.
       or exists (
         select 1
           from public.workspace_members me
           join public.workspace_members them
             on them.workspace_id = me.workspace_id
          where me.user_id = auth.uid()
            and them.user_id = p.id
       )

       -- Or someone you share a BASE with.
       --
       -- Membership in a base comes from EITHER table, and both sides have to
       -- allow for that. The first version of this joined base_members to itself
       -- and was wrong in the commonest case there is: the owner of a base
       -- usually has NO base_members row — their role falls back to the workspace
       -- (that is exactly what swamp_base_role_in's coalesce means). So an owner
       -- who invited an editor directly to a base could not see the person they
       -- had just invited. A test caught it.
       or exists (
         select 1
           from public.bases b
          where b.deleted_at is null
            -- I am a member of b, by either route...
            and (
              exists (
                select 1 from public.base_members bm
                 where bm.base_id = b.id and bm.user_id = auth.uid()
              )
              or exists (
                select 1 from public.workspace_members wm
                 where wm.workspace_id = b.workspace_id and wm.user_id = auth.uid()
              )
            )
            -- ...and so are they.
            and (
              exists (
                select 1 from public.base_members bm
                 where bm.base_id = b.id and bm.user_id = p.id
              )
              or exists (
                select 1 from public.workspace_members wm
                 where wm.workspace_id = b.workspace_id and wm.user_id = p.id
              )
            )
       )
     )
$$;

-- SECURITY DEFINER means this runs as the owner, so the anon role must never reach
-- it — auth.uid() is null for anon, which would make every branch above false and
-- return nothing, but relying on that is relying on an accident. Shut the door.
revoke all on function public.swamp_visible_profiles(uuid[]) from anon;
revoke all on function public.swamp_visible_profiles(uuid[]) from public;
grant execute on function public.swamp_visible_profiles(uuid[]) to authenticated;
