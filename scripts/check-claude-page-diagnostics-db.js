const assert = require("node:assert/strict");
const contract = require("../extension/transfer-diagnostics.js");

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
  equal(JSON.parse(sql.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]), contract.schema);
  const valid = async value => (await db.query("select public.is_valid_transfer_diagnostics($1::jsonb) as valid", [JSON.stringify(value)])).rows[0].valid;
  for (const page of contract.schema.claude_page.values) {
    const sample = { version: 1, claude_page: page, destination_route_allowed: true,
      destination_platform_match: true, destination_message_count: 0,
      prepared_diagnostics: { version: 1, claude_page: page } };
    equal(await valid(sample), true);
  }
  for (const sample of [{ version: 1 }, { version: 1, error_code: "editor_missing" }]) equal(await valid(sample), true);
  for (const page of ["https://claude.ai/new", "claude.ai/chat/PRIVATE", "claude.ai/?secret=PRIVATE", "PRIVATE"]) {
    equal(await valid({ version: 1, claude_page: page }), false);
    equal(await valid({ version: 1, prepared_diagnostics: { version: 1, claude_page: page } }), false);
  }
  equal(await valid({ version: 1, destination_message_count: -1 }), false);
  equal(await valid({ version: 1, destination_route_allowed: "true" }), false);
  return checks;
}
module.exports = { checkClaudePageDiagnostics };
