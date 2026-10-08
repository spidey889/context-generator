-- One metadata record per attempt; absent legacy observations stay NULL.
-- The closed schema below is verified against extension/transfer-diagnostics.js.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
lock table public.transfers in share row exclusive mode;

create function public.is_valid_transfer_diagnostics(input jsonb, depth integer default 0)
returns boolean language plpgsql immutable security invoker set search_path = '' as $validator$
declare
  rules constant jsonb := '{"version":{"type":"number","values":[1]},"error_code":{"type":"string","values":["unknown_error","no_conversation","conversation_too_large","request_too_large","capture_roles_unverified","capture_json_unavailable","capture_json_failed","capture_dom_failed","conversation_changed","transfer_timeout","user_cancelled","source_tab_closed","destination_tab_closed","extension_reloaded","rate_limited","service_busy","client_not_allowed","summary_failed","summary_empty","summary_transport_failed","summary_timeout","summary_invalid_response","destination_unsupported","destination_open_failed","destination_activation_failed","destination_not_new_chat","destination_tab_unavailable","editor_missing","editor_has_draft","editor_detached","paste_not_populated","paste_not_retained","paste_focus_changed","paste_empty","paste_failed","paste_unconfirmed","message_timeout","message_receiver_missing","message_reply_missing","message_reply_invalid","message_transport_failed","insertion_exception"]},"recovery_error_code":{"type":"string","values":["unknown_error","no_conversation","conversation_too_large","request_too_large","capture_roles_unverified","capture_json_unavailable","capture_json_failed","capture_dom_failed","conversation_changed","transfer_timeout","user_cancelled","source_tab_closed","destination_tab_closed","extension_reloaded","rate_limited","service_busy","client_not_allowed","summary_failed","summary_empty","summary_transport_failed","summary_timeout","summary_invalid_response","destination_unsupported","destination_open_failed","destination_activation_failed","destination_not_new_chat","destination_tab_unavailable","editor_missing","editor_has_draft","editor_detached","paste_not_populated","paste_not_retained","paste_focus_changed","paste_empty","paste_failed","paste_unconfirmed","message_timeout","message_receiver_missing","message_reply_missing","message_reply_invalid","message_transport_failed","insertion_exception"]},"summary_error_code":{"type":"string","values":["unknown_error","no_conversation","conversation_too_large","request_too_large","capture_roles_unverified","capture_json_unavailable","capture_json_failed","capture_dom_failed","conversation_changed","transfer_timeout","user_cancelled","source_tab_closed","destination_tab_closed","extension_reloaded","rate_limited","service_busy","client_not_allowed","summary_failed","summary_empty","summary_transport_failed","summary_timeout","summary_invalid_response","destination_unsupported","destination_open_failed","destination_activation_failed","destination_not_new_chat","destination_tab_unavailable","editor_missing","editor_has_draft","editor_detached","paste_not_populated","paste_not_retained","paste_focus_changed","paste_empty","paste_failed","paste_unconfirmed","message_timeout","message_receiver_missing","message_reply_missing","message_reply_invalid","message_transport_failed","insertion_exception"]},"editor_last_error_code":{"type":"string","values":["unknown_error","no_conversation","conversation_too_large","request_too_large","capture_roles_unverified","capture_json_unavailable","capture_json_failed","capture_dom_failed","conversation_changed","transfer_timeout","user_cancelled","source_tab_closed","destination_tab_closed","extension_reloaded","rate_limited","service_busy","client_not_allowed","summary_failed","summary_empty","summary_transport_failed","summary_timeout","summary_invalid_response","destination_unsupported","destination_open_failed","destination_activation_failed","destination_not_new_chat","destination_tab_unavailable","editor_missing","editor_has_draft","editor_detached","paste_not_populated","paste_not_retained","paste_focus_changed","paste_empty","paste_failed","paste_unconfirmed","message_timeout","message_receiver_missing","message_reply_missing","message_reply_invalid","message_transport_failed","insertion_exception"]},"error_origin":{"type":"string","values":["source","background","destination","summary_service"]},"last_operation":{"type":"string","values":["admission","capture_prepare","capture_json","capture_dom","capture_complete","summary_request","summary_response","summary_complete","destination_prepare","destination_open","destination_activate","destination_settle","message_send","script_inject","paste_start","editor_wait","editor_insert","paste_verify","paste_stability","paste_focus","paste_complete","completed"]},"entry_point":{"type":"string","values":["picker","toolbar","other"]},"browser":{"type":"string","values":["chromium","firefox"]},"visibility":{"type":"string","values":["visible","hidden","prerender","unknown"]},"capture_method":{"type":"string","values":["structured","sweep","claude-json","chatgpt-json","gemini-json","grok-json","deepseek-json","unknown"]},"json_fallback_code":{"type":"string","values":["unavailable","timeout","size_limit","incomplete","unsupported","request_failed","unknown"]},"sweep_exit":{"type":"string","values":["max-advances-reached","quiet-check-passed","no-scroll-movement","stale-limit-hit","other"]},"summary_mode":{"type":"string","values":["remote","local","local_fallback","cache"]},"message_reply":{"type":"string","values":["ack_success","ack_failed","timeout","missing","invalid","transport_failed","receiver_missing"]},"editor_kind":{"type":"string","values":["textarea","input","contenteditable","other"]},"insertion_method":{"type":"string","values":["value_setter","insert_text","insert_html","dom_text","chatgpt","already_present"]},"online":{"type":"boolean"},"source_saved":{"type":"boolean"},"speed_enabled":{"type":"boolean"},"json_attempted":{"type":"boolean"},"source_changed":{"type":"boolean"},"cancelled":{"type":"boolean"},"destination_prepared":{"type":"boolean"},"prepared_reused":{"type":"boolean"},"prepared_rejected":{"type":"boolean"},"fresh_recovery":{"type":"boolean"},"script_injected":{"type":"boolean"},"editor_seen":{"type":"boolean"},"editor_connected":{"type":"boolean"},"draft_present":{"type":"boolean"},"paste_populated":{"type":"boolean"},"paste_stable":{"type":"boolean"},"user_handled":{"type":"boolean"},"summary_cache_hit":{"type":"boolean"},"summary_fallback":{"type":"boolean"},"events_truncated":{"type":"boolean"},"duration_ms":{"type":"number","max":2147483647},"deadline_remaining_ms":{"type":"number","max":2147483647},"capture_ms":{"type":"number","max":2147483647},"capture_chars":{"type":"number","max":2147483647},"capture_bytes":{"type":"number","max":2147483647},"candidate_turns":{"type":"number","max":2147483647},"captured_turns":{"type":"number","max":2147483647},"useful_turns":{"type":"number","max":2147483647},"raw_candidate_chars":{"type":"number","max":2147483647},"initial_rendered_turns":{"type":"number","max":2147483647},"sweep_scrolls":{"type":"number","max":2147483647},"sweep_stale_scrolls":{"type":"number","max":2147483647},"sweep_quiet_checks":{"type":"number","max":2147483647},"capture_retries":{"type":"number","max":2147483647},"expanded_blocks":{"type":"number","max":2147483647},"summary_chars":{"type":"number","max":2147483647},"summary_bytes":{"type":"number","max":2147483647},"summary_ms":{"type":"number","max":2147483647},"summary_fetch_ms":{"type":"number","max":2147483647},"summary_parse_ms":{"type":"number","max":2147483647},"summary_service_ms":{"type":"number","max":2147483647},"summary_provider_attempts":{"type":"number","max":2147483647},"summary_http_status":{"type":"number","max":2147483647},"destination_open_ms":{"type":"number","max":2147483647},"activation_ms":{"type":"number","max":2147483647},"activation_settle_ms":{"type":"number","max":2147483647},"delivery_ms":{"type":"number","max":2147483647},"message_ms":{"type":"number","max":2147483647},"message_attempts":{"type":"number","max":2147483647},"script_injections":{"type":"number","max":2147483647},"paste_ms":{"type":"number","max":2147483647},"paste_attempts":{"type":"number","max":2147483647},"composer_wait_ms":{"type":"number","max":2147483647},"paste_retry_limit_ms":{"type":"number","max":2147483647},"paste_verify_limit_ms":{"type":"number","max":2147483647},"paste_stability_ms":{"type":"number","max":2147483647},"editor_remounts":{"type":"number","max":2147483647},"editor_text_chars":{"type":"number","max":2147483647},"page_load_ms":{"type":"number","max":2147483647},"events":{"type":"array"},"delivery_events":{"type":"array"},"paste_events":{"type":"array"},"prepared_diagnostics":{"type":"object"}}'::jsonb;
  event_names constant jsonb := '["admission","capture_prepare","capture_json","capture_dom","capture_complete","summary_request","summary_response","summary_complete","destination_prepare","destination_open","destination_activate","destination_settle","message_send","script_inject","paste_start","editor_wait","editor_insert","paste_verify","paste_stability","paste_focus","paste_complete","completed","json_fallback","local_fallback","prepared_reused","prepared_rejected","fresh_recovery","editor_remounted","failure","cancelled","deadline_expired"]'::jsonb;
  error_codes constant jsonb := '["unknown_error","no_conversation","conversation_too_large","request_too_large","capture_roles_unverified","capture_json_unavailable","capture_json_failed","capture_dom_failed","conversation_changed","transfer_timeout","user_cancelled","source_tab_closed","destination_tab_closed","extension_reloaded","rate_limited","service_busy","client_not_allowed","summary_failed","summary_empty","summary_transport_failed","summary_timeout","summary_invalid_response","destination_unsupported","destination_open_failed","destination_activation_failed","destination_not_new_chat","destination_tab_unavailable","editor_missing","editor_has_draft","editor_detached","paste_not_populated","paste_not_retained","paste_focus_changed","paste_empty","paste_failed","paste_unconfirmed","message_timeout","message_receiver_missing","message_reply_missing","message_reply_invalid","message_transport_failed","insertion_exception"]'::jsonb;
  item record;
  rule jsonb;
  entry jsonb;
