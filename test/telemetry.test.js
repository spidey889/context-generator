const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const BACKGROUND_SOURCE = fs.readFileSync(path.join(ROOT, "extension", "background.js"), "utf8");
const PLATFORM_SOURCE = fs.readFileSync(path.join(ROOT, "extension", "platform-content.js"), "utf8");
const EDGE_FUNCTION_SOURCE = fs.readFileSync(
  path.join(ROOT, "supabase", "functions", "transfer-telemetry", "index.ts"),
  "utf8"
);
const VALIDATION_PATH = path.join(ROOT, "supabase", "functions", "transfer-telemetry", "validation.mjs");
const VERCEL_TELEMETRY_SOURCE = fs.readFileSync(path.join(ROOT, "api", "telemetry.js"), "utf8");
const VERCEL_VALIDATION = require(path.join(ROOT, "api", "telemetry-validation.js"));
const VERCEL_TELEMETRY_HANDLER = require(path.join(ROOT, "api", "telemetry.js"));
const PROGRESS_MIGRATION_SOURCE = fs.readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260718113749_atomically_preserve_transfer_event_progress.sql"),
  "utf8"
);
const SIMPLE_USERS_MIGRATION_SOURCE = fs.readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260720101219_add_simple_users_table.sql"),
  "utf8"
);
const USERS_COUNTER_FIX_MIGRATION_SOURCE = fs.readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260720105251_fix_users_counter_permissions_and_daily_reset.sql"),
  "utf8"
);
const USERS_UPDATE_FIRST_MIGRATION_SOURCE = fs.readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260722065035_update_user_summary_before_insert.sql"),
  "utf8"
);
const USER_CANCELLED_MIGRATION_SOURCE = fs.readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260718175852_add_user_cancelled_failure_reason.sql"),
  "utf8"
);
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "extension", "manifest.json"), "utf8"));

function loadTelemetryBackground(fetchImpl, initialStorage = {}, manifestVersion = "1.3.0") {
  const storage = structuredClone(initialStorage);
  const listeners = {};
  let uuidSequence = 1;
  const createEvent = (name) => ({ addListener(listener) { listeners[name] = listener; } });
  const sandbox = {
    AbortController,
    URL,
    clearTimeout,
    console: { debug() {}, error() {}, log() {}, warn() {} },
    crypto: {
      randomUUID() {
        const suffix = String(uuidSequence).padStart(12, "0");
        uuidSequence += 1;
        return `00000000-0000-4000-8000-${suffix}`;
      }
    },
    fetch: (...args) => fetchImpl(...args),
    performance: { now: () => Date.now() },
    setTimeout,
    chrome: {
      action: {
        onClicked: createEvent("actionClicked"),
        setBadgeBackgroundColor: async () => {},
        setBadgeText: async () => {}
      },
      alarms: {
        clear: async () => true,
        create: () => {},
        onAlarm: createEvent("alarm")
      },
      runtime: {
        getManifest: () => ({ version: manifestVersion }),
        onInstalled: createEvent("installed"),
        onStartup: createEvent("startup"),
        onMessage: createEvent("message")
      },
      scripting: { executeScript: async () => {} },
      storage: {
        local: {
          async get(key) {
            if (typeof key === "string") return { [key]: storage[key] };
            return structuredClone(storage);
          },
          async set(values) {
            Object.assign(storage, structuredClone(values));
          }
        },
        onChanged: createEvent("storageChanged")
      },
      tabs: {
        create: async () => ({}),
        onRemoved: createEvent("tabRemoved"),
        query: async () => [],
        sendMessage: async () => ({}),
        update: async () => ({})
      },
      windows: { update: async () => ({}) }
    }
  };

  vm.createContext(sandbox);
  new vm.Script(BACKGROUND_SOURCE, { filename: "extension/background.js" }).runInContext(sandbox);

  return {
    storage,
    listeners,
    async sendTelemetry(event, sourceTabId = 7) {
      return new Promise((resolve, reject) => {
        const keepsChannelOpen = listeners.message(
          { type: "RECORD_TRANSFER_TELEMETRY", event },
          { tab: { id: sourceTabId } },
          resolve
        );
        if (keepsChannelOpen !== true) reject(new Error("telemetry listener did not keep the channel open"));
      });
    },
    drain() {
      return new vm.Script("telemetryWorkChain").runInContext(sandbox);
    }
  };
}

