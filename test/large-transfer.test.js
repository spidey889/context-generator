const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const large = require("../extension/large-transfer");
const transferId = "4bad0000-0000-4000-8000-000000000001";

test("large partitions cover exact Unicode/CRLF input once and stay below both JSON wire bounds", () => {
  for (const input of ["x".repeat(4000000), "\ud83d\ude00\r\n".repeat(1000000), "\0\"\\".repeat(1333333) + "z"]) {
    const parts = large.split(input);
    assert.equal(parts.map(part => part.conversation).join(""), input);
    assert.ok(parts.length >= 2 && parts.length <= 16);
    let offset = 0;
    for (const part of parts) {
      assert.equal(part.offset, offset);
      offset += part.conversation.length;
      assert.ok(part.conversation.length <= 500000);
      assert.ok(Buffer.byteLength(JSON.stringify({ conversation: part.conversation })) <= 2700000);
      assert.ok(Buffer.byteLength(JSON.stringify(JSON.stringify({ conversation: part.conversation }))) <= 3500000);
      assert.doesNotMatch(part.conversation, /[\uD800-\uDBFF]$/);
      assert.doesNotMatch(part.conversation, /^[\uDC00-\uDFFF]/);
    }
  }
  for (const input of ["x".repeat(1000000), "x".repeat(4000001)])
    assert.throws(() => large.split(input), error => error.code === "conversation_too_large");
});

test("large summaries wait for every bounded part and finalize in source order", async () => {
  const calls = [], progress = [];
  let active = 0, peak = 0;
  const input = "A".repeat(4000000);
  const result = await large.summarize({ conversation: input, transferId, onProgress: value => progress.push(value),
    async post(payload) {
      calls.push(payload);
      if (payload.large.phase === "part") {
        peak = Math.max(peak, ++active);
        await new Promise(resolve => setTimeout(resolve, payload.large.index % 2 ? 1 : 5));
        active--;
        return { summary: `Part ${payload.large.index}`, receipt: `proof-${payload.large.index}` };
      }
      assert.equal(active, 0);
      assert.deepEqual(payload.parts, Array.from({ length: 8 }, (_, index) => ({ summary: `Part ${index}`, receipt: `proof-${index}` })));
      return { summary: "Complete handoff", summaryProofV3: "a".repeat(64) };
    } });
  assert.equal(result.partCount, 8);
  assert.equal(result.summary, "Complete handoff");
  assert.ok(peak <= 3 && peak > 1);
  assert.equal(calls.filter(call => call.large.phase === "final").length, 1);
  assert.equal(calls.filter(call => call.large.phase === "part").map(call => call.conversation).join(""), input);
  assert.deepEqual(progress.at(-1), { completed: 8, total: 8, phase: "final" });
});

test("a failed part cancels siblings and cannot finalize a partial handoff", async () => {
  const phases = [];
  let cancelled = 0;
  await assert.rejects(large.summarize({ conversation: "x".repeat(2000000), transferId,
    async post(payload, { signal }) {
      phases.push(payload.large.phase);
      if (payload.large.index === 0) throw Object.assign(new Error("failed part"), { code: "summary_failed" });
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => { cancelled++; reject(signal.reason); }, { once: true });
        if (signal.aborted) { cancelled++; reject(signal.reason); }
      });
    } }), error => error.code === "summary_failed");
  assert.ok(cancelled > 0);
  assert.equal(phases.includes("final"), false);
});

test("large cancellation, malformed part receipts and expired work never reach finalization", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(large.summarize({ conversation: "x".repeat(1000001), transferId, signal: controller.signal,
    post() { assert.fail("cancelled input cannot submit"); } }));
  await assert.rejects(large.summarize({ conversation: "x".repeat(1000001), transferId,
    deadlineAt: Date.now() + 1000, post() { assert.fail("no summary budget remains"); } }));
  await assert.rejects(large.summarize({ conversation: "x".repeat(1000001), transferId,
    async post(payload) { assert.equal(payload.large.phase, "part"); return { summary: "partial", receipt: "" }; } }),
  error => error.code === "summary_invalid_response");
});

