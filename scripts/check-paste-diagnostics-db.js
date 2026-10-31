const assert = require("node:assert/strict");
const { checkDiagnosticsSamples } = require("./check-diagnostics-samples");
async function checkPasteDiagnostics(db, sql, keys) {
  const definition = async () => (await db.query("select pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure) value")).rows[0].value;
  const snapshot = async () => (await db.query(`select jsonb_build_object(
    'transfers',(select md5(jsonb_agg(to_jsonb(t) order by attempt_id)::text) from public.transfers t),
    'users',(select md5(jsonb_agg(to_jsonb(u) order by install_id)::text) from public.users u),
    'access',(select proacl::text from pg_proc where oid='public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure)) value`)).rows[0].value;
  const before = await definition(), retained = await snapshot();
  await db.exec(sql);
  assert.deepEqual(await snapshot(), retained);
  const after = await definition(), pattern = /rules constant jsonb := '([^']+)'::jsonb/;
  assert.equal(after.replace(pattern, "RULES"), before.replace(pattern, "RULES"));
  const schema = require("../extension/transfer-diagnostics").schema;
  assert.deepEqual(JSON.parse(after.match(pattern)[1]), { ...JSON.parse(before.match(pattern)[1]),
    ...Object.fromEntries(keys.map(key => [key, schema[key]])) });
  const samples = [{ label: "legacy", value: { version: 1 }, expected: true }];
  for (const key of keys) for (const value of [...(schema[key].values || [true, false]), "PRIVATE", null]) {
    const fields = { version: 1, [key]: value };
    samples.push({ label: key, value: { ...fields, prepared_diagnostics: fields },
      expected: schema[key].values ? schema[key].values.includes(value) : typeof value === "boolean" });
  }
  return 3 + await checkDiagnosticsSamples(db, samples);
}
module.exports = { checkPasteDiagnostics };
