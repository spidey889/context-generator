const assert = require("node:assert/strict");
const contract = require("../supabase/functions/_shared/provider-failure");
async function checkProviderLogging(db, sql) {
  const definition = async () => (await db.query("select pg_get_functiondef('public.is_valid_provider_failure(jsonb)'::regprocedure) value")).rows[0].value;
  const state = async () => (await db.query(`select jsonb_build_object(
    'transfers',(select md5(jsonb_agg(to_jsonb(t) order by attempt_id)::text) from public.transfers t),
    'users',(select md5(jsonb_agg(to_jsonb(u) order by install_id)::text) from public.users u),
    'access',(select proacl::text from pg_proc where oid='public.is_valid_provider_failure(jsonb)'::regprocedure)) value`)).rows[0].value;
  const before = await definition(), retained = await state(); await db.exec(sql);
  assert.deepEqual(await state(), retained);
  const after = await definition(), pattern = /rules constant jsonb := '([^']+)'::jsonb/;
  const oldRules = JSON.parse(before.match(pattern)[1]), rules = JSON.parse(after.match(pattern)[1]);
  const base = { id: "c0de5732-0000-4000-8000-000000000001", request_id: "c0de5732-0000-4000-8000-000000000002",
    occurred_at: "2026-10-31T10:00:00.000Z", environment: "development", provider: "openrouter", model: "dots-studio/dots-3-note-preview:free",
    failure_reason: "provider_http_error", phase: "http_error", route_index: 1, request_attempt: 1, input_chars: 10000,
    request_bytes: 12000, max_output_tokens: 1000, elapsed_ms: 500, budget_ms: 90000 };
  let checks = 1;
  for (const [key, rule] of Object.entries(rules)) {
    if (JSON.stringify(rule) === JSON.stringify(oldRules[key])) continue;
    assert.ok(contract.schema[key], "New provider metadata must exist in the canonical contract"); checks++;
    const validValues = rule.values || (rule.pattern ? ["req_12345678ABC"] : [rule.min, rule.max]);
    for (const value of [...validValues, null, "PRIVATE chat https://secret"]) {
      const sample = { ...base, [key]: value };
      // Skip observations are tested with their cross-field requirements separately.
      if (value === "provider_skipped" || key === "skip_reason" || key === "request_attempt" && value === 0) continue;
      const valid = (await db.query("select public.is_valid_provider_failure($1::jsonb) valid", [JSON.stringify(sample)])).rows[0].valid;
      assert.equal(valid, contract.validate(sample) !== null, key); checks++;
    }
  }
  if (rules.summary_phase) {
    for (const context of [{ summary_phase: "part", part_index: 0, part_total: 2 },
      { summary_phase: "final", part_index: 2, part_total: 2 }, { summary_phase: "part", part_index: 2, part_total: 2 },
      { summary_phase: "final", part_index: 0, part_total: 2 }, { summary_phase: "part" }]) {
      const sample = { ...base, ...context };
      assert.equal((await db.query("select public.is_valid_provider_failure($1::jsonb) valid", [JSON.stringify(sample)])).rows[0].valid,
        contract.validate(sample) !== null); checks++;
    }
  }
  return checks;
}
module.exports = { checkProviderLogging };
