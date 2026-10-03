-- Add authenticated served-model metadata immediately after character_count.
-- Column order requires a copy/swap; never replay copied rows through counters.
begin;
set local lock_timeout = '10s';
lock table public.transfers in access exclusive mode;

do $reorder$
declare
  source_oid oid := 'public.transfers'::regclass;
  source_owner text;
  table_note text := obj_description(source_oid, 'pg_class');
  columns_sql text := '';
  names_sql text := '';
  constraints_sql text[];
  indexes_sql text[];
  triggers_sql text[];
  column_notes jsonb;
  item record;
  definition text;
begin
  -- Refuse unexpected schema/dependencies instead of silently losing them.
  if (select array_agg(attname::text order by attnum) from pg_attribute
      where attrelid=source_oid and attnum>0 and not attisdropped) is distinct from array[
      'attempt_id','install_id','attempted_at','received_at','source_platform',
      'destination_platform','character_count','status','failure_reason',
      'extension_version','last_stage','summary_verified','summary_confirmed_at'] then
    raise exception 'Unexpected transfers columns; review model migration';
  end if;
  if exists(select 1 from pg_policy where polrelid=source_oid)
    or exists(select 1 from pg_publication_rel where prrelid=source_oid)
    or exists(select 1 from pg_inherits where inhrelid=source_oid or inhparent=source_oid)
    or exists(select 1 from pg_trigger where tgrelid=source_oid and not tgisinternal and tgenabled<>'O')
    or exists(select 1 from pg_class where oid=source_oid and
      (not relrowsecurity or relforcerowsecurity or relreplident<>'d' or reloptions is not null)) then
    raise exception 'Unexpected transfers policies/publication/storage/trigger state';
  end if;
  select pg_get_userbyid(relowner) into source_owner from pg_class where oid=source_oid;
  select jsonb_object_agg(attname, col_description(attrelid, attnum)) into column_notes
    from pg_attribute where attrelid=source_oid and attnum>0 and not attisdropped;
  select array_agg(format('alter table public.transfers add constraint %I %s', conname, pg_get_constraintdef(oid)))
    into constraints_sql from pg_constraint where conrelid=source_oid and contype<>'n';
  select array_agg(pg_get_indexdef(indexrelid)) into indexes_sql from pg_index
    where indrelid=source_oid and not exists(select 1 from pg_constraint where conindid=indexrelid);
  select array_agg(pg_get_triggerdef(oid)) into triggers_sql from pg_trigger
    where tgrelid=source_oid and not tgisinternal;
  for item in select a.attname, format_type(a.atttypid,a.atttypmod) as type,
      a.attnotnull, pg_get_expr(d.adbin,d.adrelid) as default_sql,
      (select conname from pg_constraint where conrelid=source_oid and contype='n'
        and conkey=array[a.attnum]) as null_constraint
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=source_oid and a.attnum>0 and not a.attisdropped order by a.attnum loop
    columns_sql := columns_sql || case when columns_sql='' then '' else ',' end
      || format('%I %s%s%s',item.attname,item.type,
        -- PG18 catalogs named NOT NULL checks; older hosted PG uses attnotnull.
        case when not item.attnotnull then '' when item.null_constraint is null then ' not null'
          else format(' constraint %I not null',item.null_constraint) end,
        case when item.default_sql is null then '' else ' default ' || item.default_sql end);
    names_sql := names_sql || case when names_sql='' then '' else ',' end || format('%I',item.attname);
    if item.attname='character_count' then columns_sql := columns_sql || ',model text'; end if;
  end loop;
  execute 'create table public.transfers_model (' || columns_sql || ')';
  execute 'insert into public.transfers_model (' || names_sql || ') select ' || names_sql || ' from public.transfers';
  if (select count(*) from public.transfers_model) <> (select count(*) from public.transfers) then
    raise exception 'Transfer copy count mismatch';
  end if;
  -- RESTRICT also refuses incoming FKs, views and composite-type dependencies.
  drop table public.transfers restrict;
  alter table public.transfers_model rename to transfers;
  foreach definition in array constraints_sql loop execute definition; end loop;
  foreach definition in array indexes_sql loop execute definition; end loop;
  foreach definition in array triggers_sql loop execute definition; end loop;
  execute format('alter table public.transfers owner to %I',source_owner);
  alter table public.transfers enable row level security;
  revoke all on public.transfers from public, anon, authenticated, service_role;
  grant select, insert, update on public.transfers to service_role;
  execute format('comment on table public.transfers is %L',table_note);
  for item in select * from jsonb_each_text(column_notes) loop
    execute format('comment on column public.transfers.%I is %L',item.key,item.value);
  end loop;