function makeEvent(overrides = {}) {
  return {
    attemptId: "11111111-1111-4111-8111-111111111111",
    attemptedAt: "2026-07-18T10:00:00.000Z",
    sourcePlatform: "claude",
    destinationPlatform: "chatgpt",
    characterCount: null,
    status: "started",
    lastStage: "intent_started",
    failureReason: null,
    ...overrides
  };
}

function makeTelemetryPayload(overrides = {}) {
  return {
    attempt_id: "11111111-1111-4111-8111-111111111111",
    install_id: "22222222-2222-4222-8222-222222222222",
    attempted_at: "2026-07-18T10:00:00.000Z",
    source_platform: "claude",
    destination_platform: "chatgpt",
    character_count: 50,
    status: "failed",
    last_stage: "paste_started",
    failure_reason: "paste_failed",
    extension_version: "1.4.0",
    ...overrides
  };
}

function createMockResponse() {
  const headers = {};
  return {
    headers,
    statusCode: null,
    body: null,
    ended: false,
    setHeader(name, value) {
      headers[name.toLowerCase()] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      this.ended = true;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    }
  };
}

async function invokeTelemetryHandler(body, options = {}) {
  const req = {
    method: options.method || "POST",
    headers: {
      origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
      "content-type": "application/json",
      "x-cap-context-client": "cap-context-extension/1",
      ...options.headers
    },
    body
  };
  const res = createMockResponse();
  await VERCEL_TELEMETRY_HANDLER(req, res);
  return res;
}

test("both transfer entry points start telemetry before early exits", () => {
  const iconStart = PLATFORM_SOURCE.indexOf('if (message?.type === "START_CONTEXT_TRANSFER")');
  const iconEnd = PLATFORM_SOURCE.indexOf("return false;", PLATFORM_SOURCE.indexOf("runContextFlow", iconStart));
  const iconSource = PLATFORM_SOURCE.slice(iconStart, iconEnd);
  assert.ok(iconSource.indexOf("startTransferTelemetry(trace)") < iconSource.indexOf("if (isRunning)"));

  const pickerStart = PLATFORM_SOURCE.indexOf("async function startDestinationTransfer(destinationId)");
  const pickerEnd = PLATFORM_SOURCE.indexOf("function ensureFloatingOverlay()", pickerStart);
  const pickerSource = PLATFORM_SOURCE.slice(pickerStart, pickerEnd);
  assert.ok(pickerSource.indexOf("startTransferTelemetry(trace)") < pickerSource.indexOf("if (isRunning)"));
  assert.ok(pickerSource.indexOf("startTransferTelemetry(trace)") < pickerSource.indexOf("getDetectedConversationMessageCount() === 0"));
});

