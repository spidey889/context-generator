const assert = require("node:assert/strict");

async function checkTransferUserLabels(db, sql) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const rows = async (query, params = []) => (await db.query(query, params)).rows;
  const one = async (query, params = []) => (await rows(query, params))[0];
  const snapshot = async () => ({
    transfers: await rows("select to_jsonb(t) - 'user_no' - 'username' as row from public.transfers t order by attempt_id"),
    users: await rows("select to_jsonb(u) as row from public.users u order by user_no"),
    access: await rows("select relname,relrowsecurity,relacl::text from pg_class where oid in ('public.transfers'::regclass,'public.users'::regclass) order by relname")
  });
  const before = await snapshot();
  await db.exec(sql);
  equal(await snapshot(), before);
  equal((await one(`select count(*)::int as n from public.transfers t left join public.users u using(install_id)
    where row(t.user_no,t.username) is distinct from row(u.user_no,u.name)`)).n, 0);
  equal((await one(`select has_function_privilege('anon','public.assign_transfer_user_labels()','execute')
    or has_function_privilege('authenticated','public.sync_transfer_user_labels()','execute') as allowed`)).allowed, false);

  await db.exec("begin");
  try {
    const attempt = "f00df00d-f00d-4f00-8f00-000000000099";
    const install = "user-label-regression";
    const attemptedAt = new Date().toISOString();
    const labels = () => one("select user_no::text,username from public.transfers where attempt_id=$1", [attempt]);
    const user = () => one("select user_no::text,name as username from public.users where install_id=$1", [install]);
    const report = async status => {
      await db.exec("set role service_role");
      try {
        await db.query(`select public.record_transfer_event($1::uuid,$2::text,$3::timestamptz,
          'claude','chatgpt',50,$4::text,'capture_started',
          case when $4='failed' then 'capture_failed' else null end,'1.4.10')`, [attempt, install, attemptedAt, status]);
      } finally { await db.exec("reset role"); }
    };
    await report("started");
    equal(await labels(), { user_no: null, username: null });
    await report("failed"); // Allocation after the transfer write must fill its labels.
    equal(await labels(), await user());
    await report("failed");
    equal((await one("select today_failed_attempts::int as n from public.users where install_id=$1", [install])).n, 1);
    const currentName = (await user()).username;
    const renamed = (await one("select public.naruto_user_names() as pool")).pool.find(name => name !== currentName);
    await db.query("update public.users set name=$1 where install_id=$2", [renamed, install]);
    equal(await labels(), await user());
    await db.exec("set role service_role");
    try { await db.query("update public.transfers set user_no=99999,username='spoof' where attempt_id=$1", [attempt]); }
    finally { await db.exec("reset role"); }
    equal(await labels(), await user());
    equal((await one("select today_failed_attempts::int as n from public.users where install_id=$1", [install])).n, 1);
    await db.query("delete from public.users where install_id=$1", [install]);
    equal(await labels(), { user_no: null, username: null });
    await db.query("insert into public.users(install_id) values($1)", [install]);
    equal(await labels(), await user());
    const transferCount = (await one("select count(*)::int as n from public.transfers")).n;
    await db.exec("truncate public.users restart identity");
    equal((await one("select count(*)::int as n from public.transfers")).n, transferCount);
    equal((await one("select count(*)::int as n from public.transfers where user_no is not null or username is not null")).n, 0);
  } finally { await db.exec("rollback"); }
  return checks;
}

module.exports = { checkTransferUserLabels };
