-- Four new view types: list, timeline, gantt, map.
--
-- This migration adds the enum values and NOTHING else, deliberately: a value
-- added by ALTER TYPE cannot be USED in the same transaction that adds it, and
-- Supabase runs each migration file as one transaction. Anything that wants to
-- reference these values belongs in a later file.
--
-- Views are metadata (a row in `views` + config jsonb) — no other schema is
-- needed. Timeline/gantt reuse the calendar's config.ranges; gantt dependencies
-- ride a self-referential link field; map reads a coordinates field.

alter type public.swamp_view_type add value if not exists 'list';
alter type public.swamp_view_type add value if not exists 'timeline';
alter type public.swamp_view_type add value if not exists 'gantt';
alter type public.swamp_view_type add value if not exists 'map';
