const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { clockTest } = require("./helpers/clock");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "extension", "background.js"), "utf8");
const OUTBOX = "context-generator-telemetry-outbox-v1";
const ACTIVE = "context-generator-active-transfers-v1";
const DIAGNOSTICS = "context-generator-telemetry-diagnostics-v1";
const INSTALL = "context-generator-install-id-v1";
const NOW = Date.parse("2026-10-02T10:00:00.000Z");
const id = number => `11111111-1111-4111-8111-${String(number).padStart(12, "0")}`;
const success = () => ({ ok: true, status: 204 });
const rejection = (status, code, retryAfter = null) => ({
  ok: false, status, json: async () => ({ code, error: "SENSITIVE_RESPONSE_BODY" }),
  headers: { get: name => name === "retry-after" ? retryAfter : null }
});

function event(number = 1, overrides = {}) {
  return {
    attemptId: id(number), attemptedAt: "2026-10-02T09:59:00.000Z",
    sourcePlatform: "claude", destinationPlatform: "chatgpt", characterCount: 30,
    status: "started", lastStage: "capture_completed", failureReason: null, ...overrides
  };
}

function payload(number = 1, overrides = {}) {
  const input = event(number);
  return {
    attempt_id: input.attemptId, install_id: id(999), attempted_at: input.attemptedAt,
    source_platform: input.sourcePlatform, destination_platform: input.destinationPlatform,
    character_count: input.characterCount, status: input.status, last_stage: input.lastStage,
    failure_reason: input.failureReason, extension_version: "1.4.6", ...overrides
  };
}

function profile(local = {}, session = {}) {
  return { local: structuredClone(local), session: structuredClone(session) };
}

function worker(fetchImpl, shared = profile(), now = NOW, version = "1.4.6") {
  const listeners = {};
  const alarms = [];
  // Scoped timer tests supply a live clock; restart/retry fixtures can still
  // advance their explicit timestamp without scheduling real delays.
  const clock = typeof now === "function" ? { get now() { return now(); } } : { now };
  let uuidSequence = 5000;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [clock.now])); }
    static now() { return clock.now; }
  }
  const addEvent = name => ({ addListener(fn) { listeners[name] = fn; } });
  const storageArea = values => ({
    get: async key => structuredClone(typeof key === "string" ? { [key]: values[key] } : values),
    set: async entries => Object.assign(values, structuredClone(entries))
  });
  const math = Object.create(Math);
  math.random = () => 0.5;
  const sandbox = {
    AbortController, URL, Date: ClockDate, Math: math, clearTimeout, setTimeout,
    console: { debug() {}, error() {}, log() {}, warn() {} },
    crypto: { randomUUID: () => id(uuidSequence++) },
    performance: { now: () => clock.now }, fetch: fetchImpl,
    chrome: {
      action: { onClicked: addEvent("click"), setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {} },
      alarms: { onAlarm: addEvent("alarm"), clear: async () => true, create: (name, options) => alarms.push({ name, ...options }) },
      runtime: {
        getManifest: () => ({ version }), onInstalled: addEvent("installed"),
        onStartup: addEvent("startup"), onMessage: addEvent("message")
      },
      scripting: { executeScript: async () => {} },
      storage: { local: storageArea(shared.local), session: storageArea(shared.session), onChanged: addEvent("storageChanged") },
      tabs: { onRemoved: addEvent("removed"), query: async () => [], create: async () => ({}), sendMessage: async () => ({}), update: async () => ({}) },
      windows: { update: async () => ({}) }
    }
  };
  vm.createContext(sandbox);
  new vm.Script(SOURCE, { filename: "background.js" }).runInContext(sandbox);
  const evaluate = expression => new vm.Script(expression).runInContext(sandbox);
  return {
    shared, listeners, alarms, clock, evaluate,
    ack: input => new Promise(resolve => listeners.message({ type: "RECORD_TRANSFER_TELEMETRY", event: input }, { tab: { id: 42 } }, resolve)),
    async persisted() {
      for (let round = 0; round < 20; round++) {
        const chain = evaluate("telemetryWorkChain");
        await chain;
        if (chain === evaluate("telemetryWorkChain")) return;
      }
      throw new Error("storage queue did not settle");
    },
    async settled() {
      for (let round = 0; round < 20; round++) {
        const chains = evaluate("[telemetryWorkChain, telemetryDeliveryChain]");
        await Promise.all(chains);
        const next = evaluate("[telemetryWorkChain, telemetryDeliveryChain]");
        if (chains[0] === next[0] && chains[1] === next[1]) return;
      }
      throw new Error("telemetry did not settle");
    },
    async retry() {
      clock.now = Math.max(clock.now, shared.local[DIAGNOSTICS]?.retry?.nextAttemptAt || clock.now);
      listeners.alarm({ name: "retry-transfer-telemetry" });
      await this.settled();
    }
  };
}

function blockStorage(background, area, method) {
  background.evaluate(`globalThis.originalStorageMethod = chrome.storage.${area}.${method};
    globalThis.storageBlock = new Promise(resolve => { globalThis.releaseStorage = resolve; });
    globalThis.storageBlocked = new Promise(resolve => { globalThis.noteStorageBlocked = resolve; });
    chrome.storage.${area}.${method} = async (...args) => {
      noteStorageBlocked();
      await storageBlock;
      return originalStorageMethod(...args);
    };`);
  const release = () => background.evaluate(`chrome.storage.${area}.${method} = originalStorageMethod; releaseStorage();`);
  release.began = background.evaluate("storageBlocked");
  return release;
}

