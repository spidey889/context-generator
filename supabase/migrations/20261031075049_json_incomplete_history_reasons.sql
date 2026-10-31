-- Add one closed reason field inside existing JSON diagnostics; preserve outcomes and grants.
-- Deploy DB, Edge and Vercel validators before distributing this client.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure);
  old_rules text;
  additional_rules constant jsonb := '{"incomplete_reason":{"type":"string","values":["completeness_metadata_invalid","conversation_mismatch","messages_missing","conversation_tree_missing","branch_leaf_missing","branch_parent_missing","no_usable_text","history_missing","gemini_rpc_response_invalid","gemini_frame_pairs_incomplete","gemini_frame_length_mismatch","gemini_frame_invalid","gemini_history_response_invalid","gemini_history_page_invalid","gemini_history_pages_remaining","gemini_pagination_stalled","gemini_parent_turn_invalid","gemini_parent_response_invalid","gemini_response_missing","gemini_selected_response_missing","grok_history_missing","grok_response_count_mismatch","grok_message_bodies_missing","grok_message_bodies_invalid","grok_message_body_mismatch","deepseek_conversation_unavailable","deepseek_snapshot_mismatch","deepseek_fragments_missing","skipped_file_notice_invalid","omitted_file_notice_invalid","capture_payload_invalid","capture_message_boundaries_invalid","metadata_truncated","metadata_is_truncated","metadata_partial","metadata_is_partial","metadata_incomplete","metadata_is_incomplete","metadata_has_more","metadata_has_more_messages","metadata_has_previous_page","metadata_has_next_page","metadata_has_missing_messages","metadata_missing_message_count","metadata_cut_off","metadata_complete","metadata_is_complete","metadata_next_cursor","metadata_previous_cursor","metadata_next_page","metadata_previous_page","metadata_missing_messages","metadata_missing_message_ids","metadata_missing_message_uuids","metadata_has_previous","metadata_has_next","metadata_has_missing_nodes","metadata_missing_node_count","metadata_missing_nodes","metadata_missing_node_ids","metadata_context_truncation_continuation","metadata_hasMore","metadata_hasNextPage","metadata_hasPreviousPage","metadata_isPartial","metadata_isIncomplete","metadata_isTruncated","metadata_missingMessages","metadata_nextCursor","metadata_previousCursor","metadata_isComplete"]}}'::jsonb;
begin
  old_rules := substring(original from $pattern$attempt_rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_rules::jsonb ? 'incomplete_reason' then
    raise exception 'Unexpected JSON diagnosis validator';
  end if;
  execute replace(original, quote_literal(old_rules), quote_literal((old_rules::jsonb || additional_rules)::text));
end;
$migration$;
commit;
