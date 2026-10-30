const assert = require("node:assert/strict");
const { checkDiagnosticsSamples } = require("./check-diagnostics-samples");

async function checkPasteEditorDiagnostics(db, sql) {
  const definition = async () => (await db.query("select pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure) value")).rows[0].value;
  const before = await definition();
  const snapshot = async () => (await db.query(`select jsonb_build_object(
    'transfers',(select jsonb_agg(to_jsonb(t) order by attempt_id) from public.transfers t),
    'users',(select jsonb_agg(to_jsonb(u) order by install_id) from public.users u),
    'access',(select proacl::text from pg_proc where oid='public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure)) value`)).rows[0].value;
  const retained = await snapshot();
  await db.exec(sql);
  assert.deepEqual(await snapshot(), retained);
  const pattern = /rules constant jsonb := '([^']+)'::jsonb/;
  const after = await definition();
  assert.equal(after.replace(pattern, "RULES"), before.replace(pattern, "RULES"));
  const oldRules = JSON.parse(before.match(pattern)[1]);
  const newRules = JSON.parse(after.match(pattern)[1]);
  assert.deepEqual(newRules, require("../extension/transfer-diagnostics").schema);
  const samples = [{ label: "old report", value: { version: 1 }, expected: true }];
  for (const [key, rule] of Object.entries(newRules)) {
    if (key in oldRules) continue;
    for (const value of rule.type === "number" ? [0, 2147483647, -1, 0.5, 2147483648, "PRIVATE"] : [true, false, 1, "PRIVATE", null]) {
      for (const nested of [false, true]) {
        const fields = { version: 1, [key]: value };
        samples.push({ label: `${key} nested=${nested}`, value: nested ? { version: 1, prepared_diagnostics: fields } : fields,
          expected: rule.type === "number" ? Number.isInteger(value) && value >= 0 && value <= 2147483647 : typeof value === "boolean" });
      }
    }
  }
  return 3 + await checkDiagnosticsSamples(db, samples);
}
module.exports = { checkPasteEditorDiagnostics };