function summaryWithin(background, deadlineAt = null, conversation = "Complete captured transcript", transferId = id(1)) {
  let timeout;
  const request = new Promise(resolve => background.listeners.message({
    type: "SUMMARIZE_WITH_BACKEND", conversation, transferId, deadlineAt
  }, {}, resolve));
  const observed = Promise.race([request, new Promise(resolve => { timeout = setTimeout(() => resolve(null), 1100); })])
    .finally(() => clearTimeout(timeout));
  return { request, observed };
}

test("slow delivery never blocks durable terminal appends, and acknowledgement preserves newer revisions", async () => {
  let release;
  let requestStarted;
  const began = new Promise(resolve => { requestStarted = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const requests = [];
  const background = worker(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    if (requests.length === 1) { requestStarted(); await blocked; }
    return success();
  });
  await background.settled();
  await background.ack(event());
  await began;
  assert.equal((await background.ack(event(1, {
    status: "failed", lastStage: "paste_started", failureReason: "paste_failed"
  }))).ok, true);
  await background.ack(event(2));
  await background.persisted();
  assert.equal(background.shared.local[OUTBOX].length, 2);
  assert.equal(background.shared.local[OUTBOX][0].payload.status, "failed");
  release();
  await background.settled();
  assert.deepEqual(requests.map(input => [input.attempt_id, input.status]), [[id(1), "started"], [id(1), "failed"], [id(2), "started"]]);
  assert.deepEqual(background.shared.local[OUTBOX], []);
});

test("legacy queues compact per attempt and deliver terminal outcomes then receipts before progress", async () => {
  const inputs = [
    payload(1), payload(1, { last_stage: "summary_completed" }), payload(2),
    payload(3, { status: "failed", last_stage: "paste_started", failure_reason: "paste_failed" }),
    payload(4, { last_stage: "summary_completed", summary_proof: "a".repeat(64) })
  ];
  const shared = profile({ [OUTBOX]: inputs.map((input, index) => ({ deliveryId: id(200 + index), payload: input })) });
  const delivered = [];
  const background = worker(async (_url, options) => { delivered.push(JSON.parse(options.body)); return success(); }, shared);
  await background.settled();
  assert.deepEqual(delivered.map(input => input.attempt_id), [id(3), id(4), id(1), id(2)]);
  assert.equal(delivered[2].last_stage, "summary_completed");
  assert.equal(delivered[0].completed_at, undefined, "legacy completion times must remain unknown");
  assert.deepEqual(shared.local[OUTBOX], []);
});

test("permanent rejected entries are quarantined without blocking valid terminal reports", async () => {
  const shared = profile({ [OUTBOX]: [1, 2].map(number => ({ deliveryId: id(number + 100), payload: payload(number, {
    status: "succeeded", last_stage: "completed", completed_at: "2026-10-02T09:59:45.000Z"
  }) })) });
  const delivered = [];
  const background = worker(async (_url, options) => {
    const input = JSON.parse(options.body);
    delivered.push(input);
    return input.attempt_id === id(1) ? rejection(422, "invalid_payload") : success();
  }, shared);
  await background.settled();
  assert.equal(delivered.length, 2);
  assert.deepEqual(shared.local[OUTBOX], []);
  assert.equal(shared.local[DIAGNOSTICS].counts.quarantined_remote, 1);
  assert.equal(shared.local[DIAGNOSTICS].recent[0].status, "succeeded");
  assert.equal(shared.local[DIAGNOSTICS].recent[0].httpStatus, 422);
  assert.doesNotMatch(JSON.stringify(shared.local[DIAGNOSTICS]), /SENSITIVE_RESPONSE_BODY/);
});

test("malformed stored payloads never transmit content or copy it into quarantine diagnostics", async () => {
  const shared = profile({ [OUTBOX]: [
    { deliveryId: id(100), payload: payload(1, { conversation: "SENSITIVE_CHAT", summary: "SENSITIVE_SUMMARY" }) },
    { deliveryId: id(101), payload: payload(2) }
  ] });
  const delivered = [];
  const background = worker(async (_url, options) => { delivered.push(JSON.parse(options.body)); return success(); }, shared);
  await background.settled();
  assert.deepEqual(delivered.map(input => input.attempt_id), [id(2)]);
  assert.equal(shared.local[DIAGNOSTICS].counts.quarantined_local, 1);
  assert.doesNotMatch(JSON.stringify(shared.local[DIAGNOSTICS]), /SENSITIVE_CHAT|SENSITIVE_SUMMARY/);
});

test("temporary failures back off durably across restart, honor Retry-After, and retain terminal reports", async () => {
  const shared = profile({ [INSTALL]: id(999) });
  let online = false;
  let attempts = 0;
  const fetchImpl = async () => { attempts++; return online ? success() : rejection(429, "rate_limited", "600"); };
  const first = worker(fetchImpl, shared);
  await first.settled();
  await first.ack(event());
  await first.settled();
  const retryAt = shared.local[DIAGNOSTICS].retry.nextAttemptAt;
  assert.equal(retryAt - NOW, 600000);
  await first.ack(event(1, { status: "succeeded", lastStage: "completed" }));
  await first.settled();
  assert.equal(attempts, 1, "new progress must not hammer an unavailable endpoint");
  const restarted = worker(fetchImpl, shared);
  await restarted.settled();
  assert.equal(attempts, 1);
  assert.equal(shared.local[INSTALL], id(999));
  assert.equal(shared.local[OUTBOX][0].payload.status, "succeeded");
  online = true;
  await restarted.retry();
  assert.equal(attempts, 2);
  assert.deepEqual(shared.local[OUTBOX], []);
  assert.equal(shared.local[DIAGNOSTICS].retry, undefined);
});

test("configuration failures pause delivery longer and retry delay stays bounded", async () => {
  const background = worker(async () => rejection(503, "telemetry_unavailable", "999999"));
  await background.settled();
  await background.ack(event());
  await background.settled();
  assert.equal(background.shared.local[DIAGNOSTICS].retry.kind, "configuration");
  assert.equal(background.shared.local[DIAGNOSTICS].retry.nextAttemptAt - NOW, 3600000);
  await background.retry();
  assert.equal(background.shared.local[DIAGNOSTICS].retry.failures, 2);
  assert.ok(background.shared.local[DIAGNOSTICS].retry.nextAttemptAt - background.clock.now <= 3600000);
  assert.equal(background.shared.local[OUTBOX].length, 1);
});

test("active state and v3 served-model receipt survive worker restart before tab cancellation", async () => {
  const shared = profile();
  const proof = "b".repeat(64);
  const confirmedAt = "2026-10-02T10:00:03.000Z";
  const summaryRequests = [];
  const fetchImpl = async (url, options) => {
    if (url.endsWith("/api/telemetry")) throw new Error("offline");
    summaryRequests.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ summary: "SENSITIVE_SUMMARY", summaryProof: "a".repeat(64),
      summaryProofV2: "c".repeat(64), summaryProofV3: proof, summaryModel: "gemini-3.5-flash-lite", summaryConfirmedAt: confirmedAt }) };
  };
  const first = worker(fetchImpl, shared);
  await first.settled();
  await first.ack(event());
  await first.evaluate(`summarizeWithBackend("SENSITIVE_TRANSCRIPT", "${id(1)}")`);
  await first.settled();
  assert.equal(summaryRequests[0].telemetry.attempt_id, id(1));
  assert.equal(shared.session[ACTIVE][id(1)].summary_proof, proof);
  assert.equal(shared.session[ACTIVE][id(1)].summary_confirmed_at, confirmedAt);
  assert.equal(shared.session[ACTIVE][id(1)].model, "gemini-3.5-flash-lite");
  const second = worker(fetchImpl, shared, NOW + 10000, "1.4.7");
  await second.settled();
  await second.listeners.removed(42);
  await second.settled();
  const queued = shared.local[OUTBOX][0].payload;
  assert.equal(queued.status, "failed");
  assert.equal(queued.failure_reason, "user_cancelled");
  assert.equal(queued.summary_proof, proof);
  assert.equal(queued.summary_confirmed_at, confirmedAt);
  assert.equal(queued.model, "gemini-3.5-flash-lite");
  assert.equal(queued.extension_version, "1.4.6", "a worker update must preserve the signed version");
  assert.equal(queued.completed_at, "2026-10-02T10:00:10.000Z");
  assert.doesNotMatch(JSON.stringify(shared), /SENSITIVE_SUMMARY|SENSITIVE_TRANSCRIPT/);
});

