-- ════════════════════════════════════════════════════════════════════════════
-- Edit a share's password without rotating its link.
--
-- swamp_share_view ALWAYS mints a fresh share_id — that is right when you first
-- share a view, and wrong for every subsequent edit. With only that function to
-- call, the UI had no way to change or remove a password except by revoking and
-- re-sharing, which kills the URL you already sent people.
--
-- Rotation should be a decision, not a side effect of editing a setting. So:
--
--   swamp_share_view          — first share, or an explicit "regenerate link"
--   swamp_set_share_password  — change/clear the gate, link untouched  (here)
--
-- Passing NULL or '' clears the password, which is the operation that had no
-- path at all: the dialog sent `password || undefined`, so an emptied field
-- simply omitted the key and the old password survived.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.swamp_set_share_password(
  p_view_id  uuid,
  p_password text
)
returns void
language plpgsql
-- crypt / gen_salt are pgcrypto; name `extensions` so this resolves on hosted
-- Supabase as well as on the local CLI, matching swamp_share_view.
set search_path = public, extensions, pg_temp
as $$
begin
  update public.views
     set share_password_hash = case
           when p_password is null or p_password = '' then null
           else crypt(p_password, gen_salt('bf'))
         end
   where id = p_view_id
     and share_id is not null      -- nothing to gate on an unshared view
     and deleted_at is null;

  -- Fail closed and loudly. A silent no-op here would tell someone their share
  -- is now password-protected when it isn't — the same class of bug as
  -- swamp_unshare_base returning success on a zero-row update.
  if not found then
    raise exception 'swamp: view % is not shared, or you cannot change it', p_view_id
      using errcode = '42501';
  end if;
end
$$;

revoke all on function public.swamp_set_share_password(uuid, text) from public, anon;
grant execute on function public.swamp_set_share_password(uuid, text) to authenticated;
