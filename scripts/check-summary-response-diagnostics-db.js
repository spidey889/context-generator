const assert = require("node:assert/strict");
const contract = require("../extension/transfer-diagnostics");
const { checkDiagnosticsSamples } = require("./check-diagnostics-samples");

async function checkSummaryResponseDiagnostics(db, sql) {
  let checks = 0;
  const rows = async (query, args = []) => (await db.query(query, args)).rows;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const snapshot = () => rows(`select
    (select md5(jsonb_agg(to_jsonb(t) order by attempt_id)::text) from public.transfers t) transfers,
    (select md5(jsonb_agg(to_jsonb(u) order by user_no)::text) from public.users u) users,
    (select jsonb_agg(jsonb_build_array(oid::text,proacl,prosecdef,proconfig) order by oid) from pg_proc
      where oid in ('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure,
        'public.is_valid_transfer_diagnostics(jsonb,integer)'::regprocedure,
        'public.protect_transfer_diagnostics()'::regprocedure)) access`);
  const base = { attempt: 1, phase: "stream_read", reason: "body_read_failed", error_type: "TypeError" };
  const report = records => ({ version: 1, summary_response_failures: records });
  const before = await snapshot();
  equal((await rows("select public.is_valid_transfer_diagnostics($1::jsonb) valid", [JSON.stringify(report([base]))]))[0].valid, false);
  await db.exec(sql);
  equal(await snapshot(), before);
  const definition = (await rows("select pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure) sql"))[0].sql;
  equal(JSON.parse(definition.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]), contract.schema);
  equal(JSON.parse(definition.match(/summary_response_rules constant jsonb := '([^']+)'::jsonb/)[1]), contract.summaryResponseFailureSchema);
  const samples = [{ label: "legacy report", value: { version: 1, summary_http_status: 200 }, expected: true }];
  const boundaries = [{ ...base }, { ...base }];
  for (const [key, rule] of Object.entries(contract.summaryResponseFailureSchema)) {
    const values = rule.values || (rule.type === "boolean" ? [true, false] : [rule.min || 0, rule.max]);
    boundaries[0][key] = values[0];
    boundaries[1][key] = values.at(-1);
    for (const value of ["PRIVATE", null, ...(rule.type === "number" ? [-1, 0.5, rule.max + 1] : [])])
      samples.push({ label: `reject invalid ${key} ${value}`, value: report([{ ...base, [key]: value }]), expected: false });
  }
  // Preserve all fields, numeric endpoints and both boolean states in two
  // records. Schema parity retains the full enum sets; every rejection remains.
  boundaries.forEach((value, index) => samples.push({ label: `complete response failure boundary ${index}`, value: report([value]), expected: true }));
  for (const entries of [[base, base], [base, { ...base, attempt: 2 }, { ...base, attempt: 3 }], [null], [{ attempt: 1 }]])
    samples.push({ label: "reject invalid response array", value: report(entries), expected: false });
  for (const key of ["text", "summary", "filename", "url", "headers", "request_id", "stack", "message", "body"])
    samples.push({ label: `reject private response field ${key}`, value: report([{ ...base, [key]: "PRIVATE" }]), expected: false });
  checks += await checkDiagnosticsSamples(db, samples);
  await db.exec("begin; set local role service_role;");
  try {
    const records = [base, { ...base, attempt: 2, phase: "stream_utf8_decode", reason: "utf8_decode_failed" }];
    const write = (entries, status = "started") => db.query(`select public.record_transfer_event(
      'c0de5727-0000-4000-8000-000000000001'::uuid,'c0de5727-0000-4000-8000-000000000002',
      now(),'deepseek','gemini',10000,$2,'summary_response_started',case when $2='failed' then 'summary_failed' else null end,
      '1.4.28',false,null,null,null,null,$1::jsonb)`, [JSON.stringify(report(entries)), status]);
    const saved = () => rows("select status,diagnostics from public.transfers where attempt_id='c0de5727-0000-4000-8000-000000000001'");
    await write([records[0]]);
    await write([records[1]]);
    equal((await saved())[0].diagnostics, report(records));
    await write([records[0]]); // A delayed same-stage report cannot erase attempt two.
    equal((await saved())[0].diagnostics, report(records));
    await write([records[0]], "failed");
    equal((await saved())[0], { status: "failed", diagnostics: report(records) });
    await write([{ ...base, reason: "unexpected_exception" }], "failed");
    equal((await saved())[0], { status: "failed", diagnostics: report(records) });
  } finally { await db.exec("rollback; reset role;"); }
  equal(await snapshot(), before);
  return checks;
}

module.exports = { checkSummaryResponseDiagnostics };