test("unsigned serving reports survive progress, worker restart and delivery without inventing proof", async () => {
  const shared = profile();
  const first = worker(async () => { throw new Error("offline"); }, shared);
  await first.settled();
  await first.ack(event(1, { lastStage: "summary_completed", reportedModel: "gemini-3.5-flash-lite" }));
  await first.ack(event()); // Delayed pre-summary progress cannot erase attribution.
  await first.ack(event(1, { lastStage: "paste_started" }));
  await first.settled();
  assert.equal(shared.session[ACTIVE][id(1)].event.reportedModel, "gemini-3.5-flash-lite");
  const received = [];
  const second = worker(async (_url, options) => { received.push(JSON.parse(options.body)); return success(); }, shared);
  await second.settled();
  await second.ack(event(1, { status: "succeeded", lastStage: "completed" }));
  await second.retry();
  const terminal = received.findLast(input => input.status === "succeeded");
  assert.equal(terminal.reported_model, "gemini-3.5-flash-lite");
  for (const field of ["summary_proof", "summary_confirmed_at", "model"]) assert.equal(terminal[field], undefined);
});

test("late serving reports preserve the first terminal outcome and reject text or pre-summary attribution", async () => {
  const shared = profile();
  const background = worker(async () => { throw new Error("offline"); }, shared);
  await background.settled();
  for (const input of [event(2, { reportedModel: "local-direct" }),
    event(3, { lastStage: "summary_completed", reportedModel: "SENSITIVE_TRANSCRIPT" })]) await background.ack(input);
  await background.ack(event(1, { status: "succeeded", lastStage: "completed" }));
  await background.ack(event(1, { lastStage: "summary_completed", reportedModel: "local-direct" }));
  await background.ack(event(1, { status: "failed", lastStage: "paste_started", failureReason: "paste_failed", reportedModel: "gemini-3.6-flash" }));
  await background.settled();
  assert.equal(shared.local[OUTBOX].length, 1);
  assert.equal(shared.local[OUTBOX][0].payload.status, "succeeded");
  assert.equal(shared.local[OUTBOX][0].payload.reported_model, "local-direct");
  assert.doesNotMatch(JSON.stringify(shared), /SENSITIVE_TRANSCRIPT/);
});

