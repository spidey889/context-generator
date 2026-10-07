-- Keep the actual serving model visible for local/cache carries and successful
-- backend responses whose optional attribution/receipt was unavailable. Reports
-- remain diagnostics; only server receipts grant verification or summary counts.
begin;

alter table public.transfers add column model_verified boolean not null default false;
update public.transfers set model_verified = true where model is not null;
alter table public.transfers drop constraint transfers_model_verified;
alter table public.transfers add constraint transfers_model_attribution check (
  (model is null and not model_verified) or
  (model is not null and (
    (model_verified and summary_verified and summary_confirmed_at is not null
      and (model = 'space bunny 2' or model ~ '^[a-z0-9][a-z0-9._:/-]{0,159}$')) or
    (not model_verified and last_stage in ('summary_completed','paste_started','completed')
      and model in ('local-direct','gemini-3.6-flash','gemini-3.5-flash-lite','ministral-14b-2512',
        'space bunny 2','qwen/qwen3.8-27b:free','dots-studio/dots-3-note-preview:free','google/gemma-4-26b-a4b-it:free'))
  ))
);

create or replace function public.preserve_transfer_event_invariants()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if new.model = 'inclusionai/ling-3.1-flash' then new.model := 'space bunny 2'; end if;
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
    if old.summary_verified and row(new.summary_verified, new.summary_confirmed_at)
      is distinct from row(old.summary_verified, old.summary_confirmed_at) then
      raise exception using errcode = '22023', message = 'The first verified summary confirmation is immutable';
    end if;
    -- The first report is sticky, but a later authentic model may correct it.
    -- Once verified, neither a client report nor another receipt may replace it.
    if (old.model_verified and not new.model_verified) or
      (old.model is not null and (old.model_verified or not new.model_verified)
        and new.model is distinct from old.model) then
      raise exception using errcode = '22023', message = 'The first served model is immutable';
    end if;
  end if;
  return new;
end;
$function$;

-- One defaulted argument preserves all 10-14 argument callers. RESTRICT keeps
-- unexpected database dependents from disappearing during this replacement.
drop function public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text) restrict;
create function public.record_transfer_event(
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

revoke all on function public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text) from public,anon,authenticated,service_role;
grant execute on function public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text) to service_role;
comment on column public.transfers.model is 'Actual serving model, from a server receipt or bounded client report. model_verified distinguishes authenticated attribution; NULL means no model was reported.';
comment on column public.transfers.model_verified is 'True only for model-bound server attribution. Client reports never grant summary verification or increment summary counters.';
notify pgrst, 'reload schema';
commit;
