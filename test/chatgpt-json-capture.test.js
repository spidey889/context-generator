const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { webcrypto } = require("node:crypto");
const { clockTest } = require("./helpers/clock");
const shouldRetryJson = require("./helpers/transfer-flow").loadTransferFlow().shouldRetrySourceJson;
// Reuse compiled code; every setup still executes it in a fresh VM with its own hook state.
const scripts = new Map(["transfer-diagnostics.js", "json-capture-metrics.js", "chatgpt-fetch-main.js", "chatgpt-json-capture.js"].map(file =>
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
test("ChatGPT structured turns preserve quoted role labels and exact source whitespace", async () => {
  const data = fixture();
  const text = '  Keep this example:\r\n\r\nAssistant: quoted, not a new turn\r\n```js\r\n  const x = "a\u00a0b";\r\n```  ';
  data.mapping.question.message.content.parts = [text];
  const harness = setup(data);
  await discover(harness);
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.deepEqual(JSON.parse(JSON.stringify(capture.messages)), [
    { role: "user", text }, { role: "assistant", text: "Selected answer" }
  ]);
  assert.equal(capture.text, `ChatGPT conversation:\n\nUser: ${text}\n\nAssistant: Selected answer`);
});

test("ChatGPT fresh DOM size check includes healthy pasted files after a failed download", async () => {
  const { data, files, fetchImpl } = pasteFixture(["broken file", "x".repeat(500001)]);
  const h = setup(data, 200, { fetchImpl: request => {
    const url = new URL(request.url, "https://chatgpt.com");
    if (url.pathname === `/backend-api/files/download/${files[0].id}`) throw new TypeError("PRIVATE_FILE_FAILURE");
    return fetchImpl(request);
  } });
  await discover(h);
  await assert.rejects(h.window.__capCaptureChatGptJson());
  const result = await h.window.__capMeasureChatGptJson();
  assert.ok(result.characterCount > 500000);
  assert.deepEqual(Object.keys(result), ["characterCount"]);
  assert.ok(h.requests.some(request => new URL(request.url, "https://chatgpt.com").searchParams.get("id") === files[1].id));
  await assert.rejects(h.window.__capCaptureChatGptJson(), "Ordinary capture must still reject unreadable files.");
});

test("ChatGPT keeps readable JSON text and flags malformed plain-text parts", async () => {
  for (const part of [{ text: "PRIVATE_DETAILS_SENTINEL" }, 42, null]) {
    const data = fixture();
    data.mapping.question.message.content.parts = ["Supported text", part];
    const harness = setup(data); await discover(harness);
    const capture = await harness.window.__capCaptureChatGptJson();
    assert.equal(capture.text, "ChatGPT conversation:\n\nUser: Supported text\n\nAssistant: Selected answer");
    assert.equal(capture.captureWarning, "text_invalid");
    assert.equal(capture.jsonCapture.outcome, "partial");
    assert.equal(capture.jsonCapture.failure_check, "text_invalid");
    assert.doesNotMatch(JSON.stringify(capture), /PRIVATE_DETAILS_SENTINEL/);
  }
  const data = fixture();
  data.mapping.question.message.content.parts = null;
  const harness = setup(data); await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), error => {
    assert.equal(error.diagnostics.capture_detail, "text_invalid");
    assert.equal(error.allowDomFallback, undefined);
    return true;
  });
  const clean = setup(); await discover(clean);
  assert.equal((await clean.window.__capCaptureChatGptJson()).captureWarning, undefined);
});

test("ChatGPT JSON measurements keep the raw and final text limits separate", async () => {
  const h = setup(); await discover(h);
  const capture = await h.window.__capCaptureChatGptJson();
  assert.equal(capture.jsonCapture.raw_limit_bytes, 32000000);
  assert.equal(capture.jsonCapture.transcript_chars, capture.text.length);
  assert.equal(capture.jsonCapture.transcript_bytes, Buffer.byteLength(capture.text));
  assert.equal(capture.jsonCapture.history_items, 4);
  assert.equal(capture.jsonCapture.selected_turns, 2);
  assert.equal(capture.jsonCapture.failure_check, undefined);
});

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
  for (const file of ["transfer-diagnostics.js", "json-capture-metrics.js", "chatgpt-fetch-main.js", "chatgpt-json-capture.js"]) reinstall(file);
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

test("ChatGPT accepts case-insensitive response media types across session, history and pasted-file reads", async () => {
  for (const [jsonType, textType] of [["Application/JSON; charset=utf-8", "Text/Plain; charset=utf-8"], ["APPLICATION/JSON", "TEXT/PLAIN"]]) {
    const { data, fetchImpl } = pasteFixture();
    const stages = new Set();
    const harness = setup(data, 200, { fetchImpl: async request => {
      const pathname = new URL(request.url, "https://chatgpt.com").pathname;
      const stage = pathname === "/api/auth/session" ? "session"
        : pathname.startsWith("/backend-api/files/download/") ? "descriptor"
          : pathname === "/backend-api/estuary/content" ? "content" : "history";
      stages.add(stage);
      const response = stage === "session" ? jsonResponse({ accessToken: "TEST_ONLY" }) : await fetchImpl(request);
      response.headers.set("content-type", stage === "content" ? textType : jsonType);
      return response;
    } });
    assert.equal((await harness.window.__capCaptureChatGptJson()).text,
      "ChatGPT conversation:\n\nUser: Original pasted document\n\nAssistant: Selected answer");
    assert.deepEqual([...stages], ["session", "history", "descriptor", "content"]);
  }
});

test("ChatGPT forwards the failing request stage and HTTP status as closed diagnostics", async () => {
  const harness = setup(undefined, 403);
  await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), error => {
    assert.equal(error.diagnosticCode, "capture_json_failed");
    assert.equal(error.diagnostics.capture_detail, "http_error");
    assert.equal(error.diagnostics.capture_request_stage, "history");
    assert.equal(error.diagnostics.capture_http_status, 403);
    assert.doesNotMatch(JSON.stringify(error.diagnostics), /TEST_ONLY|test-account/);
    return true;
  });
  const invalid = setup(undefined, 200, { body: "PRIVATE not valid JSON" });
  await discover(invalid);
  await assert.rejects(invalid.window.__capCaptureChatGptJson(), error => {
    assert.equal(error.diagnostics.capture_detail, "invalid_json");
    assert.equal(error.diagnostics.capture_request_stage, "history");
    assert.doesNotMatch(JSON.stringify(error.diagnostics), /PRIVATE/);
    return true;
  });
});

