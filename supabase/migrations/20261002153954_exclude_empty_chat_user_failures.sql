-- Empty chats remain operational diagnostics, not user failures/activity.
begin;
set local lock_timeout = '10s';
lock table public.transfer_events in share row exclusive mode;
lock table public.users in access exclusive mode;
do $exclude$
declare
  counter_sql text := pg_get_functiondef('public.record_user_summary()'::regprocedure);
  usage_sql text := pg_get_viewdef('public.user_summary_usage'::regclass, true);
  cutoff text;
  old_condition text := 'if new.status = ''failed'' and (tg_op';
begin
  cutoff := (regexp_match(counter_sql, $pattern$new.received_at < '([^']+)'::timestamptz$pattern$))[1];
  if cutoff is null or position(old_condition in counter_sql)=0 then
    raise exception 'Unexpected users counter definition; preserve original reset cutoff';
  end if;
  execute replace(counter_sql, old_condition,
    'if new.status = ''failed'' and new.failure_reason is distinct from ''no_conversation'' and (tg_op');
  -- Keep the service reporting aliases and reset scope, excluding empty chats
  -- from the user failure metric while raw event history remains complete.
  if position('e.status = ''failed''::text' in usage_sql)=0 then
    raise exception 'Unexpected users failure reporting definition';
  end if;
  execute 'create or replace view public.user_summary_usage with (security_invoker=true) as ' ||
    replace(usage_sql, 'e.status = ''failed''::text',
      'e.status = ''failed''::text AND e.failure_reason IS DISTINCT FROM ''no_conversation''::text');
  execute format($cleanup$
    update public.users u set today_failed_attempts=(
      select count(*) from public.transfer_events e
      where e.install_id=u.install_id and e.received_at >= %L::timestamptz
        and e.status='failed' and e.failure_reason is distinct from 'no_conversation'
        and (e.terminal_received_at at time zone 'Asia/Kolkata')::date=u.today_date
    );
  $cleanup$, cutoff);
  -- Delete only rows whose sole counted activity was an empty chat. Preserve
  -- existing real user numbers, names and sequence; do not renumber anyone.
  execute format($cleanup$
    delete from public.users u where u.lifetime_summaries=0
      and exists(select 1 from public.transfer_events e where e.install_id=u.install_id
        and e.received_at >= %1$L::timestamptz and e.failure_reason='no_conversation')
      and not exists(select 1 from public.transfer_events e where e.install_id=u.install_id
        and e.received_at >= %1$L::timestamptz
        and (e.summary_verified or (e.status='failed' and e.failure_reason is distinct from 'no_conversation')));
  $cleanup$, cutoff);
end;
$exclude$;
comment on column public.users.today_failed_attempts is 'First received failed terminal outcome once per attempt on its database receipt calendar day in India; excludes no_conversation (empty chat), and client clocks are not authoritative.';
comment on view public.user_summary_usage is 'Service reporting since the original users reset using India calendar days; user failures exclude empty chats, and existing aliases are retained.';
notify pgrst, 'reload schema';
commit;
