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

function selectPendingMigrations(names, capturedVersions, throughVersion) {
  assert.match(throughVersion || "", /^\d{14}$/, "Pending upgrades require an explicit migration boundary");
  const maximumCaptured = [...capturedVersions].sort().at(-1);
  assert.match(maximumCaptured || "", /^\d{14}$/, "Captured migration history is required");
  const available = names.filter(name => /^\d{14}_.+\.sql$/.test(name)).sort();
  // An archived/backdated file must never be silently inserted into recorded
  // history. Default recovery does not consult the working tree at all.
  assert.ok(!available.some(name => name.slice(0, 14) <= maximumCaptured
    && !capturedVersions.has(name.slice(0, 14))), "Unexpected older migration absent from captured history");
  return available.filter(name => name.slice(0, 14) > maximumCaptured && name.slice(0, 14) <= throughVersion);
}

// Restore captured state by default. Applying future migrations is opt-in:
// the owner-authorized users reset intentionally discards old user counters.
async function checkSnapshot(snapshot, { applyPending = false, throughVersion } = {}) {
  const db = new PGlite();
  let phase = "snapshot validation";
  try {
    // Restore each snapshot's recorded schema, including backups made before
    // the table rename. Accept one known key rather than guessing identifiers.
    const transferKeys = ["transfers", "transfer_events"].filter(key => Object.hasOwn(snapshot, key));
    assert.equal(transferKeys.length, 1, "Snapshot must contain exactly one transfer table");
    const transferTable = transferKeys[0];
    const tables = [transferTable, "users"];
    assert.ok(Array.isArray(snapshot[transferTable]) && Array.isArray(snapshot.users));
    assert.ok(Array.isArray(snapshot.migrations) && snapshot.migrations.length > 0);
    if (applyPending) assert.match(throughVersion || "", /^\d{14}$/, "Pending upgrades require an explicit migration boundary");
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
      alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
      alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
      create schema cron;
      create table cron.job (
        jobid bigint generated always as identity primary key, jobname text,
        schedule text not null, command text not null, active boolean not null default true,
        nodename text not null default 'localhost', nodeport integer not null default 5432,
        database text not null default 'postgres', username text not null default 'postgres'
      );
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

    let capturedCronJobHash = null;
    let capturedCronJobs = null;
    if (Object.hasOwn(snapshot, "cron_jobs")) {
      phase = "captured cron job restore";
      assert.ok(Array.isArray(snapshot.cron_jobs));
      const catalogColumns = (await db.query(`select column_name, data_type from information_schema.columns
        where table_schema='cron' and table_name='job' order by column_name`)).rows;
      const knownColumns = new Set(catalogColumns.map(column => column.column_name));
      const requiredColumns = ["jobid", "jobname", "schedule", "command", "active"];
      const cronColumns = catalogColumns.filter(column => snapshot.cron_jobs.some(job => Object.hasOwn(job, column.column_name)));
      for (const job of snapshot.cron_jobs) {
        assert.ok(job && typeof job === "object" && !Array.isArray(job));
        assert.ok(requiredColumns.every(column => Object.hasOwn(job, column)));
        assert.ok(Object.keys(job).every(column => knownColumns.has(column)), "Unknown captured cron catalog column");
        assert.deepEqual(Object.keys(job).sort(), cronColumns.map(column => column.column_name), "Captured cron rows must share their catalog schema");
        assert.match(String(job.jobid), /^\d+$/);
        assert.ok(BigInt(job.jobid) > 0n);
        assert.equal(typeof job.active, "boolean");
      }
      capturedCronJobHash = digest(snapshot.cron_jobs, cronColumns);
      // Captured target/owner fields are data in this local shim, never remote
      // connections. Restore disabled/custom jobs instead of migration defaults.
      await db.exec("begin; truncate table cron.job restart identity;");
      try {
        if (snapshot.cron_jobs.length) {
          const names = cronColumns.map(column => column.column_name).join(",");
          await db.query(`insert into cron.job (${names}) overriding system value
            select ${names} from jsonb_populate_recordset(null::cron.job,$1::jsonb)`, [JSON.stringify(snapshot.cron_jobs)]);
        }
        await db.exec("select setval('cron.job_jobid_seq',coalesce((select max(jobid) from cron.job),1),exists(select 1 from cron.job)); commit;");
      } catch (error) { await db.exec("rollback;"); throw error; }
      phase = "captured cron job comparison";
      const restoredJobs = (await db.query("select to_jsonb(j) as row from cron.job j")).rows.map(value => value.row);
      assert.equal(restoredJobs.length, snapshot.cron_jobs.length, "Captured cron job count changed during restore");
      assert.equal(digest(restoredJobs, cronColumns), capturedCronJobHash, "Captured cron job settings changed during restore");
      capturedCronJobs = restoredJobs.length;
    }

    phase = "private row restore";
    const columns = {};
    const hashes = {};
    for (const table of tables) {
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
      for (const table of tables) {
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
    for (const table of tables) await db.exec(`alter table public.${table} enable trigger user;`);

    const compareOriginalColumns = async (cleanupApplied = false, timestampsRemoved = false) => {
      const removedColumns = [];
      for (const table of tables) {
        const renamed = cleanupApplied && table === "transfer_events";
        const restoredTable = renamed ? "transfers" : table;
        const currentColumns = (await db.query(`select column_name, data_type from information_schema.columns
          where table_schema='public' and table_name=$1 order by column_name`, [restoredTable])).rows;
        assert.ok(currentColumns.length > 0, "Captured table must still exist after restore/upgrade");
        const currentByName = new Map(currentColumns.map(column => [column.column_name, column]));
        const removed = columns[table].filter(column => !currentByName.has(column.column_name));
        // Only bounded, explicitly requested cleanups may remove captured
        // columns. Default recovery still restores every original value.
        const allowedRemoved = table === "users" ? [] : [
          ...(renamed ? ["id"] : []),
          ...(timestampsRemoved ? ["updated_at", "completed_at", "summary_received_at", "terminal_received_at"] : [])
        ];
        assert.deepEqual(removed.map(column => column.column_name).sort(),
          columns[table].filter(column => allowedRemoved.includes(column.column_name)).map(column => column.column_name).sort(),
          "Unexpected original column removal during restore/upgrade");
        removedColumns.push(...removed.map(column => `${table}.${column.column_name}`));
        const retained = columns[table].filter(column => currentByName.has(column.column_name));
        for (const column of retained) assert.equal(currentByName.get(column.column_name).data_type, column.data_type,
          "Original column type changed during restore/upgrade");
        const restored = (await db.query(`select to_jsonb(row_value) as row from public.${restoredTable} as row_value`)).rows.map(value => value.row);
        assert.equal(restored.length, snapshot[table].length, "Row count changed during restore/upgrade");
        assert.equal(digest(restored, retained), digest(snapshot[table], retained), "Original retained row values changed during restore/upgrade");
      }
      return removedColumns;
    };
    phase = "restored row hash comparison";
    await compareOriginalColumns();

    phase = "pending migration replay";
    const directory = path.join(__dirname, "..", "supabase", "migrations");
    const pending = applyPending ? selectPendingMigrations(fs.readdirSync(directory), capturedVersions, throughVersion) : [];
    for (const name of pending) await db.exec(localSql(fs.readFileSync(path.join(directory, name), "utf8")));
    phase = "upgraded row hash comparison";
    const cleanupApplied = pending.some(name => name.slice(0, 14) === "20261002163357");
    const timestampsRemoved = pending.some(name => name.slice(0, 14) === "20261002221512");
    const removedColumns = await compareOriginalColumns(cleanupApplied, timestampsRemoved);

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
    return { transferEvents: snapshot[transferTable].length, users: snapshot.users.length,
      capturedMigrations: captured.length, pendingMigrations: pending.length,
      originalColumnHashes: hashes, originalValuesPreserved: removedColumns.length === 0,
      removedColumns, retainedValuesPreserved: true,
      capturedCronJobsRestored: capturedCronJobs !== null, capturedCronJobs, capturedCronJobHash,
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
module.exports = { checkSnapshot, selectPendingMigrations };