test("ChatGPT file failures report their own HTTP status and preserve guard order", async () => {
  for (const stage of ["attachment_descriptor", "attachment_body"]) {
    const { data, fetchImpl } = pasteFixture();
    const h = setup(data, 200, { fetchImpl: request => {
      const pathname = new URL(request.url, "https://chatgpt.com").pathname;
      const failing = stage === "attachment_descriptor" ? pathname.startsWith("/backend-api/files/download/") : pathname === "/backend-api/estuary/content";
      return failing ? new Response("unavailable", { status: 503, headers: { "content-type": "text/plain", "content-length": "4000000" } }) : fetchImpl(request);
    } });
    await discover(h);
    await assert.rejects(h.window.__capCaptureChatGptJson(), error => {
      assert.equal(error.captureFailureReason, "incomplete", "Keep the existing file error classification.");
      assert.equal(error.diagnostics.capture_http_status, 503);
      assert.equal(error.jsonCapture.http_status, 503);
      assert.equal(error.jsonCapture.failure_stage, stage);
      if (stage === "attachment_body") assert.equal(error.jsonCapture.failure_check, "http_error", "HTTP rejects before the advertised-size guard.");
      assert.equal(error.jsonCapture.transcript_chars, undefined);
      return true;
    });
  }
});

function streamJsonChunks(chunks, headers = {}, cancelError = false) {
  const stats = { bytes: 0, cancelled: 0 };
  let index = 0;
  const response = new Response(new ReadableStream({
    pull(controller) {
      if (index === chunks.length) return controller.close();
      const chunk = chunks[index++]; stats.bytes += chunk.byteLength; controller.enqueue(chunk);
    },
    cancel() {
      stats.cancelled++;
      if (cancelError) throw new Error("PRIVATE_CANCEL_SENTINEL");
    }
  }, { highWaterMark: 0 }), { headers: { "content-type": "application/json", ...headers } });
  return { response, stats };
}

function jsonStageFixture(stage, responseFor) {
  const { data, files, fetchImpl } = pasteFixture();
  const session = { accessToken: "TEST_ONLY", account: { id: "test-account" } };
  const descriptor = { status: "success", file_size_bytes: files[0].size,
    download_url: `https://chatgpt.com/backend-api/estuary/content?id=${files[0].id}&sig=SIGNED_URL_SENTINEL` };
  let healthy = false;
  const harness = setup(data, 200, { fetchImpl: request => {
    const pathname = new URL(request.url, "https://chatgpt.com").pathname;
    const matches = stage === "session" ? pathname === "/api/auth/session"
      : stage === "history" ? pathname === `/backend-api/conversation/${chat}` : pathname.startsWith("/backend-api/files/download/");
    if (matches && !healthy) return responseFor({ session, history: data, descriptor }[stage], request);
    return pathname === "/api/auth/session" ? jsonResponse(session) : fetchImpl(request);
  } });
  return { harness, recover() { healthy = true; } };
}

for (const stage of ["session", "history", "descriptor"]) test("ChatGPT interrupted " + stage + " body stays retryable and a fresh capture keeps the exact full text", async () => {
  let interrupted;
  const { harness, recover } = jsonStageFixture(stage, data => {
    const bytes = Buffer.from(JSON.stringify(data));
    let first = true;
    interrupted = new Response(new ReadableStream({
      pull(controller) {
        if (first) { first = false; controller.enqueue(bytes.subarray(0, Math.floor(bytes.length / 2))); }
        else controller.error(new TypeError("PRIVATE_READ_SENTINEL"));
      }
    }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } });
    return interrupted;
  });
  if (stage !== "session") await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), error => {
    assert.equal(error.captureFailureReason, "request_failed");
    assert.equal(error.diagnostics.capture_detail, "network_error");
    assert.equal(shouldRetryJson(error), true, "The real transfer retry policy must accept this body-network failure.");
    assert.equal(error.diagnostics.capture_request_stage, stage === "descriptor" ? "attachment_descriptor" : stage);
    assert.equal(error.diagnostics.capture_http_status, 200);
    assert.doesNotMatch(error.message + JSON.stringify(error.diagnostics), /PRIVATE_READ_SENTINEL/);
    return true;
  });
  assert.equal(interrupted.body.locked, false);
  assert.equal(harness.navigationListeners(), 0);
  assert.ok(harness.replies.every(reply => !reply.data && !reply.pastedTexts));
  assert.doesNotMatch(JSON.stringify(harness.replies), /PRIVATE_READ_SENTINEL|TEST_ONLY|SIGNED_URL_SENTINEL/);
  recover();
  assert.equal((await harness.window.__capCaptureChatGptJson()).text,
    "ChatGPT conversation:\n\nUser: Original pasted document\n\nAssistant: Selected answer");
});

for (const stage of ["session", "history", "descriptor"]) {
  // All three stages use readJson. Keep its header matrix once, with one
  // oversized streamed response per other stage to protect their wiring.
  const limit = stage === "history" ? 32000000 : 6000000;
  const lengths = stage === "history" ? [undefined, "1", String(limit + 1)] : [undefined];
  for (const length of lengths) test(`ChatGPT bounds ${stage} JSON with Content-Length ${length ?? "absent"} and permits recovery`, async () => {
    let streamed;
    const { harness, recover } = jsonStageFixture(stage, data => {
      const prefix = Buffer.from(JSON.stringify(data).slice(0, -1) + ',"ignored":"');
      streamed = streamJsonChunks([prefix, ...Array(40).fill(new Uint8Array(1000000).fill(32)), Buffer.from('"}')],
        length ? { "content-length": length } : {}, true);
      return streamed.response;
    });
    if (stage !== "session") await discover(harness);
    await assert.rejects(harness.window.__capCaptureChatGptJson(), error => {
      assert.equal(error.captureFailureReason, "incomplete");
      assert.equal(shouldRetryJson(error), false, "A raw-size rejection is not a body-network failure.");
      return true;
    });
    assert.equal(streamed.stats.cancelled, 1);
    assert.ok(streamed.stats.bytes <= limit + 1000000, `The oversized ${stage} body was drained: ${streamed.stats.bytes} bytes.`);
    if (length === String(limit + 1)) assert.equal(streamed.stats.bytes, 0);
    assert.equal(streamed.response.body.locked, false);
    assert.ok(harness.replies.every(reply => !reply.data && !reply.pastedTexts));
    assert.doesNotMatch(JSON.stringify(harness.replies), /PRIVATE_CANCEL_SENTINEL|TEST_ONLY|SIGNED_URL_SENTINEL/);
    assert.equal(harness.navigationListeners(), 0);
    recover();
    assert.equal((await harness.window.__capCaptureChatGptJson()).text,
      "ChatGPT conversation:\n\nUser: Original pasted document\n\nAssistant: Selected answer");
  });
}

