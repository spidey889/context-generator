const assert = require("node:assert/strict");
const contract = require("../extension/transfer-diagnostics.js");
const { checkDiagnosticsSamples } = require("./check-diagnostics-samples.js");

async function checkJsonCaptureDiagnostics(db, sql, previousSql = null) {
  const attemptRulesDeclaration = /attempt_rules constant jsonb := '([^']+)'::jsonb/;
  const attemptRules = structuredClone(contract.jsonAttemptSchema);
  if (!sql.includes('"raw_response_stream_limit"')) attemptRules.failure_check.values = attemptRules.failure_check.values
    .filter(value => !["raw_response_stream_limit", "raw_remaining_files_limit"].includes(value));
  const attempt = { outcome: "failed", mode: "prefetch", failure_check: "raw_total_stream_limit", failure_value: 6000001,
    failure_limit: 6000000, failure_value_source: "reader_bytes", raw_bytes: 6000001, raw_limit_bytes: 6000000 };
  const report = value => ({ version: 1, diagnostics_revision: 3, json_attempts: value });
  let checks = 0;
  let addedSamples;
  if (previousSql) {
    // The full matrix already ran on the original validator. Only skip it
    // when the actual SQL implementation and grants are still identical.
    const unchangedSql = value => value.replace(attemptRulesDeclaration, "attempt_rules declaration").replace(/\r\n/g, "\n");
    assert.equal(unchangedSql(sql), unchangedSql(previousSql), "Label-only migration must retain the tested validator and grants");
    const previousRules = JSON.parse(previousSql.match(attemptRulesDeclaration)[1]);
    const addedLabels = attemptRules.failure_check.values.filter(value => !previousRules.failure_check.values.includes(value));
    assert.deepEqual(addedLabels, ["raw_response_stream_limit", "raw_remaining_files_limit"]);
    assert.deepEqual({ ...previousRules, failure_check: attemptRules.failure_check }, attemptRules);
    checks += 3;
    addedSamples = addedLabels.map(value => ({
      label: `new failure check ${value}`, value: report([{ ...attempt, failure_check: value }]), expected: true
    }));
    checks += await checkDiagnosticsSamples(db, addedSamples.map(sample => ({ ...sample, expected: false })));
  }

  const before = (await db.query("select md5(coalesce(jsonb_agg(to_jsonb(t))::text,'')) as hash from public.transfers t")).rows;
  await db.exec(sql);
  assert.deepEqual((await db.query("select md5(coalesce(jsonb_agg(to_jsonb(t))::text,'')) as hash from public.transfers t")).rows, before);
  // These historical migrations precede the additive TokenHarbor provider label.
  // Its later migration verifies the complete current schema separately.
  const historicalSchema = structuredClone(contract.schema);
  historicalSchema.summary_failed_provider.values = historicalSchema.summary_failed_provider.values.filter(provider => provider !== "tokenharbor");
  assert.deepEqual(JSON.parse(sql.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]), historicalSchema);
  assert.deepEqual(JSON.parse(sql.match(attemptRulesDeclaration)[1]), attemptRules);
  checks += 3;
  if (addedSamples) return checks + await checkDiagnosticsSamples(db, addedSamples);

  const samples = [
    { label: "legacy diagnostics", value: { version: 1, capture_detail: "attachment_size_limit" }, expected: true },
    { label: "JSON success and failure", value: report([attempt, { outcome: "succeeded", mode: "retry" }]), expected: true },
    { label: "two attempts maximum", value: report([attempt, attempt, attempt]), expected: false },
    { label: "missing outcome", value: report([{ mode: "fresh" }]), expected: false }
  ];
  for (const [key, rule] of Object.entries(attemptRules)) {
    for (const value of rule.values || [rule.min || 0, rule.max]) samples.push({ label: `observation ${key}`, value: report([{ ...attempt, [key]: value }]), expected: true });
    samples.push({ label: `private/invalid ${key}`, value: report([{ ...attempt, [key]: "PRIVATE text/url/token" }]), expected: false });
    if (rule.type === "number") for (const value of [-1, 0.5, rule.max + 1]) samples.push({ label: `number boundary ${key}`, value: report([{ ...attempt, [key]: value }]), expected: false });
  }
  for (const key of ["text", "filename", "url", "token", "stack"]) samples.push({ label: `private key ${key}`, value: report([{ ...attempt, [key]: "PRIVATE" }]), expected: false });
  return checks + await checkDiagnosticsSamples(db, samples);
}
module.exports = { checkJsonCaptureDiagnostics };
