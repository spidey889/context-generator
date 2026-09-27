const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { webcrypto } = require("node:crypto");

const chat = "test-chat";
const endpoint = `https://claude.ai/api/organizations/test-org/chat_conversations/${chat}?tree=True`;
function fixture() {
  return {
    uuid: chat, current_leaf_message_uuid: "answer",
    chat_messages: [
      { uuid: "question", sender: "human", parent_message_uuid: null, content: [{ type: "text", text: "Question" }], attachments: [{ file_name: "notes.txt", extracted_content: "Pasted notes" }] },
      { uuid: "alternate", sender: "assistant", parent_message_uuid: "question", text: "Wrong branch" },
      { uuid: "answer", sender: "assistant", parent_message_uuid: "question", text: "Duplicate fallback", content: [{ type: "thinking", text: "Private reasoning" }, { type: "text", text: "Selected answer" }] }
    ]
  };
}
function setup(data = fixture()) {
  const listeners = new Set();
  let requests = 0;
  let clones = 0;
  let requestOptions;
  const location = { origin: "https://claude.ai", href: `https://claude.ai/chat/${chat}`, pathname: `/chat/${chat}` };
  const window = {
    fetch: async (_url, options) => {
      requests++;
      requestOptions = options;
      const response = new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
      const clone = response.clone.bind(response);
      response.clone = () => { clones++; return clone(); };
      return response;
    },
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
    postMessage: payload => queueMicrotask(() => {
      for (const listener of [...listeners]) listener({ source: window, origin: location.origin, data: payload });
    })
  };
  const context = vm.createContext({ window, location, URL, Request, TextEncoder, AbortController, crypto: webcrypto, setTimeout, clearTimeout });
  for (const file of ["claude-fetch-main.js", "claude-json-capture.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8"), context);
  }
  return { window, location, stats: () => ({ requests, clones, requestOptions, listeners: listeners.size }) };
}

test("Claude fetch wrapper forwards responses and does not read bodies until requested", async () => {
  const harness = setup();
  const response = await harness.window.fetch(new Request(endpoint));
  assert.equal(harness.stats().clones, 0);
  assert.equal((await response.json()).uuid, chat);
  const capture = await harness.window.__capCaptureClaudeJson();
  assert.equal(harness.stats().requests, 2);
  assert.equal(harness.stats().clones, 1);
  assert.equal(harness.stats().requestOptions.credentials, "same-origin");
  assert.equal(harness.stats().listeners, 1);
  assert.equal(capture.messageTurnCount, 2);
  assert.match(capture.text, /Pasted notes/);
  assert.match(capture.text, /Selected answer/);
  assert.doesNotMatch(capture.text, /Wrong branch|Private reasoning|Duplicate fallback/);
});

test("Claude JSON capture fails closed without a discovered endpoint or after navigation", async () => {
  const harness = setup();
  await assert.rejects(harness.window.__capCaptureClaudeJson(), /JSON capture failed/);
  assert.equal(harness.stats().requests, 0);
  await harness.window.fetch(endpoint);
  harness.location.pathname = "/chat/another-chat";
  await assert.rejects(harness.window.__capCaptureClaudeJson(), /JSON capture failed/);
  assert.equal(harness.stats().requests, 1);
});

test("Claude JSON capture drops image blocks while preserving surrounding text", async () => {
  const data = fixture();
  data.chat_messages[2].content = [
    { type: "text", text: "Before image" },
    { type: "image", source: { data: "IMAGE_PAYLOAD_SENTINEL" } },
    { type: "text", text: "After image" }
  ];
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  const capture = await harness.window.__capCaptureClaudeJson();
  assert.equal(capture.messageTurnCount, 2);
  assert.match(capture.text, /Assistant: Before image\n\nAfter image/);
  assert.doesNotMatch(capture.text, /IMAGE_PAYLOAD_SENTINEL|Duplicate fallback/);

  // Dropping an image does not relax the existing empty-message check.
  data.chat_messages[2].content = [{ type: "image" }];
  const imageOnly = setup(data);
  await imageOnly.window.fetch(endpoint);
  await assert.rejects(imageOnly.window.__capCaptureClaudeJson(), /incomplete or unsupported/);
});

