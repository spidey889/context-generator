-- Unused daily aggregate; all timestamped verified events remain queryable.
-- Retain the recorded creation/IST migrations for historical replay/restore.
begin;
set local lock_timeout = '10s';
-- Refuse unexpected dependencies; never remove them through CASCADE.
drop view public.verified_summary_daily_usage restrict;
notify pgrst, 'reload schema';
commit;
