-- Keep bounded provider correlation tokens and recognized HTTP-200 error types.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_provider_failure(jsonb)'::regprocedure);
  old_rules text;
  extra_rules constant jsonb := '{"upstream_request_id":{"type":"string","pattern":"^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"},"upstream_type":{"type":"string","values":["rate_limit_error","insufficient_quota","invalid_api_key","authentication_error","insufficient_credits","permission_error","invalid_request_error","context_length_exceeded","server_error","overloaded_error","content_filter","safety","generation_error","RESOURCE_EXHAUSTED","UNAUTHENTICATED","PERMISSION_DENIED","INVALID_ARGUMENT","INTERNAL","UNAVAILABLE","DEADLINE_EXCEEDED"]}}'::jsonb;
  anchor constant text := $old$      if rule->>'type' = 'uuid'$old$;
begin
  old_rules := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_rules::jsonb ? 'upstream_request_id' or position(anchor in original)=0 then raise exception 'Unexpected provider validator'; end if;
  original := replace(original,anchor,$new$      if rule ? 'pattern' and (item.value #>> '{}') !~ (rule->>'pattern') then return false; end if;
      if rule->>'type' = 'uuid'$new$);
  execute replace(original,quote_literal(old_rules),quote_literal((old_rules::jsonb || extra_rules)::text));
end;
$migration$;
commit;
