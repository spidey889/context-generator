const assert = require("node:assert/strict");

// This helper runs only through the explicitly requested real-migration gate.
// Earlier checks replay the historical schema; this one exercises its cutover.
async function checkTransfers(db, sql, migrations) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const one = async (query, args = []) => (await db.query(query, args)).rows[0];
  const rejectsCode = async (operation, code) => {
    await assert.rejects(operation, error => error.code === code); checks++;
  };
  const asRole = async (role, operation) => {
    await db.exec(`set role ${role};`);
    try { return await operation(); } finally { await db.exec("reset role;"); }
  };
  const id = n => `eeeeeeee-eeee-4eee-8eee-${String(n).padStart(12, "0")}`;
  const signature = "public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz)";
  const types = ["uuid", "text", "timestamptz", "text", "text", "integer", "text", "text", "text", "text", "boolean", "timestamptz", "timestamptz"];
  async function report(n, install, overrides = {}) {
    const event = {
      attempt: id(n), install, attempted: "2026-10-02T00:00:00.000Z", source: "claude", destination: "chatgpt",
      characters: 100, status: "started", stage: "intent_started", reason: null, version: "1.4.7",
      verified: false, completed: null, confirmed: null, ...overrides
    };
    return asRole("service_role", () => db.query(`select public.record_transfer_event(${types.map((type, i) => `$${i + 1}::${type}`).join(",")})`,
      [event.attempt, event.install, event.attempted, event.source, event.destination, event.characters,
        event.status, event.stage, event.reason, event.version, event.verified, event.completed, event.confirmed]));
  }

  // Keep a nonterminal attempt across the rename, then finish it through the
  // unchanged RPC. This proves existing queued reports do not need a new client.
  await report(1, "transfers-existing-install", { stage: "capture_started" });
  const beforeRows = (await db.query("select to_jsonb(e)-'id' as row from public.transfer_events e order by attempt_id")).rows;
  const beforeColumns = (await db.query(`select column_name,data_type,is_nullable,column_default
    from information_schema.columns where table_schema='public' and table_name='transfer_events'
      and column_name<>'id' order by ordinal_position`)).rows;
  const beforeUsers = (await db.query("select to_jsonb(u) as row from public.users u order by user_no")).rows;
  const beforeSequence = await one("select last_value::text,is_called from public.users_user_no_seq");
  const beforeJobs = (await db.query("select to_jsonb(j) as row from cron.job j order by jobid")).rows;
  const counter = (await one("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql")).sql;
  const cutoff = counter.match(/new.received_at < '([^']+)'::timestamptz/)[1];
  const beforeFunctions = (await db.query(`select p.oid::text,p.prosrc,p.proargnames,p.pronargdefaults,p.prosecdef,p.proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname not in ('record_transfer_event','preserve_transfer_event_invariants') order by p.oid`)).rows;
  const beforeRpc = await one("select oid::text,proargnames,pronargdefaults,prosecdef,proconfig from pg_proc where oid=$1::regprocedure", [signature]);
  const guard = await one(`select p.oid::text,p.prosrc from pg_trigger t join pg_proc p on p.oid=t.tgfoid
    where t.tgrelid='public.transfer_events'::regclass and t.tgname='transfer_events_preserve_invariants'`);
  const security = await one("select oid::text,relrowsecurity,relforcerowsecurity,relacl::text from pg_class where oid='public.transfer_events'::regclass");
  const beforePolicies = (await db.query("select polname,polcmd,polpermissive,polroles::text,pg_get_expr(polqual,polrelid) as qualifier,pg_get_expr(polwithcheck,polrelid) as check_expression from pg_policy where polrelid='public.transfer_events'::regclass order by polname")).rows;

  // Exercise captured-only recovery of both schemas and the explicit upgrade;
  // the old snapshot must retain its original UUIDs until cleanup is requested.
  const snapshot = async (table, history) => ({
    [table]: (await db.query(`select to_jsonb(t) as row from public.${table} t`)).rows.map(value => value.row),
    users: (await db.query("select to_jsonb(u) as row from public.users u")).rows.map(value => value.row),
    users_sequence: await one("select last_value::text,is_called from public.users_user_no_seq"),
    migrations: history,
    functions: (await db.query("select pg_get_functiondef(oid) as definition from pg_proc where pronamespace='public'::regnamespace")).rows.map(row => row.definition),
    views: (await db.query("select viewname as name,definition from pg_views where schemaname='public'")).rows,
    cron_jobs: (await db.query("select to_jsonb(j) as row from cron.job j")).rows.map(value => value.row)
  });
  const oldSnapshot = await snapshot("transfer_events", migrations.slice(0, -1));

  await db.exec(sql);
  equal((await one("select to_regclass('public.transfer_events') as old")).old, null);
  equal((await one("select relkind from pg_class where oid='public.transfers'::regclass")).relkind, "r");
  equal((await db.query("select to_jsonb(e) as row from public.transfers e order by attempt_id")).rows, beforeRows);
  equal((await db.query(`select column_name,data_type,is_nullable,column_default
    from information_schema.columns where table_schema='public' and table_name='transfers' order by ordinal_position`)).rows, beforeColumns);
  equal(beforeColumns.length, 17);
  equal((await db.query("select to_jsonb(u) as row from public.users u order by user_no")).rows, beforeUsers);
  equal(await one("select last_value::text,is_called from public.users_user_no_seq"), beforeSequence);
  equal((await db.query("select to_jsonb(j) as row from cron.job j order by jobid")).rows, beforeJobs);
  const currentCounter = (await one("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql")).sql;
  equal(currentCounter, counter);
  equal(currentCounter.match(/new.received_at < '([^']+)'::timestamptz/)[1], cutoff);
  equal((await db.query(`select p.oid::text,p.prosrc,p.proargnames,p.pronargdefaults,p.prosecdef,p.proconfig
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
      and p.proname not in ('record_transfer_event','preserve_transfer_event_invariants') order by p.oid`)).rows, beforeFunctions);
  equal(await one("select oid::text,proargnames,pronargdefaults,prosecdef,proconfig from pg_proc where oid=$1::regprocedure", [signature]), beforeRpc);
  equal((await one("select prosrc from pg_proc where oid=$1::oid", [guard.oid])).prosrc,
    guard.prosrc.replace(/new\.id,\s*/g, "").replace(/old\.id,\s*/g, ""));
  equal(await one("select oid::text,relrowsecurity,relforcerowsecurity,relacl::text from pg_class where oid='public.transfers'::regclass"), security);
  equal((await db.query("select polname,polcmd,polpermissive,polroles::text,pg_get_expr(polqual,polrelid) as qualifier,pg_get_expr(polwithcheck,polrelid) as check_expression from pg_policy where polrelid='public.transfers'::regclass order by polname")).rows, beforePolicies);
  equal((await one(`select array_agg(a.attname order by k.position) as columns
    from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(attribute,position)
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.attribute
    where c.conrelid='public.transfers'::regclass and c.contype='p'`)).columns, ["attempt_id"]);
  equal((await one(`select count(*)::int as n from pg_index i where i.indrelid='public.transfers'::regclass and i.indisunique
    and i.indkey::text=(select attnum::text from pg_attribute where attrelid=i.indrelid and attname='attempt_id')`)).n, 1);
  equal((await one("select count(*)::int as n from pg_trigger where tgrelid='public.transfers'::regclass and not tgisinternal")).n, 3);
  const { checkSnapshot, selectPendingMigrations } = require("./check-telemetry-backup.js");
  const oldRestore = await checkSnapshot(oldSnapshot);
  equal(oldRestore.originalValuesPreserved, true);
  equal(oldRestore.pendingMigrations, 0);
  equal(oldRestore.removedColumns, []);
  equal(oldRestore.capturedCronJobsRestored, true);
  const upgraded = await checkSnapshot(oldSnapshot, { applyPending: true, throughVersion: "20261002163357" });
  equal(upgraded.retainedValuesPreserved, true);
  equal(upgraded.originalValuesPreserved, false);
  equal(upgraded.removedColumns, ["transfer_events.id"]);
  const newRestore = await checkSnapshot(await snapshot("transfers", migrations));
  equal(newRestore.originalValuesPreserved, true);
  equal(newRestore.removedColumns, []);
  equal(newRestore.transferEvents, beforeRows.length);

  // Backup recovery must restore the captured job, including non-default
  // targets/owners, disabled state and extra jobs, without scheduling anything.
  const currentSnapshot = await snapshot("transfers", migrations);
  const customJobSnapshot = { ...currentSnapshot, cron_jobs: [
    { jobid: "37", jobname: "cap-context-reset-daily-user-summaries", schedule: "17 3 * * 2",
      command: "select 42;", active: false, nodename: "snapshot.invalid", nodeport: 6432,
      database: "snapshot_database", username: "snapshot_owner" },
    { jobid: "52", jobname: "snapshot-extra-job", schedule: "19 4 * * 3", command: "select 44;",
      active: true, nodename: "second.invalid", nodeport: 7432, database: "second_database", username: "second_owner" }
  ] };
  const customJobRestore = await checkSnapshot(customJobSnapshot);
  equal(customJobRestore.capturedCronJobsRestored, true);
  equal(customJobRestore.capturedCronJobs, 2);
  assert.match(customJobRestore.capturedCronJobHash, /^[0-9a-f]{64}$/); checks++;
  equal(customJobRestore.originalColumnHashes, newRestore.originalColumnHashes);
  const { cron_jobs: ignoredJobs, ...legacyWithoutJobs } = currentSnapshot;
  equal((await checkSnapshot(legacyWithoutJobs)).capturedCronJobsRestored, false);

  // Exercise drift refusal without creating files in the active migration
  // folder. Only an explicit boundary above recorded history permits an upgrade.
  const versions = new Set(migrations.map(migration => String(migration.version)));
  assert.throws(() => selectPendingMigrations(["20261001000000_accidentally_unarchived.sql"], versions,
    "20261002163400"), /Unexpected older migration/); checks++;
  assert.throws(() => selectPendingMigrations([], versions), /explicit migration boundary/); checks++;
  equal(selectPendingMigrations(["20261002163500_outside_boundary.sql", "20261002163400_requested.sql",
    "20261002163357_simplify_transfers.sql"], versions, "20261002163400"), ["20261002163400_requested.sql"]);

  const outcome = n => one("select to_jsonb(t) as row from public.transfers t where attempt_id=$1", [id(n)]);
  const counts = install => one("select lifetime_summaries::int as lifetime,today_summaries::int as today,today_failed_attempts::int as failed from public.users where install_id=$1", [install]);
  const install = "transfers-existing-install";
  equal(await counts(install), undefined);
  await report(1, install, { stage: "capture_completed", characters: 120 });
  equal(await one("select last_stage,character_count from public.transfers where attempt_id=$1", [id(1)]), { last_stage: "capture_completed", character_count: 120 });
  const progress = await outcome(1);
  await report(1, install, { stage: "capture_started" });
  equal(await outcome(1), progress);
  const time = (await one("select clock_timestamp()::text as t")).t;
  await report(1, install, { status: "failed", stage: "paste_started", reason: "paste_failed", completed: time });
  equal(await counts(install), { lifetime: 0, today: 0, failed: 1 });
  const terminal = await one("select completed_at::text,terminal_received_at::text from public.transfers where attempt_id=$1", [id(1)]);
  equal(Number.isFinite(Date.parse(terminal.terminal_received_at)), true);
  // A late proof counts the summary without replacing the first paste failure.
  await report(1, install, { status: "succeeded", stage: "completed", verified: true, confirmed: time, version: "1.4.8" });
  equal(await counts(install), { lifetime: 1, today: 1, failed: 1 });
  equal(await one("select status,last_stage,failure_reason,extension_version,character_count from public.transfers where attempt_id=$1", [id(1)]),
    { status: "failed", last_stage: "paste_started", failure_reason: "paste_failed", extension_version: "1.4.7", character_count: 100 });
  equal(await one("select completed_at::text,terminal_received_at::text from public.transfers where attempt_id=$1", [id(1)]), terminal);
  equal((await one("select summary_verified and summary_confirmed_at is not null and summary_received_at is not null as confirmed from public.transfers where attempt_id=$1", [id(1)])).confirmed, true);
  const verified = await outcome(1);
  await report(1, install, { status: "succeeded", stage: "completed", verified: true, confirmed: time });
  equal(await outcome(1), verified);
  equal(await counts(install), { lifetime: 1, today: 1, failed: 1 });

  await rejectsCode(() => report(1, "transfers-wrong-install"), "22023");
  await rejectsCode(() => report(1, install, { source: "gemini" }), "22023");
  for (const assignment of ["attempt_id=gen_random_uuid()", "received_at=received_at+interval '1 second'",
    "status='started'", "summary_verified=false", "summary_confirmed_at=summary_confirmed_at+interval '1 second'",
    "terminal_received_at=terminal_received_at+interval '1 second'"]) {
    await rejectsCode(() => asRole("service_role", () => db.query(`update public.transfers set ${assignment} where attempt_id=$1`, [id(1)])), "22023");
  }
  await rejectsCode(() => report(2, install, { characters: -1 }), "23514");
  await rejectsCode(() => report(2, install, { status: "failed", stage: "capture_started" }), "23514");

  await report(3, "transfers-empty-install", { status: "failed", stage: "capture_started", reason: "no_conversation", characters: 0 });
  await report(3, "transfers-empty-install", { status: "failed", stage: "capture_started", reason: "no_conversation", characters: 0 });
  equal(await counts("transfers-empty-install"), undefined);
  await report(4, "transfers-empty-update", { stage: "capture_started" });
  await report(4, "transfers-empty-update", { status: "failed", stage: "capture_started", reason: "no_conversation", characters: 0 });
  equal(await counts("transfers-empty-update"), undefined);
  equal((await one("select count(*)::int as n from public.transfers where failure_reason='no_conversation' and attempt_id in ($1,$2)", [id(3), id(4)])).n, 2);
  const yesterday = (await one("select (clock_timestamp()-interval '1 day')::text as t")).t;
  await report(5, install, { status: "succeeded", stage: "completed", verified: true, confirmed: yesterday });
  await report(6, install, { status: "succeeded", stage: "completed", verified: true });
  equal(await counts(install), { lifetime: 3, today: 1, failed: 1 });

  // Optional defaults must still accept old 10/11-argument callers. An unsigned
  // success counts no work, while a v1 proof counts lifetime without guessing day.
  await asRole("service_role", () => db.query(`select public.record_transfer_event($1::uuid,'transfers-legacy-unsigned',now(),
    'claude','chatgpt',1,'succeeded','completed',null,'1.4.6')`, [id(7)]));
  equal(await counts("transfers-legacy-unsigned"), undefined);
  await asRole("service_role", () => db.query(`select public.record_transfer_event($1::uuid,'transfers-legacy-verified',now(),
    'claude','chatgpt',1,'succeeded','completed',null,'1.4.6',true)`, [id(8)]));
  equal(await counts("transfers-legacy-verified"), { lifetime: 1, today: 0, failed: 0 });
  await db.query("update public.users set today_date=(clock_timestamp() at time zone 'Asia/Kolkata')::date-1 where install_id=$1", [install]);
  await report(9, install, { status: "failed", stage: "capture_started", reason: "capture_failed" });
  equal(await counts(install), { lifetime: 3, today: 0, failed: 1 });

  for (const role of ["anon", "authenticated"]) {
    await rejectsCode(() => asRole(role, () => db.query("select * from public.transfers limit 0")), "42501");
    equal((await one("select has_function_privilege($1,$2,'execute') as allowed", [role, signature])).allowed, false);
  }
  equal((await one("select has_function_privilege('service_role',$1,'execute') as allowed", [signature])).allowed, true);
  equal(await one("select has_table_privilege('service_role','public.transfers','select') as readable,has_table_privilege('service_role','public.transfers','insert') as insertable,has_table_privilege('service_role','public.transfers','update') as updatable,has_table_privilege('service_role','public.transfers','delete') as deletable,has_table_privilege('service_role','public.transfers','truncate') as truncatable"),
    { readable: true, insertable: true, updatable: true, deletable: false, truncatable: false });
  console.log(`PASS: ${checks} transfers cutover, retained-data/security, legacy RPC, sticky outcome/proof, empty-chat and IST counter checks.`);
  return checks;
}

module.exports = { checkTransfers };