end;
$reorder$;

alter table public.transfers add constraint transfers_model_verified check (
  model is null or (summary_verified and summary_confirmed_at is not null
    and model ~ '^[a-z0-9][a-z0-9._:/-]{0,159}$')
);
comment on column public.transfers.model is 'Canonical served model authenticated by a v3 server receipt, including local-direct. NULL for unknown legacy/pre-summary attempts; never infer from route or date.';
comment on table public.transfers is 'One metadata-only row per attempt. Fourteen fields; immutable identity, sticky outcome and authenticated summary/model. No transcript, summary text or URL.';

-- Replace the old signature, not an ambiguous overload. Appending a default
-- preserves positional/named callers with 10 through 13 arguments. RESTRICT
-- refuses unexpected function dependents; revoke inherited public execution.
drop function public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz) restrict;
create function public.record_transfer_event(
  p_attempt_id uuid, p_install_id text, p_attempted_at timestamptz,
  p_source_platform text, p_destination_platform text, p_character_count integer,
  p_status text, p_last_stage text, p_failure_reason text, p_extension_version text,
  p_summary_verified boolean default false, p_completed_at timestamptz default null,
  p_summary_confirmed_at timestamptz default null, p_model text default null
) returns void language plpgsql security invoker set search_path = '' as $function$
declare
  stage_order constant text[] := array[
    'intent_started', 'capture_started', 'capture_completed', 'summary_request_started',
    'summary_response_started', 'summary_completed', 'paste_started', 'completed'
  ];
begin
  insert into public.transfers (
    attempt_id, install_id, attempted_at, source_platform, destination_platform,
    character_count, model, status, last_stage, failure_reason, extension_version,
    summary_verified, summary_confirmed_at
  ) values (
    p_attempt_id, p_install_id, p_attempted_at, p_source_platform, p_destination_platform,
    p_character_count, p_model, p_status, p_last_stage, p_failure_reason, p_extension_version,
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
    -- First model is sticky. A v3 receipt can fill a v2 row only when it
    -- authenticates that exact first completion, never a later regeneration.
    model = case when transfers.model is null and excluded.model is not null
      and (not transfers.summary_verified
        or transfers.summary_confirmed_at = excluded.summary_confirmed_at)
      then excluded.model else transfers.model end,
    summary_verified = transfers.summary_verified or excluded.summary_verified,
    summary_confirmed_at = case when not transfers.summary_verified
      then excluded.summary_confirmed_at else transfers.summary_confirmed_at end
  where
    row(transfers.install_id, transfers.attempted_at, transfers.source_platform,
      transfers.destination_platform)
      is distinct from row(excluded.install_id, excluded.attempted_at, excluded.source_platform,
      excluded.destination_platform)
    or (excluded.summary_verified and not transfers.summary_verified)
    or (transfers.model is null and excluded.model is not null
      and transfers.summary_confirmed_at = excluded.summary_confirmed_at)
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
  if tg_op = 'UPDATE' and old.model is not null and new.model is distinct from old.model then
    raise exception using errcode = '22023', message = 'The first served model is immutable';
  end if;
  return new;
end;
$function$;

revoke all on function public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text) from public, anon, authenticated, service_role;
grant execute on function public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text) to service_role;
comment on function public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text) is 'Compatible metadata upsert with optional authenticated served model. Legacy completed_at remains ignored; first outcome/confirmation/model are sticky.';
notify pgrst, 'reload schema';
commit;
