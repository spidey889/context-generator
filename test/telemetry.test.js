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
const PROGRESS_MIGRATION_SOURCE = fs.readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260718113749_atomically_preserve_transfer_event_progress.sql"),
  "utf8"
);
const DAILY_USAGE_MIGRATION_SOURCE = fs.readFileSync(
  path.join(ROOT, "supabase", "migrations", "20260718164011_add_anonymous_user_daily_usage.sql"),
  "utf8"
);
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, "extension", "manifest.json"), "utf8"));

function loadTelemetryBackground(fetchImpl, initialStorage = {}) {
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
        getManifest: () => ({ version: "1.3.0" }),
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
    async sendTelemetry(event) {
      return new Promise((resolve, reject) => {
        const keepsChannelOpen = listeners.message(
          { type: "RECORD_TRANSFER_TELEMETRY", event },
          {},
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

test("telemetry reuses one install id and sends only the metadata allowlist", async () => {
  const requests = [];
  const background = loadTelemetryBackground(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true };
  });
  await background.drain();

  const started = makeEvent({
    conversation: "SENSITIVE_RAW_CHAT",
    summary: "SENSITIVE_SUMMARY",
    error: "SENSITIVE_ERROR"
  });
  const succeeded = makeEvent({ status: "succeeded", lastStage: "completed", characterCount: 54321 });
  await background.sendTelemetry(started);
  await background.sendTelemetry(succeeded);

  assert.equal(requests.length, 2);
  assert.equal(requests[0].install_id, requests[1].install_id);
  assert.equal(background.storage["context-generator-install-id-v1"], requests[0].install_id);
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
    ["succeeded", "completed"]
  ]);
  assert.deepEqual(background.storage["context-generator-telemetry-outbox-v1"], []);
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

test("Supabase payload validation rejects content, unknown stages, and arbitrary failures", async () => {
  const { selectLatestTelemetryStage, validateTelemetryPayload } = await import(pathToFileURL(VALIDATION_PATH).href);
  const valid = {
    attempt_id: "11111111-1111-4111-8111-111111111111",
    install_id: "22222222-2222-4222-8222-222222222222",
    attempted_at: "2026-07-18T10:00:00.000Z",
    source_platform: "claude",
    destination_platform: "chatgpt",
    character_count: 50,
    status: "failed",
    last_stage: "paste_started",
    failure_reason: "paste_failed",
    extension_version: "1.3.0"
  };

  assert.deepEqual(validateTelemetryPayload(valid), valid);
  assert.equal(validateTelemetryPayload({ ...valid, conversation: "raw chat" }), null);
  assert.equal(validateTelemetryPayload({ ...valid, summary: "generated summary" }), null);
  assert.equal(validateTelemetryPayload({ ...valid, error: "full JS error" }), null);
  assert.equal(validateTelemetryPayload({ ...valid, last_stage: "provider_response_body_received" }), null);
  assert.equal(validateTelemetryPayload({ ...valid, status: "succeeded", failure_reason: null }), null);
  assert.equal(validateTelemetryPayload({ ...valid, last_stage: "completed" }), null);
  assert.equal(validateTelemetryPayload({ ...valid, failure_reason: "provider said secret detail" }), null);
  assert.equal(validateTelemetryPayload({
    ...valid,
    character_count: 210001,
    failure_reason: "conversation_too_large"
  }).character_count, 210001);
  assert.equal(selectLatestTelemetryStage("summary_response_started", "capture_completed"), "summary_response_started");
  assert.equal(selectLatestTelemetryStage("capture_completed", "summary_completed"), "summary_completed");
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

test("Supabase ingestion is write-only, authenticated by publishable key, and covered by host permission", () => {
  assert.ok(MANIFEST.host_permissions.includes("https://iqkzynzxbmemhtiupwwu.supabase.co/*"));
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

test("Supabase maps anonymous installs to User N and exposes only simple daily usage metadata", () => {
  assert.match(DAILY_USAGE_MIGRATION_SOURCE, /create table public\.analytics_users/);
  assert.match(DAILY_USAGE_MIGRATION_SOURCE, /user_id bigint generated always as identity primary key/);
  assert.match(DAILY_USAGE_MIGRATION_SOURCE, /install_id text not null unique/);
  assert.match(DAILY_USAGE_MIGRATION_SOURCE, /after insert on public\.transfer_events/);
  assert.match(DAILY_USAGE_MIGRATION_SOURCE, /on conflict \(install_id\) do nothing/);
  assert.match(DAILY_USAGE_MIGRATION_SOURCE, /order by existing\.first_received_at, existing\.install_id/);
  assert.match(DAILY_USAGE_MIGRATION_SOURCE, /create view public\.user_daily_usage\s+with \(security_invoker = true\)/);

  const viewSource = DAILY_USAGE_MIGRATION_SOURCE.slice(
    DAILY_USAGE_MIGRATION_SOURCE.indexOf("create view public.user_daily_usage"),
    DAILY_USAGE_MIGRATION_SOURCE.indexOf("comment on view public.user_daily_usage")
  );
  assert.match(viewSource, /'User ' \|\| users\.user_id::text as user_name/);
  assert.match(viewSource, /at time zone 'UTC'/);
  assert.match(viewSource, /count\(\*\) as transfer_count/);
  assert.match(viewSource, /array_agg\(events\.character_count/);
  assert.match(viewSource, /sum\(events\.character_count\)/);
  assert.doesNotMatch(viewSource, /install_id\s+as|first_seen|last_seen|conversation|summary/);

  assert.match(DAILY_USAGE_MIGRATION_SOURCE, /alter table public\.analytics_users enable row level security/);
  assert.match(DAILY_USAGE_MIGRATION_SOURCE, /revoke all privileges on table public\.analytics_users/);
  assert.match(DAILY_USAGE_MIGRATION_SOURCE, /revoke all privileges on table public\.user_daily_usage/);
  assert.match(DAILY_USAGE_MIGRATION_SOURCE, /grant select on table public\.user_daily_usage to service_role/);
});
