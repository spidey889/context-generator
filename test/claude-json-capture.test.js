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
      { uuid: "question", sender: "human", parent_message_uuid: null, content: [{ type: "text", text: "Question" }], attachments: [{ file_name: "notes.txt", file_type: "txt", extracted_content: "Pasted notes" }] },
      { uuid: "alternate", sender: "assistant", parent_message_uuid: "question", text: "Wrong branch" },
      { uuid: "answer", sender: "assistant", parent_message_uuid: "question", text: "Duplicate fallback", content: [{ type: "thinking", text: "Private reasoning" }, { type: "text", text: "Selected answer" }] }
    ]
  };
}
function setup(data = fixture(), { status = 200, headers = {}, body, resources = [], fetchImpl, runtime } = {}) {
  const listeners = new Set();
  const navigationListeners = new Set();
  const popListeners = new Set();
  let requests = 0;
  let clones = 0;
  let requestOptions;
  let requestUrl;
  const location = { origin: "https://claude.ai", href: `https://claude.ai/chat/${chat}`, pathname: `/chat/${chat}` };
  const window = {
    performance: { getEntriesByType: () => resources.map(name => ({ name })) },
    navigation: { addEventListener: (_type, fn) => navigationListeners.add(fn), removeEventListener: (_type, fn) => navigationListeners.delete(fn) },
    fetch: async (url, options) => {
      requests++;
      requestUrl = url instanceof Request ? url.url : url;
      requestOptions = options;
      if (fetchImpl) return fetchImpl(url, options);
      const response = new Response(body ?? JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
      const clone = response.clone.bind(response);
      response.clone = () => { clones++; return clone(); };
      return response;
    },
    addEventListener: (type, listener) => (type === "message" ? listeners : popListeners).add(listener),
    removeEventListener: (type, listener) => (type === "message" ? listeners : popListeners).delete(listener),
    postMessage: payload => queueMicrotask(() => {
      for (const listener of [...listeners]) listener({ source: window, origin: location.origin, data: payload });
    })
  };
  const context = vm.createContext({ window, location, chrome: runtime ? { runtime } : undefined, URL, Request, TextEncoder, AbortController, crypto: webcrypto, setTimeout, clearTimeout });
  for (const file of ["claude-fetch-main.js", "claude-json-capture.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8"), context);
  }
  return { window, location,
    reinstall: (file = "claude-fetch-main.js") => vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8"), context),
    navigate: pathname => { for (const fn of navigationListeners) fn({ destination: { url: location.origin + pathname } }); location.pathname = pathname; },
    stats: () => ({ requests, clones, requestUrl, requestOptions, listeners: listeners.size }) };
}

// Shape observed on a live Claude "Pasted text, pasted, 441 lines" card.
function pastedAttachment(text) {
  return { id: "paste", file_name: "", file_type: "txt", file_size: Buffer.byteLength(text), extracted_content: text };
}

test("Claude JSON capture preserves a large pasted attachment in its owning user turn", async () => {
  const data = fixture();
  const pastedText = `PASTE_START\n${"  preserve indentation and full lines\r\n".repeat(1200)}PASTE_END`;
  data.chat_messages[0].attachments = [pastedAttachment(pastedText)];
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  const capture = await harness.window.__capCaptureClaudeJson();
  assert.equal(capture.text, `Claude conversation:\n\nUser: Question\n\n${pastedText}\n\nAssistant: Private reasoning\n\nSelected answer`);
  assert.equal(capture.messageTurnCount, 2);
});

test("Claude JSON capture keeps pasted-only user turns and multiple pasted cards in order", async () => {
  const data = fixture();
  data.chat_messages[0].content = [];
  data.chat_messages[0].text = "";
  data.chat_messages[0].attachments = [pastedAttachment("First paste"), pastedAttachment("Second paste")];
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  const capture = await harness.window.__capCaptureClaudeJson();
  assert.equal(capture.text, "Claude conversation:\n\nUser: First paste\n\nSecond paste\n\nAssistant: Private reasoning\n\nSelected answer");
  assert.equal(capture.messageTurnCount, 2);
});

