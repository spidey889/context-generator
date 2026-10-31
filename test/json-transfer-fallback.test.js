const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { loadTransferFlow } = require("./helpers/transfer-flow");
const { clockTest } = require("./helpers/clock");

const source = fs.readFileSync(path.join(__dirname, "../extension/platform-content.js"), "utf8");

// Exercise the actual picker orchestrator; substitute only its UI, capture and
// transfer boundaries to count side effects without native timers or a browser.
function harness(platform, { mode = "failure", enabled = true, domFails = false, prepareFails = false, failureReason } = {}) {
  const calls = { json: 0, prepare: 0, dom: 0, notice: 0, handoff: 0, destination: 0, waits: [], flows: [], errors: [], traces: [], traceDetails: [], captureMetrics: [], finished: [] };
  const prepared = Promise.resolve({ tabId: 42 });
  const pathname = { claude: "/chat/source", chatgpt: "/c/source", gemini: "/app/source", grok: "/c/source", deepseek: "/a/chat/s/source" }[platform];
  const location = { href: `https://example.test${pathname}`, pathname };
  const navigationListeners = new Set();
  const context = loadTransferFlow({
    Date, delay: async ms => { calls.waits.push(ms); },
    window: { location, navigation: {
      addEventListener: (_type, listener) => navigationListeners.add(listener),
      removeEventListener: (_type, listener) => navigationListeners.delete(listener)
    } }, currentPlatform: { id: platform, name: platform },
    claudeJsonCaptureEnabled: enabled, chatGptJsonCaptureEnabled: enabled, networkJsonCaptureEnabled: enabled,
    createTransferTrace: () => ({ id: "same-attempt" }), startTransferTelemetry() {},
    markTransferTrace: (_trace, message, detail) => { calls.traces.push(message); calls.traceDetails.push(detail); },
    finishTransferTrace: trace => calls.finished.push(trace),
    clearRunningResetTimer() {}, resetRunningFlag: () => { context.isRunning = false; },
    getDetectedConversationMessageCount: () => 2,
    transitionDestinationSheetToHandoff: async () => {}, showOverlay: () => { calls.handoff++; }, releaseDestinationSheetBackdrop() {},
    isHandoffOverlayVisible: () => calls.handoff > 0,
    advanceTransferTelemetryStage() {}, setHandoffProgress() {}, markCaptureDone() {},
    prepareDestinationTab: () => { calls.destination++; return prepared; },
    prepareSourceForCapture: async () => {
      calls.prepare++;
      if (prepareFails) throw new Error("Source preparation failed");
    },
    scrapeConversationTextWhenReady: async () => {
      calls.dom++;
      if (domFails) throw new Error("DOM capture failed");
      return "DOM transcript";
    },
    createConversationCapture: (text, metrics) => { calls.captureMetrics.push(metrics); return text; },
    showFastCaptureFallbackMessage: () => { calls.notice++; },
    runContextFlow: (destination, prep, text, trace) => { calls.flows.push({ destination, prep, text, trace }); },
    getSafeTelemetryFailureReason: () => "capture_failed",
    // These fixtures assert capture/retry policy; the full-page fixtures verify
    // the display translation while retaining this original diagnostic message.
    showErrorOverlay: error => calls.errors.push(typeof error === "string" ? error : error.message)
  });
  const capture = async () => {
    calls.json++;
    if (mode === "cancelled") throw new Error("The conversation changed during capture.");
    if (mode === "navigate") location.href = "https://example.test/chat/other";
    if (mode !== "success") throw Object.assign(new Error("private native error and token MUST_NOT_APPEAR"), { captureFailureReason: failureReason });
    return { text: "JSON transcript", messageTurnCount: 2, excludedContentTypes: ["uploads", "MUST_NOT_APPEAR", "tools", "uploads"] };
  };
  if (mode !== "missing") {
    context.window.__capCaptureClaudeJson = capture;
    context.window.__capCaptureChatGptJson = capture;
    context.window.__capCaptureNetworkJson = capture;
  }
  return { context, calls, prepared, navigate(pathname) {
    navigationListeners.forEach(listener => listener({ destination: { url: `https://example.test${pathname}` } }));
    location.pathname = pathname;
    location.href = `https://example.test${pathname}`;
  } };
}

const captureKeyFor = platform => platform === "claude" ? "__capCaptureClaudeJson"
  : platform === "chatgpt" ? "__capCaptureChatGptJson" : "__capCaptureNetworkJson";
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test("DOM fallback starts immediately alongside a fresh count and blocks excess before summary or paste", async () => {
  for (const platform of ["claude", "gemini", "grok", "deepseek"]) {
    const { context, calls } = harness(platform);
    const measurement = deferred(), started = deferred(), scrolling = deferred();
    let measurements = 0;
    const key = platform === "claude" ? "__capMeasureClaudeJson" : "__capMeasureNetworkJson";
    context.window[key] = async expectedPath => {
      measurements++;
      assert.equal(expectedPath, platform === "grok" ? context.window.location.href : context.window.location.pathname);
      started.resolve();
      return measurement.promise;
    };
    context.prepareSourceForCapture = async () => {
      calls.prepare++;
      context.startDomCaptureSizeCheck(context.activeTransferTrace);
    };
    context.scrapeConversationTextWhenReady = async () => {
      calls.dom++;
      await scrolling.promise;
      context.checkTransferDeadline(context.activeTransferTrace);
      return "DOM transcript";
    };
    const transfer = context.start("chatgpt");
    await started.promise;
    await new Promise(setImmediate);
    assert.equal(calls.dom, 1, "DOM scrolling must not wait for the fresh count.");
    assert.equal(calls.json, 1, "Size checking must not restart the ordinary capture.");
    measurement.resolve({ characterCount: 4000001 });
    await new Promise(setImmediate);
    scrolling.resolve();
    await transfer;
    assert.equal(measurements, 1);
    assert.equal(calls.flows.length, 0);
    assert.match(calls.errors[0], /4,000,000/);
    assert.equal(calls.finished[0].diagnostics.error_code, "conversation_too_large");
    assert.equal(context.isRunning, false);
  }
});

test("DOM count failures, exact-cap results and late replies never delay or replace DOM capture", async () => {
  for (const scenario of ["failed", "exact cap", "pending", "late excess"]) {
    const { context, calls } = harness("deepseek");
    const measurement = deferred();
    context.window.__capMeasureNetworkJson = () => scenario === "failed" ? Promise.reject(new Error("private"))
      : scenario === "exact cap" ? Promise.resolve({ characterCount: 4000000 }) : measurement.promise;
    context.prepareSourceForCapture = async () => context.startDomCaptureSizeCheck(context.activeTransferTrace);
    await context.start("claude");
    assert.equal(calls.flows.length, 1, scenario);
    assert.equal(calls.flows[0].text, "DOM transcript");
    measurement.resolve({ characterCount: 4000001 });
    await new Promise(setImmediate);
    assert.equal(calls.errors.length, 0, "A late count must not affect a completed DOM capture.");
    assert.equal(calls.flows[0].trace.domSizeCheck.active, false);
  }
});

test("finishing DOM capture aborts its background count and releases the shared JSON queue", async () => {
  for (const platform of ["claude", "chatgpt", "gemini", "grok", "deepseek"]) {
    const { context, calls } = harness(platform, { enabled: false, mode: "success" });
    const probe = deferred();
    let probeSignal;
    const key = platform === "claude" ? "__capMeasureClaudeJson" : platform === "chatgpt" ? "__capMeasureChatGptJson" : "__capMeasureNetworkJson";
    context.window[key] = (_path, signal) => {
      probeSignal = signal;
      signal?.addEventListener("abort", () => probe.resolve({ characterCount: 1 }), { once: true });
      return probe.promise;
    };
    context.prepareSourceForCapture = async () => context.startDomCaptureSizeCheck(context.activeTransferTrace);
    await context.start("claude");
    assert.equal(calls.flows.length, 1);
    assert.equal(probeSignal?.aborted, true, "Completing DOM capture must stop its outstanding size read.");
    context.resetRunningFlag();
    assert.equal((await context.captureSourceJson(context.window.location.pathname)).text, "JSON transcript");
    assert.equal(calls.json, 1, "The next read must not remain behind an abandoned count.");
  }
});

test("picker prefetch waits out the remaining entrance without delaying reduced motion", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const start = source.indexOf("  function scheduleDestinationPickerWarmup()");
  const end = source.indexOf("  function hideDestinationSheet(", start);
  const warmup = new vm.Script(source.slice(start, end));
  for (const animated of [true, false]) {
    const { context, calls } = harness("chatgpt", { mode: "success" });
    let frame, animationTime = 40;
    Object.assign(context, {
      DESTINATION_SHEET_ID: "picker", destinationSheetAnimationFrame: null, destinationSheetWarmupTimer: null,
      destinationSheetPathname: context.window.location.pathname,
      document: { getElementById: () => ({
        getAttribute: () => "false",
        getAnimations: () => animated ? [{ currentTime: animationTime, effect: { getComputedTiming: () => ({ endTime: 160 }) } }] : []
      }) },
      isDestinationSheetOpen: () => true,
      requestAnimationFrame: callback => { frame = callback; return 1; },
      setTimeout, warmDestinationConnections() {}
    });
    warmup.runInContext(context);
    context.scheduleDestinationPickerWarmup(); frame();
    t.mock.timers.tick(0);
    if (animated) {
      t.mock.timers.tick(119);
      assert.equal(context.pickerJsonCapture, null, "snapshotting must not interrupt the entrance");
      assert.equal(calls.json, 0);
      animationTime = 60;
      t.mock.timers.tick(1);
      assert.equal(context.pickerJsonCapture, null, "a delayed animation must be rechecked before capture");
      animationTime = 160;
      t.mock.timers.tick(100);
    } else {
      t.mock.timers.tick(0);
    }
    await context.pickerJsonCapture.promise;
    assert.equal(calls.json, 1);
    assert.equal(calls.destination + calls.dom + calls.flows.length, 0);
  }
});

