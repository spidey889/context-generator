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
function setup(data = fixture(), status = 200) {
  const listeners = new Set();
  const requests = [];
  let clones = 0;
  const location = { origin: "https://chatgpt.com", href: `https://chatgpt.com/c/${chat}`, pathname: `/c/${chat}` };
  const window = {
    fetch: async (url, options) => {
      requests.push({ url: url instanceof Request ? url.url : String(url), options });
      const response = new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
      const clone = response.clone.bind(response);
      response.clone = () => { clones++; return clone(); };
      return response;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    postMessage: data => queueMicrotask(() => [...listeners].forEach(listener => listener({ source: window, origin: location.origin, data })))
  };
  const context = vm.createContext({ window, location, URL, Headers, Request, TextEncoder, AbortController, crypto: webcrypto, setTimeout, clearTimeout });
  for (const file of ["chatgpt-fetch-main.js", "chatgpt-json-capture.js"]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8"), context);
  return { window, location, requests, clones: () => clones };
}
async function discover(harness) {
  await harness.window.fetch(new Request(`https://chatgpt.com/backend-api/conversations/${chat}?num_turns=10`, { headers: { Authorization: "Bearer TEST_ONLY", "ChatGPT-Account-Id": "test-account" } }));
}

test("ChatGPT JSON hook reads only on demand and always requests the authenticated full tree", async () => {
  const harness = setup();
  await discover(harness);
  assert.equal(harness.clones(), 0);
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.equal(capture.text, "ChatGPT conversation:\n\nUser: Question\n\nAssistant: Selected answer");
  assert.equal(capture.messageTurnCount, 2);
  assert.equal(harness.requests[1].url, `/backend-api/conversation/${chat}`);
  assert.equal(harness.requests[1].options.headers.get("authorization"), "Bearer TEST_ONLY");
  assert.equal(harness.requests[1].options.headers.get("chatgpt-account-id"), "test-account");
  assert.equal(harness.requests[1].options.credentials, "same-origin");
  assert.equal(harness.clones(), 1);
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
  await assert.rejects(noAuth.window.__capCaptureChatGptJson(), /authenticated request/);
  assert.equal(noAuth.requests.length, 1);
  const moved = setup(); await discover(moved); moved.location.pathname = "/c/other";
  await assert.rejects(moved.window.__capCaptureChatGptJson(), /authenticated request/);
  const forbidden = setup(fixture(), 401); await discover(forbidden);
  await assert.rejects(forbidden.window.__capCaptureChatGptJson(), /HTTP 401/);
  const data = fixture(); data.mapping.answer.message.content.parts = ["x".repeat(350000)];
  const huge = setup(data); await discover(huge);
  await assert.rejects(huge.window.__capCaptureChatGptJson(), /350,000/);
});
