const assert = require("node:assert/strict");

// The real SQL gate calls this at the 22 -> 23 cutover. Clock substitution is
// local only: it executes the production counter body at controlled IST edges.
async function checkMinimalTransfers(db, sql, migrations) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const one = async (query, args = []) => (await db.query(query, args)).rows[0];
  const rejectsCode = async (operation, code) => { await assert.rejects(operation, error => error.code === code); checks++; };
  const asRole = async (role, operation) => {
    await db.exec(`set role ${role};`);
    try { return await operation(); } finally { await db.exec("reset role;"); }
  };
  const removed = ["updated_at", "completed_at", "summary_received_at", "terminal_received_at"];
  const id = n => `abababab-abab-4bab-8bab-${String(n).padStart(12, "0")}`;
  const install = "final-cleanup-install";
  const signature = "public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz)";
  const definition = () => one("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql").then(row => row.sql);
  const cutoff = (await definition()).match(/new.received_at < '([^']+)'::timestamptz/)[1];
  const counts = () => one("select lifetime_summaries::int as lifetime,today_summaries::int as today,today_failed_attempts::int as failed from public.users where install_id=$1", [install]);
  const row = n => one("select to_jsonb(t) as row from public.transfers t where attempt_id=$1", [id(n)]).then(value => value?.row);
  const report = (n, overrides = {}) => {
    const event = { install, status: "started", stage: "capture_started", reason: null, verified: false,
      completed: "2020-01-01T00:00:00Z", confirmed: null, version: "1.4.7", characters: 10, ...overrides };
    return asRole("service_role", () => db.query(`select public.record_transfer_event(
      $1::uuid,$2::text,'2026-10-02T00:00:00Z'::timestamptz,'claude','chatgpt',$3::integer,
      $4::text,$5::text,$6::text,$7::text,$8::boolean,$9::timestamptz,$10::timestamptz)`,
      [id(n), event.install, event.characters, event.status, event.stage, event.reason, event.version,
        event.verified, event.status === "started" ? null : event.completed, event.confirmed]));
  };
  await report(1); // An in-flight attempt crosses the migration unchanged.
  await db.query(`insert into public.transfers(attempt_id,install_id,attempted_at,received_at,
    source_platform,destination_platform,status,last_stage,extension_version)
    values($1,$2,'2026-10-02T00:00:00Z',$3::timestamptz-interval '1 microsecond',
      'claude','chatgpt','started','capture_started','1.4.7')`, [id(2), install, cutoff]);
  const preserved = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(t)-array['updated_at','completed_at','summary_received_at','terminal_received_at'] order by attempt_id) from public.transfers t) as transfers,
    (select jsonb_agg(to_jsonb(u) order by user_no) from public.users u) as users,
    (select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j) as jobs,
    (select jsonb_build_object('last',last_value::text,'called',is_called) from public.users_user_no_seq) as sequence,
    (select jsonb_agg(jsonb_build_object('oid',oid,'acl',relacl,'rls',relrowsecurity) order by oid)
      from pg_class where oid in ('public.users'::regclass,'public.transfers'::regclass)) as security,
    (select jsonb_agg(indexdef order by indexname) from pg_indexes where schemaname='public') as indexes,
    (select jsonb_agg(jsonb_build_object('oid',oid,'acl',proacl,'args',proargnames,'defaults',pronargdefaults,'definer',prosecdef,'config',proconfig) order by oid)
      from pg_proc where pronamespace='public'::regnamespace) as functions`)).rows;
  const snapshot = async history => ({
    transfers: (await db.query("select to_jsonb(t) as row from public.transfers t")).rows.map(value => value.row),
    users: (await db.query("select to_jsonb(u) as row from public.users u")).rows.map(value => value.row),
    users_sequence: await one("select last_value::text,is_called from public.users_user_no_seq"), migrations: history,
    functions: (await db.query("select pg_get_functiondef(oid) as definition from pg_proc where pronamespace='public'::regnamespace")).rows.map(value => value.definition),
    views: [], cron_jobs: (await db.query("select to_jsonb(j) as row from cron.job j")).rows.map(value => value.row)
  });
  const before = await preserved();
  const oldSnapshot = await snapshot(migrations.slice(0, -1));
  await db.exec("create view public.timestamp_dependency_fixture as select updated_at from public.transfers;");
  await rejectsCode(() => db.exec(sql), "2BP01");
  await db.exec("rollback; drop view public.timestamp_dependency_fixture;");
  equal(await preserved(), before);
  await db.exec(sql);
  equal(await preserved(), before);
  equal((await db.query(`select column_name from information_schema.columns where table_schema='public'
    and table_name='transfers' order by ordinal_position`)).rows.map(value => value.column_name), [
    "attempt_id", "install_id", "attempted_at", "received_at", "source_platform", "destination_platform",
    "character_count", "status", "failure_reason", "extension_version", "last_stage", "summary_verified", "summary_confirmed_at"
  ]);
  const counter = await definition();
  equal(counter.match(/new.received_at < '([^']+)'::timestamptz/)[1], cutoff);
  assert.ok(counter.indexOf("'cap-context-users-allocation'") < counter.indexOf("today := (clock_timestamp()")); checks++;
  assert.ok(counter.includes("transaction_timestamp() at time zone 'Asia/Kolkata'")); checks++;
  for (const name of removed) { assert.ok(!counter.includes(`new.${name}`)); checks++; }
  equal((await one("select count(*)::int as n from pg_constraint where conrelid='public.transfers'::regclass and conname in ('transfers_completion_terminal','transfers_summary_receipt_consistent','transfers_terminal_receipt_consistent')")).n, 0);

  const { checkSnapshot } = require("./check-telemetry-backup.js");
  const oldRestore = await checkSnapshot(oldSnapshot);
  equal(oldRestore.originalValuesPreserved, true);
  equal(oldRestore.pendingMigrations, 0);
  const upgraded = await checkSnapshot(oldSnapshot, { applyPending: true, throughVersion: migrations.at(-1).version });
  equal(upgraded.retainedValuesPreserved, true);
  equal(upgraded.removedColumns.sort(), removed.map(name => `transfers.${name}`).sort());
  equal(upgraded.capturedCronJobsRestored, true);
  const newRestore = await checkSnapshot(await snapshot(migrations));
  equal(newRestore.originalValuesPreserved, true);
  equal(newRestore.removedColumns, []);

  // The existing user avoids consuming additional finite name-pool entries.
  await db.query("update public.users set lifetime_summaries=0,today_summaries=0,today_failed_attempts=0,today_date=(clock_timestamp() at time zone 'Asia/Kolkata')::date where install_id=$1", [install]);
  const time = (await one("select clock_timestamp()::text as time")).time;
  const failure = { status: "failed", stage: "paste_started", reason: "paste_failed" };
  await report(1, failure);
  equal(await counts(), { lifetime: 0, today: 0, failed: 1 });
  const failedRow = await row(1);
  await report(1, { ...failure, completed: "2030-01-01T00:00:00Z" });
  equal(await row(1), failedRow);
  equal(await counts(), { lifetime: 0, today: 0, failed: 1 });
  await report(1, { status: "succeeded", stage: "completed", verified: true, confirmed: time, version: "1.4.8" });
  equal(await counts(), { lifetime: 1, today: 1, failed: 1 });
  const verifiedRow = await row(1);
  equal([verifiedRow.status, verifiedRow.last_stage, verifiedRow.failure_reason, verifiedRow.extension_version], ["failed", "paste_started", "paste_failed", "1.4.7"]);
  await report(1, { ...failure, verified: true, confirmed: "2030-01-01T00:00:00Z" });
  equal(await row(1), verifiedRow);
  equal(await counts(), { lifetime: 1, today: 1, failed: 1 });
  await report(2, { ...failure, verified: true, confirmed: time });
  equal(await counts(), { lifetime: 1, today: 1, failed: 1 }); // Frozen pre-reset boundary.
  await report(3, { ...failure, reason: "no_conversation", install: "minimal-empty-install" });
  equal(await one("select user_no from public.users where install_id='minimal-empty-install'"), undefined);
  await report(4, { status: "succeeded", stage: "completed", verified: true,
    confirmed: (await one("select (clock_timestamp()-interval '1 day')::text as t")).t });
  await report(5, { status: "succeeded", stage: "completed", verified: true });
  equal(await counts(), { lifetime: 3, today: 1, failed: 1 });
  await asRole("service_role", () => db.query(`select public.record_transfer_event($1,$2,now(),'claude','chatgpt',1,'succeeded','completed',null,'1.4.6')`, [id(6), install]));
  await asRole("service_role", () => db.query(`select public.record_transfer_event($1,$2,now(),'claude','chatgpt',1,'succeeded','completed',null,'1.4.6',true)`, [id(7), install]));
  equal(await counts(), { lifetime: 4, today: 1, failed: 1 });
  await db.query("update public.users set today_date=(clock_timestamp() at time zone 'Asia/Kolkata')::date-1 where install_id=$1", [install]);
  await report(8, failure);
  equal(await counts(), { lifetime: 4, today: 0, failed: 1 });
  const command = (await one("select command from cron.job limit 1")).command;
  await db.exec(command);
  equal(await counts(), { lifetime: 4, today: 0, failed: 1 });
  await db.query("update public.users set today_date=(clock_timestamp() at time zone 'Asia/Kolkata')::date-1 where install_id=$1", [install]);
  await db.exec(command);
  equal(await counts(), { lifetime: 4, today: 0, failed: 0 });
  await rejectsCode(() => report(1, { install: "wrong-owner" }), "22023");
  for (const assignment of ["received_at=now()+interval '1 second'", "summary_verified=false",
    "summary_confirmed_at=now()+interval '1 second'", "status='started'", "last_stage='capture_started'"]) {
    await rejectsCode(() => asRole("service_role", () => db.query(`update public.transfers set ${assignment} where attempt_id=$1`, [id(1)])), "22023");
  }
  for (const role of ["anon", "authenticated"]) {
    await rejectsCode(() => asRole(role, () => db.query("select * from public.transfers limit 0")), "42501");
    equal((await one("select has_function_privilege($1,$2,'execute') as allowed", [role, signature])).allowed, false);
  }

  // Run the actual trigger logic around IST midnight, including a lock wait:
  // transaction time is yesterday while wall time sampled after locks is today.
  for (const [n, receipt, wall, expected] of [
    [20, "2026-10-03T18:29:59.999Z", "2026-10-03T18:29:59.999Z", 1],
    [21, "2026-10-03T18:29:59.999Z", "2026-10-03T18:30:00.000Z", 0],
    [22, "2026-10-03T18:30:00.000Z", "2026-10-03T18:30:00.000Z", 1]
  ]) {
    await db.exec("begin;");
    try {
      await db.exec(counter.replace(/transaction_timestamp\(\)/g, `'${receipt}'::timestamptz`)
        .replace(/clock_timestamp\(\)/g, `'${wall}'::timestamptz`));
      await db.query("update public.users set today_date='2026-10-03',today_summaries=2,today_failed_attempts=9 where install_id=$1", [install]);
      await report(n, failure);
      equal((await counts()).failed, n === 20 ? 10 : expected);
      if (n !== 20) equal((await counts()).today, 0);
      await report(n, failure);
      equal((await counts()).failed, n === 20 ? 10 : expected);
    } finally { await db.exec("rollback;"); }
  }
  equal(await definition(), counter);
  console.log(`PASS: ${checks} minimal transfers, legacy payloads, preservation/backup, retry/proof and IST transition checks.`);
  return checks;
}

module.exports = { checkMinimalTransfers };
