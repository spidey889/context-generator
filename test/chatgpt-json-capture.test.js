const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { webcrypto } = require("node:crypto");
const { clockTest } = require("./helpers/clock");
// Reuse compiled code; every setup still executes it in a fresh VM with its own hook state.
const scripts = new Map(["chatgpt-fetch-main.js", "chatgpt-json-capture.js"].map(file =>
  [file, new vm.Script(fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8"), { filename: file })]));
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
function setup(data = fixture(), status = 200, { headers = {}, body, fetchImpl, runtime, schedule = setTimeout, beforeMessage } = {}) {
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
    postMessage: data => { if (data.type === "response") replies.push(data); if (data.type === "ping") pings.push(data); queueMicrotask(() => {
      beforeMessage?.(data);
      [...listeners].forEach(listener => listener({ source: window, origin: location.origin, data }));
    }); }
  };
  const context = vm.createContext({ window, location, chrome: runtime ? { runtime } : undefined, URL, Headers, Request, TextEncoder, TextDecoder, AbortController, crypto: webcrypto, Date, setTimeout: schedule, clearTimeout });
  const reinstall = (file = "chatgpt-fetch-main.js") => scripts.get(file).runInContext(context);
  for (const file of ["chatgpt-fetch-main.js", "chatgpt-json-capture.js"]) reinstall(file);
  return { window, location, requests, replies, pings, reads: () => reads, reinstall,
    emitMessage: event => [...listeners].forEach(listener => listener(event)),
    listeners: () => listeners.size,
    navigationListeners: () => navListeners.size + popListeners.size,
    navigate: pathname => { for (const fn of navListeners) fn({ destination: { url: location.origin + pathname } }); location.pathname = pathname; }
  };
}
async function discover(harness) {
  await harness.window.fetch(new Request(`https://chatgpt.com/backend-api/conversations/${chat}?num_turns=10`, { headers: { Authorization: "Bearer TEST_ONLY", "ChatGPT-Account-Id": "test-account" } }));
}

function pasteFixture(texts = ["Original pasted document"]) {
  const data = fixture();
  data.mapping.question.message.content.parts = [""];
  const files = texts.map((text, i) => ({ id: `file_test_${i}`, is_big_paste: true, mime_type: "text/plain", size: Buffer.byteLength(text), text }));
  data.mapping.question.message.metadata = { attachments: files.map(({ text, ...file }) => file) };
  const fetchImpl = async request => {
    const url = new URL(request.url, "https://chatgpt.com");
    const file = files.find(file => url.pathname === `/backend-api/files/download/${file.id}` || url.searchParams.get("id") === file.id);
    if (url.pathname.startsWith("/backend-api/files/download/")) {
      assert.equal(request.options.headers.get("authorization"), "Bearer TEST_ONLY");
      return jsonResponse({ status: "success", file_size_bytes: file.size, download_url: `https://chatgpt.com/backend-api/estuary/content?id=${file.id}&sig=SIGNED_URL_SENTINEL` });
    }
    if (url.pathname === "/backend-api/estuary/content") {
      assert.equal(request.options.headers, undefined, "Bearer headers must stay off the signed content fetch.");
      assert.equal(request.options.redirect, "error");
      return new Response(file.text, { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return jsonResponse(data);
  };
  return { data, files, fetchImpl };
}

test("ChatGPT preserves the original attachment-only user paste before the assistant's writing block", async () => {
  const original = `Create a document without shortening it.\r\n\r\nPASTE_START\r\n${"  Original line — 世界\r\n".repeat(1000)}PASTE_MIDDLE\r\n${"More original text\r\n".repeat(1000)}PASTE_END`;
  const { data, fetchImpl } = pasteFixture([original]);
  data.mapping.context = { parent: "question", message: { author: { role: "tool", name: "api_tool" }, content: { content_type: "text", parts: ["TOOL_EXTRACT_SENTINEL"] } } };
  data.mapping.answer.parent = "context";
  data.mapping.answer.message.content.parts = [':::writing{variant="document"}\nAssistant rewrite\n:::'];
  const harness = setup(data, 200, { fetchImpl }); await discover(harness);
  assert.equal(harness.requests.length, 1, "No paste is read before explicit capture.");
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.equal(capture.text, `ChatGPT conversation:\n\nUser: ${original}\n\nAssistant: :::writing{variant="document"}\nAssistant rewrite\n:::`);
  assert.equal(capture.messageTurnCount, 2);
  assert.equal(harness.requests.length, 4);
  assert.doesNotMatch(JSON.stringify(harness.replies), /TEST_ONLY|SIGNED_URL_SENTINEL/);
});

test("ChatGPT rejects navigation away and back during setup and response delivery", async () => {
  for (const phase of ["pong", "response"]) {
    let harness;
    harness = setup(fixture(), 200, { beforeMessage: payload => {
      if (payload.type !== phase) return;
      harness.navigate("/c/other"); harness.navigate(`/c/${chat}`);
    } });
    await discover(harness);
    await assert.rejects(harness.window.__capCaptureChatGptJson(), /changed during capture/);
    assert.equal(harness.requests.length, phase === "pong" ? 1 : 2);
    assert.equal(harness.listeners(), 1);
    assert.equal(harness.navigationListeners(), 0);
  }
});

test("ChatGPT pins the destination-click conversation before handoff preparation", async () => {
  const harness = setup(); await discover(harness);
  harness.navigate("/c/other");
  await assert.rejects(harness.window.__capCaptureChatGptJson(`/c/${chat}`), /changed during capture/);
  assert.equal(harness.requests.length, 1);
});

test("ChatGPT exclusions report only active-branch categories without file or tool details", async () => {
  const data = fixture();
  data.mapping.question.message.content.content_type = "multimodal_text";
  data.mapping.question.message.content.parts.push({ content_type: "image_asset_pointer", asset_pointer: "PRIVATE_IMAGE_SENTINEL" });
  data.mapping.question.message.metadata = { attachments: [{ name: "PRIVATE_FILE_SENTINEL", mime_type: "application/pdf" }] };
  data.mapping.tool = { parent: "question", message: { author: { role: "tool" }, content: { content_type: "text", parts: ["PRIVATE_TOOL_SENTINEL"] } } };
  data.mapping.answer.parent = "tool";
  data.mapping.alternate.message.content = { content_type: "PRIVATE_TYPE_SENTINEL" };
  const h = setup(data); await discover(h);
  const capture = await h.window.__capCaptureChatGptJson();
  assert.equal(capture.text, 'ChatGPT conversation:\n\nUser: Question\n\nAttachment: "PRIVATE_FILE_SENTINEL"\n\nAssistant: Selected answer');
  assert.deepEqual([...capture.excludedContentTypes], ["media", "tools", "uploads"]);
  assert.doesNotMatch(JSON.stringify(capture.excludedContentTypes), /PRIVATE_/);
  assert.doesNotMatch(capture.text, /PRIVATE_IMAGE_SENTINEL|PRIVATE_TOOL_SENTINEL|PRIVATE_TYPE_SENTINEL/);
});

test("ChatGPT preserves original whitespace in own text, code, thoughts and recap", async () => {
  const data = fixture();
  data.mapping.question.message.content.parts = ["  if enabled:\n    run()\n"];
  data.mapping.recap = { parent: "question", message: { author: { role: "assistant" }, content: { content_type: "reasoning_recap", content: "  Exact recap\n" } } };
  data.mapping.thought = { parent: "recap", message: { author: { role: "assistant" }, content: { content_type: "thoughts", thoughts: [{ content: "  Exact thought\n", finished: true }] } } };
  data.mapping.answer.parent = "thought";
  data.mapping.answer.message.content = { content_type: "code", text: "  if enabled:\n    run()\n" };
  const harness = setup(data); await discover(harness);
  assert.equal((await harness.window.__capCaptureChatGptJson()).text,
    "ChatGPT conversation:\n\nUser:   if enabled:\n    run()\n\n\nAssistant:   Exact recap\n\n\nAssistant:   Exact thought\n\n\nAssistant:   if enabled:\n    run()\n");
});

// audio_transcription is an explicit own multimodal part, verified in native
// export schemas. Pointer metadata and nested tool transcripts are excluded.
test("ChatGPT keeps multiple pastes in attachment order and preserves repeated content in later turns", async () => {
  const { data, files, fetchImpl } = pasteFixture(["First paste", "  Second paste\r\n"]);
  data.mapping.question.message.content.parts = ["Own introduction", "First paste"];
  data.mapping.next = { parent: "answer", message: { author: { role: "user" }, content: { content_type: "text", parts: [] }, metadata: { attachments: [data.mapping.question.message.metadata.attachments[0]] } } };
  data.current_node = "next";
  const harness = setup(data, 200, { fetchImpl }); await discover(harness);
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.equal(capture.text, "ChatGPT conversation:\n\nUser: Own introduction\n\nFirst paste\n\n  Second paste\r\n\n\nAssistant: Selected answer\n\nUser: First paste");
  assert.equal(harness.requests.filter(r => r.url.includes(`/files/download/${files[0].id}`)).length, 1);
});

test("ChatGPT fetches only active visible user big pastes, excluding uploads, tools and other branches", async () => {
  const { data, fetchImpl } = pasteFixture();
  const paste = data.mapping.question.message.metadata.attachments[0];
  data.mapping.alternate.message.metadata = { attachments: [{ ...paste, id: "file_inactive" }] };
  data.mapping.answer.message.metadata = { attachments: [{ ...paste, id: "file_assistant" }] };
  data.mapping.question.message.metadata.attachments.push({ ...paste, is_big_paste: false, id: "file_upload" }, { ...paste, mime_type: "image/png", id: "file_image" });
  data.mapping.tool = { parent: "question", message: { author: { role: "tool" }, metadata: { attachments: [{ ...paste, id: "file_tool" }] }, content: { content_type: "text", parts: ["TOOL_SENTINEL"] } } };
  data.mapping.hidden = { parent: "tool", message: { author: { role: "user" }, metadata: { is_visually_hidden_from_conversation: true, attachments: [{ ...paste, id: "file_hidden" }] } } };
  data.mapping.answer.parent = "hidden";
  const harness = setup(data, 200, { fetchImpl }); await discover(harness);
  assert.equal((await harness.window.__capCaptureChatGptJson()).text, "ChatGPT conversation:\n\nUser: Original pasted document\n\nAssistant: Selected answer");
  assert.equal(harness.requests.length, 4);
});

test("ChatGPT fails visibly on missing, partial, wrong-file or invalid pasted text", async () => {
  for (const badResponse of [
    request => request.url.includes("/files/download/") ? new Response("Denied", { status: 403 }) : null,
    request => request.url.includes("/files/download/") ? jsonResponse({ status: "success", file_size_bytes: 5, download_url: "https://chatgpt.com/backend-api/estuary/content?id=file_test_0" }) : null,
    request => request.url.includes("/files/download/") ? jsonResponse({ status: "success", file_size_bytes: 24, download_url: "https://other.example/private?id=file_test_0" }) : null,
    request => request.url.includes("/files/download/") ? jsonResponse({ status: "success", file_size_bytes: 24, download_url: "https://chatgpt.com/backend-api/estuary/content?id=file_wrong" }) : null,
    request => request.url.includes("/estuary/content") ? new Response("Original pasted document", { status: 206, headers: { "content-type": "text/plain" } }) : null,
    request => request.url.includes("/estuary/content") ? new Response("Original pasted document", { headers: { "content-type": "text/plain", "content-range": "bytes 0-23/100" } }) : null,
    request => request.url.includes("/estuary/content") ? new Response("Truncated", { headers: { "content-type": "text/plain" } }) : null,
    request => request.url.includes("/estuary/content") ? new Response("Original pasted document", { headers: { "content-type": "text/html" } }) : null,
    request => request.url.includes("/estuary/content") ? new Response(new Uint8Array(24).fill(255), { headers: { "content-type": "text/plain" } }) : null
  ]) {
    const { data, fetchImpl } = pasteFixture();
    const harness = setup(data, 200, { fetchImpl: request => badResponse(request) || fetchImpl(request) }); await discover(harness);
    await assert.rejects(harness.window.__capCaptureChatGptJson(), /pasted text attachment could not be read completely/);
    assert.equal(harness.replies.at(-1).data, undefined, "An incomplete paste must not produce a successful tree response.");
    assert.doesNotMatch(JSON.stringify(harness.replies), /TEST_ONLY|SIGNED_URL_SENTINEL|Denied|Truncated/);
  }
});

test("ChatGPT validates paste byte counts, truncation flags and transcript size without dropping the user", async () => {
  for (const mutate of [
    (data, files) => { data.mapping.question.message.metadata.attachments[0].size--; },
    data => { data.mapping.question.message.metadata.attachments[0].truncated = true; },
    data => { data.mapping.question.message.metadata.attachments[0].id = "../outside"; },
    data => { data.mapping.question.message.metadata.attachments[0].size = 1400001; }
  ]) {
    const { data, files, fetchImpl } = pasteFixture(); mutate(data, files);
    const harness = setup(data, 200, { fetchImpl }); await discover(harness);
    await assert.rejects(harness.window.__capCaptureChatGptJson(), /JSON capture|350,000/);
  }
  const { data, fetchImpl } = pasteFixture(["x".repeat(350000)]);
  const harness = setup(data, 200, { fetchImpl }); await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), /350,000/);
});

// Native format inspected in the owner's synthetic table chat on 2026-10-05:
// a Python code call followed by execution_output.text, outside the final reply.
function addPythonResult(data, text = "  Test code Item  Value\n0  JV3XLMSP    A   6791\n1  JV3XLMSP    B   3197\n2  JV3XLMSP    C   7083") {
  const call = { author: { role: "assistant" }, recipient: "python", channel: "commentary", status: "finished_successfully",
    content: { content_type: "code", text: "PRIVATE_CODE_SENTINEL", language: "unknown" }, metadata: { is_complete: true } };
  const result = { author: { role: "tool", name: "python" }, recipient: "all", channel: "commentary", status: "finished_successfully",
    content: { content_type: "execution_output", text }, metadata: { is_complete: true, aggregate_result: { text: "NESTED_SENTINEL" }, ada_visualizations: [{ url: "PRIVATE_URL_SENTINEL" }] } };
  data.mapping.python = { parent: data.mapping.answer.parent, message: call };
  data.mapping.pythonResult = { parent: "python", message: result };
  data.mapping.answer.parent = "pythonResult";
  return { call, result };
}

test("ChatGPT preserves completed Python Analysis results exactly without code or visualization metadata", async () => {
  const data = fixture();
  const output = "  Test code Item  Value\r\n0  JV3XLMSP    A   6791\r\n1  JV3XLMSP    B   3197\r\n2  JV3XLMSP    C   7083  \r\n";
  addPythonResult(data, output);
  data.mapping.answer.message.content.parts = ["The table is ready."];
  const h = setup(data); await discover(h);
  const capture = await h.window.__capCaptureChatGptJson();
  assert.equal(capture.text, `ChatGPT conversation:\n\nUser: Question\n\nAssistant: Python result:\n\n${output}\n\nAssistant: The table is ready.`);
  assert.equal(capture.messageTurnCount, 3);
  assert.doesNotMatch(capture.text, /PRIVATE_|NESTED_/);
  assert.equal(h.requests.length, 2, "Python results need no additional file or tool fetch.");
});

test("ChatGPT Python results exclude other tools, hidden or unpaired output and inactive branches", async () => {
  for (const mutate of [
    (_d, p) => { p.result.author.name = "web_search"; },
    (_d, p) => { p.call.recipient = "web_search"; },
    (_d, p) => { p.call.author.role = "user"; },
    (_d, p) => { p.call.content.content_type = "text"; },
    (_d, p) => { p.call.metadata.is_visually_hidden_from_conversation = true; },
    (_d, p) => { p.result.metadata.is_visually_hidden_from_conversation = true; },
    (_d, p) => { p.result.recipient = "python"; },
    (_d, p) => { p.result.status = "failed"; },
    (_d, p) => { p.call.status = "in_progress"; },
    (_d, p) => { p.result.content = { content_type: "text", parts: ["PRIVATE_RESULT_SENTINEL"] }; },
    d => { d.mapping.pythonResult.parent = "question"; },
    d => { d.mapping.answer.parent = "question"; }
  ]) {
    const data = fixture(); const p = addPythonResult(data, "PRIVATE_RESULT_SENTINEL"); mutate(data, p);
    const h = setup(data); await discover(h);
    assert.equal((await h.window.__capCaptureChatGptJson()).text, "ChatGPT conversation:\n\nUser: Question\n\nAssistant: Selected answer");
  }
});

test("ChatGPT rejects malformed, truncated and oversized recognized Python result text", async () => {
  for (const mutate of [
    p => { p.result.content.text = { text: "PRIVATE_RESULT_SENTINEL" }; },
    p => { delete p.result.content.text; },
    p => { p.result.content.truncated = true; },
    p => { p.result.metadata.is_complete = false; },
    p => { p.call.metadata.is_complete = false; }
  ]) {
    const data = fixture(); const p = addPythonResult(data); mutate(p);
    const h = setup(data); await discover(h);
    await assert.rejects(h.window.__capCaptureChatGptJson(), /ChatGPT JSON capture blocked/);
  }
  const data = fixture(); addPythonResult(data, "x".repeat(350000));
  const h = setup(data); await discover(h);
  await assert.rejects(h.window.__capCaptureChatGptJson(), /350,000/);
});

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

test("ChatGPT transport rejects 206, content ranges, non-JSON and broken JSON without leaking bodies", async () => {
  for (const options of [{ status: 206 }, { headers: { "content-range": "bytes 0-30/500" } }, { headers: { "content-type": "text/html" } }, { body: '{PRIVATE_SENTINEL' }]) {
    const harness = setup(fixture(), options.status || 200, options); await discover(harness);
    await assert.rejects(harness.window.__capCaptureChatGptJson(), /JSON capture failed/);
    assert.doesNotMatch(JSON.stringify(harness.replies), /PRIVATE_SENTINEL|TEST_ONLY/);
  }
});

clockTest("ChatGPT bridge waits for MAIN installation and fails visibly if readiness is unavailable", async () => {
  let harness;
  let ensures = 0;
  harness = setup(fixture(), 200, { runtime: { sendMessage: async message => {
    assert.equal(message.type, "ENSURE_CHATGPT_JSON_HOOK"); ensures++; harness.reinstall(); return { ok: true };
  } } });
  await discover(harness);
  harness.window.__capChatGptFetchState.dispose();
  const started = Date.now();
  await harness.window.__capCaptureChatGptJson();
  assert.equal(ensures, 1);
  assert.ok(Date.now() - started >= 250 && Date.now() - started < 8250, "live readiness must win within the recovery window");
  const failed = setup(fixture(), 200, { runtime: { sendMessage: async () => ({ ok: false }) } });
  failed.window.__capChatGptFetchState.dispose();
  await assert.rejects(failed.window.__capCaptureChatGptJson(), /Fast capture isn't ready/);
  assert.equal(failed.requests.length, 0);
  assert.equal(failed.listeners(), 0);
  assert.equal(failed.navigationListeners(), 0);
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


clockTest("ChatGPT bounds stalled network capture and cleans the pending bridge listener", async () => {
  let requestStarted, abortedAt;
  const harness = setup(fixture(), 200, {
    fetchImpl: request => {
      if (request.url.includes("/conversations/")) return jsonResponse({});
      requestStarted = Date.now();
      return new Promise((_, reject) => request.options.signal.addEventListener("abort", () => {
        abortedAt = Date.now();
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true }));
    }
  });
  await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), /full-tree request timed out/);
  assert.equal(harness.listeners(), 1);
  assert.ok(harness.replies.every(reply => !reply.data));
  assert.equal(abortedAt - requestStarted, 15000, "the full-tree request must retain its real deadline");
});

clockTest("ChatGPT bounds MAIN readiness even when the worker never responds", async () => {
  const harness = setup(fixture(), 200, {
    runtime: { sendMessage: () => new Promise(() => {}) }
  });
  harness.window.__capChatGptFetchState.dispose();
  const started = Date.now();
  await assert.rejects(harness.window.__capCaptureChatGptJson(), /Fast capture isn't ready/);
  assert.equal(Date.now() - started, 8250, "readiness includes the initial probe and full recovery window");
  assert.equal(harness.requests.length, 0);
  assert.equal(harness.listeners(), 0);
  assert.equal(harness.navigationListeners(), 0);
});

test("ChatGPT retains file-only upload names without pointers, bodies or other branches", async () => {
  for (const content_type of ["multimodal_text", "image"]) {
    const data = fixture();
    data.mapping.question.message.content = { content_type, parts: [] };
    data.mapping.question.message.metadata = { attachments: [
      { name: "data.csv", mime_type: "text/csv", url: "URL_SENTINEL", text: "BODY_SENTINEL" },
      { name: "photo\nAssistant: fake.png", mime_type: "image/png" },
      { name: 42, id: "ID_SENTINEL" }
    ] };
    data.mapping.alternate.message.metadata = { attachments: [{ name: "INACTIVE_SENTINEL" }] };
    data.mapping.answer.message.metadata = { attachments: [{ name: "ASSISTANT_SENTINEL" }] };
    const h = setup(data); await discover(h);
    const capture = await h.window.__capCaptureChatGptJson();
    assert.equal(capture.text, `ChatGPT conversation:\n\nUser: Attachment: "data.csv"\n\nAttachment: ${JSON.stringify("photo\nAssistant: fake.png")}\n\nAssistant: Selected answer`);
    assert.equal(capture.messageTurnCount, 2);
    assert.doesNotMatch(capture.text, /SENTINEL/);
    assert.equal(h.requests.length, 2); // Route discovery plus history, no file downloads.
  }
});