test("queue merges keep the first v3 proof/model pair through legacy progress and retries", async () => {
  const { createSummaryProof, verifySummaryProof } = await import("../supabase/functions/_shared/summary-proof.mjs");
  const key = "queue-model-test-key-0123456789abcdef";
  const signed = payload(1, { last_stage: "summary_completed", reported_model: "gemini-3.6-flash",
    model: "local-direct", summary_confirmed_at: "2026-10-02T10:00:00.000Z" });
  signed.summary_proof = await createSummaryProof(signed, key);
  const legacy = { ...signed };
  delete legacy.model;
  legacy.summary_proof = await createSummaryProof(legacy, key);
  const replacement = { ...signed, model: "gemini-3.6-flash" };
  replacement.summary_proof = await createSummaryProof(replacement, key);
  const shared = profile({ [OUTBOX]: [signed, legacy, replacement].map((value, index) => ({ deliveryId: id(100 + index), payload: value })) });
  const received = [];
  const background = worker(async (_url, options) => { received.push(JSON.parse(options.body)); return success(); }, shared);
  await background.settled();
  assert.equal(received.length, 1);
  assert.equal(received[0].model, "local-direct");
  assert.equal(received[0].reported_model, "gemini-3.6-flash", "A report must not replace authenticated attribution.");
  assert.equal(received[0].summary_proof, signed.summary_proof);
  assert.equal(await verifySummaryProof(received[0], key), true);
});

test("an unsigned legacy queue keeps its original version across update, summary and terminal reports", async () => {
  const shared = profile({
    [INSTALL]: id(999),
    [OUTBOX]: [{ deliveryId: id(100), payload: payload(1, { extension_version: "1.4.5" }) }],
    [DIAGNOSTICS]: { counts: {}, recent: [], retry: { failures: 1, nextAttemptAt: NOW + 60000, kind: "retry" } }
  }, { [ACTIVE]: { [id(1)]: { event: event(), tabId: 42, expiresAt: NOW + 300000 } } });
  let summaryContext;
  const background = worker(async (url, options) => {
    if (url.endsWith("/api/telemetry")) throw new Error("offline");
    summaryContext = JSON.parse(options.body).telemetry;
    return { ok: true, status: 200, json: async () => ({ summary: "result", summaryProof: "b".repeat(64) }) };
  }, shared, NOW, "1.4.6");
  await background.settled();
  await background.ack(event(1, { lastStage: "summary_request_started" }));
  await background.evaluate(`summarizeWithBackend("transcript", "${id(1)}")`);
  await background.ack(event(1, { status: "succeeded", lastStage: "completed" }));
  await background.settled();
  assert.equal(summaryContext.extension_version, "1.4.5");
  assert.equal(shared.local[OUTBOX][0].payload.extension_version, "1.4.5");
  assert.equal(shared.local[OUTBOX][0].payload.status, "succeeded");
  assert.equal(shared.local[OUTBOX][0].payload.summary_proof, "b".repeat(64));
});

test("compaction keeps a newer signed receipt paired with its authenticated version", async () => {
  const { createSummaryProof, verifySummaryProof } = await import("../supabase/functions/_shared/summary-proof.mjs");
  const signingKey = "test-only-cross-update-signing-key-0123456789";
  const signed = payload(1, { extension_version: "1.4.6", last_stage: "summary_completed",
    summary_confirmed_at: "2026-10-02T10:00:00.000Z" });
  signed.summary_proof = await createSummaryProof(signed, signingKey);
  const shared = profile({ [OUTBOX]: [
    { deliveryId: id(100), payload: payload(1, { extension_version: "1.4.5" }) },
    { deliveryId: id(101), payload: signed }
  ] });
  const received = [];
  const background = worker(async (_url, options) => { received.push(JSON.parse(options.body)); return success(); }, shared);
  await background.settled();
  assert.equal(received.length, 1);
  assert.equal(received[0].extension_version, "1.4.6");
  assert.equal(await verifySummaryProof(received[0], signingKey), true);
});

test("expired active attempts become unknown diagnostics without manufactured failure events", async () => {
  const shared = profile({}, { [ACTIVE]: {
    [id(1)]: { event: event(), tabId: 42, expiresAt: NOW - 1 },
    [id(2)]: { event: event(2, { status: "failed", failureReason: "paste_failed" }), tabId: 42, expiresAt: NOW - 1 }
  } });
  const delivered = [];
  const background = worker(async (_url, options) => { delivered.push(JSON.parse(options.body)); return success(); }, shared);
  await background.settled();
  await background.listeners.removed(42);
  await background.settled();
  assert.deepEqual(delivered, []);
  assert.deepEqual(shared.session[ACTIVE], {});
  assert.equal(shared.local[DIAGNOSTICS].counts.outcome_unknown, 1);
  assert.equal(shared.local[DIAGNOSTICS].recent[0].status, "started");
});

test("active expiry is rechecked on tab removal even when the same worker stays alive", async () => {
  const background = worker(async () => { throw new Error("offline"); });
  await background.settled();
  await background.ack(event());
  await background.settled();
  background.clock.now += 7 * 60 * 1000;
  await background.listeners.removed(42);
  await background.settled();
  assert.equal(background.shared.local[OUTBOX][0].payload.status, "started");
  assert.equal(background.shared.local[DIAGNOSTICS].counts.outcome_unknown, 1);
  assert.deepEqual(background.shared.session[ACTIVE], {});
});

