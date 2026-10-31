-- Identify the original part/final request and exact strict-result rejection.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_provider_failure(jsonb)'::regprocedure);
  old_rules text;
  extra_rules constant jsonb := '{"summary_phase":{"type":"string","values":["part","final"]},"part_index":{"type":"number","min":0,"max":16},"part_total":{"type":"number","min":2,"max":16},"failure_detail":{"type":"string","values":["json_parse_failed","response_shape_invalid","utf8_decode_failed","stream_event_json_invalid","stream_event_shape_invalid","stream_incomplete","response_read_failed","empty_answer","empty_content","refusal_only","thinking_instead_of_summary","unfinished_thinking","upstream_error","safety_filter","large_model_mismatch","large_provider_mismatch","large_token_limit","large_empty_result","large_output_limit"]}}'::jsonb;
  anchor constant text := $old$  return (models->(input->>'provider') ? (input->>'model')) and$old$;
begin
  old_rules := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_rules::jsonb ? 'summary_phase' or position(anchor in original)=0 then raise exception 'Unexpected provider validator'; end if;
  original := replace(original,anchor,$new$  if input ?| array['summary_phase','part_index','part_total'] then
    if not input ?& array['summary_phase','part_index','part_total'] then return false; end if;
    if (input->>'summary_phase' = 'part' and (input->>'part_index')::integer >= (input->>'part_total')::integer)
      or (input->>'summary_phase' = 'final' and (input->>'part_index')::integer <> (input->>'part_total')::integer) then return false; end if;
  end if;
  return (models->(input->>'provider') ? (input->>'model')) and$new$);
  execute replace(original,quote_literal(old_rules),quote_literal((old_rules::jsonb || extra_rules)::text));
end;
$migration$;
commit;
