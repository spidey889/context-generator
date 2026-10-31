-- Closed blocked-write reasons; deploy compatible validators before updating clients.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure);
  old_rules text;
  extra_rules constant jsonb := '{"insertion_blocked_reason":{"type":"string","values":["detached","not_ready","focus_changed","draft_present"]}}'::jsonb;
begin
  old_rules := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_rules::jsonb ? 'insertion_blocked_reason' then raise exception 'Unexpected paste validator'; end if;
  execute replace(original, quote_literal(old_rules), quote_literal((old_rules::jsonb || extra_rules)::text));
end;
$migration$;
commit;
