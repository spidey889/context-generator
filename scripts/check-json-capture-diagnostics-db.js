const assert = require("node:assert/strict");
const contract = require("../extension/transfer-diagnostics.js");
const { checkDiagnosticsSamples } = require("./check-diagnostics-samples.js");

async function checkJsonCaptureDiagnostics(db, sql, previousSql = null) {
  const attemptRulesDeclaration = /attempt_rules constant jsonb := '([^']+)'::jsonb/;
  const attemptRules = structuredClone(contract.jsonAttemptSchema);
  // Historical validators predate file-download detail. The forward migration
  // below independently checks the complete current contract.
  for (const key of ["failure_phase", "failure_error_type", "failure_response_type", "failure_abort", "failure_online",
    "failure_content_type", "failure_http_status", "failure_file_index", "failure_file_bytes", "failure_read_bytes", "failure_request_ms",
    "failure_file_extension", "failure_response_charset", "failure_body_hint", "failure_decode_stage"]) delete attemptRules[key];
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
  delete historicalSchema.destination_auth_prompt;
  historicalSchema.capture_detail.values = historicalSchema.capture_detail.values.filter(value => value !== "invalid_utf8");
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
async function checkFileDiagnostics(db, sql) {
  let checks = 0;
  const rows = async (query, args = []) => (await db.query(query, args)).rows;
  const snapshot = () => rows(`select
    (select md5(jsonb_agg(to_jsonb(t) order by attempt_id)::text) from public.transfers t) transfers,
    (select md5(jsonb_agg(to_jsonb(u) order by user_no)::text) from public.users u) users,
    (select jsonb_agg(jsonb_build_array(proname,proacl,prosecdef,proconfig) order by proname) from pg_proc
      where oid in ('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure,
        'public.is_valid_transfer_diagnostics(jsonb,integer)'::regprocedure)) access`);
  const before = await snapshot();
  await db.exec(sql);
  assert.deepEqual(await snapshot(), before); checks++;
  const definition = (await rows("select pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure) sql"))[0].sql;
  // At this historical boundary text files still have the 2.1 MB allowance.
  const historicalAttemptSchema = structuredClone(contract.jsonAttemptSchema);
  for (const key of ["failure_file_extension", "failure_response_charset", "failure_body_hint", "failure_decode_stage"]) delete historicalAttemptSchema[key];
  historicalAttemptSchema.failure_file_bytes.max = 2100000;
  assert.deepEqual(JSON.parse(definition.match(/attempt_rules constant jsonb := '([^']+)'::jsonb/)[1]), historicalAttemptSchema); checks++;
  const attempt = { outcome: "failed", mode: "prefetch", failure_check: "network_error", failure_stage: "attachment_body",
    failure_phase: "fetch", failure_error_type: "TypeError", failure_response_type: "none", failure_file_index: 2,
    failure_file_bytes: 61218, failure_read_bytes: 0, failure_request_ms: 2000, failure_abort: "none",
    failure_online: "online", failure_content_type: "missing" };
  const report = entry => ({ version: 1, json_attempts: [entry] });
  const samples = [{ label: "file-fetch diagnosis", value: report(attempt), expected: true }];
  for (const change of [{ failure_http_status: 403 }, { failure_phase: "body", failure_response_type: "cors", failure_read_bytes: 10 }])
    samples.push({ label: "observed file response", value: report({ ...attempt, ...change }), expected: true });
  for (const change of [{ url: "PRIVATE" }, { failure_error_type: "PRIVATE" }, { failure_phase: "PRIVATE" },
    { failure_file_index: 0 }, { failure_file_bytes: 2100001 }, { failure_http_status: 0 }, { failure_read_bytes: -1 }])
    samples.push({ label: "invalid/private file diagnosis", value: report({ ...attempt, ...change }), expected: false });
  checks += await checkDiagnosticsSamples(db, samples);
  await db.exec("begin; set local role service_role;");
  try {
    await db.query(`select public.record_transfer_event('c0de5724-0000-4000-8000-000000000001'::uuid,
      'c0de5724-0000-4000-8000-000000000002',now(),'deepseek','chatgpt',null,'failed','capture_started',
      'capture_failed','1.4.20',false,null,null,null,null,$1::jsonb)`, [JSON.stringify(report(attempt))]);
    assert.deepEqual((await rows("select diagnostics from public.transfers where attempt_id='c0de5724-0000-4000-8000-000000000001'"))[0].diagnostics, report(attempt)); checks++;
  } finally { await db.exec("rollback; reset role;"); }
  assert.deepEqual(await snapshot(), before); checks++;
  return checks;
}
async function checkAttachmentDecodeDiagnostics(db, sql) {
  let checks = 0;
  const rows = async (query, args = []) => (await db.query(query, args)).rows;
  const snapshot = () => rows(`select
    (select md5(jsonb_agg(to_jsonb(t) order by attempt_id)::text) from public.transfers t) transfers,
    (select md5(jsonb_agg(to_jsonb(u) order by user_no)::text) from public.users u) users,
    (select jsonb_agg(jsonb_build_array(oid::text,proacl,prosecdef,proconfig) order by oid) from pg_proc
      where oid in ('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure,
        'public.is_valid_transfer_diagnostics(jsonb,integer)'::regprocedure)) access`);
  const definition = async () => (await rows("select pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure) sql"))[0].sql;
  const before = await snapshot(), original = await definition();
  const attempt = { outcome: "failed", mode: "prefetch", failure_check: "invalid_utf8", failure_stage: "attachment_body",
    failure_phase: "decode", failure_file_index: 25, failure_file_bytes: 960752, failure_read_bytes: 1043,
    failure_http_status: 200, failure_file_extension: "csv", failure_response_charset: "missing",
    failure_body_hint: "unrecognized", failure_decode_stage: "chunk" };
  const report = changes => ({ version: 1, capture_detail: "invalid_utf8", json_attempts: [{ ...attempt, ...changes }] });
  assert.equal((await rows("select public.is_valid_transfer_diagnostics($1::jsonb) valid", [JSON.stringify(report())]))[0].valid, false); checks++;
  await db.exec(sql);
  assert.deepEqual(await snapshot(), before); checks++;
  const updated = await definition();
  assert.deepEqual(JSON.parse(updated.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]), contract.schema); checks++;
  assert.deepEqual(JSON.parse(updated.match(/attempt_rules constant jsonb := '([^']+)'::jsonb/)[1]), contract.jsonAttemptSchema); checks++;
  const withoutRules = value => value.replace(/\b(?:attempt_rules|rules) constant jsonb := '[^']+'::jsonb/g, "RULES");
  assert.equal(withoutRules(updated), withoutRules(original)); checks++;
  const samples = [{ label: "legacy diagnostics remain valid", value: { version: 1, capture_detail: "network_error" }, expected: true }];
  for (const key of ["failure_file_extension", "failure_response_charset", "failure_body_hint", "failure_decode_stage"]) {
    for (const value of [...contract.jsonAttemptSchema[key].values, "PRIVATE_FILE.csv", "https://PRIVATE", null])
      samples.push({ label: `attachment decode ${key} ${value}`, value: report({ [key]: value }),
        expected: contract.jsonAttemptSchema[key].values.includes(value) });
  }
  for (const key of ["file_name", "file_id", "url", "prefix", "bytes", "content", "raw_error"])
    samples.push({ label: `reject private field ${key}`, value: report({ [key]: "PRIVATE" }), expected: false });
  checks += await checkDiagnosticsSamples(db, samples);
  await db.exec("begin; set local role service_role;");
  try {
    await db.query(`select public.record_transfer_event('c0de5726-0000-4000-8000-000000000001'::uuid,
      'c0de5726-0000-4000-8000-000000000002',now(),'deepseek','gemini',null,'failed','capture_started',
      'capture_failed','1.4.28',false,null,null,null,null,$1::jsonb)`, [JSON.stringify(report())]);
    assert.deepEqual((await rows("select diagnostics from public.transfers where attempt_id='c0de5726-0000-4000-8000-000000000001'"))[0].diagnostics, report()); checks++;
  } finally { await db.exec("rollback; reset role;"); }
  assert.deepEqual(await snapshot(), before); checks++;
  return checks;
}
module.exports = { checkJsonCaptureDiagnostics, checkFileDiagnostics, checkAttachmentDecodeDiagnostics };
