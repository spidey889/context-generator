-- Keep only timing that affects identity, the users reset, or signed IST counts.
-- The deployed RPC signature stays stable, including ignored p_completed_at.
begin;
set local lock_timeout = '10s';
lock table public.transfers in access exclusive mode;

create or replace function public.record_transfer_event(
  p_attempt_id uuid, p_install_id text, p_attempted_at timestamptz,
  p_source_platform text, p_destination_platform text, p_character_count integer,
  p_status text, p_last_stage text, p_failure_reason text, p_extension_version text,
  p_summary_verified boolean default false, p_completed_at timestamptz default null,
  p_summary_confirmed_at timestamptz default null
) returns void language plpgsql security invoker set search_path = '' as $function$
declare
  stage_order constant text[] := array[
    'intent_started', 'capture_started', 'capture_completed', 'summary_request_started',
    'summary_response_started', 'summary_completed', 'paste_started', 'completed'
  ];
begin
  insert into public.transfers (
    attempt_id, install_id, attempted_at, source_platform, destination_platform,
    character_count, status, last_stage, failure_reason, extension_version,
    summary_verified, summary_confirmed_at
  ) values (
    p_attempt_id, p_install_id, p_attempted_at, p_source_platform, p_destination_platform,
    p_character_count, p_status, p_last_stage, p_failure_reason, p_extension_version,
    coalesce(p_summary_verified, false), p_summary_confirmed_at
  )
  on conflict (attempt_id) do update set
    -- Assign ownership so the guard also rejects racing mismatched first inserts.
    install_id = excluded.install_id,
    attempted_at = excluded.attempted_at,
    source_platform = excluded.source_platform,
    destination_platform = excluded.destination_platform,
    -- Retain the first observed version; upgraded workers may finish an attempt.
    character_count = case when transfers.status = 'started'
      then coalesce(excluded.character_count, transfers.character_count)
      else transfers.character_count end,
    status = case when transfers.status = 'started'
      then excluded.status else transfers.status end,
    failure_reason = case when transfers.status = 'started'
      then excluded.failure_reason else transfers.failure_reason end,
    last_stage = case
      when transfers.status <> 'started' then transfers.last_stage
      when excluded.status <> 'started' then excluded.last_stage
      when array_position(stage_order, excluded.last_stage) > array_position(stage_order, transfers.last_stage)
        then excluded.last_stage
      else transfers.last_stage end,
    summary_verified = transfers.summary_verified or excluded.summary_verified,
    summary_confirmed_at = case when not transfers.summary_verified
      then excluded.summary_confirmed_at else transfers.summary_confirmed_at end
  where
    row(transfers.install_id, transfers.attempted_at, transfers.source_platform,
      transfers.destination_platform)
      is distinct from row(excluded.install_id, excluded.attempted_at, excluded.source_platform,
      excluded.destination_platform)
    or (excluded.summary_verified and not transfers.summary_verified)
    or (transfers.status = 'started' and (
      excluded.status <> 'started'
      or array_position(stage_order, excluded.last_stage) > array_position(stage_order, transfers.last_stage)
      or (transfers.character_count is null and excluded.character_count is not null)
    ));
end;
$function$;

create or replace function public.preserve_transfer_event_invariants()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if tg_op = 'UPDATE' then
    if row(new.attempt_id, new.install_id, new.attempted_at,
      new.source_platform, new.destination_platform, new.extension_version, new.received_at)
      is distinct from row(old.attempt_id, old.install_id, old.attempted_at,
      old.source_platform, old.destination_platform, old.extension_version, old.received_at) then
      raise exception using errcode = '22023', message = 'Transfer attempt identity is immutable';
    end if;
    if old.status in ('succeeded', 'failed') and
      row(new.status, new.last_stage, new.failure_reason)
      is distinct from row(old.status, old.last_stage, old.failure_reason) then
      raise exception using errcode = '22023', message = 'The first terminal transfer outcome is immutable';
    end if;
    if old.summary_verified and
      row(new.summary_verified, new.summary_confirmed_at)
      is distinct from row(old.summary_verified, old.summary_confirmed_at) then
      raise exception using errcode = '22023', message = 'The first verified summary confirmation is immutable';
    end if;
  end if;
  return new;
end;
$function$;

-- Carry the frozen deployment cutoff forward, never reset it on migration replay.
do $migration$
declare
  reset_cutoff text := substring(
    pg_get_functiondef('public.record_user_summary()'::regprocedure)
    from $cutoff$new\.received_at < '([^']+)'::timestamptz$cutoff$);
begin
  if reset_cutoff is null then
    raise exception 'Cannot preserve the original users-reset cutoff';
  end if;
  execute format($definition$
create or replace function public.record_user_summary()
returns trigger language plpgsql security invoker set search_path = '' as $function$
declare
  today date;
  summary_delta integer := 0;
  failure_delta integer := 0;
  successful_today integer := 0;
  failed_today integer := 0;
begin
  if new.received_at < %L::timestamptz then return new; end if;
  if new.summary_verified and (tg_op = 'INSERT' or not old.summary_verified) then
    summary_delta := 1;
  end if;
  if new.status = 'failed' and new.failure_reason is distinct from 'no_conversation'
    and (tg_op = 'INSERT' or old.status <> 'failed') then
    failure_delta := 1;
  end if;
  if summary_delta = 0 and failure_delta = 0 then return new; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.install_id, 0));
  perform 1 from public.users u where u.install_id = new.install_id for update;
  if not found then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cap-context-users-allocation', 0));
  end if;
  today := (clock_timestamp() at time zone 'Asia/Kolkata')::date;
  if summary_delta = 1 then
    successful_today := case when (new.summary_confirmed_at at time zone 'Asia/Kolkata')::date = today then 1 else 0 end;
  end if;
  if failure_delta = 1 then
    -- The removed terminal receipt was assigned now(), the transaction start.
    -- Use that same stable time here. A wait across midnight must not move
    -- yesterday's failure into today's counters; today is sampled after locks.
    failed_today := case when (transaction_timestamp() at time zone 'Asia/Kolkata')::date = today then 1 else 0 end;
  end if;
  update public.users as u set
    lifetime_summaries = u.lifetime_summaries + summary_delta,
    today_summaries = case when u.today_date = today then u.today_summaries else 0 end + successful_today,
    today_failed_attempts = case when u.today_date = today then u.today_failed_attempts else 0 end + failed_today,
    today_date = today
  where u.install_id = new.install_id;
  if not found then
    insert into public.users (install_id, lifetime_summaries, today_summaries, today_failed_attempts, today_date)
    values (new.install_id, summary_delta, successful_today, failed_today, today);
  end if;
  return new;
end;
$function$;
$definition$, reset_cutoff);
end;
$migration$;

-- RESTRICT refuses unexpected views/dependencies. PostgreSQL removes only the
-- table's own checks on these columns; retained constraints/indexes stay intact.
alter table public.transfers
  drop column updated_at restrict,
  drop column completed_at restrict,
  drop column summary_received_at restrict,
  drop column terminal_received_at restrict;
comment on table public.transfers is 'One metadata-only row per transfer attempt. Thirteen fields; immutable attempt/reset identity, sticky first outcome and authenticated summary work. No transcript, summary text or URL.';
comment on function public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz) is 'Compatible metadata upsert. p_completed_at is accepted but ignored; first outcome and verification remain sticky.';
notify pgrst, 'reload schema';
commit;
