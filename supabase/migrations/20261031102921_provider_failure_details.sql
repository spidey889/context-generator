-- Distinguish decoding, stream completeness and output-policy rejections.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_provider_failure(jsonb)'::regprocedure);
  old_rules text;
  extra_rules constant jsonb := '{"failure_detail":{"type":"string","values":["json_parse_failed","response_shape_invalid","utf8_decode_failed","stream_event_json_invalid","stream_event_shape_invalid","stream_incomplete","response_read_failed","empty_answer","empty_content","refusal_only","thinking_instead_of_summary","unfinished_thinking","upstream_error","safety_filter"]}}'::jsonb;
begin
  old_rules := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_rules::jsonb ? 'failure_detail' then raise exception 'Unexpected provider validator'; end if;
  execute replace(original,quote_literal(old_rules),quote_literal((old_rules::jsonb || extra_rules)::text));
end;
$migration$;
commit;
