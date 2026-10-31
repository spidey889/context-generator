-- Add only closed safe error fields; provider bodies/messages never persist.
-- Deploy compatible DB/Edge validators before the backend rollout.
begin;
do $migration$
declare
  original text := pg_get_functiondef('public.is_valid_provider_failure(jsonb)'::regprocedure);
  old_rules text;
  extra_rules constant jsonb := '{"upstream_code":{"type":"string","values":["400","401","402","403","404","408","413","422","429","500","502","503","504","529","INVALID_ARGUMENT","UNAUTHENTICATED","PERMISSION_DENIED","NOT_FOUND","RESOURCE_EXHAUSTED","FAILED_PRECONDITION","INTERNAL","UNAVAILABLE","DEADLINE_EXCEEDED"]},"upstream_type":{"type":"string","values":["rate_limit_error","insufficient_quota","invalid_api_key","authentication_error","insufficient_credits","permission_error","invalid_request_error","context_length_exceeded","server_error","overloaded_error","content_filter","safety","RESOURCE_EXHAUSTED","UNAUTHENTICATED","PERMISSION_DENIED","INVALID_ARGUMENT","INTERNAL","UNAVAILABLE","DEADLINE_EXCEEDED"]},"upstream_message":{"type":"string","values":["Rate limit exceeded.","Quota exhausted.","Authentication failed.","Insufficient credits.","Request blocked by safety policy.","Context length exceeded.","Provider unavailable.","Provider returned an error."]},"retry_after_ms":{"type":"number","min":0,"max":86400000}}'::jsonb;
begin
  old_rules := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  if old_rules is null or old_rules::jsonb ? 'upstream_code' then raise exception 'Unexpected provider validator'; end if;
  execute replace(original,quote_literal(old_rules),quote_literal((old_rules::jsonb || extra_rules)::text));
end;
$migration$;
commit;
