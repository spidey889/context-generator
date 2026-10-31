-- A skipped provider is selection evidence, never a fabricated HTTP attempt.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_provider_failure(jsonb)'::regprocedure);
  old_rules text;
  rules jsonb;
  anchor constant text := $old$  return (models->(input->>'provider') ? (input->>'model')) and$old$;
begin
  old_rules := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_rules::jsonb ? 'skip_reason' or position(anchor in original)=0 then raise exception 'Unexpected provider validator'; end if;
  rules := old_rules::jsonb || '{"skip_reason":{"type":"string","values":["missing_key","route_budget_exhausted","funded_budget_refused","disabled","account_unavailable","credential_cooldown"]}}'::jsonb;
  rules := jsonb_set(rules,'{failure_reason,values}',(rules#>'{failure_reason,values}') || '"provider_skipped"'::jsonb);
  rules := jsonb_set(rules,'{phase,values}',(rules#>'{phase,values}') || '"route_selection"'::jsonb);
  rules := jsonb_set(jsonb_set(jsonb_set(rules,'{request_attempt,min}','0'),'{max_output_tokens,min}','0'),'{budget_ms,min}','0');
  original := replace(original,anchor,$new$  if input->>'failure_reason' = 'provider_skipped' then
    if input->>'phase' <> 'route_selection' or not input ? 'skip_reason' or (input->>'request_attempt')::integer <> 0
      or (input->>'request_bytes')::integer <> 0 or (input->>'max_output_tokens')::integer <> 0
      or (input->>'budget_ms')::integer <> 0 or (input->>'elapsed_ms')::integer <> 0 then return false; end if;
  elsif input ? 'skip_reason' or input->>'phase' = 'route_selection' or (input->>'request_attempt')::integer < 1
    or (input->>'max_output_tokens')::integer < 1 or (input->>'budget_ms')::integer < 1 then return false;
  end if;
  return (models->(input->>'provider') ? (input->>'model')) and$new$);
  execute replace(original,quote_literal(old_rules),quote_literal(rules::text));
end;
$migration$;
commit;
