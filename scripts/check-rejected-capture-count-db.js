const assert = require("node:assert/strict");

async function checkRejectedCaptureCount(db, sql) {
  let checks = 0;
  const equal = (a, b) => { assert.deepEqual(a, b); checks++; };
  const install = (await db.query("select install_id from public.users limit 1")).rows[0].install_id;
  const id = number => `c0de5730-0000-4000-8000-${String(number).padStart(12, "0")}`;
  const attempt = (chars = 2692448, check = "transcript_char_limit") => ({ mode: "prefetch", outcome: "failed",
    failure_stage: "serialize", failure_check: check, transcript_chars: chars });
  const diagnostic = (...attempts) => ({ version: 1, capture_detail: "size_limit", json_attempts: attempts });
  const report = (number, diagnostics, { count = null, status = "failed", reason = "conversation_too_large", stage = "capture_started" } = {}) =>
    db.query(`select public.record_transfer_event(p_attempt_id=>$1::uuid,p_install_id=>$2::text,
      p_attempted_at=>'2026-10-30T00:00:00Z',p_source_platform=>'deepseek',p_destination_platform=>'gemini',
      p_character_count=>$3::integer,p_status=>$4::text,p_last_stage=>$5::text,p_failure_reason=>$6::text,
      p_extension_version=>'1.4.34',p_diagnostics=>$7::jsonb)`,
    [id(number), install, count, status, stage, reason, JSON.stringify(diagnostics)]);
  const snapshot = async () => (await db.query(`select
    (select jsonb_agg(to_jsonb(t) order by attempt_id) from public.transfers t) transfers,
    (select jsonb_agg(to_jsonb(u) order by user_no) from public.users u) users,
    (select jsonb_build_object('last_value',last_value::text,'is_called',is_called) from public.users_user_no_seq) sequence,
    (select jsonb_agg(jsonb_build_array(oid::text,relacl::text,relrowsecurity) order by oid)
      from pg_class where oid in ('public.transfers'::regclass,'public.users'::regclass)) access,
    (select jsonb_agg(jsonb_build_array(oid::text,proacl::text) order by oid) from pg_proc
      where pronamespace='public'::regnamespace) functions`)).rows[0];
  const outcome = async number => (await db.query("select character_count,model from public.transfers where attempt_id=$1", [id(number)])).rows[0];
  const users = async () => (await db.query("select jsonb_agg(to_jsonb(u) order by user_no) value from public.users u")).rows[0].value;

  await report(1, diagnostic(attempt()));
  await report(2, diagnostic(attempt(900000, "transcript_byte_limit")));
  await report(3, diagnostic(attempt(42, "raw_response_stream_limit")));
  await report(4, { ...diagnostic(attempt(42, "supported_files_limit")), capture_detail: "attachment_size_limit" });
  await report(5, diagnostic(attempt()), { count: 123 });
  await report(6, diagnostic(attempt()), { reason: "capture_failed" });
  await report(7, diagnostic(attempt()), { status: "started", reason: null });
  await report(8, diagnostic(attempt()), { status: "succeeded", stage: "completed", reason: null });
  await report(9, diagnostic(attempt(), { ...attempt(999), mode: "retry", outcome: "succeeded" }));
  await report(10, diagnostic(attempt(3000000), { ...attempt(2000000), mode: "retry" }));
  const before = await snapshot();
  await db.exec(sql);
  const expected = structuredClone(before);
  for (const [number, chars] of [[1, 2692448], [2, 900000], [10, 2000000]]) {
    expected.transfers.find(row => row.attempt_id === id(number)).character_count = chars;
  }
  const after = await snapshot();
  // Only the new private helper is added; existing function grants stay intact.
  after.functions = after.functions.filter(row => before.functions.some(previous => previous[0] === row[0]));
  equal(after, expected);
  for (const number of [3, 4, 6, 7, 8, 9]) equal(await outcome(number), { character_count: null, model: null });
  equal(await outcome(5), { character_count: 123, model: null });

  await db.exec("begin; set local role service_role;");
  try {
    await report(11, diagnostic(attempt(5000000)));
    equal(await outcome(11), { character_count: 5000000, model: null });
    const counts = await users();
    await report(11, diagnostic(attempt(5000000)));
    equal(await users(), counts);
    await report(11, diagnostic(attempt(6000000)));
    equal(await outcome(11), { character_count: 5000000, model: null });
    await db.exec("savepoint immutable_outcome;");
    await assert.rejects(db.query("update public.transfers set status='succeeded' where attempt_id=$1", [id(11)]), error => error.code === "22023"); checks++;
    await db.exec("rollback to savepoint immutable_outcome;");
    await report(7, diagnostic(attempt()));
    equal(await outcome(7), { character_count: 2692448, model: null });
    for (const chars of [-1, 0, 1.5, 2147483648, "2692448", null]) {
      equal((await db.query("select public.rejected_capture_character_count($1::jsonb) count", [JSON.stringify(diagnostic(attempt(chars)))])).rows[0].count, null);
    }
    for (const role of ["anon", "authenticated"]) {
      equal((await db.query("select has_function_privilege($1,'public.rejected_capture_character_count(jsonb)','execute') allowed", [role])).rows[0].allowed, false);
    }
  } finally { await db.exec("rollback; reset role;"); }
  equal((await snapshot()).transfers, expected.transfers);
  equal((await snapshot()).users, expected.users);
  return checks;
}

module.exports = { checkRejectedCaptureCount };
