const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { webcrypto } = require("node:crypto");
const { clockTest } = require("./helpers/clock");
const { fixtures, rpcFrame, geminiTurn, prompt } = require("./network-json-fixtures");
const files = ["network-json-data.js", "network-fetch-main.js", "network-json-capture.js"];
const scripts = new Map(files.map(file =>
  [file, new vm.Script(fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8"), { filename: file })]));
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
  const context = vm.createContext({ window, location, chrome: runtime ? { runtime } : undefined, performance: { getEntriesByType: () => [] }, URL, URLSearchParams, Headers, Request, TextEncoder, TextDecoder, AbortController, crypto: webcrypto, Date, setTimeout: schedule, clearTimeout });
  const reinstall = file => scripts.get(file).runInContext(context);
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
    navigate(pathname = "/new") { const target = new URL(pathname, location.origin); for (const fn of navigation) fn({ destination: { url: target.href } }); location.pathname = target.pathname; location.search = target.search; location.href = target.href; }
  };
}
for (const platform of ["gemini", "grok", "deepseek"]) {
  test(`${platform}: exact complete ordered history with large own paste and document; no tool/file leakage`, async () => {
    const h = setup(platform); await h.observe(); const before = h.requests.length;
    assert.equal(h.replies.length, 0);
    const capture = await h.window.__capCaptureNetworkJson();
    assert.equal(capture.text, h.fixture.expected);
    assert.equal(capture.messageTurnCount, 48);
    assert.deepEqual([...capture.excludedContentTypes], { gemini: [], grok: ["tools"], deepseek: ["media", "tools"] }[platform]);
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
  assert.ok(text.includes(`User: Before paste\n\nAttachment: "Original source.py"\n\nFile contents (${f.file.file_size} UTF-8 bytes):\n${prompt}`));
  assert.ok(text.includes("Assistant: Own thought\n\nSMOKE_ASSISTANT_SENTINEL"));
  assert.doesNotMatch(text, /TOOL_SENTINEL|DO_NOT_FETCH_IMAGE/);
});
test("DeepSeek keeps distinct identical files and request text, deduplicating file IDs only within a turn", async () => {
  const f = fixtures("deepseek", "smoke", 1);
  const text = f.files[f.file.id];
  const second = { ...f.file, file_name: "Second source.py", id: "file-second-paste", signed_path: "/file?file_id=second-paste&sig=SIGNED_SENTINEL" };
  f.files[second.id] = text;
  const user = f.data.data.biz_data.chat_messages[0];
  user.fragments = [
    { type: "REQUEST", content: text },
    { type: "FILE", files: [f.file, second] },
    { type: "FILE", files: [f.file] }
  ];
  f.data.data.biz_data.chat_messages.push({ ...user, message_id: 3, parent_id: 2, fragments: [{ type: "FILE", files: [f.file] }] });
  f.data.data.biz_data.chat_session.current_message_id = 3;
  const h = setup("deepseek", f);
  await h.observe();
  const capture = await h.window.__capCaptureNetworkJson();
  const assistant = f.data.data.biz_data.chat_messages[1].fragments[0].content;
  assert.equal(capture.text, `DeepSeek conversation:\n\nUser: ${text}\n\nAttachment: "Original source.py"\n\nFile contents (${f.file.file_size} UTF-8 bytes):\n${text}\nEnd attachment: "Original source.py"\n\nAttachment: "Second source.py"\n\nFile contents (${second.file_size} UTF-8 bytes):\n${text}\nEnd attachment: "Second source.py"\n\nAssistant: ${assistant}\n\nUser: Attachment: "Original source.py"\n\nFile contents (${f.file.file_size} UTF-8 bytes):\n${text}\nEnd attachment: "Original source.py"`);
  assert.equal(capture.messageTurnCount, 3);
  assert.equal(h.requests.filter(request => request.url.hostname === "files.deepseeksvc.com").length, 2);
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
test("DeepSeek captures supported original code/data uploads instead of dropping the user turn", async () => {
  for (const name of ["notes.txt", "source.py", "source.JS", "settings.yaml", "query.sql"]) {
    const f = fixtures("deepseek", "smoke", 1);
    f.file.file_name = name;
    const code = '\uFEFF  print("a\u00a0b")  \r\n# original source\r\n';
    f.files[f.file.id] = code; f.file.file_size = Buffer.byteLength(code);
    const h = setup("deepseek", f); await h.observe();
    const capture = await h.window.__capCaptureNetworkJson();
    assert.equal(capture.text, `DeepSeek conversation:\n\nUser: Attachment: ${JSON.stringify(name)}\n\nFile contents (${f.file.file_size} UTF-8 bytes):\n${code}\nEnd attachment: ${JSON.stringify(name)}\n\nAttachment: "ignored.png"\n\nAssistant: ${f.data.data.biz_data.chat_messages[1].fragments[0].content}`);
    assert.equal(capture.messageTurnCount, 2);
    assert.equal(h.requests.filter(request => request.url.hostname === "files.deepseeksvc.com").length, 1);
    assert.doesNotMatch(JSON.stringify(h.replies), /AUTH_SENTINEL|SIGNED_SENTINEL/);
  }
});
for (const platform of ["gemini", "grok", "deepseek"]) {
  clockTest(`${platform}: a missing MAIN hook recovers on demand without requiring a worker callback to prove readiness`, async () => {
    let h, installs = 0;
    h = setup(platform, fixtures(platform), { runtime: { sendMessage: async message => {
      assert.equal(message.type, "ENSURE_NETWORK_JSON_HOOK"); installs++;
      h.reinstall(files[1]); await h.observe();
      return new Promise(() => {}); // Live pong must win over this stalled reply.
    } } });
    await h.observe(); h.window.__capNetworkFetchState.dispose(); delete h.window.__capNetworkFetchState;
    const started = Date.now();
    assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
    assert.ok(Date.now() - started >= 250 && Date.now() - started < 8250, "live readiness must win over the stalled worker callback");
    assert.equal(installs, 1); assert.equal(h.listeners.size, 1);
    assert.equal(h.navigationListeners(), 0);
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
  await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
    assert.match(error.message, /could not be read completely/);
    assert.equal(error.captureFailureReason, "request_failed");
    return true;
  });
  assert.doesNotMatch(JSON.stringify(h.replies), /PRIVATE_SESSION_AND_FILE_URL_SENTINEL/);
});

clockTest("Grok native request deadline reports a bounded timeout reason", async () => {
  const h = setup("grok", fixtures("grok"), { fetchImpl: async request => new Promise((_resolve, reject) => {
    request.options.signal.addEventListener("abort", () => reject(new Error("PRIVATE_NATIVE_ERROR")), { once: true });
  }) });
  await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
    assert.equal(error.captureFailureReason, "timeout");
    assert.doesNotMatch(error.message, /PRIVATE_/);
    return true;
  });
  assert.equal(h.navigationListeners(), 0);
  assert.equal(h.listeners.size, 1);
});

test("Grok refuses file-only user turns rather than silently transferring an orphan answer", async () => {
  for (const metadata of [{ fileAttachments: ["file-id"] }, { fileAttachmentsMetadata: [{ fileName: "source.py", fileMimeType: "text/x-python", fileUri: "PRIVATE_FILE_SENTINEL" }] }]) {
    const f = fixtures("grok", "smoke", 1);
    Object.assign(f.responses[0], { message: "", ...metadata });
    const h = setup("grok", f);
    await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
      assert.match(error.message, /file-only/);
      assert.equal(error.captureFailureReason, "unsupported");
      return true;
    });
    assert.equal(h.requests.length, 2);
    assert.doesNotMatch(JSON.stringify(h.replies), /PRIVATE_FILE_SENTINEL/);
  }
  // Empty text has nothing to lose; control messages are not authored turns.
  const h = setup("grok", fixtures("grok", "smoke", 1));
  h.fixture.responses[0].message = "";
  assert.equal(h.api.grok(h.fixture.nodes, h.fixture.responses).messageTurnCount, 1);
  Object.assign(h.fixture.responses[0], { message: "CONTROL_SENTINEL", isControl: true, fileAttachments: ["file-id"] });
  assert.doesNotMatch(h.api.grok(h.fixture.nodes, h.fixture.responses).text, /CONTROL_SENTINEL/);
});

