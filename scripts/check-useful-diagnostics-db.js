const assert = require("node:assert/strict");
const contract = require("../extension/transfer-diagnostics.js");

async function checkUsefulDiagnostics(db, sql) {
  let checks = 0;
  const equal = (a, b) => { assert.deepEqual(a, b); checks++; };
  const snapshot = async () => (await db.query(`select jsonb_build_object(
    'transfers',(select jsonb_agg(to_jsonb(t) order by attempt_id) from public.transfers t),
    'users',(select jsonb_agg(to_jsonb(u) order by install_id) from public.users u),
    'access',(select jsonb_agg(jsonb_build_array(oid::text,relacl::text,relrowsecurity) order by oid)
      from pg_class where oid in ('public.transfers'::regclass,'public.users'::regclass)),
    'function_access',(select proacl::text from pg_proc where oid='public.is_valid_transfer_diagnostics(jsonb,integer)'::regprocedure)
  ) as value`)).rows[0].value;
  const before = await snapshot();
  await db.exec(sql);
  equal(await snapshot(), before);
  equal(JSON.parse(sql.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]), contract.schema);
  const valid = async value => (await db.query("select public.is_valid_transfer_diagnostics($1::jsonb) as valid", [JSON.stringify(value)])).rows[0].valid;
  // Every new observation must survive both final and prepared recovery records.
  for (const key of ["failure_site", "error_type", "error_file", "capture_detail", "capture_request_stage", "summary_failure_detail", "summary_failed_provider"]) {
    for (const value of contract.schema[key].values) {
      equal(await valid({ version: 1, [key]: value, prepared_diagnostics: { version: 1, [key]: value } }), true);
    }
    equal(await valid({ version: 1, [key]: "PRIVATE URL/text" }), false);
  }
  const report = { version: 1, error_code: "capture_json_failed", failure_site: "capture_session", capture_detail: "http_error", capture_http_status: 403, error_type: "Error" };
  equal(await valid(report), true);
  equal(await valid({ version: 1 }), true);
  for (const status of [99, 600, -1, 403.5]) equal(await valid({ ...report, capture_http_status: status }), false);
  equal(await valid({ ...report, error_line: -1 }), false);
  equal(await valid({ ...report, stack: "PRIVATE" }), false);
  equal((await db.query(`select has_function_privilege('anon','public.is_valid_transfer_diagnostics(jsonb,integer)','execute') as anon,
    has_function_privilege('authenticated','public.is_valid_transfer_diagnostics(jsonb,integer)','execute') as authenticated,
    has_function_privilege('service_role','public.is_valid_transfer_diagnostics(jsonb,integer)','execute') as service`)).rows[0], { anon: false, authenticated: false, service: true });
  return checks;
}
module.exports = { checkUsefulDiagnostics };
