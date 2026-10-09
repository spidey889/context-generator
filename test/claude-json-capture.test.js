const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { webcrypto, createHash } = require("node:crypto");
const { clockTest } = require("./helpers/clock");
const scripts = new Map(["claude-fetch-main.js", "claude-json-capture.js"].map(file =>
  [file, new vm.Script(fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8"), { filename: file })]));

const chat = "test-chat";
const endpoint = `https://claude.ai/api/organizations/test-org/chat_conversations/${chat}?tree=True`;
function fixture() {
  return {
    uuid: chat, current_leaf_message_uuid: "answer",
    chat_messages: [
      { uuid: "question", sender: "human", parent_message_uuid: null, content: [{ type: "text", text: "Question" }], attachments: [] },
      { uuid: "alternate", sender: "assistant", parent_message_uuid: "question", text: "Wrong branch" },
      { uuid: "answer", sender: "assistant", parent_message_uuid: "question", text: "Duplicate fallback", content: [{ type: "thinking", text: "Private reasoning" }, { type: "text", text: "Selected answer" }] }
    ]
  };
}
function setup(data = fixture(), { status = 200, headers = {}, body, resources = [], fetchImpl, runtime, beforeMessage } = {}) {
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
      beforeMessage?.(payload);
      for (const listener of [...listeners]) listener({ source: window, origin: location.origin, data: payload });
    })
  };
  const context = vm.createContext({ window, location, chrome: runtime ? { runtime } : undefined, URL, Request, TextEncoder, TextDecoder, AbortController, crypto: webcrypto, Date, setTimeout, clearTimeout });
  for (const file of ["claude-fetch-main.js", "claude-json-capture.js"]) {
    scripts.get(file).runInContext(context);
  }
  return { window, location,
    reinstall: (file = "claude-fetch-main.js") => scripts.get(file).runInContext(context),
    navigate: pathname => { for (const fn of navigationListeners) fn({ destination: { url: location.origin + pathname } }); location.pathname = pathname; },
    stats: () => ({ requests, clones, requestUrl, requestOptions, listeners: listeners.size,
      navigationListeners: navigationListeners.size, popListeners: popListeners.size }) };
}

// Shape observed on a live Claude "Pasted text, pasted, 441 lines" card.
function pastedAttachment(text) {
  return { id: createHash("sha256").update(text).digest("hex"), file_name: "", file_type: "txt", file_size: Buffer.byteLength(text), extracted_content: text };
}

function streamedResponse(chunks, headers = {}, cancelError = false) {
  const stats = { bytes: 0, cancelled: 0 };
  let index = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (index === chunks.length) return controller.close();
      const chunk = chunks[index++];
      stats.bytes += chunk.byteLength;
      controller.enqueue(chunk);
    },
    cancel() {
      stats.cancelled++;
      if (cancelError) throw new Error("PRIVATE_CANCEL_SENTINEL");
    }
  }, { highWaterMark: 0 }), { headers: { "content-type": "application/json", ...headers } });
  return { response, stats };
}

