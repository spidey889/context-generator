// The installed-extension smoke always captures telemetry locally. Its optional
// database mode uses real relay/Edge code and real migrations, with test-only
// credentials and an in-memory PostgreSQL engine; it cannot write production.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const telemetryRelay = require("../api/telemetry");
const { validateTelemetryPayload } = require("../api/telemetry-validation");

const SIGNING_KEY = "smoke-only-signing-key-0123456789abcdef";
const RELAY_KEY = "smoke-only-private-relay-0123456789abcdef";

async function createTelemetrySmokeFixture(repoRoot, databaseEnabled) {
  const { createSummaryProof, verifySummaryProof } = await import(pathToFileURL(path.join(repoRoot, "supabase/functions/_shared/summary-proof.mjs")).href);
  let database = null;
  let rpcChain = Promise.resolve();
  const previousEnvironment = new Map();
  const received = [];
  const responses = [];
  const setEnvironment = (name, value) => {
    if (!previousEnvironment.has(name)) previousEnvironment.set(name, process.env[name]);
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  };
  if (databaseEnabled) {
    const { PGlite } = require(process.env.PGLITE_MODULE_PATH || "@electric-sql/pglite");
    database = new PGlite();
    try {
      await database.exec(`
        create role anon; create role authenticated; create role service_role bypassrls;
        alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
        alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
        alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
        create schema cron;
        create table cron.job (jobid bigint generated always as identity, jobname text, schedule text, command text, active boolean default true);
        create function cron.alter_job(job_id bigint, schedule text default null, command text default null) returns void language sql as $$
          update cron.job as j set schedule=coalesce($2,j.schedule),command=coalesce($3,j.command) where j.jobid=$1; $$;
        create function cron.unschedule(bigint) returns boolean language plpgsql as $$
          begin delete from cron.job where jobid=$1; return found; end; $$;
        create function cron.schedule(text, text, text) returns bigint language plpgsql as $$
          declare result bigint; begin insert into cron.job(jobname,schedule,command) values($1,$2,$3) returning jobid into result; return result; end; $$;
      `);
      const directory = path.join(repoRoot, "supabase/migrations");
      for (const name of fs.readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) {
        // PGlite has no cron scheduler. Replay the unchanged stored job command
        // against its local catalog shim; hosted scheduling is verified separately.
        await database.exec(fs.readFileSync(path.join(directory, name), "utf8")
          .replace("create extension if not exists pg_cron with schema pg_catalog;", "-- Local cron catalog shim."));
      }
    } catch (error) { await database.close(); throw error; }
  }
  const { createTelemetryHandler } = await import(pathToFileURL(path.join(repoRoot, "supabase/functions/transfer-telemetry/handler.mjs")).href);
  const edgeHandler = databaseEnabled ? createTelemetryHandler({
    getEnv: name => ({
      TELEMETRY_RELAY_SECRET: RELAY_KEY, TELEMETRY_SIGNING_KEY: SIGNING_KEY,
      SUPABASE_URL: "https://smoke-database.invalid", SUPABASE_SERVICE_ROLE_KEY: "smoke-only-service-role"
    })[name],
    log() {},
    createClient: () => ({ rpc: (name, args) => {
      const operation = rpcChain.catch(() => {}).then(async () => {
        assert.equal(name, "record_transfer_event");
        const fields = ["attempt_id", "install_id", "attempted_at", "source_platform", "destination_platform", "character_count",
          "status", "last_stage", "failure_reason", "extension_version", "summary_verified", "completed_at", "summary_confirmed_at", "model", "reported_model"];
        const types = ["uuid", "text", "timestamptz", "text", "text", "integer", "text", "text", "text", "text", "boolean", "timestamptz", "timestamptz", "text", "text"];
        await database.exec("set role service_role;");
        try {
          await database.query(`select public.record_transfer_event(${types.map((type, index) => `$${index + 1}::${type}`).join(",")})`, fields.map(field => args[`p_${field}`]));
          return { error: null };
        } catch (error) { return { error: { code: error.code } }; }
        finally { await database.exec("reset role;"); }
      });
      rpcChain = operation;
      return operation;
    } })
  }) : null;

  return {
    received,
    responses,
    configure(origin) {
      if (!databaseEnabled) return;
      setEnvironment("SUPABASE_TELEMETRY_FUNCTION_URL", `${origin}/smoke/transfer-telemetry`);
      setEnvironment("SUPABASE_TELEMETRY_PUBLISHABLE_KEY", "smoke-only-public-key");
      setEnvironment("TELEMETRY_RELAY_SECRET", RELAY_KEY);
      // A real developer environment may configure hosted Redis. This isolated
      // fixture deliberately uses the relay's built-in local limiter fallback.
      for (const name of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) setEnvironment(name, undefined);
    },
    async signSummary(telemetry) {
      const metadata = validateTelemetryPayload(telemetry);
      assert.ok(metadata && metadata.status === "started", "The installed worker must send valid summary metadata.");
      const summaryConfirmedAt = new Date().toISOString();
      return {
        summaryProof: await createSummaryProof(metadata, SIGNING_KEY),
        summaryProofV2: await createSummaryProof({ ...metadata, summary_confirmed_at: summaryConfirmedAt }, SIGNING_KEY),
        summaryProofV3: await createSummaryProof({ ...metadata, summary_confirmed_at: summaryConfirmedAt, model: "gemini-3.6-flash" }, SIGNING_KEY),
        summaryModel: "gemini-3.6-flash",
        summaryConfirmedAt
      };
    },
    async handleTelemetry(request, response, rawBody) {
      const payload = JSON.parse(rawBody);
      assert.ok(validateTelemetryPayload(payload), "Smoke telemetry must remain metadata-only.");
      received.push(payload);
      if (!databaseEnabled) {
        if (payload.summary_proof) assert.equal(await verifySummaryProof(payload, SIGNING_KEY), true);
        response.writeHead(204, { "Access-Control-Allow-Origin": request.headers.origin || "*" });
        response.end();
        responses.push(204);
        return;
      }
      // Adapt the actual HTTP request/response to Vercel's tiny response API.
      request.body = payload;
      const adapter = {
        setHeader: (name, value) => response.setHeader(name, value),
        status(status) { response.statusCode = status; responses.push(status); return this; },
        json(body) { response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(body)); return this; },
        end() { response.end(); return this; }
      };
      await telemetryRelay(request, adapter);
    },
    async handleEdge(request, response, rawBody) {
      assert.ok(databaseEnabled, "The Edge fixture is available only in database smoke mode.");
      const result = await edgeHandler(new Request("https://smoke-edge.invalid/transfer-telemetry", {
        method: request.method, headers: request.headers, body: rawBody
      }));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    },
    async verifyDatabaseOutcome(context) {
      if (!databaseEnabled) return;
      await rpcChain;
      const row = (await database.query(`select status, last_stage, failure_reason, summary_verified,
        received_at::text, summary_confirmed_at::text, model, model_verified
        from public.transfers where attempt_id=$1`, [context.attempt_id])).rows[0];
      assert.ok(row, "The installed worker event must reach the database.");
      assert.equal(row.status, "succeeded");
      assert.equal(row.last_stage, "completed");
      assert.equal(row.failure_reason, null);
      assert.equal(row.summary_verified, true);
      assert.ok(Number.isFinite(Date.parse(row.received_at)));
      assert.ok(Number.isFinite(Date.parse(row.summary_confirmed_at)));
      const terminal = received.findLast(payload => payload.attempt_id === context.attempt_id && payload.status === "succeeded");
      assert.ok(terminal.completed_at, "Older worker completion metadata must remain accepted without storing it.");
      const columns = (await database.query(`select column_name from information_schema.columns
        where table_schema='public' and table_name='transfers'`)).rows.map(column => column.column_name);
      assert.equal(columns.length, 15);
      assert.equal(row.model, "gemini-3.6-flash");
      assert.equal(row.model_verified, true);
      assert.equal(terminal.reported_model, row.model);
      assert.equal(terminal.model, row.model);
      for (const removed of ["updated_at", "completed_at", "summary_received_at", "terminal_received_at"]) {
        assert.equal(columns.includes(removed), false);
      }
      assert.equal(Date.parse(row.summary_confirmed_at), Date.parse(terminal.summary_confirmed_at));
      const counts = (await database.query(`select lifetime_summaries::int as total, today_summaries::int as today,
        today_failed_attempts::int as failed from public.users where install_id=$1`, [context.install_id])).rows[0];
      assert.deepEqual(counts, { total: 1, today: 1, failed: 0 });
      assert.equal((await database.query("select count(*)::int as count from public.transfers where summary_verified")).rows[0].count, 1);
    },
    async close() {
      for (const [name, value] of previousEnvironment) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
      await rpcChain.catch(() => {});
      if (database) await database.close();
    }
  };
}

module.exports = { createTelemetrySmokeFixture };
