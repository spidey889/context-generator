-- Display the current anonymous install identity directly in the Table Editor.
-- Keep these nullable: uncounted/reset installs need not have a users row.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

alter table public.transfers add column user_no bigint, add column username text;
alter table public.transfers add constraint transfers_user_labels_pair check (
  (user_no is null and username is null) or (user_no is not null and user_no > 0 and username is not null)
);

create function public.assign_transfer_user_labels() returns trigger
language plpgsql security invoker set search_path = '' as $function$
begin
  -- RPC retries enter via INSERT/ON CONFLICT. Serialize before they lock a
  -- transfer row, so first-user backfill cannot deadlock another attempt.
  if tg_op = 'INSERT' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.install_id, 0));
  end if;
  -- Ignore caller-supplied labels; install_id remains the association key.
  select u.user_no, u.name into new.user_no, new.username
  from public.users u where u.install_id = new.install_id;
  return new;
end;
$function$;

create trigger transfers_assign_user_labels before insert or update on public.transfers
for each row execute function public.assign_transfer_user_labels();

create function public.sync_transfer_user_labels() returns trigger
language plpgsql security invoker set search_path = '' as $function$
begin
  if tg_op = 'TRUNCATE' then
    update public.transfers set user_no = null, username = null where user_no is not null;
    return null;
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.install_id is distinct from new.install_id) then
    update public.transfers set user_no = null, username = null
    where install_id = old.install_id and user_no is not null;
  end if;
  if tg_op <> 'DELETE' then
    -- A counted transfer can create its users row in an AFTER trigger. Fill
    -- that transfer and earlier uncounted attempts without replaying counters.
    update public.transfers set user_no = new.user_no, username = new.name
    where install_id = new.install_id
      and row(user_no, username) is distinct from row(new.user_no, new.name);
  end if;
  return null;
end;
$function$;

create trigger users_sync_transfer_labels
-- Counter updates also fill an attempt that waited for concurrent allocation.
after insert or update or delete on public.users
for each row execute function public.sync_transfer_user_labels();
create trigger users_clear_transfer_labels after truncate on public.users
for each statement execute function public.sync_transfer_user_labels();

revoke all on function public.assign_transfer_user_labels(), public.sync_transfer_user_labels()
from public, anon, authenticated, service_role;

update public.transfers t set user_no = u.user_no, username = u.name
from public.users u where u.install_id = t.install_id;

comment on column public.transfers.user_no is 'Current anonymous user number joined by install_id; NULL without a matching users row. Not a person/account identity.';
comment on column public.transfers.username is 'Current cosmetic users.name label, synchronized on allocation/rename/reset; names may repeat.';
commit;
