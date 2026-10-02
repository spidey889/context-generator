-- Unused derived outcome labels; status and updated_at remain in event history.
-- Stale started attempts remain started, never silently rewritten as failures.
begin;
set local lock_timeout = '10s';
-- Refuse any unexpected dependent object rather than cascading its removal.
drop view public.transfer_event_outcomes restrict;
notify pgrst, 'reload schema';
commit;
