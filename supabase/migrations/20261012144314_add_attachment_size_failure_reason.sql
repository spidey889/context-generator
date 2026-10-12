begin;

-- Extend only the closed capture-detail enum, preserving the deployed validator
-- body and its existing grants. Never infer this cause from an older size_limit.
do $migration$
declare
  definition text := pg_get_functiondef('public.is_valid_transfer_diagnostics(jsonb,integer)'::regprocedure);
  previous_values text := '"attachment_failed","size_limit"';
begin
  if strpos(definition, previous_values) = 0 then
    raise exception 'Unexpected capture-detail validator definition';
  end if;
  execute replace(definition, previous_values, '"attachment_failed","attachment_size_limit","size_limit"');
end;
$migration$;

alter table public.transfers add column file_size_failure_reason text
generated always as (
  case when diagnostics->>'capture_detail' = 'attachment_size_limit'
    then 'Combined text files exceeded the 2.1 MB limit before download.'
    else null end
) stored;

comment on column public.transfers.file_size_failure_reason is
  'Exact JSON file-manifest rejection reported by the updated client. May remain populated after successful DOM recovery; status is the final transfer outcome. Older generic size failures stay NULL.';
notify pgrst, 'reload schema';
commit;