test("telemetry keeps one install id across summaries, browser restarts, and extension updates", async () => {
  const requests = [];
  const deliver = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true };
  };
  const firstWorker = loadTelemetryBackground(deliver);
  await firstWorker.drain();

  const started = makeEvent({
    conversation: "SENSITIVE_RAW_CHAT",
    summary: "SENSITIVE_SUMMARY",
    error: "SENSITIVE_ERROR"
  });
  const succeeded = makeEvent({ status: "succeeded", lastStage: "completed", characterCount: 54321 });
  await firstWorker.sendTelemetry(started);
  await firstWorker.sendTelemetry(succeeded);

  const installId = requests[0].install_id;
  const restartedWorker = loadTelemetryBackground(deliver, firstWorker.storage);
  await restartedWorker.drain();
  await restartedWorker.sendTelemetry(makeEvent({
    attemptId: "22222222-2222-4222-8222-222222222222",
    status: "succeeded",
    lastStage: "completed",
    characterCount: 600
  }));

  const updatedWorker = loadTelemetryBackground(deliver, restartedWorker.storage, "1.4.0");
  await updatedWorker.drain();
  updatedWorker.listeners.installed({ reason: "update" });
  await updatedWorker.drain();
  await updatedWorker.sendTelemetry(makeEvent({
    attemptId: "33333333-3333-4333-8333-333333333333",
    status: "succeeded",
    lastStage: "completed",
    characterCount: 700
  }));

  assert.equal(requests.length, 4);
  assert.ok(requests.every((request) => request.install_id === installId));
  assert.equal(firstWorker.storage["context-generator-install-id-v1"], installId);
  assert.equal(restartedWorker.storage["context-generator-install-id-v1"], installId);
  assert.equal(updatedWorker.storage["context-generator-install-id-v1"], installId);
  assert.equal(requests.at(-1).extension_version, "1.4.0");
  assert.deepEqual(Object.keys(requests[0]).sort(), [
    "attempt_id",
    "attempted_at",
    "character_count",
    "destination_platform",
    "extension_version",
    "failure_reason",
    "install_id",
    "last_stage",
    "source_platform",
    "status"
  ]);
  const serialized = JSON.stringify(requests);
  assert.doesNotMatch(serialized, /SENSITIVE_RAW_CHAT|SENSITIVE_SUMMARY|SENSITIVE_ERROR/);
  assert.deepEqual(requests.map(({ status, last_stage: lastStage }) => [status, lastStage]), [
    ["started", "intent_started"],
    ["succeeded", "completed"],
    ["succeeded", "completed"],
    ["succeeded", "completed"]
  ]);
  assert.deepEqual(updatedWorker.storage["context-generator-telemetry-outbox-v1"], []);
});

test("extension sends telemetry only to the Vercel backend without Supabase credentials", async () => {
  const requests = [];
  const background = loadTelemetryBackground(async (url, options) => {
    requests.push({ url, options });
    return { ok: true };
  });
  await background.drain();
  await background.sendTelemetry(makeEvent());

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://context-generator-five.vercel.app/api/telemetry");
  assert.equal(requests[0].options.headers["X-Cap-Context-Client"], "cap-context-extension/1");
  assert.equal(requests[0].options.headers.apikey, undefined);
});

test("failed delivery keeps ordered operations and startup retries them", async () => {
  let online = false;
  const requests = [];
  const background = loadTelemetryBackground(async (_url, options) => {
    const payload = JSON.parse(options.body);
    requests.push({ online, payload });
    if (!online) throw new Error("offline");
    return { ok: true };
  });
  await background.drain();

  await background.sendTelemetry(makeEvent());
  await background.sendTelemetry(makeEvent({ lastStage: "capture_started" }));
  await background.sendTelemetry(makeEvent({ lastStage: "capture_completed", characterCount: 1200 }));
  await background.sendTelemetry(makeEvent({
    status: "failed",
    characterCount: 1200,
    lastStage: "summary_response_started",
    failureReason: "summary_service_busy"
  }));
  assert.equal(background.storage["context-generator-telemetry-outbox-v1"].length, 4);

  online = true;
  background.listeners.startup();
  await background.drain();

  const delivered = requests.filter((request) => request.online).map((request) => request.payload);
  assert.deepEqual(delivered.map(({ last_stage: lastStage }) => lastStage), [
    "intent_started",
    "capture_started",
    "capture_completed",
    "summary_response_started"
  ]);
  assert.ok(delivered.every(({ attempt_id: attemptId }) => attemptId === delivered[0].attempt_id));
  assert.equal(delivered[3].status, "failed");
  assert.equal(delivered[3].failure_reason, "summary_service_busy");
  assert.deepEqual(background.storage["context-generator-telemetry-outbox-v1"], []);
});

test("closing the source tab records an in-flight transfer as user cancelled", async () => {
  const requests = [];
  const background = loadTelemetryBackground(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true };
  });
  await background.drain();

  await background.sendTelemetry(makeEvent({ lastStage: "summary_request_started" }), 42);
  background.listeners.tabRemoved(42, { isWindowClosing: false });
  await background.drain();

  assert.equal(requests.at(-1).status, "failed");
  assert.equal(requests.at(-1).failure_reason, "user_cancelled");
  assert.equal(requests.at(-1).last_stage, "summary_request_started");
  assert.equal(requests.at(-1).character_count, null);
});

