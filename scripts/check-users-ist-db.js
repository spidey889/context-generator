const assert = require("node:assert/strict");

// Run only when requested, as part of the existing real-migration SQL gate.
async function checkUsersIst(db, sql) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const one = async (query, args = []) => (await db.query(query, args)).rows[0];
  // Seed an IST midnight completion while the old UTC implementation is active;
  // the migration must reconstruct it rather than just relabel an old counter.
  const midnight = (await one("select date_trunc('day',now(),'Asia/Kolkata')::text as t")).t;
  await db.exec("set role service_role;");
  try {
    await db.query(`select public.record_transfer_event('cccccccc-cccc-4ccc-8ccc-000000000099'::uuid,
      'ist-reconciliation',now(),'claude','chatgpt',1,'failed','capture_started','capture_failed',
      '1.4.7',true,null,$1::timestamptz)`, [midnight]);
  } finally { await db.exec("reset role;"); }
  const stableUsers = () => db.query("select install_id,user_no::text,name,lifetime_summaries::text from public.users order by user_no");
  const users = (await stableUsers()).rows;
  const events = (await db.query("select to_jsonb(e) as row from public.transfer_events e order by id")).rows;
  const sequence = await one("select last_value::text,is_called from public.users_user_no_seq");
  const original = (await one("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql")).sql;
  const cutoff = original.match(/new.received_at < '([^']+)'::timestamptz/)[1];
  const job = await one("select jobid,jobname from cron.job");
  await db.exec(sql);
  equal((await stableUsers()).rows, users);
  equal((await db.query("select to_jsonb(e) as row from public.transfer_events e order by id")).rows, events);
  equal(await one("select last_value::text,is_called from public.users_user_no_seq"), sequence);
  equal(await one("select jobid,jobname from cron.job"), job);
  equal((await one("select schedule from cron.job")).schedule, "30 18 * * *");
  const counter = (await one("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql")).sql;
  equal(counter.match(/new.received_at < '([^']+)'::timestamptz/)[1], cutoff);
  equal(counter.includes("'UTC'"), false);
  equal(counter.includes("clock_timestamp()"), true);
  equal(await one("select today_summaries::int as today,today_failed_attempts::int as failed from public.users where install_id='ist-reconciliation'"), { today: 1, failed: 1 });
  await db.query("insert into public.users(install_id) values('ist-default-date')");
  equal((await one("select today_date=(statement_timestamp() at time zone 'Asia/Kolkata')::date as correct from public.users where install_id='ist-default-date'")).correct, true);
  // Cutover reconciliation agrees with authoritative post-reset events.
  equal((await one(`select count(*)::int as n from public.users u where
    today_date <> (statement_timestamp() at time zone 'Asia/Kolkata')::date
    or today_summaries <> (select count(*) from public.transfer_events e
      where e.install_id=u.install_id and e.received_at >= $1::timestamptz and e.summary_verified
      and (e.summary_confirmed_at at time zone 'Asia/Kolkata')::date=u.today_date)
    or today_failed_attempts <> (select count(*) from public.transfer_events e
      where e.install_id=u.install_id and e.received_at >= $1::timestamptz and e.status='failed'
      and (e.terminal_received_at at time zone 'Asia/Kolkata')::date=u.today_date)`, [cutoff])).n, 0);
  // Exercise exact midnight, not UTC midnight; independent of the host timezone.
  for (const zone of ["UTC", "America/Los_Angeles", "Asia/Kolkata"]) {
    await db.query("select set_config('TimeZone',$1,false)", [zone]);
    equal(await one(`select
      ('2026-10-02 18:29:59.999999+00'::timestamptz at time zone 'Asia/Kolkata')::date::text as before,
      ('2026-10-02 18:30:00+00'::timestamptz at time zone 'Asia/Kolkata')::date::text as after`),
    { before: "2026-10-02", after: "2026-10-03" });
  }
  await db.exec("set timezone='UTC';");
  const install = "ist-calendar-fixture";
  const start = (await one("select date_trunc('day',now(),'Asia/Kolkata')::text as start")).start;
  const attempt = "cccccccc-cccc-4ccc-8ccc-000000000001";
  async function event(id, confirmedAt) {
    await db.exec("set role service_role;");
    try {
      await db.query(`select public.record_transfer_event($1::uuid,$2,'2026-10-02 00:00:00+00'::timestamptz,'claude','chatgpt',1,
        'failed','capture_started','capture_failed','1.4.7',true,null,$3::timestamptz)`, [id, install, confirmedAt]);
    } finally { await db.exec("reset role;"); }
  }
  const counts = () => one("select lifetime_summaries::int as lifetime,today_summaries::int as today,today_failed_attempts::int as failed from public.users where install_id=$1", [install]);
  await event(attempt, start); // Exactly midnight IST, which is yesterday in UTC.
  equal(await counts(), { lifetime: 1, today: 1, failed: 1 });
  await event(attempt, start);
  equal(await counts(), { lifetime: 1, today: 1, failed: 1 });
  const before = (await one("select ($1::timestamptz-interval '1 microsecond')::text as t", [start])).t;
  await event("cccccccc-cccc-4ccc-8ccc-000000000002", before);
  await event("cccccccc-cccc-4ccc-8ccc-000000000003", null);
  equal(await counts(), { lifetime: 3, today: 1, failed: 3 });
  equal((await one("select verified_today_summaries::int as n from public.user_summary_usage where install_id=$1", [install])).n, 1);
  equal((await one("select verified_summaries::int as n from public.verified_summary_daily_usage where install_id=$1 and usage_date=($2::timestamptz at time zone 'Asia/Kolkata')::date", [install, start])).n, 1);
  await db.query("update public.users set today_date=(now() at time zone 'Asia/Kolkata')::date-1 where install_id=$1", [install]);
  await event("cccccccc-cccc-4ccc-8ccc-000000000004", start);
  equal(await counts(), { lifetime: 4, today: 1, failed: 1 }); // Ingestion catch-up resets both.
  const command = (await one("select command from cron.job")).command;
  await db.exec(command);
  equal(await counts(), { lifetime: 4, today: 1, failed: 1 }); // Late cron preserves new-day activity.
  await db.query("update public.users set today_date=(now() at time zone 'Asia/Kolkata')::date-1 where install_id=$1", [install]);
  await db.exec(command);
  equal(await counts(), { lifetime: 4, today: 0, failed: 0 }); // Inactive row resets too.
  equal((await one("select has_table_privilege('anon','public.users','select') as allowed")).allowed, false);
  equal((await one("select bool_and('security_invoker=true'=any(reloptions)) as secure from pg_class where oid in ('public.user_summary_usage'::regclass,'public.verified_summary_daily_usage'::regclass)")).secure, true);
  console.log(`PASS: ${checks} IST boundary, reconciliation, duplicate/delayed/unknown-day, reset and preservation checks.`);
  return checks;
}
module.exports = { checkUsersIst };
