const assert = require("node:assert/strict");
const contract = require("../extension/transfer-diagnostics.js");
const { checkDiagnosticsSamples } = require("./check-diagnostics-samples.js");

async function checkJsonCaptureDiagnostics(db, sql) {
  const before = (await db.query("select md5(coalesce(jsonb_agg(to_jsonb(t))::text,'')) as hash from public.transfers t")).rows;
  await db.exec(sql);
  assert.deepEqual((await db.query("select md5(coalesce(jsonb_agg(to_jsonb(t))::text,'')) as hash from public.transfers t")).rows, before);
  assert.deepEqual(JSON.parse(sql.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]), contract.schema);
  assert.deepEqual(JSON.parse(sql.match(/attempt_rules constant jsonb := '([^']+)'::jsonb/)[1]), contract.jsonAttemptSchema);
  const attempt = { outcome: "failed", mode: "prefetch", failure_check: "raw_total_stream_limit", failure_value: 6000001,
    failure_limit: 6000000, failure_value_source: "reader_bytes", raw_bytes: 6000001, raw_limit_bytes: 6000000 };
  const report = value => ({ version: 1, diagnostics_revision: 3, json_attempts: value });
  const samples = [
    { label: "legacy diagnostics", value: { version: 1, capture_detail: "attachment_size_limit" }, expected: true },
    { label: "JSON success and failure", value: report([attempt, { outcome: "succeeded", mode: "retry" }]), expected: true },
    { label: "two attempts maximum", value: report([attempt, attempt, attempt]), expected: false },
    { label: "missing outcome", value: report([{ mode: "fresh" }]), expected: false }
  ];
  for (const [key, rule] of Object.entries(contract.jsonAttemptSchema)) {
    for (const value of rule.values || [rule.min || 0, rule.max]) samples.push({ label: `observation ${key}`, value: report([{ ...attempt, [key]: value }]), expected: true });
    samples.push({ label: `private/invalid ${key}`, value: report([{ ...attempt, [key]: "PRIVATE text/url/token" }]), expected: false });
    if (rule.type === "number") for (const value of [-1, 0.5, rule.max + 1]) samples.push({ label: `number boundary ${key}`, value: report([{ ...attempt, [key]: value }]), expected: false });
  }
  for (const key of ["text", "filename", "url", "token", "stack"]) samples.push({ label: `private key ${key}`, value: report([{ ...attempt, [key]: "PRIVATE" }]), expected: false });
  return 3 + await checkDiagnosticsSamples(db, samples);
}
module.exports = { checkJsonCaptureDiagnostics };