for (const length of [undefined, "1", "6000001"]) test(`Claude bounds raw history before decoding with Content-Length ${length ?? "absent"}`, async () => {
  // A tiny active branch can coexist with large metadata. Transcript bounds
  // cannot protect the raw read: reject excess transport without clipping it.
  const prefix = new TextEncoder().encode(JSON.stringify(fixture()).slice(0, -1) + ',"ignored":"');
  const chunks = [prefix, ...Array(20).fill(new Uint8Array(1000000).fill(32)), new TextEncoder().encode('"}')];
  const streamed = streamedResponse(chunks, length ? { "content-length": length } : {}, true);
  let healthy = false;
  const harness = setup(fixture(), { resources: [endpoint], fetchImpl: async () => healthy
    ? new Response(JSON.stringify(fixture()), { headers: { "content-type": "application/json" } }) : streamed.response });
  await assert.rejects(harness.window.__capCaptureClaudeJson(), error => {
    assert.equal(error.captureFailureReason, "incomplete");
    assert.doesNotMatch(error.message, /PRIVATE_CANCEL_SENTINEL/);
    return true;
  });
  assert.equal(streamed.stats.cancelled, 1);
  assert.ok(streamed.stats.bytes <= 7000000, `The oversized body was drained: ${streamed.stats.bytes} bytes.`);
  if (length === "6000001") assert.equal(streamed.stats.bytes, 0, "Reject an oversized advertised length before reading.");
  assert.equal(streamed.response.body.locked, false);
  assert.equal(harness.stats().navigationListeners + harness.stats().popListeners, 0);
  healthy = true;
  assert.equal((await harness.window.__capCaptureClaudeJson()).text,
    "Claude conversation:\n\nUser: Question\n\nAssistant: Private reasoning\n\nSelected answer");
});

test("Claude rejects invalid UTF-8 before it can silently change captured text or drain the remaining body", async () => {
  const bytes = Buffer.from(JSON.stringify(fixture()).slice(0, -1) + ',"ignored":"');
  bytes[bytes.indexOf("Question") + 2] = 0xff;
  const streamed = streamedResponse([bytes, ...Array(5).fill(new Uint8Array(1000000).fill(32)), new TextEncoder().encode('"}')]);
  const harness = setup(fixture(), { resources: [endpoint], fetchImpl: async () => streamed.response });
  await assert.rejects(harness.window.__capCaptureClaudeJson(), error => {
    assert.equal(error.captureFailureReason, "incomplete");
    assert.doesNotMatch(error.message, /decoder|encoded data|UTF-8|Question/);
    return true;
  });
  assert.equal(streamed.stats.bytes, bytes.length, "Stop at the malformed chunk, before the irrelevant tail.");
  assert.equal(streamed.stats.cancelled, 1);
  assert.equal(streamed.response.body.locked, false);
});

test("Claude accepts exactly six million raw bytes and preserves split BOM, Unicode and source whitespace", async () => {
  const data = fixture();
  const text = "  café🙂\r\n\uFEFF  original text  ";
  data.chat_messages[0].content = [{ type: "text", text }];
  const prefix = Buffer.from("\uFEFF" + JSON.stringify(data).slice(0, -1) + ',"ignored":"');
  const suffix = Buffer.from('"}');
  const bytes = Buffer.concat([prefix, Buffer.alloc(6000000 - prefix.length - suffix.length, 32), suffix]);
  const split = bytes.indexOf(Buffer.from("🙂")) + 1;
  const streamed = streamedResponse([bytes.subarray(0, 1), bytes.subarray(1, 2), bytes.subarray(2, split), bytes.subarray(split, split + 1), bytes.subarray(split + 1)], { "content-length": "6000000" });
  const harness = setup(data, { resources: [endpoint], fetchImpl: async () => streamed.response });
  assert.equal((await harness.window.__capCaptureClaudeJson()).text,
    `Claude conversation:\n\nUser: ${text}\n\nAssistant: Private reasoning\n\nSelected answer`);
  assert.equal(streamed.stats.bytes, 6000000);
  assert.equal(streamed.stats.cancelled, 0);
  assert.equal(streamed.response.body.locked, false);
});

test("Claude rejects an unfinished UTF-8 codepoint after otherwise complete JSON and permits a fresh capture", async () => {
  const streamed = streamedResponse([Buffer.from(JSON.stringify(fixture())), new Uint8Array([0xc3])]);
  let healthy = false;
  const harness = setup(fixture(), { resources: [endpoint], fetchImpl: async () => healthy
    ? new Response(JSON.stringify(fixture()), { headers: { "content-type": "application/json" } }) : streamed.response });
  await assert.rejects(harness.window.__capCaptureClaudeJson(), error => error.captureFailureReason === "incomplete");
  assert.equal(streamed.response.body.locked, false);
  healthy = true;
  assert.equal((await harness.window.__capCaptureClaudeJson()).messageTurnCount, 2);
});