begin
  if input is null then return true; end if;
  if depth not between 0 and 1 or jsonb_typeof(input) <> 'object' or input->'version' is distinct from '1'::jsonb
    or octet_length(input::text) > 16384 then return false; end if;
  for item in select key,value from jsonb_each(input) loop
    rule := rules->item.key;
    if rule is null or jsonb_typeof(item.value) is distinct from rule->>'type' then return false; end if;
    if item.key = 'prepared_diagnostics' then
      if depth >= 1 or not public.is_valid_transfer_diagnostics(item.value,depth+1) then return false; end if;
    elsif rule->>'type' = 'array' then
      if jsonb_array_length(item.value) > 32 then return false; end if;
      for entry in select value from jsonb_array_elements(item.value) loop
        if jsonb_typeof(entry) <> 'object' then return false; end if;
        if exists (select 1 from jsonb_object_keys(entry) k where k not in ('event','at_ms','code'))
          or jsonb_typeof(entry->'event') is distinct from 'string'
          or not (event_names @> jsonb_build_array(entry->'event'))
          or jsonb_typeof(entry->'at_ms') is distinct from 'number' then return false; end if;
        if (entry->>'at_ms')::numeric < 0 or (entry->>'at_ms')::numeric > 2147483647
          or trunc((entry->>'at_ms')::numeric) <> (entry->>'at_ms')::numeric then return false; end if;
        if entry ? 'code' and (jsonb_typeof(entry->'code') is distinct from 'string'
          or not (error_codes @> jsonb_build_array(entry->'code'))) then return false; end if;
      end loop;
    elsif rule ? 'values' then
      if not (rule->'values' @> jsonb_build_array(item.value)) then return false; end if;
    elsif rule->>'type' = 'number' then
      if (item.value::text)::numeric < 0 or (item.value::text)::numeric > (rule->>'max')::numeric
        or trunc((item.value::text)::numeric) <> (item.value::text)::numeric then return false; end if;
    end if;
  end loop;
  return true;
