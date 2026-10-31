-- Coarse Vercel location belongs to the existing transfer diagnosis only.
-- No backfill, table/column, permission, outcome or counter changes.
begin;
do $migration$
declare
  original text;
  updated text;
  rpc regprocedure;
  anchor constant text := $old$  return public.is_valid_client_transfer_diagnostics(input - 'provider_failures',depth);$old$;
begin
  original := replace(pg_get_functiondef('public.is_valid_transfer_diagnostics(jsonb,integer)'::regprocedure),chr(13),'');
  if position(anchor in original)=0 then raise exception 'Unexpected diagnostics validator'; end if;
  updated := replace(original,anchor,$new$  if input ? 'location' then
    if depth <> 0 or jsonb_typeof(input->'location') <> 'object' then return false; end if;
    if not (input->'location') ?& array['country','region','city']
      or ((input->'location') - 'country' - 'region' - 'city') <> '{}'::jsonb then return false; end if;
    if jsonb_typeof(input#>'{location,country}') <> 'string' or jsonb_typeof(input#>'{location,region}') <> 'string'
      or jsonb_typeof(input#>'{location,city}') <> 'string' then return false; end if;
    if (input#>>'{location,country}') !~ '^(unknown|[A-Z]{2})$'
      or (input#>>'{location,region}') !~ '^(unknown|[A-Z0-9]{1,3})$'
      or char_length(input#>>'{location,city}') > 80
      or (input#>>'{location,city}') !~ '[[:alpha:]]'
      or (input#>>'{location,city}') ~ '[[:cntrl:]<>@:/\\{}\[\]%?#&=]'
      or (input#>>'{location,city}') ~ '[0-9]+[.][0-9]+' then return false; end if;
  end if;
  return public.is_valid_client_transfer_diagnostics(input - 'provider_failures' - 'location',depth);$new$);
  execute updated;

  original := replace(pg_get_functiondef('public.protect_transfer_diagnostics()'::regprocedure),chr(13),'');
  if position('begin' || chr(10) in original)=0 or original like '%''location''%' then raise exception 'Unexpected diagnosis trigger'; end if;
  -- Keep the first request's location through sparse reports and retries.
  updated := replace(original,'begin' || chr(10),'begin' || chr(10) || $preserve$  if old.diagnostics ? 'location' then
    new.diagnostics := coalesce(new.diagnostics,'{"version":1}'::jsonb)
      || jsonb_build_object('location',old.diagnostics->'location');
  end if;
$preserve$);
  updated := replace(updated,'- ''provider_failures''','- ''provider_failures'' - ''location''');
  execute updated;

  select oid::regprocedure into strict rpc from pg_proc where pronamespace='public'::regnamespace and proname='record_transfer_event';
  original := pg_get_functiondef(rpc);
  -- A server-only location must not consume the one late client snapshot fill.
  updated := replace(original,'transfers.diagnostics - ''provider_failures''',
    'transfers.diagnostics - ''provider_failures'' - ''location''');
  if updated=original then raise exception 'Unexpected transfer RPC'; end if;
  execute updated;
end;
$migration$;
commit;