test("Claude JSON capture still rejects incomplete or unsupported content alongside images", async () => {
  for (const mutate of [
    data => { data.chat_messages[2].parent_message_uuid = "missing"; },
    data => { data.chat_messages[0].parent_message_uuid = "answer"; },
    data => { data.chat_messages[2].files = [{ file_name: "document.pdf" }]; },
    data => { data.chat_messages[2].sync_sources = [{ id: "synced-document" }]; },
    data => { data.chat_messages[2].content.push({ type: "tool_use", name: "tool" }); },
    data => { data.chat_messages[2].content.push({ type: "tool_result", content: "result" }); },
    data => { data.chat_messages[2].content.push({ type: "artifact", text: "code" }); },
    data => { data.chat_messages[2].truncated = true; }
  ]) {
    const data = fixture();
    data.chat_messages[2].content.push({ type: "image" });
    mutate(data);
    const harness = setup(data);
    await harness.window.fetch(endpoint);
    await assert.rejects(harness.window.__capCaptureClaudeJson(), /incomplete or unsupported/);
  }
});

test("Claude JSON capture accepts Claude's actual root-parent marker", async () => {
  const data = fixture();
  data.chat_messages[0].parent_message_uuid = "00000000-0000-4000-8000-000000000000";
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  const capture = await harness.window.__capCaptureClaudeJson();
  assert.equal(capture.messageTurnCount, 2);
  assert.match(capture.text, /User: Question/);
  assert.match(capture.text, /Assistant: Selected answer/);
});

test("Claude JSON capture reports the blocking field or block without exposing content", async () => {
  const cases = [
    [data => { data.chat_messages[2].files = [{ file_name: "PRIVATE_SENTINEL" }]; }, /Message 2 \(Assistant\).*message\.files/],
    [data => { data.chat_messages[2].sync_sources = [{ text: "PRIVATE_SENTINEL" }]; }, /Message 2 \(Assistant\).*message\.sync_sources/],
    [data => { data.chat_messages[2].content.push({ type: "tool_use", input: "PRIVATE_SENTINEL" }); }, /Message 2 \(Assistant\), block 3.*"tool_use"/],
    [data => { data.chat_messages[2].content.push({ type: "tool_result", content: "PRIVATE_SENTINEL" }); }, /block 3.*"tool_result"/],
    [data => { data.chat_messages[2].content.push({ type: "artifact", text: "PRIVATE_SENTINEL" }); }, /block 3.*"artifact"/],
    [data => { data.chat_messages[2].content.push({ type: "PRIVATE_SENTINEL<script>" }); }, /unsupported content type "unknown"/],
    [data => { data.chat_messages[2].truncated = true; }, /Message 2 \(Assistant\) is marked truncated/],
    [data => { data.chat_messages[0].attachments[0].extracted_content = ""; }, /Message 1 \(User\), attachment 1.*extracted_content/],
    [data => { data.chat_messages[2].content = [{ type: "image", source: "PRIVATE_SENTINEL" }]; }, /Message 2 \(Assistant\) has no usable text/],
    [data => { data.chat_messages[0].parent_message_uuid = "missing"; }, /parent message is missing/],
    [data => { data.chat_messages[0].parent_message_uuid = "answer"; }, /parent links form a cycle/]
  ];
  for (const [mutate, reason] of cases) {
    const data = fixture();
    mutate(data);
    const harness = setup(data);
    await harness.window.fetch(endpoint);
    await assert.rejects(harness.window.__capCaptureClaudeJson(), error => {
      assert.match(error.message, reason);
      assert.doesNotMatch(error.message, /PRIVATE_SENTINEL|Selected answer|Question|notes\.txt/);
      return true;
    });
  }
});

test("Claude JSON capture accepts the root sentinel and rejects oversized transcripts", async () => {
  const data = fixture();
  data.chat_messages[0].parent_message_uuid = "00000000-0000-0000-0000-000000000000";
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  assert.equal((await harness.window.__capCaptureClaudeJson()).messageTurnCount, 2);
  data.chat_messages[2].content[1].text = "x".repeat(350000);
  const oversized = setup(data);
  await oversized.window.fetch(endpoint);
  await assert.rejects(oversized.window.__capCaptureClaudeJson(), /350,000/);
});
