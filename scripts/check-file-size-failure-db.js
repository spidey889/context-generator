const assert = require("node:assert/strict");

async function checkFileSizeFailureReason(db, sql, migrations) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const install = (await db.query("select install_id from public.users limit 1")).rows[0].install_id;
  const id = number => `bbbbbbbb-bbbb-4bbb-8bbb-${String(number).padStart(12, "0")}`;
  const report = (number, { status = "failed", detail = "attachment_size_limit", reason = "conversation_too_large", stage = "capture_started" } = {}) =>
    db.query(`select public.record_transfer_event(
      p_attempt_id => $1::uuid, p_install_id => $2::text, p_attempted_at => '2026-10-13T00:00:00Z',
      p_source_platform => 'chatgpt', p_destination_platform => 'claude', p_character_count => null,
      p_status => $3::text, p_last_stage => $4::text, p_failure_reason => $5::text,
      p_extension_version => '1.4.16', p_diagnostics => $6::jsonb)`,
    [id(number), install, status, stage, reason, detail === null ? null : JSON.stringify({ version: 1, capture_detail: detail })]);
  const outcome = async number => (await db.query("select status,failure_reason from public.transfers where attempt_id=$1", [id(number)])).rows[0];
  const snapshot = async () => (await db.query(`select jsonb_build_object(
    'transfers',(select jsonb_agg(to_jsonb(t)-'file_size_failure_reason' order by attempt_id) from public.transfers t),
    'users',(select jsonb_agg(to_jsonb(u) order by install_id) from public.users u),
    'access',(select jsonb_agg(jsonb_build_array(relacl::text,relrowsecurity) order by oid)
      from pg_class where oid in ('public.transfers'::regclass,'public.users'::regclass)),
    'triggers',(select jsonb_agg(jsonb_build_array(tgname,tgenabled::text) order by tgname)
      from pg_trigger where tgrelid='public.transfers'::regclass and not tgisinternal),
    'function_access',(select jsonb_agg(jsonb_build_array(proname,proacl::text) order by oid)
      from pg_proc where oid in ('public.preserve_transfer_event_invariants()'::regprocedure,
        'public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb)'::regprocedure))
  ) as value`)).rows[0].value;

  await report(1);
  await report(2, { detail: "size_limit" });
  await report(3, { status: "succeeded", reason: null, stage: "completed" });
  await report(4, { reason: "paste_failed", stage: "paste_started" });
  await report(5, { status: "started", reason: null });
  await report(6, { detail: null });
  const before = await snapshot();
  const legacyBackup = { transfers: (await db.query("select to_jsonb(t) as row from public.transfers t")).rows.map(value => value.row),
    users: (await db.query("select to_jsonb(u) as row from public.users u")).rows.map(value => value.row), migrations: migrations.slice(0, -1) };
  await db.exec(sql);
  const expected = structuredClone(before);
  for (const transfer of expected.transfers) {
    if (transfer.status === "failed" && transfer.failure_reason === "conversation_too_large"
      && transfer.diagnostics?.capture_detail === "attachment_size_limit") transfer.failure_reason = "file_size_limit";
  }
  equal(await snapshot(), expected);
  equal((await db.query("select count(*)::int as count from information_schema.columns where table_schema='public' and table_name='transfers'")).rows[0].count, 18);
  equal((await db.query("select count(*)::int as count from information_schema.columns where table_schema='public' and table_name='transfers' and column_name='file_size_failure_reason'")).rows[0].count, 0);
  equal(await outcome(1), { status: "failed", failure_reason: "file_size_limit" });
  equal(await outcome(2), { status: "failed", failure_reason: "conversation_too_large" });
  equal(await outcome(3), { status: "succeeded", failure_reason: null });
  equal(await outcome(4), { status: "failed", failure_reason: "paste_failed" });
  equal(await outcome(5), { status: "started", failure_reason: null });
  const { checkSnapshot } = require("./check-telemetry-backup.js");
  const upgraded = await checkSnapshot(legacyBackup, { applyPending: true, throughVersion: "20261013092328" });
  equal(upgraded.removedColumns, ["transfers.file_size_failure_reason"]);
  equal(upgraded.reclassifiedFileSizeFailures, before.transfers.filter(row => row.status === "failed"
    && row.failure_reason === "conversation_too_large" && row.diagnostics?.capture_detail === "attachment_size_limit").length);
  equal(upgraded.originalValuesPreserved, false);
  equal(upgraded.retainedValuesPreserved, true);

  await db.exec("begin;");
  try {
    await report(7);
    equal(await outcome(7), { status: "failed", failure_reason: "file_size_limit" });
    const afterFirstReport = (await snapshot()).users;
    // Installed clients still send the broad wire reason on a duplicate report.
    await report(7);
    equal(await outcome(7), { status: "failed", failure_reason: "file_size_limit" });
    equal((await snapshot()).users, afterFirstReport);
    await report(5);
    equal(await outcome(5), { status: "failed", failure_reason: "file_size_limit" });
    // A diagnostic arriving after a terminal outcome must not rewrite its reason.
    await report(6);
    equal(await outcome(6), { status: "failed", failure_reason: "conversation_too_large" });
    equal((await db.query("select diagnostics->>'capture_detail' as detail from public.transfers where attempt_id=$1", [id(6)])).rows[0].detail, "attachment_size_limit");
    await report(8, { status: "succeeded", reason: null, stage: "completed" });
    equal(await outcome(8), { status: "succeeded", failure_reason: null });
    await db.exec("savepoint immutable;");
    await assert.rejects(db.query("update public.transfers set failure_reason='conversation_too_large' where attempt_id=$1", [id(7)]), error => error.code === "22023"); checks++;
    await db.exec("rollback to savepoint immutable;");

    const current = { transfers: (await db.query("select to_jsonb(t) as row from public.transfers t")).rows.map(value => value.row),
      users: (await db.query("select to_jsonb(u) as row from public.users u")).rows.map(value => value.row), migrations: [...migrations] };
    equal((await checkSnapshot(current)).originalValuesPreserved, true);
  } finally { await db.exec("rollback;"); }
  equal(await snapshot(), expected);
  return checks;
}

module.exports = { checkFileSizeFailureReason };
