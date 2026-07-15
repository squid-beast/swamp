-- Drop the standalone task board.
--
-- SWAMP is one application now: an Airtable-class workspace. A board is a kanban
-- view over a table, so `features/task-board` and its three tables were removed
-- in the Phase 0 teardown (see docs/ROADMAP.md).
--
-- The original 0003_boards.sql was deleted from the repo, but deleting a
-- migration file does not drop the tables it created — any database that ran it
-- still has them. This migration is what actually removes them.
--
-- Idempotent: a no-op on a fresh database, a cleanup on an existing one.

drop table if exists public.task_cards cascade;
drop table if exists public.task_columns cascade;
drop table if exists public.task_boards cascade;
