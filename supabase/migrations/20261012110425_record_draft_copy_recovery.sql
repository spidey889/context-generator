begin;

-- Recovery is acknowledged only AFTER a copy box was displayed. The existing
-- failed/paste_failed wire format remains compatible with installed relays.
-- Historic draft errors without this marker keep their original outcome.
alter table public.transfers drop constraint transfers_outcome_consistent;
alter table public.transfers add constraint transfers_outcome_consistent check (
  (status = 'started' and last_stage <> 'completed' and failure_reason is null)
  or (status = 'succeeded' and last_stage = 'completed' and failure_reason is null)
  or (status = 'failed' and last_stage <> 'completed' and failure_reason is not null)
  or (status = 'copy_ready' and last_stage = 'paste_started' and failure_reason is null and diagnostics is not null
    and diagnostics @> '{"error_code":"editor_has_draft","events":[{"event":"local_fallback","code":"editor_has_draft"}]}'::jsonb)
);

do $migration$
declare
  definition text := pg_get_functiondef('public.preserve_transfer_event_invariants()'::regprocedure);
  terminal_pattern text := $pattern$old\.status\s+in\s*\('succeeded'\s*,\s*'failed'\)$pattern$;
  recovery_guard text := $guard$
  if new.status = 'failed' and new.last_stage = 'paste_started' and new.failure_reason = 'paste_failed'
    and new.diagnostics @> '{"error_code":"editor_has_draft","events":[{"event":"local_fallback","code":"editor_has_draft"}]}'::jsonb then
    new.status := 'copy_ready';
    new.failure_reason := null;
  end if;
$guard$;
begin
  -- Preserve the deployed identity/model/receipt rules and function grants.
  -- Refuse an unexpected definition rather than silently bypassing invariants.
  definition := replace(definition, E'\r\n', E'\n');
  if definition !~ terminal_pattern or strpos(definition, E'\nbegin\n') = 0 then
    raise exception 'Unexpected transfer invariant definition';
  end if;
  definition := regexp_replace(definition, terminal_pattern, 'old.status in (''succeeded'', ''failed'', ''copy_ready'')');
  definition := replace(definition, E'\nbegin\n', E'\nbegin\n' || recovery_guard);
  execute definition;
end;
$migration$;

comment on column public.transfers.status is 'started/succeeded/failed/copy_ready. copy_ready means the text box contained text and a copy box was shown, not a successful paste or confirmed clipboard write. First terminal outcome is immutable.';
notify pgrst, 'reload schema';
commit;
