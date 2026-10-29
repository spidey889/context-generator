const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const large = require("../extension/large-transfer");
const { clockTest } = require("./helpers/clock");
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

test("cancellation queued during large-chat preparation stops before any backend request", async () => {
  const controller = new AbortController();
  const cancelled = Object.assign(new Error("Source cancelled during preparation"), { code: "user_cancelled" });
  const timer = setTimeout(() => controller.abort(cancelled), 0);
  let requests = 0;
  try {
    await assert.rejects(large.summarize({ conversation: "x".repeat(4000000), transferId, signal: controller.signal,
      async post(payload) {
        requests++;
        return { summary: "Synthetic handoff", receipt: "synthetic-receipt" };
      } }), error => error.code === "user_cancelled");
    assert.equal(requests, 0);
  } finally { clearTimeout(timer); }
});

function backgroundFixture(fetchImpl, consent = () => true) {
  const source = fs.readFileSync(path.join(__dirname, "../extension/background.js"), "utf8");
  const code = source.slice(source.indexOf("function localPreviewAuthHeaders("), source.indexOf("// Opening a page after removal")) +
    source.slice(source.indexOf("async function readSummaryResponse("), source.indexOf("async function summarizeWithBackend(")) +
    source.slice(source.indexOf("async function createSummaryBackendError("), source.indexOf("function getCachedSummaryEntry(")) +
    source.slice(source.indexOf("async function summarizeLargeWithBackend("), source.indexOf("async function fetchSummaryFromBackend("));
  const active = { attemptId: transferId, status: "started", lastStage: "summary_request_started" };
  const telemetry = { attempt_id: transferId, character_count: 1000001, status: "started", last_stage: "summary_request_started" };
  const queued = [], checkpoints = [], localDebug = {}, proofs = new Map(), progress = [];
  const operation = { sourceTabId: 42, controller: new AbortController() };
  const sandbox = { AbortController, TextEncoder, TextDecoder, Date, URL, setTimeout, clearTimeout,
    CapTransferDiagnostics: require("../extension/transfer-diagnostics"), console: { info() {} },
    CapLargeTransfer: large, SUMMARY_BACKEND_URL: "https://context-generator-five.vercel.app/api/summarize", SUMMARY_CLIENT_HEADER: "cap-context-extension/1",
    isUuid: value => value === transferId, nowMs: Date.now, startSummaryServiceWorkerKeepAlive: () => () => {},
    getPreparedSummaryTelemetry: () => telemetry, getOrCreateTelemetryInstallId: async () => "install", hasTelemetryConsent: async () => consent(),
    waitForSummaryTelemetry: work => work, enqueueTelemetryWork: work => work(), restoreActiveTransferTelemetry: async () => {}, updatePreparedSummaryTelemetry() {},
    checkTransferOperation: op => op.controller.signal.throwIfAborted(), checkTransferDeadline() {}, checkTransferSource: async () => {},
    fetch: fetchImpl, recordKnownTransferTelemetryStage() {},
    recordTransferTelemetry: async report => checkpoints.push(report),
    // Transport tests inspect only when confirmation is offered; signature
    // verification belongs to the real endpoint/Edge receipt tests.
    sanitizeSummaryConfirmation: value => value.summary_proof ? value : null,
    activeTransferTelemetry: new Map([[transferId, active]]), summaryProofs: proofs,
    mergeTransferTelemetryEvents: (_previous, next) => next,
    queueActiveTransferTelemetry: async payload => queued.push(payload), initializeTelemetryDelivery() {},
    chrome: { storage: { local: { set: async value => Object.assign(localDebug, value) } },
      tabs: { sendMessage: async (tabId, message) => progress.push({ tabId, message }) } }
  };
  vm.createContext(sandbox); new vm.Script(code).runInContext(sandbox);
  return { run: (conversation = "x".repeat(1000001)) => sandbox.summarizeLargeWithBackend(conversation, transferId, null, operation),
    queued, checkpoints, localDebug, proofs, progress, sandbox };
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

test("large fetch failures retain safe dispatch evidence before local recovery and sibling cancellation", async () => {
  const state = backgroundFixture(async () => { throw new TypeError("PRIVATE_FETCH_ERROR https://PRIVATE/file.txt"); });
  await assert.rejects(state.run(), error => {
    assert.equal(error.diagnostics?.error_code, "summary_transport_failed");
    const record = error.diagnostics.summary_response_failures[0];
    assert.equal(record.phase, "request");
    assert.equal(record.reason, "fetch_failed");
    assert.equal(record.error_type, "TypeError");
    assert.equal(record.http_status, undefined);
    assert.equal(record.aborted, false);
    return true;
  });
  assert.equal(state.checkpoints.length, 1, "Sibling cancellation cannot replace the initiating failure.");
  assert.equal(state.checkpoints[0].diagnostics.summary_response_failures.length, 1);
  assert.doesNotMatch(JSON.stringify(state.checkpoints), /PRIVATE|https:|stack|headers|receipt/);
  const debug = state.localDebug["context-generator-summary-response-debug-v1"];
  assert.equal(debug.large_phase, "part");
  assert.equal(debug.part_index, 0);
});

test("large HTTP rejection and incomplete streams retain their actual failure boundary", async () => {
  for (const [response, code, reason, phase] of [
    [new Response(JSON.stringify({ code: "client_not_allowed", error: "PRIVATE_RESPONSE" }), { status: 403 }),
      "client_not_allowed", "http_rejected", "response_headers"],
    [new Response('{"type":"reset"}\n', { headers: { "content-type": "application/x-ndjson" } }),
      "summary_invalid_response", "stream_completion_invalid", "stream_completion_validation"]
  ]) {
    const state = backgroundFixture(async () => response.clone());
    await assert.rejects(state.run(), error => {
      assert.equal(error.diagnostics?.error_code, code);
      assert.equal(error.diagnostics.failure_site, "summary_response");
      const record = error.diagnostics.summary_response_failures[0];
      assert.equal(record.http_status, response.status);
      assert.equal(record.reason, reason); assert.equal(record.phase, phase);
      if (response.status === 200) { assert.ok(record.bytes_received > 0); assert.equal(record.eof, true); }
      return true;
    });
    assert.equal(state.checkpoints.length, 1);
    assert.doesNotMatch(JSON.stringify(state.checkpoints), /PRIVATE|https:|stack|receipt/);
  }
});

clockTest("large requests record an elapsed timeout before response headers", { tickMs: 1000, maxElapsedMs: 90000 }, async () => {
  const state = backgroundFixture((_url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  await assert.rejects(state.run(), error => {
    assert.equal(error.diagnostics?.error_code, "summary_timeout");
    const record = error.diagnostics.summary_response_failures[0];
    assert.equal(record.phase, "request"); assert.equal(record.reason, "aborted");
    assert.equal(record.aborted, true); assert.equal(record.deadline_elapsed, true);
    assert.ok(record.elapsed_ms >= 85000);
    return true;
  });
});

test("missing large part receipts retain response validation evidence", async () => {
  const state = backgroundFixture(async () => new Response(JSON.stringify({ summary: "PRIVATE_PART", receipt: "" })));
  await assert.rejects(state.run(), error => {
    assert.equal(error.diagnostics?.error_code, "summary_invalid_response");
    assert.equal(error.diagnostics.summary_response_failures[0].phase, "summary_validation");
    return true;
  });
});

test("a lost or missing worker summary reply has a distinct message diagnosis", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../extension/platform-content.js"), "utf8");
  const code = source.slice(source.indexOf("  async function notifyBackground("), source.indexOf("  function getRuntimeAssetBaseUrl("));
  for (const [sendMessage, expected] of [
    [async () => { throw new Error("PRIVATE_PORT_ERROR"); }, "message_transport_failed"],
    [async () => undefined, "message_reply_missing"],
    [async () => ({ arbitrary: true }), "message_reply_invalid"]
  ]) {
    const sandbox = { extensionRuntime: { sendMessage }, isExtensionContextInvalidated: () => false };
    vm.createContext(sandbox); new vm.Script(code).runInContext(sandbox);
    await assert.rejects(sandbox.notifyBackground({ type: "SUMMARIZE_WITH_BACKEND" }), error => {
      assert.equal(error.code, expected); assert.doesNotMatch(error.message, /PRIVATE/); return true;
    });
  }
});