test("ChatGPT rejects corrupt history text before draining its tail and permits recovery", async () => {
  let streamed, firstSize;
  const { harness, recover } = jsonStageFixture("history", data => {
    const bytes = Buffer.from(JSON.stringify(data).slice(0, -1) + ',"ignored":"');
    bytes[bytes.indexOf("Selected answer") + 2] = 0xff;
    firstSize = bytes.length;
    streamed = streamJsonChunks([bytes, ...Array(5).fill(new Uint8Array(1000000).fill(32)), Buffer.from('"}')]);
    return streamed.response;
  });
  await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), error => {
    assert.equal(error.captureFailureReason, "incomplete");
    assert.equal(shouldRetryJson(error), false, "Invalid UTF-8 must not become a retryable network error.");
    return true;
  });
  assert.equal(streamed.stats.bytes, firstSize);
  assert.equal(streamed.stats.cancelled, 1);
  assert.equal(streamed.response.body.locked, false);
  assert.ok(harness.replies.every(reply => !reply.data && !reply.pastedTexts));
  assert.doesNotMatch(JSON.stringify(harness.replies), /TEST_ONLY|SIGNED_URL_SENTINEL/);
  recover();
  assert.equal((await harness.window.__capCaptureChatGptJson()).messageTurnCount, 2);
  const malformed = setup(fixture(), 200, { body: '{PRIVATE_SENTINEL' });
  await discover(malformed);
  await assert.rejects(malformed.window.__capCaptureChatGptJson(), error => {
    assert.equal(error.diagnostics.capture_detail, "invalid_json");
    assert.equal(shouldRetryJson(error), false);
    return true;
  });
  assert.doesNotMatch(JSON.stringify(malformed.replies), /PRIVATE_SENTINEL|TEST_ONLY/);
});

function paddedJson(data, size, { bom = false } = {}) {
  const prefix = Buffer.from((bom ? "\uFEFF" : "") + JSON.stringify(data).slice(0, -1) + ',"ignored":"');
  assert.ok(size >= prefix.length + 2, "The exact-size JSON fixture must fit its prefix and closing bytes.");
  // Fill the final body once; a separate padding buffer would copy another
  // 26-32 MB per fixture. Include any BOM here to avoid a second full-body copy.
  const bytes = Buffer.alloc(size, 32);
  prefix.copy(bytes);
  bytes.write('"}', size - 2);
  return bytes;
}

test("ChatGPT discards large alternate branches and descendants before the bridge and keeps full-tree counts", async () => {
  const data = fixture();
  data.mapping.question.children = ["answer", "alternate"];
  data.mapping.question.children.push("unused-0");
  for (let i = 0; i < 2; i++) data.mapping[`unused-${i}`] = { parent: i === 0 ? "question" : "unused-0", children: i === 0 ? ["unused-1"] : [], message: {
    author: { role: "assistant" }, content: { content_type: "text", parts: [`UNSELECTED_SENTINEL ${"x".repeat(3100000)}`] },
    metadata: { attachments: [{ id: "file_unused", is_big_paste: true, mime_type: "text/plain", size: 9999999 }] }
  } };
  data.total_node_count = Object.keys(data.mapping).length;
  data.page_info.total_message_count = data.total_node_count - 1;
  const history = Buffer.from(JSON.stringify(data));
  assert.ok(history.length > 6000000);
  // Discovery observes auth headers only; its native response stays unread.
  // Encode the large owned-capture history once, without a throwaway copy.
  const harness = setup(data, 200, { fetchImpl: request => new Response(
    request.url.startsWith("/backend-api/conversation/") ? history : "{}",
    { headers: { "content-type": "application/json" } }
  ) });
  await discover(harness);
  assert.equal((await harness.window.__capCaptureChatGptJson()).text,
    "ChatGPT conversation:\n\nUser: Question\n\nAssistant: Selected answer");
  const reply = harness.replies.at(-1);
  assert.deepEqual(Object.keys(reply.data.mapping).sort(), ["answer", "question", "root"]);
  assert.equal(JSON.stringify(reply.data.mapping.question.children), '["answer"]');
  assert.equal(reply.sourceTreeCounts.nodes, data.total_node_count);
  assert.equal(reply.sourceTreeCounts.messages, data.page_info.total_message_count);
  assert.doesNotMatch(JSON.stringify(reply), /UNSELECTED_SENTINEL|Wrong branch|file_unused/);
  assert.equal(harness.requests.filter(request => /\/files\/download\//.test(request.url)).length, 0);

  // Count-validation wiring does not depend on megabytes of irrelevant text.
  // Keep the full metadata matrix on a small tree with an unselected branch.
  const small = fixture();
  const fullCount = Object.keys(small.mapping).length;
  small.total_node_count = fullCount;
  small.page_info.total_message_count = fullCount - 1;
  for (const scope of ["conversation", "page_info", "pagination", "metadata"]) for (const key of ["total_node_count", "total_message_count"]) {
    const incomplete = structuredClone(small);
    const target = scope === "conversation" ? incomplete : (incomplete[scope] ||= {});
    target[key] = fullCount + 1;
    const missing = setup(incomplete); await discover(missing);
    await assert.rejects(missing.window.__capCaptureChatGptJson(), /missing history/);
  }
});

test("ChatGPT reports the selected text limit after reading a history larger than the former raw limit", async () => {
  const data = fixture();
  data.mapping.answer.message.content.parts = ["x".repeat(1300000)];
  data.mapping.answer.message.metadata = { ignored: "x".repeat(5000000) };
  const history = Buffer.from(JSON.stringify(data));
  const harness = setup(data, 200, { fetchImpl: request => new Response(
    request.url.startsWith("/backend-api/conversation/") ? history : "{}",
    { headers: { "content-type": "application/json" } }
  ) });
  await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), error => {
    assert.equal(error.captureFailureReason, "size_limit");
    assert.match(error.message, /500,000/);
    return true;
  });
});

