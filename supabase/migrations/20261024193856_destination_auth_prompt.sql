-- One fixed boolean in the existing diagnosis; preserve rows, grants and RPCs.
begin;
do $$
declare original text; rules_text text; rules jsonb;
begin
  original := pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure);
  rules_text := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  rules := rules_text::jsonb;
  if rules is null or rules ? 'destination_auth_prompt' then
    raise exception 'Unexpected client diagnostics validator';
  end if;
  rules := rules || '{"destination_auth_prompt":{"type":"boolean"}}'::jsonb;
  execute replace(original, rules_text, rules::text);
end;
$$;
notify pgrst, 'reload schema';
commit;
