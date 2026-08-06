-- Webhook reach: teams, mattermost and email kinds + per-kind config.
--
-- teams/mattermost are body shapes, exactly like slack/discord before them
-- (20260719000000_webhook_presets.sql). email is different in kind: it has no
-- URL — delivery goes through the app's email sender (Resend, best-effort),
-- and the recipient lives in `config`.
--
-- `config` is deliberately a jsonb bag, not columns: today it holds
-- { "to": "ops@example.com" } for email; a future kind that needs its own
-- settings adds keys, not migrations. NOTE the RLS consequence, stated plainly:
-- webhooks are creator-readable, so anything in config is readable by every
-- creator on the base. An email address is fine. A paid-API credential (Twilio)
-- is NOT — that decision is explicitly deferred and must not sneak in as a key.

alter table public.webhooks
  add column config jsonb not null default '{}'::jsonb;

-- email has no URL. Everything else still must have an http(s) one.
alter table public.webhooks alter column url drop not null;

-- NULL-proof: `url ~ '…'` on a NULL yields NULL and a NULL check PASSES, so the
-- non-email branch must say `is not null` explicitly now that the column allows
-- NULL at all. (Caught by the integration test, not by inspection.)
alter table public.webhooks drop constraint webhooks_url_check;
alter table public.webhooks add constraint webhooks_url_check
  check (
    case when kind = 'email'
         then url is null
         else url is not null and url ~ '^https?://'
    end
  );

alter table public.webhooks drop constraint webhooks_kind_check;
alter table public.webhooks add constraint webhooks_kind_check
  check (kind in ('generic', 'slack', 'discord', 'teams', 'mattermost', 'email'));

-- An email hook without a recipient can never deliver — refuse it at write time
-- rather than dead-lettering every delivery at dispatch time.
alter table public.webhooks add constraint webhooks_email_config_check
  check (kind <> 'email' or (config ? 'to'));
