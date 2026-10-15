-- Shorten only the stored Dots label. Wire IDs remain unchanged for HMAC
-- verification, old workers and delayed receipts already in the outbox.
begin;
lock table public.transfers in share row exclusive mode;
do $migration$
declare
  original text;
  updated text;
  ling_guard constant text := 'if new.model = ''inclusionai/ling-3.1-flash'' then new.model := ''space bunny 2''; end if;';
  model_guard constant text := 'and new.model is distinct from old.model)';
begin
  original := pg_get_functiondef('public.preserve_transfer_event_invariants()'::regprocedure);
  updated := replace(original, ling_guard, ling_guard || E'\n  if new.model = ''dots-studio/dots-3-note-preview:free'' then new.model := ''dots (free)''; end if;');
  if updated = original then raise exception 'Serving model normalization was not found'; end if;
  original := updated;
  updated := replace(original, model_guard,
    'and new.model is distinct from (case when old.model = ''dots-studio/dots-3-note-preview:free'' then ''dots (free)'' else old.model end))');
  if updated = original then raise exception 'Immutable serving model guard was not found'; end if;
  execute updated;

  select pg_get_constraintdef(oid) into strict original from pg_constraint
    where conrelid = 'public.transfers'::regclass and conname = 'transfers_model_attribution';
  updated := replace(original, '(model = ''space bunny 2''::text)',
    '(model = ANY (ARRAY[''space bunny 2''::text, ''dots (free)''::text]))');
  if updated = original then raise exception 'Verified model label constraint was not found'; end if;
  original := updated;
  updated := replace(original, '''dots-studio/dots-3-note-preview:free''::text',
    '''dots-studio/dots-3-note-preview:free''::text, ''dots (free)''::text');
  if updated = original then raise exception 'Reported model label constraint was not found'; end if;
  alter table public.transfers drop constraint transfers_model_attribution;
  execute 'alter table public.transfers add constraint transfers_model_attribution ' || updated;
end;
$migration$;

-- The guard treats the provider ID and its label as one immutable model,
-- allowing this backfill without disabling triggers or replaying counters.
update public.transfers set model = 'dots (free)' where model = 'dots-studio/dots-3-note-preview:free';
comment on column public.transfers.model is 'Serving model from authenticated v3 attribution or a bounded client report; model_verified identifies authenticated attribution. Ling is stored as space bunny 2; Dots as dots (free). Other provider IDs and local-direct retain their names. NULL means unknown.';
notify pgrst, 'reload schema';
commit;