for (const reason of ["navigation", "timeout"]) clockTest(`Claude cancels a pending streamed body on ${reason} and permits a fresh capture`, async () => {
  let response, signal, readStarted, healthy = false;
  const began = new Promise(resolve => { readStarted = resolve; });
  const harness = setup(fixture(), { resources: [endpoint], fetchImpl: async (_url, options) => {
    if (healthy) return new Response(JSON.stringify(fixture()), { headers: { "content-type": "application/json" } });
    signal = options.signal;
    response = new Response(new ReadableStream({
      start(controller) {
        // Native fetch errors an outstanding body read when its signal aborts.
        signal.addEventListener("abort", () => controller.error(new Error("PRIVATE_ABORT_SENTINEL")), { once: true });
      },
      pull() { readStarted(); return new Promise(() => {}); }
    }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } });
    return response;
  } });
  const capture = harness.window.__capCaptureClaudeJson();
  await began;
  if (reason === "navigation") { harness.navigate("/chat/another"); harness.navigate(`/chat/${chat}`); }
  await assert.rejects(capture, error => {
    assert.doesNotMatch(error.message, /PRIVATE_ABORT_SENTINEL/);
    if (reason === "timeout") assert.equal(error.captureFailureReason, "timeout");
    else assert.match(error.message, /changed/);
    return true;
  });
  assert.equal(signal.aborted, true);
  assert.equal(response.body.locked, false);
  assert.equal(harness.stats().navigationListeners + harness.stats().popListeners, 0);
  healthy = true;
  assert.equal((await harness.window.__capCaptureClaudeJson()).messageTurnCount, 2);
});

test("Claude cancels discarded transport responses and keeps safe fallback reasons when cancellation fails", async () => {
  for (const [status, headers, reason] of [
    [401, {}, "unavailable"], [500, {}, "request_failed"],
    [200, { "content-range": "bytes 0-10/100" }, "incomplete"],
    [200, { "content-type": "text/html" }, "incomplete"]
  ]) {
    let cancelled = 0, healthy = false, discarded;
    const harness = setup(fixture(), { resources: [endpoint], fetchImpl: async () => {
      if (healthy) return new Response(JSON.stringify(fixture()), { headers: { "content-type": "application/json" } });
      discarded = new Response(new ReadableStream({ cancel() { cancelled++; throw new Error("PRIVATE_CANCEL_SENTINEL"); } }),
        { status, headers: { "content-type": "application/json", ...headers } });
      return discarded;
    } });
    await assert.rejects(harness.window.__capCaptureClaudeJson(), error => {
      assert.equal(error.captureFailureReason, reason);
      assert.doesNotMatch(error.message, /PRIVATE_CANCEL_SENTINEL/);
      return true;
    });
    assert.equal(cancelled, 1, "A rejected response must stop its unused stream.");
    assert.equal(discarded.body.locked, false);
    assert.equal(harness.stats().navigationListeners + harness.stats().popListeners, 0);
    healthy = true;
    assert.equal((await harness.window.__capCaptureClaudeJson()).text,
      "Claude conversation:\n\nUser: Question\n\nAssistant: Private reasoning\n\nSelected answer");
  }
});

