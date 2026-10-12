begin;

-- Rename only the handled draft outcome. Lock writers while translating old
-- rows, then restore terminal protection before making the new label visible.
lock table public.transfers in access exclusive mode;
alter table public.transfers disable trigger transfers_preserve_invariants;

do $migration$
declare
  definition text := pg_get_functiondef('public.preserve_transfer_event_invariants()'::regprocedure);
  outcome_check text := (select pg_get_constraintdef(oid) from pg_constraint
    where conrelid = 'public.transfers'::regclass and conname = 'transfers_outcome_consistent');
begin
  -- Keep deployed receipt/model rules and grants instead of replacing them
  -- with a possibly older checkout's function body.
  if (length(definition) - length(replace(definition, '''copy_ready''', ''))) / length('''copy_ready''') <> 2
    or outcome_check is null or strpos(outcome_check, '''copy_ready''') = 0 then
    raise exception 'Unexpected draft recovery definition';
  end if;
  execute replace(definition, '''copy_ready''', '''text_box''');
  alter table public.transfers drop constraint transfers_outcome_consistent;
  update public.transfers set status = 'text_box' where status = 'copy_ready';
  execute 'alter table public.transfers add constraint transfers_outcome_consistent '
    || replace(outcome_check, '''copy_ready''', '''text_box''');
end;
$migration$;

alter table public.transfers enable trigger transfers_preserve_invariants;
comment on column public.transfers.status is 'started/succeeded/failed/text_box. text_box means the destination text box contained text and a copy box was shown. It is handled recovery, not a successful paste or confirmed clipboard write. First terminal outcome is immutable.';
notify pgrst, 'reload schema';
commit;
