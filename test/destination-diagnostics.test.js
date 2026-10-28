const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const background = fs.readFileSync(path.join(__dirname, "..", "extension/background.js"), "utf8");
const diagnostics = fs.readFileSync(path.join(__dirname, "..", "extension/transfer-diagnostics.js"), "utf8");
const destinationCode = background.slice(background.indexOf("function recordDestinationObservation("),
  background.indexOf("async function pasteIntoDestinationTab("));
const compiled = new vm.Script(`${diagnostics}\n${destinationCode}`, { filename: "background.js" });
const attemptId = "11111111-1111-4111-8111-000000000001";

function fixture({ create, focus, reporting } = {}) {
  let now = 1000;
  let queue = Promise.resolve();
  const reports = [];
  const source = { id: 42, windowId: 1, index: 0 };
  const operation = { transferId: attemptId, sourceTabId: source.id, tabIds: new Set([42]), createdTabIds: new Set(),
    controller: new AbortController() };
  const active = new Map([[attemptId, { attemptId, attemptedAt: new Date(1000).toISOString(), sourcePlatform: "claude",
    destinationPlatform: "gemini", status: "started", lastStage: "capture_started" }]]);
  const ownership = new Map([[attemptId, source.id]]);
  const sandbox = {
    Date: class extends Date { static now() { return now; } }, AbortController,
    activeTransferTelemetry: active, activeTransferSourceTabs: ownership,
    DESTINATIONS: { gemini: { url: "https://gemini.google.com/app", name: "Gemini" } },
    nowMs: () => now,
    getTransferOperation: () => operation,
    checkTransferDeadline() {},
    checkTransferOperation: current => current?.controller.signal.throwIfAborted(),
    checkTransferSource: async current => { current?.controller.signal.throwIfAborted(); return source; },
    warmDestinationTab() {},
    enqueueTelemetryWork(work) { queue = queue.then(work, work); return queue; },
    restoreActiveTransferTelemetry: async () => {},
    mergeTransferTelemetryEvents: (_previous, next) => next,
    getOrCreateTelemetryInstallId: async () => "fixture-install",
    updatePreparedSummaryTelemetry() {},
    makeTelemetryPayload: event => event,
    queueActiveTransferTelemetry(event) {
      const safe = JSON.parse(JSON.stringify(event));
      reports.push({ event: safe, sourceTabId: ownership.get(attemptId) });
      active.set(attemptId, safe);
      return reporting ? reporting() : Promise.resolve(true);
    },
    chrome: {
      tabs: {
        create: async options => { now += 27; return create ? create(options) : { id: 84, status: "loading" }; },
        get: async () => source,
        update: async () => { now += 13; return { id: 84, windowId: 1 }; },
        remove: async () => {}
      },
      windows: { update: async () => { now += 8; return focus?.(); } }
    }
  };
  vm.createContext(sandbox);
  compiled.runInContext(sandbox);
  return { sandbox, reports, active, ownership, operation, source, settled: () => queue.catch(() => {}) };
}

test("destination preparation reports before a stalled native reply without waiting on telemetry", async () => {
  let completeCreation;
  let releaseReporting;
  const reporting = new Promise(resolve => { releaseReporting = resolve; });
  const state = fixture({ create: () => new Promise(resolve => { completeCreation = resolve; }), reporting: () => reporting });
  const pending = state.sandbox.prepareDestination("gemini", null, state.source, attemptId);
  await new Promise(setImmediate);
  assert.equal(state.reports.length, 1);
  assert.equal(state.reports[0].event.lastStage, "capture_started", "overlapping preparation cannot advance capture to paste");
  assert.equal(state.reports[0].event.diagnostics.delivery_events[0].event, "destination_prepare");
  completeCreation({ id: 84, status: "loading" });
  const result = await pending;
  assert.equal(result.timing.openMs, 27);
  releaseReporting();
  await state.settled();
  const last = state.reports.at(-1).event;
  assert.equal(last.status, "started");
  assert.equal(last.diagnostics.destination_prepared, true);
  assert.equal(last.diagnostics.destination_open_ms, 27);
  assert.deepEqual(last.diagnostics.delivery_events.map(entry => entry.event), ["destination_prepare", "destination_open"]);
  assert.doesNotMatch(JSON.stringify(state.reports), /https?:|windowId|openerTabId/);
});

test("destination opening failures keep a bounded safe cause and the original transfer outcome", async () => {
  const error = new Error("PRIVATE native details https://secret.example/");
  const state = fixture({ create: async () => { throw error; } });
  await assert.rejects(state.sandbox.prepareDestination("gemini", null, state.source, attemptId), actual => actual === error);
  await state.settled();
  const last = state.reports.at(-1).event;
  assert.equal(last.status, "started");
  assert.equal(last.lastStage, "capture_started");
  assert.equal(last.diagnostics.recovery_error_code, "destination_open_failed");
  assert.equal(last.diagnostics.destination_prepared, false);
  assert.equal(last.diagnostics.error_type, "Error");
  assert.equal(last.diagnostics.delivery_events.at(-1).code, "destination_open_failed");
  await assert.rejects(state.sandbox.prepareDestination("gemini", null, state.source, attemptId));
  await state.settled();
  assert.equal(state.reports.length, 2, "repeated attempts cannot flood the same observations");
  assert.doesNotMatch(JSON.stringify(state.reports), /PRIVATE|secret\.example/);
  state.ownership.set(attemptId, 99);
  state.sandbox.recordDestinationObservation(state.operation, "destination_open", { destination_prepared: true });
  await state.settled();
  assert.equal(state.reports.length, 2, "a different source cannot report this attempt");
});

test("native activation failure is recorded independently and optional reporting cannot break focus", async () => {
  const state = fixture({ focus: async () => { throw new Error("PRIVATE native focus failure"); } });
  state.operation.tabIds.add(84);
  state.active.get(attemptId).lastStage = "paste_started";
  await assert.rejects(state.sandbox.activateDestinationTab(84, null, state.operation), error => error.diagnosticCode === "destination_activation_failed");
  await state.settled();
  const last = state.reports.at(-1).event;
  assert.equal(last.lastStage, "paste_started");
  assert.equal(last.status, "started");
  assert.equal(last.diagnostics.activation_ms, 21);
  assert.equal(last.diagnostics.recovery_error_code, "destination_activation_failed");
  assert.doesNotMatch(JSON.stringify(state.reports), /PRIVATE/);
  const healthy = fixture({ reporting: () => { throw new Error("Optional telemetry unavailable"); } });
  healthy.operation.tabIds.add(84);
  await healthy.sandbox.activateDestinationTab(84, null, healthy.operation);
  await healthy.settled();
  assert.equal(healthy.reports.at(-1).event.diagnostics.activation_ms, 21);
});
