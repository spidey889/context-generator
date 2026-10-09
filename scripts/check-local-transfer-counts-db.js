const assert = require("node:assert/strict");

async function checkLocalTransferCounts(db, sql) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
  const id = n => '10ca1c00-0000-4000-8000-' + String(n).padStart(12, '0');
  const attempted = new Date().toISOString();
  const install = 'local-counts-regression';
  const counts = async (who = install) => one('select lifetime_summaries::int as total,today_summaries::int as today,today_failed_attempts::int as failed from public.users where install_id=$1', [who]);
  const report = async (n, changes = {}) => {
    const e = { who: install, status: 'succeeded', reported: 'local-direct', verified: false, model: null, time: attempted, confirmed: attempted, ...changes };
    await db.exec('set role service_role');
    try {
      await db.query(`select public.record_transfer_event($1::uuid,$2::text,$3::timestamptz,
        'chatgpt','claude',50,$4::text,$5::text,$6::text,'1.4.12',$7::boolean,null,
        $8::timestamptz,$9::text,$10::text)`, [id(n), e.who, e.time, e.status,
        e.status === 'succeeded' ? 'completed' : 'paste_started', e.status === 'failed' ? 'paste_failed' : null,
        e.verified, e.verified ? e.confirmed : null, e.model, e.reported]);
    } finally { await db.exec('reset role'); }
  };
  const snapshot = async () => one(`select
    (select jsonb_agg(to_jsonb(t) order by attempt_id) from public.transfers t) as transfers,
    (select jsonb_agg(to_jsonb(u) order by user_no) from public.users u) as users,
    (select jsonb_agg(to_jsonb(j) order by jobid) from cron.job j) as jobs,
    (select jsonb_build_object('last',last_value::text,'called',is_called) from public.users_user_no_seq) as sequence,
    (select jsonb_agg(jsonb_build_object('oid',oid,'acl',relacl,'rls',relrowsecurity) order by oid)
      from pg_class where oid in ('public.users'::regclass,'public.transfers'::regclass)) as security`);
  const definition = async () => (await one("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql")).sql;
  await report(1);
  await report(2, { status: 'started' });
  equal(await counts(), { total: 0, today: 0, failed: 0 });
  const before = await snapshot();
  const originalCutoff = (await definition()).match(/new\.received_at < '([^']+)'/)[1];
  await db.exec(sql);
  equal(await snapshot(), before);
  equal((await definition()).match(/new\.received_at < '([^']+)'/)[1], originalCutoff);
  const deployedDefinition = await definition();
  await db.exec(sql);
  equal(await definition(), deployedDefinition);
  equal(await snapshot(), before);

  await db.exec('begin');
  try {
    // No history replay, including old pending work and later model reports.
    await report(1);
    await report(2);
    equal(await counts(), { total: 0, today: 0, failed: 0 });
    await report(3);
    equal(await counts(), { total: 1, today: 1, failed: 0 });
    equal(await one('select summary_verified,model_verified from public.transfers where attempt_id=$1', [id(3)]), { summary_verified: false, model_verified: false });
    await report(3);
    equal(await counts(), { total: 1, today: 1, failed: 0 });
    await report(4, { status: 'started' });
    equal(await counts(), { total: 1, today: 1, failed: 0 });
    await report(4);
    await report(4);
    equal(await counts(), { total: 2, today: 2, failed: 0 });
    // Late verified attribution may correct a local report, but never count twice.
    await report(3, { verified: true, model: 'gemini-3.6-flash' });
    equal(await counts(), { total: 2, today: 2, failed: 0 });
    await report(5, { reported: 'gemini-3.6-flash' });
    equal(await counts(), { total: 2, today: 2, failed: 0 });
    await report(5, { verified: true, model: 'gemini-3.6-flash' });
    equal(await counts(), { total: 3, today: 3, failed: 0 });
    await report(6, { reported: null });
    equal(await counts(), { total: 3, today: 3, failed: 0 });
    await report(6);
    equal(await counts(), { total: 4, today: 4, failed: 0 });
    await report(7, { status: 'failed' });
    await report(7, { status: 'failed' });
    equal(await counts(), { total: 4, today: 4, failed: 1 });
    await report(8, { status: 'failed', verified: true, model: 'gemini-3.6-flash' });
    equal(await counts(), { total: 5, today: 5, failed: 2 });
    // Client attempt dates do not control the trusted local delivery day.
    await report(9, { time: new Date(Date.now() - 86400000).toISOString() });
    equal(await counts(), { total: 6, today: 6, failed: 2 });
    await report(10, { verified: true, model: 'gemini-3.6-flash', confirmed: new Date(Date.now() - 86400000).toISOString() });
    equal(await counts(), { total: 7, today: 6, failed: 2 });
    // An authentic proof on a pre-deployment local attempt retains old behavior.
    await report(1, { verified: true, model: 'gemini-3.6-flash' });
    equal(await counts(), { total: 8, today: 7, failed: 2 });
    // Lazy daily rollover and the existing cron command retain lifetime counts.
    await db.query("update public.users set today_date=today_date-1 where install_id=$1", [install]);
    await report(11);
    equal(await counts(), { total: 9, today: 1, failed: 0 });
    const reset = await one("select command from cron.job where jobname='cap-context-reset-daily-user-summaries'");
    assert.ok(reset, 'Daily reset job remains present'); checks++;
    await db.query("update public.users set today_date=today_date-1 where install_id=$1", [install]);
    await db.exec(reset.command);
    equal(await counts(), { total: 9, today: 0, failed: 0 });
    for (const role of ['anon', 'authenticated']) {
      equal((await one("select has_table_privilege($1,'public.users','INSERT') or has_table_privilege($1,'public.transfers','INSERT') or has_function_privilege($1,'public.record_user_summary()','EXECUTE') as allowed", [role])).allowed, false);
    }
  } finally { await db.exec('rollback'); }
  console.log('PASS: ' + checks + ' prospective local-transfer counting, duplicate/proof, IST reset, preservation and privilege checks.');
  return checks;
}
module.exports = { checkLocalTransferCounts };
