-- Preserve the signed provider ID at ingress; store its owner-selected label.
-- The exact Ling -> label rename represents the same serving model, not a
-- different attribution. Keep every other model/outcome/receipt immutable.
begin;

alter table public.transfers drop constraint transfers_model_verified;
alter table public.transfers add constraint transfers_model_verified check (
  model is null or (summary_verified and summary_confirmed_at is not null
    and (model = 'space bunny 2' or model ~ '^[a-z0-9][a-z0-9._:/-]{0,159}$'))
);

create or replace function public.preserve_transfer_event_invariants()
returns trigger language plpgsql security invoker set search_path = '' as $function$
begin
  if new.model = 'inclusionai/ling-3.1-flash' then
    new.model := 'space bunny 2';
  end if;
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
    if old.model is not null and new.model is distinct from
      (case when old.model = 'inclusionai/ling-3.1-flash' then 'space bunny 2' else old.model end) then
      raise exception using errcode = '22023', message = 'The first served model is immutable';
    end if;
  end if;
  return new;
end;
$function$;

update public.transfers set model = 'space bunny 2' where model = 'inclusionai/ling-3.1-flash';
comment on column public.transfers.model is 'Serving model authenticated by a v3 receipt. Ling is stored as space bunny 2; other provider IDs and local-direct retain their names. NULL means unknown.';
notify pgrst, 'reload schema';
commit;
