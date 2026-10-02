// Verify a decrypted application snapshot entirely inside local PostgreSQL.
// Never print private rows, SQL parameters, or install/attempt identifiers.
// Usage: PGLITE_MODULE_PATH=/temporary/node_modules/@electric-sql/pglite
//        node scripts/check-telemetry-backup.js /temporary/decrypted.json
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { PGlite } = require(process.env.PGLITE_MODULE_PATH || "@electric-sql/pglite");

function digest(rows, columns) {
  const canonicalRows = rows.map(row => {
    const result = {};
    for (const { column_name: column, data_type: type } of columns) {
      const value = row[column];
      if (value == null) result[column] = null;
      else if (type === "timestamp with time zone") result[column] = new Date(value).toISOString();
      else if (type === "bigint") {
        if (typeof value === "number" && !Number.isSafeInteger(value)) {
          throw new Error("Snapshot bigint is outside the lossless JSON number range");
        }
        result[column] = String(value);
      } else result[column] = value;
    }
    return JSON.stringify(result);
  }).sort();
  return crypto.createHash("sha256").update(JSON.stringify(canonicalRows)).digest("hex");
}

// Restore captured state by default. Applying future migrations is opt-in:
// the owner-authorized users reset intentionally discards old user counters.
async function checkSnapshot(snapshot, { applyPending = false, throughVersion } = {}) {
  const db = new PGlite();
  let phase = "snapshot validation";
  try {
    assert.ok(Array.isArray(snapshot.transfer_events) && Array.isArray(snapshot.users));
    assert.ok(Array.isArray(snapshot.migrations) && snapshot.migrations.length > 0);
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      create schema cron;
      create table cron.job (jobid bigint generated always as identity, jobname text, schedule text, command text, active boolean default true);
      create function cron.alter_job(job_id bigint, schedule text default null, command text default null) returns void language sql as $$
        update cron.job as j set schedule=coalesce($2,j.schedule),command=coalesce($3,j.command) where j.jobid=$1; $$;
      create function cron.unschedule(bigint) returns boolean language plpgsql as $$
        begin delete from cron.job where jobid = $1; return found; end; $$;
      create function cron.schedule(text, text, text) returns bigint language plpgsql as $$
        declare result bigint; begin
          insert into cron.job(jobname, schedule, command) values ($1, $2, $3) returning jobid into result;
          return result; end; $$;
    `);
    const localSql = sql => sql.replace(/create extension if not exists pg_cron with schema pg_catalog;/gi, "-- Local cron catalog shim.");
    phase = "captured migration replay";
    const captured = [...snapshot.migrations].sort((a, b) => String(a.version).localeCompare(String(b.version)));
    const capturedVersions = new Set();
    for (const migration of captured) {
      assert.match(String(migration.version), /^\d{14}$/);
      assert.ok(Array.isArray(migration.statements) && migration.statements.every(sql => typeof sql === "string"));
      assert.ok(!capturedVersions.has(String(migration.version)), "Migration versions must be unique");
      capturedVersions.add(String(migration.version));
      // The CLI records individually parsed statements without terminators;
      // MCP-applied migrations can instead contain the entire SQL file. Adding
      // a separator supports both formats, including already-terminated SQL.
      await db.exec(localSql(migration.statements.join(";\n")));
    }

    // The users-reset migration freezes its real deployment time in these
    // definitions. Replaying its DO block alone would invent a new boundary
    // and hide restored post-reset history from reports. Restore captured SQL.
    phase = "captured function and view definitions";
    if (snapshot.functions) {
      assert.ok(Array.isArray(snapshot.functions) && snapshot.functions.every(sql => typeof sql === "string"));
      for (const sql of snapshot.functions) await db.exec(sql);
      phase = "captured function definition comparison";
      const definitions = (await db.query("select pg_get_functiondef(oid) as definition from pg_proc where pronamespace='public'::regnamespace")).rows.map(row => row.definition);
      assert.deepEqual(definitions.sort(), [...snapshot.functions].sort());
    }
    if (snapshot.views) {
      phase = "captured view definitions";
      assert.ok(Array.isArray(snapshot.views));
      for (const view of snapshot.views) {
        assert.match(view.name, /^[a-z_][a-z0-9_]*$/);
        assert.equal(typeof view.definition, "string");
        await db.exec(`create or replace view public.${view.name} with (security_invoker=true) as ${view.definition}`);
        // pg_get_viewdef formatting differs across PostgreSQL builds. Execute
        // the exact captured SQL, then verify it resolves and remains invoker.
        await db.query(`select * from public.${view.name} limit 0`);
        const restored = (await db.query("select reloptions from pg_class where oid=$1::regclass", [`public.${view.name}`])).rows[0];
        assert.ok(restored.reloptions.includes("security_invoker=true"));
      }
    }

    phase = "private row restore";
    const columns = {};
    const hashes = {};
    for (const table of ["transfer_events", "users"]) {
      columns[table] = (await db.query(`select column_name, data_type from information_schema.columns
        where table_schema='public' and table_name=$1 order by column_name`, [table])).rows;
      assert.ok(columns[table].length > 0);
      for (const row of snapshot[table]) {
        assert.deepEqual(Object.keys(row).sort(), columns[table].map(column => column.column_name).sort(), "Snapshot must contain every original column");
      }
      hashes[table] = digest(snapshot[table], columns[table]);
      // Constraints remain enabled. USER trigger suppression prevents restoring
      // event history from recounting summaries or assigning new user numbers.
      await db.exec(`alter table public.${table} disable trigger user;`);
    }
    await db.exec("begin;");
    try {
      for (const table of ["transfer_events", "users"]) {
        await db.query(`insert into public.${table} overriding system value
          select * from jsonb_populate_recordset(null::public.${table}, $1::jsonb)`, [JSON.stringify(snapshot[table])]);
      }
      if (snapshot.users_sequence) {
        assert.match(String(snapshot.users_sequence.last_value), /^\d+$/);
        assert.equal(typeof snapshot.users_sequence.is_called, "boolean");
        await db.query("select setval('public.users_user_no_seq', $1::bigint, $2::boolean)",
          [String(snapshot.users_sequence.last_value), snapshot.users_sequence.is_called]);
      } else {
        await db.exec("select setval('public.users_user_no_seq', coalesce((select max(user_no) from public.users), 1), exists(select 1 from public.users));");
      }
      await db.exec("commit;");
    } catch (error) {
      await db.exec("rollback;");
      throw error;
    }
    for (const table of ["transfer_events", "users"]) await db.exec(`alter table public.${table} enable trigger user;`);

    const compareOriginalColumns = async () => {
      for (const table of ["transfer_events", "users"]) {
        const restored = (await db.query(`select to_jsonb(row_value) as row from public.${table} as row_value`)).rows.map(value => value.row);
        assert.equal(restored.length, snapshot[table].length, "Row count changed during restore/upgrade");
        assert.equal(digest(restored, columns[table]), hashes[table], "Original row values changed during restore/upgrade");
      }
    };
    phase = "restored row hash comparison";
    await compareOriginalColumns();

    phase = "pending migration replay";
    const directory = path.join(__dirname, "..", "supabase", "migrations");
    const pending = applyPending ? fs.readdirSync(directory).filter(name => /^\d{14}_.+\.sql$/.test(name))
      .sort().filter(name => !capturedVersions.has(name.slice(0, 14))
        && (!throughVersion || name.slice(0, 14) <= throughVersion)) : [];
    for (const name of pending) await db.exec(localSql(fs.readFileSync(path.join(directory, name), "utf8")));
    phase = "upgraded row hash comparison";
    await compareOriginalColumns();

    // Verify identity allocation will continue above the restored largest ID.
    phase = "restored identity sequence verification";
    const sequence = (await db.query("select last_value::text, is_called from public.users_user_no_seq")).rows[0];
    const maximum = (await db.query("select coalesce(max(user_no),1)::text as maximum from public.users")).rows[0].maximum;
    const expectedSequence = snapshot.users_sequence || { last_value: maximum, is_called: snapshot.users.length > 0 };
    assert.equal(sequence.last_value, String(expectedSequence.last_value));
    assert.equal(sequence.is_called, expectedSequence.is_called);
    assert.ok(BigInt(sequence.last_value) >= BigInt(maximum), "Restored sequence must not reuse an existing user number");
    assert.ok(snapshot.users.length === 0 || sequence.is_called || BigInt(sequence.last_value) > BigInt(maximum),
      "Restored next identity must be above the existing maximum");
    return { transferEvents: snapshot.transfer_events.length, users: snapshot.users.length,
      capturedMigrations: captured.length, pendingMigrations: pending.length,
      originalColumnHashes: hashes, originalValuesPreserved: true,
      capturedDefinitionsPreserved: Boolean(snapshot.functions && snapshot.views) };
  } catch (error) {
    // Driver errors can include private SQL parameters and row contents. Keep
    // diagnostics to a fixed phase label and optional standard SQLSTATE.
    const sqlstate = /^[A-Z0-9]{5}$/.test(error.code || "") ? ` SQLSTATE ${error.code}.` : "";
    throw new Error(`Application backup verification failed during ${phase}.${sqlstate}`);
  } finally { await db.close(); }
}

if (require.main === module) {
  const input = process.argv[2];
  if (!input) {
    console.error("Usage: node scripts/check-telemetry-backup.js <decrypted-application-snapshot.json>");
    process.exitCode = 1;
  } else {
    Promise.resolve().then(() => checkSnapshot(JSON.parse(fs.readFileSync(input, "utf8").replace(/^\uFEFF/, ""))))
      .then(result => console.log(`PASS: captured application snapshot restored (future migrations are opt-in). ${JSON.stringify(result)}`))
      .catch(error => { console.error(error.message.startsWith("Application backup") ? error.message : "Application backup input could not be read or parsed."); process.exitCode = 1; });
  }
}
module.exports = { checkSnapshot };
