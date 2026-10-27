-- Compact progress inside existing JSON attempts. No tables/columns, capture policy or counters change.
begin;
do $migration$
declare
  original text := replace(pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure),chr(13),'');
  old_rules text;
  additional_rules constant jsonb := '{"outcome":{"type":"string","values":["succeeded","partial","failed","cancelled","started"]},"step":{"type":"string","values":["queue","hook","route","request","response","read","parse","check","serialize","complete"]},"step_stage":{"type":"string","values":["hook","session","history","attachment_descriptor","attachment_body","serialize"]},"route_reason":{"type":"string","values":["path_unrecognized","no_matching_endpoint","available"]},"saved_chat":{"type":"boolean"},"hook_ready":{"type":"boolean"},"route_found":{"type":"boolean"},"history_request_sent":{"type":"boolean"},"history_response_read":{"type":"boolean"},"history_parsed":{"type":"boolean"},"history_checked":{"type":"boolean"},"route_candidates":{"type":"number","max":2147483647},"route_resources":{"type":"number","max":2147483647},"progress_seq":{"type":"number","max":2147483647},"hook_status":{"type":"string","values":["no_reply","version_mismatch","runtime_missing","install_rejected","install_failed","ready"]}}'::jsonb;
  old_branch constant text := $old$          elsif (observation.value::text)::numeric < coalesce((observation_rule->>'min')::numeric,0)
            or (observation.value::text)::numeric > (observation_rule->>'max')::numeric
            or trunc((observation.value::text)::numeric) <> (observation.value::text)::numeric then return false; end if;$old$;
  new_branch constant text := $new$          elsif observation_rule->>'type' = 'number' then
            if (observation.value::text)::numeric < coalesce((observation_rule->>'min')::numeric,0)
            or (observation.value::text)::numeric > (observation_rule->>'max')::numeric
            or trunc((observation.value::text)::numeric) <> (observation.value::text)::numeric then return false; end if;
          end if;$new$;
begin
  old_rules := substring(original from $pattern$attempt_rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or original not like '%' || old_branch || '%' or old_rules::jsonb ? 'step' then
    raise exception 'Unexpected JSON diagnosis validator';
  end if;
  original := replace(original, quote_literal(old_rules), quote_literal((old_rules::jsonb || additional_rules)::text));
  execute replace(original, old_branch, new_branch);

  original := replace(pg_get_functiondef('public.protect_transfer_diagnostics()'::regprocedure),chr(13),'');
  if original like '%json_attempts%' or position('begin' || chr(10) in original) = 0 then
    raise exception 'Unexpected JSON diagnosis preservation trigger';
  end if;
  execute replace(original, 'begin' || chr(10), 'begin' || chr(10) || $preserve$  if old.status = 'started' and old.diagnostics ? 'json_attempts' then
    new.diagnostics := coalesce(new.diagnostics,'{"version":1}'::jsonb) || jsonb_build_object('json_attempts',
      (select coalesce(jsonb_agg(value order by case value->>'mode' when 'retry' then 2 when 'fresh' then 1 else 0 end),'[]'::jsonb)
       from (select value from (
         select distinct on (value->>'mode') value
         from jsonb_array_elements(coalesce(old.diagnostics->'json_attempts','[]'::jsonb)
           || coalesce(new.diagnostics->'json_attempts','[]'::jsonb)) with ordinality as entries(value,position)
         order by value->>'mode', (value->>'outcome' <> 'started') desc,
           case when value->>'outcome' = 'started' then coalesce((value->>'progress_seq')::integer,0) else 0 end desc, position
       ) observed order by case value->>'mode' when 'retry' then 2 when 'fresh' then 1 else 0 end limit 2) bounded));
  end if;
$preserve$);
end;
$migration$;
commit;