test("Claude JSON capture ignores other attachments and never extracts nested pasted text", async () => {
  const data = fixture();
  const ignoredPaste = pastedAttachment("IGNORED_SENTINEL");
  data.chat_messages[0].attachments = [
    null, {},
    { ...ignoredPaste, file_name: "uploaded.txt" },
    { ...ignoredPaste, file_type: "pdf" },
    { ...ignoredPaste, file_type: "image/png" },
    { file_type: "txt", extracted_content: "IGNORED_SENTINEL" },
    { file_name: "", extracted_content: "IGNORED_SENTINEL" },
    pastedAttachment("   "), pastedAttachment("")
  ];
  data.chat_messages[0].files = [{ file_kind: "image", attachments: [ignoredPaste], extracted_content: "IGNORED_SENTINEL" }];
  data.chat_messages[0].content.push({ type: "tool_result", attachments: [ignoredPaste] });
  data.chat_messages[2].attachments = [ignoredPaste];
  data.chat_messages[1].sender = "human";
  data.chat_messages[1].attachments = [ignoredPaste];
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  const capture = await harness.window.__capCaptureClaudeJson();
  assert.equal(capture.text, "Claude conversation:\n\nUser: Question\n\nAssistant: Private reasoning\n\nSelected answer");
  assert.doesNotMatch(capture.text, /IGNORED_SENTINEL/);
  data.chat_messages[0].attachments = "malformed";
  assert.equal((await harness.window.__capCaptureClaudeJson()).text, capture.text);
});

test("Claude JSON capture avoids repeated paste text within a turn but preserves distinct turns", async () => {
  const data = fixture();
  data.chat_messages[0].content = [{ type: "text", text: "Prompt\n\nSame paste" }];
  data.chat_messages[0].attachments = [pastedAttachment("Same paste"), pastedAttachment("Same paste"), pastedAttachment("Extra paste"), pastedAttachment("Extra paste")];
  data.chat_messages.push({ uuid: "next-user", sender: "human", parent_message_uuid: "question", content: [], attachments: [pastedAttachment("Same paste")] });
  data.chat_messages[2].parent_message_uuid = "next-user";
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  const capture = await harness.window.__capCaptureClaudeJson();
  assert.equal(capture.text, "Claude conversation:\n\nUser: Prompt\n\nSame paste\n\nExtra paste\n\nUser: Same paste\n\nAssistant: Private reasoning\n\nSelected answer");
  assert.equal(capture.messageTurnCount, 3);
});

test("Claude JSON capture counts pasted text toward the existing size limit", async () => {
  const data = fixture();
  data.chat_messages[0].attachments = [pastedAttachment("x".repeat(350000))];
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  await assert.rejects(harness.window.__capCaptureClaudeJson(), /350,000/);
});

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

test("Claude capture requests the full tree without replaying pagination or window parameters", async () => {
  const harness = setup();
  await harness.window.fetch(endpoint.replace("tree=True", "tree=False&limit=2&cursor=older&rendering_mode=preview"));
  await harness.window.__capCaptureClaudeJson();
  const url = new URL(harness.stats().requestUrl);
  assert.equal(url.pathname, new URL(endpoint).pathname);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    tree: "True", rendering_mode: "messages", render_all_tools: "true", include_inline_comparison: "true", consistency: "strong"
  });
  assert.equal(harness.stats().requestOptions.credentials, "same-origin");
});

test("Claude JSON capture rejects partial HTTP responses and broken JSON", async () => {
  for (const options of [{ status: 206 }, { headers: { "content-range": "bytes 0-99/500" } }, { body: '{"uuid":"test-chat",' }]) {
    const harness = setup(fixture(), options);
    await harness.window.fetch(endpoint);
    await assert.rejects(harness.window.__capCaptureClaudeJson(), /JSON capture failed/);
    assert.equal(harness.stats().listeners, 1, "The pending capture listener must be cleaned up after rejection.");
  }
});

test("Claude JSON capture rejects explicit partial-history metadata without leaking payloads", async () => {
  const signals = {
    truncated: true, is_truncated: true, partial: true, is_partial: true, incomplete: true, is_incomplete: true,
    has_more: true, has_more_messages: true, has_previous_page: true, has_next_page: true, has_missing_messages: true,
    missing_message_count: 2, complete: false, is_complete: false,
    next_cursor: "PRIVATE_SENTINEL", previous_cursor: "PRIVATE_SENTINEL", next_page: 2, previous_page: 1,
    missing_messages: ["PRIVATE_SENTINEL"], missing_message_ids: ["PRIVATE_SENTINEL"], missing_message_uuids: ["PRIVATE_SENTINEL"]
  };
  for (const container of [null, "page_info", "pagination"]) {
    for (const [field, value] of Object.entries(signals)) {
      const data = fixture();
      if (container) data[container] = { [field]: value };
      else data[field] = value;
      const harness = setup(data);
      await harness.window.fetch(endpoint);
      await assert.rejects(harness.window.__capCaptureClaudeJson(), error => {
        assert.match(error.message, /incomplete or unsupported JSON/);
        assert.ok(error.message.includes(field));
        assert.doesNotMatch(error.message, /PRIVATE_SENTINEL|Question|Selected answer/);
        return true;
      });
    }
  }
});

