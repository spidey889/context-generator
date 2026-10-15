-- Accept the pinned DeepSeek free route while retaining paused Haiku receipts.
-- Expand the current definitions in place; preserve historical rows and grants.
begin;
do $migration$
declare
  original text;
  updated text;
  model_literal constant text := '''claude-haiku-5.5:free''';
begin
  original := pg_get_functiondef('public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb)'::regprocedure);
  updated := replace(original, model_literal, model_literal || ',''deepseek-v4.1-flash:free''');
  if updated = original then raise exception 'Reported model allowlist was not found'; end if;
  execute updated;

  select pg_get_constraintdef(oid) into strict original from pg_constraint
    where conrelid = 'public.transfers'::regclass and conname = 'transfers_model_attribution';
  updated := replace(original, model_literal, model_literal || ',''deepseek-v4.1-flash:free''');
  if updated = original then raise exception 'Reported model constraint was not found'; end if;
  alter table public.transfers drop constraint transfers_model_attribution;
  execute 'alter table public.transfers add constraint transfers_model_attribution ' || updated;
end;
$migration$;
commit;
