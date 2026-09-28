const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { webcrypto } = require("node:crypto");
const { fixtures, rpcFrame, geminiTurn, prompt } = require("./network-json-fixtures");
const files = ["network-json-data.js", "network-fetch-main.js", "network-json-capture.js"];
function setup(platform, fixture = fixtures(platform), { fetchImpl, runtime, schedule = setTimeout, beforeMessage } = {}) {
  const requests = [], replies = [], listeners = new Set(), navigation = new Set();
  const host = { gemini: "gemini.google.com", grok: "grok.com", deepseek: "chat.deepseek.com" }[platform];
  const pathname = { gemini: "/app/smoke", grok: "/c/smoke", deepseek: "/a/chat/s/smoke" }[platform];
  const location = { hostname: host, origin: `https://${host}`, pathname, search: "", href: `https://${host}${pathname}` };
  const json = value => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
  const nativeFetch = async (url, options = {}) => {
    const request = { url: new URL(url instanceof Request ? url.url : url, location.href), options }; requests.push(request);
    if (fetchImpl) return fetchImpl(request, requests.length);
    if (request.url.pathname.endsWith("batchexecute")) {
      const args = JSON.parse(JSON.parse(new URLSearchParams(options.body).get("f.req"))[0][0][1]);
      const index = args[2] ? Number(args[2].split("_")[1]) : 0;
      return new Response(rpcFrame(fixture.pages[index]), { headers: { "content-type": "application/json" } });
    }
    if (request.url.pathname.endsWith("response-node")) return json(fixture.nodes);
    if (request.url.pathname.endsWith("load-responses")) return json({ responses: fixture.responses.filter(m => JSON.parse(options.body).responseIds.includes(m.responseId)).reverse() });
    if (request.url.hostname === "files.deepseeksvc.com") {
      assert.equal(options.credentials, "omit"); assert.equal(options.headers, undefined);
      return new Response(fixture.files[fixture.file.id], { headers: { "content-type": "application/octet-stream" } });
    }
    if (request.url.pathname.includes("history_messages")) {
      assert.equal(options.headers.authorization, "Bearer AUTH_SENTINEL");
      assert.equal(options.headers["x-device-id"], undefined);
      return json(fixture.data);
    }
    return json({});
  };
  class Xhr { open() {} send() {} setRequestHeader() {} }
  const window = { fetch: nativeFetch, XMLHttpRequest: Xhr, WIZ_global_data: { SNlM0e: "CSRF_SENTINEL" },
    addEventListener: (type, listener) => (type === "message" ? listeners : navigation).add(listener),
    removeEventListener: (type, listener) => (type === "message" ? listeners : navigation).delete(listener),
    navigation: { addEventListener: (_type, fn) => navigation.add(fn), removeEventListener: (_type, fn) => navigation.delete(fn) },
    postMessage(data) { if (data.type === "response") replies.push(data); queueMicrotask(() => { beforeMessage?.(data); [...listeners].forEach(fn => fn({ data, source: window, origin: location.origin })); }); }
  };
  const context = vm.createContext({ window, location, chrome: runtime ? { runtime } : undefined, performance: { getEntriesByType: () => [] }, URL, URLSearchParams, Headers, Request, TextEncoder, TextDecoder, AbortController, crypto: webcrypto, setTimeout: schedule, clearTimeout });
  const reinstall = file => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8"), context);
  files.forEach(reinstall);
  const api = vm.runInContext("__capNetworkJsonData", context);
  const observe = async () => {
    if (platform === "gemini") {
      const xhr = new Xhr(); xhr.open("POST", `${location.origin}/_/BardChatUi/data/batchexecute?rpcids=hNvQHb`);
      xhr.send(new URLSearchParams({ at: "CSRF_SENTINEL", "f.req": JSON.stringify([[["hNvQHb", JSON.stringify(["c_old-chat", 10, null, 1, [1], [4], null, 1]), null, "generic"]]]) }).toString());
    } else if (platform === "deepseek") {
      const xhr = new Xhr(); xhr.open("GET", `${location.origin}/api/v0/session`);
      xhr.setRequestHeader("Authorization", "Bearer AUTH_SENTINEL"); xhr.setRequestHeader("x-device-id", "CACHE_DEVICE"); xhr.send();
    }
  };
  return { window, api, requests, replies, context, fixture, observe, reinstall, listeners, location,
    navigationListeners: () => navigation.size,
    navigate(pathname = "/new") { for (const fn of navigation) fn({ destination: { url: location.origin + pathname } }); location.pathname = pathname; location.href = location.origin + pathname; }
  };
}
for (const platform of ["gemini", "grok", "deepseek"]) {
  test(`${platform}: exact complete ordered history with large own paste and document; no tool/file leakage`, async () => {
    const h = setup(platform); await h.observe(); const before = h.requests.length;
    assert.equal(h.replies.length, 0);
    const capture = await h.window.__capCaptureNetworkJson();
    assert.equal(capture.text, h.fixture.expected);
    assert.equal(capture.messageTurnCount, 48);
    assert.doesNotMatch(capture.text, /TOOL_SENTINEL|SIGNED_SENTINEL|AUTH_SENTINEL|CSRF_SENTINEL/);
    assert.equal(h.listeners.size, 1);
    assert.equal(h.requests.length - before, platform === "gemini" ? 3 : 2);
  });
  test(`${platform}: repeated installation is inert and ping never reads data`, async () => {
    const h = setup(platform); await h.observe(); const before = h.requests.length;
    h.reinstall(files[1]); h.reinstall(files[2]);
    h.window.postMessage({ channel: "cap-context-network-json-v1", platform, type: "ping", id: "probe" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.requests.length, before); assert.equal(h.listeners.size, 1);
    assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
  });
  test(`${platform}: navigation cancels capture, never returns stale text`, async () => {
    let h; h = setup(platform, fixtures(platform), { fetchImpl: async request => { if (!request.url.pathname.endsWith("/session")) h.navigate(); return new Response("{}"); } });
    await h.observe();
    await assert.rejects(h.window.__capCaptureNetworkJson(), /conversation changed|cancelled/);
    assert.equal(h.listeners.size, 1);
  });
  test(`${platform}: ranged/non-JSON responses fail visibly`, async () => {
    for (const response of [new Response("{}", { status: 206, headers: { "content-type": "application/json" } }), new Response("{}", { headers: { "content-type": "text/html" } }), new Response("{}", { headers: { "content-type": "application/json", "content-range": "bytes 0-2/9" } })]) {
      const h = setup(platform, fixtures(platform), { fetchImpl: async () => response });
      if (platform === "deepseek") { h.context.window.__capNetworkFetchState.dispose(); h.context.window.fetch = async () => response; h.reinstall(files[1]); await h.window.fetch("/api/v0/session", { headers: { authorization: "Bearer AUTH_SENTINEL" } }); }
      else await h.observe();
      await assert.rejects(h.window.__capCaptureNetworkJson(), /partial|unsupported/);
    }
  });
}
test("Gemini: Unicode frame lengths, selected candidate, page root and broken chains", () => {
  const h = setup("gemini"), f = h.fixture;
  assert.equal(h.api.geminiPage(rpcFrame(f.pages[0])).turns.length, 10);
  const incomplete = rpcFrame(f.pages[0]).slice(0, -12);
  assert.throws(() => h.api.geminiPage(incomplete), /truncated|incomplete/);
  assert.throws(() => h.api.gemini(f.pages.slice(0, 1), "smoke"), /previous/);
  f.pages[1].turns.shift();
  assert.throws(() => h.api.gemini(f.pages, "smoke"), /missing|order/);
  const t = geminiTurn(0, "smoke", "User", "Selected"); t[3][0].unshift(["rc_other", ["INACTIVE_SENTINEL"]]);
  assert.equal(h.api.gemini([{ turns: [t], cursor: null }], "smoke").text, "Gemini conversation:\n\nUser: User\n\nAssistant: Selected");
  t[3][9] = null; // Older, completed native responses omit this unrelated flag.
  assert.equal(h.api.gemini([{ turns: [t], cursor: null }], "smoke").messageTurnCount, 2);
  t[3][3] = "rc_missing";
  assert.throws(() => h.api.gemini([{ turns: [t], cursor: null }], "smoke"), /missing/);
});
test("Grok: rid selects active branch, ambiguous and missing bodies fail", () => {
  const h = setup("grok"), f = h.fixture;
  f.nodes.responseNodes.push({ responseId: "alternate", parentResponseId: "user_0", sender: "assistant" });
  assert.throws(() => h.api.grokBranch(f.nodes), /active/);
  assert.equal(h.api.grok(f.nodes, f.responses, "answer_23").text, f.expected);
  assert.throws(() => h.api.grok(f.nodes, f.responses.slice(1), "answer_23"), /missing/);
  f.responses[2].partial = true;
  assert.throws(() => h.api.grok(f.nodes, f.responses, "answer_23"), /Incomplete|incomplete/);
  f.nodes.inflightResponses.push({ responseId: "pending" });
  assert.throws(() => h.api.grokBranch(f.nodes, "answer_23"), /progress/);
});
test("DeepSeek: reject cache deltas, missing parents, unfinished fragments and incomplete uploads", () => {
  for (const mutate of [
    f => { f.data.data.biz_data.cache_control = "MERGE"; },
    f => { f.data.data.biz_data.chat_messages.splice(4, 1); },
    f => { f.data.data.biz_data.chat_messages[1].has_pending_fragment = true; },
    f => { f.file.file_size++; },
    f => { f.data.code = 40003; }
  ]) {
    const h = setup("deepseek"), f = h.fixture; mutate(f);
    assert.throws(() => h.api.deepseek(f.data, "smoke", f.files), /cache|missing|unfinished|incomplete|could not/);
  }
});
test("DeepSeek: own thoughts and file text remain in original fragment order; tool/binary content excluded", () => {
  const h = setup("deepseek"), f = fixtures("deepseek", "smoke", 1);
  f.data.data.biz_data.chat_messages[0].fragments.unshift({ type: "REQUEST", content: "Before paste" });
  f.data.data.biz_data.chat_messages[1].fragments.unshift({ type: "THINK", content: "Own thought" });
  const text = h.api.deepseek(f.data, "smoke", f.files).text;
  assert.ok(text.includes(`User: Before paste\n\n${prompt}`));
  assert.ok(text.includes("Assistant: Own thought\n\nSMOKE_ASSISTANT_SENTINEL"));
  assert.doesNotMatch(text, /TOOL_SENTINEL|DO_NOT_FETCH_IMAGE/);
});
test("All adapters reject zero own text and oversize text without truncation", () => {
  const g = setup("gemini"), t = geminiTurn(0, "smoke", "", "");
  assert.throws(() => g.api.gemini([{ turns: [t], cursor: null }], "smoke"), /No usable/);
  t[2][0][0] = "x".repeat(350001);
  assert.throws(() => g.api.gemini([{ turns: [t], cursor: null }], "smoke"), /size/);
  const k = setup("grok"); k.fixture.responses.forEach(message => { message.message = ""; });
  assert.throws(() => k.api.grok(k.fixture.nodes, k.fixture.responses), /No usable/);
  k.fixture.responses[0].message = "x".repeat(350001);
  assert.throws(() => k.api.grok(k.fixture.nodes, k.fixture.responses), /size/);
  const d = setup("deepseek");
  d.fixture.data.data.biz_data.chat_messages.forEach(message => { message.fragments = [{ type: message.role === "USER" ? "REQUEST" : "RESPONSE", content: "" }]; });
  assert.throws(() => d.api.deepseek(d.fixture.data, "smoke"), /No usable/);
  d.fixture.data.data.biz_data.chat_messages[0].fragments[0].content = "x".repeat(350001);
  assert.throws(() => d.api.deepseek(d.fixture.data, "smoke"), /size/);
});
test("DeepSeek: disallow arbitrary signed hosts and truncated text downloads", async () => {
  for (const change of [f => { f.file.signed_path = "https://other.example/api/file?file_id=test-paste"; }, f => { f.files[f.file.id] = "short"; }]) {
    const f = fixtures("deepseek"); change(f); const h = setup("deepseek", f); await h.observe();
    await assert.rejects(h.window.__capCaptureNetworkJson(), /attachment/);
  }
});
test("Gemini: late installation uses resource timing and native bootstrap, without observing message bodies", async () => {
  const h = setup("gemini");
  h.context.performance.getEntriesByType = () => [{ name: "https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=other" }];
  assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
});
test("Gemini pins the selected chat and latches navigation throughout readiness and response delivery", async () => {
  for (const phase of ["before", "pong", "response"]) {
    let h;
    h = setup("gemini", fixtures("gemini", phase === "before" ? "other" : "smoke"), { beforeMessage: message => {
      if (message.type === phase) { h.navigate("/app/other"); h.navigate("/app/smoke"); }
    } });
    await h.observe();
    if (phase === "before") h.navigate("/app/other");
    await assert.rejects(h.window.__capCaptureNetworkJson("/app/smoke"), /conversation changed/);
    assert.equal(h.requests.length, phase === "response" ? 3 : 0);
    assert.equal(h.navigationListeners(), 0);
    assert.equal(h.listeners.size, 1);
  }
});
test("Gemini repairs replaced fetch or XHR observation before accepting readiness", async () => {
  for (const surface of ["fetch", "xhr"]) {
    let h, installs = 0;
    h = setup("gemini", fixtures("gemini"), { runtime: { sendMessage: async () => {
      installs++; h.reinstall(files[1]); return { ok: true };
    } } });
    await h.observe();
    if (surface === "fetch") {
      const old = h.window.fetch;
      h.window.fetch = (...args) => old(...args);
    } else {
      const proto = h.window.XMLHttpRequest.prototype;
      const old = proto.send;
      proto.send = function (...args) { return old.apply(this, args); };
    }
    assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
    assert.equal(installs, 1);
    assert.equal(h.listeners.size, 1);
    const currentFetch = h.window.fetch;
    h.reinstall(files[1]);
    assert.equal(h.window.fetch, currentFetch);
  }
});
test("Gemini JSON picker pins identity before handoff and preserves source whitespace through metrics", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "extension", "platform-content.js"), "utf8");
  const captureStart = source.indexOf("  function createConversationCapture(text, metrics = {})");
  const captureEnd = source.indexOf("  function getConversationCaptureMetrics", captureStart);
  const cleanStart = source.indexOf("  function cleanText(text)");
  const cleanEnd = source.indexOf("  function isVisible", cleanStart);
  const metrics = vm.createContext({ lastConversationCaptureMetrics: null });
  vm.runInContext(source.slice(cleanStart, cleanEnd) + source.slice(captureStart, captureEnd), metrics);
  const text = 'Gemini conversation:\n\nUser:   pasted code  \n\nAssistant:   print("a\u00a0b")  \n';
  assert.equal(metrics.createConversationCapture(text, { method: "gemini-json" }), text);
  const start = source.indexOf("  async function startDestinationTransfer(destinationId)");
  const end = source.indexOf("  function protectOverlayPalette", start);
  for (const navigate of [false, true]) {
    let capturedPath, transfers = 0;
    const errors = [], noop = () => {};
    const window = { location: { pathname: "/app/smoke" }, __capCaptureNetworkJson: async expected => {
      capturedPath = expected;
      if (expected !== window.location.pathname) throw new Error("The conversation changed during capture.");
      return { text, messageTurnCount: 2 };
    } };
    const sandbox = vm.createContext({ window, currentPlatform: { id: "gemini", name: "Gemini" },
      claudeJsonCaptureEnabled: false, chatGptJsonCaptureEnabled: false, networkJsonCaptureEnabled: true,
      isRunning: false, runningResetTimer: null, RUNNING_AUTO_RESET_MS: 360000, DESTINATION_SHEET_EXIT_MS: 0,
      NO_CONVERSATION_ERROR_MESSAGE: "No conversation", createTransferTrace: () => ({}),
      startTransferTelemetry: noop, markTransferTrace: noop, finishTransferTrace: noop,
      getDetectedConversationMessageCount: () => 0, hideDestinationSheet: noop, delay: async () => {},
      showErrorOverlay: error => errors.push(error), clearRunningResetTimer: noop, resetRunningFlag: noop,
      setTimeout: () => 1, transitionDestinationSheetToHandoff: async () => { if (navigate) window.location.pathname = "/app/other"; },
      showOverlay: noop, releaseDestinationSheetBackdrop: noop, prepareDestinationTab: async () => ({}),
      advanceTransferTelemetryStage: noop, prepareSourceForCapture: () => { throw new Error("DOM capture must not run"); },
      setHandoffProgress: noop, createConversationCapture: value => value, markCaptureDone: noop,
      runContextFlow: () => { transfers++; }, getSafeTelemetryFailureReason: () => "capture_failed" });
    vm.runInContext(source.slice(start, end), sandbox);
    await sandbox.startDestinationTransfer("claude");
    assert.equal(capturedPath, "/app/smoke");
    assert.equal(transfers, navigate ? 0 : 1);
    assert.deepEqual(errors, navigate ? ["The conversation changed during capture."] : []);
  }
});
test("DeepSeek preserves a UTF-8 BOM in an original text file", async () => {
  const f = fixtures("deepseek"); f.files[f.file.id] = "\uFEFF" + f.files[f.file.id]; f.file.file_size += 3;
  const h = setup("deepseek", f); await h.observe();
  const capture = await h.window.__capCaptureNetworkJson();
  assert.ok(capture.text.includes("User: \uFEFF" + prompt));
});
test("DeepSeek pins the clicked chat and rejects navigation gaps without reading a different chat", async () => {
  const phases = ["before", "pong", "response"];
  const checks = await Promise.allSettled(phases.map(async phase => {
    let h;
    h = setup("deepseek", fixtures("deepseek", phase === "before" ? "other" : "smoke"), { beforeMessage: message => {
      if (message.type === phase) { h.navigate("/a/chat/s/other"); h.navigate("/a/chat/s/smoke"); }
    } });
    await h.observe();
    if (phase === "before") h.navigate("/a/chat/s/other");
    await assert.rejects(h.window.__capCaptureNetworkJson("/a/chat/s/smoke"), /conversation changed/);
    assert.equal(h.requests.length, phase === "response" ? 2 : 0);
    assert.equal(h.navigationListeners(), 0);
    assert.equal(h.listeners.size, 1);
  }));
  assert.deepEqual(checks.map((result, index) => result.status === "fulfilled" ? "passed" : `${phases[index]}: ${result.reason.message}`), ["passed", "passed", "passed"]);
});
test("DeepSeek captures supported original code/data uploads instead of dropping the user turn", async () => {
  for (const name of ["notes.txt", "source.py", "source.JS", "settings.yaml", "query.sql"]) {
    const f = fixtures("deepseek", "smoke", 1);
    f.file.file_name = name;
    const code = '\uFEFF  print("a\u00a0b")  \r\n# original source\r\n';
    f.files[f.file.id] = code; f.file.file_size = Buffer.byteLength(code);
    const h = setup("deepseek", f); await h.observe();
    const capture = await h.window.__capCaptureNetworkJson();
    assert.equal(capture.text, `DeepSeek conversation:\n\nUser: ${code}\n\nAssistant: ${f.data.data.biz_data.chat_messages[1].fragments[0].content}`);
    assert.equal(capture.messageTurnCount, 2);
    assert.equal(h.requests.filter(request => request.url.hostname === "files.deepseeksvc.com").length, 1);
    assert.doesNotMatch(JSON.stringify(h.replies), /AUTH_SENTINEL|SIGNED_SENTINEL/);
  }
});
test("DeepSeek upgrades the old MAIN contract while retaining auth for code uploads", async () => {
  let h, installs = 0;
  h = setup("deepseek", fixtures("deepseek"), { runtime: { sendMessage: async () => {
    installs++; h.reinstall(files[1]); return { ok: true };
  } } });
  const source = fs.readFileSync(path.join(__dirname, "..", "extension", files[1]), "utf8");
  vm.runInContext(source.replace('const version = platform === "grok" ? 1 : 2', "const version = 1"), h.context);
  await h.observe();
  assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
  assert.equal(installs, 1);
  assert.equal(h.window.__capNetworkFetchState.version, 2);
  assert.equal(h.listeners.size, 1);
});
test("DeepSeek picker pins chat before handoff and preserves original uploaded code through metrics", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "extension", "platform-content.js"), "utf8");
  const captureStart = source.indexOf("  function createConversationCapture(text, metrics = {})");
  const captureEnd = source.indexOf("  function getConversationCaptureMetrics", captureStart);
  const cleanStart = source.indexOf("  function cleanText(text)");
  const cleanEnd = source.indexOf("  function isVisible", cleanStart);
  const metrics = vm.createContext({ lastConversationCaptureMetrics: null });
  vm.runInContext(source.slice(cleanStart, cleanEnd) + source.slice(captureStart, captureEnd), metrics);
  const text = 'DeepSeek conversation:\n\nUser: \uFEFF  print("a\u00a0b")  \r\n\nAssistant: Answer';
  assert.equal(metrics.createConversationCapture(text, { method: "deepseek-json" }), text);
  const start = source.indexOf("  async function startDestinationTransfer(destinationId)");
  const end = source.indexOf("  function protectOverlayPalette", start);
  for (const navigate of [false, true]) {
    let capturedPath, transfers = 0;
    const errors = [], noop = () => {};
    const window = { location: { pathname: "/a/chat/s/smoke" }, __capCaptureNetworkJson: async expected => {
      capturedPath = expected;
      if (expected !== window.location.pathname) throw new Error("The conversation changed during capture.");
      return { text, messageTurnCount: 2 };
    } };
    const sandbox = vm.createContext({ window, currentPlatform: { id: "deepseek", name: "DeepSeek" },
      claudeJsonCaptureEnabled: false, chatGptJsonCaptureEnabled: false, networkJsonCaptureEnabled: true,
      isRunning: false, runningResetTimer: null, RUNNING_AUTO_RESET_MS: 360000, DESTINATION_SHEET_EXIT_MS: 0,
      NO_CONVERSATION_ERROR_MESSAGE: "No conversation", createTransferTrace: () => ({}),
      startTransferTelemetry: noop, markTransferTrace: noop, finishTransferTrace: noop,
      getDetectedConversationMessageCount: () => 0, hideDestinationSheet: noop, delay: async () => {},
      showErrorOverlay: error => errors.push(error), clearRunningResetTimer: noop, resetRunningFlag: noop,
      setTimeout: () => 1, transitionDestinationSheetToHandoff: async () => { if (navigate) window.location.pathname = "/a/chat/s/other"; },
      showOverlay: noop, releaseDestinationSheetBackdrop: noop, prepareDestinationTab: async () => ({}),
      advanceTransferTelemetryStage: noop, prepareSourceForCapture: () => { throw new Error("DOM capture must not run"); },
      setHandoffProgress: noop, createConversationCapture: value => value, markCaptureDone: noop,
      runContextFlow: () => { transfers++; }, getSafeTelemetryFailureReason: () => "capture_failed" });
    vm.runInContext(source.slice(start, end), sandbox);
    await sandbox.startDestinationTransfer("claude");
    assert.equal(capturedPath, "/a/chat/s/smoke");
    assert.equal(transfers, navigate ? 0 : 1);
    assert.deepEqual(errors, navigate ? ["The conversation changed during capture."] : []);
  }
});
test("Grok rejects camelCase pagination and advertised missing counts", () => {
  for (const flag of [{ hasMore: true }, { nextCursor: "next" }, { isComplete: false }, { totalCount: 1000 }]) {
    const h = setup("grok"); Object.assign(h.fixture.nodes, flag);
    assert.throws(() => h.api.grokBranch(h.fixture.nodes), /Incomplete|missing/);
  }
});
for (const platform of ["gemini", "grok", "deepseek"]) {
  test(`${platform}: a missing MAIN hook recovers on demand without requiring a worker callback to prove readiness`, async () => {
    let h, installs = 0;
    h = setup(platform, fixtures(platform), { runtime: { sendMessage: async message => {
      assert.equal(message.type, "ENSURE_NETWORK_JSON_HOOK"); installs++;
      h.reinstall(files[1]); await h.observe();
      return new Promise(() => {}); // Live pong must win over this stalled reply.
    } } });
    await h.observe(); h.window.__capNetworkFetchState.dispose(); delete h.window.__capNetworkFetchState;
    assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
    assert.equal(installs, 1); assert.equal(h.listeners.size, 1);
  });
}
test("DeepSeek aborts an active capture when the native session credential changes", async () => {
  const h = setup("deepseek", fixtures("deepseek"), { fetchImpl: async request => {
    if (!request.url.pathname.includes("history_messages")) return new Response("{}");
    return new Promise((resolve, reject) => request.options.signal.addEventListener("abort", () => reject(new Error("native private error")), { once: true }));
  } });
  await h.observe(); const pending = h.window.__capCaptureNetworkJson();
  await new Promise(resolve => setImmediate(resolve));
  await h.window.fetch("/api/v0/session", { headers: { authorization: "Bearer NEW_SESSION" } });
  await assert.rejects(pending, /could not be read|cancelled/);
  assert.ok(h.replies.every(reply => !reply.capture));
});
test("Native fetch errors cannot expose private strings as adapter error messages", async () => {
  const h = setup("grok", fixtures("grok"), { fetchImpl: async () => { throw new Error("The PRIVATE_SESSION_AND_FILE_URL_SENTINEL failed."); } });
  await assert.rejects(h.window.__capCaptureNetworkJson(), /could not be read completely/);
  assert.doesNotMatch(JSON.stringify(h.replies), /PRIVATE_SESSION_AND_FILE_URL_SENTINEL/);
});