test("Claude JSON capture accepts complete metadata and normal empty hidden-thinking truncation", async () => {
  const data = fixture();
  data.page_info = { has_previous_page: false, has_next_page: false, next_cursor: null, previous_cursor: "", missing_messages: [] };
  data.pagination = { complete: true, is_complete: true, truncated: false, partial: false, has_more: false, missing_message_count: 0 };
  for (const message of data.chat_messages) message.truncated = false;
  data.chat_messages[2].stop_reason = "end_turn";
  data.chat_messages[2].content.push({ type: "thinking", thinking: "", truncated: true, cut_off: false, thinking_hidden: true, summaries: [{ summary: "IGNORED_SENTINEL" }] });
  data.chat_messages[2].content.push({ type: "tool_result", truncated: true, content: [{ type: "text", text: "IGNORED_SENTINEL" }] });
  data.chat_messages[1].truncated = true;
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  const capture = await harness.window.__capCaptureClaudeJson();
  assert.equal(capture.text, "Claude conversation:\n\nUser: Question\n\nAssistant: Private reasoning\n\nSelected answer");
});

test("Claude JSON capture rejects truncated active turns and captured text/thinking blocks", async () => {
  for (const mutate of [
    data => { data.chat_messages[0].truncated = true; },
    data => { data.chat_messages[2].truncated = true; },
    data => { data.chat_messages[2].content[0].truncated = true; },
    data => { data.chat_messages[2].content[1].truncated = true; },
    data => { data.chat_messages[2].content[1].cut_off = true; },
    data => { data.chat_messages[2].content[1].stop_timestamp = null; },
    data => { data.chat_messages[2].stop_reason = null; }
  ]) {
    const data = fixture();
    mutate(data);
    const harness = setup(data);
    await harness.window.fetch(endpoint);
    await assert.rejects(harness.window.__capCaptureClaudeJson(), /incomplete content|still in progress/);
  }
});

test("Claude JSON capture rejects missing/truncated pasted content rather than silently dropping it", async () => {
  for (const attachment of [
    { ...pastedAttachment("Paste"), truncated: true },
    { ...pastedAttachment("Paste"), extracted_content: undefined },
    { ...pastedAttachment("Paste"), extracted_content: null },
    { ...pastedAttachment("Paste"), extracted_content: { text: "PRIVATE_SENTINEL" } },
    { ...pastedAttachment("Paste"), extracted_content: 42 },
    { ...pastedAttachment("Paste"), extracted_content: "" },
    { ...pastedAttachment("Full paste"), extracted_content: "Full" },
    { ...pastedAttachment("Paste"), file_size: "5" }
  ]) {
    const data = fixture();
    data.chat_messages[0].attachments = [attachment];
    const harness = setup(data);
    await harness.window.fetch(endpoint);
    await assert.rejects(harness.window.__capCaptureClaudeJson(), /Pasted-text attachment.truncated|missing its complete extracted_content|does not match its file_size/);
  }
});

test("Claude JSON capture validates advertised total counts without confusing inactive branches", async () => {
  for (const container of [null, "page_info", "pagination"]) {
    for (const field of ["total_messages", "total_message_count"]) {
      const data = fixture();
      const metadata = container ? (data[container] = {}) : data;
      metadata[field] = data.chat_messages.length;
      const harness = setup(data);
      await harness.window.fetch(endpoint);
      assert.equal((await harness.window.__capCaptureClaudeJson()).messageTurnCount, 2);
      metadata[field]++;
      await assert.rejects(harness.window.__capCaptureClaudeJson(), /missing history/);
    }
  }
});

test("Claude pasted-text size validation uses UTF-8 bytes before trimming", async () => {
  const data = fixture();
  data.chat_messages[0].attachments = [pastedAttachment("  café\r\n🙂  ")];
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  assert.match((await harness.window.__capCaptureClaudeJson()).text, /User: Question\n\ncafé\r\n🙂/);
});

test("Claude JSON capture requires a real root and rejects malformed completeness structures", async () => {
  for (const mutate of [
    ...[undefined, "", false, 0, {}].map(parent => data => { data.chat_messages[0].parent_message_uuid = parent; }),
    data => { delete data.chat_messages[0].parent_message_uuid; },
    data => { data.chat_messages[0].uuid = ""; },
    data => { data.current_leaf_message_uuid = 42; },
    data => { data.page_info = "invalid"; },
    data => { data.pagination = []; },
    data => { data.chat_messages[2].content = {}; },
    data => { data.chat_messages[2].content[1].text = null; }
  ]) {
    const data = fixture();
    mutate(data);
    const harness = setup(data);
    await harness.window.fetch(endpoint);
    await assert.rejects(harness.window.__capCaptureClaudeJson(), /incomplete or unsupported JSON/);
  }
});


