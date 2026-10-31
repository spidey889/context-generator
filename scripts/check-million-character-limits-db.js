const assert = require("node:assert/strict");
const provider = require("../supabase/functions/_shared/provider-failure");
const diagnostics = require("../extension/transfer-diagnostics");

async function checkMillionCharacterLimits(db, sql) {
  let checks = 0;
  const rows = async (query, args = []) => (await db.query(query, args)).rows;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const snapshot = () => rows(`select
    (select jsonb_agg(to_jsonb(t) order by attempt_id) from public.transfers t) transfers,
    (select jsonb_agg(to_jsonb(u) order by user_no) from public.users u) users,
    (select jsonb_agg(jsonb_build_array(oid::text,proacl::text) order by oid) from pg_proc
      where oid in ('public.is_valid_provider_failure(jsonb)'::regprocedure,
        'public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure)) access`);
  const before = await snapshot();
  const event = { id: "c0de5723-0000-4000-8000-000000000091", request_id: "c0de5723-0000-4000-8000-000000000092",
    occurred_at: new Date().toISOString(), environment: "development", provider: "openrouter", model: "dots-studio/dots-3-note-preview:free",
    failure_reason: "provider_timeout", phase: "waiting_answer", route_index: 1, request_attempt: 1,
    input_chars: 1000000, request_bytes: 3000000, max_output_tokens: 10000, elapsed_ms: 90000, budget_ms: 90000 };
  const file = { version: 1, json_attempts: [{ outcome: "failed", mode: "fresh", failure_file_bytes: 4100000 }] };
  const validProvider = value => rows("select public.is_valid_provider_failure($1::jsonb) valid", [JSON.stringify(value)]);
  const validClient = value => rows("select public.is_valid_transfer_diagnostics($1::jsonb) valid", [JSON.stringify(value)]);
  equal((await validProvider(event))[0].valid, false);
  equal((await validClient(file))[0].valid, false);
  await db.exec(sql);
  equal(await snapshot(), before);
  const definitions = (await rows(`select pg_get_functiondef('public.is_valid_provider_failure(jsonb)'::regprocedure) provider,
    pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure) client`))[0];
  const historicalProviderSchema = require("./diagnostics-history").beforeProviderLogging(provider.schema);
  historicalProviderSchema.model.values = historicalProviderSchema.model.values.filter(model => model !== "nvidia/nemotron-3.5-super-vl:free");
  equal(JSON.parse(definitions.provider.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]), historicalProviderSchema);
  const historicalAttemptSchema = require("./check-json-checkpoints-db").beforeCheckpoints();
  for (const key of ["failure_file_extension", "failure_response_charset", "failure_body_hint", "failure_decode_stage"]) delete historicalAttemptSchema[key];
  equal(JSON.parse(definitions.client.match(/attempt_rules constant jsonb := '([^']+)'::jsonb/)[1]), historicalAttemptSchema);
  // Keep an independent assertion that the new file endpoint is accepted;
  // omit its duplicate from the parity matrix below.
  equal((await validClient(file))[0].valid, true);
  for (const count of [350000, 350001, 1000000, 1000001]) {
    const sample = { ...event, input_chars: count };
    equal((await validProvider(sample))[0].valid, provider.validate(sample) !== null);
  }
  for (const count of [2100000, 2100001, 4100001]) {
    const sample = { version: 1, json_attempts: [{ outcome: "failed", mode: "fresh", failure_file_bytes: count }] };
    equal((await validClient(sample))[0].valid, diagnostics.validate(sample) !== null);
  }
  // Exercise the real RPC under its restricted role, not only the pure predicate.
  const target = (await rows("select attempt_id::text from public.transfers order by attempt_id limit 1"))[0];
  await db.exec("begin; set local role service_role;");
  try {
    const sample = { ...event, attempt_id: target.attempt_id };
    await db.query("select public.record_provider_failure($1::jsonb)", [JSON.stringify(sample)]);
    const saved = (await rows("select diagnostics from public.transfers where attempt_id=$1", [target.attempt_id]))[0].diagnostics;
    equal(saved.provider_failures.find(item => item.id === event.id), sample);
  } finally { await db.exec("rollback; reset role;"); }
  equal(await snapshot(), before);
  return checks;
}
module.exports = { checkMillionCharacterLimits };
