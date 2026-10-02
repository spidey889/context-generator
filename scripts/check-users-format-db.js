const assert = require("node:assert/strict");

async function checkUsersFormat(db, sql) {
  let checks = 0;
  const equal = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
  const one = async (query, args = []) => (await db.query(query, args)).rows[0];
  // The preceding pool-exhaustion fixture intentionally has 129 users. Refuse
  // a smaller pool transactionally, preserving those rows and their columns.
  await assert.rejects(db.exec(sql), /More users than famous Naruto names/); checks++;
  await db.exec("rollback;");
  equal((await one("select count(*)::int as n from public.users")).n, 129);
  await db.exec("truncate public.users restart identity;"); // Local fixtures only.
  await db.query("insert into public.users(install_id,lifetime_successful_summaries,today_successful_summaries,today_failed_attempts) values('format-one',5,2,1)");
  await db.exec("update public.users set name='Naruto Uzumaki' where install_id='format-one';");
  await db.query("insert into public.users(install_id,lifetime_successful_summaries,today_successful_summaries,today_failed_attempts) values('format-two',8,3,2)");
  await db.exec("update public.users set name='Raido Namiashi' where install_id='format-two';");
  const values = (await db.query("select install_id,user_no::int,lifetime_successful_summaries::int as lifetime,today_successful_summaries::int as today,today_failed_attempts::int as failed,today_date::text from public.users order by user_no")).rows;
  const sequence = await one("select last_value::text,is_called from public.users_user_no_seq");
  const history = (await db.query("select to_jsonb(e) as row from public.transfer_events e order by id")).rows;
  const counter = (await one("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql")).sql;
  const job = await one("select jobid,jobname,schedule from cron.job");
  await db.exec(sql);
  equal((await db.query("select column_name from information_schema.columns where table_schema='public' and table_name='users' order by ordinal_position")).rows.map(row => row.column_name),
    ["install_id","user_no","name","lifetime_summaries","today_summaries","today_failed_attempts","today_date"]);
  equal((await db.query("select install_id,user_no::int,lifetime_summaries::int as lifetime,today_summaries::int as today,today_failed_attempts::int as failed,today_date::text from public.users order by user_no")).rows, values);
  equal(await one("select last_value::text,is_called from public.users_user_no_seq"), sequence);
  equal((await db.query("select to_jsonb(e) as row from public.transfer_events e order by id")).rows, history);
  equal((await one("select pg_get_functiondef('public.record_user_summary()'::regprocedure) as sql")).sql,
    counter.replaceAll("lifetime_successful_summaries","lifetime_summaries").replaceAll("today_successful_summaries","today_summaries"));
  equal(await one("select jobid,jobname,schedule from cron.job"), job);
  equal((await one("select name from public.users where install_id='format-one'")).name, "Naruto Uzumaki");
  equal(await one("select count(*)::int as users,count(distinct name)::int as names,bool_and(name=any(public.naruto_user_names())) as famous from public.users"), { users:2,names:2,famous:true });
  equal((await one("select cardinality(public.naruto_user_names())::int as n")).n, 40);
  equal((await one("select to_regclass('public.users_formatted') as staging")).staging, null);
  await db.exec("set role service_role;");
  try {
    await db.query("select public.record_transfer_event(gen_random_uuid(),'format-one',now(),'claude','chatgpt',1,'failed','capture_started','capture_failed','1.4.7',true,null,now())");
    equal(await one("select lifetime_summaries::int as lifetime,today_summaries::int as today,today_failed_attempts::int as failed from public.users where install_id='format-one'"), { lifetime:6,today:3,failed:2 });
    equal((await one("select total_summaries::int as total from public.user_summary_usage where install_id='format-one'")).total, 6);
    await db.query("insert into public.users(install_id) values('format-three')");
    equal((await one("select user_no::int as n from public.users where install_id='format-three'")).n, 3);
  } finally { await db.exec("reset role;"); }
  await db.exec("update public.users set today_date=(now() at time zone 'UTC')::date-1;");
  await db.exec((await one("select command from cron.job")).command);
  equal((await one("select sum(today_summaries)::int as today,sum(today_failed_attempts)::int as failed from public.users")), { today:0,failed:0 });
  equal((await one("select relrowsecurity from pg_class where oid='public.users'::regclass")).relrowsecurity, true);
  equal((await one("select has_table_privilege('anon','public.users','select') as allowed")).allowed, false);
  equal((await one("select has_table_privilege('service_role','public.users','delete') as allowed")).allowed, false);
  console.log(`PASS: ${checks} users formatting, famous-name, data/cutoff/sequence preservation and ingestion/reset checks.`);
  return checks;
}
module.exports = { checkUsersFormat };
