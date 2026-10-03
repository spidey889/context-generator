const assert = require("node:assert/strict");

// Runs at the real 24 -> 25 cutover, with nonempty data from earlier gates.
async function checkServedModel(db, sql) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const rows = async (query, params = []) => (await db.query(query, params)).rows;
  const one = async (query, params = []) => (await rows(query, params))[0];
  const rejects = async (operation, code) => { await assert.rejects(operation, error => error.code === code); checks++; };
  const asRole = async (role, operation) => {
    await db.exec(`set role ${role}`);
    try { return await operation(); } finally { await db.exec("reset role"); }
  };
  const snapshot = async () => ({
    transfers: await rows("select to_jsonb(t)-'model' as row from public.transfers t order by attempt_id"),
    users: await rows("select to_jsonb(u) as row from public.users u order by install_id"),
    sequence: await rows("select last_value,is_called from public.users_user_no_seq"),
    cron: await rows("select to_jsonb(j) as row from cron.job j order by jobid"),
    counter: await rows("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql"),
    indexes: await rows("select indexdef from pg_indexes where schemaname='public' and tablename='transfers' order by indexname"),
    triggers: await rows("select pg_get_triggerdef(oid) as definition from pg_trigger where tgrelid='public.transfers'::regclass and not tgisinternal order by tgname"),
    constraints: await rows("select conname,pg_get_constraintdef(oid) as definition from pg_constraint where conrelid='public.transfers'::regclass and conname<>'transfers_model_verified' order by conname"),
    notes: await rows("select attname,col_description(attrelid,attnum) as note from pg_attribute where attrelid='public.transfers'::regclass and attnum>0 and not attisdropped and attname<>'model' order by attname"),
    security: await rows("select pg_get_userbyid(relowner) as owner,relrowsecurity,relforcerowsecurity,relacl::text,relreplident from pg_class where oid='public.transfers'::regclass")
  });
  const before = await snapshot();
  // Unexpected dependent views must abort the entire copy/swap, not disappear.
  await db.exec("create view public.model_dependency_probe as select attempt_id from public.transfers");
  await rejects(() => db.exec(sql), "2BP01");
  await db.exec("rollback");
  equal(await snapshot(), before);
  equal((await one("select to_regclass('public.transfers_model')::text as staging")).staging, null);
  await db.exec("drop view public.model_dependency_probe");
  await db.exec(sql);
  equal(await snapshot(), before);
  equal((await one("select count(*)::int as n from public.transfers where model is not null")).n, 0);
  equal((await one("select to_regclass('public.transfers_model')::text as staging")).staging, null);
  const columns = (await rows("select column_name from information_schema.columns where table_schema='public' and table_name='transfers' order by ordinal_position")).map(row => row.column_name);
  equal(columns[columns.indexOf("character_count") + 1], "model");
  equal(columns.length, 14);
  equal((await one("select count(*)::int as n from pg_proc where pronamespace='public'::regnamespace and proname='record_transfer_event'")).n, 1);

  const install = "served-model-check";
  // Keep these attempts distinct from fixtures retained by earlier migration gates.
  const id = n => `abcdabcd-abcd-4abc-8abc-${String(n).padStart(12, "0")}`;
  const confirmed = new Date().toISOString();
  const report = (n, overrides = {}) => {
    const event = { status: "started", stage: "summary_completed", failure: null, verified: true,
      confirmed, model: "inclusionai/ling-3.1-flash", ...overrides };
    return asRole("service_role", () => db.query(`select public.record_transfer_event(
      $1::uuid,$2::text,'2026-10-03T00:00:00Z'::timestamptz,'claude','chatgpt',50,
      $3::text,$4::text,$5::text,'1.4.8',$6::boolean,null,$7::timestamptz,$8::text)`,
    [id(n), install, event.status, event.stage, event.failure, event.verified, event.confirmed, event.model]));
  };
  const model = async n => (await one("select model from public.transfers where attempt_id=$1", [id(n)])).model;
  const counts = () => one("select lifetime_summaries::int as total,today_failed_attempts::int as failed from public.users where install_id=$1", [install]);
  await report(1);
  equal(await model(1), "inclusionai/ling-3.1-flash");
  equal(await counts(), { total: 1, failed: 0 });
  await report(1, { model: "local-direct" });
  await report(1, { verified: false, confirmed: null, model: null });
  equal(await model(1), "inclusionai/ling-3.1-flash");
  equal(await counts(), { total: 1, failed: 0 });
  await rejects(() => asRole("service_role", () => db.query("update public.transfers set model='local-direct' where attempt_id=$1", [id(1)])), "22023");
  await report(2, { status: "failed", stage: "paste_started", failure: "paste_failed", verified: false, confirmed: null, model: null });
  await report(2, { model: "gemini-3.5-flash-lite" });
  equal(await model(2), "gemini-3.5-flash-lite");
  equal((await one("select status,failure_reason from public.transfers where attempt_id=$1", [id(2)])), { status: "failed", failure_reason: "paste_failed" });
  equal(await counts(), { total: 2, failed: 1 });
  await report(3, { model: null }); // v2: same authenticated completion can supply its missing model.
  const legacyCounts = await counts();
  await report(3, { model: "local-direct" });
  equal(await model(3), "local-direct");
  equal(await counts(), legacyCounts);
  await report(4, { model: null });
  await report(4, { model: "local-direct", confirmed: "2026-10-04T00:00:00Z" });
  equal(await model(4), null, "a later regeneration is not the first served summary");
  await report(5, { model: null, confirmed: null }); // v1: unknown first completion cannot be inferred.
  await report(5);
  equal(await model(5), null);
  for (const change of [{ verified: false }, { confirmed: null }, { model: "private text" }, { model: "" }, { model: "x".repeat(161) }]) {
    await rejects(() => report(6, change), "23514");
  }
  for (const role of ["anon", "authenticated"]) {
    await rejects(() => asRole(role, () => db.query("select * from public.transfers")), "42501");
    await rejects(() => asRole(role, () => db.query(`select public.record_transfer_event(
      $1::uuid,$2::text,now(),'claude','chatgpt',50,'succeeded','completed',null,'1.4.8')`, [id(7), install])), "42501");
  }
  await rejects(() => asRole("service_role", () => db.query("delete from public.transfers where attempt_id=$1", [id(1)])), "42501");
  // Defaulted new argument keeps every historical positional arity callable.
  for (let arity = 10; arity <= 13; arity++) {
    const suffix = ["true", "null", "null"].slice(0, arity - 10).join(",");
    await asRole("service_role", () => db.query(`select public.record_transfer_event(
      $1::uuid,$2::text,'2026-10-03T00:00:00Z'::timestamptz,'claude','chatgpt',50,
      'succeeded','completed',null,'1.4.8'${suffix ? "," + suffix : ""})`, [id(arity), install]));
    equal(await model(arity), null);
  }
  console.log(`PASS: ${checks} served-model cutover, preservation, receipt-order, legacy and private-access checks.`);
  return checks;
}
module.exports = { checkServedModel };
