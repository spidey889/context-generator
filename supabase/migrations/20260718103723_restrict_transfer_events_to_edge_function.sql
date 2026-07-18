-- Public clients write through the validated transfer-telemetry Edge Function.
-- Keep the underlying analytics table unavailable through the anon Data API.
drop policy if exists "anon can insert transfer events" on public.transfer_events;
drop policy if exists "anon can update own transfer event by attempt_id" on public.transfer_events;
revoke all privileges on table public.transfer_events from anon;