test("Claude late installation recovers an exact-chat endpoint without fetching bodies early", async () => {
  const harness = setup(fixture(), { resources: [endpoint, endpoint.replace(chat, "prefetched-chat")] });
  assert.equal(harness.stats().requests, 0);
  assert.equal(harness.stats().clones, 0);
  await harness.window.__capCaptureClaudeJson();
  assert.equal(new URL(harness.stats().requestUrl).pathname.split("/").pop(), chat);
  assert.equal(harness.stats().requests, 1);
});

test("Claude sidebar navigation and other-chat prefetches cannot overwrite current routing", async () => {
  const harness = setup();
  await harness.window.fetch(endpoint.replace(chat, "other-chat"));
  harness.location.pathname = "/chat/other-chat";
  await harness.window.fetch(endpoint);
  harness.location.pathname = `/chat/${chat}`;
  await harness.window.fetch(endpoint.replace(chat, "other-chat"));
  await harness.window.__capCaptureClaudeJson();
  assert.equal(new URL(harness.stats().requestUrl).pathname.split("/").pop(), chat);
});

test("Claude waits for a late initial request but never invents a different-chat endpoint", async () => {
  const harness = setup();
  const capture = harness.window.__capCaptureClaudeJson();
  await new Promise(resolve => setTimeout(resolve, 60));
  await harness.window.fetch(endpoint);
  assert.match((await capture).text, /Selected answer/);
});

test("Claude repeated hook and bridge injections do not stack listeners or wrappers", async () => {
  const harness = setup(fixture(), { resources: [endpoint] });
  const wrapped = harness.window.fetch;
  for (let n = 0; n < 3; n++) { harness.reinstall(); harness.reinstall("claude-json-capture.js"); }
  assert.equal(harness.window.fetch, wrapped);
  assert.equal(harness.stats().listeners, 1);
  await harness.window.__capCaptureClaudeJson();
  assert.equal(harness.stats().requests, 1);
});

test("Claude repairs a replaced wrapper while preserving the page's newer fetch layer", async () => {
  const harness = setup(fixture(), { resources: [endpoint] });
  const previous = harness.window.fetch;
  let pageCalls = 0;
  harness.window.fetch = (...args) => { pageCalls++; return previous(...args); };
  harness.reinstall();
  await harness.window.__capCaptureClaudeJson();
  assert.equal(pageCalls, 1);
  assert.equal(harness.stats().listeners, 1);
});

test("Claude aborts navigation away and back, and rejects concurrent captures promptly", async () => {
  let finish;
  const harness = setup(fixture(), { resources: [endpoint], fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  const first = harness.window.__capCaptureClaudeJson();
  const rejected = assert.rejects(first, /failed/);
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(harness.window.__capCaptureClaudeJson(), /failed/);
  harness.navigate("/chat/other-chat");
  harness.navigate(`/chat/${chat}`);
  finish(new Response(JSON.stringify(fixture()), { headers: { "content-type": "application/json" } }));
  await rejected;
  assert.equal(harness.stats().listeners, 1);
});

test("Claude isolated bridge awaits MAIN reinstallation before requesting capture", async () => {
  let harness;
  let ensures = 0;
  harness = setup(fixture(), { resources: [endpoint], runtime: { sendMessage: async message => {
    assert.equal(message.type, "ENSURE_CLAUDE_JSON_HOOK");
    ensures++; harness.window.__capClaudeFetchState.dispose();
    delete harness.window.__capClaudeFetchState;
    harness.reinstall();
    return { ok: true };
  } } });
  await harness.window.__capCaptureClaudeJson();
  assert.equal(ensures, 1);
  assert.equal(harness.stats().requests, 1);
});


test("Claude refuses capture when MAIN readiness fails or never replies", async () => {
  for (const sendMessage of [async () => ({ ok: false }), () => new Promise(() => {})]) {
    const harness = setup(fixture(), { resources: [endpoint], runtime: { sendMessage } });
    await assert.rejects(harness.window.__capCaptureClaudeJson(), /hook.*(installed|timed out)/);
    assert.equal(harness.stats().requests, 0);
    assert.equal(harness.stats().listeners, 1);
  }
});
