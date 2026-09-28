const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { webcrypto } = require("node:crypto");
const chat = "test-chat";
const fullUrl = `https://chatgpt.com/backend-api/conversation/${chat}`;
function fixture() {
  const message = (role, parts) => ({ author: { role }, recipient: "all", content: { content_type: "text", parts } });
  return { conversation_id: chat, current_node: "answer", mapping: {
    root: { parent: null, message: null },
    question: { parent: "root", message: message("user", ["Question"]) },
    alternate: { parent: "question", message: message("assistant", ["Wrong branch"]) },
    answer: { parent: "question", message: message("assistant", ["Selected answer"]) }
  }, page_info: { has_previous_page: false, has_next_page: false } };
}
function setup(data = fixture(), status = 200, { headers = {}, body, fetchImpl, runtime, schedule = setTimeout } = {}) {
  const listeners = new Set();
  const popListeners = new Set();
  const navListeners = new Set();
  const requests = [];
  const replies = [];
  const pings = [];
  let reads = 0;
  const location = { origin: "https://chatgpt.com", href: `https://chatgpt.com/c/${chat}`, pathname: `/c/${chat}` };
  const window = {
    fetch: async (url, options) => {
      const request = { url: url instanceof Request ? url.url : String(url), options };
      requests.push(request);
      if (fetchImpl) return fetchImpl(request, requests.length);
      const response = new Response(body ?? JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
      const json = response.json.bind(response);
      response.json = () => { reads++; return json(); };
      return response;
    },
    navigation: { addEventListener: (_type, fn) => navListeners.add(fn), removeEventListener: (_type, fn) => navListeners.delete(fn) },
    addEventListener: (type, listener) => (type === "message" ? listeners : popListeners).add(listener),
    removeEventListener: (type, listener) => (type === "message" ? listeners : popListeners).delete(listener),
    postMessage: data => { if (data.type === "response") replies.push(data); if (data.type === "ping") pings.push(data); queueMicrotask(() => [...listeners].forEach(listener => listener({ source: window, origin: location.origin, data }))); }
  };
  const context = vm.createContext({ window, location, chrome: runtime ? { runtime } : undefined, URL, Headers, Request, TextEncoder, AbortController, crypto: webcrypto, setTimeout: schedule, clearTimeout });
  const reinstall = (file = "chatgpt-fetch-main.js") => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8"), context);
  for (const file of ["chatgpt-fetch-main.js", "chatgpt-json-capture.js"]) reinstall(file);
  return { window, location, requests, replies, pings, reads: () => reads, reinstall,
    emitMessage: event => [...listeners].forEach(listener => listener(event)),
    listeners: () => listeners.size,
    navigate: pathname => { for (const fn of navListeners) fn({ destination: { url: location.origin + pathname } }); location.pathname = pathname; }
  };
}
async function discover(harness) {
  await harness.window.fetch(new Request(`https://chatgpt.com/backend-api/conversations/${chat}?num_turns=10`, { headers: { Authorization: "Bearer TEST_ONLY", "ChatGPT-Account-Id": "test-account" } }));
}

// Native canvas format observed in both older code.text and newer text.parts
// messages. The tool acknowledgement contains identity, never the document body.
function addCanvas(data, { command = "create_textdoc", payload, type = "document", format = "text", id = "canvas" } = {}) {
  const call = { author: { role: "assistant" }, recipient: `canmore.${command}`, status: "finished_successfully", end_turn: false,
    metadata: { is_complete: true }, content: format === "code" ? { content_type: "code", text: JSON.stringify(payload) } : { content_type: "text", parts: [JSON.stringify(payload)] } };
  const result = { author: { role: "tool", name: `canmore.${command}` }, recipient: "all", status: "finished_successfully",
    content: { content_type: "text", parts: ["TOOL_ACK_SENTINEL"] }, metadata: { command, canvas: { textdoc_id: "test-document", textdoc_type: type, version: 1 } } };
  data.mapping[id] = { parent: data.mapping.answer.parent, message: call };
  data.mapping[`${id}-result`] = { parent: id, message: result };
  data.mapping.answer.parent = `${id}-result`;
  return { call, result };
}

test("ChatGPT preserves complete long canvas documents in their owning assistant turn", async () => {
  const body = `CANVAS_START\n${"  exact document text\n".repeat(1000)}CANVAS_MIDDLE\n${"  remaining lines\n".repeat(1000)}CANVAS_END\n`;
  for (const [format, type] of [["text", "document"], ["code", "code/html"]]) {
    const data = fixture();
    addCanvas(data, { format, type, payload: { name: "Document title", type, content: body, extra: "PARAM_SENTINEL" } });
    const harness = setup(data); await discover(harness);
    const capture = await harness.window.__capCaptureChatGptJson();
    assert.equal(capture.text, `ChatGPT conversation:\n\nUser: Question\n\nAssistant: Canvas: Document title\n\n${body}\n\nAssistant: Selected answer`);
    assert.equal(capture.messageTurnCount, 3);
    assert.doesNotMatch(capture.text, /TOOL_ACK_SENTINEL|PARAM_SENTINEL|canmore|textdoc_id/);
  }
});

test("ChatGPT captures canvas rewrites and partial edit text without importing edit patterns", async () => {
  const data = fixture();
  addCanvas(data, { payload: { name: "Draft", type: "document", content: "Initial document" } });
  const rewrite = `REWRITE_START\n${"  edited document line\n".repeat(1000)}REWRITE_END\n`;
  addCanvas(data, { id: "rewrite", command: "update_textdoc", payload: { updates: [{ pattern: ".*", multiple: false, replacement: rewrite }] } });
  addCanvas(data, { id: "patch", command: "update_textdoc", payload: { updates: [
    { pattern: "PATTERN_SENTINEL", multiple: true, replacement: "New paragraph" },
    { pattern: "(a+)+$", replacement: "  New code\n" }, { pattern: "deleted text", replacement: "" }
  ] } });
  const harness = setup(data); await discover(harness);
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.equal(capture.text, `ChatGPT conversation:\n\nUser: Question\n\nAssistant: Canvas: Draft\n\nInitial document\n\nAssistant: Canvas edit:\n\n${rewrite}\n\nAssistant: Canvas edit:\n\nNew paragraph\n\nCanvas edit:\n\n  New code\n\n\nAssistant: Selected answer`);
  assert.equal(capture.messageTurnCount, 5);
  assert.doesNotMatch(capture.text, /PATTERN_SENTINEL|TOOL_ACK_SENTINEL|replacement|multiple/);
});

test("ChatGPT keeps modern long writing blocks as direct own text and skips their uploaded source", async () => {
  const data = fixture();
  const text = `Here is the document:\n:::writing{variant="document" id="123" title="Draft"}\nSTART_MARKER\n${"Long paragraph\n".repeat(500)}MIDDLE_MARKER\n${"Last paragraph\n".repeat(500)}END_MARKER\n:::`;
  data.mapping.answer.message.content.parts = [text];
  data.mapping.question.message.metadata = { attachments: [{ is_big_paste: true, mime_type: "text/plain", content: "UPLOAD_SENTINEL" }] };
  const harness = setup(data); await discover(harness);
  assert.equal((await harness.window.__capCaptureChatGptJson()).text, `ChatGPT conversation:\n\nUser: Question\n\nAssistant: ${text}`);
});

test("ChatGPT canvas exception excludes other tools, inactive documents and unconfirmed operations", async () => {
  for (const mutate of [
    (d, c) => { c.call.recipient = "web_search"; },
    (d, c) => { c.call.recipient = "memory_tool"; },
    (d, c) => { c.call.recipient = "canmore.comment_textdoc"; },
    (d, c) => { c.call.author.role = "user"; },
    (d, c) => { c.call.metadata.is_visually_hidden_from_conversation = true; },
    (d, c) => { c.result.status = "failed"; },
    (d, c) => { c.result.author.name = "web_search"; },
    (d, c) => { c.result.metadata.command = "other"; },
    (d, c) => { c.result.metadata.canvas.textdoc_type = "image"; },
    (d, c) => { c.result.metadata.canvas.textdoc_type = 2; },
    (d, c) => { delete c.result.metadata.canvas; },
    d => { d.mapping.answer.parent = "question"; },
    d => { d.mapping.answer.parent = "canvas"; }
  ]) {
    const data = fixture();
    const canvas = addCanvas(data, { payload: { name: "Draft", type: "document", content: "CANVAS_SENTINEL" } });
    mutate(data, canvas);
    const harness = setup(data); await discover(harness);
    assert.equal((await harness.window.__capCaptureChatGptJson()).text, "ChatGPT conversation:\n\nUser: Question\n\nAssistant: Selected answer");
  }
});

test("ChatGPT rejects malformed or truncated acknowledged canvas text instead of silently omitting it", async () => {
  for (const mutate of [
    c => { c.call.content.parts = ["{BROKEN_JSON"]; },
    c => { c.call.content.parts = [{ content: "NESTED_SENTINEL" }]; },
    c => { c.call.content.parts = [JSON.stringify({ name: "Draft", type: "document", content: {} })]; },
    c => { c.call.content.parts = [JSON.stringify({ name: "Draft", type: "code/python", content: "text" })]; },
    c => { c.call.metadata.is_complete = false; },
    c => { c.call.content.truncated = true; },
    c => { c.call.status = "in_progress"; }
  ]) {
    const data = fixture(); const canvas = addCanvas(data, { payload: { name: "Draft", type: "document", content: "text" } }); mutate(canvas);
    const harness = setup(data); await discover(harness);
    await assert.rejects(harness.window.__capCaptureChatGptJson(), /ChatGPT JSON capture blocked/);
  }
  for (const payload of [{}, { updates: [] }, { updates: [{ replacement: {} }] }, { updates: [{ replacement: "text", truncated: true }] }]) {
    const data = fixture(); addCanvas(data, { command: "update_textdoc", payload });
    const harness = setup(data); await discover(harness);
    await assert.rejects(harness.window.__capCaptureChatGptJson(), /ChatGPT JSON capture blocked/);
  }
});

test("ChatGPT canvas-only text succeeds, empty documents are skipped and canvas respects size limits", async () => {
  const data = fixture(); data.mapping.question.message.content.parts = []; data.mapping.answer.message.content.parts = [];
  const canvas = addCanvas(data, { payload: { name: "Draft", type: "document", content: "Only document text" } });
  const harness = setup(data); await discover(harness);
  assert.equal((await harness.window.__capCaptureChatGptJson()).messageTurnCount, 1);
  for (const [body, reason] of [[" \n", /No usable user or assistant text/], ["x".repeat(350000), /350,000/]]) {
    canvas.call.content.parts = [JSON.stringify({ name: "Draft", type: "document", content: body })];
    const variant = setup(data); await discover(variant);
    await assert.rejects(variant.window.__capCaptureChatGptJson(), reason);
  }
});

test("ChatGPT JSON hook reads only on demand and always requests the authenticated full tree", async () => {
  const harness = setup();
  await discover(harness);
  assert.equal(harness.reads(), 0);
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.equal(capture.text, "ChatGPT conversation:\n\nUser: Question\n\nAssistant: Selected answer");
  assert.equal(capture.messageTurnCount, 2);
  assert.equal(harness.requests[1].url, `/backend-api/conversation/${chat}`);
  assert.equal(harness.requests[1].options.headers.get("authorization"), "Bearer TEST_ONLY");
  assert.equal(harness.requests[1].options.headers.get("chatgpt-account-id"), "test-account");
  assert.equal(harness.requests[1].options.credentials, "same-origin");
  assert.equal(harness.reads(), 1);
  assert.doesNotMatch(capture.text, /TEST_ONLY|Wrong branch/);
});

test("ChatGPT JSON capture rejects previous/missing indicators, recent pages and broken branches", async () => {
  for (const mutate of [
    data => { data.page_info.has_previous_page = true; },
    data => { data.page_info.has_next_page = true; },
    data => { data.has_more = true; },
    data => { data.missing_message_ids = ["missing"]; },
    data => { data.metadata = { is_partial: true }; },
    data => { data.pagination = { is_complete: false }; },
    data => { data.context_truncation_continuation = {}; },
    data => { delete data.mapping; data.messages = []; },
    data => { data.mapping.question.parent = "missing"; },
    data => { data.mapping.question.parent = "answer"; },
    data => { delete data.mapping.root.parent; },
    data => { delete data.mapping.question.message; }
  ]) {
    const data = fixture(); mutate(data);
    const harness = setup(data); await discover(harness);
    await assert.rejects(harness.window.__capCaptureChatGptJson(), /ChatGPT JSON capture blocked/);
  }
});

test("ChatGPT JSON capture never extracts nested tool/file/image/artifact text", async () => {
  const data = fixture();
  data.mapping.question.message.content = { content_type: "multimodal_text", parts: ["Own prompt", { content_type: "image_asset_pointer", text: "IMAGE_SENTINEL" }] };
  data.mapping.question.message.metadata = { attachments: [{ text: "FILE_SENTINEL" }] };
  data.mapping.tool = { parent: "question", message: { author: { role: "tool" }, content: { content_type: "text", parts: ["TOOL_SENTINEL"] } } };
  data.mapping.answer.parent = "tool";
  data.mapping.answer.message.content.parts = ["Own answer", { type: "tool_result", content: [{ type: "text", text: "NESTED_SENTINEL" }] }, { type: "artifact", text: "ARTIFACT_SENTINEL" }];
  const harness = setup(data); await discover(harness);
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.equal(capture.text, "ChatGPT conversation:\n\nUser: Own prompt\n\nAssistant: Own answer");
});

test("ChatGPT JSON capture skips empty turns but fails a wholly empty transcript", async () => {
  const data = fixture();
  data.mapping.question.message.content = { content_type: "image", parts: [{ text: "NESTED" }] };
  const harness = setup(data); await discover(harness);
  assert.equal((await harness.window.__capCaptureChatGptJson()).messageTurnCount, 1);
  data.mapping.answer.message.recipient = "web_search";
  const empty = setup(data); await discover(empty);
  await assert.rejects(empty.window.__capCaptureChatGptJson(), /No usable user or assistant text/);
});

test("ChatGPT JSON capture accepts direct own thinking and never falls back to nested objects", async () => {
  const data = fixture();
  data.mapping.answer.message.content = { content_type: "thinking", thinking: "Own thought" };
  const harness = setup(data); await discover(harness);
  assert.match((await harness.window.__capCaptureChatGptJson()).text, /Assistant: Own thought/);
});

test("ChatGPT JSON capture rejects absent auth, changed routes, HTTP failures and size overflow", async () => {
  const noAuth = setup(); await noAuth.window.fetch(fullUrl);
  await assert.rejects(noAuth.window.__capCaptureChatGptJson(), /authentication is unavailable/);
  assert.equal(noAuth.requests.length, 2);
  const moved = setup(); await discover(moved); moved.location.pathname = "/c/other";
  await assert.rejects(moved.window.__capCaptureChatGptJson(), /changed during capture/);
  const forbidden = setup(fixture(), 403); await discover(forbidden);
  await assert.rejects(forbidden.window.__capCaptureChatGptJson(), /HTTP 403/);
  const data = fixture(); data.mapping.answer.message.content.parts = ["x".repeat(350000)];
  const huge = setup(data); await discover(huge);
  await assert.rejects(huge.window.__capCaptureChatGptJson(), /350,000/);
});


function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

test("ChatGPT preserves large pasted strings, own code, reasoning recap and thoughts in the active branch", async () => {
  const data = fixture();
  const pasted = `PASTE_START\n${"  all lines and indentation\n".repeat(1600)}PASTE_END`;
  data.mapping.question.message.content.parts = [pasted];
  data.mapping.recap = { parent: "question", message: { author: { role: "assistant" }, status: "finished_successfully", content: { content_type: "reasoning_recap", content: "Own recap" } } };
  data.mapping.thought = { parent: "recap", message: { author: { role: "assistant" }, content: { content_type: "thoughts", thoughts: [{ content: "Own thought", summary: "DUPLICATE_SENTINEL", chunks: [{ text: "NESTED_SENTINEL" }], finished: true }] } } };
  data.mapping.answer.parent = "thought";
  data.mapping.answer.message.content = { content_type: "code", text: "print('own code')", language: "python" };
  const harness = setup(data); await discover(harness);
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.equal(capture.text, `ChatGPT conversation:\n\nUser: ${pasted}\n\nAssistant: Own recap\n\nAssistant: Own thought\n\nAssistant: print('own code')`);
  assert.equal(capture.messageTurnCount, 4);
});

test("ChatGPT rejects detectable truncation and malformed trees, including false-like roots", async () => {
  for (const mutate of [
    d => { d.current_node = 3; }, d => { d.current_node = ""; },
    d => { d.mapping.root.parent = false; }, d => { d.mapping.root.parent = ""; }, d => { d.mapping.root.parent = 0; },
    d => { d.mapping.answer.id = "wrong"; }, d => { d.mapping.question = []; }, d => { d.mapping.answer.message = "invalid"; }, d => { d.mapping.answer.message.id = "wrong"; },
    d => { d.metadata = []; }, d => { d.total_node_count = 100; }, d => { d.total_message_count = 100; },
    d => { d.mapping.answer.message.metadata = { is_complete: false }; },
    d => { d.mapping.answer.message.content.truncated = true; },
    d => { d.mapping.answer.message.content.parts = "missing array"; },
    d => { delete d.mapping.answer.message.content.parts; },
    d => { d.mapping.answer.message.status = "in_progress"; },
    d => { d.mapping.answer.message.end_turn = false; },
    d => { d.mapping.answer.message.recipient = "web_search"; d.mapping.answer.message.status = "in_progress"; }
  ]) {
    const data = fixture(); mutate(data);
    const harness = setup(data); await discover(harness);
    await assert.rejects(harness.window.__capCaptureChatGptJson(), /ChatGPT JSON capture blocked/);
    assert.equal(harness.listeners(), 1);
  }
});

test("ChatGPT counts the full tree and accepts a deliberately stopped terminal response", async () => {
  const data = fixture(); data.total_node_count = 4; data.total_message_count = 3;
  data.mapping.answer.message.status = "finished_partial";
  data.mapping.answer.message.metadata = { is_complete: true, finish_details: { type: "interrupted" } };
  const harness = setup(data); await discover(harness);
  assert.equal((await harness.window.__capCaptureChatGptJson()).messageTurnCount, 2);
});

test("ChatGPT transport rejects 206, content ranges, non-JSON and broken JSON without leaking bodies", async () => {
  for (const options of [{ status: 206 }, { headers: { "content-range": "bytes 0-30/500" } }, { headers: { "content-type": "text/html" } }, { body: '{PRIVATE_SENTINEL' }]) {
    const harness = setup(fixture(), options.status || 200, options); await discover(harness);
    await assert.rejects(harness.window.__capCaptureChatGptJson(), /JSON capture failed/);
    assert.doesNotMatch(JSON.stringify(harness.replies), /PRIVATE_SENTINEL|TEST_ONLY/);
  }
});

test("ChatGPT cached sidebar/project navigation reuses latest session auth without chat-specific discovery", async () => {
  const harness = setup();
  await harness.window.fetch("/backend-api/settings/user", { headers: { authorization: "Bearer current", "ChatGPT-Account-Id": "current-account" } });
  harness.location.pathname = `/g/project/c/${chat}`;
  await harness.window.fetch("/backend-api/conversations/other", { headers: { authorization: "Bearer refreshed", "ChatGPT-Account-Id": "current-account" } });
  await harness.window.__capCaptureChatGptJson();
  assert.equal(harness.requests.at(-1).url, `/backend-api/conversation/${chat}`);
  assert.equal(harness.requests.at(-1).options.headers.get("authorization"), "Bearer refreshed");
  assert.equal(harness.requests.filter(r => r.url === "/api/auth/session").length, 0);
});

test("ChatGPT late hook installation recovers session auth only on explicit capture", async () => {
  const harness = setup(fixture(), 200, { fetchImpl: request => jsonResponse(request.url === "/api/auth/session"
    ? { accessToken: "SESSION_SECRET", sessionToken: "NEVER_COPY", account: { id: "session-account" } } : fixture()) });
  assert.equal(harness.requests.length, 0);
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.deepEqual(harness.requests.map(r => r.url), ["/api/auth/session", `/backend-api/conversation/${chat}`]);
  assert.equal(harness.requests[1].options.headers.get("authorization"), "Bearer SESSION_SECRET");
  assert.equal(harness.requests[1].options.headers.get("chatgpt-account-id"), "session-account");
  assert.doesNotMatch(JSON.stringify(harness.replies), /SESSION_SECRET|NEVER_COPY|session-account/);
  assert.match(capture.text, /Selected answer/);
});

test("ChatGPT refreshes an expired bearer once but does not loop on HTTP errors", async () => {
  const harness = setup(fixture(), 200, { fetchImpl: request => {
    if (request.url === "/api/auth/session") return jsonResponse({ accessToken: "FRESH" });
    return request.options?.headers?.get("authorization") === "Bearer FRESH" ? jsonResponse(fixture()) : jsonResponse({}, 401);
  } });
  await discover(harness);
  await harness.window.__capCaptureChatGptJson();
  assert.deepEqual(harness.requests.slice(1).map(r => r.url), [`/backend-api/conversation/${chat}`, "/api/auth/session", `/backend-api/conversation/${chat}`]);
  assert.equal(harness.requests.at(-1).options.headers.get("chatgpt-account-id"), "test-account");
  const failing = setup(fixture(), 200, { fetchImpl: request => request.url === "/api/auth/session" ? jsonResponse({ accessToken: "FRESH" }) : jsonResponse({}, 401) });
  await discover(failing);
  await assert.rejects(failing.window.__capCaptureChatGptJson(), /HTTP 401/);
  assert.equal(failing.requests.length, 4);
});

test("ChatGPT reinjection preserves auth without stacking wrappers or handlers", async () => {
  const harness = setup(); await discover(harness);
  const wrapped = harness.window.fetch;
  harness.reinstall(); harness.reinstall("chatgpt-json-capture.js");
  assert.equal(harness.window.fetch, wrapped);
  let pageCalls = 0;
  harness.window.fetch = (...args) => { pageCalls++; return wrapped(...args); };
  harness.reinstall();
  await harness.window.__capCaptureChatGptJson();
  assert.equal(pageCalls, 1);
  assert.equal(harness.listeners(), 1);
});

test("ChatGPT navigation away and back aborts capture; concurrent requests reject promptly", async () => {
  let finish;
  const harness = setup(fixture(), 200, { fetchImpl: request => request.url.includes("/conversations/") ? jsonResponse(fixture()) : new Promise(resolve => { finish = resolve; }) });
  await discover(harness);
  const capture = harness.window.__capCaptureChatGptJson();
  const rejected = assert.rejects(capture, /changed during capture/);
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(harness.window.__capCaptureChatGptJson(), /Another ChatGPT JSON capture/);
  harness.navigate("/c/other"); harness.navigate(`/c/${chat}`);
  finish(jsonResponse(fixture())); await rejected;
  assert.equal(harness.listeners(), 1);
});

test("ChatGPT bridge waits for MAIN installation and fails visibly if readiness is unavailable", async () => {
  let harness;
  let ensures = 0;
  harness = setup(fixture(), 200, { runtime: { sendMessage: async message => {
    assert.equal(message.type, "ENSURE_CHATGPT_JSON_HOOK"); ensures++; harness.reinstall(); return { ok: true };
  } } });
  await discover(harness);
  harness.window.__capChatGptFetchState.dispose();
  await harness.window.__capCaptureChatGptJson();
  assert.equal(ensures, 1);
  const failed = setup(fixture(), 200, { runtime: { sendMessage: async () => ({ ok: false }) } });
  failed.window.__capChatGptFetchState.dispose();
  await assert.rejects(failed.window.__capCaptureChatGptJson(), /Fast capture isn't ready/);
  assert.equal(failed.requests.length, 0);
});

test("ChatGPT captures with an installed MAIN hook even when the worker never responds", async () => {
  let ensures = 0;
  const harness = setup(fixture(), 200, {
    schedule: (fn, ms) => setTimeout(fn, ms === 3000 ? 10 : ms),
    runtime: { sendMessage: () => { ensures++; return new Promise(() => {}); } }
  });
  await discover(harness);
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.equal(capture.text, "ChatGPT conversation:\n\nUser: Question\n\nAssistant: Selected answer");
  assert.equal(ensures, 0);
  assert.equal(harness.reads(), 1);
  assert.equal(harness.listeners(), 1);
});

test("ChatGPT recovers a delayed MAIN installation without waiting for the worker reply", async () => {
  let harness;
  let ensures = 0;
  let readsBeforeInstall;
  harness = setup(fixture(), 200, {
    schedule: (fn, ms) => setTimeout(fn, ms === 250 ? 5 : ms === 100 ? 5 : ms === 8000 ? 200 : ms),
    runtime: { sendMessage: message => {
      assert.equal(message.type, "ENSURE_CHATGPT_JSON_HOOK");
      ensures++;
      setTimeout(() => { readsBeforeInstall = harness.reads(); harness.reinstall(); }, 40);
      return new Promise(() => {});
    } }
  });
  await discover(harness);
  harness.window.__capChatGptFetchState.dispose();
  assert.equal((await harness.window.__capCaptureChatGptJson()).messageTurnCount, 2);
  assert.equal(ensures, 1);
  assert.equal(readsBeforeInstall, 0);
  assert.deepEqual(harness.requests.map(request => request.url), [
    `https://chatgpt.com/backend-api/conversations/${chat}?num_turns=10`, `/backend-api/conversation/${chat}`
  ]);
  assert.equal(harness.listeners(), 1);
});

test("ChatGPT requires a live correlated pong even if installation reports success", async () => {
  const harness = setup(fixture(), 200, {
    schedule: (fn, ms) => setTimeout(fn, ms === 250 ? 5 : ms === 8000 ? 15 : ms),
    runtime: { sendMessage: async () => ({ ok: true }) }
  });
  harness.window.__capChatGptFetchState.dispose();
  const capture = harness.window.__capCaptureChatGptJson();
  const rejected = assert.rejects(capture, /Fast capture isn't ready/);
  const id = harness.pings[0].id;
  const pong = { channel: "cap-context-chatgpt-json-v2", type: "pong", id, version: 3 };
  for (const event of [
    { source: {}, origin: harness.location.origin, data: pong },
    { source: harness.window, origin: "https://other.example", data: pong },
    { source: harness.window, origin: harness.location.origin, data: { ...pong, id: "unrelated" } },
    { source: harness.window, origin: harness.location.origin, data: { ...pong, version: 2 } },
    { source: harness.window, origin: harness.location.origin, data: { ...pong, type: "response" } }
  ]) harness.emitMessage(event);
  await rejected;
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.listeners(), 0);
});

test("ChatGPT does not capture another chat if navigation occurs during hook recovery", async () => {
  let harness;
  harness = setup(fixture(), 200, { runtime: { sendMessage: async () => {
    harness.location.pathname = "/c/other";
    harness.reinstall();
    return { ok: true };
  } } });
  harness.window.__capChatGptFetchState.dispose();
  await assert.rejects(harness.window.__capCaptureChatGptJson(), /changed during capture/);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.listeners(), 1);
});


test("ChatGPT own thoughts use visible summary only when the body is empty", async () => {
  const data = fixture();
  data.mapping.answer.message.content = { content_type: "thoughts", thoughts: [{ content: "", summary: "Visible own reasoning", finished: true }] };
  const harness = setup(data); await discover(harness);
  assert.match((await harness.window.__capCaptureChatGptJson()).text, /Visible own reasoning/);
  data.mapping.answer.message.content.thoughts[0].finished = false;
  const incomplete = setup(data); await discover(incomplete);
  await assert.rejects(incomplete.window.__capCaptureChatGptJson(), /still in progress/);
});

test("ChatGPT account switching invalidates an in-flight capture and never sends old-account data", async () => {
  let finish;
  const harness = setup(fixture(), 200, { fetchImpl: request => request.url.startsWith("/backend-api/conversation/") ? new Promise(resolve => { finish = resolve; }) : jsonResponse({}) });
  await discover(harness);
  const capture = harness.window.__capCaptureChatGptJson();
  const rejected = assert.rejects(capture, /changed during capture/);
  await new Promise(resolve => setTimeout(resolve, 0));
  await harness.window.fetch("/backend-api/settings/user", { headers: { authorization: "Bearer new-account", "chatgpt-account-id": "other-account" } });
  finish(jsonResponse(fixture())); await rejected;
  assert.ok(harness.replies.every(reply => !reply.data));
});


test("ChatGPT bounds stalled network capture and cleans the pending bridge listener", async () => {
  const harness = setup(fixture(), 200, {
    schedule: (fn, ms) => setTimeout(fn, ms === 15000 ? 10 : ms),
    fetchImpl: request => request.url.includes("/conversations/") ? jsonResponse({}) : new Promise((_, reject) => request.options.signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))))
  });
  await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), /full-tree request timed out/);
  assert.equal(harness.listeners(), 1);
  assert.ok(harness.replies.every(reply => !reply.data));
});

test("ChatGPT bounds MAIN readiness even when the worker never responds", async () => {
  const harness = setup(fixture(), 200, {
    schedule: (fn, ms) => setTimeout(fn, ms === 8000 ? 10 : ms === 250 ? 5 : ms),
    runtime: { sendMessage: () => new Promise(() => {}) }
  });
  harness.window.__capChatGptFetchState.dispose();
  await assert.rejects(harness.window.__capCaptureChatGptJson(), /Fast capture isn't ready/);
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.listeners(), 0);
});