test("deferred picker warmup cannot capture a dismissed, navigated or selected chat or replace Speed capture", async () => {
  const start = source.indexOf("  function scheduleDestinationPickerWarmup()");
  const end = source.indexOf("  function hideDestinationSheet(", start);
  assert.ok(start >= 0 && end > start);
  const warmup = new vm.Script(source.slice(start, end));
  for (const platform of ["claude", "chatgpt", "gemini", "grok", "deepseek"]) {
    for (const scenario of ["open", "dismissed", "navigated", "selected", "Speed off", "Speed capture"]) {
      const { context, calls } = harness(platform, { mode: "success" });
      let frame, task, hidden = false, preconnects = 0;
      Object.assign(context, {
        DESTINATION_SHEET_ID: "picker", destinationSheetAnimationFrame: null, destinationSheetWarmupTimer: null,
        destinationSheetPathname: context.window.location.pathname,
        document: { getElementById: () => ({ getAttribute: () => hidden ? "true" : "false" }) },
        isDestinationSheetOpen: () => !hidden,
        requestAnimationFrame: callback => { frame = callback; return 1; },
        setTimeout: callback => { task = callback; return 2; },
        warmDestinationConnections: () => { preconnects++; }
      });
      warmup.runInContext(context);
      context.scheduleDestinationPickerWarmup();
      assert.equal(calls.json + preconnects, 0, "the opening frame must not scan or capture history");
      frame();
      assert.equal(calls.json + preconnects, 0, "capture must yield to paint after its frame");
      if (scenario === "dismissed") hidden = true;
      if (scenario === "navigated") context.window.location.href += "?changed";
      if (scenario === "selected") context.isRunning = true;
      if (scenario === "Speed off") {
        context.claudeJsonCaptureEnabled = context.chatGptJsonCaptureEnabled = context.networkJsonCaptureEnabled = false;
      }
      if (scenario === "Speed capture") context.startPickerJsonCapture();
      task();
      await context.pickerJsonCapture?.promise;
      assert.equal(calls.json, ["open", "Speed capture"].includes(scenario) ? 1 : 0, `${platform}: ${scenario}`);
      assert.equal(calls.destination + calls.dom + calls.flows.length, 0, "warmup must never start a transfer");
    }
  }
});

test("picker JSON capture is reused ready or pending on all five platforms, with no transfer before selection", async () => {
  for (const platform of ["claude", "chatgpt", "gemini", "grok", "deepseek"]) {
    for (const ready of [false, true]) {
      const { context, calls } = harness(platform, { mode: "success" });
      const started = deferred(), response = deferred();
      context.window[captureKeyFor(platform)] = path => {
        assert.equal(path, platform === "grok" ? context.window.location.href : context.window.location.pathname);
        calls.json++; started.resolve(); return response.promise;
      };
      context.startPickerJsonCapture();
      await started.promise;
      assert.equal(calls.json, 1);
      assert.equal(calls.destination + calls.dom + calls.prepare + calls.notice + calls.flows.length + calls.errors.length, 0);
      if (ready) { response.resolve({ text: "JSON ready at orb click", messageTurnCount: 2 }); await context.pickerJsonCapture.promise; }
      const transfer = context.start("claude");
      if (!ready) response.resolve({ text: "JSON ready at orb click", messageTurnCount: 2 });
      await transfer;
      assert.equal(calls.json, 1, "selection must await the same native read");
      assert.equal(calls.flows[0].text, "JSON ready at orb click");
      assert.equal(calls.flows.length, 1);
      assert.equal(calls.destination, 1);
      assert.equal(calls.dom + calls.notice, 0);
      assert.equal(context.pickerJsonCapture, null);
    }
  }
});

test("ChatGPT picker timing separates a queued read from selection and native capture", async () => {
  const { context, calls } = harness("chatgpt", { mode: "success" });
  const messages = [], releaseQueue = deferred(), started = deferred(), response = deferred();
  context.window.postMessage = message => messages.push(message);
  context.pendingJsonCapture = releaseQueue.promise;
  context.window.__capCaptureChatGptJson = () => { calls.json++; started.resolve(); return response.promise; };
  context.startPickerJsonCapture();
  const transfer = context.start("claude");
  await new Promise(setImmediate);
  assert.equal(calls.json, 0);
  assert.ok(messages.some(row => row.event === "queued"));
  assert.ok(messages.some(row => row.event === "selection"));
  assert.ok(messages.some(row => row.event === "prefetch_wait" && row.fields.pending));
  assert.equal(messages.some(row => row.event === "dequeued"), false);
  releaseQueue.resolve(); await started.promise;
  assert.equal(messages.filter(row => row.event === "dequeued").length, 1);
  response.resolve({ text: "PRIVATE_CAPTURE_CONTENT", messageTurnCount: 2 });
  await transfer;
  assert.equal(calls.json, 1);
  assert.equal(calls.flows[0].text, "PRIVATE_CAPTURE_CONTENT");
  assert.ok(messages.some(row => row.event === "queue_done" && row.fields.ok));
  assert.ok(messages.some(row => row.event === "prefetch_wait" && !row.fields.pending));
  assert.doesNotMatch(JSON.stringify(messages), /PRIVATE_CAPTURE_CONTENT/);
});

test("ChatGPT destination timing forwards fixed steps without trace details or private error labels", () => {
  const start = source.indexOf("  function markTransferTrace(");
  const end = source.indexOf("  function finishTransferTrace(", start);
  assert.ok(start >= 0 && end > start);
  const events = [];
  const context = vm.createContext({ currentPlatform: { id: "chatgpt" }, getNow: () => 100,
    traceChatGptCapture: (event, fields) => events.push({ event, fields }), updateTransferDiagnostics() {} });
  new vm.Script(source.slice(start, end)).runInContext(context);
  const trace = { startedAt: 1, marks: [] };
  for (const label of ["tab open start", "tab open response", "summary start", "summary done", "tab open done",
    "paste request start", "paste done", "transfer complete", "failed: PRIVATE_UPSTREAM_ERROR"]) {
    context.markTransferTrace(trace, label, { tabId: 999, text: "PRIVATE_CHAT", url: "PRIVATE_URL" });
  }
  assert.deepEqual(events.map(row => row.event), ["destination_start", "destination_reply", "carry_start", "carry_done",
    "destination_ready", "paste_start", "paste_done", "transfer_done"]);
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|999/);
  context.currentPlatform.id = "claude";
  context.markTransferTrace(trace, "tab open start");
  assert.equal(events.length, 8, "only ChatGPT sources emit these local checkpoints");
});

test("picker handoff preserves ready and pending JSON with either motion preference", async () => {
  const hideStart = source.indexOf("  function hideDestinationSheet(");
  const hideEnd = source.indexOf("  function trackDestinationBackdropCutout(", hideStart);
  const transitionStart = source.indexOf("  async function transitionDestinationSheetToHandoff(");
  const transitionEnd = source.indexOf("  function warmDestinationConnections(", transitionStart);
  assert.ok(hideStart >= 0 && hideEnd > hideStart && transitionStart >= 0 && transitionEnd > transitionStart);
  // Use the real dismissal and handoff functions; the normal harness replaces
  // animation and would miss a transition accidentally discarding the capture.
  const transition = new vm.Script(source.slice(hideStart, hideEnd) + source.slice(transitionStart, transitionEnd));
  for (const platform of ["claude", "chatgpt", "gemini", "grok", "deepseek"]) {
    for (const reducedMotion of [false, true]) {
      for (const ready of [false, true]) {
        const { context, calls } = harness(platform, { mode: "success" });
        Object.assign(context, {
          document: { getElementById: () => null }, clearTimeout() {}, delay: async () => {},
          DESTINATION_SHEET_ID: "picker", DESTINATION_SHEET_BACKDROP_ID: "backdrop", BUBBLE_ID: "orb",
          DESTINATION_TRANSFER_PRESS_MS: 0, DESTINATION_HANDOFF_OVERLAP_MS: 0,
          destinationSheetHideTimer: null, destinationSheetWarmupTimer: null, destinationSheetPathname: null, pendingHandoffOrigin: null,
          inlineBubble: null, claudeInlineMount: null, chatGptInlineMount: null, providerInlineMount: null
        });
        context.window.matchMedia = () => ({ matches: reducedMotion });
        transition.runInContext(context);
        const started = deferred(), response = deferred();
        context.window[captureKeyFor(platform)] = () => { calls.json++; started.resolve(); return response.promise; };
        context.startPickerJsonCapture(); await started.promise;
        if (ready) { response.resolve({ text: "Orb snapshot", messageTurnCount: 2 }); await context.pickerJsonCapture.promise; }
        const transfer = context.start("claude");
        response.resolve({ text: "Orb snapshot", messageTurnCount: 2 });
        await transfer;
        assert.equal(calls.json, 1, `${platform}, reduced motion ${reducedMotion}, ready ${ready}: handoff must reuse capture`);
        assert.equal(calls.flows[0].text, "Orb snapshot");
        assert.equal(calls.dom + calls.notice + calls.errors.length, 0);
        assert.equal(context.pickerJsonCapture, null);
      }
    }
  }
});

