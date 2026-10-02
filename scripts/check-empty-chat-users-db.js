const assert = require("node:assert/strict");

async function checkEmptyChatUsers(db, sql) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const one = async (query, args = []) => (await db.query(query, args)).rows[0];
  const id = n => `dddddddd-dddd-4ddd-8ddd-${String(n).padStart(12, "0")}`;
  async function report(n, install, reason, verified = false) {
    await db.exec("set role service_role;");
    try {
      await db.query(`select public.record_transfer_event($1::uuid,$2,'2026-10-02 00:00:00+00'::timestamptz,'claude','chatgpt',0,
        'failed','capture_started',$3,'1.4.7',$4,null,case when $4 then now() else null end)`,
      [id(n), install, reason, verified]);
    } finally { await db.exec("reset role;"); }
  }
  await report(1, "empty-only-before", "no_conversation");
  await report(2, "mixed-before", "capture_failed", true);
  await report(3, "mixed-before", "no_conversation");
  const stable = await one("select user_no::text,name,lifetime_summaries::text,today_summaries::text from public.users where install_id='mixed-before'");
  const events = (await db.query("select to_jsonb(e) as row from public.transfer_events e order by id")).rows;
  const original = (await one("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql")).sql;
  const cutoff = original.match(/new.received_at < '([^']+)'::timestamptz/)[1];
  const sequence = await one("select last_value::text,is_called from public.users_user_no_seq");
  await db.exec(sql);
  equal((await db.query("select to_jsonb(e) as row from public.transfer_events e order by id")).rows, events);
  equal(await one("select last_value::text,is_called from public.users_user_no_seq"), sequence);
  equal((await one("select count(*)::int as n from public.users where install_id='empty-only-before'")).n, 0);
  equal(await one("select user_no::text,name,lifetime_summaries::text,today_summaries::text from public.users where install_id='mixed-before'"), stable);
  equal((await one("select today_failed_attempts::int as n from public.users where install_id='mixed-before'")).n, 1);
  equal((await one("select failed_transfers::int as n from public.user_summary_usage where install_id='mixed-before'")).n, 1);
  const counter = (await one("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql")).sql;
  equal(counter.match(/new.received_at < '([^']+)'::timestamptz/)[1], cutoff);
  await report(4, "empty-only-after", "no_conversation");
  await report(4, "empty-only-after", "no_conversation");
  equal((await one("select count(*)::int as n from public.users where install_id='empty-only-after'")).n, 0);
  await report(5, "mixed-before", "no_conversation");
  equal((await one("select today_failed_attempts::int as n from public.users where install_id='mixed-before'")).n, 1);
  await report(6, "empty-only-after", "capture_failed");
  await report(6, "empty-only-after", "capture_failed");
  equal((await one("select today_failed_attempts::int as n from public.users where install_id='empty-only-after'")).n, 1);
  // Started -> empty terminal update follows the same rule as terminal INSERT.
  await db.query(`select public.record_transfer_event($1::uuid,'empty-update','2026-10-02 00:00:00+00'::timestamptz,'claude','chatgpt',null,
    'started','capture_started',null,'1.4.7')`, [id(7)]);
  await report(7, "empty-update", "no_conversation");
  equal((await one("select count(*)::int as n from public.users where install_id='empty-update'")).n, 0);
  console.log(`PASS: ${checks} empty-chat exclusion, cleanup, duplicate/update and real-failure preservation checks.`);
  return checks;
}
module.exports = { checkEmptyChatUsers };
