-- Bounded post-ack retention observations use the existing recovery trail.
-- Preserve first-terminal outcomes, signed receipts, counters and private grants.
begin;
do $migration$
declare
  original text := replace(pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure),chr(13),'');
  old_rules text;
  new_rules constant jsonb := '{"event":{"type":"string","values":["box_shown","copy_started","copy_succeeded","copy_failed","copy_unconfirmed","retention_ok","retention_user_handled","retention_recovered","retention_failed","retention_unknown"]},"surface":{"type":"string","values":["dialog","handoff_copy","copy_notice","retention"]},"side":{"type":"string","values":["source","destination"]},"method":{"type":"string","values":["clipboard","native","manual_selection"]},"at_ms":{"type":"number","max":2147483647},"stop_confirmed":{"type":"boolean"},"reason":{"type":"string","values":["editor_missing","editor_detached","editor_has_draft","paste_not_retained","paste_not_populated","insertion_exception","message_timeout","conversation_changed","transfer_timeout","user_cancelled","unknown_error"]},"cause":{"type":"string","values":["user","page","extension","unknown"]}}'::jsonb;
  old_check constant text := $old$or (entry->>'event' <> 'box_shown' and not entry ? 'method') then return false; end if;$old$;
  new_check constant text := $new$or (entry->>'event' not like 'retention_%' and entry->>'event' <> 'box_shown' and not entry ? 'method')
          or (entry->>'event' not like 'retention_%' and (entry->>'surface' = 'retention' or entry ?| array['reason','cause']))
          or (entry->>'event' like 'retention_%' and (
            entry->>'surface' <> 'retention' or entry->>'side' <> 'destination' or entry ?| array['method','stop_confirmed']
            or (entry->>'event' = 'retention_failed' and (not entry ? 'reason' or coalesce(entry->>'cause','') not in ('page','extension')))
            or (entry->>'event' = 'retention_user_handled' and coalesce(entry->>'cause','') <> 'user')
            or (entry->>'event' = 'retention_unknown' and coalesce(entry->>'cause','') <> 'unknown')))
          then return false; end if;$new$;
  old_merge text;
  new_merge text;
begin
  old_rules := substring(original from $pattern$recovery_rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_rules::jsonb ? 'cause' or position(old_check in original)=0 then raise exception 'Unexpected recovery validator'; end if;
  execute replace(replace(original,quote_literal(old_rules),quote_literal(new_rules::text)),old_check,new_check);
  old_merge := pg_get_functiondef('public.merge_transfer_recovery_events(jsonb,jsonb)'::regprocedure);
  new_merge := replace(old_merge,$old$value->'stop_confirmed')$old$,$new$value->'stop_confirmed',value->'reason',value->'cause')$new$);
  if new_merge=old_merge then raise exception 'Unexpected recovery deduplication'; end if;
  execute new_merge;
end;
$migration$;
commit;