test("changed history or away-and-back navigation discards a completed picker snapshot", async () => {
  for (const change of ["reply", "turn identity", "branch", "navigation"]) {
    const { context, calls, navigate } = harness("grok", { mode: "success" });
    let history = "Old reply";
    let sourceId = "original-turn";
    context.getConversationTurns = () => [{ sourceId, role: "assistant", text: history }];
    context.window.__capCaptureNetworkJson = async () => ({ text: `Read ${++calls.json}: ${history}`, messageTurnCount: 2 });
    context.startPickerJsonCapture(); await context.pickerJsonCapture.promise;
    if (change === "reply") history = "New reply";
    else if (change === "turn identity") sourceId = "regenerated-turn";
    else if (change === "branch") context.window.location.href += "?rid=other";
    else { navigate("/c/other"); navigate("/c/source"); }
    await context.start("claude");
    assert.equal(calls.json, 2);
    assert.equal(calls.flows[0].text, `Read 2: ${history}`);
    assert.equal(calls.notice, 0);
  }
});

test("history changing during a pending picker read triggers one fresh capture", async () => {
  const { context, calls } = harness("chatgpt", { mode: "success" });
  let history = "Old reply";
  context.getConversationTurns = () => [{ role: "assistant", text: history }];
  const started = deferred(), response = deferred();
  context.window.__capCaptureChatGptJson = (_path, _unused, onProgress) => {
    calls.json++;
    onProgress?.({ mode: "fresh", outcome: "started", step: "read", step_stage: "history" });
    if (calls.json === 1) { started.resolve(); return response.promise; }
    return Promise.resolve({ text: history, messageTurnCount: 2 });
  };
  context.startPickerJsonCapture(); await started.promise;
  const transfer = context.start("claude");
  await Promise.resolve(); await Promise.resolve();
  history = "New reply";
  response.resolve({ text: "Old reply", messageTurnCount: 2 });
  await transfer;
  assert.equal(calls.json, 2);
  assert.equal(calls.flows[0].text, "New reply");
  assert.equal(calls.notice, 0);
  assert.deepEqual(Array.from(calls.flows[0].trace.diagnostics.json_attempts, attempt => attempt.mode), ["fresh"],
    "Discarded picker progress cannot occupy one of the two accepted read slots.");
});

test("closed picker results are discarded and reopening never overlaps native reads", async () => {
  const { context, calls } = harness("claude", { mode: "success" });
  const started = deferred(), response = deferred();
  context.window.__capCaptureClaudeJson = () => {
    calls.json++;
    if (calls.json === 1) { started.resolve(); return response.promise; }
    return Promise.resolve({ text: "Fresh reopened picker", messageTurnCount: 2 });
  };
  context.startPickerJsonCapture(); await started.promise;
  context.clearPickerJsonCapture();
  context.startPickerJsonCapture();
  await Promise.resolve();
  assert.equal(calls.json, 1);
  response.resolve({ text: "Discarded closed picker", messageTurnCount: 2 });
  await context.pickerJsonCapture.promise;
  await context.start("claude");
  assert.equal(calls.json, 2);
  assert.equal(calls.flows[0].text, "Fresh reopened picker");
});

test("ChatGPT closing and reopening cancels the abandoned read before its replacement starts", async () => {
  const { context, calls } = harness("chatgpt", { mode: "success" });
  const started = deferred(), cancelled = deferred(), cleanup = deferred();
  let firstSignal;
  context.window.__capCaptureChatGptJson = async (_path, signal) => {
    calls.json++;
    if (calls.json !== 1) return { text: "Fresh reopened chat", messageTurnCount: 2 };
    firstSignal = signal;
    started.resolve();
    await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
    cancelled.resolve();
    await cleanup.promise; // Model MAIN acknowledging native-reader cleanup.
    throw new Error("Cancelled old capture");
  };
  context.startPickerJsonCapture(); await started.promise;
  context.clearPickerJsonCapture();
  assert.equal(firstSignal.aborted, true);
  context.startPickerJsonCapture();
  const replacement = context.pickerJsonCapture;
  await cancelled.promise;
  await new Promise(setImmediate);
  assert.equal(calls.json, 1, "Do not race a new request against the cancelling native reader.");
  cleanup.resolve();
  await replacement.promise;
  assert.equal(calls.json, 2, "Acknowledged cancellation must release the queue.");
  await context.start("claude");
  assert.equal(calls.flows[0].text, "Fresh reopened chat");
  assert.equal(calls.errors.length + calls.dom, 0);
});

test("ChatGPT queued picker cancellation skips its download and selection retains its pending read", async () => {
  for (const scenario of ["closed before start", "selected"]) {
    const { context, calls } = harness("chatgpt", { mode: "success" });
    const queued = deferred(), response = deferred(), started = deferred();
    let signal;
    context.pendingJsonCapture = queued.promise;
    context.window.__capCaptureChatGptJson = (_path, currentSignal) => {
      calls.json++; signal = currentSignal; started.resolve(); return response.promise;
    };
    context.startPickerJsonCapture();
    const entry = context.pickerJsonCapture, settled = entry.promise;
    if (scenario === "closed before start") {
      context.clearPickerJsonCapture(); queued.resolve();
      await settled;
      assert.equal(calls.json, 0, "A closed queued picker must never start a native download.");
    } else {
      const transfer = context.start("claude"); queued.resolve(); await started.promise;
      assert.equal(signal.aborted, false, "Selecting a destination must keep the owning read alive.");
      // Selection now yields through the picker-to-handoff transition before
      // claiming the queued snapshot. Dismissing that old picker is safe once
      // the transfer has taken ownership, not while the transition is pending.
      await new Promise(setImmediate);
      assert.equal(calls.handoff, 1, "Pending JSON must already be shown in the handoff.");
      assert.equal(context.pickerJsonCapture, null, "The transfer must own the selected read.");
      assert.equal(calls.flows.length, 0, "The pending read must not dispatch a transfer.");
      context.clearPickerJsonCapture();
      assert.equal(signal.aborted, false, "Picker cleanup after selection cannot cancel the transfer's read.");
      response.resolve({ text: "Selected pending chat", messageTurnCount: 2 }); await transfer;
      assert.equal(calls.json, 1);
      assert.equal(calls.flows[0].text, "Selected pending chat");
    }
  }
});

test("closing the picker immediately releases its snapshot and drops late results", async () => {
  for (const ready of [false, true]) {
    const { context, calls } = harness("chatgpt", { mode: "success" });
    const started = deferred(), response = deferred();
    context.window.__capCaptureChatGptJson = () => { calls.json++; started.resolve(); return response.promise; };
    context.startPickerJsonCapture(); await started.promise;
    const entry = context.pickerJsonCapture, pending = entry.promise;
    if (ready) { response.resolve({ text: "Discard this captured text", messageTurnCount: 2 }); await pending; }
    context.clearPickerJsonCapture();
    assert.equal(context.pickerJsonCapture, null);
    assert.equal(entry.promise, null);
    assert.equal(entry.state, null);
    if (!ready) {
      response.resolve({ text: "Discard this late text", messageTurnCount: 2 });
      assert.equal((await pending).capture, undefined);
    }
    assert.equal(calls.flows.length + calls.errors.length, 0);
  }
});

test("cancelling during destination preparation immediately releases the picker capture and its navigation timer", async () => {
  const start = source.indexOf("  function finishTransferTrace(");
  const end = source.indexOf("  function formatTraceDetail(", start);
  assert.ok(start >= 0 && end > start);
  const finish = new vm.Script(source.slice(start, end));
  for (const ready of [false, true]) {
    const { context, calls } = harness("chatgpt", { mode: "success" });
    const timers = new Set(); let nextId = 0;
    context.setInterval = () => { const id = ++nextId; timers.add(id); return id; };
    context.clearInterval = id => timers.delete(id);
    context.createTransferTrace = () => ({ id: "cancelled-handoff", marks: [], startedAt: Date.now() });
    context.persistLatestTransferStats = () => {};
    context.finishTransferTelemetry = () => {};
    finish.runInContext(context);
    const started = deferred(), response = deferred();
    context.window.__capCaptureChatGptJson = () => { calls.json++; started.resolve(); return response.promise; };
    context.startPickerJsonCapture(); await started.promise;
    const entry = context.pickerJsonCapture, pending = entry.promise;
    if (ready) { response.resolve({ text: "Cancelled snapshot", messageTurnCount: 2 }); await pending; }
    context.prepareDestinationTab = async () => {
      context.cancelSourceTransfer(context.activeTransferTrace.id);
      assert.equal(context.pickerJsonCapture, null);
      assert.equal(timers.size, 0);
      return { tabId: 42 };
    };
    await context.start("claude");
    assert.equal(entry.promise, null);
    assert.equal(entry.state, null);
    response.resolve({ text: "Cancelled late snapshot", messageTurnCount: 2 });
    if (!ready) assert.equal((await pending).capture, undefined);
    assert.equal(calls.flows.length + calls.dom, 0);
  }
});

test("navigation during a selected pending prefetch cancels without another native read or DOM fallback", async () => {
  const { context, calls, navigate } = harness("chatgpt", { mode: "success" });
  const started = deferred(), response = deferred();
  context.window.__capCaptureChatGptJson = () => { calls.json++; started.resolve(); return response.promise; };
  context.startPickerJsonCapture(); await started.promise;
  const transfer = context.start("claude");
  await Promise.resolve(); await Promise.resolve();
  navigate("/c/other"); navigate("/c/source");
  response.resolve({ text: "Old pending capture", messageTurnCount: 2 });
  await transfer;
  assert.equal(calls.json, 1);
  assert.equal(calls.flows.length + calls.dom + calls.notice, 0);
  assert.match(calls.errors[0], /conversation changed during capture/);
});