test("ChatGPT accepts exactly 32 MB of history with split BOM and Unicode while leaving page responses unread", async () => {
  const data = fixture();
  const text = "  café🙂\r\n\uFEFF  original text  ";
  data.mapping.question.message.content.parts = [text];
  const bytes = paddedJson(data, 32000000, { bom: true });
  const split = bytes.indexOf(Buffer.from("🙂")) + 1;
  const streamed = streamJsonChunks([bytes.subarray(0, 1), bytes.subarray(1, 2), bytes.subarray(2, split),
    bytes.subarray(split, split + 1), bytes.subarray(split + 1)], { "content-length": "32000000" });
  let pageResponse;
  const harness = setup(data, 200, { fetchImpl: request => {
    if (request.url.startsWith("/backend-api/conversation/")) return streamed.response;
    pageResponse = jsonResponse(data);
    return pageResponse;
  } });
  await discover(harness);
  assert.equal((await harness.window.__capCaptureChatGptJson()).text,
    `ChatGPT conversation:\n\nUser: ${text}\n\nAssistant: Selected answer`);
  assert.equal(streamed.stats.bytes, 32000000);
  assert.equal(streamed.stats.cancelled, 0);
  assert.equal(streamed.response.body.locked, false);
  assert.equal(pageResponse.bodyUsed, false);
  assert.deepEqual(await pageResponse.json(), data);
});

for (const total of [32000000, 32000001]) test(`ChatGPT shares its raw allowance across session, history, descriptor and original paste (${total} bytes)`, async () => {
  const { data, files } = pasteFixture(["\uFEFF  café🙂\r\noriginal paste  "]);
  const session = { accessToken: "TEST_ONLY", account: { id: "test-account" } };
  const descriptor = { status: "success", file_size_bytes: files[0].size,
    download_url: `https://chatgpt.com/backend-api/estuary/content?id=${files[0].id}&sig=SIGNED_URL_SENTINEL` };
  const history = paddedJson(data, total - Buffer.byteLength(JSON.stringify(session)) - Buffer.byteLength(JSON.stringify(descriptor)) - files[0].size);
  let paste;
  const harness = setup(data, 200, { fetchImpl: request => {
    const pathname = new URL(request.url, "https://chatgpt.com").pathname;
    if (pathname === "/api/auth/session") return jsonResponse(session);
    if (pathname === `/backend-api/conversation/${chat}`) return new Response(history, { headers: { "content-type": "application/json" } });
    if (pathname.startsWith("/backend-api/files/download/")) return jsonResponse(descriptor);
    paste = streamJsonChunks([Buffer.from(files[0].text)], { "content-type": "text/plain" });
    return paste.response;
  } });
  if (total === 32000000) {
    assert.equal((await harness.window.__capCaptureChatGptJson()).text,
      `ChatGPT conversation:\n\nUser: ${files[0].text}\n\nAssistant: Selected answer`);
    assert.equal(paste.stats.bytes, files[0].size);
  } else {
    await assert.rejects(harness.window.__capCaptureChatGptJson(), error => error.captureFailureReason === "incomplete");
    assert.equal(paste, undefined, "A declared paste beyond the remaining allowance must be rejected before its request.");
    assert.ok(harness.replies.every(reply => !reply.data && !reply.pastedTexts));
  }
  if (paste) assert.equal(paste.response.body.locked, false);
});

test("ChatGPT starts no file requests when history leaves less raw budget than the complete paste manifest", async () => {
  const { data, fetchImpl } = pasteFixture(["x".repeat(100000)]);
  const history = paddedJson(data, 31950000);
  const harness = setup(data, 200, { fetchImpl: request => request.url.startsWith("/backend-api/conversation/")
    ? new Response(history, { headers: { "content-type": "application/json" } }) : fetchImpl(request) });
  await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), error => error.captureFailureReason === "incomplete");
  assert.equal(harness.requests.filter(request => /\/files\/download\/|\/estuary\/content/.test(request.url)).length, 0);
  assert.ok(harness.replies.every(reply => !reply.data && !reply.pastedTexts));
});

test("ChatGPT shares the raw allowance across repeated paste descriptors instead of granting each another budget", async () => {
  const { data, files } = pasteFixture(["First paste", "Second paste"]);
  const historyBytes = 26000000;
  let last;
  const harness = setup(data, 200, { fetchImpl: request => {
    const url = new URL(request.url, "https://chatgpt.com");
    if (url.pathname.startsWith("/backend-api/files/download/")) {
      const file = files.find(entry => url.pathname.endsWith(entry.id));
      const descriptor = { status: "success", file_size_bytes: file.size,
        download_url: `https://chatgpt.com/backend-api/estuary/content?id=${file.id}` };
      const size = file === files[0] ? 3000000 : 3000001 - files[0].size;
      const streamed = streamJsonChunks([paddedJson(descriptor, size)]);
      if (file === files[1]) last = streamed;
      return streamed.response;
    }
    if (url.pathname === "/backend-api/estuary/content") return new Response(files[0].text, { headers: { "content-type": "text/plain" } });
    return request.url.startsWith("/backend-api/conversation/")
      ? new Response(paddedJson(data, historyBytes), { headers: { "content-type": "application/json" } }) : jsonResponse(data);
  } });
  await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), error => error.captureFailureReason === "incomplete");
  assert.equal(harness.requests.filter(request => request.url.includes("/estuary/content")).length, 1);
  assert.equal(last.stats.cancelled, 1);
  assert.equal(last.response.body.locked, false);
  assert.ok(harness.replies.every(reply => !reply.data && !reply.pastedTexts));
});

test("ChatGPT rejects an unfinished UTF-8 tail after complete JSON and permits a fresh capture", async () => {
  const streamed = streamJsonChunks([Buffer.from(JSON.stringify(fixture())), new Uint8Array([0xc3])]);
  let healthy = false;
  const harness = setup(fixture(), 200, { fetchImpl: request => !healthy && request.url.startsWith("/backend-api/conversation/")
    ? streamed.response : jsonResponse(fixture()) });
  await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), error => error.captureFailureReason === "incomplete");
  assert.equal(streamed.response.body.locked, false);
  healthy = true;
  assert.equal((await harness.window.__capCaptureChatGptJson()).messageTurnCount, 2);
});

