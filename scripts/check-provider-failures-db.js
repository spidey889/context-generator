const assert = require("node:assert/strict");
const contract = require("../supabase/functions/_shared/provider-failure");
const { createProviderFailureLog } = require("../api/provider-failure-log");

async function checkProviderFailures(db, sql, migrations) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const rows = async (query, args = []) => (await db.query(query, args)).rows;
  const before = await rows("select (select jsonb_agg(t) from public.transfers t) as transfers,(select jsonb_agg(u) from public.users u) as users");
  await db.exec(sql);
  // This replay boundary predates the million-character admission migration.
  const historicalSchema = structuredClone(contract.schema);
  historicalSchema.input_chars.max = 350000;
  equal(JSON.parse(sql.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]), historicalSchema);
  equal((await rows("select relrowsecurity from pg_class where oid='public.provider_failures'::regclass"))[0].relrowsecurity, true);
  for (const role of ["anon", "authenticated"]) {
    equal(await rows(`select has_table_privilege('${role}','public.provider_failures','select') as read,
      has_table_privilege('${role}','public.provider_failures','insert') as write,
      has_function_privilege('${role}','public.record_provider_failure(jsonb)','execute') as execute`),
    [{ read: false, write: false, execute: false }]);
  }
  equal(await rows(`select has_table_privilege('service_role','public.provider_failures','select,insert') as allowed,
    has_table_privilege('service_role','public.provider_failures','update') as update,
    has_table_privilege('service_role','public.provider_failures','delete') as delete`), [{ allowed: true, update: false, delete: false }]);
  const sample = { id: "c0de5714-0000-4000-8000-000000000001", request_id: "c0de5714-0000-4000-8000-000000000002",
    occurred_at: new Date().toISOString(), environment: "development", provider: "tokenharbor", model: "deepseek-v4.1-flash:free",
    failure_reason: "provider_timeout", phase: "waiting_answer", timeout_kind: "first_answer", route_index: 2,
    request_attempt: 1, input_chars: 39955, request_bytes: 45000, max_output_tokens: 10092, elapsed_ms: 45000,
    budget_ms: 45000, first_answer_budget_ms: 45000, reasoning_chars: 2500, http_status: 200 };
  for (const change of [{}, { prompt: "PRIVATE_CHAT" }, { elapsed_ms: -1 }, { phase: "PRIVATE_ERROR" },
    { provider: "gemini" }, { max_output_tokens: "10092" }, { occurred_at: "2026-02-31T00:00:00.000Z" }]) {
    const input = { ...sample, ...change };
    equal((await rows("select public.is_valid_provider_failure($1::jsonb) as valid", [JSON.stringify(input)]))[0].valid,
      contract.validate(input) !== null);
  }
  await db.exec("begin;");
  try {
    await db.exec("set local role service_role;");
    for (let n = 0; n < 2; n++) await db.query("select public.record_provider_failure($1::jsonb)", [JSON.stringify(sample)]);
    equal((await rows("select count(*)::int as count from public.provider_failures"))[0].count, 1);
    await db.exec("reset role;");
    const { createTelemetryHandler } = await import("../supabase/functions/transfer-telemetry/handler.mjs");
    const config = { SUPABASE_TELEMETRY_FUNCTION_URL: "https://edge.invalid", SUPABASE_TELEMETRY_PUBLISHABLE_KEY: "TEST_ONLY_PUBLIC",
      TELEMETRY_RELAY_SECRET: "TEST_ONLY_RELAY_01234567890123456789" };
    const saved = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
    const writer = createTelemetryHandler({ getEnv: name => ({ ...config, SUPABASE_URL: "https://db.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "TEST_ONLY_PRIVATE" })[name], createClient: () => ({ rpc: async (name, args) => {
      equal(name, "record_provider_failure");
      await db.query("select public.record_provider_failure($1::jsonb)", [JSON.stringify(args.p_event)]);
      return { error: null };
    } }) });
    let calls = 0;
    try {
      Object.assign(process.env, config);
      const recorder = createProviderFailureLog({ attemptId: "c0de5714-0000-4000-8000-000000000004", fetchImpl: async (url, options) => {
        const response = await writer(new Request(url, options));
        equal(response.status, 204);
        // Simulate a lost acknowledgement AFTER the database committed.
        return ++calls === 1 ? new Response(null, { status: 503 }) : response;
      } });
      recorder.record(sample); await recorder.flush();
      equal(calls, 2);
      equal((await rows("select count(*)::int as count from public.provider_failures"))[0].count, 2);
    } finally {
      for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
    const old = { ...sample, id: "c0de5714-0000-4000-8000-000000000003", occurred_at: "2000-01-01T00:00:00.000Z" };
    await db.query("select public.record_provider_failure($1::jsonb)", [JSON.stringify(old)]);
    const job = (await rows("select command,schedule from cron.job where jobname='prune-provider-failures'"))[0];
    equal(job.schedule, "23 3 * * *");
    await db.exec(job.command);
    equal((await rows("select count(*)::int as count from public.provider_failures"))[0].count, 2);
    const restored = await require("./check-telemetry-backup").checkSnapshot({
      transfers: (await rows("select to_jsonb(t) as row from public.transfers t")).map(value => value.row),
      users: (await rows("select to_jsonb(u) as row from public.users u")).map(value => value.row),
      provider_failures: (await rows("select to_jsonb(f) as row from public.provider_failures f")).map(value => value.row),
      migrations, users_sequence: (await rows("select last_value::text,is_called from public.users_user_no_seq"))[0]
    });
    equal(restored.providerFailures, 2);
    equal(restored.originalValuesPreserved, true);
    equal(await rows("select (select jsonb_agg(t) from public.transfers t) as transfers,(select jsonb_agg(u) from public.users u) as users"), before);
  } finally { await db.exec("rollback; reset role;"); }
  return checks;
}
module.exports = { checkProviderFailures };