test("non-retryable picker failures stay silent until selection and honor each platform's recovery", async () => {
  for (const platform of ["chatgpt", "claude"]) {
    const { context, calls } = harness(platform);
    context.startPickerJsonCapture(); await context.pickerJsonCapture.promise;
    assert.equal(calls.json, 1);
    assert.equal(calls.notice + calls.dom + calls.prepare + calls.flows.length + calls.errors.length, 0);
    await context.start("claude");
    assert.equal(calls.json, 1, "selection must not retry an unclassified prefetch failure");
    if (platform === "chatgpt") {
      assert.equal(calls.notice + calls.dom + calls.prepare + calls.flows.length, 0);
      assert.equal(calls.errors.length, 1);
      assert.equal(context.isRunning, false);
    } else {
      assert.equal(calls.notice, 1);
      assert.equal(calls.dom, 1);
      assert.equal(calls.flows[0].text, "DOM transcript");
    }
  }
});

const transientError = (reason = "request_failed", detail = "network_error", status) => Object.assign(new Error("Private response MUST_NOT_APPEAR"), {
  captureFailureReason: reason,
  diagnostics: { version: 1, capture_detail: detail, capture_request_stage: "history", failure_site: "capture_history",
    ...(status === undefined ? {} : { capture_http_status: status }) }
});

test("fresh and prefetched JSON failures save native evidence even when their wrapper says unknown_error", async () => {
  for (const prefetched of [false, true]) for (const check of ["invalid_utf8", "unknown"]) {
    const stage = check === "unknown" ? "serialize" : "attachment_body";
    const { context, calls } = harness("chatgpt");
    context.window.__capCaptureChatGptJson = async () => {
      calls.json++;
      throw Object.assign(new Error("MUST_NOT_APPEAR chat https://PRIVATE filename.csv"), {
        diagnosticCode: "unknown_error", diagnostics: { version: 1, error_code: "unknown_error", capture_detail: "network_error", capture_request_stage: "history" },
        jsonCapture: { outcome: "failed", mode: "fresh", failure_check: check, failure_stage: stage, failure_error_type: "TypeError" }
      });
    };
    if (prefetched) { context.startPickerJsonCapture(); await context.pickerJsonCapture.promise; }
    await context.start("claude");
    assert.equal(calls.json, 1, "Richer reporting must not change retry decisions.");
    assert.equal(calls.finished.length, 1);
    const details = calls.finished[0].diagnostics;
    assert.equal(details.error_code, "capture_json_failed");
    assert.equal(details.capture_error_code, "capture_json_failed");
    assert.equal(details.capture_detail, check === "unknown" ? undefined : check);
    assert.equal(details.capture_request_stage, stage);
    assert.equal(details.failure_site, `capture_${stage}`);
    assert.equal(details.capture_failure_site, `capture_${stage}`);
    assert.equal(details.capture_error_type, "TypeError");
    assert.equal(details.json_attempts[0].failure_check, check);
    assert.doesNotMatch(JSON.stringify(details), /MUST_NOT_APPEAR|PRIVATE|filename|https/);
  }
});

test("only DeepSeek -> ChatGPT retries an oversized picker file as a separate-upload note", async () => {
  for (const destination of ["chatgpt", "claude"]) {
    const { context, calls } = harness("deepseek", { mode: "success" });
    const options = [], omittedFiles = [{ name: "original.txt", bytes: 13099028 }], skippedFiles = [{ name: "unreadable.txt" }];
    context.window.__capCaptureNetworkJson = async (_path, omitLargeFiles) => {
      calls.json++; options.push(Boolean(omitLargeFiles));
      if (!omitLargeFiles) throw Object.assign(transientError("size_limit", "attachment_size_limit"), {
        jsonCapture: { outcome: "failed", failure_check: "supported_files_limit", files_supported: 1 } });
      return { text: "Complete chat with separate-file notice", messageTurnCount: 2, omittedFiles, skippedFiles,
        jsonCapture: { outcome: "partial", files_supported: 1 } };
    };
    context.startPickerJsonCapture(); await context.pickerJsonCapture.promise;
    await context.start(destination);
    assert.deepEqual(options, destination === "chatgpt" ? [false, true] : [false]);
    assert.equal(calls.dom, 0);
    assert.equal(calls.flows.length, destination === "chatgpt" ? 1 : 0);
    if (calls.flows.length) {
      assert.equal(calls.flows[0].trace.omittedFiles, omittedFiles);
      assert.equal(calls.flows[0].trace.skippedFiles, skippedFiles);
      assert.equal(calls.flows[0].trace.diagnostics.json_attempts.length, 2);
    }
  }
});

test("a failed separate-file capture cannot silently deliver a smaller DOM subset", async () => {
  const { context, calls } = harness("deepseek");
  context.window.__capCaptureNetworkJson = async () => {
    calls.json++;
    throw Object.assign(transientError(), { jsonCapture: { outcome: "failed", failure_check: "network_error",
      files_supported: 2, files_declared_bytes: 13099028 } });
  };
  await context.start("chatgpt");
  assert.equal(calls.json, 2);
  assert.equal(calls.dom + calls.flows.length, 0);
  assert.equal(calls.errors.length, 1);
});

test("DeepSeek attachment decoding keeps its single retry, DOM fallback and precise failure diagnosis", async () => {
  const { context, calls } = harness("deepseek");
  context.window.__capCaptureNetworkJson = async () => {
    calls.json++;
    const error = transientError("request_failed", "invalid_utf8", 200);
    error.diagnostics.capture_request_stage = "attachment_body";
    error.diagnostics.failure_site = "capture_attachment_body";
    error.jsonCapture = { outcome: "failed", failure_check: "invalid_utf8", failure_stage: "attachment_body",
      failure_file_extension: "csv", failure_response_charset: "missing", failure_body_hint: "unrecognized", failure_decode_stage: "chunk" };
    throw error;
  };
  await context.start("gemini");
  assert.equal(calls.json, 2);
  assert.equal(calls.dom, 1);
  assert.equal(calls.flows.length, 1);
  const diagnostics = calls.flows[0].trace.diagnostics;
  assert.equal(diagnostics.capture_detail, "invalid_utf8");
  assert.deepEqual(Array.from(diagnostics.json_attempts, value => [value.mode, value.failure_check]),
    [["fresh", "invalid_utf8"], ["retry", "invalid_utf8"]]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /MUST_NOT_APPEAR/);
});

test("JSON attempt observations survive source-to-destination handoff and one retry", async () => {
  const platforms = ["chatgpt", "claude", "gemini", "grok", "deepseek"];
  for (const source of platforms) for (const destination of platforms.filter(value => value !== source)) {
    const { context, calls } = harness(source, { mode: "success" });
    const read = context.window[captureKeyFor(source)];
    context.window[captureKeyFor(source)] = async () => ({ ...await read(), jsonCapture: { outcome: "succeeded", mode: "fresh", raw_bytes: 1234, raw_limit_bytes: 32000000 } });
    await context.start(destination);
    assert.equal(calls.flows[0].trace.diagnostics.json_attempts[0].raw_bytes, 1234);
    assert.equal(calls.flows[0].trace.diagnostics.json_attempts[0].outcome, "succeeded");
  }
  const { context, calls } = harness("deepseek", { mode: "success" });
  const read = context.window.__capCaptureNetworkJson;
  let count = 0;
  context.window.__capCaptureNetworkJson = async () => {
    if (!count++) throw Object.assign(transientError(), { jsonCapture: { outcome: "failed", mode: "fresh", failure_check: "network_error", raw_bytes: 100 } });
    return { ...await read(), jsonCapture: { outcome: "succeeded", mode: "fresh", raw_bytes: 200 } };
  };
  context.startPickerJsonCapture(); await context.pickerJsonCapture.promise;
  await context.start("claude");
  const attempts = calls.flows[0].trace.diagnostics.json_attempts;
  assert.deepEqual(JSON.parse(JSON.stringify(attempts)).map(value => [value.mode, value.outcome, value.raw_bytes]),
    [["prefetch", "failed", 100], ["retry", "succeeded", 200]]);
});

test("a prefetched JSON failure retains its page flags from failure time through successful retry", async () => {
  const { context, calls } = harness("deepseek", { mode: "success" });
  const key = captureKeyFor("deepseek"), capture = context.window[key];
  let state = { source_loading: true, source_auth_prompt: true, source_error_prompt: false, source_challenge_prompt: true };
  context.observeSourcePageState = () => ({ ...state });
  context.window[key] = async () => {
    if (!calls.json) { calls.json++; throw transientError(); }
    return capture();
  };
  context.startPickerJsonCapture();
  await context.pickerJsonCapture.promise;
  const failedState = state;
  state = { source_loading: false, source_auth_prompt: false, source_error_prompt: true, source_challenge_prompt: false };
  await context.start("claude");
  const attempts = calls.flows[0].trace.diagnostics.json_attempts;
  for (const [key, value] of Object.entries(failedState)) assert.equal(attempts[0][key], value);
  assert.equal(attempts[0].mode, "prefetch");
  assert.equal(attempts[1].outcome, "succeeded");
  assert.equal(attempts[1].source_loading, undefined, "Successful retry must not inherit failed-read flags.");
});

