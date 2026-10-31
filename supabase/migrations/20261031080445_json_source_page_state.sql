-- Failure-time booleans inside existing JSON attempts; no page content or identifiers.
-- Deploy DB, Edge and Vercel validators before distributing this client.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure);
  old_rules text;
  extra_rules jsonb;
begin
  old_rules := substring(original from $pattern$attempt_rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_rules::jsonb ?| array['source_loading','source_auth_prompt','source_error_prompt','source_challenge_prompt'] then
    raise exception 'Unexpected JSON diagnosis validator';
  end if;
  select jsonb_object_agg(key, '{"type":"boolean"}'::jsonb) into extra_rules
    from unnest(array['source_loading','source_auth_prompt','source_error_prompt','source_challenge_prompt']) as fields(key);
  execute replace(original, quote_literal(old_rules), quote_literal((old_rules::jsonb || extra_rules)::text));
end;
$migration$;
commit;