test("Supabase payload validation rejects content, unknown stages, and arbitrary failures", async () => {
  const { selectLatestTelemetryStage, validateTelemetryPayload } = await import(pathToFileURL(VALIDATION_PATH).href);
  const valid = makeTelemetryPayload({ extension_version: "1.3.0" });

  assert.deepEqual(validateTelemetryPayload(valid), valid);
  assert.equal(validateTelemetryPayload({ ...valid, conversation: "raw chat" }), null);
  assert.equal(validateTelemetryPayload({ ...valid, summary: "generated summary" }), null);
  assert.equal(validateTelemetryPayload({ ...valid, error: "full JS error" }), null);
  assert.equal(validateTelemetryPayload({ ...valid, last_stage: "provider_response_body_received" }), null);
  assert.equal(validateTelemetryPayload({ ...valid, status: "succeeded", failure_reason: null }), null);
  assert.equal(validateTelemetryPayload({ ...valid, last_stage: "completed" }), null);
  assert.equal(validateTelemetryPayload({ ...valid, failure_reason: "provider said secret detail" }), null);
  assert.deepEqual(
    validateTelemetryPayload({ ...valid, failure_reason: "user_cancelled" }),
    { ...valid, failure_reason: "user_cancelled" }
  );
  assert.equal(validateTelemetryPayload({
    ...valid,
    character_count: 210001,
    failure_reason: "conversation_too_large"
  }).character_count, 210001);
  assert.equal(selectLatestTelemetryStage("summary_response_started", "capture_completed"), "summary_response_started");
  assert.equal(selectLatestTelemetryStage("capture_completed", "summary_completed"), "summary_completed");
});

test("Vercel and Supabase enforce the same metadata-only telemetry schema", async () => {
  const { validateTelemetryPayload: validateSupabasePayload } = await import(pathToFileURL(VALIDATION_PATH).href);
  const candidates = [
    makeTelemetryPayload(),
    makeTelemetryPayload({ status: "succeeded", last_stage: "completed", failure_reason: null }),
    makeTelemetryPayload({ conversation: "raw chat" }),
    makeTelemetryPayload({ summary: "generated summary" }),
    makeTelemetryPayload({ last_stage: "unknown_stage" }),
    makeTelemetryPayload({ failure_reason: "arbitrary detail" })
  ];

  for (const candidate of candidates) {
    assert.deepEqual(VERCEL_VALIDATION.validateTelemetryPayload(candidate), validateSupabasePayload(candidate));
  }
});

test("Vercel forwards valid telemetry with server-only Supabase credentials", async (t) => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_TELEMETRY_FUNCTION_URL;
  const originalKey = process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_TELEMETRY_FUNCTION_URL;
    else process.env.SUPABASE_TELEMETRY_FUNCTION_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY;
    else process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY = originalKey;
  });

  process.env.SUPABASE_TELEMETRY_FUNCTION_URL = "https://example.supabase.co/functions/v1/transfer-telemetry";
  process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY = "server-only-key";
  const upstreamRequests = [];
  global.fetch = async (url, options) => {
    upstreamRequests.push({ url, options });
    return { ok: true };
  };

  const payload = makeTelemetryPayload();
  const res = await invokeTelemetryHandler(payload);

  assert.equal(res.statusCode, 204);
  assert.equal(upstreamRequests.length, 1);
  assert.equal(upstreamRequests[0].url, process.env.SUPABASE_TELEMETRY_FUNCTION_URL);
  assert.equal(upstreamRequests[0].options.headers.apikey, "server-only-key");
  assert.deepEqual(JSON.parse(upstreamRequests[0].options.body), payload);
});

test("Vercel rejects telemetry content fields before contacting Supabase", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  let upstreamCalls = 0;
  global.fetch = async () => {
    upstreamCalls += 1;
    return { ok: true };
  };

  const res = await invokeTelemetryHandler(makeTelemetryPayload({ conversation: "raw chat" }));
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, "invalid_schema");
  assert.equal(upstreamCalls, 0);
});