test("size failures stop all five platforms without partial DOM transfer, including active replies and cached errors", async () => {
  const cases = [
    ["deepseek", true, transientError("size_limit", "size_limit")],
    ["gemini", false, transientError("size_limit", "size_limit")],
    ["grok", true, transientError("incomplete", "size_limit")],
    ["claude", false, Object.assign(transientError(), { code: "conversation_too_large" })],
    ["chatgpt", false, Object.assign(transientError(), { diagnosticCode: "conversation_too_large" })],
    ["chatgpt", true, transientError("incomplete", "partial_response")]
  ];
  for (const [platform, prefetched, error] of cases) {
    const transcriptLimit = platform === "deepseek";
    error.jsonCapture = { outcome: "failed", mode: "fresh",
      failure_check: transcriptLimit ? "transcript_char_limit" : "raw_total_stream_limit",
      failure_value: transcriptLimit ? 4003622 : 32000001, failure_limit: transcriptLimit ? 4000000 : 32000000 };
    const { context, calls } = harness(platform);
    context.isSourceReplyInProgress = () => ["grok", "chatgpt"].includes(platform);
    context.window[captureKeyFor(platform)] = async () => { calls.json++; throw error; };
    if (prefetched) {
      context.startPickerJsonCapture(); await context.pickerJsonCapture.promise;
      assert.equal(calls.errors.length, 0, "Keep picker errors silent until selection.");
    }
    await context.start("claude");
    assert.equal(calls.json, 1);
    assert.equal(calls.prepare + calls.dom + calls.notice + calls.flows.length, 0, "Never substitute the smaller visible history for rejected full content.");
    assert.equal(calls.destination, 1);
    assert.equal(calls.errors.length, 1);
    assert.match(calls.errors[0], transcriptLimit ? /too large.*limit is 4,000,000 characters/ : /too large.*limit is 32,000,000 bytes/);
    assert.doesNotMatch(calls.errors[0], /4,003,622|32,000,001/);
    assert.equal(context.isRunning, false);
    const diagnostics = calls.finished[0].diagnostics;
    assert.equal(diagnostics.error_code, "conversation_too_large");
    assert.equal(diagnostics.capture_detail, "size_limit", "The recorded size guard is more precise than the generic wrapper.");
    assert.equal(diagnostics.json_fallback_code, undefined);
    assert.equal(diagnostics.json_attempts[0].failure_check, error.jsonCapture.failure_check);
    assert.equal(diagnostics.json_attempts[0].failure_value, error.jsonCapture.failure_value);
    assert.doesNotMatch(JSON.stringify(diagnostics) + calls.errors[0], /MUST_NOT_APPEAR/);
  }
});

test("attachment and transcript byte rejections show their own numeric limits", async () => {
  for (const [check, detail, limit] of [["supported_files_limit", "attachment_size_limit", 4100000], ["transcript_byte_limit", "size_limit", 16000000]]) {
    const { context, calls } = harness("deepseek");
    const error = transientError("size_limit", detail);
    error.jsonCapture = { outcome: "failed", failure_check: check, failure_value: limit + 1, failure_limit: limit };
    context.window.__capCaptureNetworkJson = async () => { throw error; };
    await context.start("claude");
    assert.equal(calls.errors.length, 1);
    assert.match(calls.errors[0], new RegExp(`limit is ${limit.toLocaleString("en-US")} bytes`));
    assert.ok(!calls.errors[0].includes((limit + 1).toLocaleString("en-US")));
    assert.equal(calls.dom + calls.flows.length, 0);
  }
});

async function recoverJsonOnce(platform, error, prefetched = false) {
  const { context, calls } = harness(platform, { mode: "success" });
  const key = captureKeyFor(platform), capture = context.window[key];
  context.window[key] = async () => {
    if (!calls.json) { calls.json++; throw error; }
    return capture();
  };
  if (prefetched) {
    context.startPickerJsonCapture(); await context.pickerJsonCapture.promise;
    assert.equal(calls.json, 1, "The open picker must not retry on its own.");
    assert.equal(calls.errors.length + calls.notice + calls.destination, 0);
  }
  await context.start("claude");
  assert.equal(calls.json, 2);
  assert.equal(calls.dom + calls.prepare + calls.notice + calls.errors.length, 0);
  assert.equal(calls.destination, 1);
  assert.equal(calls.flows.length, 1);
  assert.equal(calls.flows[0].text, "JSON transcript");
  const diagnostics = calls.flows[0].trace.diagnostics;
  assert.equal(diagnostics.capture_detail, error.diagnostics.capture_detail);
  assert.equal(diagnostics.error_code || diagnostics.json_fallback_code || diagnostics.failure_site, undefined);
  assert.doesNotMatch(JSON.stringify(calls.traceDetails), /MUST_NOT_APPEAR/);
}

test("all five platforms recover a failed picker prefetch silently with one JSON retry", async () => {
  for (const platform of ["chatgpt", "claude", "gemini", "grok", "deepseek"]) {
    await recoverJsonOnce(platform, transientError(), true);
  }
});

clockTest("ChatGPT retries temporary JSON errors immediately with no cooldown", async () => {
  for (const prefetched of [false, true]) {
    for (const error of [transientError(), transientError("timeout", "timeout"),
      transientError("unavailable", "hook_unavailable"), transientError("incomplete", "attachment_failed", 429)]) {
      const { context, calls } = harness("chatgpt", { mode: "success" });
      const requestedAt = [];
      context.delay = ms => { calls.waits.push(ms); return new Promise(resolve => setTimeout(resolve, ms)); };
      context.window.__capCaptureChatGptJson = async () => {
        requestedAt.push(Date.now());
        if (++calls.json === 1) throw error;
        return { text: "Immediately recovered chat", messageTurnCount: 2 };
      };
      if (prefetched) { context.startPickerJsonCapture(); await context.pickerJsonCapture.promise; }
      const selectedAt = Date.now();
      await context.start("claude");
      assert.equal(calls.json, 2, "Keep exactly one retry.");
      assert.equal(requestedAt[1], selectedAt, "The queued retry must start without a timer delay.");
      assert.deepEqual(calls.waits, []);
      assert.equal(calls.destination, 1);
      assert.equal(calls.dom + calls.notice + calls.errors.length, 0);
      assert.equal(calls.flows[0].text, "Immediately recovered chat");
    }
  }
});

clockTest("other platforms retain the existing cooldown before retrying JSON", async () => {
  const { context, calls } = harness("deepseek", { mode: "success" });
  const capture = context.window.__capCaptureNetworkJson;
  const requestedAt = [];
  context.delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  context.window.__capCaptureNetworkJson = async () => {
    requestedAt.push(Date.now());
    if (!calls.json) { calls.json++; throw transientError("incomplete", "attachment_failed", 429); }
    return capture();
  };
  await context.start("claude");
  assert.equal(requestedAt.length, 2);
  assert.ok(requestedAt[1] - requestedAt[0] >= 2000, "the provider needs a real cooldown before another native read");
  assert.equal(calls.dom, 0);
});

test("all five platforms scrape after one 429 retry with their own timing, without a third native size probe", async () => {
  for (const platform of ["claude", "chatgpt", "gemini", "grok", "deepseek"]) {
    const { context, calls } = harness(platform);
    let probes = 0;
    context.window[captureKeyFor(platform)] = async () => { calls.json++; throw transientError("incomplete", "attachment_failed", 429); };
    const measurementKey = platform === "claude" ? "__capMeasureClaudeJson" : platform === "chatgpt" ? "__capMeasureChatGptJson" : "__capMeasureNetworkJson";
    context.window[measurementKey] = async () => { probes++; return { characterCount: 10 }; };
    context.prepareSourceForCapture = async () => { calls.prepare++; context.startDomCaptureSizeCheck(context.activeTransferTrace); };
    await context.start("claude");
    assert.equal(calls.json, 2);
    assert.deepEqual(calls.waits, platform === "chatgpt" ? [] : [2000]);
    assert.equal(calls.dom, 1);
    assert.equal(probes, 0, "an exhausted provider must not immediately receive another background JSON request");
    assert.equal(calls.destination, 1);
    assert.equal(calls.flows[0].text, "DOM transcript");
  }
});

test("navigation or cancellation during retry cooldown never starts another native read", async () => {
  for (const stop of ["navigation", "cancelled", "expired"]) {
    const { context, calls, navigate } = harness("deepseek");
    const waiting = deferred(), release = deferred();
    context.window.__capCaptureNetworkJson = async () => { calls.json++; throw transientError(); };
    context.delay = async () => { waiting.resolve(); await release.promise; };
    const transfer = context.start("claude");
    await waiting.promise;
    if (stop === "navigation") { navigate("/a/chat/s/other"); navigate("/a/chat/s/source"); }
    else context.activeTransferTrace[stop] = true;
    release.resolve();
    await transfer;
    assert.equal(calls.json, 1);
    assert.equal(calls.dom + calls.flows.length, 0);
  }
});

test("temporary failure categories get one fresh JSON retry", async () => {
  // Classification is shared; test each category once rather than multiplying
  // it by every platform and prefetch mode. Platform wiring is covered above.
  const errors = [transientError(), transientError("timeout", "timeout"), transientError("incomplete", "attachment_failed", 503),
    ...["busy", "hook_unavailable", "auth_missing", "routing_unavailable"].map(detail => transientError("unavailable", detail)),
    ...[408, 429, 500, 502, 503, 504, 529].map(status => transientError("request_failed", "http_error", status))];
  for (const error of errors) await recoverJsonOnce("chatgpt", error);
});

