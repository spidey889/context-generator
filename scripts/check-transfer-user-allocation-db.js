const assert = require("node:assert/strict");

// Runs at the new migration boundary; historical allocation rules stay tested
// at their original boundaries by the existing replay helpers.
async function checkTransferUserAllocation(db, sql) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const rows = async (query, params = []) => (await db.query(query, params)).rows;
  const one = async (query, params = []) => (await rows(query, params))[0];
  const snapshot = async () => ({
    transfers: await rows("select to_jsonb(t)-'user_no'-'username' as row from public.transfers t order by attempt_id"),
    users: await rows("select to_jsonb(u) as row from public.users u order by install_id"),
    security: await rows("select relname,relacl::text,relrowsecurity from pg_class where oid in ('public.transfers'::regclass,'public.users'::regclass) order by relname"),
    counter: await rows("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql"),
    cron: await rows("select to_jsonb(j) as row from cron.job j order by jobid")
  });
  const id = n => `a110ca7e-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const attempted = new Date().toISOString();
  const report = async (n, install, status = "started", verified = false, reason = null) => {
    await db.exec("set role service_role");
    try {
      await db.query(`select public.record_transfer_event($1::uuid,$2::text,$3::timestamptz,
        'deepseek','chatgpt',50,$4::text,$5::text,$6::text,'1.4.11',$7::boolean,null,
        case when $7 then $3::timestamptz else null end)`,
      [id(n), install, attempted, status, status === "succeeded" ? "completed" : "capture_started", reason, verified]);
    } catch (error) {
      // An aborted transaction rejects RESET; the caller's savepoint restores
      // the role. Keep the original constraint/identity error for assertions.
      await db.exec("reset role").catch(() => {});
      throw error;
    }
    await db.exec("reset role");
  };
  const counts = install => one(`select lifetime_summaries::int as total,today_summaries::int as today,
    today_failed_attempts::int as failed from public.users where install_id=$1`, [install]);
  const identity = install => one("select user_no::text,name from public.users where install_id=$1", [install]);
  const unlinked = async () => (await one(`select count(*)::int as n from public.transfers t left join public.users u using(install_id)
    where u.install_id is null or row(t.user_no,t.username) is distinct from row(u.user_no,u.name)`)).n;
  const zero = { total: 0, today: 0, failed: 0 };

  await report(1, "allocation-old-started");
  await report(2, "allocation-old-local", "succeeded");
  await report(3, "allocation-old-empty", "failed", false, "no_conversation");
  equal(await identity("allocation-old-started"), undefined);
  const before = await snapshot();
  const missing = await rows("select distinct t.install_id from public.transfers t where not exists(select 1 from public.users u where u.install_id=t.install_id)");
  await db.exec(sql);
  const after = await snapshot();
  equal(after.transfers, before.transfers);
  equal(after.security, before.security);
  equal(after.counter, before.counter);
  equal(after.cron, before.cron);
  equal(after.users.filter(u => before.users.some(b => b.row.install_id === u.row.install_id)), before.users);
  equal(after.users.length, before.users.length + missing.length);
  equal(await unlinked(), 0);
  for (const { install_id } of missing) equal(await counts(install_id), zero);

  await db.exec("begin");
  try {
    const startNo = (await one("select max(user_no)::int as n from public.users")).n;
    await report(4, "allocation-new");
    const first = await identity("allocation-new");
    equal(Number(first.user_no), startNo + 1);
    equal(await counts("allocation-new"), zero);
    await report(4, "allocation-new");
    await report(5, "allocation-new", "succeeded");
    equal(await identity("allocation-new"), first);
    equal(await counts("allocation-new"), zero);
    await report(6, "allocation-empty", "failed", false, "no_conversation");
    equal(await counts("allocation-empty"), zero);
    await report(4, "allocation-new", "failed", true, "capture_failed");
    await report(4, "allocation-new", "failed", true, "capture_failed");
    equal(await identity("allocation-new"), first);
    equal(await counts("allocation-new"), { total: 1, today: 1, failed: 1 });

    // A rejected attempt must roll back its provisional identity too.
    await db.exec("savepoint rejected_identity");
    await assert.rejects(() => report(4, "allocation-wrong-install"), error => error.code === "22023"); checks++;
    await db.exec("rollback to savepoint rejected_identity");
    equal(await identity("allocation-wrong-install"), undefined);
    await db.exec("savepoint invalid_status");
    await assert.rejects(() => report(7, "allocation-invalid", "invalid"), error => error.code === "23514"); checks++;
    await db.exec("rollback to savepoint invalid_status");
    equal(await identity("allocation-invalid"), undefined);

    // Exhaust the cosmetic pool using start-only transfers, not counted work.
    const pool = (await one("select public.naruto_user_names() as names")).names;
    for (let n = 0; n <= pool.length; n++) await report(100 + n, `allocation-pool-${n}`);
    equal((await one("select count(*)::int as n from public.users where install_id like 'allocation-pool-%'")).n, pool.length + 1);
    equal(await counts(`allocation-pool-${pool.length}`), zero);
    equal(await unlinked(), 0);
    equal((await one("select count(*)=count(distinct install_id) and count(*)=count(distinct user_no) as unique_ids from public.users")).unique_ids, true);
    equal((await one("select bool_and(name=any(public.naruto_user_names())) as valid from public.users where install_id like 'allocation-%'")).valid, true);
    for (const role of ["anon", "authenticated"]) {
      equal((await one("select has_table_privilege($1,'public.users','INSERT') or has_table_privilege($1,'public.transfers','INSERT') as allowed", [role])).allowed, false);
      equal((await one("select has_function_privilege($1,'public.assign_transfer_user_labels()','EXECUTE') as allowed", [role])).allowed, false);
    }
    // Reset/deletion remains intentional; the next RPC retry restores labels
    // without replaying the terminal attempt's already-counted outcome.
    await db.query("delete from public.users where install_id=$1", ["allocation-new"]);
    equal(await identity("allocation-new"), undefined);
    await report(4, "allocation-new", "failed", true, "capture_failed");
    equal(await counts("allocation-new"), zero);
    equal(await unlinked(), 0);
  } finally { await db.exec("rollback"); }
  console.log(`PASS: ${checks} transfer-start allocation, backfill, counter, retry, name-pool and private-access checks.`);
  return checks;
}
module.exports = { checkTransferUserAllocation };
