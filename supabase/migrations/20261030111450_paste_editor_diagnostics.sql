-- Add only bounded metadata fields to the existing private diagnostics contract.
-- Keep tables, outcomes, counter/proof rules, permissions and old reports intact.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure);
  old_rules text;
  extra_rules jsonb;
begin
  old_rules := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_rules::jsonb ? 'editor_match_count' then
    raise exception 'Unexpected client diagnosis validator';
  end if;
  select jsonb_object_agg(key, '{"type":"number","max":2147483647}'::jsonb) into extra_rules
    from unnest(array['editor_match_count','editor_match_peak','editor_unmatched_count','editor_hidden_count',
      'editor_aria_hidden_count','editor_modal_count','editor_owned_count','editor_disabled_count',
      'editor_readonly_count','editor_not_editable_count','editor_ready_count']) as fields(key);
  extra_rules := extra_rules || '{"editor_retained":{"type":"boolean"},"editor_insert_attempted":{"type":"boolean"},"editor_document_focused":{"type":"boolean"}}'::jsonb;
  execute replace(original, quote_literal(old_rules), quote_literal((old_rules::jsonb || extra_rules)::text));
end;
$migration$;
commit;