test("hard and unknown failures are not retried, including a cached Claude size failure", async () => {
  const errors = [transientError("size_limit", "size_limit"), transientError("incomplete", "size_limit"),
    transientError("incomplete", "incomplete_history"), transientError("unsupported", "unsupported_content"),
    transientError("request_failed", "invalid_json"), transientError("incomplete", "partial_response", 206),
    transientError("request_failed", "network_error", 413), transientError("request_failed", "other"),
    ...[400, 401, 403, 404, 501, 505].map(status => transientError("request_failed", "http_error", status)),
    Object.assign(transientError("timeout", "timeout"), { diagnosticCode: "conversation_too_large" })];
  const cases = errors.map(error => ["chatgpt", false, error]);
  cases.push(["claude", true, transientError("incomplete", "size_limit")]);
  for (const [platform, prefetched, error] of cases) {
    const { context, calls } = harness(platform);
    context.window[captureKeyFor(platform)] = async () => { calls.json++; throw error; };
    if (prefetched) { context.startPickerJsonCapture(); await context.pickerJsonCapture.promise; }
    await context.start("claude");
    assert.equal(calls.json, 1);
    assert.equal(calls.dom, 0);
    assert.equal(calls.errors.length, 1);
  }
});

test("a failed JSON retry stops or falls back once, retaining its final cause", async () => {
  for (const [platform, prefetched, secondHard] of [
    ["chatgpt", false, false], ["chatgpt", true, true], ["claude", true, false], ["claude", false, true], ["deepseek", true, true]
  ]) {
    const { context, calls } = harness(platform);
    context.window[captureKeyFor(platform)] = async () => {
      calls.json++;
      throw secondHard && calls.json === 2 ? transientError("size_limit", "size_limit") : transientError();
    };
    if (prefetched) { context.startPickerJsonCapture(); await context.pickerJsonCapture.promise; }
    await context.start("claude");
    assert.equal(calls.json, 2, "Never loop or retry a failed retry.");
    assert.equal(calls.destination, 1);
    const stops = secondHard;
    assert.equal(calls.dom, stops ? 0 : 1);
    assert.equal(calls.errors.length, stops ? 1 : 0);
    assert.equal(calls.flows.length, stops ? 0 : 1);
    if (!stops) assert.equal(calls.flows[0].trace.diagnostics.json_fallback_code, "request_failed");
    assert.equal(calls.notice, stops ? 0 : 1);
  }
});

test("a pending prefetch that fails after selection gets one fresh JSON read", async () => {
  const { context, calls } = harness("chatgpt", { mode: "success" });
  const started = deferred(), response = deferred();
  context.window.__capCaptureChatGptJson = async () => {
    calls.json++;
    if (calls.json === 1) { started.resolve(); await response.promise; throw transientError(); }
    return { text: "Recovered JSON", messageTurnCount: 2 };
  };
  context.startPickerJsonCapture(); await started.promise;
  const transfer = context.start("claude");
  response.resolve();
  await transfer;
  assert.equal(calls.json, 2);
  assert.equal(calls.flows[0].text, "Recovered JSON");
  assert.equal(calls.errors.length + calls.dom + calls.notice, 0);
});

test("changing chats while the JSON retry is pending never transfers its returned text", async () => {
  const { context, calls, navigate } = harness("chatgpt");
  const retryStarted = deferred(), response = deferred();
  context.window.__capCaptureChatGptJson = async () => {
    calls.json++;
    if (calls.json === 1) throw transientError();
    retryStarted.resolve();
    return response.promise;
  };
  const transfer = context.start("claude");
  await retryStarted.promise;
  navigate("/c/other"); navigate("/c/source");
  response.resolve({ text: "WRONG_CHAT_SENTINEL", messageTurnCount: 2 });
  await transfer;
  assert.equal(calls.json, 2);
  assert.equal(calls.flows.length + calls.captureMetrics.length + calls.dom + calls.notice, 0);
  assert.match(calls.errors[0], /conversation changed during capture/);
  assert.equal(context.isRunning, false);
});

test("a new user attempt gets its own JSON retry after both previous reads failed", async () => {
  const { context, calls } = harness("chatgpt", { mode: "success" });
  const flow = context.runContextFlow;
  context.runContextFlow = (...args) => { flow(...args); context.isRunning = false; };
  const capture = context.window.__capCaptureChatGptJson;
  context.window.__capCaptureChatGptJson = async () => {
    if (calls.json < 3) { calls.json++; throw transientError(); }
    return capture();
  };
  await context.start("claude");
  assert.equal(calls.json, 2);
  assert.equal(calls.errors.length, 0);
  assert.equal(calls.flows.length, 1);
  assert.equal(calls.flows[0].text, "DOM transcript");
  assert.equal(context.isRunning, false);
  await context.start("claude");
  assert.equal(calls.json, 4);
  assert.equal(calls.errors.length, 0, "The recovered second attempt must add no frontend error.");
  assert.equal(calls.flows.length, 2);
  assert.equal(calls.flows[1].text, "JSON transcript");
  assert.equal(calls.destination, 2, "One destination per user-selected attempt.");
  assert.equal(calls.dom + calls.notice, 2, "Only the first attempt needs page capture.");
});

test("navigation, cancellation or deadline expiry prevents a transient JSON retry", async () => {
  for (const stop of ["navigation", "cancelled", "expired"]) {
    const { context, calls, navigate } = harness("chatgpt");
    context.window.__capCaptureChatGptJson = async () => {
      calls.json++;
      if (stop === "navigation") { navigate("/c/other"); navigate("/c/source"); }
      else context.activeTransferTrace[stop] = true;
      throw transientError();
    };
    await context.start("claude");
    assert.equal(calls.json, 1);
    assert.equal(calls.flows.length + calls.dom + calls.notice, 0);
    assert.equal(calls.traces.includes("retrying JSON capture"), false);
  }
});

test("a queued JSON retry stays bound to its cancelled attempt after globals reset", async () => {
  const { context, calls } = harness("chatgpt");
  const blocked = deferred();
  context.window.__capCaptureChatGptJson = async () => { calls.json++; throw transientError(); };
  const mark = context.markTransferTrace;
  context.markTransferTrace = (trace, label, detail) => {
    mark(trace, label, detail);
    if (label === "retrying JSON capture") {
      context.pendingJsonCapture = blocked.promise;
      trace.cancelled = true;
      context.activeTransferTrace = null;
      context.isRunning = false;
      blocked.resolve();
    }
  };
  await context.start("claude");
  assert.equal(calls.json, 1);
  assert.equal(calls.flows.length + calls.dom + calls.notice, 0);
  assert.equal(calls.errors.length, 0, "Cancelled work must stay silent after the next attempt starts.");
});

test("cancelling a selected queued prefetch prevents its native read even after the running flag resets", async () => {
  const { context, calls } = harness("chatgpt", { mode: "success" });
  const started = deferred(), response = deferred();
  context.window.__capCaptureChatGptJson = () => { calls.json++; started.resolve(); return response.promise; };
  context.startPickerJsonCapture(); await started.promise;
  context.clearPickerJsonCapture(); context.startPickerJsonCapture();
  const transfer = context.start("claude");
  await Promise.resolve(); await Promise.resolve();
  context.activeTransferTrace.cancelled = true;
  context.activeTransferTrace = null;
  context.isRunning = false;
  response.resolve({ text: "Discarded first picker", messageTurnCount: 2 });
  await transfer;
  assert.equal(calls.json, 1);
  assert.equal(calls.flows.length + calls.dom + calls.notice, 0);
  assert.equal(calls.errors.length, 0, "Cancelled prefetch must not reopen an error overlay.");
});

test("Speed off, unsaved chats and teardown skip or discard picker capture", async () => {
  for (const skip of ["speed", "unsaved", "teardown"]) {
    const { context, calls } = harness("chatgpt", { mode: "success" });
    if (skip === "speed") context.chatGptJsonCaptureEnabled = false;
    if (skip === "unsaved") context.window.location.pathname = "/";
    if (skip === "teardown") context.instanceActive = false;
    context.startPickerJsonCapture(); await Promise.resolve();
    assert.equal(context.pickerJsonCapture, null);
    assert.equal(calls.json, 0);
  }
  for (const discard of ["close", "teardown"]) {
    const { context, calls } = harness("chatgpt", { mode: "success" });
    context.startPickerJsonCapture();
    if (discard === "teardown") context.instanceActive = false;
    context.clearPickerJsonCapture();
    await context.pendingJsonCapture;
    assert.equal(calls.json, 0, "a discarded queued capture must never start a native read");
    assert.equal(calls.flows.length + calls.errors.length, 0);
  }
  const { context, calls } = harness("chatgpt", { mode: "success" });
  context.startPickerJsonCapture(); await context.pickerJsonCapture.promise;
  context.chatGptJsonCaptureEnabled = false;
  context.startPickerJsonCapture();
  await context.start("claude");
  assert.equal(calls.json, 1);
  assert.equal(calls.dom, 1);
  assert.equal(calls.flows[0].text, "DOM transcript");
});

// Empty admission precedes the platform-specific capture branches.
test("empty new chat rejects before handoff, capture or destination work with fast capture enabled", async () => {
  const { context, calls } = harness("chatgpt");
  context.window.location.pathname = "/";
  context.window.location.href = "https://example.test/";
  context.getDetectedConversationMessageCount = () => 0;
  await context.start("claude");
  assert.deepEqual(calls.errors, ["No conversation"]);
  assert.equal(calls.handoff + calls.json + calls.prepare + calls.dom + calls.destination + calls.flows.length, 0);
  assert.equal(context.isRunning, false);
});

test("ChatGPT ordinary JSON failures never start DOM scrolling and release the lock for retry", async () => {
  for (const mode of ["failure", "missing"]) {
    const { context, calls } = harness("chatgpt", { mode });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await context.start("claude");
      assert.equal(calls.json, mode === "missing" ? 0 : attempt);
      assert.equal(calls.prepare + calls.dom + calls.notice, 0, "Fast capture must not change methods or scroll the page");
      assert.equal(calls.flows.length, 0, "A failed JSON read cannot dispatch guessed DOM history");
      assert.equal(calls.errors.length, attempt);
      assert.equal(context.isRunning, false);
    }
  }
});