test("compaction keeps progress monotonic and the first terminal outcome and timestamp sticky", async () => {
  const background = worker(async () => { throw new Error("offline"); });
  await background.settled();
  await background.ack(event(1, { lastStage: "summary_completed" }));
  await background.ack(event(1, { lastStage: "capture_started", characterCount: null }));
  await background.ack(event(1, { status: "failed", lastStage: "paste_started", failureReason: "paste_failed" }));
  background.clock.now += 2000;
  await background.ack(event(1, { status: "succeeded", lastStage: "completed" }));
  await background.settled();
  const queued = background.shared.local[OUTBOX][0].payload;
  assert.equal(queued.status, "failed");
  assert.equal(queued.last_stage, "paste_started");
  assert.equal(queued.failure_reason, "paste_failed");
  assert.equal(queued.character_count, 30);
  assert.equal(queued.completed_at, "2026-10-02T10:00:00.000Z");
  assert.equal(background.shared.local[OUTBOX].length, 1);
});

test("queue bounds remove progress before terminals and record expired or overflowed terminal outcomes", async () => {
  const inputs = [];
  for (let number = 1; number <= 505; number++) inputs.push({ deliveryId: id(number + 1000), payload: payload(number), queuedAt: NOW });
  for (let number = 506; number <= 510; number++) inputs.push({ deliveryId: id(number + 1000), payload: payload(number, {
    status: "succeeded", last_stage: "completed"
  }), queuedAt: NOW });
  inputs.push({ deliveryId: id(1600), payload: payload(600, { status: "failed", failure_reason: "paste_failed" }), queuedAt: NOW - 8 * 24 * 60 * 60 * 1000 });
  const shared = profile({ [OUTBOX]: inputs });
  const background = worker(async () => { throw new Error("offline"); }, shared);
  await background.settled();
  assert.equal(shared.local[OUTBOX].length, 500);
  assert.equal(shared.local[OUTBOX].filter(entry => entry.payload.status === "succeeded").length, 5);
  assert.equal(shared.local[DIAGNOSTICS].counts.overflow_progress, 10);
  assert.equal(shared.local[DIAGNOSTICS].counts.expired_terminal, 1);
  assert.ok(shared.local[DIAGNOSTICS].recent.some(input => input.attemptId === id(600) && input.reason === "expired_terminal"));
  const allTerminal = profile({ [OUTBOX]: Array.from({ length: 601 }, (_entry, number) => ({ deliveryId: id(number + 2000), payload: payload(number + 1, {
    status: "succeeded", last_stage: "completed"
  }), queuedAt: NOW })) });
  const second = worker(async () => { throw new Error("offline"); }, allTerminal);
  await second.settled();
  assert.equal(allTerminal.local[OUTBOX].length, 500);
  assert.equal(allTerminal.local[DIAGNOSTICS].counts.overflow_terminal, 101);
  assert.equal(allTerminal.local[DIAGNOSTICS].recent.length, 100);
  allTerminal.local[OUTBOX].push({ deliveryId: id(9900), payload: payload(9900, {
    summary_proof: "a".repeat(64), last_stage: "summary_completed"
  }), queuedAt: NOW });
  const third = worker(async () => { throw new Error("offline"); }, allTerminal);
  await third.settled();
  assert.equal(allTerminal.local[DIAGNOSTICS].counts.overflow_terminal, 101, "a proof must be trimmed before a terminal outcome");
  assert.equal(allTerminal.local[DIAGNOSTICS].counts.overflow_confirmation, 1);
  assert.equal(allTerminal.local[DIAGNOSTICS].recent.at(-1).summaryConfirmed, true);
});

