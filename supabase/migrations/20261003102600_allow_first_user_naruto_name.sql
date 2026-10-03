-- The owner requested the exact lowercase name for the first installation only.
alter table public.users drop constraint users_name_in_pool;
alter table public.users add constraint users_name_in_pool
  check (name = any(public.naruto_user_names()) or (user_no = 1 and name = 'naruto'));
