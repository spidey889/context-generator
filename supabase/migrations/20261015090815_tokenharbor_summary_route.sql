-- Add only the pinned never-billed Haiku route and fixed failure-provider label.
-- Preserve the current RPC/validator bodies, grants, counters and triggers instead
-- of replacing them with an older copied definition. No historical rows change.
begin;
do $migration$
declare
  signature text;
  original text;
  updated text;
  model_literal constant text := '''google/gemma-4-26b-a4b-it:free''';
begin
  signature := 'public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb)';
  original := pg_get_functiondef(signature::regprocedure);
  updated := replace(original, model_literal, model_literal || ',''claude-haiku-5.5:free''');
  if updated = original then raise exception 'Reported model allowlist was not found'; end if;
  execute updated;

  select pg_get_constraintdef(oid) into strict original from pg_constraint
    where conrelid = 'public.transfers'::regclass and conname = 'transfers_model_attribution';
  updated := replace(original, model_literal, model_literal || ',''claude-haiku-5.5:free''');
  if updated = original then raise exception 'Reported model constraint was not found'; end if;
  alter table public.transfers drop constraint transfers_model_attribution;
  execute 'alter table public.transfers add constraint transfers_model_attribution ' || updated;

  original := pg_get_functiondef('public.is_valid_transfer_diagnostics(jsonb,integer)'::regprocedure);
  updated := replace(original,
    '"summary_failed_provider":{"type":"string","values":["openrouter","gemini","mistral"]}',
    '"summary_failed_provider":{"type":"string","values":["tokenharbor","openrouter","gemini","mistral"]}');
  if updated = original then raise exception 'Summary provider diagnostics rule was not found'; end if;
  execute updated;
end;
$migration$;
commit;
