const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { clockTest } = require("./helpers/clock");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "extension", "transfer-diagnostics.js"), "utf8") + "\n"
  + fs.readFileSync(path.join(__dirname, "..", "extension", "background.js"), "utf8");
// Compile once; each worker still owns a fresh context, storage and lifecycle.
const COMPILED_WORKER = new vm.Script(SOURCE, { filename: "background.js" });
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
    TextEncoder,
    AbortController, URL, Date: ClockDate, Math: math, clearTimeout, setTimeout,
    console: { debug() {}, error() {}, log() {}, warn() {} },
    crypto: { randomUUID: () => id(uuidSequence++) },
    performance: { now: () => clock.now }, fetch: fetchImpl,
    chrome: {
      action: { onClicked: addEvent("click"), setBadgeBackgroundColor: async () => {}, setBadgeText: async () => {} },
      alarms: { onAlarm: addEvent("alarm"), clear: async () => true, create: (name, options) => alarms.push({ name, ...options }) },
      runtime: {
        id: "fixture-extension",
        getManifest: () => ({ version }), onInstalled: addEvent("installed"),
        onStartup: addEvent("startup"), onMessage: addEvent("message")
      },
      scripting: { executeScript: async () => {} },
      storage: { local: storageArea(shared.local), session: storageArea(shared.session), onChanged: addEvent("storageChanged") },
      tabs: { onRemoved: addEvent("removed"), onUpdated: addEvent("updated"), query: async () => [], create: async () => ({}), sendMessage: async () => ({}), update: async () => ({}) },
      windows: { update: async () => ({}) }
    }
  };
  vm.createContext(sandbox);
  COMPILED_WORKER.runInContext(sandbox);
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

function startOwnedPaste(background, { stalled = false } = {}) {
  background.evaluate(`
    checkTransferSource = async () => ({ id: 42 });
    chrome.tabs.get = async id => ({ id });
    chrome.tabs.sendMessage = ${stalled ? "() => new Promise(() => {})" : "async () => ({ ok: true })"};
    globalThis.fixturePasteTrace = { ...createBackgroundTrace(), operation: getTransferOperation("${id(1)}", { id: 42 }, Date.now() + 60000),
      deadlineAt: Date.now() + 60000, diagnostics: { version: 1 } };
  `);
  const pending = background.evaluate(`pasteIntoDestinationTab(84, "gemini", { ...DESTINATIONS.gemini, messageTimeoutMs: 1000 },
    "PRIVATE_CARRY", "${id(1)}", fixturePasteTrace)`);
  pending.catch(() => {});
  return pending;
}

function recoveryCheckpoint(background, checkpoint, options = {}, sender = {}) {
  return new Promise(resolve => background.listeners.message({ type: "RECORD_RECOVERY_CHECKPOINT", transferId: id(1),
    destination: "gemini", checkpoint, surface: "dialog", ...options },
  { id: "fixture-extension", frameId: 0, tab: { id: 42, url: "https://claude.ai/new" }, ...sender }, resolve));
}

test("destination observations wait for cold identity storage and survive an already queued terminal report", async () => {
  const delivered = [];
  const background = worker(async (_url, options) => { delivered.push(JSON.parse(options.body)); return success(); });
  await background.settled();
  blockStorage(background, "local", "get");
  const initial = background.ack(event(1, { destinationPlatform: "gemini" }));
  await new Promise(setImmediate);
  assert.equal(background.evaluate(`activeTransferTelemetry.has("${id(1)}")`), false);
  background.evaluate(`recordDestinationObservation(getTransferOperation("${id(1)}", { id: 42 }, Date.now()+60000),
    "destination_prepare", {}, { destination: DESTINATIONS.gemini })`);
  const terminal = background.ack(event(1, { destinationPlatform: "gemini", status: "failed", lastStage: "paste_started", failureReason: "paste_failed" }));
  background.evaluate("releaseStorage()");
  await Promise.all([initial, terminal]);
  await background.settled();
  assert.equal(delivered.at(-1).status, "failed");
  assert.equal(delivered.at(-1).diagnostics.delivery_events[0].event, "destination_prepare");
});

test("copy recovery enriches a failed transfer without replacing terminal facts, including after worker restart", async () => {
  const background = worker(async () => { throw new Error("offline"); });
  await background.settled();
  await background.ack(event(1, { destinationPlatform: "gemini", status: "failed", lastStage: "paste_started", failureReason: "paste_failed",
    diagnostics: { version: 1, error_code: "message_timeout", message_reply: "timeout" } }));
  assert.equal((await recoveryCheckpoint(background, "box_shown")).ok, true);
  assert.equal((await recoveryCheckpoint(background, "copy_succeeded", { method: "native" })).ok, true);
  assert.equal((await recoveryCheckpoint(background, "copy_succeeded", { method: "native" })).ok, false);
  await background.ack(event(1, { destinationPlatform: "gemini", status: "succeeded", lastStage: "completed",
    diagnostics: { version: 1, error_code: "editor_missing", recovery_events: [] } }));
  await background.settled();
  const queued = background.shared.local[OUTBOX][0].payload;
  assert.equal(queued.status, "failed");
  assert.equal(queued.failure_reason, "paste_failed");
  assert.equal(queued.diagnostics.error_code, "message_timeout");
  assert.deepEqual(queued.diagnostics.recovery_events.map(entry => entry.event), ["box_shown", "copy_succeeded"]);
  const delivered = [];
  const restarted = worker(async (_url, options) => { delivered.push(JSON.parse(options.body)); return success(); }, background.shared);
  await restarted.settled();
  await restarted.retry();
  assert.deepEqual(delivered.at(-1).diagnostics, queued.diagnostics);
  assert.equal((await recoveryCheckpoint(restarted, "copy_failed", { method: "manual_selection" })).ok, true);
  await restarted.settled();
  assert.equal(delivered.at(-1).status, "failed");
  assert.equal(delivered.at(-1).diagnostics.recovery_events.length, 3);
});

test("recovery checkpoints require an owned source or dispatched destination and reject private fields", async () => {
  const background = worker(async () => success());
  await background.settled();
  await background.ack(event(1, { destinationPlatform: "gemini", lastStage: "paste_started" }));
  for (const sender of [{ id: "other-extension" }, { frameId: 1 }, { tab: { id: 85, url: "https://gemini.google.com/app" } },
    { tab: { id: 42, url: "https://chatgpt.com/" } }])
    assert.equal((await recoveryCheckpoint(background, "box_shown", {}, sender)).ok, false);
  assert.equal((await recoveryCheckpoint(background, "copy_succeeded")).ok, false);
  assert.equal((await recoveryCheckpoint(background, "copy_failed", { method: "native", text: "PRIVATE" })).ok, false);
  await startOwnedPaste(background);
  background.evaluate("fixturePasteTrace.operation.tabIds.add(84)");
  assert.equal((await recoveryCheckpoint(background, "copy_unconfirmed", { method: "clipboard", stopConfirmed: false },
    { tab: { id: 84, url: "https://gemini.google.com/app" } })).ok, true);
  await background.settled();
  const active = background.evaluate(`activeTransferTelemetry.get("${id(1)}")`);
  assert.equal(active.diagnostics.recovery_events[0].side, "destination");
  assert.equal(active.diagnostics.recovery_events[0].stop_confirmed, false);
  assert.equal(active.status, "started");
});