for (const reason of ["navigation", "account", "timeout"]) clockTest(`ChatGPT aborts pending JSON reads on ${reason} and permits recovery`, async () => {
  let response, signal, readStarted, healthy = false;
  const began = new Promise(resolve => { readStarted = resolve; });
  const harness = setup(fixture(), 200, { fetchImpl: request => {
    if (healthy || !request.url.startsWith("/backend-api/conversation/")) return jsonResponse(fixture());
    signal = request.options.signal;
    response = new Response(new ReadableStream({
      start(controller) {
        signal.addEventListener("abort", () => controller.error(new Error("PRIVATE_ABORT_SENTINEL")), { once: true });
      },
      pull() { readStarted(); return new Promise(() => {}); }
    }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } });
    return response;
  } });
  await discover(harness);
  const capture = harness.window.__capCaptureChatGptJson();
  await began;
  if (reason === "navigation") { harness.navigate("/c/another"); harness.navigate(`/c/${chat}`); }
  if (reason === "account") await harness.window.fetch("/backend-api/settings/user", {
    headers: { authorization: "Bearer new-account", "chatgpt-account-id": "other-account" }
  });
  await assert.rejects(capture, error => {
    assert.doesNotMatch(error.message, /PRIVATE_ABORT_SENTINEL/);
    if (reason === "timeout") assert.equal(error.captureFailureReason, "timeout");
    else assert.match(error.message, /changed during capture/);
    return true;
  });
  assert.equal(signal.aborted, true);
  assert.equal(response.body.locked, false);
  assert.equal(harness.navigationListeners(), 0);
  assert.ok(harness.replies.every(reply => !reply.data && !reply.pastedTexts));
  healthy = true;
  assert.equal((await harness.window.__capCaptureChatGptJson()).messageTurnCount, 2);
});

for (const [stage, status, headers, reason] of [
  ["session", 403, {}, "http"],
  ["history", 206, {}, "http"],
  ["history", 200, { "content-type": "text/html" }, "format"],
  ["session", 200, { "content-type": "application/jsonp" }, "format"],
  ["history", 200, { "content-type": "text/html; note=application/json" }, "format"],
  ["descriptor", 200, { "content-type": "application/json-invalid" }, "paste"],
  ["descriptor", 200, { "content-range": "bytes 0-10/100" }, "paste"]
]) test(`ChatGPT cancels discarded ${stage} responses (${reason}) without exposing cancellation errors`, async () => {
  const { data, fetchImpl } = pasteFixture();
  let cancelled = 0, healthy = false, discarded;
  const harness = setup(data, 200, { fetchImpl: async request => {
    const url = new URL(request.url, "https://chatgpt.com");
    const matches = stage === "session" ? url.pathname === "/api/auth/session"
      : stage === "history" ? url.pathname === `/backend-api/conversation/${chat}`
        : url.pathname.startsWith("/backend-api/files/download/");
    if (matches && !healthy) {
      discarded = new Response(new ReadableStream({ cancel() { cancelled++; throw new Error("PRIVATE_CANCEL_SENTINEL"); } }),
        { status, headers: { "content-type": "application/json", ...headers } });
      return discarded;
    }
    if (url.pathname === "/api/auth/session") return jsonResponse({ accessToken: "TEST_ONLY", account: { id: "test-account" } });
    return fetchImpl(request);
  } });
  if (stage !== "session") await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson());
  assert.equal(cancelled, 1, "A discarded response must stop its unused stream.");
  assert.equal(discarded.body.locked, false);
  assert.equal(harness.replies.at(-1).error, reason);
  assert.doesNotMatch(JSON.stringify(harness.replies), /PRIVATE_CANCEL_SENTINEL|TEST_ONLY/);
  assert.equal(harness.navigationListeners(), 0);
  healthy = true;
  assert.equal((await harness.window.__capCaptureChatGptJson()).text,
    "ChatGPT conversation:\n\nUser: Original pasted document\n\nAssistant: Selected answer");
});

for (const stage of ["history", "descriptor"]) test(`ChatGPT cancels an expired ${stage} response before refreshing auth and retrying once`, async () => {
  const { data, fetchImpl } = pasteFixture(undefined, "Bearer REFRESHED_TEST_ONLY");
  let attempts = 0, cancelled = false, sessions = 0;
  const harness = setup(data, 200, { fetchImpl: async request => {
    const url = new URL(request.url, "https://chatgpt.com");
    if (url.pathname === "/api/auth/session") {
      sessions++;
      assert.equal(cancelled, true, "Dispose the stale response before starting its replacement work.");
      return jsonResponse({ accessToken: "REFRESHED_TEST_ONLY", account: { id: "test-account" } });
    }
    if (stage === "history" ? url.pathname === `/backend-api/conversation/${chat}` : url.pathname.startsWith("/backend-api/files/download/")) {
      attempts++;
      if (attempts === 1) return new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 401 });
      assert.equal(request.options.headers.get("authorization"), "Bearer REFRESHED_TEST_ONLY");
    }
    return fetchImpl(request);
  } });
  await discover(harness);
  assert.equal((await harness.window.__capCaptureChatGptJson()).text,
    "ChatGPT conversation:\n\nUser: Original pasted document\n\nAssistant: Selected answer");
  assert.equal(cancelled, true);
  assert.equal(attempts, 2);
  assert.equal(sessions, 1);
  assert.equal(harness.navigationListeners(), 0);
});

