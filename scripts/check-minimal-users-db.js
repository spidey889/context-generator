// Called by the existing SQL gate after testing the historical 13 migrations.
// No hosted writes. Exercise the exact reset SQL, not a reimplemented model.
const assert = require("node:assert/strict");

async function checkMinimalUsers(db, migration, migrations) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const id = n => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
  const install = "minimal-users-same-install";
  const today = (await one("select (now() at time zone 'UTC')::date::text as day")).day;
  const yesterday = (await one("select ((now() at time zone 'UTC')::date-1)::text as day")).day;
  async function event(number, { installation = install, status = "succeeded", verified = false, confirmedAt = null } = {}) {
    await db.exec("set role service_role;");
    try {
      await db.query(`select public.record_transfer_event($1::uuid, $2::text, '2026-10-01'::timestamptz,
        'claude', 'chatgpt', 25, $3::text, $4::text, $5::text, '1.4.7', $6::boolean, null, $7::timestamptz)`,
        [id(number), installation, status, status === "succeeded" ? "completed" : "capture_started",
          status === "failed" ? "capture_failed" : null, verified, confirmedAt]);
    } finally { await db.exec("reset role;"); }
  }
  const counts = () => one(`select user_no::int, lifetime_successful_summaries::int as lifetime,
    today_successful_summaries::int as today, today_failed_attempts::int as failed from public.users where install_id=$1`, [install]);

  await event(800, { status: "started" });
  const history = (await db.query("select to_jsonb(e) as row from public.transfer_events e order by id")).rows;
  const columns = (await db.query("select column_name, data_type from information_schema.columns where table_schema='public' and table_name='transfer_events' order by ordinal_position")).rows;
  const job = await one("select jobid, jobname, schedule from cron.job");
  await db.exec(migration);
  equal((await db.query("select to_jsonb(e) as row from public.transfer_events e order by id")).rows, history);
  equal((await db.query("select column_name, data_type from information_schema.columns where table_schema='public' and table_name='transfer_events' order by ordinal_position")).rows, columns);
  equal(await one("select jobid, jobname, schedule from cron.job"), job);
  equal((await one("select count(*)::int as count from public.users")).count, 0);
  equal(await one("select last_value::int, is_called from public.users_user_no_seq"), { last_value: 1, is_called: false });
  equal((await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='users' order by column_name")).rows.map(row => row.column_name),
    ["install_id", "lifetime_successful_summaries", "name", "today_date", "today_failed_attempts", "today_successful_summaries", "user_no"]);
  const pool = (await one("select public.naruto_user_names() as names")).names;
  equal(new Set(pool).size, pool.length);
  assert.ok(pool.length > 100 && pool.every(name => /^[A-Za-z]+( [A-Za-z]+)*$/.test(name))); checks++;

  // Late completion of a pre-reset test attempt must not resurrect its user.
  await event(800, { verified: true, confirmedAt: `${today}T02:00:00Z` });
  equal(await counts(), undefined);
  await event(801); // Unsigned successful paste alone is not a summary.
  equal(await counts(), undefined);
  // A rolled-back new install must not consume visible number 1.
  await db.exec("begin;");
  await event(802, { status: "failed", installation: "rolled-back-install" });
  equal((await one("select user_no::int from public.users where install_id='rolled-back-install'")).user_no, 1);
  await db.exec("rollback;");
  await event(803, { status: "failed" });
  equal(await counts(), { user_no: 1, lifetime: 0, today: 0, failed: 1 });
  for (let i = 0; i < 5; i++) await event(803, { status: "failed" });
  equal(await counts(), { user_no: 1, lifetime: 0, today: 0, failed: 1 });
  const firstName = (await one("select name from public.users where install_id=$1", [install])).name;
  assert.ok(pool.includes(firstName)); checks++;
  // A failed paste and a verified summary count independently, once each.
  await event(803, { status: "failed", verified: true, confirmedAt: `${today}T02:00:00Z` });
  equal(await counts(), { user_no: 1, lifetime: 1, today: 1, failed: 1 });
  await event(804, { status: "failed", verified: true, confirmedAt: `${today}T03:00:00Z` });
  equal(await counts(), { user_no: 1, lifetime: 2, today: 2, failed: 2 });
  await event(805, { verified: true, confirmedAt: `${yesterday}T02:00:00Z` });
  await event(806, { verified: true }); // v1 proof: lifetime, unknown day.
  equal(await counts(), { user_no: 1, lifetime: 4, today: 2, failed: 2 });
  equal((await one("select name from public.users where install_id=$1", [install])).name, firstName);
  equal(await one("select verified_summaries::int, verified_today_summaries::int, verified_unknown_day_summaries::int, legacy_total_summaries::int from public.user_summary_usage where install_id=$1", [install]),
    { verified_summaries: 4, verified_today_summaries: 2, verified_unknown_day_summaries: 1, legacy_total_summaries: 0 });

  // Both the stored midnight command and late-job ingestion reset BOTH days.
  await db.query("update public.users set today_date=$1::date where install_id=$2", [yesterday, install]);
  await db.exec((await one("select command from cron.job")).command);
  equal(await counts(), { user_no: 1, lifetime: 4, today: 0, failed: 0 });
  await db.query("update public.users set today_date=$1::date, today_successful_summaries=3, today_failed_attempts=3 where install_id=$2", [yesterday, install]);
  await event(807, { status: "failed" });
  equal(await counts(), { user_no: 1, lifetime: 4, today: 0, failed: 1 });
  await db.query("update public.users set today_date=$1::date, today_successful_summaries=3, today_failed_attempts=3 where install_id=$2", [yesterday, install]);
  await event(808, { verified: true, confirmedAt: `${today}T03:00:00Z` });
  equal(await counts(), { user_no: 1, lifetime: 5, today: 1, failed: 0 });
  for (const column of ["lifetime_successful_summaries", "today_successful_summaries", "today_failed_attempts"]) {
    await assert.rejects(db.query(`update public.users set ${column}=-1 where install_id=$1`, [install]), error => error.code === "23514"); checks++;
  }
  await assert.rejects(db.query("update public.users set name='Naruto123' where install_id=$1", [install]), error => error.code === "23514"); checks++;
  await assert.rejects(db.query("update public.users set name='Invented Name' where install_id=$1", [install]), error => error.code === "23514"); checks++;
  // A restore must retain the original reset boundary, not the restore time.
  const snapshot = {
    migrations,
    transfer_events: (await db.query("select to_jsonb(e) as row from public.transfer_events e")).rows.map(value => value.row),
    users: (await db.query("select to_jsonb(u) as row from public.users u")).rows.map(value => value.row),
    users_sequence: await one("select last_value::text, is_called from public.users_user_no_seq"),
    functions: (await db.query("select pg_get_functiondef(oid) as definition from pg_proc where pronamespace='public'::regnamespace")).rows.map(value => value.definition),
    views: (await db.query("select viewname as name, definition from pg_views where schemaname='public'")).rows
  };
  const { checkSnapshot } = require("./check-telemetry-backup.js");
  const restored = await checkSnapshot(snapshot);
  equal(restored.originalValuesPreserved, true);
  equal(restored.capturedDefinitionsPreserved, true);
  equal(restored.pendingMigrations, 0);
  // Fill the finite pool: no repeated names or skipped visible user numbers.
  for (let i = 1; i < pool.length; i++) {
    await db.query("insert into public.users (install_id) values ($1)", [`pool-install-${i}`]);
  }
  equal(await one("select count(*)::int as users, count(distinct name)::int as names, max(user_no)::int as last from public.users"),
    { users: pool.length, names: pool.length, last: pool.length });
  await assert.rejects(db.query("insert into public.users (install_id) values ('pool-overflow')"), error => error.code === "P0001" && /pool exhausted/.test(error.message)); checks++;
  equal((await one("select count(*)::int as count from public.users")).count, pool.length);
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role};`);
    try {
      await assert.rejects(db.query("select * from public.users"), error => error.code === "42501"); checks++;
      await assert.rejects(db.query("select * from public.user_summary_usage"), error => error.code === "42501"); checks++;
      await assert.rejects(db.query("select public.naruto_user_names()"), error => error.code === "42501"); checks++;
    } finally { await db.exec("reset role;"); }
  }
  equal((await one("select relrowsecurity from pg_class where oid='public.users'::regclass")).relrowsecurity, true);
  console.log(`PASS: ${checks} users-only reset, numbering, names, failure/success counting, compatibility and daily-reset checks (${pool.length} names).`);
  return checks;
}
module.exports = { checkMinimalUsers };
