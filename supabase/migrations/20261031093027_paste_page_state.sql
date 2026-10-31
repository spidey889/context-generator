-- Native UI clues only; reuse existing diagnostics with no page labels/content.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure);
  old_rules text;
  extra_rules jsonb;
begin
  old_rules := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_rules::jsonb ? 'destination_loading' then raise exception 'Unexpected paste validator'; end if;
  select jsonb_object_agg(key, '{"type":"boolean"}'::jsonb) into extra_rules
    from unnest(array['destination_loading','destination_error_prompt','destination_challenge_prompt']) as fields(key);
  execute replace(original, quote_literal(old_rules), quote_literal((old_rules::jsonb || extra_rules)::text));
end;
$migration$;
commit;