test("ChatGPT malformed plain-text parts keep JSON and flag failure, including a cached picker capture", async () => {
  const adapter = vm.createContext({ window: {}, TextEncoder });
  const adapterSource = fs.readFileSync(path.join(__dirname, "../extension/chatgpt-json-capture.js"), "utf8");
  // Expose only the real serializer in this isolated test; the product keeps it private.
  new vm.Script(adapterSource.replace("  function serialize(", "  globalThis.serialize = serialize;\n  function serialize(")).runInContext(adapter);
  const data = { conversation_id: "source", current_node: "answer", mapping: {
    root: { parent: null, message: null },
    question: { parent: "root", message: { author: { role: "user" }, content: { content_type: "text", parts: ["Partial JSON text", { text: "PRIVATE_DETAILS_SENTINEL" }] } } },
    answer: { parent: "question", message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["Reply"] } } }
  } };
  for (const prefetched of [false, true]) {
    const { context, calls, prepared } = harness("chatgpt", { mode: "success" });
    context.window.__capCaptureChatGptJson = async () => { calls.json++; return adapter.serialize(data, "source"); };
    if (prefetched) {
      context.startPickerJsonCapture(); await context.pickerJsonCapture.promise;
      assert.equal(calls.prepare + calls.dom + calls.notice + calls.destination, 0);
    }
    await context.start("claude");
    assert.equal(calls.json, 1, "Malformed content must not trigger a JSON retry.");
    assert.equal(calls.prepare, 0);
    assert.equal(calls.dom, 0);
    assert.equal(calls.notice, 0);
    assert.equal(calls.destination, 1);
    assert.equal(calls.flows.length, 1);
    assert.equal(calls.flows[0].prep, prepared);
    assert.equal(calls.flows[0].text, "ChatGPT conversation:\n\nUser: Partial JSON text\n\nAssistant: Reply");
    assert.equal(calls.flows[0].trace.captureHadInvalidText, true);
    assert.equal(calls.flows[0].trace.diagnostics.capture_detail, "text_invalid");
    assert.equal(calls.flows[0].trace.diagnostics.json_fallback_code, undefined);
    assert.equal(calls.errors.length, 0);
    assert.doesNotMatch(JSON.stringify(calls.traceDetails), /PRIVATE_DETAILS_SENTINEL|Partial JSON text/);
  }
});

for (const platform of ["claude", "chatgpt", "gemini", "grok", "deepseek"]) {
  // Unclassified ChatGPT failures remain terminal; other adapters retain
  // their existing recovery. Success and explicit opt-out cover every adapter.
  for (const mode of platform === "chatgpt" ? [] : ["failure"]) {
    test(`${platform}: ${mode} fast capture falls back once within the same transfer`, async () => {
      const { context, calls, prepared } = harness(platform, { mode });
      await context.start("claude");
      assert.equal(calls.json, mode === "missing" ? 0 : 1);
      assert.equal(calls.prepare, 1);
      assert.equal(calls.dom, 1);
      assert.equal(calls.notice, 1);
      assert.equal(calls.destination, 1);
      assert.equal(calls.flows.length, 1);
      assert.equal(calls.flows[0].prep, prepared);
      assert.equal(calls.flows[0].text, "DOM transcript");
      assert.equal(calls.flows[0].trace.id, "same-attempt");
      assert.deepEqual(calls.errors, []);
      assert.doesNotMatch(calls.traces.join(" "), /private native|MUST_NOT_APPEAR/);
      assert.ok(calls.traceDetails.some(detail => detail?.jsonFallbackReason === "request_failed"));
      // The existing transfer lock also prevents a repeated destination click.
      await context.start("claude");
      assert.equal(calls.flows.length, 1);
      assert.equal(calls.destination, 1);
    });
  }
  test(`${platform}: JSON success and explicit DOM opt-out keep one capture path`, async () => {
    for (const enabled of [true, false]) {
      const { context, calls } = harness(platform, { mode: "success", enabled });
      await context.start("claude");
      assert.equal(calls.json, enabled ? 1 : 0);
      assert.equal(calls.dom, enabled ? 0 : 1);
      assert.equal(calls.prepare, enabled ? 0 : 1);
      assert.equal(calls.notice, 0);
      assert.equal(calls.destination, 1);
      assert.equal(calls.flows.length, 1);
      assert.equal(calls.flows[0].text, enabled ? "JSON transcript" : "DOM transcript");
      if (enabled) assert.deepEqual(JSON.parse(JSON.stringify(calls.captureMetrics[0].diagnostics)), { excludedContentTypes: ["tools", "uploads"], jsonFallbackReason: null });
    }
  });
}

test("Grok's unused broken reply stays on JSON and submits only the selected transcript", async () => {
  const { fixtures } = require("./network-json-fixtures");
  const adapter = vm.createContext({ TextEncoder });
  new vm.Script(fs.readFileSync(path.join(__dirname, "../extension/network-json-data.js"), "utf8")).runInContext(adapter);
  const f = fixtures("grok", "source", 3);
  f.nodes.responseNodes.push({ responseId: "unused-reply", parentResponseId: "missing-old-parent", sender: "assistant" });
  const { context, calls } = harness("grok", { mode: "success" });
  const capture = context.window.__capCaptureNetworkJson;
  context.window.__capCaptureNetworkJson = async (...args) => {
    await capture(...args);
    return adapter.__capNetworkJsonData.grok(f.nodes, f.responses, "answer_2");
  };
  await context.start("chatgpt");
  assert.equal(calls.json, 1);
  assert.equal(calls.dom, 0);
  assert.equal(calls.prepare, 0);
  assert.equal(calls.notice, 0);
  assert.equal(calls.destination, 1);
  assert.equal(calls.flows.length, 1);
  assert.equal(calls.flows[0].text, f.expected);
  assert.equal(calls.errors.length, 0);
});

test("DeepSeek's unused broken answer stays on JSON without scraping or another transfer", async () => {
  const { fixtures } = require("./network-json-fixtures");
  const adapter = vm.createContext({ TextEncoder });
  new vm.Script(fs.readFileSync(path.join(__dirname, "../extension/network-json-data.js"), "utf8")).runInContext(adapter);
  const f = fixtures("deepseek", "source", 3);
  f.data.data.biz_data.chat_messages.push({ message_id: 99, role: "ASSISTANT", fragments: [] });
  const { context, calls } = harness("deepseek", { mode: "success" });
  const capture = context.window.__capCaptureNetworkJson;
  context.window.__capCaptureNetworkJson = async (...args) => {
    await capture(...args);
    return adapter.__capNetworkJsonData.deepseek(f.data, "source", f.files);
  };
  await context.start("claude");
  assert.equal(calls.json, 1);
  assert.equal(calls.dom + calls.prepare + calls.notice, 0);
  assert.equal(calls.destination, 1);
  assert.equal(calls.flows.length, 1);
  assert.equal(calls.flows[0].text, f.expected);
  assert.equal(calls.errors.length, 0);
});

test("Grok's missing starting history enters normal capture once and submits only its recovered transcript", async () => {
  const { fixtures } = require("./network-json-fixtures");
  const adapter = vm.createContext({ TextEncoder });
  new vm.Script(fs.readFileSync(path.join(__dirname, "../extension/network-json-data.js"), "utf8")).runInContext(adapter);
  const f = fixtures("grok", "source", 3);
  f.nodes.responseNodes.splice(0, 2);
  const { context, calls } = harness("grok", { mode: "success" });
  const capture = context.window.__capCaptureNetworkJson;
  context.window.__capCaptureNetworkJson = async (...args) => {
    await capture(...args);
    return adapter.__capNetworkJsonData.grok(f.nodes, f.responses);
  };
  await context.start("chatgpt");
  assert.equal(calls.json, 1, "Missing history is not a temporary JSON error to retry.");
  assert.equal(calls.dom, 1);
  assert.equal(calls.prepare, 1);
  assert.equal(calls.notice, 1);
  assert.equal(calls.destination, 1);
  assert.equal(calls.flows.length, 1);
  assert.equal(calls.flows[0].text, "DOM transcript");
  assert.equal(calls.flows[0].trace.diagnostics.json_fallback_code, "incomplete");
  assert.equal(calls.errors.length, 0);
});

test("JSON completion after source navigation cancels before dispatch or DOM fallback on every platform", async () => {
  for (const platform of ["claude", "chatgpt", "gemini", "grok", "deepseek"]) {
    for (const succeeds of [true, false]) {
      for (const awayAndBack of [false, true]) {
        const { context, calls, navigate } = harness(platform, { mode: "success" });
        const sourcePath = context.window.location.pathname;
        const captureKey = platform === "claude" ? "__capCaptureClaudeJson"
          : platform === "chatgpt" ? "__capCaptureChatGptJson" : "__capCaptureNetworkJson";
        const capture = context.window[captureKey];
        context.window[captureKey] = async () => {
          const result = await capture();
          navigate("/chat/other");
          if (awayAndBack) navigate(sourcePath);
          if (!succeeds) throw Object.assign(new Error("Native request failed"), { captureFailureReason: "request_failed" });
          return result;
        };
        await context.start("claude");
        assert.equal(calls.json, 1);
        assert.equal(calls.dom + calls.prepare + calls.notice, 0);
        assert.equal(calls.captureMetrics.length, 0);
        assert.equal(calls.flows.length, 0);
        assert.equal(context.isRunning, false);
        assert.match(calls.errors[0], /conversation changed during capture/);
      }
    }
  }
});

