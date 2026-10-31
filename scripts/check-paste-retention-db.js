const assert = require("node:assert/strict");
const { checkDiagnosticsSamples } = require("./check-diagnostics-samples");
async function checkPasteRetention(db, sql) {
  const state = async () => (await db.query(`select jsonb_build_object(
    'transfers',(select md5(jsonb_agg(to_jsonb(t) order by attempt_id)::text) from public.transfers t),
    'users',(select md5(jsonb_agg(to_jsonb(u) order by install_id)::text) from public.users u),
    'access',(select jsonb_agg(jsonb_build_array(oid::text,proacl::text,prosecdef,proconfig) order by oid)
      from pg_proc where oid in ('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure,
      'public.merge_transfer_recovery_events(jsonb,jsonb)'::regprocedure))) value`)).rows[0].value;
  const before = await state(); await db.exec(sql); assert.deepEqual(await state(), before);
  const def = (await db.query("select pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure) value")).rows[0].value;
  assert.deepEqual(JSON.parse(def.match(/recovery_rules constant jsonb := '([^']+)'::jsonb/)[1]), require("../extension/transfer-diagnostics").recoveryEventSchema);
  const base = { surface: "retention", side: "destination", at_ms: 50 };
  const good = [{ ...base, event: "retention_ok" }, { ...base, event: "retention_recovered" },
    { ...base, event: "retention_user_handled", cause: "user" },
    { ...base, event: "retention_unknown", reason: "editor_missing", cause: "unknown" },
    { ...base, event: "retention_failed", reason: "editor_detached", cause: "page" },
    { ...base, event: "retention_failed", reason: "insertion_exception", cause: "extension" }];
  const samples = good.map(entry => ({ label: entry.event, expected: true, value: { version: 1, recovery_events: [entry] } }));
  for (const change of [{ cause: "user" }, { cause: "unknown" }, { cause: null }, { reason: "PRIVATE" }, { method: "clipboard" }, { side: "source" }])
    samples.push({ label: "invalid attribution", expected: false, value: { version: 1, recovery_events: [{ ...good[4], ...change }] } });
  let checks = 2 + await checkDiagnosticsSamples(db, samples);
  await db.exec("begin; set local role service_role;");
  try {
    const attempt = 'c0de5731-0000-4000-8000-000000000004';
    const send = diagnostics => db.query(`select public.record_transfer_event($1::uuid,'c0de5731-0000-4000-8000-000000000005',now(),
      'claude','gemini',100,'succeeded','completed',null,'1.4.36',false,null,null,null,'local-direct',$2::jsonb)`, [attempt, JSON.stringify(diagnostics)]);
    await send({ version: 1, paste_populated: true });
    const counters = async () => (await db.query("select to_jsonb(u) value from public.users u where install_id='c0de5731-0000-4000-8000-000000000005'")).rows[0].value;
    const counted = await counters();
    for (const entry of good) await send({ version: 1, recovery_events: [entry] });
    const saved = (await db.query("select status,failure_reason,diagnostics from public.transfers where attempt_id=$1", [attempt])).rows[0];
    assert.equal(saved.status, "succeeded"); assert.equal(saved.failure_reason, null);
    assert.equal(saved.diagnostics.paste_populated, true); assert.equal(saved.diagnostics.recovery_events.length, good.length);
    assert.deepEqual(await counters(), counted); checks += 5;
  } finally { await db.exec("rollback; reset role;"); }
  return checks;
}
module.exports = { checkPasteRetention };
