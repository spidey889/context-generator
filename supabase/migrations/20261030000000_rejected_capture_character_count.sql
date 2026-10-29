begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
lock table public.transfers in share row exclusive mode;

-- A rejected transcript still has a measured character length. Byte counts,
-- attachment allowances and observations from discarded attempts are not it.
create function public.rejected_capture_character_count(diagnostics jsonb)
returns integer language plpgsql immutable security invoker set search_path = '' as $function$
declare
  attempt jsonb;
  chars numeric;
begin
  if diagnostics->>'capture_detail' is distinct from 'size_limit'
    or jsonb_typeof(diagnostics->'json_attempts') is distinct from 'array' then return null; end if;
  attempt := diagnostics->'json_attempts'->-1;
  if attempt->>'outcome' is distinct from 'failed'
    or attempt->>'failure_stage' is distinct from 'serialize'
    or coalesce(attempt->>'failure_check','') not in ('transcript_char_limit','transcript_byte_limit')
    or jsonb_typeof(attempt->'transcript_chars') is distinct from 'number' then return null; end if;
  chars := (attempt->>'transcript_chars')::numeric;
  if chars < 1 or chars > 2147483647 or trunc(chars) <> chars then return null; end if;
  return chars::integer;
end;
$function$;
revoke all on function public.rejected_capture_character_count(jsonb) from public,anon,authenticated;
grant execute on function public.rejected_capture_character_count(jsonb) to service_role;

-- Normalize inside the existing trigger so older installed clients benefit
-- without a client/relay release. Never replace a count already reported.
do $migration$
declare
  definition text := replace(pg_get_functiondef('public.preserve_transfer_event_invariants()'::regprocedure),chr(13),'');
  size_guard text := $guard$
  if new.character_count is null and new.status = 'failed'
    and new.last_stage = 'capture_started' and new.failure_reason = 'conversation_too_large' then
    new.character_count := public.rejected_capture_character_count(new.diagnostics);
  end if;
$guard$;
begin
  if strpos(definition, E'\nbegin\n') = 0
    or strpos(definition, 'The first terminal transfer outcome is immutable') = 0
    or strpos(definition, 'rejected_capture_character_count') <> 0 then
    raise exception 'Unexpected transfer invariant definition';
  end if;
  execute replace(definition,E'\nbegin\n',E'\nbegin\n' || size_guard);
end;
$migration$;

-- Backfill only previously unknown counts with exact transcript-size evidence.
-- All guards/counter triggers stay enabled; status, model and diagnostics stay put.
update public.transfers set character_count = public.rejected_capture_character_count(diagnostics)
where character_count is null and status = 'failed' and last_stage = 'capture_started'
  and failure_reason = 'conversation_too_large'
  and public.rejected_capture_character_count(diagnostics) is not null;

comment on column public.transfers.character_count is
  'Measured transcript character length, including size-rejected captures when exact JSON diagnostics supply it. NULL means unknown; byte counts and attachment sizes are not character counts.';
commit;
