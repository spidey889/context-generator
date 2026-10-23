-- Align fixed metadata validators with the larger transcript/file allowances.
-- Preserve existing function identities, grants, transfer rows and counters.
begin;
do $$
declare original text; updated text; rules_text text; rules jsonb;
begin
  original := pg_get_functiondef('public.is_valid_provider_failure(jsonb)'::regprocedure);
  rules_text := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  rules := rules_text::jsonb;
  if rules #>> '{input_chars,max}' is distinct from '350000' then
    raise exception 'Unexpected provider failure validator';
  end if;
  updated := replace(original, rules_text, jsonb_set(rules, '{input_chars,max}', '1000000'::jsonb)::text);
  execute updated;

  original := pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure);
  -- Earlier additive migrations canonicalized this JSONB literal. Read the
  -- rule rather than depending on its key ordering or whitespace.
  rules_text := substring(original from $pattern$attempt_rules constant jsonb := '([^']+)'::jsonb$pattern$);
  rules := rules_text::jsonb;
  if rules #>> '{failure_file_bytes,max}' is distinct from '2100000' then
    raise exception 'Unexpected client diagnostics validator';
  end if;
  updated := replace(original, rules_text, jsonb_set(rules, '{failure_file_bytes,max}', '4100000'::jsonb)::text);
  execute updated;
end;
$$;
notify pgrst, 'reload schema';
commit;