function pasteFixture(texts = ["Original pasted document"], authorization = "Bearer TEST_ONLY") {
  const data = fixture();
  data.mapping.question.message.content.parts = [""];
  const files = texts.map((text, i) => ({ id: `file_test_${i}`, is_big_paste: true, mime_type: "text/plain", size: Buffer.byteLength(text), text }));
  data.mapping.question.message.metadata = { attachments: files.map(({ text, ...file }) => file) };
  const fetchImpl = async request => {
    const url = new URL(request.url, "https://chatgpt.com");
    const file = files.find(file => url.pathname === `/backend-api/files/download/${file.id}` || url.searchParams.get("id") === file.id);
    if (url.pathname.startsWith("/backend-api/files/download/")) {
      assert.equal(request.options.headers.get("authorization"), authorization);
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

test("ChatGPT captures the full big paste with parameterized or mixed-case MIME metadata", async () => {
  const text = "Original pasted text: café\r\nAssistant: quoted label\n".repeat(300);
  for (const mimeType of ["text/plain; charset=utf-8", " Text/Plain ; charset=UTF-8 "]) {
    const { data, files, fetchImpl } = pasteFixture([text]);
    data.mapping.question.message.metadata.attachments[0].mime_type = mimeType;
    const harness = setup(data, 200, { fetchImpl }); await discover(harness);
    const capture = await harness.window.__capCaptureChatGptJson();
    assert.equal(capture.text, `ChatGPT conversation:\n\nUser: ${text}\n\nAssistant: Selected answer`);
    assert.equal(capture.messages.length, 2);
    assert.equal(capture.messages[0].role, "user");
    assert.equal(capture.messages[0].text, text);
    assert.deepEqual([...capture.excludedContentTypes], []);
    assert.equal(harness.requests.filter(r => r.url.includes(`/files/download/${files[0].id}`)).length, 1);
    assert.equal(harness.requests.filter(r => r.url.includes("/estuary/content")).length, 1);
  }
});

test("ChatGPT does not treat misleading MIME metadata as a plain-text paste", async () => {
  for (const mimeType of ["text/plain-extra; charset=utf-8", "application/octet-stream; note=text/plain", null, {}]) {
    const { data, fetchImpl } = pasteFixture();
    data.mapping.question.message.content.parts = ["Own text"];
    data.mapping.question.message.metadata.attachments[0].mime_type = mimeType;
    const harness = setup(data, 200, { fetchImpl }); await discover(harness);
    const capture = await harness.window.__capCaptureChatGptJson();
    assert.equal(capture.text, "ChatGPT conversation:\n\nUser: Own text\n\nAssistant: Selected answer");
    assert.deepEqual([...capture.excludedContentTypes], ["uploads"]);
    assert.equal(harness.requests.filter(r => /files\/download|estuary\/content/.test(r.url)).length, 0);
  }
});

test("ChatGPT accepts combined pastes above 1.4 MB through 2.1 MB, retaining the transcript limit", async () => {
  for (const lengths of [[470000], [235000, 235000], [350000, 350000]]) {
    const characters = lengths.reduce((sum, length) => sum + length, 0);
    const texts = lengths.map(length => "文".repeat(length));
    const { data, fetchImpl } = pasteFixture(texts);
    const harness = setup(data, 200, { fetchImpl });
    await discover(harness);
    const capture = harness.window.__capCaptureChatGptJson();
    if (characters === 470000) {
      assert.equal((await capture).text, `ChatGPT conversation:\n\nUser: ${texts.join("\n\n")}\n\nAssistant: Selected answer`);
    } else {
      await assert.rejects(capture, error => error.captureFailureReason === "size_limit");
    }
    assert.equal(harness.requests.filter(request => request.url.includes("/estuary/content")).length, texts.length,
      "Files fit the combined allowance, including exactly 2.1 MB; the final transcript is checked separately.");
  }
});

for (const [name, mutate, reason] of [
  ["invalid ID", files => { files[1].id = "file_invalid/path"; }, "paste"],
  ["invalid size", files => { files[1].size = "6"; }, "paste"],
  ["oversized total", files => { files[1].size = 2100001 - files[0].size; }, "size"],
  ["conflicting duplicate", files => { files[1].id = files[0].id; files[1].size = files[0].size + 1; }, "paste"]
]) test(`ChatGPT manifest rejects a later ${name} before any file request`, async () => {
  const { data, fetchImpl } = pasteFixture(["First paste", "Second paste"]);
  mutate(data.mapping.question.message.metadata.attachments);
  const harness = setup(data, 200, { fetchImpl });
  await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), error => {
    if (reason === "size") {
      assert.equal(error.diagnostics.capture_detail, "attachment_size_limit");
      assert.equal(error.diagnostics.capture_request_stage, "attachment_descriptor");
    }
    return true;
  });
  assert.equal(harness.replies.at(-1).error, reason);
  assert.equal(harness.requests.filter(request => /\/files\/download\/|\/estuary\/content/.test(request.url)).length, 0,
    "An invalid later file must reject the complete manifest before any file request.");
  assert.ok(harness.replies.every(reply => !reply.data && !reply.pastedTexts));
  assert.equal(harness.navigationListeners(), 0);
});

test("ChatGPT stops an oversized paste without Content-Length, then allows a fresh exact capture", async () => {
  const { data, fetchImpl } = pasteFixture();
  let delivered = 0, cancelled = false, healthy = false, body;
  const harness = setup(data, 200, { fetchImpl: request => {
    if (healthy || !request.url.includes("/estuary/content")) return fetchImpl(request);
    let chunks = 0;
    const padding = new Uint8Array(1000000).fill(32);
    body = new ReadableStream({
      pull(controller) {
        if (chunks++ === 20) return controller.close();
        delivered += padding.length; controller.enqueue(padding);
      },
      cancel() { cancelled = true; }
    });
    return new Response(body, { headers: { "content-type": "text/plain" } });
  } });
  await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), /pasted text attachment could not be read completely/);
  assert.ok(delivered <= 2000000, `Stop at the first oversized chunk plus prefetch; delivered ${delivered} bytes.`);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
  assert.equal(harness.navigationListeners(), 0);
  assert.ok(harness.replies.every(reply => !reply.data && !reply.pastedTexts));
  healthy = true;
  assert.equal((await harness.window.__capCaptureChatGptJson()).text,
    "ChatGPT conversation:\n\nUser: Original pasted document\n\nAssistant: Selected answer");
});

test("ChatGPT streamed pastes preserve split UTF-8/BOM and reject short, invalid or excess bytes", async () => {
  const original = "\uFEFF  café🙂\r\nEND  ";
  for (const outcome of ["exact", "short", "invalid", "excess"]) {
    const { data, fetchImpl } = pasteFixture([original]);
    let bytes = Buffer.from(original), body;
    if (outcome === "short") bytes = bytes.subarray(0, bytes.length - 1);
    if (outcome === "invalid") bytes[0] = 255;
    if (outcome === "excess") bytes = Buffer.concat([bytes, Buffer.from("x")]);
    const harness = setup(data, 200, { fetchImpl: request => {
      if (!request.url.includes("/estuary/content")) return fetchImpl(request);
      let offset = 0;
      body = new ReadableStream({ pull(controller) {
        if (offset === bytes.length) return controller.close();
        controller.enqueue(bytes.subarray(offset, ++offset));
      } });
      return new Response(body, { headers: { "content-type": "text/plain" } });
    } });
    await discover(harness);
    if (outcome === "exact") assert.equal((await harness.window.__capCaptureChatGptJson()).text,
      `ChatGPT conversation:\n\nUser: ${original}\n\nAssistant: Selected answer`);
    else {
      await assert.rejects(harness.window.__capCaptureChatGptJson(), /pasted text attachment could not be read completely/);
      assert.ok(harness.replies.every(reply => !reply.data && !reply.pastedTexts));
      assert.doesNotMatch(JSON.stringify(harness.replies), /TEST_ONLY|SIGNED_URL_SENTINEL/);
    }
    assert.equal(body.locked, false);
  }
});