end;
$validator$;
revoke all on function public.is_valid_transfer_diagnostics(jsonb,integer) from public,anon,authenticated;
grant execute on function public.is_valid_transfer_diagnostics(jsonb,integer) to service_role;

alter table public.transfers add column diagnostics jsonb;
alter table public.transfers add constraint transfers_diagnostics_check check (public.is_valid_transfer_diagnostics(diagnostics));
comment on column public.transfers.diagnostics is 'Versioned bounded client observations, not authenticated causes: closed error codes, counts, timings and component timelines. No content, URLs, accounts or arbitrary errors. NULL means this client did not provide diagnostics.';

-- Freeze the first terminal diagnostic alongside the first outcome. A compatible
-- older terminal envelope may be enriched once when its diagnostics were absent.
create function public.protect_transfer_diagnostics() returns trigger language plpgsql security invoker set search_path = '' as $guard$
begin
  if old.status <> 'started' and old.diagnostics is not null and new.diagnostics is distinct from old.diagnostics then
    raise exception using errcode = '23514', message = 'Terminal diagnostics are immutable';
  end if;
  return new;
end;
$guard$;
revoke all on function public.protect_transfer_diagnostics() from public,anon,authenticated;
grant execute on function public.protect_transfer_diagnostics() to service_role;
create trigger protect_transfer_diagnostics before update on public.transfers for each row execute function public.protect_transfer_diagnostics();