test("capture fallback records only recognized reasons, never arbitrary native errors", async () => {
  for (const reason of ["unavailable", "timeout", "incomplete", "unsupported", "request_failed", "MUST_NOT_APPEAR"]) {
    const { context, calls } = harness("claude", { failureReason: reason });
    await context.start("claude");
    assert.ok(calls.traceDetails.some(detail => detail?.jsonFallbackReason === (reason === "MUST_NOT_APPEAR" ? "request_failed" : reason)));
    assert.doesNotMatch(JSON.stringify(calls.traceDetails), /MUST_NOT_APPEAR|private native/);
    assert.equal(calls.flows.length, 1);
  }
});

test("failed source preparation or DOM fallback releases the lock and permits a fresh attempt", async () => {
  for (const prepareFails of [true, false]) {
    const { context, calls } = harness("claude", { prepareFails, domFails: !prepareFails });
    for (let attempt = 1; attempt <= 2; attempt++) {
      await context.start("claude");
      assert.equal(calls.prepare, attempt);
      assert.equal(calls.dom, prepareFails ? 0 : attempt);
      assert.equal(calls.flows.length, 0);
      assert.equal(context.isRunning, false);
      assert.deepEqual(calls.errors, Array(attempt).fill(prepareFails ? "Source preparation failed" : "DOM capture failed"));
    }
  }
});

test("fallback does not capture a different source chat", async () => {
  const { context, calls } = harness("chatgpt", { mode: "navigate" });
  await context.start("claude");
  assert.equal(calls.dom, 0);
  assert.equal(calls.flows.length, 0);
  assert.equal(context.isRunning, false);
  assert.match(calls.errors[0], /conversation changed/);
});

test("bridge cancellation cannot fall back after an away-and-back navigation", async () => {
  const { context, calls } = harness("chatgpt", { mode: "cancelled" });
  await context.start("claude");
  assert.equal(calls.dom, 0);
  assert.equal(calls.notice, 0);
  assert.equal(calls.flows.length, 0);
  assert.equal(context.isRunning, false);
  assert.deepEqual(calls.errors, ["The conversation changed during capture."]);
});

test("normal capture and JSON DOM fallback cancel source navigation before dispatch", async () => {
  for (const enabled of [false, true]) {
    for (const awayAndBack of [false, true]) {
      const { context, calls, navigate } = harness(enabled ? "claude" : "chatgpt", { enabled });
      const sourcePath = context.window.location.pathname;
      context.scrapeConversationTextWhenReady = async () => {
        navigate("/c/other");
        if (awayAndBack) navigate(sourcePath);
        return "Other chat must never reach summary or delivery";
      };
      await context.start("claude");
      assert.equal(calls.flows.length, 0);
      assert.equal(context.isRunning, false);
      assert.match(calls.errors[0], /conversation changed during capture/);
    }
  }
});

test("destination warms during selection motion but navigation still cancels before capture or dispatch", async () => {
  const { context, calls, navigate } = harness("chatgpt", { enabled: false });
  context.transitionDestinationSheetToHandoff = async () => {
    assert.equal(calls.destination, 1, "data-free navigation starts before cosmetic motion finishes");
    navigate("/c/other"); navigate("/c/source");
  };
  await context.start("claude");
  assert.equal(calls.destination, 1);
  assert.equal(calls.json + calls.prepare + calls.dom, 0);
  assert.equal(calls.flows.length, 0);
  assert.equal(context.isRunning, false);
  assert.match(calls.errors[0], /conversation changed/);
});

test("fallback notice uses fixed safe copy in the handoff and announces it", () => {
  const noticeStart = source.indexOf("  function showFastCaptureFallbackMessage(");
  const noticeEnd = source.indexOf("  function protectOverlayPalette(", noticeStart);
  const node = { style: {}, setAttribute: (key, value) => { node[key] = value; } };
  const group = { appendChild: child => { group.child = child; } };
  const context = vm.createContext({
    document: { getElementById: id => id === "context-generator-status-group" ? group : null, createElement: () => node }
  });
  vm.runInContext(`${source.slice(noticeStart, noticeEnd)}; showFastCaptureFallbackMessage();`, context);
  assert.equal(group.child, node);
  assert.equal(node.role, "status");
  assert.equal(node.textContent, "Fast capture failed. Using normal capture instead.");
});

test("rough progress reaches the owning DOM handoff before the final count and never fails on estimated excess", async () => {
  const { context, calls } = harness("deepseek");
  const ready = deferred(), finishDom = deferred(), final = deferred();
  let callback;
  context.window.__capMeasureNetworkJson = (_path, _signal, onEstimate) => { callback = onEstimate; ready.resolve(); return final.promise; };
  context.prepareSourceForCapture = async () => { context.extendDomCaptureDeadline(context.activeTransferTrace); context.startDomCaptureSizeCheck(context.activeTransferTrace); };
  context.scrapeConversationTextWhenReady = async () => { await finishDom.promise; context.checkTransferDeadline(context.activeTransferTrace); return "DOM transcript"; };
  const transfer = context.start("claude"); await ready.promise;
  const trace = context.activeTransferTrace;
  callback({ messageTurnCount: 200, estimatedCharacterCount: 4000001 });
  assert.ok(trace.domSizeCheck.estimateMs > 0);
  assert.equal(trace.domSizeCheck.error, null, "Estimated excess never rejects an otherwise valid DOM capture.");
  finishDom.resolve(); await transfer;
  assert.equal(calls.flows.length, 1);
  const deadline = trace.deadlineAt;
  callback({ messageTurnCount: 10000, estimatedCharacterCount: 30000000 });
  final.resolve({ characterCount: 4000001 }); await new Promise(setImmediate);
  assert.equal(trace.deadlineAt, deadline, "Late progress cannot extend completed capture.");
  assert.equal(calls.errors.length, 0);
});

test("JSON milestones are reported while the read is pending, with bounded repeats and quiet unused prefetch", async () => {
  for (const prefetched of [false, true]) {
    const { context, calls } = harness("deepseek", { mode: "success" });
    const snapshots = [];
    context.startTransferTelemetry = trace => { trace.telemetryStarted = true; trace.telemetryLastStage = "capture_started"; };
    context.sendTransferTelemetrySnapshot = trace => snapshots.push(JSON.parse(JSON.stringify(trace.diagnostics)));
    let finish, progress, began;
    const started = new Promise(resolve => { began = resolve; });
    context.window.__capCaptureNetworkJson = (_path, _omit, onProgress) => {
      calls.json++;
      progress = onProgress;
      onProgress({ outcome: "started", step: "request", step_stage: "history", history_request_sent: true });
      onProgress({ outcome: "started", step: "read", step_stage: "history", history_request_sent: true });
      began();
      return new Promise(resolve => { finish = resolve; });
    };
    if (prefetched) {
      context.startPickerJsonCapture();
      await started;
      assert.equal(snapshots.length, 0, "An unused picker read must not send telemetry.");
    }
    const running = context.start("claude");
    await started;
    for (let i = 0; i < 50 && !snapshots.some(value => value.json_attempts?.some(attempt => attempt.step === "read")); i++) await Promise.resolve();
    assert.ok(snapshots.some(value => value.json_attempts?.some(attempt => attempt.step === "read")));
    const atRead = snapshots.at(-1).json_attempts[0];
    assert.equal(atRead.outcome, "started", "Checkpoint must be sent before the native read settles.");
    assert.equal(atRead.history_request_sent, true);
    progress({ outcome: "started", step: "request", step_stage: "attachment_body" });
    progress({ outcome: "started", step: "read", step_stage: "attachment_body" });
    const count = snapshots.length;
    for (let i = 0; i < 50; i++) {
      progress({ outcome: "started", step: "request", step_stage: "attachment_body" });
      progress({ outcome: "started", step: "read", step_stage: "attachment_body" });
    }
    assert.equal(snapshots.length, count, "Repeated file milestones must not produce a telemetry burst.");
    finish({ text: "JSON transcript", messageTurnCount: 2, jsonCapture: { outcome: "succeeded", step: "complete", step_stage: "serialize", history_checked: true } });
    await running;
    const trace = calls.flows[0].trace;
    const beforeLate = snapshots.length;
    progress({ outcome: "started", step: "parse", step_stage: "history" });
    assert.equal(snapshots.length, beforeLate, "Late progress cannot replace the completed read.");
    assert.equal(trace.diagnostics.json_attempts[0].outcome, "succeeded");
  }
});

test("a failed JSON read is queued before retry can replace its diagnosis",async()=>{
  const {context,calls}=harness("deepseek");const snapshots=[];
  context.startTransferTelemetry=trace=>{trace.telemetryStarted=true;trace.telemetryLastStage="capture_started";};
  context.sendTransferTelemetrySnapshot=trace=>snapshots.push(JSON.parse(JSON.stringify(trace.diagnostics)));
  context.window.__capCaptureNetworkJson=async()=>{
    calls.json++;
    if(calls.json===1)throw Object.assign(transientError(),{jsonCapture:{outcome:"failed",step:"route",step_stage:"history",hook_ready:true,route_found:false,
      route_reason:"no_matching_endpoint",failure_check:"routing_unavailable"}});
    assert.equal(snapshots.find(d=>d.json_attempts?.some(attempt=>attempt.outcome==="failed")).json_attempts[0].failure_check,"routing_unavailable");
    return{text:"JSON transcript",messageTurnCount:2,jsonCapture:{outcome:"succeeded",step:"complete",history_checked:true}};
  };
  await context.start("claude");assert.equal(calls.json,2);assert.equal(calls.dom,0);
  assert.equal(calls.flows[0].trace.id,"same-attempt");
  assert.deepEqual(Array.from(calls.flows[0].trace.diagnostics.json_attempts,d=>d.mode),["fresh","retry"]);
});
