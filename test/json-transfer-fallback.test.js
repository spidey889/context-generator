const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { loadTransferFlow } = require("./helpers/transfer-flow");

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

test("picker failures stay silent and use the existing DOM fallback only after selection", async () => {
  const { context, calls } = harness("chatgpt");
  context.startPickerJsonCapture(); await context.pickerJsonCapture.promise;
  assert.equal(calls.json, 1);
  assert.equal(calls.notice + calls.dom + calls.prepare + calls.flows.length + calls.errors.length, 0);
  await context.start("claude");
  assert.equal(calls.json, 1);
  assert.equal(calls.notice, 1);
  assert.equal(calls.dom, 1);
  assert.equal(calls.flows[0].text, "DOM transcript");
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

for (const platform of ["claude", "chatgpt", "gemini", "grok", "deepseek"]) {
  // Every bridge retains failure/success wiring checks. A missing bridge uses
  // the same fallback path; per-adapter readiness recovery is tested separately.
  for (const mode of platform === "chatgpt" ? ["failure", "missing"] : ["failure"]) {
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
    const { context, calls } = harness("chatgpt", { failureReason: reason });
    await context.start("claude");
    assert.ok(calls.traceDetails.some(detail => detail?.jsonFallbackReason === (reason === "MUST_NOT_APPEAR" ? "request_failed" : reason)));
    assert.doesNotMatch(JSON.stringify(calls.traceDetails), /MUST_NOT_APPEAR|private native/);
    assert.equal(calls.flows.length, 1);
  }
});

test("failed source preparation or DOM fallback releases the lock and permits a fresh attempt", async () => {
  for (const prepareFails of [true, false]) {
    const { context, calls } = harness("chatgpt", { prepareFails, domFails: !prepareFails });
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
      const { context, calls, navigate } = harness("chatgpt", { enabled });
      context.scrapeConversationTextWhenReady = async () => {
        navigate("/c/other");
        if (awayAndBack) navigate("/c/source");
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
