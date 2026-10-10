const assert = require("node:assert/strict");

async function checkClipboardTransfers(db, sql) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const one = async (query, args = []) => (await db.query(query, args)).rows[0];
  const snapshot = () => one(`select
    (select jsonb_agg(to_jsonb(t) order by attempt_id) from public.transfers t) as transfers,
    (select jsonb_agg(to_jsonb(u) order by user_no) from public.users u) as users,
    (select jsonb_agg(jsonb_build_object('oid',oid,'acl',relacl,'rls',relrowsecurity) order by oid)
     from pg_class where oid in ('public.users'::regclass,'public.transfers'::regclass)) as security`);
  const before = await snapshot();
  await db.exec(sql);
  equal(await snapshot(), before);
  await db.exec('begin');
  try {
    const install = 'clipboard-regression';
    const time = new Date().toISOString();
    const id = n => 'c0c1c000-0000-4000-8000-' + String(n).padStart(12, '0');
    const report = async (n, changes = {}) => {
      const e = { source: 'chatgpt', destination: 'clipboard', status: 'succeeded', verified: false,
        reported: 'local-direct', model: null, ...changes };
      await db.exec('set role service_role');
      try {
        await db.query(`select public.record_transfer_event($1::uuid,$2::text,$3::timestamptz,
          $4::text,$5::text,50,$6::text,$7::text,$8::text,'1.4.12',$9::boolean,null,
          $10::timestamptz,$11::text,$12::text)`, [id(n),install,time,e.source,e.destination,e.status,
          e.status === 'succeeded' ? 'completed' : 'paste_started',
          e.status === 'failed' ? 'paste_failed' : null,e.verified,e.verified ? time : null,e.model,e.reported]);
      } finally { await db.exec('reset role').catch(() => {}); }
    };
    const counts = () => one('select lifetime_summaries::int as total,today_summaries::int as today,today_failed_attempts::int as failed from public.users where install_id=$1',[install]);
    await report(1, { status: 'started' });
    equal(await counts(), { total: 0,today: 0,failed: 0 });
    const identity = await one('select user_no,name from public.users where install_id=$1',[install]);
    assert.ok(identity.user_no && identity.name); checks++;
    await report(1);
    await report(1);
    equal(await counts(), { total: 1,today: 1,failed: 0 });
    equal(await one('select destination_platform,status,last_stage,summary_verified,model_verified from public.transfers where attempt_id=$1',[id(1)]),
      { destination_platform: 'clipboard',status: 'succeeded',last_stage: 'completed',summary_verified: false,model_verified: false });
    await report(2, { verified: true,model: 'gemini-3.6-flash',reported: 'gemini-3.6-flash' });
    await report(2, { verified: true,model: 'gemini-3.6-flash',reported: 'gemini-3.6-flash' });
    equal(await counts(), { total: 2,today: 2,failed: 0 });
    await report(3, { status: 'failed',verified: true,model: 'gemini-3.6-flash',reported: 'gemini-3.6-flash' });
    await report(3, { status: 'failed',verified: true,model: 'gemini-3.6-flash',reported: 'gemini-3.6-flash' });
    equal(await counts(), { total: 3,today: 3,failed: 1 });
    await report(4, { status: 'failed' });
    await report(4);
    equal(await counts(), { total: 3,today: 3,failed: 2 });
    equal((await one('select status from public.transfers where attempt_id=$1',[id(4)])).status,'failed');
    // A clipboard route must not relax source or unknown-destination validation.
    for (const changes of [{ source: 'clipboard' },{ destination: 'unknown' }]) {
      await db.exec('savepoint invalid_route');
      await assert.rejects(report(5, changes), error => error.code === '23514'); checks++;
      await db.exec('rollback to savepoint invalid_route');
    }
    for (const role of ['anon','authenticated']) {
      equal((await one("select has_table_privilege($1,'public.transfers','INSERT') as allowed",[role])).allowed,false);
    }
  } finally { await db.exec('rollback'); }
  equal(await snapshot(), before);
  console.log(`PASS: ${checks} clipboard route, local/proven summary counters, terminal immutability and preservation checks.`);
  return checks;
}
module.exports = { checkClipboardTransfers };
