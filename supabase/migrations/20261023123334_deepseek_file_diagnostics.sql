-- Add bounded file-download evidence inside existing diagnostics.json_attempts.
-- Apply before deploying compatible relay/Edge validators and updated clients.
-- Existing rows, tables, columns, access, counters and server error entries stay intact.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure);
  previous_rules text;
  additional_rules constant jsonb := '{"failure_phase":{"type":"string","values":["fetch","headers","body","decode","parse"]},"failure_error_type":{"type":"string","values":["Error","TypeError","SyntaxError","RangeError","ReferenceError","AbortError","TimeoutError","SecurityError","NotAllowedError","NotFoundError","InvalidStateError","other","CaptureError"]},"failure_response_type":{"type":"string","values":["none","basic","cors","default","opaque","opaqueredirect","error","other"]},"failure_abort":{"type":"string","values":["none","capture_timeout","attachment_failed","other"]},"failure_online":{"type":"string","values":["online","offline","unknown"]},"failure_content_type":{"type":"string","values":["text","json","html","octet_stream","other","missing"]},"failure_read_bytes":{"type":"number","max":2147483647},"failure_request_ms":{"type":"number","max":2147483647},"failure_http_status":{"type":"number","min":100,"max":599},"failure_file_index":{"type":"number","min":1,"max":2147483647},"failure_file_bytes":{"type":"number","max":2100000}}'::jsonb;
begin
  previous_rules := substring(original from $pattern$attempt_rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if previous_rules is null then raise exception 'Unexpected client diagnosis validator'; end if;
  execute replace(original,quote_literal(previous_rules),quote_literal(((previous_rules::jsonb) || additional_rules)::text));
end;
$migration$;
commit;
