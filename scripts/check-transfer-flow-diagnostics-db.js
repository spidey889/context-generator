const assert = require("node:assert/strict");
const contract = require("../extension/transfer-diagnostics");
const { checkDiagnosticsSamples } = require("./check-diagnostics-samples");

async function checkTransferFlowDiagnostics(db, sql) {
  let checks = 0;
  const rows = async (query, args = []) => (await db.query(query, args)).rows;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const snapshot = () => rows(`select
    (select md5(jsonb_agg(to_jsonb(t) order by attempt_id)::text) from public.transfers t) transfers,
    (select md5(jsonb_agg(to_jsonb(u) order by install_id)::text) from public.users u) users,
    (select jsonb_agg(jsonb_build_array(oid::text,proacl,prosecdef,proconfig) order by oid) from pg_proc
      where pronamespace='public'::regnamespace and proname in ('record_transfer_event',
        'is_valid_client_transfer_diagnostics','protect_transfer_diagnostics')) access`);
  const before = await snapshot();
  const shown = { event: "box_shown", surface: "dialog", side: "source", at_ms: 10 };
  const copied = { ...shown, event: "copy_succeeded", method: "native", at_ms: 20 };
  const report = recovery_events => ({ version: 1, recovery_events });
  await db.exec(sql);
  equal(await snapshot(), before);
  const definition = (await rows("select pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure) sql"))[0].sql;
  equal(JSON.parse(definition.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]), Object.fromEntries(Object.entries(require("./diagnostics-history").withoutPasteEditorFields(contract.schema)).filter(([key]) => key !== "large_summary_requests")));
  equal(JSON.parse(definition.match(/summary_response_rules constant jsonb := '([^']+)'::jsonb/)[1]), contract.summaryResponseFailureSchema);
  equal(JSON.parse(definition.match(/recovery_rules constant jsonb := '([^']+)'::jsonb/)[1]), require("./diagnostics-history").beforeRetentionRecovery(contract.recoveryEventSchema));
  checks += await checkDiagnosticsSamples(db, [
    { label: "pre-header failure", value: { version: 1, summary_response_failures: [{ attempt: 1, phase: "request", reason: "fetch_failed", error_type: "TypeError", elapsed_ms: 500 }] }, expected: true },
    { label: "copy shown and copied", value: report([shown, copied]), expected: true },
    { label: "unconfirmed copy", value: report([{ ...copied, event: "copy_unconfirmed", method: "clipboard", stop_confirmed: false }]), expected: true },
    ...[[shown, shown], Array(13).fill(shown), [{ ...shown, text: "PRIVATE" }], [{ ...shown, event: "copy_succeeded" }],
      [{ ...copied, method: "https://PRIVATE" }], [{ ...copied, at_ms: -1 }]].map(value => ({ label: "reject malformed recovery", value: report(value), expected: false }))
  ]);
  equal((await rows("select has_function_privilege('anon','public.merge_transfer_recovery_events(jsonb,jsonb)','execute') allowed"))[0].allowed, false);
  equal((await rows("select has_function_privilege('authenticated','public.merge_transfer_recovery_events(jsonb,jsonb)','execute') allowed"))[0].allowed, false);
  await db.exec("begin; set local role service_role;");
  try {
    const attempt = "c0de1028-0000-4000-8000-000000000001";
    const base = { version: 1, error_code: "message_timeout", message_reply: "timeout" };
    const write = (diagnostics, status = "failed") => db.query(`select public.record_transfer_event(
      '${attempt}'::uuid,'c0de1028-0000-4000-8000-000000000002',
      '2026-10-28T12:00:00Z'::timestamptz,'deepseek','gemini',10000,$2,'paste_started',
      case when $2='failed' then 'paste_failed' else null end,'1.4.34',false,null,null,null,null,$1::jsonb)`,
    [JSON.stringify(diagnostics), status]);
    const saved = async () => (await rows(`select to_jsonb(t) row from public.transfers t where attempt_id='${attempt}'`))[0].row;
    const counters = () => rows("select to_jsonb(u) row from public.users u where install_id='c0de1028-0000-4000-8000-000000000002'");
    await write(base);
    const initial = await saved(), initialCounters = await counters();
    await write({ ...base, recovery_events: [shown] });
    // Copy recovery is allowed after failure; all delivery facts remain fixed.
    await write({ version: 1, error_code: "editor_missing", recovery_events: [copied] }, "started");
    let actual = await saved();
    equal(actual.diagnostics, { ...base, recovery_events: [shown, copied] });
    equal({ ...actual, diagnostics: null }, { ...initial, diagnostics: null });
    equal(await counters(), initialCounters);
    await write(report([{ ...shown, at_ms: 999 }]));
    equal((await saved()).diagnostics, actual.diagnostics);
    await db.exec("savepoint immutable_diagnosis;");
    await assert.rejects(db.query(`update public.transfers set diagnostics=diagnostics || '{"error_code":"editor_missing"}'::jsonb where attempt_id='${attempt}'`),
      error => error.code === "23514"); checks++;
    await db.exec("rollback to savepoint immutable_diagnosis;");
    equal((await saved()).diagnostics, actual.diagnostics);
    equal(await counters(), initialCounters);
  } finally { await db.exec("rollback; reset role;"); }
  equal(await snapshot(), before);
  return checks;
}

module.exports = { checkTransferFlowDiagnostics };
