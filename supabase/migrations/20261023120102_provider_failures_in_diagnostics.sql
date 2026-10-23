-- Keep all transfer failure evidence in the existing diagnostics JSONB column.
-- Do not remove/recreate users or transfers, or change their columns/counters.
begin;

alter function public.is_valid_transfer_diagnostics(jsonb,integer) rename to is_valid_client_transfer_diagnostics;
create function public.is_valid_transfer_diagnostics(input jsonb, depth integer default 0)
returns boolean language plpgsql immutable security invoker set search_path = '' as $$
declare entry jsonb;
begin
  if input is null then return true; end if;
  if jsonb_typeof(input) <> 'object' then return false; end if;
  if input ? 'provider_failures' then
    if depth <> 0 or jsonb_typeof(input->'provider_failures') <> 'array'
      or octet_length(input::text) > 81920 then return false; end if;
    if jsonb_array_length(input->'provider_failures') > 64 then return false; end if;
    for entry in select value from jsonb_array_elements(input->'provider_failures') loop
      if not public.is_valid_provider_failure(entry) then return false; end if;
    end loop;
  end if;
  return public.is_valid_client_transfer_diagnostics(input - 'provider_failures',depth);
end;
$$;
revoke all on function public.is_valid_transfer_diagnostics(jsonb,integer) from public,anon,authenticated;
grant execute on function public.is_valid_transfer_diagnostics(jsonb,integer) to service_role;
-- Constraints retain the renamed function's identity, so bind this one to the
-- combined validator explicitly; no table/column is recreated.
alter table public.transfers drop constraint transfers_diagnostics_check;
alter table public.transfers add constraint transfers_diagnostics_check
  check (public.is_valid_transfer_diagnostics(diagnostics));

create or replace function public.protect_transfer_diagnostics() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- Client updates may enrich/replace their own snapshot, never the server log.
  if old.diagnostics ? 'provider_failures' and not coalesce(new.diagnostics ? 'provider_failures',false) then
    new.diagnostics := coalesce(new.diagnostics,'{"version":1}'::jsonb)
      || jsonb_build_object('provider_failures',old.diagnostics->'provider_failures');
  end if;
  if old.status <> 'started' and old.diagnostics is not null
    and (old.diagnostics - 'provider_failures' - 'version') <> '{}'::jsonb
    and (new.diagnostics - 'provider_failures') is distinct from (old.diagnostics - 'provider_failures') then
    raise exception using errcode = '23514', message = 'Terminal diagnostics are immutable';
  end if;
  return new;
end;
$$;

-- Preserve the exact existing RPC's outcome/receipt/counter behavior. A server
-- log alone must not consume the one allowed late client-diagnostics fill.
do $$
declare original text; updated text;
begin
  original := pg_get_functiondef('public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb)'::regprocedure);
  updated := replace(original,'if not public.is_valid_transfer_diagnostics(p_diagnostics) then',
    'if coalesce(p_diagnostics ? ''provider_failures'',false) or not public.is_valid_transfer_diagnostics(p_diagnostics) then');
  updated := replace(updated,'transfers.diagnostics is null',
    '(transfers.diagnostics is null or (transfers.diagnostics - ''provider_failures'' - ''version'') = ''{}''::jsonb)');
  if updated = original or updated not like '%coalesce(p_diagnostics ? ''provider_failures''%' then
    raise exception 'Unexpected transfer RPC definition';
  end if;
  execute updated;
end;
$$;

drop function public.record_provider_failure(jsonb) restrict;
create function public.record_provider_failure(p_event jsonb, p_context jsonb default null) returns void
language plpgsql security invoker set search_path = '' as $$
declare target public.transfers; entries jsonb;
begin
  if not public.is_valid_provider_failure(p_event) or not p_event ? 'attempt_id' then
    raise exception 'Invalid provider failure metadata' using errcode = '22023';
  end if;
  if p_context is not null then
    if p_context->>'attempt_id' is distinct from p_event->>'attempt_id' or p_context->>'status' is distinct from 'started'
      or p_context ?| array['summary_proof','summary_confirmed_at','provider_failures'] then
      raise exception 'Invalid transfer context' using errcode = '22023';
    end if;
    -- Same lock order as normal telemetry, including when the started event is
    -- still in the browser outbox. This creates only the actual supplied attempt.
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_context->>'install_id',0));
    if not exists(select 1 from public.transfers where attempt_id=(p_event->>'attempt_id')::uuid) then
      perform public.record_transfer_event((p_event->>'attempt_id')::uuid,p_context->>'install_id',
        (p_context->>'attempted_at')::timestamptz,p_context->>'source_platform',p_context->>'destination_platform',
        (p_context->>'character_count')::integer,'started','summary_request_started',null,p_context->>'extension_version');
    end if;
  end if;
  select * into target from public.transfers where attempt_id=(p_event->>'attempt_id')::uuid for update;
  if not found then raise exception 'Transfer not yet available' using errcode = 'P0002'; end if;
  if p_context is not null and row(target.install_id,target.attempted_at,target.source_platform,target.destination_platform,target.extension_version)
    is distinct from row(p_context->>'install_id',(p_context->>'attempted_at')::timestamptz,
      p_context->>'source_platform',p_context->>'destination_platform',p_context->>'extension_version') then
    raise exception 'Transfer identity mismatch' using errcode = '22023';
  end if;
  entries := coalesce(target.diagnostics->'provider_failures','[]'::jsonb);
  if not exists(select 1 from jsonb_array_elements(entries) e where e->>'id'=p_event->>'id') then
    if jsonb_array_length(entries) >= 64 then
      raise exception 'Provider diagnosis capacity reached' using errcode = '22023';
    end if;
    update public.transfers set diagnostics=coalesce(diagnostics,'{"version":1}'::jsonb)
      || jsonb_build_object('provider_failures',entries || jsonb_build_array(p_event))
      where attempt_id=target.attempt_id;
  end if;
end;
$$;
revoke all on function public.record_provider_failure(jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.record_provider_failure(jsonb,jsonb) to service_role;

-- Abort rather than silently discard any historical row that cannot be moved.
do $$
declare entry jsonb;
begin
  if exists(select 1 from public.provider_failures p where p.attempt_id is null
    or not exists(select 1 from public.transfers t where t.attempt_id=p.attempt_id)) then
    raise exception 'Unmatched provider failures must be resolved before removing the table';
  end if;
  for entry in select jsonb_strip_nulls(to_jsonb(p)) || jsonb_build_object('occurred_at',
    to_char(p.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    from public.provider_failures p order by p.occurred_at,p.id loop
    perform public.record_provider_failure(entry);
  end loop;
  perform cron.unschedule(jobid) from cron.job where jobname='prune-provider-failures';
end;
$$;
-- Only this owner-approved extra table is removed; RESTRICT prevents cascades.
drop table public.provider_failures restrict;
comment on column public.transfers.diagnostics is 'Bounded client observations plus private server provider_failures. Multiple errors per transfer; no conversation content, credentials or arbitrary errors.';
notify pgrst, 'reload schema';
commit;