test("ChatGPT rejects paste transport before reading and preserves safe errors when cancellation fails", async () => {
  for (const [status, headers] of [
    [206, { "content-type": "text/plain" }],
    [200, { "content-type": "text/html" }],
    [200, { "content-type": "text/plain-invalid" }],
    [200, { "content-type": "text/plain", "content-range": "bytes 0-23/100" }],
    [200, { "content-type": "text/plain", "content-length": "100" }]
  ]) {
    const { data, fetchImpl } = pasteFixture();
    let cancelled = false, body;
    const harness = setup(data, 200, { fetchImpl: request => {
      if (!request.url.includes("/estuary/content")) return fetchImpl(request);
      body = new ReadableStream({ cancel() { cancelled = true; throw new Error("PRIVATE_CANCEL_SENTINEL"); } });
      return new Response(body, { status, headers });
    } });
    await discover(harness);
    await assert.rejects(harness.window.__capCaptureChatGptJson(), error => {
      assert.match(error.message, /pasted text attachment could not be read completely/);
      assert.doesNotMatch(error.message, /PRIVATE_/);
      return true;
    });
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
    assert.ok(harness.replies.every(reply => !reply.data && !reply.pastedTexts));
    assert.doesNotMatch(JSON.stringify(harness.replies), /TEST_ONLY|SIGNED_URL_SENTINEL|PRIVATE_CANCEL_SENTINEL/);
  }
});

test("ChatGPT replaces the previous hook without losing observed authentication", async () => {
  const { data, fetchImpl } = pasteFixture();
  const harness = setup(data, 200, { fetchImpl });
  await discover(harness);
  const old = harness.window.__capChatGptFetchState;
  old.version = 8;
  harness.reinstall();
  assert.notEqual(harness.window.__capChatGptFetchState, old);
  assert.equal(harness.window.__capChatGptFetchState.version, 18);
  assert.equal(harness.listeners(), 1);
  assert.equal((await harness.window.__capCaptureChatGptJson()).text,
    "ChatGPT conversation:\n\nUser: Original pasted document\n\nAssistant: Selected answer");
});

clockTest("ChatGPT aborts a pending paste body on navigation, account changes and timeout", async () => {
  for (const reason of ["navigate", "account", "timeout"]) {
    const { data, fetchImpl } = pasteFixture();
    let aborted = false, body;
    const harness = setup(data, 200, { fetchImpl: request => {
      if (!request.url.includes("/estuary/content")) return fetchImpl(request);
      body = new ReadableStream({ start(controller) {
        controller.enqueue(Buffer.from("partial"));
        request.options.signal.addEventListener("abort", () => {
          aborted = true; controller.error(new Error("PRIVATE_ABORT_SENTINEL"));
        }, { once: true });
      } });
      return new Response(body, { headers: { "content-type": "text/plain" } });
    } });
    await discover(harness);
    const capture = harness.window.__capCaptureChatGptJson();
    const rejected = assert.rejects(capture, error => {
      assert.match(error.message, reason === "timeout" ? /timed out/ : /changed/);
      assert.doesNotMatch(error.message, /PRIVATE_/);
      return true;
    });
    await new Promise(setImmediate);
    if (reason === "navigate") { harness.navigate("/c/other"); harness.navigate(`/c/${chat}`); }
    if (reason === "account") await harness.window.fetch("/backend-api/settings/user", {
      headers: { authorization: "Bearer other-token", "chatgpt-account-id": "other-account" }
    });
    await rejected;
    assert.equal(aborted, true);
    assert.equal(body.locked, false);
    assert.equal(harness.navigationListeners(), 0);
    assert.ok(harness.replies.every(reply => !reply.data && !reply.pastedTexts));
  }
});

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

test("ChatGPT rejects denied, mismatched or wrong-file paste descriptors", async () => {
  for (const badDescriptor of [
    request => request.url.includes("/files/download/") ? new Response("Denied", { status: 403 }) : null,
    request => request.url.includes("/files/download/") ? jsonResponse({ status: "success", file_size_bytes: 5, download_url: "https://chatgpt.com/backend-api/estuary/content?id=file_test_0" }) : null,
    request => request.url.includes("/files/download/") ? jsonResponse({ status: "success", file_size_bytes: 24, download_url: "https://other.example/private?id=file_test_0" }) : null,
    request => request.url.includes("/files/download/") ? jsonResponse({ status: "success", file_size_bytes: 24, download_url: "https://chatgpt.com/backend-api/estuary/content?id=file_wrong" }) : null
  ]) {
    const { data, fetchImpl } = pasteFixture();
    const harness = setup(data, 200, { fetchImpl: request => badDescriptor(request) || fetchImpl(request) }); await discover(harness);
    await assert.rejects(harness.window.__capCaptureChatGptJson(), /pasted text attachment could not be read completely/);
    assert.equal(harness.replies.at(-1).data, undefined, "An incomplete paste must not produce a successful tree response.");
    assert.doesNotMatch(JSON.stringify(harness.replies), /TEST_ONLY|SIGNED_URL_SENTINEL|Denied/);
  }
});

test("ChatGPT validates paste byte counts, truncation flags and transcript size without dropping the user", async () => {
  for (const mutate of [
    (data, files) => { data.mapping.question.message.metadata.attachments[0].size--; },
    data => { data.mapping.question.message.metadata.attachments[0].truncated = true; },
    data => { data.mapping.question.message.metadata.attachments[0].id = "../outside"; },
    data => { data.mapping.question.message.metadata.attachments[0].size = 2100001; }
  ]) {
    const { data, files, fetchImpl } = pasteFixture(); mutate(data, files);
    const harness = setup(data, 200, { fetchImpl }); await discover(harness);
    await assert.rejects(harness.window.__capCaptureChatGptJson(), /JSON capture|500,000|2\.1 MB/);
  }
  const { data, fetchImpl } = pasteFixture(["x".repeat(500000)]);
  const harness = setup(data, 200, { fetchImpl }); await discover(harness);
  await assert.rejects(harness.window.__capCaptureChatGptJson(), /500,000/);
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
  const data = fixture(); addPythonResult(data, "x".repeat(500000));
  const h = setup(data); await discover(h);
  await assert.rejects(h.window.__capCaptureChatGptJson(), /500,000/);
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
    await assert.rejects(harness.window.__capCaptureChatGptJson(), error => error.captureFailureReason === "incomplete");
  }
});

