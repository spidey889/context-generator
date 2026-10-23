const assert = require("node:assert/strict");
const { createProviderFailureLog } = require("../api/provider-failure-log");

async function checkProviderDiagnostics(db, sql, migrations) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const rows = async (query, args = []) => (await db.query(query, args)).rows;
  const mainRows = async () => rows("select (select jsonb_agg(to_jsonb(t)-'diagnostics' order by attempt_id) from public.transfers t) transfers,(select jsonb_agg(to_jsonb(u) order by user_no) from public.users u) users");
  const before = await mainRows();
  const target = (await rows("select attempt_id::text,diagnostics from public.transfers order by attempt_id limit 1"))[0];
  const event = { id: "c0de5723-0000-4000-8000-000000000001", request_id: "c0de5723-0000-4000-8000-000000000002",
    attempt_id: target.attempt_id, occurred_at: new Date().toISOString(), environment: "development", provider: "tokenharbor",
    model: "deepseek-v4.1-flash:free", failure_reason: "provider_timeout", phase: "waiting_answer", timeout_kind: "first_answer",
    route_index: 2, request_attempt: 1, input_chars: 39955, request_bytes: 45000, max_output_tokens: 10092,
    elapsed_ms: 45000, budget_ms: 45000, http_status: 200 };
  // Prove an existing log is moved, not discarded, while both main tables keep
  // their exact rows, outcomes, identities and counters.
  await db.query("select public.record_provider_failure($1::jsonb)", [JSON.stringify(event)]);
  await db.exec(sql);
  equal(await mainRows(), before);
  equal((await rows("select to_regclass('public.provider_failures') missing"))[0].missing, null);
  equal((await rows("select count(*)::int n from cron.job where jobname='prune-provider-failures'"))[0].n, 0);
  const diagnosis = (await rows("select diagnostics from public.transfers where attempt_id=$1", [target.attempt_id]))[0].diagnostics;
  equal(diagnosis.provider_failures.length, 1);
  equal(diagnosis.provider_failures[0], event);
  const { provider_failures: ignored, ...client } = diagnosis;
  equal(client, target.diagnostics || { version: 1 });
  for (const role of ["anon", "authenticated"]) equal((await rows(`select has_function_privilege('${role}',
    'public.record_provider_failure(jsonb,jsonb)','execute') allowed`))[0].allowed, false);

  await db.exec("begin;");
  try {
    const context = { attempt_id: "c0de5723-0000-4000-8000-000000000003", install_id: "c0de5723-0000-4000-8000-000000000004",
      attempted_at: new Date().toISOString(), source_platform: "claude", destination_platform: "chatgpt", character_count: 39955,
      status: "started", last_stage: "summary_request_started", failure_reason: null, extension_version: "1.4.20" };
    const sendFailure = async (changes = {}) => {
      const value = { ...event, attempt_id: context.attempt_id, ...changes };
      await db.query("select public.record_provider_failure($1::jsonb,$2::jsonb)", [JSON.stringify(value), JSON.stringify(context)]);
    };
    const get = async () => (await rows("select * from public.transfers where attempt_id=$1", [context.attempt_id]))[0];
    const telemetry = async (status, diagnostics) => db.query(`select public.record_transfer_event($1::uuid,$2::text,$3::timestamptz,
      'claude','chatgpt',39955,$4::text,$5::text,$6::text,'1.4.20',false,null,null,null,null,$7::jsonb)`,
    [context.attempt_id, context.install_id, context.attempted_at, status,
      status === "failed" ? "summary_request_started" : "summary_response_started", status === "failed" ? "summary_failed" : null,
      diagnostics === null ? null : JSON.stringify(diagnostics)]);
    await db.exec("set local role service_role;");
    await sendFailure(); await sendFailure();
    equal((await get()).diagnostics.provider_failures.length, 1);
    // Started telemetry may arrive after the server log. It enriches the same
    // transfer and cannot erase evidence or duplicate the user/attempt.
    await telemetry("started", { version: 1, summary_ms: 45000 });
    equal((await get()).diagnostics.provider_failures.length, 1);
    await telemetry("failed", { version: 1, error_code: "summary_timeout" });
    const terminal = await get();
    const counters = await rows("select to_jsonb(u) row from public.users u where install_id=$1", [context.install_id]);
    await sendFailure({ id: "c0de5723-0000-4000-8000-000000000005", request_attempt: 2 });
    const enriched = await get();
    equal(enriched.diagnostics.provider_failures.length, 2);
    equal(enriched.status, terminal.status); equal(enriched.failure_reason, terminal.failure_reason);
    equal(await rows("select to_jsonb(u) row from public.users u where install_id=$1", [context.install_id]), counters);
    await telemetry("failed", { version: 1, error_code: "unknown_error" });
    equal((await get()).diagnostics, enriched.diagnostics);
    // Client input cannot forge server evidence, even through the private RPC.
    await db.exec("savepoint rejected;");
    await assert.rejects(telemetry("failed", { version: 1, provider_failures: [event] }), error => error.code === "23514"); checks++;
    await db.exec("rollback to savepoint rejected;");
    await db.exec("savepoint wrong_identity;");
    await assert.rejects(db.query("select public.record_provider_failure($1::jsonb,$2::jsonb)",
      [JSON.stringify({ ...event, attempt_id: context.attempt_id }), JSON.stringify({ ...context, install_id: "different" })]),
      error => error.code === "22023"); checks++;
    await db.exec("rollback to savepoint wrong_identity;");

    // Full recorder -> Edge -> SQL with a lost acknowledgement: same event once.
    const config = { SUPABASE_TELEMETRY_FUNCTION_URL: "https://edge.invalid", SUPABASE_TELEMETRY_PUBLISHABLE_KEY: "TEST_ONLY_PUBLIC",
      TELEMETRY_RELAY_SECRET: "TEST_ONLY_RELAY_01234567890123456789" };
    const saved = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
    const { createTelemetryHandler } = await import("../supabase/functions/transfer-telemetry/handler.mjs");
    const handler = createTelemetryHandler({ getEnv: name => ({ ...config, SUPABASE_URL: "https://db.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "TEST_ONLY" })[name], createClient: () => ({ rpc: async (name, args) => {
      equal(name, "record_provider_failure");
      await db.query("select public.record_provider_failure($1::jsonb,$2::jsonb)", [JSON.stringify(args.p_event), JSON.stringify(args.p_context)]);
      return { error: null };
    } }) });
    let calls = 0;
    try {
      Object.assign(process.env, config);
      const recorder = createProviderFailureLog({ attemptId: context.attempt_id, telemetry: context, fetchImpl: async (url, options) => {
        const response = await handler(new Request(url, options)); equal(response.status, 204);
        return ++calls === 1 ? new Response(null, { status: 503 }) : response;
      } });
      recorder.record(event); await recorder.flush();
      equal(calls, 2); equal((await get()).diagnostics.provider_failures.length, 3);
    } finally {
      for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
    }
    await db.exec("reset role;");
    const restored = await require("./check-telemetry-backup").checkSnapshot({
      transfers: (await rows("select to_jsonb(t) row from public.transfers t")).map(value => value.row),
      users: (await rows("select to_jsonb(u) row from public.users u")).map(value => value.row), migrations,
      users_sequence: (await rows("select last_value::text,is_called from public.users_user_no_seq"))[0]
    });
    equal(restored.originalValuesPreserved, true);
  } finally { await db.exec("rollback; reset role;"); }
  return checks;
}
module.exports = { checkProviderDiagnostics };