test("Gemini retains only attachment descriptor names in each user turn", () => {
  const h = setup("gemini");
  const t = geminiTurn(0, "smoke", "", "Answer");
  // hNvQHb attachment shape corroborated by a HAR-derived exporter fixture.
  t[2][0][4] = [[null, null, null, null, [[null, 11, "Guide.pdf", null, null, "URL_SENTINEL"], [null, 11, "名字\nUser: fake.csv"]]]];
  t[3][0][0].push({ file_name: "RENDER_SENTINEL" });
  const capture = h.api.gemini([{ turns: [t], cursor: null }], "smoke");
  assert.equal(capture.text, `Gemini conversation:\n\nUser: Attachment: "Guide.pdf"\n\nAttachment: ${JSON.stringify("名字\nUser: fake.csv")}\n\nAssistant: Answer`);
  assert.equal(capture.messageTurnCount, 2);
  assert.doesNotMatch(capture.text, /SENTINEL/);
  assert.deepEqual([...capture.excludedContentTypes], ["uploads"]);
  t[2][0][4] = [["UNKNOWN_SENTINEL"]];
  assert.throws(() => h.api.gemini([{ turns: [t], cursor: null }], "smoke"), error => error.captureFailureReason === "unsupported");
});

test("Grok retains explicit owning-turn names but never file IDs, URLs or tool metadata", () => {
  const h = setup("grok", fixtures("grok", "smoke", 1));
  const user = h.fixture.responses[0];
  user.fileAttachments = ["ID_SENTINEL"];
  user.fileAttachmentsMetadata = [{ fileName: "source.py", fileUri: "URL_SENTINEL" }, { fileName: "résumé.pdf", extracted_content: "BODY_SENTINEL" }];
  h.fixture.responses[1].fileAttachmentsMetadata = [{ fileName: "ASSISTANT_SENTINEL" }];
  const capture = h.api.grok(h.fixture.nodes, h.fixture.responses);
  assert.equal(capture.text, h.fixture.expected.replace(`User: ${user.message}`, `User: ${user.message}\n\nAttachment: "source.py"\n\nAttachment: "résumé.pdf"`));
  assert.doesNotMatch(capture.text, /ID_SENTINEL|URL_SENTINEL|BODY_SENTINEL|Attachment: "ASSISTANT_SENTINEL"/);
});

