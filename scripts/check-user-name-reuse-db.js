const assert = require("node:assert/strict");

// Replay at the actual migration boundary. Fixtures never reach a hosted DB.
async function checkUserNameReuse(db, sql) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const rows = async (query, params = []) => (await db.query(query, params)).rows;
  const one = async (query, params = []) => (await rows(query, params))[0];
  const asService = async operation => {
    await db.exec("set role service_role");
    try { return await operation(); } finally { await db.exec("reset role"); }
  };
  const snapshot = async () => ({
    users: await rows("select to_jsonb(u) as row from public.users u order by user_no"),
    transfers: await rows("select to_jsonb(t) as row from public.transfers t order by attempt_id"),
    sequence: await rows("select last_value,is_called from public.users_user_no_seq"),
    cron: await rows("select to_jsonb(j) as row from cron.job j order by jobid"),
    counter: await rows("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql"),
    security: await rows(`select oid,relrowsecurity,relforcerowsecurity,relacl::text from pg_class
      where oid in ('public.users'::regclass,'public.transfers'::regclass) order by oid`),
    functions: await rows("select oid,proacl::text,prosecdef from pg_proc where pronamespace='public'::regnamespace order by oid")
  });
  const before = await snapshot();
  await db.exec(sql);
  equal(await snapshot(), before);
  equal((await one("select count(*)::int as n from pg_constraint where conrelid='public.users'::regclass and conname='users_name_key'")).n, 0);

  await db.exec("begin");
  try {
    const pool = (await one("select public.naruto_user_names() as pool")).pool;
    const startNo = (await one("select coalesce(max(user_no),0)::int as n from public.users")).n;
    const id = n => `f00df00d-f00d-4f00-8f00-${String(n).padStart(12, "0")}`;
    const install = n => `name-pool-regression-${n}`;
    const attempted = new Date().toISOString(), confirmed = new Date().toISOString();
    const report = (n, verified = false) => asService(() => db.query(`select public.record_transfer_event(
      $1::uuid,$2::text,$4::timestamptz,'claude','chatgpt',50,
      'failed','paste_started','paste_failed','1.4.8',$3::boolean,null,
      case when $3::boolean then $5::timestamptz else null end,
      case when $3::boolean then 'local-direct' else null end)`, [id(n), install(n), verified, attempted, confirmed]));
    // Unsigned failures previously exhausted the pool and rolled back the next
    // legitimate counted transfer. Exercise more than TWO complete pools.
    const count = pool.length * 2 + 3;
    for (let n = 1; n <= count; n++) await report(n);
    const allocated = await rows(`select user_no::int as number,name,lifetime_summaries::int as total,
      today_failed_attempts::int as failed from public.users where install_id like 'name-pool-regression-%' order by user_no`);
    equal(allocated.length, count);
    equal(allocated.map(row => row.number), Array.from({ length: count }, (_, i) => startNo + i + 1));
    assert.ok(allocated.every(row => pool.includes(row.name) && row.total === 0 && row.failed === 1)); checks++;
    assert.ok(new Set(allocated.map(row => row.name)).size < allocated.length); checks++;
    equal((await one("select count(*)::int as n from public.transfers where install_id like 'name-pool-regression-%'")).n, count);
    equal((await one(`select count(*)::int as n from pg_catalog.unnest(public.naruto_user_names()) pool(name)
      where not exists(select 1 from public.users u where u.name=pool.name)`)).n, 0);

    // A new signed summary, duplicate deliveries and an old client arity must
    // continue counting correctly after all names are occupied.
    await report(count + 1, true);
    await report(count + 1, true);
    const verified = await one("select lifetime_summaries::int as total,today_summaries::int as today,today_failed_attempts::int as failed from public.users where install_id=$1", [install(count + 1)]);
    equal(verified, { total: 1, today: 1, failed: 1 });
    await asService(() => db.query(`select public.record_transfer_event(
      $1::uuid,$2::text,clock_timestamp(),'claude','chatgpt',50,'failed','capture_started','capture_failed','1.4.7')`,
      [id(count + 2), install(count + 2)]));
    equal((await one("select today_failed_attempts::int as n from public.users where install_id=$1", [install(count + 2)])).n, 1);
    // Preserve unique identity and the existing closed name allowlist.
    equal((await one("select count(*)=count(distinct install_id) and count(*)=count(distinct user_no) as unique_identity from public.users")).unique_identity, true);
    equal((await one("select count(*)::int as n from pg_constraint where conrelid='public.users'::regclass and conname in ('users_name_check','users_name_in_pool')")).n, 2);
    for (const role of ["anon", "authenticated"]) {
      equal((await one("select has_table_privilege($1,'public.users','INSERT') as allowed", [role])).allowed, false);
      equal((await one(`select has_function_privilege($1,
        'public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text)', 'EXECUTE') as allowed`, [role])).allowed, false);
    }
  } finally {
    await db.exec("rollback");
    // Defaults call nextval before the allocation trigger chooses max+1.
    // Sequence changes survive rollback; restore this LOCAL fixture's advances.
    await db.query("select pg_catalog.setval('public.users_user_no_seq'::regclass,$1::bigint,$2::boolean)",
      [before.sequence[0].last_value, before.sequence[0].is_called]);
  }
  equal(await snapshot(), before);
  return checks;
}
module.exports = { checkUserNameReuse };