function pasteCheckpoint(background, checkpoint, diagnostics = {}, sender = {}, overrides = {}) {
  return new Promise(resolve => background.listeners.message({ type: "RECORD_PASTE_CHECKPOINT", transferId: id(1),
    destination: "gemini", checkpoint, diagnostics: { version: 1, ...diagnostics }, ...overrides },
  { id: "fixture-extension", frameId: 0, tab: { id: 84, url: "https://gemini.google.com/app" }, ...sender }, resolve));
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

for (const recovered of [true, false]) test(`browser response failures survive ${recovered ? "retry success" : "two failed reads"}, stale progress and worker restart`, async () => {
  let requests = 0;
  const background = worker((url, options) => {
    if (!url.endsWith("/api/summarize")) return rejection(503, "temporary_unavailable");
    requests++;
    return { ok: true, status: 200, headers: new Headers({ "x-vercel-id": "PRIVATE_REQUEST_ID" }), json: async () => {
      if (recovered && requests === 2) return { summary: "PRIVATE_COMPLETE_SUMMARY" };
      throw new TypeError("PRIVATE_NETWORK_EXCEPTION https://PRIVATE/file.txt");
    } };
  });
  await background.settled();
  await background.ack(event());
  const result = await summaryWithin(background, null, "PRIVATE_CHAT_SENTINEL").request;
  assert.equal(result.ok, recovered);
  assert.equal(requests, 2);
  await background.settled();
  const records = JSON.parse(JSON.stringify(result.diagnostics.summary_response_failures));
  assert.equal(records.length, recovered ? 1 : 2);
  assert.deepEqual(records.map(record => record.attempt), recovered ? [1] : [1, 2]);
  assert.equal(records[0].reason, "body_read_failed");
  // Delayed source progress and terminal snapshots can contain less evidence.
  await background.ack(event(1, { diagnostics: { version: 1, summary_response_failures: records.slice(0, 1) } }));
  await background.ack(event(1, { status: recovered ? "succeeded" : "failed",
    lastStage: recovered ? "completed" : "summary_response_started", failureReason: recovered ? null : "summary_failed",
    diagnostics: { version: 1, summary_response_failures: records.slice(0, 1) } }));
  await background.settled();
  assert.deepEqual(background.shared.local[OUTBOX][0].payload.diagnostics.summary_response_failures, records);
  const delivered = [];
  const restarted = worker((_url, options) => { delivered.push(JSON.parse(options.body)); return success(); },
    background.shared, background.shared.local[DIAGNOSTICS].retry.nextAttemptAt);
  await restarted.settled();
  assert.deepEqual(delivered.at(-1).diagnostics.summary_response_failures, records);
  assert.equal(delivered.at(-1).status, recovered ? "succeeded" : "failed");
  assert.doesNotMatch(JSON.stringify(delivered), /PRIVATE|https:|filename|stack|"headers"|"summary"/);
});

test("worker queues the failed response before a retry or source reply completes", async () => {
  let requests = 0, finish, began;
  const retryBegan = new Promise(resolve => { began = resolve; });
  const background = worker(url => {
    if (!url.endsWith("/api/summarize")) return rejection(503, "temporary_unavailable");
    requests++;
    return { ok: true, status: 200, json: () => {
      if (requests === 1) return Promise.reject(new TypeError("PRIVATE_CONNECTION_ERROR"));
      began();
      return new Promise(resolve => { finish = resolve; });
    } };
  });
  await background.settled(); await background.ack(event());
  const pending = summaryWithin(background).request;
  await retryBegan;
  try {
    await background.settled();
    const checkpoint = background.shared.local[OUTBOX][0].payload.diagnostics;
    assert.ok(checkpoint);
    assert.equal(checkpoint.summary_response_failures[0].attempt, 1);
  } finally {
    finish({ summary: "Complete carry" });
    assert.equal((await pending).ok, true);
    await background.settled();
  }
});

test("optional response logging never waits for stalled storage before retrying and returning a summary", async () => {
  let requests = 0;
  const background = worker(url => {
    if (!url.endsWith("/api/summarize")) return success();
    requests++;
    return { ok: true, status: 200, json: async () => {
      if (requests === 1) throw new TypeError("PRIVATE_CONNECTION_ERROR");
      return { summary: "Complete carry" };
    } };
  });
  await background.settled(); await background.ack(event()); await background.settled();
  const release = blockStorage(background, "local", "set");
  try {
    const result = await summaryWithin(background).observed;
    assert.equal(result?.ok, true);
    assert.equal(result.diagnostics.summary_response_failures.length, 1);
    assert.equal(requests, 2);
  } finally { release(); await background.settled(); }
});

test("worker teardown cannot turn toolbar badge updates into uncaught rejections", async () => {
  const background = worker(success);
  await background.settled();
  for (const method of ["setBadgeBackgroundColor", "setBadgeText"]) {
    background.evaluate(`globalThis.originalBadgeMethod = chrome.action.${method};
      chrome.action.${method} = async () => { throw new Error("No SW"); };`);
    await assert.doesNotReject(async () => background.evaluate('setBadge("ERR", "#b42318", 0)'));
    await assert.doesNotReject(async () => background.evaluate("clearBadge()"));
    background.evaluate(`chrome.action.${method} = originalBadgeMethod;`);
  }
  background.evaluate(`globalThis.originalTimeout = setTimeout;
    setTimeout = callback => { globalThis.badgeTimer = callback; };`);
  await background.evaluate('setBadge("OK", "#1f8f4d", 2500)');
  background.evaluate(`setTimeout = originalTimeout;
    chrome.action.setBadgeText = async () => { throw new Error("No SW"); };`);
  await assert.doesNotReject(async () => background.evaluate("badgeTimer()"));
  background.evaluate(`globalThis.pickerCalls = 0;
    chrome.tabs.sendMessage = async () => { pickerCalls++; return { ok: true }; };`);
  await assert.doesNotReject(async () => background.listeners.click({ id: 42, url: "https://claude.ai/chat/example" }));
  assert.equal(background.evaluate("pickerCalls"), 1, "an optional badge failure cannot block the toolbar picker");
  await assert.doesNotReject(async () => background.listeners.click({ id: 43, url: "https://example.com/" }));
  background.listeners.message({ type: "CONTEXT_TRANSFER_ERROR", error: "fixture failure" }, {}, () => {});
  await new Promise(setImmediate);
});

test("raw transcript storage events handle a stopped worker without changing the saved receipt", async () => {
  const background = worker(success);
  await background.settled();
  background.evaluate('chrome.alarms.create = async () => { throw new Error("No SW"); };');
  const key = "context-generator-last-transfer-stats-v1";
  const stats = { rawScrapedText: "PRIVATE_TRANSCRIPT_SENTINEL", rawScrapedTextExpiresAt: new Date(NOW + 60000).toISOString() };
  background.shared.local[key] = structuredClone(stats);
  background.listeners.storageChanged({ [key]: { newValue: stats } }, "local");
  await new Promise(setImmediate);
  assert.deepEqual(background.shared.local[key], stats);
});

test("failed retry alarms retain queued reports for the next worker startup", async () => {
  for (const failure of ["throw", "reject"]) {
    const shared = profile();
    const background = worker(() => rejection(503, "temporary"), shared);
    await background.settled();
    background.evaluate(`chrome.alarms.create = ${failure === "reject" ? "async " : ""}() => { throw new Error("No SW"); };`);
    assert.equal((await background.ack(event(72))).ok, true);
    await background.settled();
    await new Promise(setImmediate);
    assert.equal(shared.local[OUTBOX].length, 1);
    assert.ok(shared.local[DIAGNOSTICS].retry.nextAttemptAt > NOW);
    const deliveries = [];
    const restarted = worker((_url, options) => { deliveries.push(JSON.parse(options.body)); return success(); },
      shared, shared.local[DIAGNOSTICS].retry.nextAttemptAt);
    await restarted.settled();
    assert.equal(shared.local[OUTBOX].length, 0);
    assert.ok(deliveries.some(row => row.attempt_id === id(72)));
  }
});

test("raw transcript expiry removes only private text at the deadline and recovers legacy receipts", async () => {
  const key = "context-generator-last-transfer-stats-v1";
  const day = 24 * 60 * 60 * 1000;
  for (const kind of ["scheduled", "legacy", "missing time"]) {
    const metadata = { status: "completed", model: "gemini-3.6-flash", diagnostics: { version: 1, paste_populated: true },
      ...(kind === "missing time" ? {} : { completedAt: new Date(NOW - day).toISOString() }) };
    const stats = { ...metadata, rawScrapedText: "PRIVATE_TRANSCRIPT_SENTINEL",
      ...(kind === "scheduled" ? { rawScrapedTextExpiresAt: new Date(NOW + day).toISOString() } : {}) };
    const shared = profile({ [key]: stats });
    const background = worker(success, shared);
    await background.settled();
    await new Promise(setImmediate);
    if (kind === "scheduled") {
      assert.deepEqual(shared.local[key], stats, "Unexpired text must remain available");
      const alarmName = background.evaluate("RAW_TRANSCRIPT_EXPIRY_ALARM");
      assert.ok(background.alarms.some(alarm => alarm.name === alarmName && alarm.when === NOW + day));
      background.clock.now = NOW + day;
      background.listeners.alarm({ name: alarmName });
      await new Promise(setImmediate);
    }
    assert.deepEqual(shared.local[key], metadata, `${kind}: keep the complete receipt after removing expired text`);
    assert.doesNotMatch(JSON.stringify(shared.local[key]), /PRIVATE_TRANSCRIPT_SENTINEL/);
  }
});

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

test("unexpected successful HTTP responses retain the report until the recorder acknowledges it", async () => {
  const shared = profile(), requests = [];
  let acknowledged = false;
  const background = worker(async (_url, options) => {
    requests.push(options);
    return acknowledged ? success() : { ok: true, status: 200, json: async () => ({}) };
  }, shared);
  await background.settled();
  await background.ack(event(1, { status: "succeeded", lastStage: "completed" }));
  await background.settled();
  assert.equal(shared.local[OUTBOX].length, 1, "A generic HTTP 200 is not the recorder's acknowledgement.");
  assert.equal(requests[0].redirect, "error");
  assert.equal(requests[0].credentials, "omit");
  acknowledged = true;
  await background.retry();
  assert.equal(shared.local[OUTBOX].length, 0);
  assert.equal(shared.local[DIAGNOSTICS].counts.delivered, 1);
});

test("a rejected terminal queue write survives worker restart and retries without another source message", async () => {
  const shared = profile();
  const first = worker(async () => { throw new Error("offline"); }, shared);
  await first.settled();
  await first.ack(event());
  await first.settled();
  first.evaluate(`const original = chrome.storage.local.set;
    chrome.storage.local.set = entries => Object.hasOwn(entries, ${JSON.stringify(OUTBOX)})
      ? Promise.reject(new Error("temporary queue write failure")) : original(entries);`);
  const acknowledged = await first.ack(event(1, { status: "succeeded", lastStage: "completed",
    reportedModel: "local-direct", diagnostics: { version: 1, paste_populated: true } }));
  await first.settled();
  assert.equal(acknowledged.ok, true, "The session fallback must accept the report durably.");
  const requests = [];
  const restarted = worker(async (_url, options) => { requests.push(JSON.parse(options.body)); return success(); }, shared, NOW + 60000);
  await restarted.settled();
  const terminal = requests.find(input => input.status === "succeeded");
  assert.ok(terminal, "Restart must recover the final report without another content-script event.");
  assert.equal(terminal.reported_model, "local-direct");
  assert.equal(terminal.diagnostics.paste_populated, true);
  assert.equal(shared.local[OUTBOX].length, 0);
  const count = requests.length;
  const again = worker(async (_url, options) => { requests.push(JSON.parse(options.body)); return success(); }, shared, NOW + 70000);
  await again.settled();
  assert.equal(requests.length, count, "A recovered report must not be replayed indefinitely.");
});

test("unavailable optional session storage cannot prevent a durable final report from draining", async () => {
  const requests = [], shared = profile();
  const background = worker(async (_url, options) => { requests.push(JSON.parse(options.body)); return success(); }, shared);
  await background.settled();
  background.evaluate(`chrome.storage.session.get = async () => { throw new Error("session unavailable"); };`);
  assert.equal((await background.ack(event(1, { status: "succeeded", lastStage: "completed" }))).ok, true);
  await background.settled();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].status, "succeeded");
  assert.equal(shared.local[OUTBOX].length, 0);
});

