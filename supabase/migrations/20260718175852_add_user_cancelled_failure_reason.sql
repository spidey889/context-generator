alter table public.transfer_events
  drop constraint if exists transfer_events_failure_reason_check;

alter table public.transfer_events
  add constraint transfer_events_failure_reason_check check (
    failure_reason = any (array[
      'no_conversation'::text,
      'conversation_too_large'::text,
      'capture_failed'::text,
      'summary_rate_limited'::text,
      'summary_service_busy'::text,
      'summary_access_denied'::text,
      'summary_failed'::text,
      'destination_open_failed'::text,
      'paste_failed'::text,
      'extension_reloaded'::text,
      'client_interrupted'::text,
      'user_cancelled'::text,
      'unknown_failure'::text
    ])
  );
