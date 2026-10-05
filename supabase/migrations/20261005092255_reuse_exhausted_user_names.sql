begin;

-- Cosmetic labels must never make a counted transfer fail. Installation keys
-- and user numbers remain unique; existing rows/names/counters stay unchanged.
alter table public.users drop constraint users_name_key;
create index users_name_idx on public.users (name);
create or replace function public.assign_user_identity() returns trigger
language plpgsql security invoker set search_path = '' as $identity$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('cap-context-users-allocation', 0));
  select coalesce(max(u.user_no), 0) + 1 into new.user_no from public.users u;
  select candidate into new.name
  from pg_catalog.unnest(public.naruto_user_names()) as pool(candidate)
  where not exists (select 1 from public.users u where u.name = candidate)
  order by pg_catalog.random() limit 1;
  if new.name is null then
    select candidate into new.name
    from pg_catalog.unnest(public.naruto_user_names()) as pool(candidate)
    order by pg_catalog.random() limit 1;
  end if;
  return new;
end;
$identity$;
comment on column public.users.name is 'Cosmetic Naruto label: prefer an unused pool name, then reuse one. install_id/user_no identify the user.';
notify pgrst, 'reload schema';
commit;
