// Replay the real migration chain in a local PostgreSQL engine. No hosted reads
// or writes. PGlite is a locked development dependency; the application
// itself retains its existing no-runtime-dependencies contract.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || "@electric-sql/pglite");

async function main() {
  const db = new PGlite();
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const rejectsCode = async (operation, code) => {
    await assert.rejects(operation, error => error.code === code); checks++;
  };
  const install = "22222222-2222-4222-8222-222222222222";
  const historicInstall = "77777777-7777-4777-8777-777777777777";
  const id = n => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
  const attemptedAt = "2026-10-01T00:00:00.000Z";
  let today;
  async function asRole(role, operation) {
    await db.exec(`set role ${role};`);
    try { return await operation(); } finally { await db.exec("reset role;"); }
  }
  async function event(number, options = {}) {
    const status = options.status || "succeeded";
    const stage = options.stage || (status === "succeeded" ? "completed" : "capture_started");
    const values = [id(number), options.installId || install, options.attemptedAt || attemptedAt,
      options.source || "claude", options.destination || "chatgpt", options.characters ?? 50,
      status, stage, Object.hasOwn(options, "failure") ? options.failure : (status === "failed" ? "capture_failed" : null),
      Object.hasOwn(options, "version") ? options.version : "1.4.6"];
    const types = ["uuid", "text", "timestamptz", "text", "text", "integer", "text", "text", "text", "text"];
    if (!options.legacy) { values.push(options.verified || false); types.push("boolean"); }
    if (options.timestamps) {
      values.push(options.completedAt || null, options.confirmedAt || null);
      types.push("timestamptz", "timestamptz");
    }
    return asRole("service_role", () => db.query(`select public.record_transfer_event(${types.map((type, i) => `$${i + 1}::${type}`).join(", ")})`, values));
  }
  const counters = installId => one(`select total_summaries::int as total,
    today_summaries::int as today, legacy_total_summaries::int as legacy
    from public.users where install_id = $1`, [installId || install]);
  const outcome = number => one(`select status, last_stage, failure_reason, character_count,
    summary_verified, completed_at::text, terminal_received_at::text,
    summary_confirmed_at::text, summary_received_at::text
    from public.transfer_events where attempt_id = $1`, [id(number)]);
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      -- Mirror the broad defaults found on this hosted Supabase project.
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      -- pg_cron is not bundled in PGlite. Preserve its job catalog and SQL so
      -- the reset command itself is tested; actual scheduling remains hosted.
      create schema cron;
      create table cron.job (jobid bigint generated always as identity, jobname text, schedule text, command text, active boolean default true);
      create function cron.alter_job(job_id bigint, schedule text default null, command text default null) returns void language sql as $$
        update cron.job as j set schedule=coalesce($2,j.schedule),command=coalesce($3,j.command) where j.jobid=$1; $$;
      create function cron.unschedule(bigint) returns boolean language plpgsql as $$
        begin delete from cron.job where jobid = $1; return found; end; $$;
      create function cron.schedule(text, text, text) returns bigint language plpgsql as $$
        declare result bigint; begin
          insert into cron.job(jobname, schedule, command) values ($1, $2, $3) returning jobid into result;
          return result; end; $$;
    `);
    today = (await one("select (now() at time zone 'UTC')::date::text as today")).today;
    const directory = path.join(__dirname, "..", "supabase", "migrations");
    const names = fs.readdirSync(directory).filter(name => name.endsWith(".sql")).sort();
    let historical;
    let legacySnapshot;
    const appliedMigrations = [];
    const preCutoverVerifiedInstall = "55555555-5555-4555-8555-555555555555";
    // Verify the original preservation rollout at its historical boundary;
    // the subsequent explicit users reset is tested separately below.
    for (const name of names.filter(name => name.slice(0, 14) <= "20261002073711")) {
      if (name === "20261002000000_count_only_verified_summaries.sql") {
        // Preserve and verify data/counters across the actual old→new cutover.
        await event(900, { installId: historicInstall, legacy: true });
        historical = await one("select e.id::text, u.user_no::int, u.total_summaries::int from public.transfer_events e join public.users u using(install_id) where e.attempt_id = $1", [id(900)]);
        // Confirm that the old migration really contains the reported defect,
        // then roll back this intentionally contradictory local fixture.
        await db.exec("begin;");
        await event(901, { status: "failed", legacy: true });
        await event(901, { legacy: true });
        equal((await one("select status, last_stage from public.transfer_events where attempt_id=$1", [id(901)])), { status: "failed", last_stage: "completed" });
        await db.exec("rollback;");
        // Real sequences can be ahead of max(user_no) after rolled-back or
        // conflicted inserts. Backups preserve those consumed identity values.
        await db.exec("select setval('public.users_user_no_seq', 12, true);");
        legacySnapshot = {
          transfer_events: (await db.query("select to_jsonb(e) as row from public.transfer_events e")).rows.map(value => value.row),
          users: (await db.query("select to_jsonb(u) as row from public.users u")).rows.map(value => value.row),
          migrations: [...appliedMigrations],
          users_sequence: await one("select last_value::text, is_called from public.users_user_no_seq")
        };
      }
      if (name.endsWith("_enforce_telemetry_outcomes_and_attribution.sql")) {
        // An installation may already have v1 verified additions before the
        // next migration. Those additions must not become the legacy baseline.
        await event(902, { installId: preCutoverVerifiedInstall, verified: true });
      }
      const sql = fs.readFileSync(path.join(directory, name), "utf8")
        .replace("create extension if not exists pg_cron with schema pg_catalog;", "-- Local cron catalog shim.");
      await db.exec(sql);
      appliedMigrations.push({ version: name.slice(0, 14), name: name.slice(15, -4),
        statements: [fs.readFileSync(path.join(directory, name), "utf8")] });
    }
    assert.ok(historical, "The historical and pending migrations must be present");
    equal(await one("select e.id::text, u.user_no::int, u.total_summaries::int from public.transfer_events e join public.users u using(install_id) where e.attempt_id=$1", [id(900)]), historical);
    equal((await counters(historicInstall)).legacy, 1);
    equal((await outcome(900)).completed_at, null);
    equal((await outcome(900)).terminal_received_at, null);
    equal((await counters(preCutoverVerifiedInstall)).legacy, 0);
    equal((await outcome(902)).summary_confirmed_at, null);
    equal((await outcome(902)).summary_received_at, null);

    // Neither forged success nor old clients create verified summary counters.
    for (let number = 1; number <= 50; number++) await event(number, { legacy: number % 2 === 0 });
    equal(await counters(), undefined);
    const confirmedAt = `${today}T02:00:00.000Z`;
    await event(51, { verified: true, timestamps: true, confirmedAt });
    equal(await counters(), { total: 1, today: 1, legacy: 0 });
    const firstProof = await outcome(51);
    for (let i = 0; i < 10; i++) await event(51, { verified: true, timestamps: true, confirmedAt: `${today}T03:00:00.000Z` });
    equal(await counters(), { total: 1, today: 1, legacy: 0 });
    equal(await outcome(51), firstProof);

    // Conflicting terminal reports preserve the first status AND its stage,
    // timestamps and character count. Proof can still confirm server work.
    await event(52, { status: "failed", stage: "capture_started", characters: 75,
      timestamps: true, completedAt: `${today}T00:01:00.000Z` });
    const firstFailure = await outcome(52);
    await event(52, { verified: true, timestamps: true, confirmedAt,
      completedAt: `${today}T04:00:00.000Z` });
    const confirmedFailure = await outcome(52);
    for (const key of ["status", "last_stage", "failure_reason", "character_count", "completed_at", "terminal_received_at"]) equal(confirmedFailure[key], firstFailure[key]);
    equal(confirmedFailure.summary_verified, true);
    equal(await counters(), { total: 2, today: 2, legacy: 0 });
    await event(53, { verified: true, timestamps: true, confirmedAt });
    const firstSuccess = await outcome(53);
    await event(53, { status: "failed", verified: true, timestamps: true, confirmedAt });
    equal(await outcome(53), firstSuccess);
    equal(await counters(), { total: 3, today: 3, legacy: 0 });

    await event(54, { status: "started", stage: "paste_started" });
    await event(54, { status: "started", stage: "capture_started" });
    equal((await outcome(54)).last_stage, "paste_started");
    await event(54, { status: "failed", stage: "summary_completed", failure: "destination_open_failed" });
    equal((await outcome(54)).last_stage, "summary_completed");

    for (const mutation of [
      { installId: "33333333-3333-4333-8333-333333333333" },
      { attemptedAt: "2026-09-30T00:00:00.000Z" }, { source: "gemini" },
      { destination: "deepseek" }
    ]) await rejectsCode(() => event(51, { ...mutation, verified: true }), "22023");
    for (const malformed of [
      { characters: -1 }, { status: "started", stage: "completed" },
      { status: "failed", stage: "completed" }, { status: "failed", failure: null },
      { stage: "paste_started" }, { failure: "capture_failed" },
      { status: "started", timestamps: true, completedAt: confirmedAt },
      { timestamps: true, confirmedAt }, { verified: true, timestamps: true, confirmedAt: "infinity" }
    ]) await rejectsCode(() => event(100, malformed), "23514");
    // PostgreSQL checks candidate INSERT constraints before conflict handling;
    // malformed replays cannot hide behind an existing terminal row.
    await rejectsCode(() => event(51, { characters: -1 }), "23514");
    await rejectsCode(() => event(51, { status: "failed", stage: "completed" }), "23514");
    for (const assignment of [
      "id = gen_random_uuid()", "install_id = 'another-install'", "attempt_id = gen_random_uuid()",
      "extension_version = '1.4.7'",
      "received_at = now() + interval '1 minute'", "status = 'failed'",
      "last_stage = 'paste_started'", "completed_at = now()", "summary_verified = false",
      "summary_confirmed_at = now()"
    ]) await rejectsCode(() => asRole("service_role", () => db.query(`update public.transfer_events set ${assignment} where attempt_id=$1`, [id(51)])), "22023");

    // Delayed confirmations belong to the signed occurrence day, even when
    // delivered today. Older proof formats have unknown day, never fake today.
    const yesterday = (await one("select ((now() at time zone 'UTC')::date - 1)::text as yesterday")).yesterday;
    await event(55, { verified: true, timestamps: true, confirmedAt: `${yesterday}T23:59:00.000Z` });
    equal(await counters(), { total: 4, today: 3, legacy: 0 });
    await event(56, { verified: true });
    equal(await counters(), { total: 5, today: 3, legacy: 0 });
    equal((await one("select verified_summaries::int from public.verified_summary_daily_usage where install_id=$1 and usage_date=$2::date", [install, yesterday])).verified_summaries, 1);
    const usage = await one("select verified_summaries::int, verified_today_summaries::int, verified_unknown_day_summaries::int from public.user_summary_usage where install_id=$1", [install]);
    equal(usage, { verified_summaries: 5, verified_today_summaries: 3, verified_unknown_day_summaries: 1 });

    await event(57, { status: "started" });
    await rejectsCode(() => asRole("service_role", () => db.query("update public.transfer_events set terminal_received_at=now() where attempt_id=$1", [id(57)])), "23514");
    await rejectsCode(() => asRole("service_role", () => db.query("update public.transfer_events set summary_received_at=now() where attempt_id=$1", [id(57)])), "23514");
    await db.query("update public.transfer_events set updated_at = now() - interval '25 hours' where attempt_id=$1", [id(57)]);
    equal((await one("select reported_outcome from public.transfer_event_outcomes where attempt_id=$1", [id(57)])).reported_outcome, "outcome_unknown");
    equal((await outcome(57)).status, "started");
    await event(57, {});
    equal((await one("select reported_outcome from public.transfer_event_outcomes where attempt_id=$1", [id(57)])).reported_outcome, "succeeded");
    equal(await counters(), { total: 5, today: 3, legacy: 0 });

    // Test the unchanged scheduled SQL and the dynamic reporting distinction.
    equal((await one("select count(*)::int as count from cron.job")).count, 1);
    const job = await one("select schedule, command from cron.job");
    equal(job.schedule, "0 0 * * *");
    await db.query("update public.users set today_date=$1::date, today_summaries=0 where install_id=$2", [yesterday, install]);
    await event(58, { verified: true, timestamps: true, confirmedAt: `${yesterday}T20:00:00.000Z` });
    equal(await counters(), { total: 6, today: 0, legacy: 0 });
    await db.query("update public.users set today_date=$1::date, today_summaries=1 where install_id=$2", [yesterday, install]);
    await db.exec(job.command);
    equal(await counters(), { total: 6, today: 0, legacy: 0 });
    equal((await one("select verified_today_summaries::int from public.user_summary_usage where install_id=$1", [install])).verified_today_summaries, 3);
    await rejectsCode(() => db.query("update public.users set today_summaries=-1 where install_id=$1", [install]), "23514");
    await rejectsCode(() => db.query("update public.users set today_summaries=total_summaries+1 where install_id=$1", [install]), "23514");
    // Old workers may already have acknowledged progress before an extension
    // upgrade. A genuine newer worker can complete the same core attempt.
    await event(59, { status: "started", version: "1.4.6" });
    await event(59, { status: "started", stage: "summary_completed", version: "1.4.7",
      verified: true, timestamps: true, confirmedAt });
    equal((await one("select extension_version from public.transfer_events where attempt_id=$1", [id(59)])).extension_version, "1.4.6");
    equal((await outcome(59)).summary_verified, true);
    equal(await counters(), { total: 7, today: 1, legacy: 0 });

    await db.exec("create table public.future_private_table (id int); create sequence public.future_private_sequence; create function public.future_private_function() returns int language sql as 'select 1';");
    for (const role of ["anon", "authenticated"]) {
      await asRole(role, async () => {
        for (const relation of ["transfer_events", "users", "transfer_event_outcomes", "verified_summary_daily_usage", "user_summary_usage", "future_private_table"])
          await rejectsCode(() => db.query(`select * from public.${relation}`), "42501");
        await rejectsCode(() => db.query("select public.future_private_function()"), "42501");
        await rejectsCode(() => db.query("select nextval('public.future_private_sequence')"), "42501");
        await rejectsCode(() => db.query(`select public.record_transfer_event($1::uuid, $2::text, now(), 'claude', 'chatgpt', 1, 'succeeded', 'completed', null, '1.4.6')`, [id(999), install]), "42501");
        await rejectsCode(() => db.query("update public.transfer_events set summary_verified=true"), "42501");
      });
    }
    await asRole("service_role", async () => {
      for (const relation of ["transfer_events", "users"]) {
        await rejectsCode(() => db.query(`delete from public.${relation}`), "42501");
        await rejectsCode(() => db.query(`truncate public.${relation}`), "42501");
      }
      await rejectsCode(() => db.query("select * from public.future_private_table"), "42501");
      await rejectsCode(() => db.query("select public.future_private_function()"), "42501");
      await db.query("select * from public.user_summary_usage"); checks++;
    });
    equal((await one("select count(*)::int as count from pg_policies where schemaname='public'")).count, 0);
    equal((await one("select count(*)::int as count from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('transfer_events','users') and c.relrowsecurity")).count, 2);
    equal((await one("select count(*)::int as count from pg_indexes where schemaname='public' and indexname='transfer_events_install_id_idx'")).count, 0);
    const plan = await db.query("explain (format json) select attempt_id from public.transfer_events where install_id=$1 order by attempted_at desc limit 50", [install]);
    // Tiny fixtures can legitimately use seqscan. Require the retained index
    // to support both filtering and order when an indexed plan is requested.
    await db.exec("set enable_seqscan=off;");
    const indexedPlan = await db.query("explain (format json) select attempt_id from public.transfer_events where install_id=$1 order by attempted_at desc limit 50", [install]);
    assert.match(JSON.stringify(indexedPlan.rows), /transfer_events_install_id_attempted_at_idx/); checks++;
    const { checkSnapshot } = require("./check-telemetry-backup.js");
    const upgradeOptions = { applyPending: true, throughVersion: "20261002073711" };
    const restoredBackup = await checkSnapshot(legacySnapshot, upgradeOptions);
    equal(restoredBackup.originalValuesPreserved, true);
    equal(restoredBackup.capturedMigrations, 10);
    equal(restoredBackup.pendingMigrations, 3);
    equal(restoredBackup.transferEvents, legacySnapshot.transfer_events.length);
    equal(restoredBackup.users, legacySnapshot.users.length);
    // Supabase CLI migration history stores parsed statements without trailing
    // semicolons, whereas MCP can store one whole SQL file. Replay both formats.
    const splitStatementSnapshot = { ...legacySnapshot, migrations: legacySnapshot.migrations.map((migration, index) => {
      if (index !== 0) return migration;
      const statements = migration.statements[0]
        .split(/;\s*(?=(?:create index|alter table|create policy)\b)/i)
        .map(sql => sql.trim().replace(/;$/, ""));
      assert.ok(statements.length > 1, "Fixture must contain distinct unterminated SQL statements");
      return { ...migration, statements };
    }) };
    const restoredSplitBackup = await checkSnapshot(splitStatementSnapshot, upgradeOptions);
    equal(restoredSplitBackup.originalValuesPreserved, true);
    equal(restoredSplitBackup.originalColumnHashes, restoredBackup.originalColumnHashes);
    const { checkMinimalUsers } = require("./check-minimal-users-db.js");
    for (const name of names.filter(name => name.slice(0, 14) > "20261002073711")) {
      const sql = fs.readFileSync(path.join(directory, name), "utf8");
      appliedMigrations.push({ version: name.slice(0, 14), name: name.slice(15, -4), statements: [sql] });
      if (name.endsWith("_minimal_users_and_reset.sql")) checks += await checkMinimalUsers(db, sql, appliedMigrations);
      else if (name.endsWith("_format_users_and_famous_names.sql")) {
        checks += await require("./check-users-format-db.js").checkUsersFormat(db, sql);
      } else if (name.endsWith("_users_daily_ist.sql")) {
        checks += await require("./check-users-ist-db.js").checkUsersIst(db, sql);
      } else if (name.endsWith("_exclude_empty_chat_user_failures.sql")) {
        checks += await require("./check-empty-chat-users-db.js").checkEmptyChatUsers(db, sql);
      } else if (name.endsWith("_remove_unused_user_summary_usage.sql")
        || name.endsWith("_remove_unused_verified_summary_daily_usage.sql")
        || name.endsWith("_remove_unused_transfer_event_outcomes.sql")) {
        const removedView = name.endsWith("_remove_unused_user_summary_usage.sql")
          ? "user_summary_usage" : name.endsWith("_remove_unused_verified_summary_daily_usage.sql")
            ? "verified_summary_daily_usage" : "transfer_event_outcomes";
        // Earlier checks intentionally exercise the view at historical migration
        // boundaries; the current schema removes it without changing persistence.
        const beforeRemoval = (await db.query(`select
          (select jsonb_agg(to_jsonb(u) order by user_no) from public.users u) as users,
          (select jsonb_agg(to_jsonb(e) order by id) from public.transfer_events e) as events,
          (select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j) as jobs,
          (select jsonb_build_object('last',last_value::text,'called',is_called) from public.users_user_no_seq) as sequence,
          pg_get_functiondef('public.record_user_summary()'::regprocedure) as counter`)).rows;
        // Prove the exact migration refuses dependencies rather than dropping
        // them. This fixture and all checks run locally only when requested.
        await db.exec(`create view public.removal_dependency_fixture as select * from public.${removedView};`);
        await rejectsCode(() => db.exec(sql), "2BP01");
        await db.exec("rollback; drop view public.removal_dependency_fixture;");
        await db.exec(sql);
        equal((await one("select to_regclass($1) as removed", [`public.${removedView}`])).removed, null);
        equal((await db.query(`select
          (select jsonb_agg(to_jsonb(u) order by user_no) from public.users u) as users,
          (select jsonb_agg(to_jsonb(e) order by id) from public.transfer_events e) as events,
          (select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j) as jobs,
          (select jsonb_build_object('last',last_value::text,'called',is_called) from public.users_user_no_seq) as sequence,
          pg_get_functiondef('public.record_user_summary()'::regprocedure) as counter`)).rows, beforeRemoval);
        await asRole("service_role", async () => {
          await db.query("select * from public.users limit 0");
          await db.query("select * from public.transfer_events limit 0");
          if (removedView === "user_summary_usage") await db.query("select * from public.verified_summary_daily_usage limit 0");
          if (removedView !== "transfer_event_outcomes") await db.query("select * from public.transfer_event_outcomes limit 0");
          checks++;
        });
      } else if (name.endsWith("_simplify_transfers.sql")) {
        checks += await require("./check-transfers-db.js").checkTransfers(db, sql, appliedMigrations);
      } else if (name.endsWith("_finalize_database_cleanup.sql")) {
        const preserved = async () => (await db.query(`select
          (select jsonb_agg(to_jsonb(t) order by attempt_id) from public.transfers t) as transfers,
          (select jsonb_agg(to_jsonb(u) order by user_no) from public.users u) as users,
          (select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j) as jobs,
          (select jsonb_build_object('last',last_value::text,'called',is_called) from public.users_user_no_seq) as sequence,
          (select jsonb_agg(jsonb_build_object('oid',oid,'acl',relacl,'rls',relrowsecurity) order by oid)
            from pg_class where oid in ('public.users'::regclass,'public.transfers'::regclass)) as security`)).rows;
        const before = await preserved();
        const definition = async () => (await one("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql")).sql;
        const cutoff = (await definition()).match(/new.received_at < '([^']+)'::timestamptz/)[1];
        await db.exec(sql);
        equal(await preserved(), before);
        const counter = await definition();
        equal(counter.match(/new.received_at < '([^']+)'::timestamptz/)[1], cutoff);
        // The local engine has one connection: inspect this critical ordering;
        // actual lock waits across midnight require a multi-session check later.
        assert.ok(counter.indexOf("'cap-context-users-allocation'") < counter.indexOf("today := (clock_timestamp()")); checks++;
        equal((await one("select count(*)::int as n from pg_constraint where conrelid='public.transfers'::regclass and conname='transfers_status_check'")).n, 0);
        const triggers = (await db.query("select pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid='public.transfers'::regclass and tgname like '%record_user_summary' order by tgname")).rows;
        equal(triggers.length, 2);
        for (const trigger of triggers) { assert.ok(trigger.definition.includes("no_conversation")); checks++; }
        await rejectsCode(() => asRole("service_role", () => db.query(`select public.record_transfer_event(
          'ffffffff-ffff-4fff-8fff-000000000001'::uuid,'final-invalid',now(),'claude','chatgpt',0,
          'invalid','capture_started',null,'1.4.7')`)), "23514");

        // Exercise countable transitions through the unchanged real RPC;
        // empty diagnostics must still be kept without allocating any user.
        const finalInstall = "final-cleanup-install";
        const finalCounts = async () => one("select lifetime_summaries::int as lifetime,today_summaries::int as today,today_failed_attempts::int as failed,today_date=(clock_timestamp() at time zone 'Asia/Kolkata')::date as current_day from public.users where install_id=$1", [finalInstall]);
        const finalReport = (number, status, stage, failure, verified = false) => asRole("service_role", () => db.query(`select public.record_transfer_event(
          $1::uuid,$2::text,'2026-10-02T00:00:00Z'::timestamptz,'claude','chatgpt',1,
          $3::text,$4::text,$5::text,'1.4.7',$6::boolean,null,
          case when $6::boolean then clock_timestamp() else null end)`,
          [`ffffffff-ffff-4fff-8fff-${String(number).padStart(12, "0")}`, finalInstall, status, stage, failure, verified]));
        await finalReport(2, "failed", "capture_started", "no_conversation");
        equal(await finalCounts(), undefined);
        await finalReport(3, "failed", "capture_started", "capture_failed");
        equal(await finalCounts(), { lifetime: 0, today: 0, failed: 1, current_day: true });
        await finalReport(3, "failed", "capture_started", "capture_failed");
        equal(await finalCounts(), { lifetime: 0, today: 0, failed: 1, current_day: true });
        await finalReport(3, "failed", "capture_started", "capture_failed", true);
        equal(await finalCounts(), { lifetime: 1, today: 1, failed: 1, current_day: true });
        await db.query("update public.users set today_date=(clock_timestamp() at time zone 'Asia/Kolkata')::date-1 where install_id=$1", [finalInstall]);
        await finalReport(4, "failed", "capture_started", "capture_failed");
        equal(await finalCounts(), { lifetime: 1, today: 0, failed: 1, current_day: true });
      } else if (name.endsWith("_remove_transfer_reporting_timestamps.sql")) {
        checks += await require("./check-minimal-transfers-db.js").checkMinimalTransfers(db, sql, appliedMigrations);
      } else if (name.endsWith("_add_served_model_to_transfers.sql")) {
        checks += await require("./check-served-model-db.js").checkServedModel(db, sql);
      } else if (name.endsWith("_reuse_exhausted_user_names.sql")) {
        checks += await require("./check-user-name-reuse-db.js").checkUserNameReuse(db, sql);
      } else if (name.endsWith("_name_ling_space_bunny_2.sql")) {
        checks += await require("./check-served-model-db.js").checkServedModelLabel(db, sql);
      } else await db.exec(sql);
    }
    checks += await require("./check-served-model-db.js").checkStoreModelReceipts(db);
    console.log(`PASS: ${names.length} real migrations replayed; ${checks} database correctness, data preservation, attribution and privilege checks.`);
    console.log(`Per-install default plan: ${JSON.stringify(plan.rows[0]["QUERY PLAN"][0].Plan["Node Type"])}; retained composite index verified.`);
    console.log("Local pg_cron catalog shim: scheduled SQL tested; hosted scheduling and concurrent sessions require deployment verification.");
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