test("an unreadable fallback with an empty local queue retains a retry wakeup", async () => {
  const shared = profile({ [INSTALL]: id(999) }, { [ACTIVE]: { [id(1)]: {
    event: event(1, { status: "succeeded", lastStage: "completed" }), tabId: 42,
    expiresAt: NOW + 360000, outboxPending: true
  } } });
  const requests = [];
  const background = worker(async (_url, options) => { requests.push(JSON.parse(options.body)); return success(); }, shared);
  background.evaluate(`globalThis.originalSessionGet = chrome.storage.session.get;
    chrome.storage.session.get = async () => { throw new Error("session temporarily unavailable"); };`);
  await background.settled();
  assert.ok(background.alarms.some(alarm => alarm.name === "retry-transfer-telemetry" && alarm.when <= NOW + 300000));
  assert.equal(requests.length, 0);
  background.evaluate("chrome.storage.session.get = originalSessionGet");
  background.clock.now = NOW + 300000;
  await background.retry();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].status, "succeeded");
});

test("a signed receipt retained after a queue write failure is replayed after restart without a final source report", async () => {
  const shared = profile(), proof = "e".repeat(64), confirmedAt = new Date(NOW).toISOString();
  const first = worker(async url => {
    if (url.endsWith("/api/telemetry")) throw new Error("offline");
    first.evaluate(`const original = chrome.storage.local.set;
      chrome.storage.local.set = entries => Object.hasOwn(entries, ${JSON.stringify(OUTBOX)})
        ? Promise.reject(new Error("queue unavailable")) : original(entries);`);
    return { ok: true, status: 200, json: async () => ({ summary: "PRIVATE_SUMMARY", summaryProofV3: proof,
      summaryConfirmedAt: confirmedAt, summaryModel: "gemini-3.5-flash-lite" }) };
  }, shared);
  await first.settled();
  await first.ack(event(1, { lastStage: "summary_request_started" }));
  await first.settled();
  assert.equal((await first.evaluate(`summarizeWithBackend("PRIVATE_TRANSCRIPT", "${id(1)}")`)).summary, "PRIVATE_SUMMARY");
  await first.settled();
  const requests = [];
  const restarted = worker(async (_url, options) => { requests.push(JSON.parse(options.body)); return success(); }, shared, NOW + 60000);
  await restarted.settled();
  const recovered = requests.find(input => input.summary_proof === proof);
  assert.ok(recovered);
  assert.equal(recovered.summary_confirmed_at, confirmedAt);
  assert.equal(recovered.model, "gemini-3.5-flash-lite");
  assert.equal(recovered.extension_version, "1.4.6");
  assert.equal(recovered.status, "started", "Summary proof cannot invent a paste outcome.");
  assert.equal(recovered.last_stage, "summary_completed");
  assert.doesNotMatch(JSON.stringify(shared), /PRIVATE_SUMMARY|PRIVATE_TRANSCRIPT/);
});

