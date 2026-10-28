-- Bounded copy-recovery facts can arrive after delivery is terminal. No outcome,
-- identity, proof or counter rule changes; no chat text, tables or columns.
begin;

create or replace function public.merge_transfer_recovery_events(first_events jsonb, next_events jsonb)
returns jsonb language sql immutable set search_path = '' as $function$
  select coalesce(jsonb_agg(value order by position),'[]'::jsonb) from (
    select value,position from (
      select distinct on (jsonb_build_array(value->'event',value->'surface',value->'side',value->'method',value->'stop_confirmed')) value,position
      from jsonb_array_elements(coalesce(first_events,'[]'::jsonb) || coalesce(next_events,'[]'::jsonb))
        with ordinality as entries(value,position)
      order by jsonb_build_array(value->'event',value->'surface',value->'side',value->'method',value->'stop_confirmed'),position
    ) first_observations order by position limit 12
  ) bounded;
$function$;
revoke all on function public.merge_transfer_recovery_events(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.merge_transfer_recovery_events(jsonb,jsonb) to service_role;

do $migration$
declare
  original text;
  updated text;
  old_rules text;
  old_response_rules text;
  response_rules jsonb;
  rpc regprocedure;
  recovery_rules constant jsonb := '{"event":{"type":"string","values":["box_shown","copy_started","copy_succeeded","copy_failed","copy_unconfirmed"]},"surface":{"type":"string","values":["dialog","handoff_copy","copy_notice"]},"side":{"type":"string","values":["source","destination"]},"method":{"type":"string","values":["clipboard","native","manual_selection"]},"at_ms":{"type":"number","max":2147483647},"stop_confirmed":{"type":"boolean"}}'::jsonb;
  recovery_branch constant text := $branch$    elsif item.key = 'recovery_events' then
      if jsonb_array_length(item.value) > 12 then return false; end if;
      for entry in select value from jsonb_array_elements(item.value) loop
        if jsonb_typeof(entry) <> 'object' or not (entry ?& array['event','surface','side','at_ms'])
          or (entry->>'event' <> 'box_shown' and not entry ? 'method') then return false; end if;
        for observation in select key,value from jsonb_each(entry) loop
          observation_rule := recovery_rules->observation.key;
          if observation_rule is null or jsonb_typeof(observation.value) is distinct from observation_rule->>'type' then return false; end if;
          if observation_rule ? 'values' then
            if not (observation_rule->'values' @> jsonb_build_array(observation.value)) then return false; end if;
          elsif observation_rule->>'type' = 'number' then
            if (observation.value::text)::numeric < 0 or (observation.value::text)::numeric > (observation_rule->>'max')::numeric
              or trunc((observation.value::text)::numeric) <> (observation.value::text)::numeric then return false; end if;
          end if;
        end loop;
      end loop;
      if jsonb_array_length(public.merge_transfer_recovery_events('[]'::jsonb,item.value)) <> jsonb_array_length(item.value) then return false; end if;
$branch$;
begin
  original := replace(pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure),chr(13),'');
  old_rules := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  old_response_rules := substring(original from $pattern$summary_response_rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_response_rules is null or original like '%recovery_events%'
    or position('    elsif item.key = ''json_attempts'' then' in original) = 0 then raise exception 'Unexpected diagnosis validator'; end if;
  response_rules := jsonb_set(old_response_rules::jsonb,'{phase,values}', '["request"]'::jsonb || (old_response_rules::jsonb #> '{phase,values}'));
  response_rules := jsonb_set(response_rules,'{reason,values}', '["fetch_failed"]'::jsonb || (response_rules #> '{reason,values}'));
  updated := replace(original,quote_literal(old_rules),quote_literal((old_rules::jsonb || '{"recovery_events":{"type":"array"}}'::jsonb)::text));
  updated := replace(updated,quote_literal(old_response_rules),quote_literal(response_rules::text));
  updated := replace(updated,'  summary_response_rules constant jsonb := ',
    '  recovery_rules constant jsonb := ' || quote_literal(recovery_rules::text) || '::jsonb;' || chr(10) || '  summary_response_rules constant jsonb := ');
  updated := replace(updated,'    elsif item.key = ''json_attempts'' then',recovery_branch || '    elsif item.key = ''json_attempts'' then');
  execute updated;

  original := replace(pg_get_functiondef('public.protect_transfer_diagnostics()'::regprocedure),chr(13),'');
  updated := replace(original,'begin' || chr(10),'begin' || chr(10) || $preserve$  if old.diagnostics ? 'recovery_events' or new.diagnostics ? 'recovery_events' then
    new.diagnostics := coalesce(new.diagnostics,'{"version":1}'::jsonb) || jsonb_build_object('recovery_events',
      public.merge_transfer_recovery_events(old.diagnostics->'recovery_events',new.diagnostics->'recovery_events'));
  end if;
$preserve$);
  updated := replace(updated,
    'and (new.diagnostics - ''provider_failures'') is distinct from (old.diagnostics - ''provider_failures'') then',
    'and (new.diagnostics - ''provider_failures'' - ''recovery_events'') is distinct from (old.diagnostics - ''provider_failures'' - ''recovery_events'') then');
  if updated = original or updated not like '%old.diagnostics - ''provider_failures'' - ''recovery_events''%' then
    raise exception 'Unexpected terminal diagnosis guard'; end if;
  execute updated;

  select oid::regprocedure into strict rpc from pg_proc where pronamespace='public'::regnamespace and proname='record_transfer_event';
  original := replace(pg_get_functiondef(rpc),chr(13),'');
  updated := replace(original,'    diagnostics = case' || chr(10), '    diagnostics = case' || chr(10) || $merge$      when transfers.status <> 'started' and excluded.diagnostics ? 'recovery_events' then
        coalesce(transfers.diagnostics,'{"version":1}'::jsonb) || jsonb_build_object('recovery_events',
          public.merge_transfer_recovery_events(transfers.diagnostics->'recovery_events',excluded.diagnostics->'recovery_events'))
$merge$);
  updated := replace(updated,'    or (transfers.status = ''started'' and (excluded.status <> ''started''', $where$    or (excluded.diagnostics ? 'recovery_events' and
      public.merge_transfer_recovery_events(transfers.diagnostics->'recovery_events',excluded.diagnostics->'recovery_events')
        is distinct from coalesce(transfers.diagnostics->'recovery_events','[]'::jsonb))
    or (transfers.status = 'started' and (excluded.status <> 'started'$where$);
  if updated = original or updated not like '%is distinct from coalesce(transfers.diagnostics->''recovery_events''%' then
    raise exception 'Unexpected transfer report function'; end if;
  execute updated;
end;
$migration$;
commit;
