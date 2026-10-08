const assert = require("node:assert/strict");
const contract = require("../extension/transfer-diagnostics.js");

async function checkTransferDiagnostics(db, sql) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const rows = async (query, params = []) => (await db.query(query, params)).rows;
  const one = async (query, params = []) => (await rows(query, params))[0];
  const before = await rows("select to_jsonb(t) as row from public.transfers t order by attempt_id");
  const users = await rows("select to_jsonb(u) as row from public.users u order by install_id");
  const security = await rows("select relname,relacl::text,relrowsecurity from pg_class where oid in ('public.transfers'::regclass,'public.users'::regclass) order by relname");
  const rules = JSON.parse(sql.match(/rules constant jsonb := '([^']+)'::jsonb/)[1]);
  equal(rules, contract.schema);
  await db.exec(sql);
  equal(await rows("select to_jsonb(t)-'diagnostics' as row from public.transfers t order by attempt_id"), before);
  equal(await rows("select to_jsonb(u) as row from public.users u order by install_id"), users);
  equal(await rows("select relname,relacl::text,relrowsecurity from pg_class where oid in ('public.transfers'::regclass,'public.users'::regclass) order by relname"), security);
  equal((await one("select count(*)::int as count from public.transfers where diagnostics is not null")).count, 0);
  const valid = async value => (await one("select public.is_valid_transfer_diagnostics($1::jsonb) as valid", [JSON.stringify(value)])).valid;
  const samples = [];
  for (const [key, rule] of Object.entries(contract.schema)) {
    const value = rule.values?.[0] ?? (rule.type === "boolean" ? false : rule.type === "number" ? 23 : rule.type === "object"
      ? { version: 1, error_code: "editor_missing", paste_events: [{ event: "failure", at_ms: 23, code: "editor_missing" }] }
      : [{ event: "admission", at_ms: 0 }]);
    samples.push({ version: 1, [key]: value });
  }
  const malformed = [{}, [], null, { version: 2 }, { version: 1, raw_error: "PRIVATE" },
    { version: 1, capture_chars: -1 }, { version: 1, capture_chars: 1.5 }, { version: 1, paste_attempts: 2147483648 },
    { version: 1, error_code: "PRIVATE" }, { version: 1, online: "true" }, { version: 1, events: [{ event: "PRIVATE", at_ms: 0 }] },
    { version: 1, events: [{ event: "admission", at_ms: -1 }] }, { version: 1, events: [{ event: "admission", at_ms: 0, text: "PRIVATE" }] },
    { version: 1, events: [{ event: "admission" }] }, { version: 1, events: Array(33).fill({ event: "admission", at_ms: 0 }) },
    { version: 1, prepared_diagnostics: { version: 1, prepared_diagnostics: { version: 1 } } }];
  for (const sample of [...samples, ...malformed.filter(value => value !== null)]) {
    equal(await valid(sample), Boolean(contract.validate(sample)));
  }
  // SQL NULL is the compatibility absence, distinct from invalid JSON null.
  equal(await valid(null), false);
  equal((await one("select public.is_valid_transfer_diagnostics(null::jsonb) as valid")).valid, true);
  await db.exec("begin");
  const install = "d1a60000-0000-4000-8000-000000000001";
  const id = n => `d1a60000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const report = async (n, status, stage, diagnostics = null, failure = null, verified = false) => {
    await db.exec("set role service_role");
    try { return await db.query(`select public.record_transfer_event($1::uuid,$2::text,'2026-10-09T00:00:00Z'::timestamptz,
      'deepseek','claude',300000,$3::text,$4::text,$5::text,'1.4.12',$6::boolean,null,
      case when $6 then '2026-10-09T00:00:20Z'::timestamptz else null end,null,null,$7::jsonb)`,
      [id(n), install, status, stage, failure, verified, diagnostics === null ? null : JSON.stringify(diagnostics)]); }
    finally { await db.exec("reset role").catch(() => {}); }
  };
  const get = n => one("select status,last_stage,failure_reason,diagnostics from public.transfers where attempt_id=$1", [id(n)]);
  try {
    await report(1, "started", "capture_completed", { version: 1, capture_method: "deepseek-json", captured_turns: 20 });
    await report(1, "started", "paste_started", { version: 1, summary_chars: 1000 });
    equal((await get(1)).diagnostics, { version: 1, capture_method: "deepseek-json", captured_turns: 20, summary_chars: 1000 });
    await report(1, "started", "capture_started", { version: 1, capture_method: "unknown" });
    equal((await get(1)).diagnostics.capture_method, "deepseek-json");
    const failure = { version: 1, error_code: "editor_missing", error_origin: "destination", editor_seen: false,
      paste_attempts: 9, prepared_diagnostics: { version: 1, error_code: "editor_has_draft", draft_present: true } };
    await report(1, "failed", "paste_started", failure, "paste_failed");
    const terminal = await get(1);
    await report(1, "failed", "paste_started", { version: 1, error_code: "paste_not_retained" }, "paste_failed");
    await report(1, "succeeded", "completed", { version: 1, paste_populated: true });
    await report(1, "started", "paste_started", { version: 1, summary_chars: 2 });
    equal(await get(1), terminal);
    await report(1, "failed", "paste_started", failure, "paste_failed", true);
    equal(await get(1), terminal);
    equal(await one("select lifetime_summaries::int as summaries,today_failed_attempts::int as failures from public.users where install_id=$1", [install]),
      { summaries: 1, failures: 1 });
    await report(2, "failed", "capture_started", null, "capture_failed");
    await report(2, "failed", "capture_started", { version: 1, error_code: "capture_dom_failed" }, "capture_failed");
    equal((await get(2)).diagnostics.error_code, "capture_dom_failed");
    await report(3, "succeeded", "completed");
    await report(3, "failed", "paste_started", failure, "paste_failed");
    equal((await get(3)).diagnostics, null);
    await db.exec("savepoint invalid_diag");
    await assert.rejects(() => report(4, "failed", "paste_started", { version: 1, raw_error: "PRIVATE" }, "paste_failed"), error => error.code === "23514"); checks++;
    await db.exec("rollback to savepoint invalid_diag");
    await db.exec("savepoint frozen_diag");
    await assert.rejects(() => db.query("update public.transfers set diagnostics=$1 where attempt_id=$2", [JSON.stringify({ version: 1 }), id(1)]), error => error.code === "23514"); checks++;
    await db.exec("rollback to savepoint frozen_diag");
    for (const role of ["anon", "authenticated"]) {
      equal((await one("select has_table_privilege($1,'public.transfers','SELECT') as access", [role])).access, false);
      equal((await one("select has_function_privilege($1,'public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb)','EXECUTE') as access", [role])).access, false);
    }
    // The defaults retain the old ten-argument API without an ambiguous overload.
    await db.exec("set role service_role");
    await db.query("select public.record_transfer_event($1::uuid,$2::text,'2026-10-09T00:00:00Z'::timestamptz,'deepseek','claude',1,'started','intent_started',null,'1.4.10')", [id(5), install]);
    await db.exec("reset role");
    equal((await get(5)).diagnostics, null);
  } finally { await db.exec("rollback; reset role"); }
  return checks;
}
module.exports = { checkTransferDiagnostics };
