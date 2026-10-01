// Local migration verification with PGlite; never connects to a hosted database.
// Install @electric-sql/pglite@0.3.14 outside the checkout and set PGLITE_MODULE_PATH.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || "@electric-sql/pglite");

async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      -- Supabase supplies these default table grants outside the repo migrations.
      alter default privileges in schema public grant all on tables to service_role;
      create schema cron;
      create table cron.job (jobid bigint, jobname text);
      create function cron.unschedule(bigint) returns boolean language sql as 'select true';
      create function cron.schedule(text, text, text) returns bigint language sql as 'select 1::bigint';
    `);
    const migrations = path.join(__dirname, "..", "supabase", "migrations");
    for (const name of fs.readdirSync(migrations).filter(name => name.endsWith(".sql")).sort()) {
      const sql = fs.readFileSync(path.join(migrations, name), "utf8")
        .replace("create extension if not exists pg_cron with schema pg_catalog;", "-- Local pg_cron catalog shim; scheduling itself is not tested.");
      await db.exec(sql);
    }
    const install = "22222222-2222-4222-8222-222222222222";
    let checks = 0;
    async function event(id, verified, { installId = install, status = "succeeded", stage = "completed", legacy = false } = {}) {
      await db.exec("set role service_role;");
      try {
        await db.query(`select public.record_transfer_event($1::uuid, $2::text, '2026-10-02T00:00:00Z'::timestamptz,
          'claude'::text, 'chatgpt'::text, 50::integer, $3::text, $4::text, $5::text, '1.4.6'::text${legacy ? "" : ", $6::boolean"})`,
          [id, installId, status, stage, status === "failed" ? "paste_failed" : null, ...(legacy ? [] : [verified])]);
      } finally { await db.exec("reset role;"); }
    }
    const id = number => `11111111-1111-4111-8111-${String(number).padStart(12, "0")}`;
    const counters = async () => (await db.query("select coalesce(sum(total_summaries), 0)::integer as total, count(*)::integer as installs from public.users")).rows[0];
    // Original attack: fifty synthetic successes cannot create users or summaries.
    for (let i = 1; i <= 50; i++) await event(id(i), false, { legacy: i % 2 === 0 });
    assert.deepEqual(await counters(), { total: 0, installs: 0 }); checks++;
    await event(id(51), true);
    assert.deepEqual(await counters(), { total: 1, installs: 1 }); checks++;
    for (let i = 0; i < 10; i++) await event(id(51), true);
    assert.deepEqual(await counters(), { total: 1, installs: 1 }); checks++;
    // A terminal failed paste must not suppress later proof of completed server work.
    await event(id(52), false, { status: "failed", stage: "paste_started" });
    await event(id(52), true, { status: "started", stage: "summary_completed" });
    assert.deepEqual(await counters(), { total: 2, installs: 1 }); checks++;
    const failed = (await db.query("select status, summary_verified from public.transfer_events where attempt_id = $1", [id(52)])).rows[0];
    assert.deepEqual(failed, { status: "failed", summary_verified: true }); checks++;
    // A proof for a different installation cannot promote a pre-existing row.
    await event(id(53), false);
    await event(id(53), true, { installId: "33333333-3333-4333-8333-333333333333" });
    assert.deepEqual(await counters(), { total: 2, installs: 1 }); checks++;
    // Earlier unsigned success can receive genuine confirmation exactly once.
    await event(id(1), true);
    await event(id(1), false);
    assert.deepEqual(await counters(), { total: 3, installs: 1 }); checks++;
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role};`);
      try {
        await assert.rejects(db.query(`select public.record_transfer_event($1::uuid, $2::text, now(),
          'claude'::text, 'chatgpt'::text, 1::integer, 'succeeded'::text, 'completed'::text, null::text, '1.4.6'::text, true)`, [id(99), install]), /permission denied/);
        await assert.rejects(db.query("update public.transfer_events set summary_verified = true"), /permission denied/);
      } finally { await db.exec("reset role;"); }
      checks++;
    }
    console.log(`PASS: all 11 migrations replayed; ${checks} verified-count, replay, identity and permission checks passed.`);
    console.log("Local pg_cron catalog shim used; hosted gateway and scheduled execution not tested.");
  } finally { await db.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
