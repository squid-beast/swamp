-- ════════════════════════════════════════════════════════════════════════════
-- Webhook presets — Slack and Discord, without a middleman.
--
-- A Swamp webhook POSTs a signed JSON envelope. Slack and Discord incoming
-- webhooks do not want that envelope — they want their own tiny shape
-- (`{ "text": … }` for Slack, `{ "content": … }` for Discord) and they ignore
-- everything else. Point a raw Swamp webhook at a Slack URL today and you get a
-- 400 from Slack, or a message that reads like a stack trace.
--
-- A "preset" is the fix: the webhook remembers WHICH shape its target speaks, and
-- the dispatcher formats the outgoing body to match. For a lead-gen wedge this is
-- the whole feature — "a new lead just came in" lands in the channel the team
-- already watches, with no Zapier in between.
--
--   kind = 'generic'  → the signed envelope, exactly as before (the default, so
--                       every existing webhook is untouched)
--   kind = 'slack'    → { "text": <message> }
--   kind = 'discord'  → { "content": <message> }
--
-- `template` is an optional message with {{placeholders}} — {{event}},
-- {{recordId}}, {{fields.fld_email}}, and so on — resolved from the delivery
-- payload at send time. Empty means a sensible default is built from the record.
-- The rendering lives in TypeScript (features/tables/webhook-format.ts), not here:
-- it is pure string work, it needs no database, and it is unit-tested there.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.webhooks
  add column kind text not null default 'generic'
    check (kind in ('generic', 'slack', 'discord')),
  -- A message template. Slack caps a message around 40k and Discord at 2k; the
  -- dispatcher truncates per target, so the only limit worth enforcing here is one
  -- that stops someone storing a novel.
  add column template text check (template is null or length(template) <= 4000);
