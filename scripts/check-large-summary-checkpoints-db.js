const assert = require("node:assert/strict");
const contract = require("../extension/transfer-diagnostics");
const { checkDiagnosticsSamples } = require("./check-diagnostics-samples");

async function checkLargeSummaryCheckpoints(db, sql) {
  const base = { phase: "part", index: 0, total: 16, stage: "request", started_ms: 0 };
  const report = entries => ({ version: 1, large_summary_requests: entries });
  const before = (await db.query("select count(*)::int n from public.transfers")).rows;
  await db.exec(sql);
  assert.deepEqual((await db.query("select count(*)::int n from public.transfers")).rows, before);
  const definition = (await db.query("select pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure) sql")).rows[0].sql;
  assert.deepEqual(JSON.parse(definition.match(/large_request_rules constant jsonb := '([^']+)'::jsonb/)[1]), contract.largeSummaryRequestSchema);
  const samples = [
    ...[base, { ...base, phase: "final", index: 16 }, { ...base, stage: "completed", provider: "openrouter", provider_ms: 33000 }]
      .map(value => ({ label: "bounded request", value: report([value]), expected: true })),
    ...[[base, base], [{ ...base, index: 16 }], [{ ...base, total: 0 }], [{ ...base, index: 0.5 }],
      [{ ...base, phase: "final" }], [{ ...base, summary: "PRIVATE" }], [{ ...base, provider: "PRIVATE" }], [{ ...base, stage: "PRIVATE" }]]
      .map(value => ({ label: "reject invalid request", value: report(value), expected: false }))
  ];
  let checks = 2 + await checkDiagnosticsSamples(db, samples);
  await db.exec("begin; set local role service_role;");
  try {
    const write = (entries, status = "started") => db.query(`select public.record_transfer_event(
      'c0de1030-0000-4000-8000-000000000001'::uuid,'c0de1030-0000-4000-8000-000000000002',
      now(),'chatgpt','claude',3006871,$2,'summary_response_started',case when $2='failed' then 'summary_failed' else null end,
      '1.4.36',false,null,null,null,null,$1::jsonb)`, [JSON.stringify(report(entries)), status]);
    const saved = async () => (await db.query("select diagnostics from public.transfers where attempt_id='c0de1030-0000-4000-8000-000000000001'")).rows[0].diagnostics;
    const done = { ...base, stage: "completed", elapsed_ms: 33000 }, failed = { ...base, index: 1, stage: "failed", error_code: "summary_timeout" };
    await write([done]); await write([base, failed]);
    assert.deepEqual(await saved(), report([done, failed])); checks++;
    await write([], "failed");
    assert.deepEqual(await saved(), report([done, failed])); checks++;
  } finally { await db.exec("rollback; reset role;"); }
  return checks;
}
module.exports = { checkLargeSummaryCheckpoints };