function backgroundFixture(fetchImpl, consent = () => true) {
  const source = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");
  const code = source.slice(source.indexOf("function localPreviewAuthHeaders("), source.indexOf("// Opening a page after removal")) +
    source.slice(source.indexOf("async function summarizeLargeWithBackend("), source.indexOf("async function fetchSummaryFromBackend("));
  const active = { attemptId: transferId, status: "started", lastStage: "summary_request_started" };
  const telemetry = { attempt_id: transferId, character_count: 1000001, status: "started", last_stage: "summary_request_started" };
  const queued = [], proofs = new Map(), progress = [];
  const operation = { sourceTabId: 42, controller: new AbortController() };
  const sandbox = { AbortController, TextEncoder, Date, URL, setTimeout, clearTimeout,
    CapLargeTransfer: large, SUMMARY_BACKEND_URL: "https://context-generator-five.vercel.app/api/summarize", SUMMARY_CLIENT_HEADER: "cap-context-extension/1",
    isUuid: value => value === transferId, nowMs: Date.now, startSummaryServiceWorkerKeepAlive: () => () => {},
    getPreparedSummaryTelemetry: () => telemetry, getOrCreateTelemetryInstallId: async () => "install", hasTelemetryConsent: async () => consent(),
    waitForSummaryTelemetry: work => work, enqueueTelemetryWork: work => work(), restoreActiveTransferTelemetry: async () => {}, updatePreparedSummaryTelemetry() {},
    checkTransferOperation: op => op.controller.signal.throwIfAborted(), checkTransferDeadline() {}, checkTransferSource: async () => {},
    readSummaryResponse: response => response.json(), fetch: fetchImpl,
    createSummaryBackendError: async () => Object.assign(new Error("unavailable"), { code: "summary_failed" }),
    createSummaryBackendPayloadError: () => Object.assign(new Error("failed"), { code: "summary_failed" }),
    // Transport tests inspect only when confirmation is offered; signature
    // verification belongs to the real endpoint/Edge receipt tests.
    sanitizeSummaryConfirmation: value => value.summary_proof ? value : null,
    activeTransferTelemetry: new Map([[transferId, active]]), summaryProofs: proofs,
    mergeTransferTelemetryEvents: (_previous, next) => next,
    queueActiveTransferTelemetry: async payload => queued.push(payload), initializeTelemetryDelivery() {},
    chrome: { tabs: { sendMessage: async (tabId, message) => progress.push({ tabId, message }) } }
  };
  vm.createContext(sandbox); new vm.Script(code).runInContext(sandbox);
  return { run: (conversation = "x".repeat(1000001)) => sandbox.summarizeLargeWithBackend(conversation, transferId, null, operation), queued, proofs, progress };
}

test("background uses only the separate endpoint and persists only a complete final receipt", async () => {
  const requests = [];
  const state = backgroundFixture(async (url, options) => {
    assert.equal(url, "https://context-generator-five.vercel.app/api/large-summary");
    assert.equal(options.credentials, "omit"); assert.equal(options.redirect, "error");
    const payload = JSON.parse(options.body); requests.push(payload);
    assert.equal(payload.telemetry.character_count, 1000001);
    if (payload.large.phase === "part") {
      assert.equal(state.queued.length, 0);
      return { ok: true, json: async () => ({ summary: "partial", receipt: `part-${payload.large.index}` }) };
    }
    assert.equal(state.queued.length, 0);
    return { ok: true, json: async () => ({ summary: "final handoff", summaryProofV3: "a".repeat(64),
      summaryConfirmedAt: "2026-10-29T12:00:00Z", summaryModel: "nvidia/nemotron-3.5-super-vl:free", timing: { model: "nvidia/nemotron-3.5-super-vl:free" } }) };
  });
  const result = await state.run();
  assert.equal(requests.length, 4);
  assert.equal(result.summary, "final handoff");
  assert.equal(state.queued.length, 1);
  assert.equal(state.queued[0].last_stage, "summary_completed");
  assert.equal(state.proofs.size, 1);
  assert.ok(state.progress.every(item => item.tabId === 42 && !JSON.stringify(item.message).includes("partial")));
});

test("background cannot count completed parts after final summary failure", async () => {
  const state = backgroundFixture(async (_url, options) => {
    const payload = JSON.parse(options.body);
    return payload.large.phase === "part"
      ? { ok: true, json: async () => ({ summary: "partial", receipt: `part-${payload.large.index}` }) }
      : { ok: false };
  });
  await assert.rejects(state.run(), error => error.code === "summary_failed");
  assert.equal(state.queued.length, 0);
  assert.equal(state.proofs.size, 0);
});

test("large Firefox transfers recheck consent for each part and the final request", async () => {
  let granted = true;
  const requests = [];
  const state = backgroundFixture(async (_url, options) => {
    const payload = JSON.parse(options.body);
    requests.push(payload);
    if (payload.large.phase === "part") {
      granted = false;
      return { ok: true, json: async () => ({ summary: "part", receipt: `part-${payload.large.index}` }) };
    }
    return { ok: true, json: async () => ({ summary: "Complete large summary." }) };
  }, () => granted);
  const result = await state.run("x".repeat(2000000));
  assert.equal(result.summary, "Complete large summary.");
  assert.ok(requests.some(request => request.telemetry));
  assert.ok(requests.some(request => request.large.phase === "part" && !Object.hasOwn(request, "telemetry")));
  assert.equal(Object.hasOwn(requests.at(-1), "telemetry"), false);
  assert.equal(requests.length, 5);
});
