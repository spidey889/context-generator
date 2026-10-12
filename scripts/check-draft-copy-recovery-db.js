const assert = require("node:assert/strict");

async function checkDraftCopyRecovery(db, sql) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const snapshot = async () => (await db.query(`select jsonb_build_object(
    'transfers',(select jsonb_agg(to_jsonb(t) order by attempt_id) from public.transfers t),
    'users',(select jsonb_agg(to_jsonb(u) order by install_id) from public.users u),
    'access',(select jsonb_agg(jsonb_build_array(oid::text,relacl::text,relrowsecurity) order by oid)
      from pg_class where oid in ('public.transfers'::regclass,'public.users'::regclass)),
    'function_access',(select proacl::text from pg_proc where oid='public.preserve_transfer_event_invariants()'::regprocedure)
  ) as value`)).rows[0].value;
  const before = await snapshot();
  await db.exec(sql);
  equal(await snapshot(), before);

  const install = "d0c0a111-1111-4111-8111-111111111111";
  const id = number => `d0c0a222-2222-4222-8222-${String(number).padStart(12, "0")}`;
  const acknowledged = { version: 1, error_code: "editor_has_draft", draft_present: true,
    events: [{ event: "local_fallback", at_ms: 100, code: "editor_has_draft" }] };
  const report = (number, diagnostics = acknowledged, options = {}) => db.query(`select public.record_transfer_event(
    $1::uuid,$2::text,'2026-10-12T00:00:00Z','claude','chatgpt',100,
    $3::text,$4::text,$5::text,'1.4.16',$6::boolean,null,
    case when $6::boolean then clock_timestamp() else null end,$7::text,null,$8::jsonb)`,
    [id(number), install, options.status || "failed", options.stage || "paste_started",
      Object.hasOwn(options, "failure") ? options.failure : "paste_failed",
      options.verified || false, options.verified ? "gemini-3.6-flash" : null, diagnostics === null ? null : JSON.stringify(diagnostics)]);
  const outcome = async number => (await db.query("select status,failure_reason from public.transfers where attempt_id=$1", [id(number)])).rows[0];
  const counts = async () => (await db.query("select lifetime_summaries::int as summaries,today_failed_attempts::int as failed from public.users where install_id=$1", [install])).rows[0];

  await db.exec("set role service_role");
  try {
    await report(1, null, { status: "started", failure: null });
    await report(1);
    equal(await outcome(1), { status: "copy_ready", failure_reason: null });
    equal(await counts(), { summaries: 0, failed: 0 });
    await report(1);
    await report(1, { version: 1, error_code: "paste_not_retained" });
    equal(await outcome(1), { status: "copy_ready", failure_reason: null });
    equal(await counts(), { summaries: 0, failed: 0 });

    // A later authenticated summary still counts once, independently of delivery.
    await report(1, acknowledged, { verified: true });
    await report(1, acknowledged, { verified: true });
    equal(await outcome(1), { status: "copy_ready", failure_reason: null });
    equal(await counts(), { summaries: 1, failed: 0 });

    await report(2, { version: 1, error_code: "editor_has_draft" });
    equal(await outcome(2), { status: "failed", failure_reason: "paste_failed" });
    await report(3, { ...acknowledged, error_code: "paste_not_retained" });
    equal(await outcome(3), { status: "failed", failure_reason: "paste_failed" });
    equal(await counts(), { summaries: 1, failed: 2 });

    await assert.rejects(report(4, null, { status: "copy_ready", failure: null }), error => error.code === "23514"); checks++;
    await assert.rejects(db.query("update public.transfers set status='succeeded',last_stage='completed' where attempt_id=$1", [id(1)]), error => error.code === "22023"); checks++;
    await assert.rejects(db.query("update public.transfers set attempted_at=clock_timestamp() where attempt_id=$1", [id(1)]), error => error.code === "22023"); checks++;
    equal(await counts(), { summaries: 1, failed: 2 });
  } finally { await db.exec("reset role"); }
  return checks;
}

module.exports = { checkDraftCopyRecovery };