test("Vercel returns a retryable failure when Supabase delivery fails", async (t) => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_TELEMETRY_FUNCTION_URL;
  const originalKey = process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_TELEMETRY_FUNCTION_URL;
    else process.env.SUPABASE_TELEMETRY_FUNCTION_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY;
    else process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY = originalKey;
  });
  process.env.SUPABASE_TELEMETRY_FUNCTION_URL = "https://example.supabase.co/functions/v1/transfer-telemetry";
  process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY = "server-only-key";
  global.fetch = async () => ({ ok: false, status: 500 });

  const res = await invokeTelemetryHandler(makeTelemetryPayload());
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "telemetry_unavailable");
});

test("transfer flow emits each closed telemetry stage without attaching content", () => {
  assert.match(PLATFORM_SOURCE, /startTransferTelemetry\(trace\);[\s\S]*?if \(isRunning\)/);
  assert.match(PLATFORM_SOURCE, /advanceTransferTelemetryStage\(transferTrace, "capture_started"\);\s*await prepareSourceForCapture/);
  assert.match(PLATFORM_SOURCE, /advanceTransferTelemetryStage\(trace, "capture_completed"\)/);
  assert.match(PLATFORM_SOURCE, /advanceTransferTelemetryStage\(trace, "summary_request_started"\)/);
  assert.match(BACKGROUND_SOURCE, /recordKnownTransferTelemetryStage\(transferId, "summary_response_started"\)/);
  assert.match(PLATFORM_SOURCE, /advanceTransferTelemetryStage\(trace, "summary_completed"\)/);
  assert.match(PLATFORM_SOURCE, /advanceTransferTelemetryStage\(transferTrace, "paste_started"\)/);
  assert.match(PLATFORM_SOURCE, /trace\.telemetryLastStage = "completed"/);
});

test("telemetry is routed through Vercel while Supabase remains server-side and write-only", () => {
  assert.ok(MANIFEST.host_permissions.includes("https://context-generator-five.vercel.app/*"));
  assert.ok(!MANIFEST.host_permissions.some((permission) => permission.includes("supabase.co")));
  assert.doesNotMatch(BACKGROUND_SOURCE, /supabase\.co|sb_publishable_|TELEMETRY_PUBLISHABLE_KEY/);
  assert.match(BACKGROUND_SOURCE, /https:\/\/context-generator-five\.vercel\.app\/api\/telemetry/);
  assert.match(VERCEL_TELEMETRY_SOURCE, /SUPABASE_TELEMETRY_FUNCTION_URL/);
  assert.match(VERCEL_TELEMETRY_SOURCE, /SUPABASE_TELEMETRY_PUBLISHABLE_KEY/);
  assert.match(VERCEL_TELEMETRY_SOURCE, /apikey: upstreamKey/);
  assert.match(EDGE_FUNCTION_SOURCE, /request\.headers\.get\("apikey"\)/);
  assert.match(EDGE_FUNCTION_SOURCE, /SUPABASE_PUBLISHABLE_KEYS/);
  assert.match(EDGE_FUNCTION_SOURCE, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(EDGE_FUNCTION_SOURCE, /\.rpc\("record_transfer_event"/);
  assert.match(PROGRESS_MIGRATION_SOURCE, /on conflict \(attempt_id\) do update/);
  assert.match(PROGRESS_MIGRATION_SOURCE, /array_position\(stage_order, excluded\.last_stage\)/);
  assert.match(PROGRESS_MIGRATION_SOURCE, /revoke all on function public\.record_transfer_event/);
  assert.match(PROGRESS_MIGRATION_SOURCE, /to service_role/);
  assert.doesNotMatch(EDGE_FUNCTION_SOURCE, /console\.|conversation|summary|error\.message/);
});

test("Supabase replaces the old usage views with one aggregate users table", () => {
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /drop view if exists public\.user_transfer_activity/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /drop view if exists public\.user_daily_usage/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /drop trigger if exists transfer_events_register_analytics_user on public\.transfer_events/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /drop function if exists public\.register_analytics_user\(\)/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /drop table if exists public\.analytics_users/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /create table public\.users/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /user_no bigint generated always as identity primary key/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /install_id text not null unique/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /total_summaries bigint not null default 0/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /today_summaries bigint not null default 0/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /today_date date not null default \(now\(\) at time zone 'utc'\)::date/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /alter table public\.users enable row level security/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /revoke all privileges on table public\.users/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /grant select, insert, update on table public\.users to service_role/);
  assert.doesNotMatch(SIMPLE_USERS_MIGRATION_SOURCE, /create view public\.user_daily_usage|create view public\.user_transfer_activity/);
});

test("Supabase updates an existing user before inserting a new installation", () => {
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /create or replace function public\.record_user_summary\(\)/);
  assert.match(USERS_UPDATE_FIRST_MIGRATION_SOURCE, /pg_advisory_xact_lock/);
  assert.match(USERS_UPDATE_FIRST_MIGRATION_SOURCE, /update public\.users as existing/);
  assert.match(USERS_UPDATE_FIRST_MIGRATION_SOURCE, /where existing\.install_id = new\.install_id/);
  assert.match(USERS_UPDATE_FIRST_MIGRATION_SOURCE, /if found then\s+return new;/);
  assert.match(USERS_UPDATE_FIRST_MIGRATION_SOURCE, /insert into public\.users \(install_id, total_summaries, today_summaries, today_date\)/);
  assert.ok(
    USERS_UPDATE_FIRST_MIGRATION_SOURCE.indexOf("update public.users as existing") <
    USERS_UPDATE_FIRST_MIGRATION_SOURCE.indexOf("insert into public.users")
  );
  assert.doesNotMatch(USERS_UPDATE_FIRST_MIGRATION_SOURCE, /on conflict/i);
  assert.doesNotMatch(USERS_UPDATE_FIRST_MIGRATION_SOURCE, /login|environment|first_seen_at|last_seen_at/i);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /after insert on public\.transfer_events[\s\S]*when \(new\.status = 'succeeded'\)/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /after update on public\.transfer_events[\s\S]*when \(new\.status = 'succeeded' and old\.status is distinct from 'succeeded'\)/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /revoke all on function public\.record_user_summary\(\)/);
  assert.match(SIMPLE_USERS_MIGRATION_SOURCE, /grant execute on function public\.record_user_summary\(\) to service_role/);
});

