-- Avoid consuming users.user_no identity values for existing installations.
-- The per-install transaction lock also prevents two concurrent first successes
-- from both reaching the insert path for the same install_id.
create or replace function public.record_user_summary()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  today constant date := (now() at time zone 'utc')::date;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.install_id, 0)
  );

  update public.users as existing
  set
    total_summaries = existing.total_summaries + 1,
    today_summaries = case
      when existing.today_date = today then existing.today_summaries + 1
      else 1
    end,
    today_date = today
  where existing.install_id = new.install_id;

  if found then
    return new;
  end if;

  insert into public.users (install_id, total_summaries, today_summaries, today_date)
  values (new.install_id, 1, 1, today);

  return new;
end;
$$;
