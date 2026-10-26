const assert = require("node:assert/strict");
const contract = require("../extension/transfer-diagnostics");

async function checkTokenHarbor(db, sql, model = "claude-haiku-5.5:free") {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const rows = async query => (await db.query(query)).rows;
  const snapshot = async () => ({
    transfers: await rows("select to_jsonb(t) as row from public.transfers t order by attempt_id"),
    users: await rows("select to_jsonb(u) as row from public.users u order by install_id"),
    access: await rows("select oid::regclass::text,relacl::text,relrowsecurity from pg_class where oid in ('public.transfers'::regclass,'public.users'::regclass) order by oid"),
    functions: await rows("select proname,prosecdef,proacl::text,proconfig from pg_proc where oid in ('public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb)'::regprocedure,'public.is_valid_transfer_diagnostics(jsonb,integer)'::regprocedure) order by oid")
  });
  const before = await snapshot();
  await db.exec(sql);
  equal(await snapshot(), before);
  const definition = (await rows("select pg_get_functiondef('public.is_valid_transfer_diagnostics(jsonb,integer)'::regprocedure) as sql"))[0].sql;
  // The minimal auth clue is added by a later migration, checked separately.
  const historicalSchema = structuredClone(contract.schema);
  historicalSchema.capture_detail.values = historicalSchema.capture_detail.values.filter(value => value !== "invalid_utf8");
  delete historicalSchema.destination_auth_prompt;
  equal(JSON.parse(definition.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]), historicalSchema);
  equal(await rows(`select public.is_valid_transfer_diagnostics('{"version":1,"summary_failed_provider":"tokenharbor"}') as valid,
    public.is_valid_transfer_diagnostics('{"version":1,"summary_failed_provider":"PRIVATE"}') as invalid`), [{ valid: true, invalid: false }]);
  // Exercise the new reported model through the real role/RPC. Reporting cannot
  // grant a summary count; a later authenticated receipt can upgrade it once.
  await db.exec("begin; set local role service_role;");
  try {
    const report = verified => db.query(`select public.record_transfer_event(
      'c0de5714-0000-4000-8000-000000000001'::uuid,'c0de5714-0000-4000-8000-000000000002','2026-10-14T00:00:00Z'::timestamptz,
      'chatgpt','claude',12000,'started','summary_completed',null,'1.4.18',${verified},null,
      ${verified ? "'2026-10-14T00:00:00Z'::timestamptz" : "null"},$1::text,
      $2::text,'{"version":1,"summary_failed_provider":"tokenharbor"}'::jsonb)`, [verified ? model : null, model]);
    await report(false);
    equal(await rows("select model,model_verified,summary_verified from public.transfers where attempt_id='c0de5714-0000-4000-8000-000000000001'"),
      [{ model, model_verified: false, summary_verified: false }]);
    const count = () => rows("select lifetime_summaries::int as total from public.users where install_id='c0de5714-0000-4000-8000-000000000002'");
    equal(await count(), [{ total: 0 }]);
    await report(true);
    equal(await rows("select model_verified,summary_verified from public.transfers where attempt_id='c0de5714-0000-4000-8000-000000000001'"), [{ model_verified: true, summary_verified: true }]);
    equal(await count(), [{ total: 1 }]);
    await report(true);
    equal(await count(), [{ total: 1 }]);
  } finally { await db.exec("rollback"); }
  equal(await snapshot(), before);
  return checks;
}

module.exports = { checkTokenHarbor };