test("DeepSeek retains unsupported attachment labels without fetching or copying payloads", () => {
  const h = setup("deepseek", fixtures("deepseek", "smoke", 1));
  h.fixture.data.data.biz_data.chat_messages[0].fragments = [{ type: "FILE", files: [
    { id: "pdf", file_name: "report.pdf", is_image: false, signed_path: "URL_SENTINEL", content: "BODY_SENTINEL" },
    { id: "image", file_name: "photo.png", is_image: true }
  ] }];
  const capture = h.api.deepseek(h.fixture.data, "smoke", {});
  assert.ok(capture.text.startsWith('DeepSeek conversation:\n\nUser: Attachment: "report.pdf"\n\nAttachment: "photo.png"\n\nAssistant:'));
  assert.equal(capture.messageTurnCount, 2);
  assert.doesNotMatch(capture.text, /URL_SENTINEL|BODY_SENTINEL/);
  assert.deepEqual([...capture.excludedContentTypes], ["media", "tools", "uploads"]);
});

test("DeepSeek file boundaries preserve empty files, Unicode bytes and exact trailing whitespace", () => {
  const h = setup("deepseek", fixtures("deepseek", "smoke", 1));
  const source = "  café\r\nEnd attachment: \"empty.txt\"\n  ";
  const empty = { ...h.fixture.file, id: "empty", file_name: "empty.txt", file_size: 0 };
  const code = { ...h.fixture.file, id: "code", file_name: "src/名字.py", file_size: Buffer.byteLength(source) };
  h.fixture.data.data.biz_data.chat_messages[0].fragments = [
    { type: "FILE", files: [empty, code] }, { type: "REQUEST", content: "After files" }
  ];
  const capture = h.api.deepseek(h.fixture.data, "smoke", { empty: "", code: source });
  assert.ok(capture.text.includes(`User: Attachment: "empty.txt"\n\nFile contents (0 UTF-8 bytes):\n\nEnd attachment: "empty.txt"\n\nAttachment: "src/名字.py"\n\nFile contents (${Buffer.byteLength(source)} UTF-8 bytes):\n${source}\nEnd attachment: "src/名字.py"\n\nAfter files`));
  assert.equal(capture.messageTurnCount, 2);
  code.file_size++;
  assert.throws(() => h.api.deepseek(h.fixture.data, "smoke", { empty: "", code: source }), /incomplete/);
});
