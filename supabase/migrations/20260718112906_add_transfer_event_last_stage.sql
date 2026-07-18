alter table public.transfer_events
  add column last_stage text;

update public.transfer_events
set last_stage = case
  when status = 'succeeded' then 'completed'
  else 'intent_started'
end
where last_stage is null;

alter table public.transfer_events
  alter column last_stage set default 'intent_started',
  alter column last_stage set not null,
  add constraint transfer_events_last_stage_check check (
    last_stage = any (array[
      'intent_started'::text,
      'capture_started'::text,
      'capture_completed'::text,
      'summary_request_started'::text,
      'summary_response_started'::text,
      'summary_completed'::text,
      'paste_started'::text,
      'completed'::text
    ])
  );
