-- Add only the branch beta's pinned model to existing metadata contracts.
-- Preserve rows, counters, function identities, privileges and all old models.
begin;

do $migration$
declare
  original text; updated text; rules_text text; models_text text;
  model text := 'nvidia/nemotron-3.5-super-vl:free';
  anchor text := quote_literal('deepseek-v4.1-flash:free');
  rules jsonb; models jsonb;
begin
  original := pg_get_functiondef('public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb)'::regprocedure);
  updated := replace(original, anchor, anchor || ',' || quote_literal(model));
  if updated = original then raise exception 'Transfer model allowlist was not found'; end if;
  execute updated;

  select pg_get_constraintdef(oid) into strict original from pg_constraint
    where conrelid='public.transfers'::regclass and conname='transfers_model_attribution';
  updated := replace(original, anchor, anchor || ',' || quote_literal(model));
  if updated = original then raise exception 'Transfer model constraint was not found'; end if;
  alter table public.transfers drop constraint transfers_model_attribution;
  execute 'alter table public.transfers add constraint transfers_model_attribution ' || updated;

  original := pg_get_functiondef('public.is_valid_provider_failure(jsonb)'::regprocedure);
  rules_text := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  models_text := substring(original from $pattern$models constant jsonb := '([^']+)'::jsonb$pattern$);
  if rules_text is null or models_text is null then raise exception 'Provider model contracts were not found'; end if;
  rules := jsonb_set(rules_text::jsonb, '{model,values}', (rules_text::jsonb #> '{model,values}') || to_jsonb(model));
  models := jsonb_set(models_text::jsonb, '{openrouter}', (models_text::jsonb->'openrouter') || to_jsonb(model));
  execute replace(replace(original, quote_literal(rules_text), quote_literal(rules::text)),
    quote_literal(models_text), quote_literal(models::text));

  -- Provider failures now live in transfer diagnostics, validated by the
  -- function above. The historical provider_failures table was retired.
end;
$migration$;
commit;
