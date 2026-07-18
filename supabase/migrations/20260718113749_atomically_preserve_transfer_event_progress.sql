create or replace function public.record_transfer_event(
  p_attempt_id uuid,
  p_install_id text,
  p_attempted_at timestamptz,
  p_source_platform text,
  p_destination_platform text,
  p_character_count integer,
  p_status text,
  p_last_stage text,
  p_failure_reason text,
  p_extension_version text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  stage_order constant text[] := array[
    'intent_started',
    'capture_started',
    'capture_completed',
    'summary_request_started',
    'summary_response_started',
    'summary_completed',
    'paste_started',
    'completed'
  ];
begin
  insert into public.transfer_events (
    attempt_id,
    install_id,
    attempted_at,
    source_platform,
    destination_platform,
    character_count,
    status,
    last_stage,
    failure_reason,
    extension_version
  ) values (
    p_attempt_id,
    p_install_id,
    p_attempted_at,
    p_source_platform,
    p_destination_platform,
    p_character_count,
    p_status,
    p_last_stage,
    p_failure_reason,
    p_extension_version
  )
  on conflict (attempt_id) do update
  set
    character_count = coalesce(excluded.character_count, transfer_events.character_count),
    status = case
      when transfer_events.status in ('succeeded', 'failed') then transfer_events.status
      else excluded.status
    end,
    failure_reason = case
      when transfer_events.status in ('succeeded', 'failed') then transfer_events.failure_reason
      else excluded.failure_reason
    end,
    last_stage = case
      when array_position(stage_order, excluded.last_stage) > array_position(stage_order, transfer_events.last_stage)
        then excluded.last_stage
      else transfer_events.last_stage
    end,
    updated_at = now()
  where
    transfer_events.status = 'started'
    or array_position(stage_order, excluded.last_stage) > array_position(stage_order, transfer_events.last_stage);
end;
$$;

revoke all on function public.record_transfer_event(uuid, text, timestamptz, text, text, integer, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_transfer_event(uuid, text, timestamptz, text, text, integer, text, text, text, text)
  to service_role;
