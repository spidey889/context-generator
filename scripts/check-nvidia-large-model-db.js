const assert = require("node:assert/strict");
const contract = require("../supabase/functions/_shared/provider-failure");

async function checkNvidiaLargeModel(db, sql) {
  let checks = 0;
  const equal = (a, b) => { assert.deepEqual(a, b); checks++; };
  const rows = async (query, args = []) => (await db.query(query, args)).rows;
  const snapshot = () => rows(`select
    (select jsonb_agg(to_jsonb(t) order by attempt_id) from public.transfers t) transfers,
    (select jsonb_agg(to_jsonb(u) order by user_no) from public.users u) users,
    (select jsonb_agg(jsonb_build_array(oid::text,relacl::text,relrowsecurity) order by oid)
      from pg_class where oid in ('public.transfers'::regclass,'public.users'::regclass)) access,
    (select jsonb_agg(jsonb_build_array(oid::text,proacl::text,prosecdef,proconfig) order by oid)
      from pg_proc where oid in ('public.is_valid_provider_failure(jsonb)'::regprocedure,
        'public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb)'::regprocedure)) functions`);
  const before = await snapshot();
  await db.exec(sql);
  equal(await snapshot(), before);
  const definition = (await rows("select pg_get_functiondef('public.is_valid_provider_failure(jsonb)'::regprocedure) sql"))[0].sql;
  const sqlRules = JSON.parse(definition.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]);
  const expectedRules = structuredClone(contract.schema);
  // JSON enumeration order does not affect the closed set of accepted models.
  sqlRules.model.values.sort(); expectedRules.model.values.sort();
  equal(sqlRules, expectedRules);
  equal(JSON.parse(definition.match(/models constant jsonb := '([^']+)'::jsonb/)[1]), contract.models);
  const target = (await rows("select attempt_id::text from public.transfers order by attempt_id limit 1"))[0];
  const event = { id: "c0de5729-0000-4000-8000-000000000001", request_id: "c0de5729-0000-4000-8000-000000000002",
    attempt_id: target.attempt_id, occurred_at: new Date().toISOString(), environment: "development",
    provider: "openrouter", model: "nvidia/nemotron-3.5-super-vl:free", failure_reason: "provider_http_error",
    phase: "http_error", route_index: 1, request_attempt: 1, input_chars: 750000, request_bytes: 800000,
    max_output_tokens: 10000, elapsed_ms: 100, budget_ms: 75000, http_status: 429 };
  for (const input of [event, { ...event, provider: "tokenharbor" }, { ...event, prompt: "PRIVATE" }]) {
    equal((await rows("select public.is_valid_provider_failure($1::jsonb) valid", [JSON.stringify(input)]))[0].valid,
      contract.validate(input) !== null);
  }
  await db.exec("begin; set local role service_role;");
  try {
    await db.query("select public.record_provider_failure($1::jsonb)", [JSON.stringify(event)]);
    equal((await rows("select diagnostics from public.transfers where attempt_id=$1", [target.attempt_id]))[0]
      .diagnostics.provider_failures.find(value => value.id === event.id), event);
  } finally { await db.exec("rollback; reset role;"); }
  equal(await snapshot(), before);
  return checks;
}
module.exports = { checkNvidiaLargeModel };