test("invalid reports and unavailable stores are not acknowledged as durably accepted", async () => {
  const background = worker(async () => success());
  await background.settled();
  assert.equal((await background.ack(event(1, { lastStage: "not_a_stage" }))).ok, false);
  background.evaluate(`chrome.storage.local.set = chrome.storage.session.set = async () => { throw new Error("PRIVATE_STORAGE_ERROR"); };`);
  assert.equal((await background.ack(event())).ok, false);
  await background.settled();
});

test("expired session fallback reports are diagnosed instead of replayed or silently removed", async () => {
  const shared = profile({ [INSTALL]: id(999) }, { [ACTIVE]: { [id(1)]: {
    event: event(1, { status: "succeeded", lastStage: "completed" }), tabId: 42,
    expiresAt: NOW - 1, outboxPending: true
  } } });
  let requests = 0;
  const background = worker(async () => { requests++; return success(); }, shared);
  await background.settled();
  assert.equal(requests, 0);
  assert.equal(shared.local[DIAGNOSTICS].counts.expired_terminal, 1);
  assert.equal(shared.local[DIAGNOSTICS].recent[0].attemptId, id(1));
  assert.deepEqual(shared.session[ACTIVE], {});
});

test("session recovery capacity protects unsent final reports before lower-priority snapshots", async () => {
  const shared = profile(), background = worker(async () => success(), shared);
  await background.settled();
  const entries = Object.fromEntries(Array.from({ length: 500 }, (_value, index) => [id(index + 1), {
    event: event(index + 1, { status: "succeeded", lastStage: "completed" }),
    tabId: 42, expiresAt: NOW + 300000, outboxPending: true
  }]));
  // The last existing pending copy is an unsigned progress report, which is
  // less valuable than the new terminal outcome when this store is full.
  entries[id(500)].event = event(500);
  shared.session[ACTIVE] = entries;
  background.evaluate(`activeTransferTelemetry.set("${id(501)}", ${JSON.stringify(event(501, { status: "succeeded", lastStage: "completed" }))});`);
  await background.evaluate(`persistActiveTransferTelemetry("${id(501)}", true)`);
  assert.equal(Object.keys(shared.session[ACTIVE]).length, 500);
  assert.ok(shared.session[ACTIVE][id(1)], "Do not evict a pending terminal just because it is older.");
  assert.ok(shared.session[ACTIVE][id(501)]);
  assert.equal(shared.session[ACTIVE][id(500)], undefined);
  assert.equal(shared.local[DIAGNOSTICS].counts.overflow_progress, 1);
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
  const delivered = [];
  const fetchImpl = async (_url, options) => {
    attempts++;
    if (online) delivered.push(JSON.parse(options.body));
    return online ? success() : rejection(429, "rate_limited", "600");
  };
  const first = worker(fetchImpl, shared);
  await first.settled();
  await first.ack(event());
  await first.settled();
  const retryAt = shared.local[DIAGNOSTICS].retry.nextAttemptAt;
  assert.equal(retryAt - NOW, 600000);
  await first.ack(event(1, { lastStage: "summary_request_started" }));
  await first.ack(event(1, { status: "failed", lastStage: "summary_response_started", failureReason: "summary_service_busy" }));
  await first.settled();
  assert.equal(attempts, 1, "new progress must not hammer an unavailable endpoint");
  const restarted = worker(fetchImpl, shared);
  await restarted.settled();
  assert.equal(attempts, 1);
  assert.equal(shared.local[INSTALL], id(999));
  assert.equal(shared.local[OUTBOX].length, 1);
  assert.equal(shared.local[OUTBOX][0].payload.status, "failed");
  online = true;
  await restarted.retry();
  assert.equal(attempts, 2);
  assert.equal(delivered[0].last_stage, "summary_response_started");
  assert.equal(delivered[0].failure_reason, "summary_service_busy");
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

test("detailed failure observations survive compaction, restart and late conflicting progress", async () => {
  const shared = profile({ [INSTALL]: id(999) });
  const first = worker(async () => rejection(503, "unavailable"), shared);
  await first.settled();
  const jsonAttempts = [{ outcome: "failed", mode: "prefetch", failure_check: "network_error", raw_bytes: 200 },
    { outcome: "succeeded", mode: "retry", raw_bytes: 400, raw_limit_bytes: 6000000 }];
  await first.ack(event(1, { diagnostics: { version: 1, capture_method: "deepseek-json", capture_chars: 300000, json_attempts: jsonAttempts } }));
  await first.ack(event(1, { status: "failed", lastStage: "paste_started", failureReason: "paste_failed",
    diagnostics: { version: 1, error_code: "editor_missing", error_origin: "destination", editor_seen: false, paste_attempts: 8 } }));
  await first.settled();
  const expected = structuredClone(shared.local[OUTBOX][0].payload.diagnostics);
  assert.deepEqual(expected.json_attempts, jsonAttempts);
  const delivered = [];
  const restarted = worker(async (_url, options) => { delivered.push(JSON.parse(options.body)); return success(); }, shared);
  await restarted.settled();
  await restarted.ack(event(1, { lastStage: "capture_completed", diagnostics: { version: 1, capture_chars: 1 } }));
  await restarted.ack(event(1, { status: "failed", lastStage: "paste_started", failureReason: "paste_failed",
    diagnostics: { version: 1, error_code: "paste_not_retained" } }));
  await restarted.settled();
  await restarted.retry();
  assert.deepEqual(delivered.at(-1).diagnostics, expected);
  assert.equal(delivered.at(-1).diagnostics.capture_chars, 300000);
  assert.equal(delivered.at(-1).diagnostics.error_code, "editor_missing");
  assert.deepEqual(shared.local[OUTBOX], []);
});

test("closing a tracked destination leaves the transfer and its telemetry active", async () => {
  const background = worker(async () => { throw new Error("offline"); });
  await background.settled();
  await background.ack(event());
  await background.settled();
  background.evaluate(`getTransferOperation("${id(1)}", { id: 42 }).tabIds.add(100)`);
  await background.listeners.removed(100);
  await background.settled();
  assert.equal(background.shared.session[ACTIVE][id(1)].event.status, "started");
  assert.ok(background.shared.local[OUTBOX].every(entry => entry.payload.status === "started"));
  assert.equal(background.evaluate(`transferOperations.get("${id(1)}").controller.signal.aborted`), false);
});

test("active state and optional v3 served-model receipt survive worker restart before tab cancellation", async () => {
  for (const withReceipt of [false, true]) {
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
    await first.ack(event(1, { lastStage: "summary_request_started", characterCount: null }));
    if (withReceipt) {
      await first.evaluate(`summarizeWithBackend("SENSITIVE_TRANSCRIPT", "${id(1)}")`);
      await first.settled();
      assert.equal(summaryRequests[0].telemetry.attempt_id, id(1));
      assert.equal(shared.session[ACTIVE][id(1)].summary_proof, proof);
      assert.equal(shared.session[ACTIVE][id(1)].summary_confirmed_at, confirmedAt);
      assert.equal(shared.session[ACTIVE][id(1)].model, "gemini-3.5-flash-lite");
    }
    const second = worker(fetchImpl, shared, NOW + 10000, "1.4.7");
    await second.settled();
    await second.listeners.removed(42);
    await second.settled();
    const queued = shared.local[OUTBOX][0].payload;
    assert.equal(queued.status, "failed");
    assert.equal(queued.failure_reason, "user_cancelled");
    assert.equal(queued.summary_proof, withReceipt ? proof : undefined);
    assert.equal(queued.summary_confirmed_at, withReceipt ? confirmedAt : undefined);
    assert.equal(queued.model, withReceipt ? "gemini-3.5-flash-lite" : undefined);
    assert.equal(queued.character_count, null);
    assert.equal(queued.extension_version, "1.4.6", "a worker update must preserve the signed version");
    assert.equal(queued.completed_at, "2026-10-02T10:00:10.000Z");
    const retained = shared.session[ACTIVE][id(1)];
    assert.equal(retained.event.status, "failed");
    assert.equal(retained.event.failureReason, "user_cancelled");
    // A received signed receipt advances both recovery stores beyond the source's last event.
    assert.equal(queued.last_stage, withReceipt ? "summary_completed" : "summary_request_started");
    assert.equal(retained.event.lastStage, withReceipt ? "summary_completed" : "summary_request_started");
    assert.ok(retained.expiresAt > NOW + 10000);
    assert.doesNotMatch(JSON.stringify(shared), /SENSITIVE_SUMMARY|SENSITIVE_TRANSCRIPT/);
  }
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

test("worker delivery checkpoints survive without the source's final report", async () => {
  for (const outcome of ["success", "failure"]) {
    const delivered = [];
    const background = worker(async (_url, options) => { delivered.push(JSON.parse(options.body)); return success(); });
    await background.settled();
    await background.ack(event(1, { destinationPlatform: "grok", lastStage: "paste_started", reportedModel: "local-direct" }));
    await background.settled();
    background.evaluate(`transferToDestinationObserved = (...args) => new Promise((resolve, reject) => {
      const trace = args[7];
      globalThis.finishFixtureDelivery = () => {
        CapTransferDiagnostics.update(trace.diagnostics, { message_reply: "${outcome === "success" ? "ack_success" : "ack_failed"}",
          ...( ${outcome === "success"} ? { paste_populated: true } : {}) });
        if (${outcome === "success"}) resolve({ timing: {} });
        else reject(Object.assign(new Error("PRIVATE_NATIVE_ERROR"), { code: "paste_failed", diagnosticCode: "message_receiver_missing" }));
      };
    });`);
    const pending = background.evaluate(`transferToDestination("grok", "PRIVATE_CARRY", null, "${id(1)}", true, null, { id: 42 })`);
    pending.catch(() => {});
    await new Promise(setImmediate);
    await background.settled();
    assert.equal(delivered.at(-1).diagnostics?.delivery_events?.[0]?.event, "paste_start");
    background.evaluate("finishFixtureDelivery()");
    if (outcome === "success") await pending;
    else await assert.rejects(pending, /PRIVATE_NATIVE_ERROR/);
    await background.settled();
    const checkpoint = delivered.at(-1);
    assert.equal(checkpoint.status, "started", "a delivery checkpoint cannot invent the source's final outcome");
    assert.equal(checkpoint.last_stage, "paste_started");
    assert.equal(checkpoint.diagnostics.message_reply, outcome === "success" ? "ack_success" : "ack_failed");
    if (outcome === "success") assert.equal(checkpoint.diagnostics.paste_populated, true);
    else assert.equal(checkpoint.diagnostics.error_code, "message_receiver_missing");
    assert.doesNotMatch(JSON.stringify(delivered), /PRIVATE_CARRY|PRIVATE_NATIVE_ERROR/);
  }
});

clockTest("destination paste progress survives a lost paste reply and a sparse terminal report", async t => {
  t.mock.timers.setTime(NOW);
  const delivered = [];
  const background = worker(async (_url, options) => { delivered.push(JSON.parse(options.body)); return success(); },
    profile(), () => Date.now());
  await background.settled();
  await background.ack(event(1, { destinationPlatform: "gemini", lastStage: "paste_started" }));
  await background.settled();
  const pending = startOwnedPaste(background, { stalled: true });
  for (const [checkpoint, diagnostics] of [
    ["received", { paste_ms: 0 }],
    ["editor_found", { paste_ms: 10, editor_seen: true, editor_kind: "contenteditable" }],
    ["inserted", { paste_ms: 20, editor_seen: true, editor_text_chars: 457957 }]
  ]) assert.equal((await pasteCheckpoint(background, checkpoint, diagnostics)).ok, true);
  await background.settled();
  assert.deepEqual(delivered.at(-1).diagnostics.paste_events.map(entry => entry.event), ["paste_start", "editor_wait", "paste_verify"]);
  await assert.rejects(pending, error => error.code === "paste_unconfirmed" && error.diagnosticCode === "message_timeout");
  assert.equal(background.evaluate("fixturePasteTrace.diagnostics.editor_text_chars"), 457957);
  await background.ack(event(1, { destinationPlatform: "gemini", status: "failed", lastStage: "paste_started", failureReason: "paste_failed",
    diagnostics: { version: 1, error_code: "message_timeout", paste_events: [] } }));
  await background.settled();
  const terminal = delivered.at(-1);
  assert.equal(terminal.status, "failed");
  assert.equal(terminal.failure_reason, "paste_failed");
  assert.equal(terminal.diagnostics.editor_text_chars, 457957);
  assert.equal(terminal.diagnostics.paste_events.length, 3);
  assert.equal(terminal.diagnostics.paste_populated, undefined, "insertion is not verified delivery");
  assert.equal((await pasteCheckpoint(background, "verified", { paste_populated: true })).ok, false);
  assert.doesNotMatch(JSON.stringify(delivered), /PRIVATE_CARRY/);
});

test("paste checkpoints require the dispatched destination and a fixed private-data-free observation", async () => {
  const delivered = [];
  const background = worker(async (_url, options) => { delivered.push(JSON.parse(options.body)); return success(); });
  await background.settled();
  await background.ack(event(1, { destinationPlatform: "gemini", lastStage: "paste_started" }));
  await background.settled();
  await startOwnedPaste(background);
  for (const sender of [
    { id: "other-extension" }, { frameId: 1 }, { tab: { id: 42, url: "https://gemini.google.com/app" } },
    { tab: { id: 85, url: "https://gemini.google.com/app" } }, { tab: { id: 84, url: "https://chatgpt.com/" } }
  ]) assert.equal((await pasteCheckpoint(background, "received", {}, sender)).ok, false);
  assert.equal((await pasteCheckpoint(background, "received", { message: "PRIVATE_ERROR" })).ok, false);
  assert.equal((await pasteCheckpoint(background, "received", {}, {}, { text: "PRIVATE_CARRY" })).ok, false);
  assert.equal((await pasteCheckpoint(background, "verified")).ok, false);
  assert.equal((await pasteCheckpoint(background, "received")).ok, true);
  assert.equal((await pasteCheckpoint(background, "received")).ok, false, "duplicate milestone is bounded");
  assert.equal((await pasteCheckpoint(background, "inserted", { editor_seen: true, editor_text_chars: 30 })).ok, true);
  assert.equal((await pasteCheckpoint(background, "editor_found", { editor_seen: true })).ok, false, "stale observation cannot regress progress");
  background.evaluate(`transferOperations.get("${id(1)}").controller.abort()`);
  assert.equal((await pasteCheckpoint(background, "verified", { paste_populated: true })).ok, false);
  await background.settled();
  assert.equal(background.evaluate(`activeTransferSourceTabs.get("${id(1)}")`), 42, "the destination must never become the source owner");
  assert.doesNotMatch(JSON.stringify(delivered), /PRIVATE_ERROR|PRIVATE_CARRY/);
});

test("accepted paste checkpoints survive blocked storage, terminal races and worker restart", async () => {
  const background = worker(async () => { throw new Error("offline"); });
  await background.settled();
  await background.ack(event(1, { destinationPlatform: "gemini", lastStage: "paste_started" }));
  await background.settled();
  await startOwnedPaste(background);
  const release = blockStorage(background, "local", "get");
  const checkpoint = pasteCheckpoint(background, "received", { paste_ms: 0 });
  const verified = pasteCheckpoint(background, "verified", { paste_ms: 20, paste_populated: true, editor_text_chars: 30 });
  const terminal = background.ack(event(1, { destinationPlatform: "gemini", status: "failed", lastStage: "paste_started", failureReason: "paste_failed",
    diagnostics: { version: 1, error_code: "message_timeout", paste_events: [] } }));
  try {
    assert.equal(background.evaluate("fixturePasteTrace.diagnostics.paste_populated"), true, "a checkpoint enriches the active trace before storage settles");
  } finally { release(); }
  assert.equal((await checkpoint).ok, true);
  assert.equal((await verified).ok, true);
  await terminal;
  await background.settled();
  const delivered = [];
  const restarted = worker(async (_url, options) => { delivered.push(JSON.parse(options.body)); return success(); }, background.shared);
  await restarted.settled();
  await restarted.retry();
  assert.equal(delivered.at(-1).status, "failed");
  assert.equal(delivered.at(-1).diagnostics.paste_populated, true, "a paste observation must not rewrite the terminal outcome");
  assert.deepEqual(delivered.at(-1).diagnostics.paste_events.map(entry => entry.event), ["paste_start", "paste_complete"]);
});

test("delivery diagnosis never waits for blocked storage", async () => {
  const background = worker(success);
  await background.settled();
  await background.ack(event(1, { destinationPlatform: "grok", lastStage: "paste_started" }));
  await background.settled();
  background.evaluate('transferToDestinationObserved = async () => ({ timing: {} })');
  const release = blockStorage(background, "session", "get");
  let finished = false;
  const pending = background.evaluate(`transferToDestination("grok", "PRIVATE_CARRY", null, "${id(1)}", true, null, { id: 42 })`).then(() => { finished = true; });
  try {
    for (let round = 0; round < 10 && !finished; round++) await new Promise(setImmediate);
    assert.equal(finished, true, "optional diagnosis cannot block the delivery reply");
  } finally { release(); await pending; await background.settled(); }
});

test("DOM deadline extensions survive worker restart beyond the old six-minute report expiry", async () => {
  const delivered = [];
  const fetch = async (_url, options) => { delivered.push(JSON.parse(options.body)); return success(); };
  const background = worker(fetch);
  await background.settled();
  await background.ack(event(1, { lastStage: "capture_started" }));
  await background.settled();
  background.evaluate('chrome.runtime.id = "extension-id"');
  const deadlineAt = NOW + 26 * 60000;
  const reply = await new Promise(resolve => background.listeners.message({
    type: "EXTEND_DOM_CAPTURE_DEADLINE", transferId: id(1), deadlineAt
  }, { id: "extension-id", frameId: 0, tab: { id: 42, url: "https://claude.ai/chat/source" } }, resolve));
  assert.equal(reply.ok, true);
  await background.persisted();
  assert.equal(background.shared.session[ACTIVE][id(1)].expiresAt, deadlineAt);

  // No new scroll snapshot while the browser sleeps; reload must still retain
  // the real interruption instead of dropping this still-allowed attempt.
  const restarted = worker(fetch, background.shared, NOW + 7 * 60000);
  await restarted.settled();
  await restarted.listeners.updated(42, { status: "loading" });
  await restarted.settled();
  assert.equal(restarted.shared.session[ACTIVE][id(1)].event.failureReason, "client_interrupted");
  assert.ok(delivered.some(payload => payload.attempt_id === id(1) && payload.failure_reason === "client_interrupted"));
});

test("source document reload retains an interrupted report when the old page cannot reply", async () => {
  const delivered = [];
  const background = worker(async (_url, options) => { delivered.push(JSON.parse(options.body)); return success(); });
  await background.settled();
  await background.ack(event(1, { lastStage: "paste_started", reportedModel: "local-direct" }));
  await background.settled();
  await background.listeners.updated?.(42, { status: "loading", url: "https://deepseek.invalid/PRIVATE_CHAT" });
  await background.settled();
  assert.equal(delivered.at(-1).status, "failed");
  assert.equal(delivered.at(-1).failure_reason, "client_interrupted");
  assert.equal(delivered.at(-1).last_stage, "paste_started");
  assert.equal(delivered.at(-1).diagnostics.error_code, "conversation_changed");
  assert.equal(delivered.at(-1).diagnostics.source_changed, true);
  assert.equal(delivered.at(-1).diagnostics.events.at(-1).code, "conversation_changed");
  assert.equal(delivered.at(-1).reported_model, "local-direct");
  assert.doesNotMatch(JSON.stringify(delivered), /PRIVATE_CHAT|deepseek\.invalid/);
});

for (const closed of [false, true]) test(`source ${closed ? "closure" : "reload"} is reported when optional session restoration rejects`, async () => {
  const delivered = [];
  const background = worker(async (_url, options) => { delivered.push(JSON.parse(options.body)); return success(); });
  await background.settled();
  await background.ack(event(1, { lastStage: "paste_started", reportedModel: "local-direct" }));
  await background.settled();
  background.evaluate(`chrome.storage.session.get = async () => { throw new Error("session unavailable"); };`);
  if (closed) await background.listeners.removed(42);
  else await background.listeners.updated(42, { status: "loading" });
  await background.settled();
  assert.equal(delivered.at(-1).status, "failed");
  assert.equal(delivered.at(-1).failure_reason, closed ? "user_cancelled" : "client_interrupted");
  assert.equal(delivered.at(-1).diagnostics.error_code, closed ? "source_tab_closed" : "conversation_changed");
  assert.equal(delivered.at(-1).last_stage, "paste_started");
  assert.equal(delivered.at(-1).reported_model, "local-direct");
  // A failed restore must not revive an expired in-memory attempt later.
  await background.ack(event(2));
  await background.settled();
  background.clock.now += 7 * 60 * 1000;
  const count = delivered.length;
  await background.listeners.removed(42);
  await background.settled();
  assert.equal(delivered.length, count);
});

test("source reload cancels only its owned work and preserves completed and newer reports", async () => {
  const background = worker(async () => { throw new Error("offline"); });
  await background.settled();
  await background.ack(event(1, { lastStage: "paste_started" }));
  await background.ack(event(2, { status: "succeeded", lastStage: "completed" }));
  await background.ack(event(3, { attemptedAt: new Date(NOW + 1).toISOString() }));
  await background.settled();
  background.evaluate(`getTransferOperation("${id(1)}", { id: 42 }).tabIds.add(100); getTransferOperation("other-source", { id: 99 }).tabIds.add(42);`);
  await background.listeners.updated(100, { status: "loading" });
  await background.listeners.updated(42, { status: "complete" });
  assert.equal(background.shared.session[ACTIVE][id(1)].event.status, "started");
  await background.listeners.updated(42, { status: "loading" });
  await background.settled();
  assert.equal(background.shared.session[ACTIVE][id(1)].event.failureReason, "client_interrupted");
  assert.equal(background.shared.session[ACTIVE][id(2)].event.status, "succeeded");
  assert.equal(background.shared.session[ACTIVE][id(3)].event.status, "started");
  assert.equal(background.evaluate(`transferOperations.get("${id(1)}").controller.signal.aborted`), true);
  assert.equal(background.evaluate('transferOperations.get("other-source").controller.signal.aborted'), false);
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
  // Match persisted field order so the single-write guard observes the append,
  // rather than a preliminary serialization cleanup.
  const entries = Array.from({ length: 500 }, (_, i) => ({ deliveryId: id(i + 10000),
    payload: payload(i + 1, scenario.terminals ? { status: "succeeded", last_stage: "completed" } : {}), queuedAt: NOW }));
  const shared = profile({
    [DIAGNOSTICS]: { counts: {}, recent: [], retry: { failures: 1, nextAttemptAt: NOW + 60000, kind: "retry" } }
  }, scenario.signed ? { [ACTIVE]: { [id(501)]: {
    event: event(501), tabId: 42, expiresAt: NOW + 300000, summary_proof: proof,
    summary_confirmed_at: new Date(NOW).toISOString(), model: "gemini-3.5-flash-lite"
  } } } : {});
  const background = worker(async () => { throw new Error("offline"); }, shared);
  await background.settled();
  // Seed after startup: this fixture owns append atomicity. The preceding
  // queue-bounds test covers restoring full queues, including 601 terminals.
  shared.local[OUTBOX] = entries;
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
  const acknowledgement = await background.ack(incoming);
  assert.equal(acknowledgement.ok, true, JSON.stringify(acknowledgement));
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
      assert.ok(Date.now() - NOW < 100, "Prepared attribution must bypass the blocked storage queue.");
      const cached = await summaryWithin(background, NOW + 5000).observed;
      assert.equal(cached?.timing.source, "cache");
      assert.equal(cached?.timing.backend.model, "gemini-3.5-flash-lite");
      later = summaryWithin(background, NOW + 5000, "Another captured transcript");
      assert.equal((await later.observed)?.ok, true, "The blocked queue must not freeze later summaries.");
      assert.equal(summaryRequests.length, 2);
      assert.ok(summaryRequests.every(input => input.telemetry?.attempt_id === id(1)), "Prepared attribution survives stalled storage.");
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
    if (stage === "snapshot") {
      // A restarted worker has durable capture state but no prepared memory snapshot.
      background.evaluate("preparedSummaryTelemetry.clear()");
      release = blockStorage(background, area, "get");
    }
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

  for (const prepared of [false, true]) test(`telemetry storage ${area} read failure cannot block a ${prepared ? "prepared" : "cold"} summary`, async () => {
    const summaryRequests = [];
    const background = worker(async (url, options) => {
      if (url.endsWith("/api/telemetry")) throw new Error("offline");
      summaryRequests.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ summary: "available summary" }) };
    });
    await background.settled();
    await background.ack(event());
    await background.settled();
    if (!prepared) background.evaluate("preparedSummaryTelemetry.clear()");
    background.evaluate(`chrome.storage.${area}.get = async () => { throw new Error("storage unavailable"); }`);
    const response = await new Promise(resolve => background.listeners.message({
      type: "SUMMARIZE_WITH_BACKEND", conversation: "transcript", transferId: id(1)
    }, {}, resolve));
    await background.settled();
    assert.equal(response.ok, true);
    assert.equal(response.summary, "available summary");
    assert.equal(summaryRequests.length, 1);
    assert.equal(summaryRequests[0].telemetry?.attempt_id, prepared ? id(1) : undefined);
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

clockTest("prepared capture metadata starts AI immediately through a blocked progress write and retains its signed receipt", async t => {
  t.mock.timers.setTime(NOW);
  const proof = "e".repeat(64), confirmedAt = new Date(NOW).toISOString();
  let request, fetchedAt;
  const background = worker(async (url, options) => {
    if (url.endsWith("/api/telemetry")) throw new Error("offline");
    fetchedAt = Date.now(); request = JSON.parse(options.body);
    return { ok: true, status: 200, json: async () => ({ summary: "generated summary", summaryProofV3: proof,
      summaryModel: "gemini-3.5-flash-lite", summaryConfirmedAt: confirmedAt }) };
  }, profile(), () => Date.now());
  await background.settled();
  await background.ack(event(1, { lastStage: "capture_started", characterCount: null }));
  await background.settled();
  const release = blockStorage(background, "session", "set");
  const progress = background.ack(event(1, { lastStage: "capture_completed", characterCount: 40000 }));
  await release.began;
  const latest = background.ack(event(1, { lastStage: "summary_request_started", characterCount: 40000 }));
  const operation = summaryWithin(background, NOW + 5000);
  try {
    assert.equal((await operation.observed)?.summary, "generated summary");
    assert.ok(fetchedAt - NOW < 100, "AI starts before optional receipt persistence waits.");
    assert.equal(request.telemetry.character_count, 40000);
    assert.equal(request.telemetry.last_stage, "summary_request_started");
  } finally {
    release(); await progress; await latest; await operation.request; await background.settled();
  }
  await background.ack(event(1, { status: "succeeded", lastStage: "completed", characterCount: 40000 }));
  await background.settled();
  const terminal = background.shared.local[OUTBOX][0].payload;
  assert.equal(terminal.summary_proof, proof);
  assert.equal(terminal.model, "gemini-3.5-flash-lite");
  assert.equal(terminal.character_count, 40000);
});

for (const area of ["local", "session"]) {
  clockTest(`a cold worker still bounds stalled ${area} attribution recovery`, async t => {
    t.mock.timers.setTime(NOW);
    let request;
    const background = worker(async (url, options) => {
      if (url.endsWith("/api/telemetry")) throw new Error("offline");
      request = JSON.parse(options.body);
      return { ok: true, status: 200, json: async () => ({ summary: "available summary" }) };
    }, profile({ [INSTALL]: id(999) }, { [ACTIVE]: { [id(1)]: { event: event(), tabId: 42, expiresAt: NOW + 300000 } } }), () => Date.now());
    await background.settled();
    const release = blockStorage(background, area, "get");
    const operation = summaryWithin(background, NOW + 5000);
    try {
      assert.equal((await operation.observed)?.summary, "available summary");
      assert.equal(request.telemetry, undefined);
      assert.equal(Date.now() - NOW, 1000);
    } finally {
      release(); await operation.request; await background.settled();
    }
  });
}

test("prepared attribution rejects conflicting identity and preserves terminal and expiry boundaries", async () => {
  const background = worker(async () => { throw new Error("offline"); });
  await background.settled();
  await background.ack(event());
  await background.ack(event(1, { sourcePlatform: "gemini", characterCount: 999 }));
  const prepared = background.evaluate(`getPreparedSummaryTelemetry("${id(1)}")`);
  assert.equal(prepared.source_platform, "claude");
  assert.equal(prepared.character_count, 30);
  await background.ack(event(1, { status: "failed", failureReason: "paste_failed" }));
  await background.ack(event(1, { lastStage: "summary_request_started" }));
  assert.equal(background.evaluate(`getPreparedSummaryTelemetry("${id(1)}")`), null);
  await background.ack(event(2));
  background.clock.now += 360001;
  assert.equal(background.evaluate(`getPreparedSummaryTelemetry("${id(2)}")`), null);
  await background.settled();
});

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

test("JSON attempts survive stale source snapshots, durable compaction and worker restart",async()=>{
  const background=worker(async()=>{throw new Error("offline");}); await background.settled();
  const first={mode:"prefetch",outcome:"failed",step:"route",step_stage:"history",failure_check:"routing_unavailable",hook_ready:true,route_found:false,progress_seq:2};
  const retry={mode:"retry",outcome:"started",step:"read",step_stage:"history",progress_seq:5};
  const report=entries=>({version:1,json_attempts:entries});
  await background.ack(event(1,{diagnostics:report([first,retry])}));
  await background.ack(event(1,{diagnostics:report([{...retry,step:"hook",progress_seq:1}])}));
  await background.settled();
  const read=()=>background.shared.local[OUTBOX][0].payload.diagnostics.json_attempts;
  assert.deepEqual(read(),[first,retry]);
  const final={...retry,outcome:"failed",failure_check:"timeout",progress_seq:6};
  await background.ack(event(1,{diagnostics:report([final])}));
  await background.ack(event(1,{status:"failed",failureReason:"capture_failed",diagnostics:report([{...retry,progress_seq:99}])}));
  await background.settled(); assert.deepEqual(read(),[first,final]);
  const delivered=[];
  const restarted=worker(async(_url,options)=>{delivered.push(JSON.parse(options.body));return success();},background.shared);
  await restarted.settled(); await restarted.retry();
  assert.deepEqual(delivered.at(-1).diagnostics.json_attempts,[first,final]);
});
