const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { loadTransferFlow, loadContextFlow } = require("./helpers/transfer-flow");

const source = fs.readFileSync(path.join(__dirname, "../extension/platform-content.js"), "utf8");

// Exercise the actual picker orchestrator; substitute only its UI, capture and
// transfer boundaries to count side effects without native timers or a browser.
function harness(platform, { mode = "failure", enabled = true, domFails = false, prepareFails = false, failureReason } = {}) {
  const calls = { json: 0, prepare: 0, dom: 0, notice: 0, handoff: 0, destination: 0, flows: [], errors: [], traces: [], traceDetails: [], captureMetrics: [] };
  const prepared = Promise.resolve({ tabId: 42 });
  const pathname = { claude: "/chat/source", chatgpt: "/c/source", gemini: "/app/source", grok: "/c/source", deepseek: "/a/chat/s/source" }[platform];
  const location = { href: `https://example.test${pathname}`, pathname };
  const navigationListeners = new Set();
  const context = loadTransferFlow({
    window: { location, navigation: {
      addEventListener: (_type, listener) => navigationListeners.add(listener),
      removeEventListener: (_type, listener) => navigationListeners.delete(listener)
    } }, currentPlatform: { id: platform, name: platform },
    claudeJsonCaptureEnabled: enabled, chatGptJsonCaptureEnabled: enabled, networkJsonCaptureEnabled: enabled,
    createTransferTrace: () => ({ id: "same-attempt" }), startTransferTelemetry() {},
    markTransferTrace: (_trace, message, detail) => { calls.traces.push(message); calls.traceDetails.push(detail); }, finishTransferTrace() {},
    clearRunningResetTimer() {}, resetRunningFlag: () => { context.isRunning = false; },
    getDetectedConversationMessageCount: () => 2,
    transitionDestinationSheetToHandoff: async () => {}, showOverlay: () => { calls.handoff++; }, releaseDestinationSheetBackdrop() {},
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
    showErrorOverlay: message => calls.errors.push(message)
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
  context.window.__capCaptureChatGptJson = () => {
    calls.json++;
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

test("cancelling during handoff immediately releases the picker capture and its navigation timer", async () => {
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
    context.transitionDestinationSheetToHandoff = async () => {
      context.cancelSourceTransfer(context.activeTransferTrace.id);
      assert.equal(context.pickerJsonCapture, null);
      assert.equal(timers.size, 0);
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

test("picker failures stay silent until selection and honor each platform's recovery", async () => {
  for (const platform of ["chatgpt", "claude"]) {
    const { context, calls } = harness(platform);
    context.startPickerJsonCapture(); await context.pickerJsonCapture.promise;
    assert.equal(calls.json, 1);
    assert.equal(calls.notice + calls.dom + calls.prepare + calls.flows.length + calls.errors.length, 0);
    await context.start("claude");
    assert.equal(calls.json, 1, "selection must reuse the failed prefetch without a duplicate read");
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
  assert.match(calls.errors[0], /Transfer cancelled/);
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

test("ChatGPT JSON failures never start DOM scrolling and release the lock for retry", async () => {
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

for (const platform of ["claude", "chatgpt", "gemini", "grok", "deepseek"]) {
  // ChatGPT remains JSON-only on fast-read failure; other adapters retain
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
  for (const reason of ["unavailable", "timeout", "size_limit", "incomplete", "unsupported", "request_failed", "MUST_NOT_APPEAR"]) {
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
  const context = vm.createContext({ document: { getElementById: () => group, createElement: () => node } });
  vm.runInContext(`${source.slice(noticeStart, noticeEnd)}; showFastCaptureFallbackMessage();`, context);
  assert.equal(group.child, node);
  assert.equal(node.role, "status");
  assert.equal(node.textContent, "Fast capture failed. Using normal capture instead.");
});


function clipboardHarness(platform, options = {}) {
  const fixture = harness(platform, { mode: "success", ...options });
  const { context, calls } = fixture;
  loadContextFlow(context);
  Object.assign(calls, { summaries: [], copied: [], confirmations: 0, recovery: [], finished: [], stages: [] });
  Object.assign(context, {
    summarizeWithBackend: async text => { calls.summaries.push(text); return "Prepared context \u{1f680}\nwith exact text"; },
    navigator: { clipboard: { writeText: async text => { calls.copied.push(text); } } },
    stopHandoffCountdown() {},
    showClipboardSuccess: () => { calls.confirmations++; },
    showFallbackModal: (text, destination) => { calls.recovery.push({ text, destination }); },
    isHandoffOverlayVisible: () => true,
    notifyBackground: async () => {},
    advanceTransferTelemetryStage: (_trace, stage) => calls.stages.push(stage),
    getPlatform: id => ({ name: id }),
    SUMMARY_RETRY_ERROR_MESSAGE: "Summary failed. Try again.",
    finishTransferTrace: (_trace, reason) => { calls.finished.push(reason || "success"); }
  });
  return fixture;
}

test("Copy shares all five JSON adapters and ends at the clipboard without a destination", async () => {
  for (const platform of ["claude", "chatgpt", "gemini", "grok", "deepseek"]) {
    const { context, calls } = clipboardHarness(platform);
    await context.start("clipboard");
    assert.equal(calls.json, 1, platform);
    assert.deepEqual(calls.summaries, ["JSON transcript"], platform);
    assert.deepEqual(calls.copied, ["Prepared context \u{1f680}\nwith exact text"], platform);
    assert.equal(calls.confirmations, 1, platform);
    assert.ok(calls.stages.includes("paste_started"), "Copy reports the normal final delivery stage");
    assert.ok(calls.traces.includes("paste done"));
    assert.deepEqual(calls.finished, ["success"]);
    assert.equal(calls.destination + calls.prepare + calls.dom + calls.flows.length, 0, platform);
    assert.equal(context.isRunning, false, platform);
  }
});

test("Copy respects normal capture and each platform's existing JSON failure policy", async () => {
  for (const platform of ["claude", "chatgpt", "gemini", "grok", "deepseek"]) {
    for (const enabled of [false, true]) {
      const { context, calls } = clipboardHarness(platform, { enabled, mode: "failure" });
      await context.start("clipboard");
      const rejected = enabled && platform === "chatgpt";
      assert.equal(calls.json, enabled ? 1 : 0);
      assert.equal(calls.dom, rejected ? 0 : 1);
      assert.equal(calls.summaries.length, rejected ? 0 : 1);
      assert.equal(calls.confirmations, rejected ? 0 : 1);
      assert.equal(calls.destination + calls.flows.length, 0);
      assert.equal(context.isRunning, false);
    }
  }
});

test("Copy reuses current picker capture and rejects empty chats before summary or clipboard work", async () => {
  const { context, calls } = clipboardHarness("chatgpt");
  context.startPickerJsonCapture();
  await context.pickerJsonCapture.promise;
  await context.start("clipboard");
  assert.equal(calls.json, 1, "Copy consumes the same validated early read");
  for (const platform of ["claude", "chatgpt", "gemini", "grok", "deepseek"]) {
    const { context, calls } = clipboardHarness(platform, { enabled: false });
    context.getDetectedConversationMessageCount = () => 0;
    await context.start("clipboard");
    assert.equal(calls.summaries.length + calls.copied.length + calls.destination + calls.handoff, 0);
    assert.deepEqual(calls.errors, ["No conversation"]);
    assert.equal(context.isRunning, false);
  }
});

test("Copy is single-flight and confirms only after the clipboard write resolves", async () => {
  const { context, calls } = clipboardHarness("chatgpt");
  const pending = deferred();
  let writing = false;
  context.navigator.clipboard.writeText = text => { calls.copied.push(text); writing = true; return pending.promise; };
  const first = context.start("clipboard");
  for (let turn = 0; turn < 30 && !writing; turn++) await Promise.resolve();
  assert.equal(writing, true);
  await context.start("clipboard");
  assert.equal(calls.json, 1);
  assert.equal(calls.summaries.length, 1);
  assert.equal(calls.copied.length, 1);
  assert.equal(calls.confirmations, 0);
  assert.equal(context.isRunning, true);
  pending.resolve();
  await first;
  assert.equal(calls.confirmations, 1);
  assert.equal(context.isRunning, false);
});

test("Blocked clipboard preserves the exact prepared carry and allows a fresh attempt", async () => {
  const { context, calls } = clipboardHarness("chatgpt");
  context.navigator.clipboard.writeText = async () => { throw new Error("Document is not focused"); };
  await context.start("clipboard");
  assert.equal(calls.confirmations, 0);
  assert.deepEqual(calls.recovery, [{ text: "Prepared context \u{1f680}\nwith exact text", destination: "clipboard" }]);
  assert.equal(context.isRunning, false);
  context.navigator.clipboard.writeText = async text => calls.copied.push(text);
  await context.start("clipboard");
  assert.equal(calls.confirmations, 1);
  assert.equal(context.isRunning, false);
});

test("Copy cannot write a late summary after navigation, teardown, cancellation or expiry", async () => {
  for (const interruption of ["navigation", "teardown", "cancellation", "expiry"]) {
    const { context, calls, navigate } = clipboardHarness("chatgpt");
    const pending = deferred();
    context.summarizeWithBackend = text => { calls.summaries.push(text); return pending.promise; };
    const copying = context.start("clipboard");
    for (let turn = 0; turn < 30 && calls.summaries.length === 0; turn++) await Promise.resolve();
    assert.equal(calls.summaries.length, 1);
    if (interruption === "navigation") { navigate("/c/another"); navigate("/c/source"); }
    else if (interruption === "cancellation") context.cancelSourceTransfer("same-attempt");
    else { context.activeTransferTrace.expired = true; context.resetRunningFlag(); }
    pending.resolve("Late summary must never be copied");
    await copying;
    assert.equal(calls.copied.length + calls.confirmations + calls.recovery.length, 0, interruption);
    assert.equal(context.isRunning, false, interruption);
  }
});


test("Background cancellation of Copy releases ownership without clipboard or recovery UI", async () => {
  const { context, calls } = clipboardHarness("chatgpt");
  context.summarizeWithBackend = async () => { throw Object.assign(new Error("Source closed"), { code: "user_cancelled" }); };
  await context.start("clipboard");
  assert.equal(calls.copied.length + calls.confirmations + calls.recovery.length + calls.errors.length, 0);
  assert.equal(context.isRunning, false);
  assert.deepEqual(calls.finished, ["user_cancelled"]);
});