drop function public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text) restrict;
create function public.record_transfer_event(
  p_attempt_id uuid, p_install_id text, p_attempted_at timestamptz,
  p_source_platform text, p_destination_platform text, p_character_count integer,
  p_status text, p_last_stage text, p_failure_reason text, p_extension_version text,
  p_summary_verified boolean default false, p_completed_at timestamptz default null,
  p_summary_confirmed_at timestamptz default null, p_model text default null,
  p_reported_model text default null, p_diagnostics jsonb default null
) returns void language plpgsql security invoker set search_path = '' as $function$
declare
  stage_order constant text[] := array['intent_started','capture_started','capture_completed',
    'summary_request_started','summary_response_started','summary_completed','paste_started','completed'];
begin
  if not public.is_valid_transfer_diagnostics(p_diagnostics) then
    raise exception using errcode = '23514', message = 'Invalid transfer diagnostics';
  end if;
  if p_reported_model is not null and (p_last_stage not in ('summary_completed','paste_started','completed')
    or p_reported_model not in ('local-direct','gemini-3.6-flash','gemini-3.5-flash-lite','ministral-14b-2512',
      'inclusionai/ling-3.1-flash','qwen/qwen3.8-27b:free','dots-studio/dots-3-note-preview:free','google/gemma-4-26b-a4b-it:free')) then
    raise exception using errcode = '23514', message = 'Invalid reported model';
  end if;
  -- Allocate before the UPSERT: users' label backfill must finish before
  -- ON CONFLICT touches a retried transfer, including after user deletion/reset.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_install_id, 0));
  if not exists (select 1 from public.users u where u.install_id = p_install_id) then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cap-context-users-allocation', 0));
    insert into public.users (install_id, today_date)
    values (p_install_id, (clock_timestamp() at time zone 'Asia/Kolkata')::date)
    on conflict (install_id) do nothing;
  end if;
  insert into public.transfers (
    attempt_id,install_id,attempted_at,source_platform,destination_platform,
    character_count,model,status,last_stage,failure_reason,extension_version,
    summary_verified,summary_confirmed_at,model_verified,diagnostics
  ) values (
    p_attempt_id,p_install_id,p_attempted_at,p_source_platform,p_destination_platform,
    p_character_count,coalesce(p_model,p_reported_model),p_status,p_last_stage,p_failure_reason,p_extension_version,
    coalesce(p_summary_verified,false),p_summary_confirmed_at,p_model is not null,p_diagnostics
  ) on conflict (attempt_id) do update set
    install_id = excluded.install_id,
    attempted_at = excluded.attempted_at,
    source_platform = excluded.source_platform,
    destination_platform = excluded.destination_platform,
    diagnostics = case
      when transfers.status <> 'started' then
        case when transfers.diagnostics is null and excluded.status = transfers.status
          and excluded.last_stage = transfers.last_stage and excluded.failure_reason is not distinct from transfers.failure_reason
          then excluded.diagnostics else transfers.diagnostics end
      when excluded.status <> 'started' or array_position(stage_order,excluded.last_stage) >= array_position(stage_order,transfers.last_stage)
        then case when excluded.diagnostics is null then transfers.diagnostics
          else coalesce(transfers.diagnostics,'{}'::jsonb) || excluded.diagnostics end
      else transfers.diagnostics end,
    character_count = case when transfers.status = 'started'
      then coalesce(excluded.character_count,transfers.character_count) else transfers.character_count end,
    status = case when transfers.status = 'started' then excluded.status else transfers.status end,
    failure_reason = case when transfers.status = 'started' then excluded.failure_reason else transfers.failure_reason end,
    last_stage = case when transfers.status <> 'started' then transfers.last_stage
      when excluded.status <> 'started' then excluded.last_stage
      when array_position(stage_order,excluded.last_stage) > array_position(stage_order,transfers.last_stage)
        then excluded.last_stage else transfers.last_stage end,
    model = case
      when excluded.model_verified and not transfers.model_verified
        and (not transfers.summary_verified or transfers.summary_confirmed_at = excluded.summary_confirmed_at)
        then excluded.model
      when transfers.model is null and not excluded.model_verified then excluded.model
      else transfers.model end,
    model_verified = transfers.model_verified or (excluded.model_verified
      and (not transfers.summary_verified or transfers.summary_confirmed_at = excluded.summary_confirmed_at)),
    summary_verified = transfers.summary_verified or excluded.summary_verified,
    summary_confirmed_at = case when not transfers.summary_verified
      then excluded.summary_confirmed_at else transfers.summary_confirmed_at end
  where row(transfers.install_id,transfers.attempted_at,transfers.source_platform,transfers.destination_platform)
      is distinct from row(excluded.install_id,excluded.attempted_at,excluded.source_platform,excluded.destination_platform)
    or (excluded.summary_verified and not transfers.summary_verified)
    or (excluded.model_verified and not transfers.model_verified
      and (not transfers.summary_verified or transfers.summary_confirmed_at = excluded.summary_confirmed_at))
    or (transfers.model is null and excluded.model is not null and not excluded.model_verified)
    or (excluded.diagnostics is not null and
      ((transfers.status = 'started' and array_position(stage_order,excluded.last_stage) >= array_position(stage_order,transfers.last_stage))
        or (transfers.diagnostics is null and transfers.status = excluded.status and transfers.last_stage = excluded.last_stage
          and transfers.failure_reason is not distinct from excluded.failure_reason)))
    or (transfers.status = 'started' and (excluded.status <> 'started'
      or array_position(stage_order,excluded.last_stage) > array_position(stage_order,transfers.last_stage)
      or (transfers.character_count is null and excluded.character_count is not null)));
end;
$function$;
revoke all on function public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb) to service_role;
comment on function public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb) is 'Compatible 10-16 argument metadata upsert. Optional diagnostics preserve first outcomes, receipts, counters and allocation; legacy NULL observations are never invented.';
notify pgrst, 'reload schema';
commit;
