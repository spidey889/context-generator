begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

create table public.user_notices (
  user_no bigint primary key references public.users(user_no) on delete cascade,
  message text not null,
  -- Count supplementary Unicode characters twice, matching the client's UTF-16 limit.
  constraint user_notices_message_valid check (
    char_length(regexp_replace(message, U&'[\+010000-\+10FFFF]', 'xx', 'g')) between 1 and 1000
    and message ~ '[^[:space:]]'
  )
);
alter table public.user_notices enable row level security;
revoke all on table public.user_notices from public, anon, authenticated, service_role;
grant select on table public.user_notices to service_role;
comment on table public.user_notices is
  'One current notice per existing user number. Operators upsert messages; only the private Edge relay reads them. IDs and seen history stay client-compatible.';

commit;
