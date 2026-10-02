const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const BACKGROUND_SOURCE = fs.readFileSync(path.join(ROOT, "extension", "background.js"), "utf8");
const PLATFORM_SOURCE = fs.readFileSync(path.join(ROOT, "extension", "platform-content.js"), "utf8");
const VALIDATION_PATH = path.join(ROOT, "supabase", "functions", "transfer-telemetry", "validation.mjs");
const VERCEL_VALIDATION = require(path.join(ROOT, "api", "telemetry-validation.js"));
const VERCEL_TELEMETRY_HANDLER = require(path.join(ROOT, "api", "telemetry.js"));

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
      const response = await new Promise((resolve, reject) => {
        const keepsChannelOpen = listeners.message(
          { type: "RECORD_TRANSFER_TELEMETRY", event },
          { tab: { id: sourceTabId } },
          resolve
        );
        if (keepsChannelOpen !== true) reject(new Error("telemetry listener did not keep the channel open"));
      });
      await this.drain();
      return response;
    },
    async drain() {
      // Delivery is separate from persistence; wait for both chains and any
      // follow-up storage tasks enqueued while a request was completing.
      for (let round = 0; round < 10; round += 1) {
        const chains = new vm.Script("[telemetryWorkChain, telemetryDeliveryChain]").runInContext(sandbox);
        await Promise.all(chains);
        const next = new vm.Script("[telemetryWorkChain, telemetryDeliveryChain]").runInContext(sandbox);
        if (chains[0] === next[0] && chains[1] === next[1]) return;
      }
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

test("failed delivery compacts progress into its terminal outcome and retries after backoff", async () => {
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
  assert.equal(background.storage["context-generator-telemetry-outbox-v1"].length, 1);

  online = true;
  background.storage["context-generator-telemetry-diagnostics-v1"].retry.nextAttemptAt = Date.now() - 1;
  background.listeners.startup();
  await background.drain();

  const delivered = requests.filter((request) => request.online).map((request) => request.payload);
  assert.deepEqual(delivered.map(({ last_stage: lastStage }) => lastStage), [
    "summary_response_started"
  ]);
  assert.ok(delivered.every(({ attempt_id: attemptId }) => attemptId === delivered[0].attempt_id));
  assert.equal(delivered[0].status, "failed");
  assert.equal(delivered[0].failure_reason, "summary_service_busy");
  assert.deepEqual(background.storage["context-generator-telemetry-outbox-v1"], []);
});

test("closing the source tab after a worker restart records the last durable stage as cancelled", async () => {
  const requests = [];
  const background = loadTelemetryBackground(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true };
  });
  await background.drain();

  await background.sendTelemetry(makeEvent({ lastStage: "summary_request_started" }), 42);
  const restarted = loadTelemetryBackground(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true };
  }, background.storage);
  await restarted.drain();
  await restarted.listeners.tabRemoved(42, { isWindowClosing: false });
  await restarted.drain();
  // A bounded terminal record survives cancellation so late server receipts
  // can confirm summary work without changing the cancelled paste outcome.
  const retained = restarted.storage["context-generator-active-transfers-v1"][makeEvent().attemptId];
  assert.equal(retained.event.status, "failed");
  assert.equal(retained.event.failureReason, "user_cancelled");
  assert.ok(retained.expiresAt > Date.now());

  assert.equal(requests.at(-1).status, "failed");
  assert.equal(requests.at(-1).failure_reason, "user_cancelled");
  assert.equal(requests.at(-1).last_stage, "summary_request_started");
  assert.equal(requests.at(-1).character_count, null);
});

test("Supabase payload validation rejects content, unknown stages, and arbitrary failures", async () => {
  const { validateTelemetryPayload } = await import(pathToFileURL(VALIDATION_PATH).href);
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
});

test("Vercel and Supabase enforce the same metadata-only telemetry schema", async () => {
  const { validateTelemetryPayload: validateSupabasePayload } = await import(pathToFileURL(VALIDATION_PATH).href);
  const candidates = [
    makeTelemetryPayload(),
    makeTelemetryPayload({ status: "succeeded", last_stage: "completed", failure_reason: null }),
    makeTelemetryPayload({ conversation: "raw chat" }),
    makeTelemetryPayload({ summary: "generated summary" }),
    makeTelemetryPayload({ last_stage: "unknown_stage" }),
    makeTelemetryPayload({ failure_reason: "arbitrary detail" }),
    makeTelemetryPayload({ attempted_at: "2026-09-31T00:00:00Z" }),
    makeTelemetryPayload({ completed_at: "2026-09-31T00:00:00Z" }),
    makeTelemetryPayload({ summary_confirmed_at: "2026-09-31T00:00:00Z" })
  ];

  for (const candidate of candidates) {
    assert.deepEqual(VERCEL_VALIDATION.validateTelemetryPayload(candidate), validateSupabasePayload(candidate));
  }
});

