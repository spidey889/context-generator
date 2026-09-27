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
  assert.doesNotMatch(capture.text, /Pasted notes/);
  assert.match(capture.text, /Selected answer/);
  assert.doesNotMatch(capture.text, /Wrong branch|Duplicate fallback/);
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

test("Claude JSON capture accepts Claude's actual root-parent marker", async () => {
  const data = fixture();
  data.chat_messages[0].parent_message_uuid = "00000000-0000-4000-8000-000000000000";
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  const capture = await harness.window.__capCaptureClaudeJson();
  assert.equal(capture.messageTurnCount, 2);
  assert.match(capture.text, /User: Question/);
  assert.match(capture.text, /Assistant: Private reasoning\n\nSelected answer/);
});

test("Claude JSON capture extracts only direct user/assistant text and thinking", async () => {
  const data = fixture();
  data.chat_messages[0].files = [{ file_kind: "document", text: "FILE_SENTINEL" }];
  data.chat_messages[0].attachments = [{ extracted_content: "ATTACHMENT_SENTINEL" }];
  data.chat_messages[0].sync_sources = [{ text: "SYNC_SENTINEL" }];
  data.chat_messages[2].content = [
    { type: "text", text: "Own answer" },
    { type: "thinking", thinking: "Own reasoning" },
    { type: "image", text: "IMAGE_SENTINEL" },
    { type: "artifact", content: [{ type: "text", text: "ARTIFACT_SENTINEL" }] },
    { type: "tool_use", name: "web_search", input: { text: "TOOL_INPUT_SENTINEL" } },
    { type: "tool_result", name: "web_search", text: "TOOL_TEXT_SENTINEL", content: [
      { type: "text", text: "SEARCH_SNIPPET_SENTINEL" },
      { type: "thinking", thinking: "TOOL_THINKING_SENTINEL" }
    ] }
  ];
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  const capture = await harness.window.__capCaptureClaudeJson();
  assert.equal(capture.text, "Claude conversation:\n\nUser: Question\n\nAssistant: Own answer\n\nOwn reasoning");
  assert.equal(capture.messageTurnCount, 2);
  assert.doesNotMatch(capture.text, /SENTINEL|Duplicate fallback/);
});

test("Claude JSON capture skips all tools including unmatched calls and empty turns", async () => {
  for (const tool of ["bash_tool", "web_search", "memory_read", "memory_append", "memory_str_replace"]) {
    const data = fixture();
    data.chat_messages[0].content = [{ type: "image" }];
    data.chat_messages[2].content = [
      { type: "tool_use", name: tool, input: { text: "NESTED_SENTINEL" } },
      { type: "tool_result", name: tool, content: [{ type: "text", text: "NESTED_SENTINEL" }] },
      { type: "text", text: "Usable answer" }
    ];
    const harness = setup(data);
    await harness.window.fetch(endpoint);
    const capture = await harness.window.__capCaptureClaudeJson();
    assert.equal(capture.text, "Claude conversation:\n\nAssistant: Usable answer");
    assert.equal(capture.messageTurnCount, 1);
  }
});

test("Claude JSON capture rejects zero usable text even when tools contain nested text", async () => {
  const data = fixture();
  data.chat_messages[0].content = [{ type: "image" }];
  data.chat_messages[2].content = [{ type: "tool_result", content: [{ type: "text", text: "NESTED_SENTINEL" }] }];
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  await assert.rejects(harness.window.__capCaptureClaudeJson(), /no usable user or assistant text/);
});

test("Claude JSON capture keeps own thinking but ignores other roles and fallback duplicates", async () => {
  const data = fixture();
  data.chat_messages[0].sender = "tool";
  data.chat_messages[2].content = [{ type: "thinking", text: "Own thought" }];
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  assert.equal((await harness.window.__capCaptureClaudeJson()).text, "Claude conversation:\n\nAssistant: Own thought");
});

test("Claude JSON capture still rejects missing parents and cyclic branches", async () => {
  for (const parent of ["missing", "answer"]) {
    const data = fixture();
    data.chat_messages[0].parent_message_uuid = parent;
    const harness = setup(data);
    await harness.window.fetch(endpoint);
    await assert.rejects(harness.window.__capCaptureClaudeJson(), /parent message is missing|parent links form a cycle/);
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