test("Supabase gives the invoker trigger write access and resets stale daily totals at UTC midnight", () => {
  assert.match(USERS_COUNTER_FIX_MIGRATION_SOURCE, /grant select, insert, update on table public\.users to service_role/);
  assert.match(USERS_COUNTER_FIX_MIGRATION_SOURCE, /drop view if exists public\.user_transfer_activity/);
  assert.match(USERS_COUNTER_FIX_MIGRATION_SOURCE, /create extension if not exists pg_cron with schema pg_catalog/);
  assert.match(USERS_COUNTER_FIX_MIGRATION_SOURCE, /'cap-context-reset-daily-user-summaries'/);
  assert.match(USERS_COUNTER_FIX_MIGRATION_SOURCE, /'0 0 \* \* \*'/);
  assert.match(USERS_COUNTER_FIX_MIGRATION_SOURCE, /today_summaries = 0/);
  assert.match(USERS_COUNTER_FIX_MIGRATION_SOURCE, /today_date = \(now\(\) at time zone 'utc'\)::date/);
  assert.match(USERS_COUNTER_FIX_MIGRATION_SOURCE, /where today_date < \(now\(\) at time zone 'utc'\)::date/);
});

test("user cancellation stays a closed metadata-only failure reason", () => {
  assert.match(BACKGROUND_SOURCE, /"user_cancelled"/);
  assert.match(EDGE_FUNCTION_SOURCE, /validation\.mjs/);
  assert.match(USER_CANCELLED_MIGRATION_SOURCE, /drop constraint if exists transfer_events_failure_reason_check/);
  assert.match(USER_CANCELLED_MIGRATION_SOURCE, /'user_cancelled'::text/);
  assert.doesNotMatch(
    USER_CANCELLED_MIGRATION_SOURCE,
    /raw_chat|generated_summary|provider_response_body|error_message|stack_trace|page_url/
  );
});
