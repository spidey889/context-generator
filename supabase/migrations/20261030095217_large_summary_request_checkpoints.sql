-- Bounded large-summary HTTP checkpoints inside the existing diagnostics JSON.
-- Deploy this additive validator, Edge and Vercel before reloading the extension.
-- No table/column, privilege, summary-proof, provider or deadline changes.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure);
  updated text;
  old_rules text;
  old_attempt_rules text;
  request_rules constant jsonb := '{"index":{"type":"number","max":16},"total":{"type":"number","min":1,"max":16},"phase":{"type":"string","values":["part","final"]},"stage":{"type":"string","values":["request","headers","completed","failed","cancelled"]},"provider":{"type":"string","values":["openrouter","tokenharbor"]},"error_code":{"type":"string","values":["unknown_error","no_conversation","conversation_too_large","request_too_large","capture_roles_unverified","capture_json_unavailable","capture_json_failed","capture_dom_failed","conversation_changed","transfer_timeout","user_cancelled","source_tab_closed","destination_tab_closed","extension_reloaded","rate_limited","service_busy","client_not_allowed","summary_failed","summary_empty","summary_transport_failed","summary_timeout","summary_invalid_response","destination_unsupported","destination_open_failed","destination_activation_failed","destination_not_new_chat","destination_tab_unavailable","editor_missing","editor_has_draft","editor_detached","paste_not_populated","paste_not_retained","paste_focus_changed","paste_empty","paste_failed","paste_unconfirmed","message_timeout","message_receiver_missing","message_reply_missing","message_reply_invalid","message_transport_failed","insertion_exception"]},"started_ms":{"type":"number","max":2147483647},"elapsed_ms":{"type":"number","max":2147483647},"headers_ms":{"type":"number","max":2147483647},"provider_ms":{"type":"number","max":2147483647},"openrouter_ms":{"type":"number","max":2147483647},"tokenharbor_ms":{"type":"number","max":2147483647},"deadline_remaining_ms":{"type":"number","max":2147483647},"http_status":{"type":"number","min":100,"max":599}}'::jsonb;
  branch constant text := $branch$    elsif item.key = 'large_summary_requests' then
      if jsonb_array_length(item.value) > 17 then return false; end if;
      for entry in select value from jsonb_array_elements(item.value) loop
        if jsonb_typeof(entry) <> 'object' or not (entry ?& array['index','total','phase','stage','started_ms']) then return false; end if;
        for observation in select key,value from jsonb_each(entry) loop
          observation_rule := large_request_rules->observation.key;
          if observation_rule is null or jsonb_typeof(observation.value) is distinct from observation_rule->>'type' then return false; end if;
          if observation_rule ? 'values' then
            if not (observation_rule->'values' @> jsonb_build_array(observation.value)) then return false; end if;
          elsif observation_rule->>'type' = 'number' then
            if (observation.value::text)::numeric < coalesce((observation_rule->>'min')::numeric,0)
              or (observation.value::text)::numeric > (observation_rule->>'max')::numeric
              or trunc((observation.value::text)::numeric) <> (observation.value::text)::numeric then return false; end if;
          end if;
        end loop;
        if (entry->>'phase' = 'part' and (entry->>'index')::integer >= (entry->>'total')::integer)
          or (entry->>'phase' = 'final' and (entry->>'index')::integer <> (entry->>'total')::integer) then return false; end if;
      end loop;
      if exists (select 1 from jsonb_array_elements(item.value) value group by value->'phase',value->'index' having count(*) > 1) then return false; end if;
$branch$;
begin
  old_rules := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  old_attempt_rules := substring(original from $pattern$attempt_rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_attempt_rules is null or original like '%large_summary_requests%'
    or position('    elsif item.key = ''json_attempts'' then' in original) = 0 then
    raise exception 'Unexpected client diagnosis validator';
  end if;
  updated := replace(original, quote_literal(old_rules),
    quote_literal((old_rules::jsonb || '{"large_summary_requests":{"type":"array"}}'::jsonb)::text));
  updated := replace(updated, 'attempt_rules constant jsonb := ' || quote_literal(old_attempt_rules) || '::jsonb;',
    'attempt_rules constant jsonb := ' || quote_literal(old_attempt_rules) || '::jsonb;' || chr(10)
      || '  large_request_rules constant jsonb := ' || quote_literal(request_rules::text) || '::jsonb;');
  updated := replace(updated, '    elsif item.key = ''json_attempts'' then', branch || '    elsif item.key = ''json_attempts'' then');
  if updated = original or updated not like '%large_request_rules constant jsonb%' then
    raise exception 'Could not extend client diagnosis validator';
  end if;
  execute updated;

  -- Preserve the furthest observation per part through sparse fallback reports.
  original := replace(pg_get_functiondef('public.protect_transfer_diagnostics()'::regprocedure),chr(13),'');
  if original like '%large_summary_requests%' or position('begin' || chr(10) in original) = 0 then
    raise exception 'Unexpected diagnosis preservation trigger';
  end if;
  updated := replace(original, 'begin' || chr(10), 'begin' || chr(10) || $preserve$  if old.status = 'started' and old.diagnostics ? 'large_summary_requests' then
    new.diagnostics := coalesce(new.diagnostics,'{"version":1}'::jsonb) || jsonb_build_object('large_summary_requests',
      (select coalesce(jsonb_agg(value order by (value->>'index')::integer),'[]'::jsonb) from (
        select distinct on (value->>'phase',value->>'index') value
        from jsonb_array_elements(coalesce(old.diagnostics->'large_summary_requests','[]'::jsonb)
          || coalesce(new.diagnostics->'large_summary_requests','[]'::jsonb)) with ordinality as entries(value,position)
        order by value->>'phase',value->>'index',
          case value->>'stage' when 'request' then 0 when 'headers' then 1 else 2 end desc,
          case when value->>'stage' in ('completed','failed','cancelled') then -position else position end desc
      ) observed));
  end if;
$preserve$);
  execute updated;
end;
$migration$;
commit;