test("ChatGPT captures available text while the active reply is unfinished or failed", async () => {
  for (const status of ["in_progress", "finished_successfully", "finished_partial", "failed"]) {
    const data = fixture();
    Object.assign(data.mapping.answer.message, { status, end_turn: false });
    data.mapping.answer.message.content.parts = ["  Available reply\n"];
    const harness = setup(data); await discover(harness);
    const capture = await harness.window.__capCaptureChatGptJson();
    assert.equal(capture.text, "ChatGPT conversation:\n\nUser: Question\n\nAssistant:   Available reply\n");
    assert.equal(capture.messageTurnCount, 2);
  }
});

test("ChatGPT captures unfinished thoughts and skips an empty pending reply", async () => {
  for (const body of ["  Available thought\n", ""]) {
    const data = fixture();
    data.mapping.thought = { parent: "question", message: {
      author: { role: "assistant" }, status: "in_progress", end_turn: false,
      content: { content_type: "thoughts", thoughts: [{ content: body, summary: "Visible thought", finished: false }] }
    } };
    data.mapping.answer.parent = "thought";
    Object.assign(data.mapping.answer.message, { status: "in_progress", end_turn: false });
    data.mapping.answer.message.content.parts = [""];
    const harness = setup(data); await discover(harness);
    const capture = await harness.window.__capCaptureChatGptJson();
    assert.equal(capture.text, `ChatGPT conversation:\n\nUser: Question\n\nAssistant: ${body || "Visible thought"}`);
    assert.equal(capture.messageTurnCount, 2);
  }
  const data = fixture();
  Object.assign(data.mapping.answer.message, { status: "in_progress", end_turn: false });
  data.mapping.answer.message.content.parts = [];
  const harness = setup(data); await discover(harness);
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.equal(capture.text, "ChatGPT conversation:\n\nUser: Question");
  assert.equal(capture.messageTurnCount, 1);
});

test("ChatGPT captures prior turns while a search tool is still running", async () => {
  const data = fixture();
  data.mapping.search = { parent: "answer", message: {
    author: { role: "assistant" }, recipient: "web.run", status: "in_progress", end_turn: false,
    content: { content_type: "code", text: "TOOL_SENTINEL" }
  } };
  data.current_node = "search";
  const harness = setup(data); await discover(harness);
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.equal(capture.text, "ChatGPT conversation:\n\nUser: Question\n\nAssistant: Selected answer");
  assert.deepEqual([...capture.excludedContentTypes], ["tools"]);
});

test("ChatGPT JSON capture never extracts nested tool/file/image/artifact text", async () => {
  const data = fixture();
  data.mapping.question.message.content = { content_type: "multimodal_text", parts: ["Own prompt", { content_type: "image_asset_pointer", text: "IMAGE_SENTINEL" }] };
  data.mapping.question.message.metadata = { attachments: [{ text: "FILE_SENTINEL" }] };
  data.mapping.tool = { parent: "question", message: { author: { role: "tool" }, content: { content_type: "text", parts: ["TOOL_SENTINEL"] } } };
  data.mapping.answer.parent = "tool";
  data.mapping.answer.message.content.content_type = "multimodal_text";
  data.mapping.answer.message.content.parts = ["Own answer", { type: "tool_result", content: [{ type: "text", text: "NESTED_SENTINEL" }] }, { type: "artifact", text: "ARTIFACT_SENTINEL" }];
  const harness = setup(data); await discover(harness);
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.equal(capture.text, "ChatGPT conversation:\n\nUser: Own prompt\n\nAssistant: Own answer");
});

test("ChatGPT JSON capture rejects absent auth and changed routes", async () => {
  const noAuth = setup(); await noAuth.window.fetch(fullUrl);
  await assert.rejects(noAuth.window.__capCaptureChatGptJson(), /authentication is unavailable/);
  assert.equal(noAuth.requests.length, 2);
  const moved = setup(); await discover(moved); moved.location.pathname = "/c/other";
  await assert.rejects(moved.window.__capCaptureChatGptJson(), /changed during capture/);
});


test("ChatGPT JSON capture admits the direct range through 500,000 characters without clipping", async () => {
  const baseline = setup();
  await discover(baseline);
  const overhead = (await baseline.window.__capCaptureChatGptJson()).text.length - "Selected answer".length;
  for (const length of [350001, 500000, 500001]) {
    const data = fixture();
    data.mapping.answer.message.content.parts = ["漢".repeat(length - overhead)];
    // Discovery observes headers only; encode the large owned history once.
    const history = Buffer.from(JSON.stringify(data));
    const h = setup(data, 200, { fetchImpl: request => new Response(
      request.url.startsWith("/backend-api/conversation/") ? history : "{}",
      { headers: { "content-type": "application/json" } }
    ) });
    await discover(h);
    if (length > 500000) await assert.rejects(h.window.__capCaptureChatGptJson(), /500,000/);
    else assert.equal((await h.window.__capCaptureChatGptJson()).text.length, length);
  }
});

function jsonResponse(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}

test("ChatGPT preserves large pasted strings, own code, reasoning recap and thoughts in the active branch", async () => {
  const data = fixture();
  const pasted = `PASTE_START\n${"  all lines and indentation\n".repeat(1600)}PASTE_END`;
  data.mapping.question.message.content.parts = [pasted];
  const recap = "  Own recap\r\n", thought = "  Own thought\n", code = "  if enabled:\n    run()\n";
  data.mapping.recap = { parent: "question", message: { author: { role: "assistant" }, status: "finished_successfully", content: { content_type: "reasoning_recap", content: recap } } };
  data.mapping.thought = { parent: "recap", message: { author: { role: "assistant" }, content: { content_type: "thoughts", thoughts: [{ content: thought, summary: "DUPLICATE_SENTINEL", chunks: [{ text: "NESTED_SENTINEL" }], finished: true }] } } };
  data.mapping.answer.parent = "thought";
  data.mapping.answer.message.content = { content_type: "code", text: code, language: "python" };
  const harness = setup(data); await discover(harness);
  const capture = await harness.window.__capCaptureChatGptJson();
  assert.equal(capture.text, `ChatGPT conversation:\n\nUser: ${pasted}\n\nAssistant: ${recap}\n\nAssistant: ${thought}\n\nAssistant: ${code}`);
  assert.equal(capture.messageTurnCount, 4);
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
