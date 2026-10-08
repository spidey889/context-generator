-- Allocate anonymous identities independently of verified-summary/failure
-- accounting, including local carries, empty attempts and interrupted work.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';
lock table public.transfers, public.users in share row exclusive mode;

create or replace function public.record_transfer_event(
  p_attempt_id uuid, p_install_id text, p_attempted_at timestamptz,
  p_source_platform text, p_destination_platform text, p_character_count integer,
  p_status text, p_last_stage text, p_failure_reason text, p_extension_version text,
  p_summary_verified boolean default false, p_completed_at timestamptz default null,
  p_summary_confirmed_at timestamptz default null, p_model text default null,
  p_reported_model text default null
) returns void language plpgsql security invoker set search_path = '' as $function$
declare
  stage_order constant text[] := array['intent_started','capture_started','capture_completed',
    'summary_request_started','summary_response_started','summary_completed','paste_started','completed'];
begin
  if p_reported_model is not null and (p_last_stage not in ('summary_completed','paste_started','completed')
    or p_reported_model not in ('local-direct','gemini-3.6-flash','gemini-3.5-flash-lite','ministral-14b-2512',
      'inclusionai/ling-3.1-flash','qwen/qwen3.8-27b:free','dots-studio/dots-3-note-preview:free','google/gemma-4-26b-a4b-it:free')) then
    raise exception using errcode = '23514', message = 'Invalid reported model';
  end if;
  -- Allocate before the UPSERT: users' label backfill must finish before
  -- ON CONFLICT touches a retried transfer, including after user deletion/reset.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_install_id, 0));
  if not exists (select 1 from public.users u where u.install_id = p_install_id) then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cap-context-users-allocation', 0));
    insert into public.users (install_id, today_date)
    values (p_install_id, (clock_timestamp() at time zone 'Asia/Kolkata')::date)
    on conflict (install_id) do nothing;
  end if;
  insert into public.transfers (
    attempt_id,install_id,attempted_at,source_platform,destination_platform,
    character_count,model,status,last_stage,failure_reason,extension_version,
    summary_verified,summary_confirmed_at,model_verified
  ) values (
    p_attempt_id,p_install_id,p_attempted_at,p_source_platform,p_destination_platform,
    p_character_count,coalesce(p_model,p_reported_model),p_status,p_last_stage,p_failure_reason,p_extension_version,
    coalesce(p_summary_verified,false),p_summary_confirmed_at,p_model is not null
  ) on conflict (attempt_id) do update set
    install_id = excluded.install_id,
    attempted_at = excluded.attempted_at,
    source_platform = excluded.source_platform,
    destination_platform = excluded.destination_platform,
    character_count = case when transfers.status = 'started'
      then coalesce(excluded.character_count,transfers.character_count) else transfers.character_count end,
    status = case when transfers.status = 'started' then excluded.status else transfers.status end,
    failure_reason = case when transfers.status = 'started' then excluded.failure_reason else transfers.failure_reason end,
    last_stage = case when transfers.status <> 'started' then transfers.last_stage
      when excluded.status <> 'started' then excluded.last_stage
      when array_position(stage_order,excluded.last_stage) > array_position(stage_order,transfers.last_stage)
        then excluded.last_stage else transfers.last_stage end,
    model = case
      when excluded.model_verified and not transfers.model_verified
        and (not transfers.summary_verified or transfers.summary_confirmed_at = excluded.summary_confirmed_at)
        then excluded.model
      when transfers.model is null and not excluded.model_verified then excluded.model
      else transfers.model end,
    model_verified = transfers.model_verified or (excluded.model_verified
      and (not transfers.summary_verified or transfers.summary_confirmed_at = excluded.summary_confirmed_at)),
    summary_verified = transfers.summary_verified or excluded.summary_verified,
    summary_confirmed_at = case when not transfers.summary_verified
      then excluded.summary_confirmed_at else transfers.summary_confirmed_at end
  where row(transfers.install_id,transfers.attempted_at,transfers.source_platform,transfers.destination_platform)
      is distinct from row(excluded.install_id,excluded.attempted_at,excluded.source_platform,excluded.destination_platform)
    or (excluded.summary_verified and not transfers.summary_verified)
    or (excluded.model_verified and not transfers.model_verified
      and (not transfers.summary_verified or transfers.summary_confirmed_at = excluded.summary_confirmed_at))
    or (transfers.model is null and excluded.model is not null and not excluded.model_verified)
    or (transfers.status = 'started' and (excluded.status <> 'started'
      or array_position(stage_order,excluded.last_stage) > array_position(stage_order,transfers.last_stage)
      or (transfers.character_count is null and excluded.character_count is not null)));
end;
$function$;


-- Existing unsigned successes and incomplete attempts need identities too.
-- Preserve all outcome/proof fields and counters; never replay old accounting.
do $backfill$
declare missing record;
begin
  for missing in
    select t.install_id from public.transfers t
    where not exists (select 1 from public.users u where u.install_id = t.install_id)
    group by t.install_id order by min(t.attempted_at), t.install_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(missing.install_id, 0));
    insert into public.users (install_id, today_date)
    values (missing.install_id, (clock_timestamp() at time zone 'Asia/Kolkata')::date)
    on conflict (install_id) do nothing;
  end loop;
end;
$backfill$;

commit;