for (const scenario of [
  { name: "terminal over progress", terminals: false, signed: false, terminal: true, dropped: 1, reason: "overflow_progress" },
  { name: "receipt over progress", terminals: false, signed: true, terminal: false, dropped: 1, reason: "overflow_progress" },
  { name: "new terminal in a terminal-only queue", terminals: true, signed: false, terminal: true, dropped: 1, reason: "overflow_terminal" },
  { name: "progress below terminals", terminals: true, signed: false, terminal: false, dropped: 501, reason: "overflow_progress" },
  { name: "receipt below terminals", terminals: true, signed: true, terminal: false, dropped: 501, reason: "overflow_confirmation" }
]) test(`outbox appends ${scenario.name} with one bounded durable snapshot when later writes fail`, async () => {
  const proof = "d".repeat(64);
  const incoming = event(501, { status: scenario.terminal ? "succeeded" : "started",
    lastStage: scenario.terminal ? "completed" : scenario.signed ? "summary_completed" : "capture_completed" });
  const entries = Array.from({ length: 500 }, (_, i) => ({ deliveryId: id(i + 10000), queuedAt: NOW,
    payload: payload(i + 1, scenario.terminals ? { status: "succeeded", last_stage: "completed" } : {}) }));
  const shared = profile({ [OUTBOX]: entries,
    [DIAGNOSTICS]: { counts: {}, recent: [], retry: { failures: 1, nextAttemptAt: NOW + 60000, kind: "retry" } }
  }, scenario.signed ? { [ACTIVE]: { [id(501)]: {
    event: event(501), tabId: 42, expiresAt: NOW + 300000, summary_proof: proof,
    summary_confirmed_at: new Date(NOW).toISOString(), model: "gemini-3.5-flash-lite"
  } } } : {});
  const background = worker(async () => { throw new Error("offline"); }, shared);
  await background.settled();
  // Simulate storage becoming unavailable after its first outbox commit.
  // A post-write cleanup cannot repair an already oversized durable snapshot.
  background.evaluate(`globalThis.outboxWriteSizes = []; const originalSet = chrome.storage.local.set;
    chrome.storage.local.set = async entries => {
      const outbox = entries[${JSON.stringify(OUTBOX)}];
      if (Array.isArray(outbox)) {
        outboxWriteSizes.push(outbox.length);
        if (outboxWriteSizes.length > 1) throw new Error("storage unavailable after first outbox commit");
      }
      return originalSet(entries);
    };`);
  assert.equal((await background.ack(incoming)).ok, true);
  await background.settled();
  assert.deepEqual(Array.from(background.evaluate("outboxWriteSizes")), [500]);
  assert.equal(shared.local[OUTBOX].length, 500);
  assert.ok(shared.local[OUTBOX].every(entry => entry.payload.attempt_id !== id(scenario.dropped)));
  assert.equal(shared.local[DIAGNOSTICS].counts[scenario.reason], 1);
  assert.equal(shared.local[DIAGNOSTICS].recent.at(-1).attemptId, id(scenario.dropped));
  assert.doesNotMatch(JSON.stringify(shared.local[DIAGNOSTICS]), new RegExp(proof));
  const retained = shared.local[OUTBOX].find(entry => entry.payload.attempt_id === id(501));
  if (scenario.dropped === 501) assert.equal(retained, undefined);
  else {
    assert.equal(retained.payload.status, incoming.status);
    assert.equal(retained.payload.last_stage, incoming.lastStage);
    if (scenario.signed) {
      assert.equal(retained.payload.summary_proof, proof);
      assert.equal(retained.payload.model, "gemini-3.5-flash-lite");
    }
  }
});

clockTest("slow storage progress bursts retain summary attribution within the existing optional deadline", async t => {
  t.mock.timers.setTime(NOW);
  const requests = [];
  const background = worker(async (url, options) => {
    if (url.endsWith("/api/telemetry")) throw new Error("offline");
    requests.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ summary: "available summary" }) };
  }, profile(), () => Date.now());
  await background.settled();
  // Thirty milliseconds per storage operation models a responsive but slow
  // profile. Progress snapshots queue without waiting in the source page.
  background.evaluate(`for (const area of ["local", "session"]) for (const method of ["get", "set"]) {
    const original = chrome.storage[area][method];
    chrome.storage[area][method] = async (...args) => {
      await new Promise(resolve => setTimeout(resolve, 30));
      return original(...args);
    };
  }`);
  const stages = ["intent_started", "capture_started", "capture_completed", "summary_request_started"];
  const snapshots = stages.map(lastStage => background.ack(event(1, { lastStage })));
  const startedAt = Date.now();
  const operation = summaryWithin(background, NOW + 5000);
  try {
    const result = await operation.observed;
    assert.equal(result?.summary, "available summary");
    assert.equal(requests.length, 1);
    assert.equal(requests[0].telemetry?.attempt_id, id(1), "Responsive storage must retain attribution through the progress burst.");
    assert.equal(requests[0].telemetry.last_stage, "summary_request_started");
    assert.ok(Date.now() - startedAt < 1000);
  } finally {
    await operation.request;
    await Promise.all(snapshots);
    await background.settled();
  }
});

test("active restore still removes expired and malformed records and sanitizes a retained signed receipt", async () => {
  const proof = "c".repeat(64);
  const shared = profile({}, { [ACTIVE]: {
    [id(1)]: { event: { ...event(), extensionVersion: "1.4.5", untrusted: "SENSITIVE_ACTIVE_VALUE" }, tabId: 42,
      expiresAt: NOW + 300000, summary_proof: proof, summary_confirmed_at: new Date(NOW).toISOString(),
      model: "gemini-3.5-flash-lite", untrusted: "SENSITIVE_ACTIVE_VALUE" },
    [id(2)]: { event: event(2), tabId: 42, expiresAt: NOW - 1 },
    [id(3)]: { event: event(4), tabId: 42, expiresAt: NOW + 300000 }
  } });
  const background = worker(async () => { throw new Error("offline"); }, shared);
  await background.settled();
  assert.deepEqual(Object.keys(shared.session[ACTIVE]), [id(1)]);
  assert.equal(shared.session[ACTIVE][id(1)].summary_proof, proof);
  assert.equal(shared.session[ACTIVE][id(1)].event.extensionVersion, "1.4.5");
  assert.doesNotMatch(JSON.stringify(shared), /SENSITIVE_ACTIVE_VALUE/);
  assert.equal(shared.local[DIAGNOSTICS].counts.outcome_unknown, 1);
  await background.listeners.removed(42);
  await background.settled();
  assert.equal(shared.local[OUTBOX][0].payload.failure_reason, "user_cancelled");
  assert.equal(shared.local[OUTBOX][0].payload.summary_proof, proof);
});

