const assert = require("node:assert/strict");
const { validate } = require("../supabase/functions/_shared/request-location");
const { checkDiagnosticsSamples } = require("./check-diagnostics-samples");
async function checkRequestLocation(db, sql) {
  const snapshot = async () => (await db.query(`select jsonb_build_object(
    'transfers',(select md5(jsonb_agg(to_jsonb(t) order by attempt_id)::text) from public.transfers t),
    'users',(select md5(jsonb_agg(to_jsonb(u) order by install_id)::text) from public.users u),
    'access',(select jsonb_agg(jsonb_build_array(oid::regprocedure::text,proacl::text) order by oid) from pg_proc where pronamespace='public'::regnamespace)) value`)).rows[0].value;
  const before = await snapshot(); await db.exec(sql); assert.deepEqual(await snapshot(), before);
  const unknown = { country: "unknown", region: "unknown", city: "unknown" }, known = { country: "BR", region: "SP", city: "São Paulo" };
  const samples = [unknown, known, { ...known, city: "東京" }, { ...known, city: "हैदराबाद" }, { ...known, city: "District 1" },
    { ...known, country: "US\n" }, { ...known, region: "SP\n" }, { ...known, city: "City\nSecret" },
    { ...known, city: "192.0.2.5" }, { ...known, city: "IP 192.0.2.5" }, { ...known, city: "https://secret" },
    { ...known, city: "x".repeat(81) }, { ...known, ip: "192.0.2.5" }, { ...known, latitude: 12 }, null];
  let checks = 1 + await checkDiagnosticsSamples(db, samples.map(location => ({ label: "location " + JSON.stringify(location),
    value: { version: 1, location }, expected: validate(location) !== null })));
  checks += await checkDiagnosticsSamples(db, [{ label: "legacy", value: { version: 1 }, expected: true },
    { label: "nested location", value: { version: 1, prepared_diagnostics: { version: 1, location: known } }, expected: false }]);
  await db.exec("begin; set local role service_role;");
  try {
    const id = "c0de5731-0000-4000-8000-000000000001", install = "c0de5731-0000-4000-8000-000000000002", at = new Date().toISOString();
    const send = diagnostics => db.query(`select public.record_transfer_event($1::uuid,$2::text,$3::timestamptz,
      'claude','chatgpt',500,'failed','capture_started','capture_failed','1.4.36',false,null,null,null,null,$4::jsonb)`,
      [id, install, at, JSON.stringify(diagnostics)]);
    const get = async () => (await db.query("select to_jsonb(t) value from public.transfers t where attempt_id=$1", [id])).rows[0].value;
    await send({ version: 1, location: known });
    const terminal = await get(), counters = (await db.query("select to_jsonb(u) value from public.users u where install_id=$1", [install])).rows;
    // A terminal event with server location only still accepts its one late client snapshot.
    await send({ version: 1, capture_method: "structured", location: unknown });
    const enriched = await get();
    assert.deepEqual(enriched.diagnostics, { version: 1, capture_method: "structured", location: known }); checks++;
    assert.deepEqual({ ...enriched, diagnostics: terminal.diagnostics }, terminal); checks++;
    await send({ version: 1, capture_method: "claude-json" });
    assert.deepEqual(await get(), enriched); checks++;
    assert.deepEqual((await db.query("select to_jsonb(u) value from public.users u where install_id=$1", [install])).rows, counters); checks++;
  } finally { await db.exec("rollback;"); }
  return checks;
}
module.exports = { checkRequestLocation };
