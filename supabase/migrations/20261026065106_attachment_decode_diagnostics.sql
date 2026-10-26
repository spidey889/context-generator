-- Metadata only inside existing diagnostics: no new tables/columns or capture policy.
-- Roll out DB, Edge and Vercel validators before distributing the updated extension.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure);
  old_rules text;
  old_attempt_rules text;
  capture_rule jsonb;
  additional_rules constant jsonb := '{"failure_file_extension":{"type":"string","values":["txt","md","markdown","csv","json","py","js","ts","tsx","jsx","java","kt","swift","c","h","cpp","hpp","cs","go","rs","rb","php","sh","bash","zsh","lua","r","scala","dart","html","htm","css","scss","vue","svelte","xml","yaml","yml","toml","tsv","sql","ipynb","log","other"]},"failure_response_charset":{"type":"string","values":["utf8","utf16","utf16le","utf16be","utf32","utf32le","utf32be","latin1","windows1252","ascii","other","missing"]},"failure_body_hint":{"type":"string","values":["utf8_bom","utf16le_bom","utf16be_bom","utf32le_bom","utf32be_bom","utf16le_or_utf32le_bom","zip_signature","gzip_signature","pdf_signature","png_signature","jpeg_signature","gif_signature","ole_signature","unrecognized"]},"failure_decode_stage":{"type":"string","values":["chunk","final_flush"]}}'::jsonb;
begin
  old_rules := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  old_attempt_rules := substring(original from $pattern$attempt_rules constant jsonb := '([^']+)'::jsonb$pattern$);
  capture_rule := old_rules::jsonb -> 'capture_detail';
  if old_rules is null or old_attempt_rules is null or capture_rule ->> 'type' is distinct from 'string'
    or jsonb_typeof(capture_rule -> 'values') is distinct from 'array' then
    raise exception 'Unexpected client diagnosis validator';
  end if;
  -- Add the label without removing any existing labels or changing the validator body.
  if not (capture_rule -> 'values' @> '["invalid_utf8"]'::jsonb) then
    capture_rule := jsonb_set(capture_rule, '{values}', (capture_rule -> 'values') || '["invalid_utf8"]'::jsonb);
  end if;
  original := replace(original, quote_literal(old_rules),
    quote_literal(jsonb_set(old_rules::jsonb, '{capture_detail}', capture_rule)::text));
  execute replace(original, quote_literal(old_attempt_rules),
    quote_literal((old_attempt_rules::jsonb || additional_rules)::text));
end;
$migration$;
commit;
