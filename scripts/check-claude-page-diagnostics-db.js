const assert = require("node:assert/strict");
const contract = require("../extension/transfer-diagnostics.js");
const { checkDiagnosticsSamples } = require("./check-diagnostics-samples.js");

async function checkClaudePageDiagnostics(db, sql) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const snapshot = async () => (await db.query(`select jsonb_build_object(
    'transfers', (select jsonb_agg(to_jsonb(t) order by attempt_id) from public.transfers t),
    'users', (select jsonb_agg(to_jsonb(u) order by install_id) from public.users u),
    'access', (select jsonb_agg(jsonb_build_array(oid::text,relacl::text,relrowsecurity) order by oid)
      from pg_class where oid in ('public.transfers'::regclass,'public.users'::regclass)),
    'function_access', (select proacl::text from pg_proc where oid='public.is_valid_transfer_diagnostics(jsonb,integer)'::regprocedure)
  ) as value`)).rows[0].value;
  const before = await snapshot();
  await db.exec(sql);
  equal(await snapshot(), before);
  const rules = JSON.parse(sql.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]);
  equal(rules, Object.fromEntries(Object.keys(rules).map(key => [key, contract.schema[key]])));
  const samples = [];
  // Rule equality covers every enum member; exercise the generic enum reader
  // at both ends while retaining each root/prepared privacy rejection below.
  const pages = contract.schema.claude_page.values;
  for (const page of new Set([pages[0], pages.at(-1)])) {
    const sample = { version: 1, claude_page: page, destination_route_allowed: true,
      destination_platform_match: true, destination_message_count: 0,
      prepared_diagnostics: { version: 1, claude_page: page } };
    samples.push({ label: `allowed Claude page ${page}`, value: sample, expected: true });
  }
  samples.push({ label: "legacy editor failure", value: { version: 1, error_code: "editor_missing" }, expected: true });
  for (const page of ["https://claude.ai/new", "claude.ai/chat/PRIVATE", "claude.ai/?secret=PRIVATE", "PRIVATE"]) {
    samples.push({ label: `private Claude page ${page}`, value: { version: 1, claude_page: page }, expected: false });
    samples.push({ label: `private prepared Claude page ${page}`, value: { version: 1, prepared_diagnostics: { version: 1, claude_page: page } }, expected: false });
  }
  samples.push({ label: "negative destination message count", value: { version: 1, destination_message_count: -1 }, expected: false });
  samples.push({ label: "string instead of route boolean", value: { version: 1, destination_route_allowed: "true" }, expected: false });
  checks += await checkDiagnosticsSamples(db, samples);
  return checks;
}
module.exports = { checkClaudePageDiagnostics };