test("Claude capture reads its dedicated response once and leaves the page response readable", async () => {
  const data = fixture();
  const pastedText = `  café🙂\r\n${"  original pasted line\r\n".repeat(10000)}END  `;
  data.chat_messages[0].attachments = [pastedAttachment(pastedText)];
  const harness = setup(data);
  const pageResponse = await harness.window.fetch(endpoint);
  const capture = await harness.window.__capCaptureClaudeJson();
  assert.equal(capture.text, `Claude conversation:\n\nUser: Question\n\n${pastedText}\n\nAssistant: Private reasoning\n\nSelected answer`);
  assert.equal(capture.messageTurnCount, 2);
  assert.equal(harness.stats().requests, 2);
  assert.equal(harness.stats().clones, 0, "The extension's fresh response has no second reader.");
  assert.equal(pageResponse.bodyUsed, false, "Observing the page's routing must not consume its body.");
  assert.deepEqual(await pageResponse.json(), data);
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

test("Claude JSON capture preserves original own text, thinking and legacy whitespace", async () => {
  const user = "\u00a0    print('user')  \r\n";
  const thinking = "  preserve reasoning  \r\n";
  const answer = "    print('answer')  \n";
  for (const legacy of [false, "absent", "empty"]) {
    const data = fixture();
    data.chat_messages[0].content = [{ type: "text", text: " \r\n\u00a0 " }, { type: "text", text: user }];
    data.chat_messages[0].attachments = [];
    data.chat_messages[2].content = [{ type: "thinking", thinking }, { type: "text", text: answer }];
    if (legacy) {
      if (legacy === "absent") delete data.chat_messages[0].content;
      else data.chat_messages[0].content = [];
      data.chat_messages[0].text = user;
    }
    const h = setup(data);
    await h.window.fetch(endpoint);
    const capture = await h.window.__capCaptureClaudeJson();
    assert.equal(capture.text, `Claude conversation:\n\nUser: ${user}\n\nAssistant: ${thinking}\n\n${answer}`);
    assert.equal(capture.messageTurnCount, 2);
  }
});

test("Claude inline pasted-card matching preserves original block and card whitespace", async () => {
  const data = fixture();
  const pasted = "    print('paste')  \r\n";
  data.chat_messages[0].content = [{ type: "text", text: ` \n${pasted}\n ` }];
  data.chat_messages[0].attachments = [pastedAttachment(pasted)];
  const h = setup(data);
  await h.window.fetch(endpoint);
  assert.equal((await h.window.__capCaptureClaudeJson()).text,
    `Claude conversation:\n\nUser: ${pasted}\n\nAssistant: Private reasoning\n\nSelected answer`);
});

for (const [before, after] of [["\n\n", "\n\n"], ["\r\n\r\n", "\r\n\r\n"], ["\n\r\n", "\r\n\n"]]) {
  test(`Claude matches a full inline pasted paragraph with ${JSON.stringify([before, after])} separators without changing source text`, async () => {
    const data = fixture();
    const pasted = "  café🙂\r\n  original card  ";
    const original = `  Intro${before}${pasted.trim()}${after}Outro  `;
    data.chat_messages[0].content = [{ type: "text", text: original }];
    data.chat_messages[0].attachments = [pastedAttachment(pasted)];
    const h = setup(data, { resources: [endpoint] });
    assert.equal((await h.window.__capCaptureClaudeJson()).text,
      `Claude conversation:\n\nUser: ${original.replace(pasted.trim(), pasted)}\n\nAssistant: Private reasoning\n\nSelected answer`);
  });
}

test("Claude restores multiple CRLF inline cards backwards and preserves repeated cards with distinct identities", async () => {
  const data = fixture();
  const first = "  First card  ", second = "\tSecond card\r\n";
  data.chat_messages[0].content = [{ type: "text", text: `Intro\r\n\r\n${first.trim()}\r\n\r\n${second.trim()}\r\n\r\nOutro` }];
  const firstCard = { ...pastedAttachment(first), id: "first" };
  data.chat_messages[0].attachments = [firstCard, { ...firstCard }, { ...pastedAttachment(second), id: "second" },
    { ...pastedAttachment(first), id: "third" }];
  const h = setup(data, { resources: [endpoint] });
  const capture = await h.window.__capCaptureClaudeJson();
  assert.equal(capture.text,
    `Claude conversation:\n\nUser: Intro\r\n\r\n${first}\r\n\r\n${second}\r\n\r\nOutro\n\n${first}\n\nAssistant: Private reasoning\n\nSelected answer`);
  assert.equal(capture.messageTurnCount, 2);
});

test("Claude keeps a pasted card separate when its text is only a substring or is missing a full paragraph boundary", async () => {
  for (const original of ["Intro\r\nCARD\r\nOutro", "Intro\r\n\r\nCARD_suffix\r\n\r\nOutro",
    "Intro\r\n\r\nCARD\r\nOutro", "Intro\r\nCARD\r\n\r\nOutro"]) {
    const data = fixture();
    data.chat_messages[0].content = [{ type: "text", text: original }];
    data.chat_messages[0].attachments = [pastedAttachment("CARD")];
    const h = setup(data, { resources: [endpoint] });
    assert.equal((await h.window.__capCaptureClaudeJson()).text,
      `Claude conversation:\n\nUser: ${original}\n\nCARD\n\nAssistant: Private reasoning\n\nSelected answer`);
  }
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
  assert.deepEqual([...capture.excludedContentTypes], ["artifacts", "media", "other", "tools", "uploads"]);
});

test("Claude JSON capture rejects zero usable text even when tools contain nested text", async () => {
  const data = fixture();
  data.chat_messages[0].content = [{ type: "image" }];
  data.chat_messages[2].content = [{ type: "tool_result", content: [{ type: "text", text: "NESTED_SENTINEL" }] }];
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  await assert.rejects(harness.window.__capCaptureClaudeJson(), /no usable user or assistant text/);
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

test("Claude JSON capture admits the direct range through 500,000 characters without clipping", async () => {
  const baseline = setup();
  await baseline.window.fetch(endpoint);
  const overhead = (await baseline.window.__capCaptureClaudeJson()).text.length - "Selected answer".length;
  for (const length of [350001, 500000, 500001]) {
    const data = fixture();
    data.chat_messages[2].content[1].text = "漢".repeat(length - overhead);
    const h = setup(data);
    await h.window.fetch(endpoint);
    if (length > 500000) await assert.rejects(h.window.__capCaptureClaudeJson(), /500,000/);
    else assert.equal((await h.window.__capCaptureClaudeJson()).text.length, length);
  }
});

test("Claude JSON capture accepts the root sentinel and rejects oversized transcripts", async () => {
  const data = fixture();
  data.chat_messages[0].parent_message_uuid = "00000000-0000-0000-0000-000000000000";
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  assert.equal((await harness.window.__capCaptureClaudeJson()).messageTurnCount, 2);
  data.chat_messages[2].content[1].text = "x".repeat(500000);
  const oversized = setup(data);
  await oversized.window.fetch(endpoint);
  await assert.rejects(oversized.window.__capCaptureClaudeJson(), /500,000/);
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

test("Claude pasted-text size validation uses UTF-8 bytes before trimming", async () => {
  const data = fixture();
  data.chat_messages[0].attachments = [pastedAttachment("  café\r\n🙂  ")];
  const harness = setup(data);
  await harness.window.fetch(endpoint);
  assert.match((await harness.window.__capCaptureClaudeJson()).text, /User: Question\n\n  café\r\n🙂  /);
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


test("Claude aborts navigation away and back, and rejects concurrent captures promptly", async () => {
  let finish;
  const harness = setup(fixture(), { resources: [endpoint], fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  const first = harness.window.__capCaptureClaudeJson();
  const rejected = assert.rejects(first, /changed/);
  await new Promise(resolve => setTimeout(resolve, 0));
  await assert.rejects(harness.window.__capCaptureClaudeJson(), /failed/);
  harness.navigate("/chat/other-chat");
  harness.navigate(`/chat/${chat}`);
  finish(new Response(JSON.stringify(fixture()), { headers: { "content-type": "application/json" } }));
  await rejected;
  assert.equal(harness.stats().listeners, 1);
});

clockTest("Claude native failures retain safe fallback reasons instead of labelling every failure a request error", async () => {
  const cases = [
    [{ status: 206 }, "incomplete"],
    [{ headers: { "content-range": "bytes 0-10/100" } }, "incomplete"],
    [{ body: "PRIVATE_INVALID_JSON" }, "incomplete"],
    [{ status: 401 }, "unavailable"],
    [{ status: 500 }, "request_failed"],
    [{ resources: [] }, "unavailable"],
    [{ fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("PRIVATE_TIMEOUT_ERROR")), { once: true });
    }) }, "timeout"]
  ];
  for (const [options, expected] of cases) {
    const h = setup(fixture(), { resources: [endpoint], ...options });
    await assert.rejects(h.window.__capCaptureClaudeJson(), error => {
      assert.equal(error.captureFailureReason, expected);
      assert.doesNotMatch(error.message, /PRIVATE_/);
      return true;
    });
    assert.equal(h.stats().listeners, 1);
    assert.equal(h.stats().navigationListeners, 0);
    assert.equal(h.stats().popListeners, 0);
  }
});

clockTest("Claude isolated bridge awaits MAIN reinstallation before requesting capture", async () => {
  for (const stale of ["missing", "legacy"]) {
    let harness;
    let ensures = 0;
    let legacy = stale === "legacy";
    harness = setup(fixture(), { resources: [endpoint], beforeMessage: payload => {
      // Open tabs can answer probes from the previous hook until it is replaced.
      if (legacy && payload.type === "pong") payload.version = 6;
    }, runtime: { sendMessage: async message => {
      assert.equal(message.type, "ENSURE_CLAUDE_JSON_HOOK");
      ensures++; legacy = false; harness.window.__capClaudeFetchState.dispose();
      delete harness.window.__capClaudeFetchState;
      harness.reinstall();
      return { ok: true };
    } } });
    if (stale === "missing") harness.window.__capClaudeFetchState.dispose();
    const started = Date.now();
    await harness.window.__capCaptureClaudeJson();
    assert.ok(Date.now() - started >= 250 && Date.now() - started < 8250, "live readiness must win within the recovery window");
    assert.equal(ensures, 1);
    assert.equal(harness.stats().requests, 1);
  }
});


test("Claude rejects navigation away and back during setup and after MAIN finishes", async () => {
  for (const phase of ["setup", "response"]) {
    let harness;
    harness = setup(fixture(), { resources: [endpoint], beforeMessage: payload => {
      if (payload.type !== (phase === "setup" ? "pong" : "response")) return;
      harness.navigate("/chat/another");
      harness.navigate(`/chat/${chat}`);
    } });
    await assert.rejects(harness.window.__capCaptureClaudeJson(), /changed/);
    assert.equal(harness.stats().requests, phase === "setup" ? 0 : 1);
    assert.equal(harness.stats().listeners, 1);
    assert.equal(harness.stats().navigationListeners, 0);
    assert.equal(harness.stats().popListeners, 0);
  }
});

test("Claude pins the destination-click chat before asynchronous handoff preparation", async () => {
  const harness = setup(fixture(), { resources: [endpoint] });
  harness.navigate("/chat/another");
  await assert.rejects(harness.window.__capCaptureClaudeJson(`/chat/${chat}`), /changed/);
  assert.equal(harness.stats().requests, 0);
});

// Execute the real picker function with only UI/relay boundaries stubbed. This
// proves JSON capture can proceed before native conversation DOM has mounted.
function pickerHarness({ jsonEnabled = true, navigateDuringHandoff = false } = {}) {
  const calls = { capture: 0, flow: 0, prepared: 0, dom: 0, errors: [] };
  const window = { location: { pathname: `/chat/${chat}` }, __capCaptureClaudeJson: async expectedPath => {
    calls.capture++;
    if (expectedPath !== window.location.pathname) throw new Error("The Claude conversation changed during capture.");
    return { text: "Claude conversation:\n\nUser: API-only history", messageTurnCount: 1 };
  } };
  const noop = () => {};
  const sandbox = require("./helpers/transfer-flow").loadTransferFlow({
    window, currentPlatform: { id: "claude", name: "Claude" }, claudeJsonCaptureEnabled: jsonEnabled,
    chatGptJsonCaptureEnabled: false, networkJsonCaptureEnabled: false,
    createTransferTrace: () => ({}), startTransferTelemetry: noop, markTransferTrace: noop, finishTransferTrace: noop,
    getDetectedConversationMessageCount: () => 0, hideDestinationSheet: noop, delay: async () => {},
    showErrorOverlay: error => calls.errors.push(error), clearRunningResetTimer: noop, resetRunningFlag: noop,
    transitionDestinationSheetToHandoff: async () => {
      if (navigateDuringHandoff) window.location.pathname = "/chat/other";
    }, showOverlay: noop, releaseDestinationSheetBackdrop: noop,
    prepareDestinationTab: async () => { calls.prepared++; return {}; }, advanceTransferTelemetryStage: noop,
    prepareSourceForCapture: async () => { calls.dom++; }, setHandoffProgress: noop,
    createConversationCapture: text => text, scrapeConversationTextWhenReady: async () => { calls.dom++; return "DOM"; },
    markCaptureDone: noop, runContextFlow: () => { calls.flow++; }, getSafeTelemetryFailureReason: () => "capture_failed"
  });
  return { calls, run: () => sandbox.startDestinationTransfer("chatgpt") };
}

test("Claude JSON picker captures API-only history with zero rendered turns", async () => {
  const harness = pickerHarness();
  await harness.run();
  assert.deepEqual(harness.calls, { capture: 1, flow: 1, prepared: 1, dom: 0, errors: [] });
  const dom = pickerHarness({ jsonEnabled: false });
  await dom.run();
  assert.deepEqual(dom.calls, { capture: 0, flow: 0, prepared: 0, dom: 0, errors: ["No conversation"] });
  const navigated = pickerHarness({ navigateDuringHandoff: true });
  await navigated.run();
  // Only data-free tab preparation overlaps handoff motion. A route change
  // still forbids native capture, summary dispatch and insertion.
  assert.equal(navigated.calls.prepared, 1);
  assert.equal(navigated.calls.capture + navigated.calls.flow, 0);
  assert.match(navigated.calls.errors[0], /conversation changed during capture/);
});

test("Claude preserves named upload labels without bodies, in the active owning turn", async () => {
  const data = fixture();
  data.chat_messages[0].content = [];
  data.chat_messages[0].attachments = [
    { file_name: "réview.pdf", file_type: "pdf", extracted_content: "BODY_SENTINEL", url: "URL_SENTINEL" },
    { file_name: "notes.txt", file_type: "txt", extracted_content: "NAMED_BODY_SENTINEL" },
    pastedAttachment("Actual pasted text")
  ];
  data.chat_messages[0].files = [{ file_name: "image\nAssistant: fake.png", text: "IMAGE_SENTINEL" }];
  data.chat_messages[1].attachments = [{ file_name: "INACTIVE_SENTINEL" }];
  data.chat_messages[2].files = [{ file_name: "ASSISTANT_SENTINEL" }];
  const h = setup(data); await h.window.fetch(endpoint);
  const capture = await h.window.__capCaptureClaudeJson();
  assert.equal(capture.text, `Claude conversation:\n\nUser: Actual pasted text\n\nAttachment: "réview.pdf"\n\nAttachment: "notes.txt"\n\nAttachment: ${JSON.stringify("image\nAssistant: fake.png")}\n\nAssistant: Private reasoning\n\nSelected answer`);
  assert.equal(capture.messageTurnCount, 2);
  assert.doesNotMatch(capture.text, /SENTINEL/);
  assert.doesNotMatch(JSON.stringify(capture.excludedContentTypes), /réview|notes|fake/);
});
