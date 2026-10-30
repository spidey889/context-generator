const assert = require("node:assert/strict");
const contract = require("../extension/transfer-diagnostics.js");
const { checkDiagnosticsSamples } = require("./check-diagnostics-samples.js");

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
  const historicalRules = JSON.parse(sql.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]);
  // The later file-limit migration extends this enum. Keep this historical
  // replay check tied to the contract that existed when this migration shipped.
  const historicalContract = require("./diagnostics-history").withoutPasteEditorFields(contract.schema);
  delete historicalContract.large_summary_requests;
  delete historicalContract.recovery_events;
  historicalContract.summary_failed_provider.values = historicalContract.summary_failed_provider.values.filter(provider => provider !== "tokenharbor");
  delete historicalContract.json_attempts;
  delete historicalContract.destination_auth_prompt;
  delete historicalContract.summary_response_failures;
  historicalContract.capture_detail.values = historicalContract.capture_detail.values.filter(value => !["attachment_size_limit", "invalid_utf8"].includes(value));
  equal(historicalRules, historicalContract);
  const samples = [];
  // Keep sparse root/prepared acceptance independent. Complete records would
  // hide accidental dependencies between otherwise optional observations.
  for (const key of ["failure_site", "error_type", "error_file", "capture_detail", "capture_request_stage", "summary_failure_detail", "summary_failed_provider"]) {
    const values = historicalRules[key].values;
    for (const value of new Set([values[0], values.at(-1)])) {
      samples.push({ label: `root ${key}: ${value}`, value: { version: 1, [key]: value }, expected: true });
      samples.push({ label: `prepared ${key}: ${value}`, value: { version: 1, prepared_diagnostics: { version: 1, [key]: value } }, expected: true });
    }
    samples.push({ label: `root ${key} rejects private text`, value: { version: 1, [key]: "PRIVATE URL/text" }, expected: false });
    samples.push({ label: `prepared ${key} rejects private text`, value: { version: 1, prepared_diagnostics: { version: 1, [key]: "PRIVATE URL/text" } }, expected: false });
  }
  const report = { version: 1, error_code: "capture_json_failed", failure_site: "capture_session", capture_detail: "http_error", capture_http_status: 403, error_type: "Error" };
  samples.push({ label: "complete capture failure", value: report, expected: true });
  samples.push({ label: "legacy minimal diagnostics", value: { version: 1 }, expected: true });
  for (const status of [99, 600, 403.5]) samples.push({ label: `invalid HTTP status ${status}`, value: { ...report, capture_http_status: status }, expected: false });
  samples.push({ label: "negative error line", value: { ...report, error_line: -1 }, expected: false });
  samples.push({ label: "private stack text", value: { ...report, stack: "PRIVATE" }, expected: false });
  checks += await checkDiagnosticsSamples(db, samples);
  equal((await db.query(`select has_function_privilege('anon','public.is_valid_transfer_diagnostics(jsonb,integer)','execute') as anon,
    has_function_privilege('authenticated','public.is_valid_transfer_diagnostics(jsonb,integer)','execute') as authenticated,
    has_function_privilege('service_role','public.is_valid_transfer_diagnostics(jsonb,integer)','execute') as service`)).rows[0], { anon: false, authenticated: false, service: true });
  return checks;
}
async function checkAttachmentSizeFailure(db, sql, expectedReason = "Combined text files exceeded the 2.1 MB limit before download.") {
  let checks = 0;
  const equal = (a, b) => { assert.deepEqual(a, b); checks++; };
  const snapshot = async () => (await db.query(`select jsonb_build_object(
    'transfers',(select jsonb_agg(to_jsonb(t)-'file_size_failure_reason' order by attempt_id) from public.transfers t),
    'users',(select jsonb_agg(to_jsonb(u) order by install_id) from public.users u),
    'access',(select jsonb_agg(jsonb_build_array(relacl::text,relrowsecurity) order by oid)
      from pg_class where oid in ('public.transfers'::regclass,'public.users'::regclass)),
    'function_access',(select proacl::text from pg_proc where oid='public.is_valid_transfer_diagnostics(jsonb,integer)'::regprocedure)
  ) as value`)).rows[0].value;
  const before = await snapshot();
  await db.exec(sql);
  equal(await snapshot(), before);
  equal((await db.query("select attempt_id::text,file_size_failure_reason from public.transfers where file_size_failure_reason is not null order by attempt_id")).rows,
    (before.transfers || []).filter(transfer => transfer.diagnostics?.capture_detail === "attachment_size_limit")
      .map(transfer => ({ attempt_id: transfer.attempt_id, file_size_failure_reason: expectedReason })));
  equal((await db.query("select public.is_valid_transfer_diagnostics($1::jsonb) as valid", [JSON.stringify({ version: 1, capture_detail: "attachment_size_limit", capture_request_stage: "attachment_descriptor" })])).rows[0].valid, true);
  equal((await db.query("select public.is_valid_transfer_diagnostics($1::jsonb) as valid", [JSON.stringify({ version: 1, capture_detail: "PRIVATE" })])).rows[0].valid, false);
  const installId = (await db.query("select install_id from public.users limit 1")).rows[0].install_id;
  const report = (number, detail) => db.query(`select public.record_transfer_event(
        p_attempt_id => $1::uuid, p_install_id => $2::text, p_attempted_at => now(),
        p_source_platform => 'chatgpt', p_destination_platform => 'claude', p_character_count => null,
        p_status => 'failed', p_last_stage => 'capture_started', p_failure_reason => 'conversation_too_large',
        p_extension_version => '1.4.16', p_diagnostics => $3::jsonb)`,
    [`aaaaaaaa-aaaa-4aaa-8aaa-${String(number).padStart(12, "0")}`, installId,
      JSON.stringify({ version: 1, capture_detail: detail, capture_request_stage: "attachment_descriptor" })]);
  await db.exec("begin;");
  try {
    for (const [index, detail] of ["attachment_size_limit", "size_limit", "attachment_failed"].entries()) {
      const attemptId = `aaaaaaaa-aaaa-4aaa-8aaa-${String(900 + index).padStart(12, "0")}`;
      await report(900 + index, detail);
      equal((await db.query("select file_size_failure_reason from public.transfers where attempt_id=$1", [attemptId])).rows[0].file_size_failure_reason,
        index === 0 ? expectedReason : null);
    }
  } finally { await db.exec("rollback;"); }
  equal(await snapshot(), before);
  // The next file-size migration's backup upgrade restores this generated
  // column and compares its hash before removing it; no extra restore here.
  // Keep one populated old label across the next real migration. Its before/
  // after comparison above must now prove recomputation, not just NULL labels.
  if (expectedReason !== "file size") await report(990, "attachment_size_limit");
  return checks;
}
module.exports = { checkUsefulDiagnostics, checkAttachmentSizeFailure };