for (const area of ["local", "session"]) {
  clockTest(`stalled ${area} telemetry reads allow summaries, cache reuse and later requests`, async t => {
    t.mock.timers.setTime(NOW);
    const summaryRequests = [];
    const background = worker(async (url, options) => {
      if (url.endsWith("/api/telemetry")) throw new Error("offline");
      summaryRequests.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ summary: "available summary", timing: { model: "gemini-3.5-flash-lite" } }) };
    }, profile(), () => Date.now());
    await background.settled();
    await background.ack(event());
    await background.settled();
    const release = blockStorage(background, area, "get");
    const first = summaryWithin(background, NOW + 5000);
    let later;
    try {
      const response = await first.observed;
      assert.equal(response?.ok, true, "A stalled attribution read must not hold the summary indefinitely.");
      assert.equal(response.summary, "available summary");
      assert.equal(response.timing.backend.model, "gemini-3.5-flash-lite");
      assert.ok(Date.now() - NOW <= 1000, "Optional storage gets at most one second.");
      const cached = await summaryWithin(background, NOW + 5000).observed;
      assert.equal(cached?.timing.source, "cache");
      assert.equal(cached?.timing.backend.model, "gemini-3.5-flash-lite");
      later = summaryWithin(background, NOW + 5000, "Another captured transcript");
      assert.equal((await later.observed)?.ok, true, "The blocked queue must not freeze later summaries.");
      assert.equal(summaryRequests.length, 2);
      assert.ok(summaryRequests.every(input => input.telemetry === undefined));
    } finally {
      release();
      await first.request;
      await later?.request;
      await background.settled();
    }
    assert.equal(summaryRequests.length, 2, "Late attribution reads must not resend summary requests.");
    await background.ack(event(1, { lastStage: "summary_completed", reportedModel: "gemini-3.5-flash-lite" }));
    await background.ack(event(1, { status: "succeeded", lastStage: "completed" }));
    await background.settled();
    const terminal = background.shared.local[OUTBOX][0].payload;
    assert.equal(terminal.reported_model, "gemini-3.5-flash-lite", "A storage timeout must not lose the model when the source reports its actual result.");
    assert.equal(terminal.summary_proof, undefined);
    assert.equal(terminal.model, undefined);
    await background.ack(event(2));
    const recovered = await summaryWithin(background, Date.now() + 5000, "Transcript after storage recovery", id(2)).observed;
    assert.equal(recovered?.ok, true);
    assert.equal(summaryRequests[2].telemetry.attempt_id, id(2), "A new transfer must regain signing context after storage recovers.");
    await background.settled();
  });

  clockTest(`stalled ${area} receipt writes return the summary and preserve its late terminal proof`, async t => {
    t.mock.timers.setTime(NOW);
    const proof = "e".repeat(64), confirmedAt = new Date(NOW).toISOString();
    let release, requests = 0;
    const background = worker(async url => {
      if (url.endsWith("/api/telemetry")) throw new Error("offline");
      requests++;
      return { ok: true, status: 200, json: async () => {
        release = blockStorage(background, area, "set");
        return { summary: "generated summary", summaryProofV3: proof, summaryModel: "gemini-3.5-flash-lite", summaryConfirmedAt: confirmedAt };
      } };
    }, profile(), () => Date.now());
    await background.settled();
    await background.ack(event());
    await background.settled();
    const first = summaryWithin(background, NOW + 5000);
    let terminal;
    try {
      const response = await first.observed;
      assert.equal(response?.ok, true, "A completed summary must not wait indefinitely for its receipt write.");
      assert.equal(response.summary, "generated summary");
      assert.ok(Date.now() - NOW <= 1000);
      assert.equal((await summaryWithin(background, NOW + 5000).observed)?.timing.source, "cache");
      assert.equal(requests, 1);
      terminal = background.ack(event(1, { status: "succeeded", lastStage: "completed" }));
    } finally {
      release?.();
      await first.request;
      await terminal;
      await background.settled();
    }
    const retained = background.shared.local[OUTBOX][0].payload;
    assert.equal(retained.status, "succeeded");
    assert.equal(retained.summary_proof, proof);
    assert.equal(retained.summary_confirmed_at, confirmedAt);
    assert.equal(retained.model, "gemini-3.5-flash-lite");
    assert.equal(background.shared.session[ACTIVE][id(1)].summary_proof, proof);
  });

  for (const stage of ["snapshot", "receipt"]) clockTest(`transfer expiry interrupts a stalled ${area} ${stage} without late success`, async t => {
    t.mock.timers.setTime(NOW);
    let release, requests = 0;
    const background = worker(async url => {
      if (url.endsWith("/api/telemetry")) throw new Error("offline");
      requests++;
      return { ok: true, status: 200, json: async () => {
        if (stage === "receipt") release = blockStorage(background, area, "set");
        return { summary: "generated summary", summaryProofV2: "f".repeat(64), summaryConfirmedAt: new Date(NOW).toISOString() };
      } };
    }, profile(), () => Date.now());
    await background.settled();
    await background.ack(event());
    await background.settled();
    if (stage === "snapshot") release = blockStorage(background, area, "get");
    const operation = summaryWithin(background, NOW + 50);
    try {
      const response = await operation.observed;
      assert.equal(response?.ok, false, "Expiry must reply while the storage operation is still stalled.");
      assert.equal(response.code, "transfer_timeout");
      assert.equal(Date.now(), NOW + 50);
      assert.equal(requests, stage === "snapshot" ? 0 : 1);
      assert.equal(background.evaluate("summaryInflight.size"), 0);
      assert.equal(background.evaluate("summaryCache.size"), 0);
    } finally {
      release?.();
      await operation.request;
      await background.settled();
    }
  });

  clockTest(`an expired ${area} receipt completion rejects success before a delayed timer fires`, async t => {
    t.mock.timers.setTime(NOW);
    let release, signal, receiptStarted;
    const began = new Promise(resolve => { receiptStarted = resolve; });
    const background = worker(async (url, options) => {
      if (url.endsWith("/api/telemetry")) throw new Error("offline");
      signal = options.signal;
      return { ok: true, status: 200, json: async () => {
        release = blockStorage(background, area, "set");
        receiptStarted();
        return { summary: "generated summary", summaryProofV2: "f".repeat(64), summaryConfirmedAt: new Date(NOW).toISOString() };
      } };
    });
    await background.settled();
    await background.ack(event());
    await background.settled();
    const operation = summaryWithin(background, NOW + 50);
    try {
      await began;
      await release.began;
      assert.equal(signal.aborted, false);
      // Elapsed time can exceed the deadline while queued response/storage
      // microtasks run ahead of timer tasks on a busy worker.
      background.clock.now = NOW + 100;
      release();
      const response = await operation.observed;
      assert.equal(response?.ok, false);
      assert.equal(response.code, "transfer_timeout");
      assert.equal(background.evaluate("summaryCache.size"), 0);
    } finally {
      release?.();
      await operation.request;
      await background.settled();
    }
  });

  test(`telemetry storage ${area} read failure cannot block summary generation`, async () => {
    const summaryRequests = [];
    const background = worker(async (url, options) => {
      if (url.endsWith("/api/telemetry")) throw new Error("offline");
      summaryRequests.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ summary: "available summary" }) };
    });
    await background.settled();
    await background.ack(event());
    await background.settled();
    background.evaluate(`chrome.storage.${area}.get = async () => { throw new Error("storage unavailable"); }`);
    const response = await new Promise(resolve => background.listeners.message({
      type: "SUMMARIZE_WITH_BACKEND", conversation: "transcript", transferId: id(1)
    }, {}, resolve));
    await background.settled();
    assert.equal(response.ok, true);
    assert.equal(response.summary, "available summary");
    assert.equal(summaryRequests.length, 1);
    assert.equal(summaryRequests[0].telemetry, undefined);
  });

  test(`telemetry storage ${area} write failure cannot discard a successful summary or its recoverable receipt`, async () => {
    const proof = "d".repeat(64);
    const confirmedAt = "2026-10-02T10:00:03.000Z";
    const background = worker(async url => {
      if (url.endsWith("/api/telemetry")) throw new Error("offline");
      return { ok: true, status: 200, json: async () => {
        // Fail only after the provider has returned a valid summary. The other
        // storage area must still preserve proof for the later terminal report.
        background.evaluate(`globalThis.originalStorageSet = chrome.storage.${area}.set;
          chrome.storage.${area}.set = async () => { throw new Error("storage unavailable"); }`);
        return { summary: "generated summary", summaryProofV2: proof, summaryConfirmedAt: confirmedAt };
      } };
    });
    await background.settled();
    await background.ack(event());
    await background.settled();
    const response = await new Promise(resolve => background.listeners.message({
      type: "SUMMARIZE_WITH_BACKEND", conversation: "transcript", transferId: id(1)
    }, {}, resolve));
    await background.settled();
    assert.equal(response.ok, true);
    assert.equal(response.summary, "generated summary");
    const retainedReceipt = area === "local"
      ? background.shared.session[ACTIVE][id(1)]
      : background.shared.local[OUTBOX][0].payload;
    assert.equal(retainedReceipt.summary_proof, proof);
    assert.equal(retainedReceipt.summary_confirmed_at, confirmedAt);
    background.evaluate(`chrome.storage.${area}.set = globalThis.originalStorageSet`);
    await background.ack(event(1, { status: "succeeded", lastStage: "completed" }));
    await background.settled();
    const queued = background.shared.local[OUTBOX];
    assert.equal(queued.length, 1);
    assert.equal(queued[0].payload.status, "succeeded");
    assert.equal(queued[0].payload.summary_proof, proof);
    assert.equal(queued[0].payload.summary_confirmed_at, confirmedAt);
  });
}

clockTest("the summary transport deadline also interrupts receipt storage without a transfer deadline", async t => {
  t.mock.timers.setTime(NOW);
  let release, signal, receiptStarted;
  const began = new Promise(resolve => { receiptStarted = resolve; });
  const background = worker(async (url, options) => {
    if (url.endsWith("/api/telemetry")) throw new Error("offline");
    signal = options.signal;
    return { ok: true, status: 200, json: async () => {
      release = blockStorage(background, "local", "set");
      receiptStarted();
      return { summary: "generated summary", summaryProofV2: "f".repeat(64), summaryConfirmedAt: new Date(NOW).toISOString() };
    } };
  }, profile(), () => Date.now());
  await background.settled();
  await background.ack(event());
  await background.settled();
  const operation = summaryWithin(background);
  try {
    await began;
    await release.began;
    t.mock.timers.tick(320000);
    const response = await operation.request;
    assert.equal(signal.aborted, true);
    assert.equal(response.ok, false);
    assert.equal(background.evaluate("summaryCache.size"), 0);
  } finally {
    release?.();
    await operation.request;
    await background.settled();
  }
});