test("Vercel forwards valid telemetry with server-only Supabase credentials", async (t) => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_TELEMETRY_FUNCTION_URL;
  const originalKey = process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY;
  const originalRelaySecret = process.env.TELEMETRY_RELAY_SECRET;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_TELEMETRY_FUNCTION_URL;
    else process.env.SUPABASE_TELEMETRY_FUNCTION_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY;
    else process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY = originalKey;
    if (originalRelaySecret === undefined) delete process.env.TELEMETRY_RELAY_SECRET;
    else process.env.TELEMETRY_RELAY_SECRET = originalRelaySecret;
  });

  process.env.SUPABASE_TELEMETRY_FUNCTION_URL = "https://example.supabase.co/functions/v1/transfer-telemetry";
  process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY = "server-only-key";
  process.env.TELEMETRY_RELAY_SECRET = "server-only-relay-secret-0123456789abcdef";
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
  assert.equal(upstreamRequests[0].options.headers["X-Cap-Context-Relay"], process.env.TELEMETRY_RELAY_SECRET);
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
  const originalRelaySecret = process.env.TELEMETRY_RELAY_SECRET;
  t.after(() => {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_TELEMETRY_FUNCTION_URL;
    else process.env.SUPABASE_TELEMETRY_FUNCTION_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY;
    else process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY = originalKey;
    if (originalRelaySecret === undefined) delete process.env.TELEMETRY_RELAY_SECRET;
    else process.env.TELEMETRY_RELAY_SECRET = originalRelaySecret;
  });
  process.env.SUPABASE_TELEMETRY_FUNCTION_URL = "https://example.supabase.co/functions/v1/transfer-telemetry";
  process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY = "server-only-key";
  process.env.TELEMETRY_RELAY_SECRET = "server-only-relay-secret-0123456789abcdef";
  global.fetch = async () => ({ ok: false, status: 500 });

  const res = await invokeTelemetryHandler(makeTelemetryPayload());
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, "telemetry_upstream_unavailable");
});

test("background persists server confirmation and never rebinds cached proof to a new attempt", async () => {
  const { createSummaryProof, verifySummaryProof } = await import("../supabase/functions/_shared/summary-proof.mjs");
  const key = "test-only-signing-key-0123456789abcdef";
  const requests = [];
  let summaryRequests = 0;
  let online = true;
  const background = loadTelemetryBackground(async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith("/api/summarize")) {
      summaryRequests++;
      assert.equal(body.telemetry.attempt_id, "11111111-1111-4111-8111-111111111111");
      return { ok: true, json: async () => ({
        summary: "The build passed.", summaryProof: await createSummaryProof(body.telemetry, key), timing: {}
      }) };
    }
    requests.push(body);
    return { ok: online };
  }, {}, "1.4.6");
  await background.drain();
  await background.sendTelemetry(makeEvent({ lastStage: "summary_request_started" }));
  async function summary(attemptId) {
    return new Promise(resolve => background.listeners.message({
      type: "SUMMARIZE_WITH_BACKEND", conversation: "The build passed.", transferId: attemptId
    }, { tab: { id: 7 } }, resolve));
  }
  const first = await summary("11111111-1111-4111-8111-111111111111");
  assert.equal(first.ok, true);
  await background.drain();
  const confirmation = requests.find(request => request.summary_proof);
  assert.ok(confirmation);
  assert.equal(confirmation.last_stage, "summary_completed");
  assert.equal(await verifySummaryProof(confirmation, key), true);
  online = false;
  await background.sendTelemetry(makeEvent({ status: "succeeded", lastStage: "completed", characterCount: 17 }));
  const retained = background.storage["context-generator-telemetry-outbox-v1"];
  assert.equal(await verifySummaryProof(retained[0].payload, key), true);
  online = true;
  const secondId = "33333333-3333-4333-8333-333333333333";
  await background.sendTelemetry(makeEvent({ attemptId: secondId, lastStage: "summary_request_started" }));
  const second = await summary(secondId);
  assert.equal(second.ok, true);
  assert.equal(second.timing.cacheHit, true);
  await background.sendTelemetry(makeEvent({ attemptId: secondId, status: "succeeded", lastStage: "completed" }));
  await background.drain();
  assert.equal(summaryRequests, 1);
  assert.ok(requests.filter(request => request.attempt_id === secondId).every(request => !request.summary_proof));
});

test("completed server summary retains confirmation after source-tab cancellation", async () => {
  const { createSummaryProof, verifySummaryProof } = await import("../supabase/functions/_shared/summary-proof.mjs");
  const key = "test-only-signing-key-0123456789abcdef";
  const requests = [];
  let releaseSummary;
  let requestStarted;
  const started = new Promise(resolve => { requestStarted = resolve; });
  const background = loadTelemetryBackground(async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith("/api/summarize")) {
      requestStarted();
      await new Promise(resolve => { releaseSummary = resolve; });
      return { ok: true, json: async () => ({ summary: "Build passed.", summaryProof: await createSummaryProof(body.telemetry, key) }) };
    }
    requests.push(body);
    return { ok: true };
  }, {}, "1.4.6");
  await background.drain();
  await background.sendTelemetry(makeEvent({ lastStage: "summary_request_started" }), 42);
  const pending = new Promise(resolve => background.listeners.message({
    type: "SUMMARIZE_WITH_BACKEND", conversation: "Build passed.", transferId: makeEvent().attemptId
  }, { tab: { id: 42 } }, resolve));
  await started;
  await background.listeners.tabRemoved(42);
  await background.drain();
  assert.equal(requests.at(-1).failure_reason, "user_cancelled");
  releaseSummary();
  assert.equal((await pending).ok, true);
  await background.drain();
  const confirmation = requests.find(request => request.summary_proof);
  assert.ok(confirmation);
  assert.equal(confirmation.status, "started");
  assert.equal(confirmation.last_stage, "summary_completed");
  assert.equal(await verifySummaryProof(confirmation, key), true);
});
