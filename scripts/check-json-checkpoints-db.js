const assert = require("node:assert/strict");
const contract = require("../extension/transfer-diagnostics");
const { checkDiagnosticsSamples } = require("./check-diagnostics-samples");
const checkpointKeys = ["skipped_file_check","files_skipped","step","step_stage","hook_status","route_reason","saved_chat","hook_ready","route_found","history_request_sent","history_response_read","history_parsed","history_checked","route_candidates","route_resources","progress_seq"];
function beforeSourcePageState(schema = contract.jsonAttemptSchema) {
  const previous = structuredClone(schema);
  for (const key of ["source_loading", "source_auth_prompt", "source_error_prompt", "source_challenge_prompt"]) delete previous[key];
  return previous;
}
function beforeIncompleteReasons(schema = contract.jsonAttemptSchema) {
  const previous = beforeSourcePageState(schema);
  delete previous.incomplete_reason;
  return previous;
}
// Each historical replay compares the contract that existed at that boundary.
function beforeCheckpoints(schema = contract.jsonAttemptSchema) {
  const previous = beforeIncompleteReasons(schema);
  for (const key of checkpointKeys) delete previous[key];
  previous.outcome.values = previous.outcome.values.filter(value => value !== "started");
  return previous;
}
async function checkJsonCheckpoints(db, sql) {
  let checks = 0;
  const rows = async (query, args = []) => (await db.query(query, args)).rows;
  const equal = (a, b) => { assert.deepEqual(a, b); checks++; };
  const snapshot = () => rows(`select
    (select md5(jsonb_agg(to_jsonb(t) order by attempt_id)::text) from public.transfers t) transfers,
    (select md5(jsonb_agg(to_jsonb(u) order by user_no)::text) from public.users u) users,
    (select jsonb_agg(jsonb_build_array(oid::text,proacl,prosecdef,proconfig) order by oid) from pg_proc
      where oid in ('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure,
        'public.protect_transfer_diagnostics()'::regprocedure)) access`);
  const before = await snapshot();
  await db.exec(sql);
  equal(await snapshot(), before);
  const definition = (await rows("select pg_get_functiondef('public.is_valid_client_transfer_diagnostics(jsonb,integer)'::regprocedure) sql"))[0].sql;
  equal(JSON.parse(definition.match(/attempt_rules constant jsonb := '([^']+)'::jsonb/)[1]), beforeIncompleteReasons());
  const first = { outcome: "failed", mode: "prefetch", step: "route", step_stage: "history", hook_ready: true,
    route_found: false, route_reason: "no_matching_endpoint", route_candidates: 0, route_resources: 20,
    failure_check: "routing_unavailable", progress_seq: 3 };
  const report = entries => ({ version: 1, json_attempts: entries });
  const samples = [{ label: "routing checkpoint", value: report([first]), expected: true }];
  for (const key of checkpointKeys) {
    const rule = contract.jsonAttemptSchema[key];
    const values = rule.values || (rule.type === "boolean" ? [true,false] : [rule.min || 0,rule.max]);
    for (const value of [...new Set([values[0], values.at(-1)]), "PRIVATE", null])
      samples.push({ label: key, value: report([{ ...first, [key]: value }]),
        expected: typeof value === rule.type && (rule.values ? rule.values.includes(value)
          : rule.type !== "number" || Number.isInteger(value) && value >= (rule.min || 0) && value <= rule.max) });
  }
  for (const key of ["title","filename","url","chat_id","request_id","error_message","stack"])
    samples.push({ label: key, value: report([{ ...first, [key]: "PRIVATE" }]), expected: false });
  samples.push({ label: "unfinished observation", value: report([{ ...first, outcome: "started" }]), expected: true });
  checks += await checkDiagnosticsSamples(db, samples);
  await db.exec("begin; set local role service_role;");
  try {
    const attempt = 'c0de5727-0000-4000-8000-000000000001';
    const send = async (entries, status = 'started') => db.query(`select public.record_transfer_event($1::uuid,
      'c0de5727-0000-4000-8000-000000000002',now(),'claude','chatgpt',null,$2,'capture_started',
      case when $2='failed' then 'capture_failed' else null end,'1.4.30',false,null,null,null,null,$3::jsonb)`,
      [attempt,status,JSON.stringify(report(entries))]);
    const stored = async () => (await rows("select diagnostics from public.transfers where attempt_id=$1", [attempt]))[0].diagnostics.json_attempts;
    await send([first]); equal(await stored(),[first]);
    const retry = { outcome: "started", mode: "retry", step: "read", step_stage: "history", progress_seq: 5, hook_ready: true };
    await send([retry]); equal(await stored(),[first,retry]);
    await send([{ ...retry, step: "hook", progress_seq: 1 }]); equal(await stored(),[first,retry]);
    const failedRetry = { ...retry, outcome: "failed", failure_check: "timeout", progress_seq: 6 };
    await send([failedRetry]); equal(await stored(),[first,failedRetry]);
    await send([{ ...retry, progress_seq: 99 }], 'failed'); equal(await stored(),[first,failedRetry]);
    await send([retry]); equal(await stored(),[first,failedRetry]);
  } finally { await db.exec("rollback; reset role;"); }
  equal(await snapshot(), before);
  return checks;
}
module.exports = { beforeCheckpoints, beforeSourcePageState, checkpointKeys, checkJsonCheckpoints };
