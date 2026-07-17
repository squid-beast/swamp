-- One round-trip that proves Postgres is answering, and nothing else.
--
-- app/api/health/route.ts needs to distinguish "the database answered" from "the
-- database is unreachable". Every other function in this schema needs arguments,
-- a token, or a session, so using one of them as a liveness probe means asserting
-- on the shape of an *expected error* — which quietly turns a health check into a
-- thing you have to decode at 3am, and which breaks the day an error code changes.
--
-- So: a function that takes nothing, touches nothing, and returns 'ok'. If this
-- returns, Postgres parsed a statement, executed it, and sent a result back. That
-- is the entire claim, and it is the only claim a liveness probe should make.
--
-- ponytail: it deliberately does NOT check whether any table is readable — that is
-- RLS's job and varies per caller. Add a deeper probe when a real incident shows
-- this one saying "ok" while the app is broken.

create or replace function public.swamp_health()
returns text
language sql
immutable
parallel safe
as $$ select 'ok'::text $$;

-- Anonymous by design: a health check you need credentials for is useless in the
-- incident where you need it. It reveals nothing — there is no argument to inject
-- and no data behind it.
--
-- Both revokes are needed, and this is the pattern the rest of the schema gets
-- wrong. `revoke ... from anon` alone does nothing: EXECUTE on a new function is
-- granted to PUBLIC by default, and anon is a member of PUBLIC, so it keeps the
-- privilege via that route. Revoke PUBLIC first, then grant back deliberately.
revoke all on function public.swamp_health() from public;
revoke all on function public.swamp_health() from anon;
grant execute on function public.swamp_health() to anon, authenticated, service_role;
