-- The google_credentials row is now Sheets-only: it is written solely by the
-- Connect-a-sheet flow (which grants spreadsheets.readonly), never by a plain
-- Google sign-in. `scope` records what Google actually granted, so the app can tell
-- a Sheets token from a bare sign-in token instead of trusting mere row existence.
--
-- Existing rows keep scope = null and therefore read as "not connected for Sheets";
-- those users reconnect once through the Connect flow, which stores the real scope.
alter table public.google_credentials
  add column if not exists scope text;
