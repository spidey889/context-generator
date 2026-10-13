begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
lock table public.transfers in access exclusive mode;

-- This is a stored reason only. Existing clients/relays continue reporting
-- conversation_too_large plus the exact attachment observation, with no UI change.
do $migration$
declare
  definition text := pg_get_constraintdef((select oid from pg_constraint
    where conrelid = 'public.transfers'::regclass and conname = 'transfers_failure_reason_check'));
begin
  if definition is null or strpos(definition, '''conversation_too_large''::text') = 0 then
    raise exception 'Unexpected transfer failure-reason constraint';
  end if;
  alter table public.transfers drop constraint transfers_failure_reason_check;
  execute 'alter table public.transfers add constraint transfers_failure_reason_check ' ||
    replace(definition, '''conversation_too_large''::text', '''conversation_too_large''::text, ''file_size_limit''::text');
end;
$migration$;

do $migration$
declare
  definition text := replace(pg_get_functiondef('public.preserve_transfer_event_invariants()'::regprocedure), E'\r\n', E'\n');
  file_guard text := $guard$
  -- Classify only a first failed outcome, never an earlier recovered capture
  -- error or a late diagnostic fill on an already-final attempt.
  if new.status = 'failed' and new.failure_reason = 'conversation_too_large'
    and new.diagnostics->>'capture_detail' = 'attachment_size_limit'
    and (tg_op = 'INSERT' or old.status = 'started') then
    new.failure_reason := 'file_size_limit';
  end if;
$guard$;
begin
  if strpos(definition, E'\nbegin\n') = 0
    or strpos(definition, 'The first terminal transfer outcome is immutable') = 0 then
    raise exception 'Unexpected transfer invariant definition';
  end if;
  execute replace(definition, E'\nbegin\n', E'\nbegin\n' || file_guard);
end;
$migration$;

-- BEFORE INSERT normalization also changes ON CONFLICT's excluded reason.
-- Keep a legacy terminal row's one allowed diagnostic fill compatible without
-- changing its final reason merely because that observation arrived late.
do $migration$
declare
  definition text := pg_get_functiondef('public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb)'::regprocedure);
  comparison text := 'transfers.failure_reason is not distinct from excluded.failure_reason';
  reverse_comparison text := 'excluded.failure_reason is not distinct from transfers.failure_reason';
  equivalent text := '(' || comparison ||
    ' or (transfers.failure_reason = ''conversation_too_large'' and excluded.failure_reason = ''file_size_limit''))';
begin
  if strpos(definition, comparison) = 0 or strpos(definition, reverse_comparison) = 0 then
    raise exception 'Unexpected transfer diagnostic-fill definition';
  end if;
  execute replace(replace(definition, comparison, equivalent), reverse_comparison, equivalent);
end;
$migration$;

-- Reclassify only failed rows with observed file-size evidence. The table lock
-- and transaction keep ingestion out while this one invariant is suspended;
-- counter/diagnostic triggers remain enabled, and the failure count is unchanged.
alter table public.transfers disable trigger transfers_preserve_invariants;
update public.transfers set failure_reason = 'file_size_limit'
where status = 'failed' and failure_reason = 'conversation_too_large'
  and diagnostics->>'capture_detail' = 'attachment_size_limit';
alter table public.transfers enable trigger transfers_preserve_invariants;

-- The original observation remains in diagnostics, including recovered errors.
alter table public.transfers drop column file_size_failure_reason restrict;
comment on column public.transfers.failure_reason is
  'Safe final failure code. file_size_limit means observed combined text-file allowance rejection; conversation_too_large retains other/unclassified size failures. Recovered capture causes remain in diagnostics.';
notify pgrst, 'reload schema';
commit;
