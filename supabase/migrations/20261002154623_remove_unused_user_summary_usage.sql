-- Unused service reporting convenience; counters/history live in the tables.
-- Recorded migrations retain it at their historical replay boundaries.
begin;
set local lock_timeout = '10s';
-- RESTRICT aborts for an unexpected dependent object; never cascade cleanup.
drop view public.user_summary_usage restrict;
notify pgrst, 'reload schema';
commit;
