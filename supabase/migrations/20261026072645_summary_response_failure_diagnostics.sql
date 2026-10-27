-- Forward browser response-processing failures through existing transfer diagnostics.
-- Deploy DB, Edge and Vercel validators before distributing the updated extension.
-- No new tables/columns, permissions, outcomes or counter rules.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure);
  updated text;
  old_rules text;
  old_attempt_rules text;
  response_rules constant jsonb := '{"attempt":{"type":"number","min":1,"max":2},"phase":{"type":"string","values":["response_headers","response_body","stream_read","stream_utf8_decode","stream_json_parse","stream_event_validation","stream_completion_validation","near_end_callback","summary_validation","summary_confirmation","unknown"]},"reason":{"type":"string","values":["aborted","http_rejected","service_rejected","body_read_failed","utf8_decode_failed","json_parse_failed","stream_event_invalid","stream_completion_invalid","summary_invalid","callback_failed","unexpected_exception"]},"error_type":{"type":"string","values":["Error","TypeError","SyntaxError","RangeError","ReferenceError","AbortError","TimeoutError","SecurityError","NotAllowedError","NotFoundError","InvalidStateError","other"]},"format":{"type":"string","values":["json","ndjson","unknown"]},"http_status":{"type":"number","min":100,"max":599},"service_code":{"type":"string","values":["conversation_too_large","request_too_large","rate_limited","service_busy","client_not_allowed","summary_failed","other"]},"service_status":{"type":"number","min":100,"max":599},"bytes_received":{"type":"number","max":2147483647},"chunks_received":{"type":"number","max":2147483647},"events_received":{"type":"number","max":2147483647},"elapsed_ms":{"type":"number","max":2147483647},"headers_ms":{"type":"number","max":2147483647},"last_chunk_ms":{"type":"number","max":2147483647},"deadline_remaining_ms":{"type":"number","max":2147483647},"aborted":{"type":"boolean"},"caller_aborted":{"type":"boolean"},"deadline_elapsed":{"type":"boolean"},"transfer_deadline_elapsed":{"type":"boolean"},"eof":{"type":"boolean"},"final_result":{"type":"boolean"},"online":{"type":"boolean"}}'::jsonb;
  branch constant text := $branch$    elsif item.key = 'summary_response_failures' then
      if jsonb_array_length(item.value) > 2 then return false; end if;
      for entry in select value from jsonb_array_elements(item.value) loop
        if jsonb_typeof(entry) <> 'object' or not (entry ?& array['attempt','phase','reason','error_type']) then return false; end if;
        for observation in select key,value from jsonb_each(entry) loop
          observation_rule := summary_response_rules->observation.key;
          if observation_rule is null or jsonb_typeof(observation.value) is distinct from observation_rule->>'type' then return false; end if;
          if observation_rule ? 'values' then
            if not (observation_rule->'values' @> jsonb_build_array(observation.value)) then return false; end if;
          elsif observation_rule->>'type' = 'number' then
            if (observation.value::text)::numeric < coalesce((observation_rule->>'min')::numeric,0)
              or (observation.value::text)::numeric > (observation_rule->>'max')::numeric
              or trunc((observation.value::text)::numeric) <> (observation.value::text)::numeric then return false; end if;
          end if;
        end loop;
      end loop;
      if exists (select 1 from jsonb_array_elements(item.value) value group by value->'attempt' having count(*) > 1) then return false; end if;
$branch$;
begin
  old_rules := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  old_attempt_rules := substring(original from $pattern$attempt_rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_attempt_rules is null or original like '%summary_response_failures%'
    or position('    elsif item.key = ''json_attempts'' then' in original) = 0 then
    raise exception 'Unexpected client diagnosis validator';
  end if;
  updated := replace(original, quote_literal(old_rules),
    quote_literal((old_rules::jsonb || '{"summary_response_failures":{"type":"array"}}'::jsonb)::text));
  updated := replace(updated, 'attempt_rules constant jsonb := ' || quote_literal(old_attempt_rules) || '::jsonb;',
    'attempt_rules constant jsonb := ' || quote_literal(old_attempt_rules) || '::jsonb;' || chr(10)
      || '  summary_response_rules constant jsonb := ' || quote_literal(response_rules::text) || '::jsonb;');
  updated := replace(updated, '    elsif item.key = ''json_attempts'' then', branch || '    elsif item.key = ''json_attempts'' then');
  if updated = original or updated not like '%summary_response_rules constant jsonb%' then
    raise exception 'Could not extend client diagnosis validator';
  end if;
  execute updated;

  -- A delayed same-stage progress snapshot must not discard the other failed
  -- read. The first observation for each HTTP attempt remains immutable.
  original := replace(pg_get_functiondef('public.protect_transfer_diagnostics()'::regprocedure),chr(13),'');
  if original like '%summary_response_failures%' or position('begin' || chr(10) in original) = 0 then
    raise exception 'Unexpected diagnosis preservation trigger';
  end if;
  updated := replace(original, 'begin' || chr(10), 'begin' || chr(10) || $preserve$  if old.status = 'started' and old.diagnostics ? 'summary_response_failures' then
    new.diagnostics := coalesce(new.diagnostics,'{"version":1}'::jsonb) || jsonb_build_object('summary_response_failures',
      (select coalesce(jsonb_agg(value order by (value->>'attempt')::integer),'[]'::jsonb) from (
        select distinct on (value->>'attempt') value
        from jsonb_array_elements(coalesce(old.diagnostics->'summary_response_failures','[]'::jsonb)
          || coalesce(new.diagnostics->'summary_response_failures','[]'::jsonb)) with ordinality as entries(value,position)
        order by value->>'attempt',position
      ) observed));
  end if;
$preserve$);
  execute updated;
end;
$migration$;
commit;
