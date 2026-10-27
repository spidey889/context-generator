const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { webcrypto } = require("node:crypto");
const { clockTest } = require("./helpers/clock");
const { fixtures, rpcFrame, geminiTurn, prompt } = require("./network-json-fixtures");
const files = ["network-json-data.js", "network-fetch-main.js", "network-json-capture.js"];
const scripts = new Map(["transfer-diagnostics.js", "json-capture-metrics.js", ...files].map(file =>
  [file, new vm.Script(fs.readFileSync(path.join(__dirname, "..", "extension", file), "utf8"), { filename: file })]));
for (const platform of ["gemini", "grok", "deepseek"]) test(`${platform}: independent count returns only numeric size and turn metadata from a new native read`, async () => {
  const h = setup(platform); await h.observe();
  const capture = await h.window.__capCaptureNetworkJson();
  const requests = h.requests.length;
  const result = await h.window.__capMeasureNetworkJson();
  assert.equal(result.characterCount, capture.text.length);
  assert.equal(result.messageTurnCount, capture.messageTurnCount);
  assert.deepEqual(Object.keys(result), ["characterCount", "messageTurnCount"]);
  assert.ok(h.requests.length > requests);
  if (platform === "deepseek") {
    assert.ok(h.replies.at(-1).characterCount > 0);
    assert.equal(h.replies.at(-1).capture, undefined);
  }
});
for (const platform of ["gemini", "grok", "deepseek"]) test(`${platform}: successful JSON records transport and transcript headroom without content`, async () => {
  const h = setup(platform); await h.observe();
  const capture = await h.window.__capCaptureNetworkJson();
  const stats = capture.jsonCapture;
  assert.equal(stats.outcome, "succeeded");
  assert.equal(stats.raw_limit_bytes, 32000000);
  assert.ok(stats.raw_bytes > 0 && stats.raw_bytes < stats.raw_limit_bytes);
  assert.equal(stats.transcript_chars, capture.text.length);
  assert.equal(stats.transcript_bytes, Buffer.byteLength(capture.text));
  assert.equal(stats.selected_turns, capture.messageTurnCount);
  assert.ok(stats.history_items >= 24 && stats.requests >= 1);
  assert.doesNotMatch(JSON.stringify(stats), /SENTINEL|Original source|https:|Bearer|smoke/);
});
test("DeepSeek logs the exact raw header guard even though no body bytes were read", async () => {
  const h = setup("deepseek", undefined, { fetchImpl: () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "32000001" } }) });
  await h.observe();
  await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
    assert.equal(error.captureFailureReason, "size_limit");
    assert.equal(error.jsonCapture.failure_check, "raw_header_limit");
    assert.equal(error.jsonCapture.failure_value, 32000001);
    assert.equal(error.jsonCapture.failure_limit, 32000000);
    assert.equal(error.jsonCapture.failure_value_source, "content_length");
    assert.equal(error.jsonCapture.raw_bytes, 0);
    assert.equal(error.jsonCapture.transcript_chars, undefined);
    return true;
  });
});
test("DeepSeek distinguishes a streamed raw excess from an oversized selected transcript", async () => {
  const raw = setup("deepseek", undefined, { fetchImpl: () => new Response(" ".repeat(32000001), { headers: { "content-type": "application/json" } }) });
  await raw.observe();
  await assert.rejects(raw.window.__capCaptureNetworkJson(), error => {
    assert.equal(error.jsonCapture.failure_check, "raw_total_stream_limit");
    assert.equal(error.jsonCapture.failure_value, 32000001);
    assert.equal(error.jsonCapture.raw_bytes, 32000001);
    return true;
  });
  const f = fixtures("deepseek", "smoke", 2);
  f.data.data.biz_data.chat_messages.at(-1).fragments[0].content = "x".repeat(1000001);
  const transcript = setup("deepseek", f); await transcript.observe();
  await assert.rejects(transcript.window.__capCaptureNetworkJson(), error => {
    assert.equal(error.jsonCapture.failure_check, "transcript_char_limit");
    assert.equal(error.jsonCapture.failure_limit, 1000000);
    assert.equal(error.jsonCapture.failure_value, error.jsonCapture.transcript_chars);
    assert.equal(error.jsonCapture.transcript_bytes, undefined, "The existing char guard must still short circuit encoding.");
    assert.ok(error.jsonCapture.raw_bytes < 32000000);
    return true;
  });
});

test("DeepSeek: fresh size check keeps downloading healthy files after another file fails", async () => {
  const f = deepseekUploads(2);
  f.files[f.uploads[1].id] = "x".repeat(1000001);
  f.uploads[1].file_size = 1000001;
  let historyReads = 0;
  const h = setup("deepseek", f, { fetchImpl: request => {
    if (request.url.pathname.includes("history_messages")) { historyReads++; return Response.json(f.data); }
    const id = `file-${request.url.searchParams.get("file_id")}`;
    if (id === f.uploads[0].id) throw new TypeError("PRIVATE_FILE_DOWNLOAD_FAILURE");
    return new Response(f.files[id], { headers: { "content-type": "text/plain" } });
  } });
  await h.observe();
  await assert.rejects(h.window.__capCaptureNetworkJson());
  const result = await h.window.__capMeasureNetworkJson();
  assert.equal(historyReads, 2, "Size checking must fetch again, not reuse the failed capture's history.");
  assert.ok(result.characterCount > 1000000, "The successfully downloaded file must contribute to the count.");
  assert.deepEqual(Object.keys(result), ["characterCount", "messageTurnCount"]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SENTINEL|source-/);
});

test("DeepSeek: measurement and ordinary capture both retain healthy files despite bad attachments", async () => {
  const f = deepseekUploads(3);
  f.uploads[0].signed_path = "https://other.example/api/file?file_id=upload-0";
  const h = setup("deepseek", f, { fetchImpl: request => {
    if (request.url.pathname.includes("history_messages")) return Response.json(f.data);
    const id = `file-${request.url.searchParams.get("file_id")}`;
    if (id === f.uploads[1].id) throw new TypeError("PRIVATE_FILE_DOWNLOAD_FAILURE");
    return new Response(f.files[id], { headers: { "content-type": "text/plain" } });
  } });
  await h.observe();
  const result = await h.window.__capMeasureNetworkJson();
  const healthyOnly = h.api.deepseek(f.data, "smoke", { [f.uploads[2].id]: f.files[f.uploads[2].id] }, { set() {}, transcript: () => true }, true);
  assert.equal(result.characterCount, healthyOnly.text.length);
  assert.ok(result.characterCount < 1000000);
  assert.equal(h.requests.filter(request => request.url.hostname === "other.example").length, 0);
  assert.equal(h.requests.filter(request => request.url.searchParams.get("file_id") === "upload-2").length, 1);
  assert.equal((await h.window.__capCaptureNetworkJson()).text, healthyOnly.text);
});

test("DeepSeek: fresh size check selects the current branch and keeps the exact 500k boundary", async () => {
  for (const extra of [0, 1]) {
    const f = fixtures("deepseek", "smoke", 1);
    const messages = f.data.data.biz_data.chat_messages;
    const prefix = "DeepSeek conversation:\n\nUser: x\n\nAssistant: ";
    messages[0].fragments = [{ type: "REQUEST", content: "x" }];
    messages[1].fragments = [{ type: "RESPONSE", content: "a".repeat(1000000 - prefix.length + extra) }];
    messages.push({ message_id: 100, parent_id: null, role: "ASSISTANT", fragments: [{ type: "RESPONSE", content: "z".repeat(1000001) }] });
    const h = setup("deepseek", f); await h.observe();
    const result = await h.window.__capMeasureNetworkJson();
    assert.equal(result.characterCount, 1000000 + extra);
    assert.equal(h.requests.length, 1);
  }
});

test("DeepSeek: bad repeated-file metadata cannot erase another readable oversized file", async () => {
  const f = deepseekUploads(2);
  f.files[f.uploads[1].id] = "x".repeat(1000001);
  f.uploads[1].file_size = 1000001;
  f.data.data.biz_data.chat_messages[0].fragments[0].files.push({ ...f.uploads[0], status: "PENDING" });
  const h = setup("deepseek", f, { fetchImpl: request => request.url.pathname.includes("history_messages")
    ? Response.json(f.data)
    : new Response(f.files[`file-${request.url.searchParams.get("file_id")}`], { headers: { "content-type": "text/plain" } }) });
  await h.observe();
  const result = await h.window.__capMeasureNetworkJson();
  assert.ok(result.characterCount > 1000000, "A malformed file entry must not discard healthy file text from the count.");
});

for (const platform of ["gemini", "grok", "deepseek"]) test(`${platform}: cancelling a background count releases native capture for the next transfer`, async () => {
  let stall = true;
  const started = {};
  started.promise = new Promise(resolve => { started.resolve = resolve; });
  const h = setup(platform, undefined, { fetchImpl: async request => {
    if (stall) {
      started.resolve();
      return new Promise((_, reject) => request.options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    }
    if (platform === "gemini") {
      const args = JSON.parse(JSON.parse(new URLSearchParams(request.options.body).get("f.req"))[0][0][1]);
      return new Response(rpcFrame(h.fixture.pages[args[2] ? Number(args[2].split("_")[1]) : 0]), { headers: { "content-type": "application/json" } });
    }
    if (platform === "grok") return Response.json(request.url.pathname.endsWith("response-node") ? h.fixture.nodes : { responses: h.fixture.responses.filter(message => JSON.parse(request.options.body).responseIds.includes(message.responseId)) });
    return request.url.pathname.includes("history_messages") ? Response.json(h.fixture.data)
      : new Response(h.fixture.files[h.fixture.file.id], { headers: { "content-type": "text/plain" } });
  } });
  await h.observe();
  const controller = new AbortController();
  const count = h.window.__capMeasureNetworkJson(undefined, controller.signal);
  const stopped = count.then(() => false, () => true);
  await started.promise;
  controller.abort();
  stall = false;
  const outcome = await Promise.race([stopped, new Promise(resolve => setTimeout(() => resolve("still running"), 100))]);
  if (outcome !== true) { h.navigate("/app/cleanup"); await stopped; }
  assert.equal(outcome, true, "Cancellation should settle promptly, not hold the JSON queue for 25 seconds.");
  assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
});

test("DeepSeek: a count from a changed native session cannot stop the DOM attempt", async () => {
  const f = fixtures("deepseek", "smoke", 1);
  const h = setup("deepseek", f, { fetchImpl: request => {
    if (request.url.pathname.includes("history_messages")) return Response.json(f.data);
    const xhr = h.newXhr();
    xhr.open("GET", `${h.location.origin}/api/v0/session`);
    xhr.setRequestHeader("authorization", "Bearer CHANGED_SESSION");
    xhr.send();
    return new Response(f.files[f.file.id], { headers: { "content-type": "text/plain" } });
  } });
  await h.observe();
  await assert.rejects(h.window.__capMeasureNetworkJson(), error => error.diagnosticCode === "conversation_changed");
});
test("DeepSeek logs supported manifest excess and ignores a large PDF without downloading it", async () => {
  const f = fixtures("deepseek"); f.file.file_size = 4400000;
  const h = setup("deepseek", f); await h.observe();
  await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
    assert.equal(error.jsonCapture.failure_check, "supported_files_limit");
    assert.equal(error.jsonCapture.failure_value, 4400000);
    assert.equal(error.jsonCapture.failure_limit, 4100000);
    assert.equal(error.jsonCapture.files_supported, 1);
    assert.equal(error.jsonCapture.files_downloaded_bytes, 0);
    return true;
  });
  assert.equal(h.requests.length, 1);
  f.file.file_name = "PRIVATE_PDF_SENTINEL.pdf";
  const ignored = setup("deepseek", f); await ignored.observe();
  const capture = await ignored.window.__capCaptureNetworkJson();
  assert.equal(capture.jsonCapture.files_supported, 0);
  assert.equal(capture.jsonCapture.files_ignored_pdf, 1);
  assert.equal(capture.jsonCapture.files_downloaded_bytes, 0);
  assert.equal(ignored.requests.length, 1);
  assert.doesNotMatch(JSON.stringify(capture.jsonCapture), /PRIVATE_PDF_SENTINEL/);
});
for (const platform of ["gemini", "grok", "deepseek"]) test(`${platform}: native HTTP failures preserve their actual status and read boundary`, async () => {
  const h = setup(platform, undefined, { fetchImpl: () => new Response("PRIVATE response", { status: 403 }) });
  await h.observe();
  await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
    assert.equal(error.diagnosticCode, "capture_json_failed");
    assert.equal(error.diagnostics.capture_detail, "http_error");
    assert.equal(error.diagnostics.capture_http_status, 403);
    assert.equal(error.diagnostics.capture_request_stage, "history");
    assert.doesNotMatch(JSON.stringify(error.diagnostics), /PRIVATE|AUTH_SENTINEL|CSRF_SENTINEL/);
    return true;
  });
});
for (const platform of ["gemini", "grok", "deepseek"]) test(`${platform}: unexpected native serializer exceptions retain stage and class without a guessed network cause`, async () => {
  const h = setup(platform);
  await h.observe();
  h.api[platform] = () => { throw new TypeError("PRIVATE chat filename.csv https://PRIVATE"); };
  await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
    assert.equal(error.jsonCapture.failure_stage, "serialize");
    assert.equal(error.jsonCapture.failure_check, "unknown");
    assert.equal(error.jsonCapture.failure_error_type, "TypeError");
    const details = require("../extension/transfer-diagnostics.js").errorDetails(error, "capture_json");
    assert.equal(details.capture_detail, undefined);
    assert.equal(details.failure_site, "capture_serialize");
    assert.doesNotMatch(JSON.stringify(details) + JSON.stringify(error.jsonCapture), /PRIVATE|filename|https/);
    return true;
  });
});

test("Network bridge validation exceptions are reported immediately with the observed serialization stage", async () => {
  const h = setup("grok", undefined, { beforeMessage(reply) {
    if (reply.type === "response" && reply.capture) Object.defineProperty(reply.capture, "text", {
      get() { throw new TypeError("PRIVATE chat filename.csv https://PRIVATE"); }
    });
  } });
  await h.observe();
  await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
    assert.equal(error.jsonCapture.failure_stage, "serialize");
    assert.equal(error.jsonCapture.failure_error_type, "TypeError");
    assert.equal(error.jsonCapture.failure_check, "unknown");
    assert.doesNotMatch(JSON.stringify(error.jsonCapture), /PRIVATE|filename|https/);
    return true;
  });
});

function setup(platform, fixture = fixtures(platform), { fetchImpl, responseTransform, runtime, schedule = setTimeout, beforeMessage, localStorage } = {}) {
  const requests = [], replies = [], listeners = new Set(), navigation = new Set(), storage = new Set();
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
  class Xhr {
    constructor() { this.listeners = new Map(); }
    open() {} send() {} setRequestHeader() {}
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    finish() { this.listeners.get("loadend")?.(); this.listeners.delete("loadend"); }
  }
  const window = { localStorage, fetch: responseTransform ? async (...args) => responseTransform(await nativeFetch(...args)) : nativeFetch, XMLHttpRequest: Xhr, WIZ_global_data: { SNlM0e: "CSRF_SENTINEL" },
    addEventListener: (type, listener) => (type === "message" ? listeners : type === "storage" ? storage : navigation).add(listener),
    removeEventListener: (type, listener) => (type === "message" ? listeners : type === "storage" ? storage : navigation).delete(listener),
    navigation: { addEventListener: (_type, fn) => navigation.add(fn), removeEventListener: (_type, fn) => navigation.delete(fn) },
    postMessage(data) { if (data.type === "response") replies.push(data); queueMicrotask(() => { beforeMessage?.(data); [...listeners].forEach(fn => fn({ data, source: window, origin: location.origin })); }); }
  };
  const context = vm.createContext({ window, location, chrome: runtime ? { runtime } : undefined, performance: { getEntriesByType: () => [] }, URL, URLSearchParams, Headers, Request, TextEncoder, TextDecoder, AbortController, crypto: webcrypto, Date, setTimeout: schedule, clearTimeout });
  const reinstall = file => scripts.get(file).runInContext(context);
  ["transfer-diagnostics.js", "json-capture-metrics.js", ...files].forEach(reinstall);
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
  return { window, api, requests, replies, context, fixture, observe, reinstall, listeners, location, newXhr: () => new Xhr(),
    storage, storageChanged(key = "userToken") { for (const listener of storage) listener({ key }); },
    navigationListeners: () => navigation.size,
    navigate(pathname = "/new") { const target = new URL(pathname, location.origin); for (const fn of navigation) fn({ destination: { url: target.href } }); location.pathname = target.pathname; location.search = target.search; location.href = target.href; }
  };
}

function deepseekUploads(count = 6) {
  const f = fixtures("deepseek", "smoke", 1);
  const uploads = Array.from({ length: count }, (_, i) => {
    const text = `\uFEFF  original ${i}\r\n`;
    const file = { ...f.file, id: `file-upload-${i}`, file_name: `source-${i}.py`, file_size: Buffer.byteLength(text), signed_path: `/file?file_id=upload-${i}&sig=SIGNED_SENTINEL` };
    f.files[file.id] = text;
    return file;
  });
  f.data.data.biz_data.chat_messages[0].fragments = [{ type: "FILE", files: [...uploads, uploads[0]] }];
  f.uploads = uploads;
  f.expected = `DeepSeek conversation:\n\nUser: ${uploads.map(file => `Attachment: ${JSON.stringify(file.file_name)}\n\nFile contents (${file.file_size} UTF-8 bytes):\n${f.files[file.id]}\nEnd attachment: ${JSON.stringify(file.file_name)}`).join("\n\n")}\n\nAssistant: ${f.data.data.biz_data.chat_messages[1].fragments[0].content}`;
  return f;
}

test("DeepSeek: an invalid UTF-8 attachment cannot discard healthy text or later downloads", async () => {
  const f = deepseekUploads(7);
  f.data.data.biz_data.chat_messages[0].fragments[0].files.push({ ...f.uploads[0], id: "file-pdf", file_name: "Guide.PDF" });
  const invalid = new Set([f.uploads[0].id, f.uploads[3].id]);
  const bodies = [];
  const h = setup("deepseek", f, { fetchImpl: request => {
    if (request.url.pathname.includes("history_messages")) return Response.json(f.data);
    const id = `file-${request.url.searchParams.get("file_id")}`;
    if (!invalid.has(id)) return new Response(f.files[id], { headers: { "content-type": "text/plain" } });
    const body = new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(0xff)); }, cancel() {} });
    bodies.push(body);
    return new Response(body, { headers: { "content-type": "application/octet-stream" } });
  } });
  await h.observe();
  const capture = await h.window.__capCaptureNetworkJson();
  assert.equal(capture.jsonCapture.step,"complete");
  assert.equal(capture.jsonCapture.history_checked,true);
  assert.equal(capture.jsonCapture.skipped_file_check,"invalid_utf8");
  assert.equal(capture.jsonCapture.files_skipped,2);
  for (const file of f.uploads) assert.equal(capture.text.includes(f.files[file.id]), !invalid.has(file.id));
  assert.deepEqual(JSON.parse(JSON.stringify(capture.skippedFiles)), [{ name: "source-0.py" }, { name: "source-3.py" }]);
  assert.equal(h.requests.length, 8, "bad files must not stop queued healthy downloads");
  assert.ok(capture.text.includes(f.data.data.biz_data.chat_messages[1].fragments[0].content));
  assert.ok(bodies.every(body => !body.locked));
  assert.equal(h.navigationListeners(), 0);
});

test("DeepSeek: bad file bodies never become partial text and labels alone cannot make a capture", async () => {
  for (const bytes of [Uint8Array.of(0xff), Uint8Array.of(0xff, 0xfe, 0x61, 0), Uint8Array.of(0x63, 0x61, 0x66, 0xe9), Uint8Array.of(0xe2, 0x82)]) {
    const f = deepseekUploads(1);
    f.uploads[0].file_size = bytes.length;
    f.data.data.biz_data.chat_messages[1].fragments[0].content = "";
    const h = setup("deepseek", f, { fetchImpl: request => request.url.pathname.includes("history_messages")
      ? Response.json(f.data) : new Response(bytes, { headers: { "content-type": "application/octet-stream" } }) });
    await h.observe();
    await assert.rejects(h.window.__capCaptureNetworkJson(), error => error.diagnostics.capture_detail === "missing_text");
    f.data.data.biz_data.chat_messages[0].fragments.push({ type: "REQUEST", content: "Keep this authored text" });
    const capture = await h.window.__capCaptureNetworkJson();
    assert.ok(capture.text.includes("Keep this authored text"));
    assert.ok(!capture.text.includes("File contents"));
  }
});

test("Gemini and Grok reject attachment labels when no readable conversation text remains", () => {
  const g = setup("gemini"), t = geminiTurn(0, "smoke", "", "");
  t[2][0][4] = [[null, null, null, null, [[null, 11, "Guide.pdf"]]]];
  assert.throws(() => g.api.gemini([{ turns: [t], cursor: null }], "smoke"), /No usable/);
  const k = setup("grok", fixtures("grok", "smoke", 1));
  k.fixture.responses.forEach(message => { message.message = ""; });
  k.fixture.responses[0].fileAttachmentsMetadata = [{ fileName: "Guide.pdf" }];
  assert.throws(() => k.api.grok(k.fixture.nodes, k.fixture.responses), /No usable/);
});

test("DeepSeek: skipping bad files cannot bypass the shared raw download limit", async () => {
  const f = deepseekUploads(2);
  let downloads = 0;
  const h = setup("deepseek", f, { fetchImpl: request => {
    if (request.url.pathname.includes("history_messages")) return Response.json(f.data);
    downloads++;
    return new Response(new Uint8Array(16000001), { headers: { "content-type": "text/plain" } });
  } });
  await h.observe();
  await assert.rejects(h.window.__capCaptureNetworkJson(), error => error.captureFailureReason === "size_limit");
  assert.equal(downloads, 2);
});

test("DeepSeek: the selected ChatGPT path skips oversized bodies, preserves small files and names every separate original", async () => {
  const f = deepseekUploads(3);
  f.uploads[0].file_size = 13099028;
  f.uploads[2].file_size = 5000000;
  const h = setup("deepseek", f, { fetchImpl: request => {
    if (request.url.pathname.includes("history_messages")) return Response.json(f.data);
    const id = `file-${request.url.searchParams.get("file_id")}`;
    assert.equal(id, f.uploads[1].id, "Oversized bodies must never be requested.");
    return new Response(f.files[id], { headers: { "content-type": "text/plain" } });
  } });
  await h.observe();
  const capture = await h.window.__capCaptureNetworkJson(undefined, true);
  assert.deepEqual(JSON.parse(JSON.stringify(capture.omittedFiles)), [
    { name: "source-0.py", bytes: 13099028 }, { name: "source-2.py", bytes: 5000000 }
  ]);
  assert.equal(h.requests.length, 2);
  assert.equal(capture.jsonCapture.outcome, "partial");
  assert.equal(capture.jsonCapture.files_supported, 3);
  assert.equal(capture.jsonCapture.files_downloaded_bytes, f.uploads[1].file_size);
  assert.match(capture.text, /exceeds the 4.1 MB file limit/);
  assert.ok(capture.text.includes(f.files[f.uploads[1].id]));
  assert.ok(!capture.text.includes(f.files[f.uploads[0].id]));
  assert.doesNotMatch(JSON.stringify(capture.jsonCapture), /source-|SIGNED_SENTINEL|original/);
  await assert.rejects(h.window.__capCaptureNetworkJson(), error => error.jsonCapture.failure_check === "supported_files_limit");
});

test("DeepSeek: separate-file notices retain the exact file boundary while skipping unreadable smaller files", async () => {
  const f = deepseekUploads(2);
  f.uploads[0].file_size = 4100001;
  const h = setup("deepseek", f, { fetchImpl: request => request.url.pathname.includes("history_messages")
    ? Response.json(f.data) : new Response("short", { headers: { "content-type": "text/plain" } }) });
  await h.observe();
  const capture = await h.window.__capCaptureNetworkJson(undefined, true);
  assert.equal(capture.omittedFiles.length, 1);
  assert.ok(!capture.text.includes("File contents"));
  f.uploads[0].file_size = 4100000;
  await assert.rejects(h.window.__capCaptureNetworkJson(undefined, true));
  assert.equal(h.requests.filter(request => request.url.hostname === "files.deepseeksvc.com").length, 1,
    "A file equal to 4.1 MB is not omitted; existing combined admission still applies.");
});

test("DeepSeek: diagnosis distinguishes file fetch rejection, HTTP rejection and interrupted body", async () => {
  for (const phase of ["fetch", "headers", "body"]) {
    const f = deepseekUploads(1);
    let reads = 0;
    const h = setup("deepseek", f, { fetchImpl: async request => {
      if (request.url.pathname.includes("history_messages")) return Response.json(f.data);
      if (phase === "fetch") throw new TypeError("PRIVATE file address or browser message");
      if (phase === "headers") return new Response("PRIVATE rejected body", { status: 403 });
      return { status: 200, type: "cors", headers: new Headers({ "content-type": "text/plain" }),
        body: { getReader: () => ({ read: async () => {
          if (!reads++) return { done: false, value: new TextEncoder().encode("ab") };
          throw new TypeError("PRIVATE interrupted file");
        }, cancel: async () => {}, releaseLock() {} }) } };
    } });
    vm.runInContext("globalThis.navigator = { onLine: true }", h.context);
    await h.observe();
    const capture = await h.window.__capCaptureNetworkJson();
    {
      const stats = capture.jsonCapture;
      assert.equal(stats.failure_phase, phase);
      assert.equal(stats.failure_file_index, 1);
      assert.equal(stats.failure_file_bytes, f.uploads[0].file_size);
      assert.equal(stats.failure_read_bytes, phase === "body" ? 2 : 0);
      assert.equal(stats.failure_error_type, phase === "headers" ? "CaptureError" : "TypeError");
      assert.equal(stats.failure_response_type, phase === "fetch" ? "none" : phase === "headers" ? "default" : "cors");
      assert.equal(stats.failure_http_status, phase === "fetch" ? undefined : phase === "headers" ? 403 : 200);
      assert.equal(stats.failure_abort, "none");
      assert.equal(stats.failure_online, "online");
      assert.ok(Number.isInteger(stats.failure_request_ms));
      if (phase === "fetch") assert.equal(stats.http_status, 200, "History success must not masquerade as a file response.");
      assert.doesNotMatch(JSON.stringify(stats), /PRIVATE|SIGNED_SENTINEL|AUTH_SENTINEL|source-0|files\.deepseeksvc/);
      assert.ok(!capture.text.includes("File contents"));
    }
  }
});

test("DeepSeek: attachment decode failures retain only fixed type clues and the observed byte counts", async () => {
  const cases = [
    { bytes: [255, 254, 65, 0], hint: "utf16le_bom", charset: 'charset="UTF-16LE"', encoding: "utf16le" },
    { bytes: [255, 254], hint: "utf16le_or_utf32le_bom" },
    { bytes: [0, 0, 254, 255], hint: "utf32be_bom", charset: "charset=utf-32be", encoding: "utf32be" },
    { bytes: [80, 75, 3, 4, 255], hint: "zip_signature", charset: "charset=PRIVATE_CHARSET", encoding: "other" },
    { bytes: [31, 139, 255], hint: "gzip_signature" },
    { bytes: [37, 80, 68, 70, 255], hint: "pdf_signature" },
    { bytes: [137, 80, 78, 71, 13, 10, 26, 10], hint: "png_signature" },
    { bytes: [255, 216, 255], hint: "jpeg_signature" },
    { bytes: [71, 73, 70, 56, 57, 97, 255], hint: "gif_signature" },
    { bytes: [208, 207, 17, 224, 161, 177, 26, 225], hint: "ole_signature" },
    { bytes: [239, 187, 191, 255], hint: "utf8_bom" },
    { bytes: [255], hint: "unrecognized", charset: "charset=windows-1252", encoding: "windows1252" },
    { bytes: [65, 226, 130], hint: "unrecognized", final: true }
  ];
  for (const sample of cases) {
    const f = deepseekUploads(1);
    f.uploads[0].file_name = "PRIVATE_FILE_SENTINEL.CSV";
    f.uploads[0].file_size = sample.bytes.length;
    const h = setup("deepseek", f, { fetchImpl: request => request.url.pathname.includes("history_messages")
      ? Response.json(f.data) : new Response(Uint8Array.from(sample.bytes), {
        headers: { "content-type": `application/octet-stream${sample.charset ? `; ${sample.charset}` : ""}` }
      }) });
    await h.observe();
    const capture = await h.window.__capCaptureNetworkJson();
    {
      const stats = capture.jsonCapture;
      assert.equal(capture.skippedFiles.length, 1);
      assert.equal(stats.failure_check, "invalid_utf8");
      assert.equal(stats.failure_phase, "decode");
      assert.equal(stats.failure_decode_stage, sample.final ? "final_flush" : "chunk");
      assert.equal(stats.failure_file_extension, "csv");
      assert.equal(stats.failure_body_hint, sample.hint);
      assert.equal(stats.failure_response_charset, sample.encoding || "missing");
      assert.equal(stats.failure_file_index, 1);
      assert.equal(stats.failure_file_bytes, sample.bytes.length);
      assert.equal(stats.failure_read_bytes, sample.bytes.length);
      assert.equal(stats.failure_http_status, 200);
      assert.equal(stats.failure_content_type, "octet_stream");
      assert.equal(stats.failure_abort, "none");
      assert.doesNotMatch(JSON.stringify(stats), /PRIVATE|SENTINEL|https:|file_name|signed_path/);
    }
    assert.equal(h.requests.length, 2, "Diagnosis must not make additional requests.");
  }
});

test("DeepSeek: a decoding failure after split valid UTF-8 records no guessed file format", async () => {
  const f = deepseekUploads(1);
  const chunks = [Uint8Array.from([239]), Uint8Array.from([187, 191, 226]), Uint8Array.from([130, 172, 255])];
  f.uploads[0].file_size = 7;
  const h = setup("deepseek", f, { fetchImpl: request => request.url.pathname.includes("history_messages")
    ? Response.json(f.data) : new Response(new ReadableStream({ start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    } }), { headers: { "content-type": "text/plain; charset=utf-8" } }) });
  await h.observe();
  const capture = await h.window.__capCaptureNetworkJson();
  assert.equal(capture.jsonCapture.failure_body_hint, "utf8_bom");
  assert.equal(capture.jsonCapture.failure_read_bytes, 7);
  assert.equal(capture.jsonCapture.failure_response_charset, "utf8");
  assert.equal(capture.skippedFiles.length, 1);
});

test("DeepSeek: skipped file retains its existing evidence while a healthy sibling finishes", async () => {
  const f = deepseekUploads(2);
  const h = setup("deepseek", f, { fetchImpl: async request => {
    if (request.url.pathname.includes("history_messages")) return Response.json(f.data);
    if (request.url.searchParams.get("file_id") === "upload-0") return new Response(null, { status: 403 });
    return new Response(f.files[f.uploads[1].id], { headers: { "content-type": "text/plain" } });
  } });
  await h.observe();
  const capture = await h.window.__capCaptureNetworkJson();
  assert.equal(capture.jsonCapture.failure_file_index, 1);
  assert.equal(capture.jsonCapture.failure_phase, "headers");
  assert.equal(capture.jsonCapture.failure_http_status, 403);
  assert.equal(capture.jsonCapture.failure_error_type, "CaptureError");
  assert.equal(capture.jsonCapture.failure_abort, "none");
  assert.ok(capture.text.includes(f.files[f.uploads[1].id]));
});

clockTest("DeepSeek reads an already signed-in chat when native login requests preceded the observer", async () => {
  const h = setup("deepseek", undefined, { localStorage: { getItem(key) {
    assert.equal(key, "userToken", "read only DeepSeek's own session key");
    return JSON.stringify({ value: "AUTH_SENTINEL", __version: "0" });
  } } });
  const started = Date.now();
  assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
  assert.ok(Date.now() - started < 100, "an existing signed-in session must not wait for new site activity");
  assert.equal(h.requests.filter(r => r.url.pathname.includes("history_messages")).length, 1);
  assert.equal(h.window.__capNetworkFetchState.auth(), null, "the saved credential is scoped to this read, not cached as a native observation");
  assert.doesNotMatch(JSON.stringify(h.replies), /AUTH_SENTINEL|userToken/);
});

test("DeepSeek rejects a stored-session change during history capture", async () => {
  for (const changed of [null, JSON.stringify({ value: "OTHER_SESSION", __version: "0" })]) {
    let saved = JSON.stringify({ value: "AUTH_SENTINEL", __version: "0" });
    const f = fixtures("deepseek");
    const h = setup("deepseek", f, { localStorage: { getItem: () => saved }, fetchImpl(request) {
      assert.equal(request.options.headers.authorization, "Bearer AUTH_SENTINEL");
      saved = changed;
      return Response.json(f.data);
    } });
    await assert.rejects(h.window.__capCaptureNetworkJson(), error => error.diagnosticCode === "conversation_changed");
    assert.ok(h.replies.every(reply => !reply.capture), "never return another session's history");
    assert.doesNotMatch(JSON.stringify(h.replies), /AUTH_SENTINEL|OTHER_SESSION/);
  }
});

test("DeepSeek current stored login is not cancelled by an older observed login", async () => {
  const f = fixtures("deepseek");
  let h;
  h = setup("deepseek", f, { localStorage: { getItem: () => JSON.stringify({ value: "CURRENT_SESSION", __version: "0" }) }, fetchImpl(request) {
    if (request.url.hostname === "files.deepseeksvc.com") return new Response(f.files[f.file.id], { headers: { "content-type": "application/octet-stream" } });
    assert.equal(request.options.headers.authorization, "Bearer CURRENT_SESSION");
    const xhr = h.newXhr(); xhr.open("GET", "/api/v0/session");
    xhr.setRequestHeader("authorization", "Bearer CURRENT_SESSION"); xhr.send();
    return Response.json(f.data);
  } });
  await h.observe(); // The hook still remembers a request from the previous login.
  assert.equal((await h.window.__capCaptureNetworkJson()).text, f.expected);
  assert.doesNotMatch(JSON.stringify(h.replies), /AUTH_SENTINEL|CURRENT_SESSION/);
});

clockTest("DeepSeek a cleared native login cannot reuse the old observed credential", async () => {
  for (const saved of [null, JSON.stringify({ value: "" }), JSON.stringify({ value: null })]) {
    const h = setup("deepseek", undefined, { localStorage: { getItem: () => saved } });
    await h.observe();
    await assert.rejects(h.window.__capCaptureNetworkJson(), error => error.diagnostics.capture_detail === "auth_missing");
    assert.equal(h.requests.length, 0, "a cleared login must not send the previous account's credential");
  }
});

clockTest("DeepSeek logout in another tab cancels a pending history read and cleans up", async () => {
  let saved = JSON.stringify({ value: "AUTH_SENTINEL", __version: "0" });
  let aborted = false;
  const h = setup("deepseek", undefined, { localStorage: { getItem: () => saved }, fetchImpl: request => new Promise((_, reject) => {
    request.options.signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
  }) });
  const pending = h.window.__capCaptureNetworkJson();
  pending.catch(() => {});
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(h.requests.length, 1);
  saved = null;
  h.storageChanged();
  await assert.rejects(pending, error => error.diagnosticCode === "conversation_changed");
  assert.equal(aborted, true);
  assert.equal(h.storage.size, 0);
  assert.equal(h.navigationListeners(), 0);
  assert.ok(h.replies.every(reply => !reply.capture));
});

clockTest("DeepSeek signed-out or unreadable storage never becomes an invented credential", async () => {
  for (const value of [null, "invalid", JSON.stringify({ value: "" }), JSON.stringify({ value: 123 }), JSON.stringify({ value: "invalid token" })]) {
    const h = setup("deepseek", undefined, { localStorage: { getItem: () => value } });
    await assert.rejects(h.window.__capCaptureNetworkJson(), error => error.diagnostics.capture_detail === "auth_missing");
    assert.equal(h.requests.length, 0);
    assert.equal(h.storage.size, 0);
  }
  const h = setup("deepseek", undefined, { localStorage: { getItem() { throw new Error("storage blocked"); } } });
  await h.observe();
  assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected, "native auth observation still works when storage is blocked");
});

clockTest("DeepSeek waits briefly for late native auth and does not delay ready sessions", async () => {
  for (const transport of ["xhr", "fetch"]) {
    const h = setup("deepseek"), started = Date.now();
    const pending = h.window.__capCaptureNetworkJson();
    let settled = false;
    pending.then(() => { settled = true; }, () => { settled = true; });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(settled, false, "capture must allow the native login request to arrive");
    assert.equal(h.requests.length, 0, "never request private history without observed auth");
    if (transport === "xhr") await h.observe();
    else await h.window.fetch("/api/v0/session", { headers: { authorization: "Bearer AUTH_SENTINEL" } });
    assert.equal((await pending).text, h.fixture.expected);
    assert.ok(Date.now() - started <= 200, "observed auth must release the wait immediately");
    const readyStarted = Date.now();
    assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
    assert.ok(Date.now() - readyStarted < 100, "ready sessions must skip the grace period");
    assert.equal(h.navigationListeners(), 0);
    assert.doesNotMatch(JSON.stringify(h.replies), /AUTH_SENTINEL|SIGNED_SENTINEL/);
  }
});

clockTest("DeepSeek missing auth stays bounded and a later native request enables a fresh capture", async () => {
  const h = setup("deepseek"), started = Date.now();
  await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
    assert.equal(error.captureFailureReason, "unavailable");
    assert.equal(error.diagnostics.capture_detail, "auth_missing");
    return true;
  });
  assert.ok(Date.now() - started >= 1500 && Date.now() - started < 1600);
  assert.equal(h.requests.length, 0);
  assert.equal(h.navigationListeners(), 0);
  assert.ok(h.replies.every(reply => !reply.capture));
  await h.observe();
  assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
});

clockTest("DeepSeek cancels a pending auth wait on chat change or hook replacement", async () => {
  for (const reason of ["navigate", "reinstall"]) {
    const h = setup("deepseek");
    const pending = h.window.__capCaptureNetworkJson();
    pending.catch(() => {}); // Handle early rejection while advancing the clock; assert cancellation below.
    await new Promise(resolve => setTimeout(resolve, 100));
    if (reason === "navigate") { h.navigate("/a/chat/s/other"); h.navigate("/a/chat/s/smoke"); }
    else { h.window.__capNetworkFetchState.version = 0; h.reinstall(files[1]); }
    await assert.rejects(pending, error => error.diagnosticCode === "conversation_changed");
    assert.equal(h.requests.length, 0);
    assert.equal(h.navigationListeners(), 0);
    assert.ok(h.replies.every(reply => !reply.capture));
    await h.observe();
    assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
    const replies = h.replies.length;
    await new Promise(resolve => setTimeout(resolve, 1600));
    assert.equal(h.replies.length, replies, "cancelled waits must not deliver a late response");
    assert.doesNotMatch(JSON.stringify(h.replies), /AUTH_SENTINEL|SIGNED_SENTINEL/);
  }
});

test("DeepSeek JSON snapshots WIP, continuing and stopped own text without waiting for completion", async () => {
  for (const status of ["WIP", "INCOMPLETE", "FINISHED"]) {
    const h = setup("deepseek");
    const reply = h.fixture.data.data.biz_data.chat_messages.at(-1);
    Object.assign(reply, { status, has_pending_fragment: true, auto_continue: true, incomplete_message: "Generation has not finished" });
    reply.fragments.push({ type: "RESPONSE", content: null });
    await h.observe();
    const capture = await h.window.__capCaptureNetworkJson();
    assert.equal(capture.text, h.fixture.expected);
    reply.fragments[0].content += "FUTURE_TEXT_SENTINEL";
    assert.doesNotMatch(capture.text, /FUTURE_TEXT_SENTINEL/);
    assert.equal(h.requests.filter(request => request.url.pathname.includes("history_messages")).length, 1);
  }
});

test("Grok JSON snapshots a partial assistant while another response remains in flight", async () => {
  const h = setup("grok"), reply = h.fixture.responses.at(-1);
  h.fixture.nodes.inflightResponses.push({ responseId: reply.responseId });
  Object.assign(reply, { partial: true, message: "Text already generated" });
  const capture = await h.window.__capCaptureNetworkJson();
  assert.equal(capture.messages.at(-1).text, "Text already generated");
  assert.equal(capture.messages.length, 48);
  reply.message += "FUTURE_TEXT_SENTINEL";
  assert.doesNotMatch(capture.text, /FUTURE_TEXT_SENTINEL/);
  reply.message = null;
  assert.equal(h.api.grok(h.fixture.nodes, h.fixture.responses).messages.at(-1).role, "user");
  h.fixture.responses.pop();
  assert.equal(h.api.grok(h.fixture.nodes, h.fixture.responses).messages.at(-1).role, "user");
});

test("Gemini JSON keeps the newest prompt when its response has not arrived yet", async () => {
  const f = fixtures("gemini", "smoke", 2);
  f.pages[0].turns[0][3] = null;
  const h = setup("gemini", f);
  await h.observe();
  const capture = await h.window.__capCaptureNetworkJson();
  assert.equal(capture.messages.length, 3);
  assert.equal(capture.messages.at(-1).role, "user");
  assert.equal(capture.messages.at(-1).text, "User 1\n  Original pasted line  \r\n");
  assert.ok(capture.text.includes("JSON_ONLY_SENTINEL"));
});

test("DeepSeek native reply lifetime reaches the bridge, including overlap and completion", async () => {
  const h = setup("deepseek"), first = h.newXhr(), second = h.newXhr();
  for (const xhr of [first, second]) { xhr.open("POST", `${h.location.origin}/api/v0/chat/completion`); xhr.send("PRIVATE_NATIVE_BODY"); }
  await new Promise(setImmediate);
  assert.equal(h.window.__capNetworkReplyState.active, true);
  first.finish(); await new Promise(setImmediate);
  assert.equal(h.window.__capNetworkReplyState.active, true);
  second.finish(); await new Promise(setImmediate);
  assert.equal(h.window.__capNetworkReplyState.active, false);
  assert.doesNotMatch(JSON.stringify(h.window.__capNetworkReplyState), /PRIVATE_NATIVE_BODY|AUTH_SENTINEL/);
});

// These adapters share one chunk reader. Run its decoder/budget rejection
// matrix on Grok; retain Unicode success and transport validation per adapter.
for (const platform of ["gemini", "grok", "deepseek"]) {
  if (platform === "grok") test(`${platform}: invalid UTF-8 stops history consumption immediately and permits a fresh capture`, async () => {
    let delivered = 0, cancelled = false, healthy = false, body;
    const padding = new Uint8Array(1000000).fill(32);
    const h = setup(platform, fixtures(platform), { responseTransform: response => {
      if (healthy) return response;
      let first = true, remaining = 5;
      body = new ReadableStream({
        pull(controller) {
          if (first) {
            first = false; delivered++; controller.enqueue(new Uint8Array([255]));
          } else if (remaining--) {
            delivered += padding.length; controller.enqueue(padding);
          } else controller.close();
        },
        cancel() { cancelled = true; }
      });
      return new Response(body, { headers: response.headers });
    } });
    await h.observe();
    await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
      assert.doesNotMatch(error.message, /decoder|encoded data|UTF-8/);
      return true;
    });
    assert.ok(delivered <= 1000001, `Stop at the invalid chunk plus stream prefetch, rather than draining ${delivered} bytes.`);
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
    assert.equal(h.navigationListeners(), 0);
    assert.ok(h.replies.every(reply => !reply.capture));
    healthy = true;
    assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
  });

  if (platform === "grok") test(`${platform}: history streams stop at the raw budget without Content-Length and allow a fresh capture`, async () => {
    let delivered = 0, cancelled = false, healthy = false, body;
    const padding = new Uint8Array(1000000).fill(32);
    const h = setup(platform, fixtures(platform), { responseTransform: async response => {
      if (healthy) return response;
      const original = new Uint8Array(await response.arrayBuffer());
      let sentOriginal = false, paddingChunks = 0;
      body = new ReadableStream({
        pull(controller) {
          if (!sentOriginal) {
            sentOriginal = true; delivered += original.length; controller.enqueue(original);
          } else if (paddingChunks++ < 40) {
            delivered += padding.length; controller.enqueue(padding);
          } else controller.close();
        },
        cancel() { cancelled = true; }
      });
      return new Response(body, { headers: response.headers });
    } });
    await h.observe();
    await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
      assert.equal(error.captureFailureReason, "size_limit");
      return true;
    });
    assert.ok(delivered <= 34000000, `Stop at the first oversized chunk plus stream prefetch; delivered ${delivered} bytes.`);
    assert.equal(cancelled, true);
    assert.equal(body.locked, false);
    assert.equal(h.navigationListeners(), 0);
    assert.ok(h.replies.every(reply => !reply.capture));
    healthy = true;
    assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
  });

  test(`${platform}: chunked history preserves split UTF-8/BOM and exact transcripts`, async () => {
    let splitCodepoints = 0;
    const h = setup(platform, fixtures(platform, "smoke", 1), { responseTransform: async response => {
      const original = new Uint8Array(await response.arrayBuffer());
      const bytes = response.headers.get("content-type")?.includes("application/json")
        ? Buffer.concat([Buffer.from([239, 187, 191]), original]) : original;
      // Split the BOM and one actual multibyte character deliberately. The
      // remaining large paste can use normal chunks instead of thousands of
      // seven-byte reads that add no new decoding coverage.
      const unicodeOffset = bytes.findIndex((byte, index) => index >= 3 && byte >= 0xc2);
      let offset = 0;
      return new Response(new ReadableStream({
        pull(controller) {
          if (offset === bytes.length) return controller.close();
          const end = offset === 0 ? 2 : offset === 2 && unicodeOffset >= 3 ? unicodeOffset + 1
            : Math.min(offset + 16385, bytes.length);
          if (end < bytes.length && (bytes[end] & 0xc0) === 0x80) splitCodepoints++;
          controller.enqueue(bytes.subarray(offset, end)); offset = end;
        }
      }), { headers: response.headers });
    } });
    await h.observe();
    assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
    assert.ok(splitCodepoints > 0, "Unicode must actually cross a delivered chunk boundary.");
  });

  if (platform === "grok") test(`${platform}: an unfinished UTF-8 character after valid history must not be silently dropped`, async () => {
    let healthy = false;
    const h = setup(platform, fixtures(platform, "smoke", 1), { responseTransform: async response => {
      if (healthy || !response.headers.get("content-type")?.includes("application/json")) return response;
      const bytes = Buffer.concat([Buffer.from(await response.arrayBuffer()), Buffer.from([226, 130])]);
      return new Response(bytes, { headers: response.headers });
    } });
    await h.observe();
    await assert.rejects(h.window.__capCaptureNetworkJson());
    assert.ok(h.replies.every(reply => !reply.capture));
    assert.equal(h.navigationListeners(), 0);
    healthy = true;
    assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
  });

  test(`${platform}: rejected transport cancels its unread response without exposing cancellation errors`, async () => {
    for (const [status, headers, reason] of [
      [206, { "content-type": "application/json" }, "incomplete"],
      [200, { "content-type": "application/json", "content-range": "bytes 0-2/9" }, "incomplete"],
      [200, { "content-type": "text/html" }, "incomplete"],
      [200, { "content-type": "application/json", "content-length": "32000001" }, "size_limit"]
    ]) {
      let cancelled = false, body;
      const h = setup(platform, fixtures(platform), { responseTransform: () => {
        body = new ReadableStream({ cancel() { cancelled = true; throw new Error("PRIVATE_CANCELLATION_SENTINEL"); } });
        return new Response(body, { status, headers });
      } });
      await h.observe();
      await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
        assert.equal(error.captureFailureReason, reason);
        assert.doesNotMatch(error.message, /PRIVATE_/);
        return true;
      });
      assert.equal(cancelled, true);
      assert.equal(body.locked, false);
      assert.equal(h.navigationListeners(), 0);
      assert.ok(h.replies.every(reply => !reply.capture));
    }
  });
}

test("DeepSeek: redirected original files retain exact text and byte guards", async t => {
  const f = fixtures("deepseek", "smoke", 1);
  const original = f.files[f.file.id];
  let mode = "complete", redirectedReads = 0;
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, undefined);
    assert.equal(request.headers.cookie, undefined);
    assert.equal(request.headers.referer, undefined);
    if (request.url.startsWith("/api/file?")) {
      response.writeHead(302, { Location: "/original" }); response.end(); return;
    }
    redirectedReads++;
    response.writeHead(200, { "Content-Type": "text/plain" });
    response.end(mode === "short" ? original.slice(0, -1) : mode === "excess" ? original + "x" : original);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port;
  for (mode of ["complete", "short", "excess"]) {
    const h = setup("deepseek", f, { fetchImpl: request => {
      if (request.url.pathname.includes("history_messages")) {
        assert.equal(request.options.redirect, "error", "Authenticated history must never follow redirects.");
        return Response.json(f.data);
      }
      return fetch(origin + request.url.pathname + request.url.search, request.options);
    } });
    await h.observe();
    if (mode === "complete") {
      const capture = await h.window.__capCaptureNetworkJson();
      assert.ok(capture.text === f.expected, JSON.stringify(capture.jsonCapture));
      assert.equal((await h.window.__capMeasureNetworkJson()).characterCount, f.expected.length);
    } else {
      const capture = await h.window.__capCaptureNetworkJson();
      assert.equal(capture.jsonCapture.failure_check, "attachment_length_mismatch");
      assert.ok(!capture.text.includes("File contents"));
    }
    const fileRequest = h.requests.find(request => request.url.hostname === "files.deepseeksvc.com");
    assert.equal(fileRequest.options.credentials, "omit");
    assert.equal(fileRequest.options.headers, undefined);
    assert.equal(fileRequest.options.referrerPolicy, "no-referrer");
  }
  assert.equal(redirectedReads, 4, "Capture, measurement and rejected byte guards must reach the redirected file.");
});

test("Network: authenticated history never follows a redirect", async t => {
  let redirectedReads = 0;
  const server = http.createServer((request, response) => {
    if (request.url === "/redirect-target") { redirectedReads++; response.end("{}"); return; }
    response.writeHead(302, { Location: "/redirect-target" }); response.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = "http://127.0.0.1:" + server.address().port;
  for (const platform of ["gemini", "grok", "deepseek"]) {
    const h = setup(platform, fixtures(platform), { fetchImpl: request =>
      fetch(origin + request.url.pathname, request.options) });
    await h.observe();
    await assert.rejects(h.window.__capCaptureNetworkJson(), error =>
      error.jsonCapture.failure_check === "network_error" && error.jsonCapture.failure_stage === "history");
  }
  assert.equal(redirectedReads, 0, "A file compatibility fix must not redirect authenticated requests.");
});

test("DeepSeek: appending original-file type preserves the signed query encoding", async () => {
  const f = fixtures("deepseek", "smoke", 1);
  f.file.signed_path = "/file?file_id=test-paste&sig=a%20b~c%2fd";
  const h = setup("deepseek", f);
  await h.observe();
  assert.equal((await h.window.__capCaptureNetworkJson()).text, f.expected);
  assert.equal(h.requests.find(request => request.url.hostname === "files.deepseeksvc.com").url.search,
    "?file_id=test-paste&sig=a%20b~c%2fd&ty=r");
});

clockTest("DeepSeek: independent uploads overlap in bounded waves and preserve exact source order", async () => {
  const f = deepseekUploads();
  let active = 0, peak = 0;
  const completed = [];
  const h = setup("deepseek", f, { fetchImpl: async request => {
    if (request.url.pathname.includes("history_messages")) return Response.json(f.data);
    assert.equal(request.options.credentials, "omit");
    assert.equal(request.options.headers, undefined);
    assert.equal(request.options.cache, undefined);
    assert.equal(request.options.redirect, "follow");
    assert.equal(request.options.referrerPolicy, "no-referrer");
    assert.equal(request.url.searchParams.get("ty"), "r");
    active++; peak = Math.max(peak, active);
    const id = `file-${request.url.searchParams.get("file_id")}`;
    const index = f.uploads.findIndex(file => file.id === id);
    await new Promise(resolve => setTimeout(resolve, index === 0 ? 60 : 20));
    active--; completed.push(id);
    return new Response(f.files[id], { headers: { "content-type": "application/octet-stream" } });
  } });
  await h.observe();
  const started = Date.now();
  const capture = await h.window.__capCaptureNetworkJson();
  assert.equal(capture.text, f.expected);
  assert.equal(capture.messageTurnCount, 2);
  assert.equal(h.requests.length, 7, "duplicate file IDs must download only once");
  assert.equal(peak, 4, "four independent reads should overlap, without launching every file");
  assert.notEqual(completed[0], f.uploads[0].id, "completion order must differ from transcript order");
  assert.ok(Date.now() - started <= 100, `download waves took ${Date.now() - started} ms`);
  assert.equal(h.navigationListeners(), 0);
  assert.doesNotMatch(JSON.stringify(h.replies), /AUTH_SENTINEL|SIGNED_SENTINEL/);
});

test("DeepSeek: combined text files up to 4.1 MB retain the final transcript limit", async () => {
  for (const lengths of [[470000], [235000, 235000], [350000, 350000], [980000], [550000, 550000]]) {
    const characters = lengths.reduce((sum, length) => sum + length, 0);
    const f = deepseekUploads(lengths.length);
    const texts = lengths.map(length => "文".repeat(length));
    f.uploads.forEach((file, index) => {
      f.files[file.id] = texts[index];
      file.file_size = Buffer.byteLength(texts[index]);
    });
    const h = setup("deepseek", f, { fetchImpl: request => request.url.pathname.includes("history_messages")
      ? Response.json(f.data) : new Response(f.files[`file-${request.url.searchParams.get("file_id")}`], { headers: { "content-type": "text/plain" } }) });
    await h.observe();
    const capture = h.window.__capCaptureNetworkJson();
    if (characters < 1000000) {
      const expected = `DeepSeek conversation:\n\nUser: ${f.uploads.map(file => `Attachment: ${JSON.stringify(file.file_name)}\n\nFile contents (${file.file_size} UTF-8 bytes):\n${f.files[file.id]}\nEnd attachment: ${JSON.stringify(file.file_name)}`).join("\n\n")}\n\nAssistant: ${f.data.data.biz_data.chat_messages[1].fragments[0].content}`;
      assert.equal((await capture).text, expected);
    } else {
      await assert.rejects(capture, error => error.captureFailureReason === "size_limit");
    }
    assert.equal(h.requests.filter(request => request.url.hostname === "files.deepseeksvc.com").length, texts.length,
      "Unique files fit the combined allowance, within 4.1 MB; duplicate IDs still download once.");
  }
});

test("DeepSeek: invalid descriptors are skipped, while oversized manifests fail before downloads", async () => {
  for (const mutate of [
    f => { f.uploads[5].signed_path = "https://other.example/api/file?file_id=upload-5"; },
    f => { f.uploads[5].status = "PENDING"; },
    f => { f.uploads[0].file_size = 2100000; f.uploads[1].file_size = 2100000; }
  ]) {
    const f = deepseekUploads(); mutate(f);
    const h = setup("deepseek", f, { fetchImpl: async request => request.url.pathname.includes("history_messages")
      ? Response.json(f.data) : new Response(f.files[`file-${request.url.searchParams.get("file_id")}`], { headers: { "content-type": "text/plain" } }) });
    await h.observe();
    if (f.uploads[0].file_size === 2100000) {
      await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
        assert.equal(error.diagnostics.capture_detail, "attachment_size_limit");
        assert.equal(error.diagnostics.capture_request_stage, "attachment_descriptor");
        return true;
      });
      assert.equal(h.requests.length, 1, "validate the combined allowance before reading original bodies");
    } else {
      const capture = await h.window.__capCaptureNetworkJson();
      assert.equal(h.requests.length, 6);
      assert.ok(capture.text.includes(f.files[f.uploads[0].id]));
      assert.ok(!capture.text.includes(f.files[f.uploads[5].id]));
    }
    assert.equal(h.navigationListeners(), 0);
  }
});

test("DeepSeek: one incomplete upload preserves siblings and a fresh capture retries the file", async () => {
  const f = deepseekUploads();
  let healthy = false;
  const aborted = [];
  const h = setup("deepseek", f, { fetchImpl: async request => {
    if (request.url.pathname.includes("history_messages")) return Response.json(f.data);
    const id = `file-${request.url.searchParams.get("file_id")}`;
    request.options.signal.addEventListener("abort", () => aborted.push(id), { once: true });
    return new Response(!healthy && id === f.uploads[0].id ? "short" : f.files[id], { headers: { "content-type": "text/plain" } });
  } });
  await h.observe();
  const capture = await h.window.__capCaptureNetworkJson();
  assert.ok(!capture.text.includes(f.files[f.uploads[0].id]));
  assert.equal(h.requests.length, 7, "failure must not stop queued downloads");
  assert.equal(aborted.length, 0);
  assert.equal(h.window.__capNetworkFetchState.version, 34);
  assert.equal(h.navigationListeners(), 0);
  assert.equal(h.listeners.size, 2);
  healthy = true;
  assert.equal((await h.window.__capCaptureNetworkJson()).text, f.expected);
  assert.equal(h.requests.length, 14);
  assert.doesNotMatch(JSON.stringify(h.replies), /PRIVATE_FILE_SENTINEL|SIGNED_SENTINEL|AUTH_SENTINEL/);
});

test("DeepSeek: streamed bodies preserve split UTF-8 and stop oversized reads without Content-Length", async () => {
  for (const oversized of [false, true]) {
    const f = deepseekUploads(1);
    const text = "\uFEFF  café 🕷️\r\n";
    f.files[f.uploads[0].id] = text;
    f.uploads[0].file_size = oversized ? 2 : Buffer.byteLength(text);
    let reads = 0, cancelled = false, body;
    const bytes = Buffer.from(text);
    const h = setup("deepseek", f, { fetchImpl: async request => {
      if (request.url.pathname.includes("history_messages")) return Response.json(f.data);
      body = new ReadableStream({
        pull(controller) {
          if (reads === bytes.length) return controller.close();
          controller.enqueue(bytes.subarray(reads, ++reads));
        },
        cancel() { cancelled = true; }
      });
      return new Response(body, { headers: { "content-type": "application/octet-stream" } });
    } });
    await h.observe();
    if (oversized) {
      const capture = await h.window.__capCaptureNetworkJson();
      assert.ok(!capture.text.includes("File contents"));
      assert.equal(cancelled, true);
      assert.ok(reads <= 4, "stop after the first extra byte, allowing one prefetched chunk");
    } else {
      const capture = await h.window.__capCaptureNetworkJson();
      assert.ok(capture.text.includes(`File contents (${bytes.length} UTF-8 bytes):\n${text}\nEnd attachment:`));
      assert.equal(reads, bytes.length);
    }
    assert.equal(body.locked, false);
  }
});

clockTest("DeepSeek: navigation, auth changes and timeouts abort every overlapping upload", async () => {
  for (const reason of ["navigate", "auth", "timeout"]) {
    const f = deepseekUploads();
    const aborted = [];
    const h = setup("deepseek", f, { fetchImpl: async request => {
      if (request.url.pathname.includes("history_messages")) return Response.json(f.data);
      if (request.url.pathname.endsWith("/session")) return Response.json({});
      return new Promise((_resolve, reject) => request.options.signal.addEventListener("abort", () => {
        aborted.push(request.url.searchParams.get("file_id")); reject(new Error("PRIVATE_BODY_SENTINEL"));
      }, { once: true }));
    } });
    await h.observe();
    const pending = h.window.__capCaptureNetworkJson();
    const rejected = assert.rejects(pending, error => {
      assert.equal(error.captureFailureReason, reason === "timeout" ? "timeout" : reason === "auth" ? "request_failed" : undefined);
      return true;
    });
    await new Promise(setImmediate);
    assert.equal(h.requests.length, 5);
    if (reason === "navigate") { h.navigate("/a/chat/s/other"); h.navigate("/a/chat/s/smoke"); }
    if (reason === "auth") await h.window.fetch("/api/v0/session", { headers: { authorization: "Bearer NEW_SESSION" } });
    await rejected;
    assert.equal(aborted.length, 4);
    assert.ok(h.replies.every(reply => !reply.capture));
    assert.equal(h.navigationListeners(), 0);
    assert.doesNotMatch(JSON.stringify(h.replies), /PRIVATE_BODY_SENTINEL|SIGNED_SENTINEL|NEW_SESSION/);
  }
});

for (const platform of ["gemini", "grok", "deepseek"]) test(`${platform}: the previous hook is replaced while retaining observations`, async () => {
  const h = setup(platform);
  await h.observe();
  const old = h.window.__capNetworkFetchState;
  // Open tabs may retain the preceding reader after extension reload.
  old.version = platform === "deepseek" ? 27 : platform === "gemini" ? 16 : 19;
  h.reinstall(files[1]);
  assert.notEqual(h.window.__capNetworkFetchState, old);
  assert.equal(h.window.__capNetworkFetchState.version, platform === "deepseek" ? 34 : platform === "grok" ? 23 : 20);
  assert.equal(h.listeners.size, 2);
  assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
});

test("DeepSeek: overlapping body reads share the history's raw byte budget", async () => {
  const f = deepseekUploads(4);
  f.data.unused_metadata = "x".repeat(31800000);
  for (const file of f.uploads) { file.file_size = 70000; f.files[file.id] = "x".repeat(file.file_size); }
  const h = setup("deepseek", f, { fetchImpl: async request => request.url.pathname.includes("history_messages")
    ? Response.json(f.data) : new Response(f.files[`file-${request.url.searchParams.get("file_id")}`], { headers: { "content-type": "text/plain" } }) });
  await h.observe();
  await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
    assert.equal(error.captureFailureReason, "size_limit");
    return true;
  });
  assert.ok(h.replies.every(reply => !reply.capture));
  assert.equal(h.navigationListeners(), 0);
});
for (const platform of ["gemini", "grok", "deepseek"]) {
  test(`${platform}: inert reinstall and data-free ping preserve exact ordered capture without tool/file leakage`, async () => {
    const h = setup(platform); await h.observe(); const before = h.requests.length;
    h.reinstall(files[1]); h.reinstall(files[2]);
    h.window.postMessage({ channel: "cap-context-network-json-v1", platform, type: "ping", id: "probe" });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.requests.length, before);
    assert.equal(h.listeners.size, 2);
    assert.equal(h.replies.length, 0);
    const capture = await h.window.__capCaptureNetworkJson();
    assert.equal(capture.text, h.fixture.expected);
    assert.equal(capture.messageTurnCount, 48);
    assert.equal(capture.messages.length, 48);
    assert.equal(capture.messages[0].role, "user");
    assert.equal(capture.messages.at(-1).role, "assistant");
    assert.equal(capture.text, `${({ gemini: "Gemini", grok: "Grok", deepseek: "DeepSeek" })[platform]} conversation:\n\n${capture.messages.map(turn => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`).join("\n\n")}`);
    assert.deepEqual([...capture.excludedContentTypes], { gemini: [], grok: ["tools"], deepseek: ["media", "tools"] }[platform]);
    assert.doesNotMatch(capture.text, /TOOL_SENTINEL|SIGNED_SENTINEL|AUTH_SENTINEL|CSRF_SENTINEL/);
    assert.equal(h.listeners.size, 2);
    assert.equal(h.requests.length - before, platform === "gemini" ? 3 : 2);
  });
  test(`${platform}: quoted role labels remain in the owning native message`, async () => {
    const f = fixtures(platform, "smoke", 1);
    const text = '  Example:\r\n\r\nAssistant: quoted\r\n\r\nUser: also quoted\r\n  print("a\u00a0b")  ';
    if (platform === "gemini") f.pages[0].turns[0][2][0][0] = text;
    else if (platform === "grok") f.responses[0].message = text;
    else { f.files[f.file.id] = text; f.file.file_size = Buffer.byteLength(text); }
    const h = setup(platform, f);
    await h.observe();
    const capture = await h.window.__capCaptureNetworkJson();
    assert.equal(capture.messages.length, 2);
    assert.equal(capture.messages[0].role, "user");
    assert.ok(capture.messages[0].text.includes(text));
    assert.equal(capture.messages[1].role, "assistant");
  });
  test(`${platform}: navigation cancels capture, never returns stale text`, async () => {
    let h; h = setup(platform, fixtures(platform), { fetchImpl: async request => { if (!request.url.pathname.endsWith("/session")) h.navigate(); return new Response("{}"); } });
    await h.observe();
    await assert.rejects(h.window.__capCaptureNetworkJson(), /conversation changed|cancelled/);
    assert.equal(h.listeners.size, 2);
  });
}
test("network bridge rejects structured boundaries that disagree with the verified transcript", async () => {
  const h = setup("grok", fixtures("grok", "smoke", 1), { beforeMessage: data => {
    if (data.type === "response" && data.capture) data.capture.messages[0].text = "Different history";
  } });
  await h.observe();
  await assert.rejects(h.window.__capCaptureNetworkJson(), /invalid message boundaries/);
});
test("Gemini: Unicode frame lengths, selected candidate, page root and broken chains", () => {
  const h = setup("gemini"), f = h.fixture;
  assert.equal(h.api.geminiPage(rpcFrame(f.pages[0])).turns.length, 10);
  const incomplete = rpcFrame(f.pages[0]).slice(0, -12);
  assert.throws(() => h.api.geminiPage(incomplete), /truncated|incomplete/);
  assert.throws(() => h.api.gemini(f.pages.slice(0, 1), "smoke"), /previous/);
  f.pages[1].turns.shift();
  assert.throws(() => h.api.gemini(f.pages, "smoke"), /missing|order/);
  const t = geminiTurn(0, "smoke", "User", "Selected"); t[3][0].unshift(["rc_other", ["INACTIVE_SENTINEL"]]); t[3][3] = "rc_0";
  assert.equal(h.api.gemini([{ turns: [t], cursor: null }], "smoke").text, "Gemini conversation:\n\nUser: User\n\nAssistant: Selected");
  t[3][9] = null; // Older, completed native responses omit this unrelated flag.
  assert.equal(h.api.gemini([{ turns: [t], cursor: null }], "smoke").messageTurnCount, 2);
  t[3][3] = "rc_missing";
  assert.throws(() => h.api.gemini([{ turns: [t], cursor: null }], "smoke"), /missing/);
  t[3][3] = "rc_0";
  t[3][0].push(["rc_0", ["DUPLICATE_SENTINEL"]]);
  assert.throws(() => h.api.gemini([{ turns: [t], cursor: null }], "smoke"), /missing/);
  t[3][0].pop();
  t[2][0][0] = null;
  assert.throws(() => h.api.gemini([{ turns: [t], cursor: null }], "smoke"), /user text.*malformed/);
});

test("Gemini: native parent candidate selects regenerated replies across page boundaries", async () => {
  const f = fixtures("gemini", "smoke", 11);
  const older = f.pages[1].turns[0];
  older[3][0].unshift(["rc_abandoned", ["ABANDONED_SENTINEL"]]);
  const h = setup("gemini", f);
  await h.observe();
  assert.equal((await h.window.__capCaptureNetworkJson()).text, f.expected);
  f.pages[0].turns.at(-1)[1][2] = "rc_missing";
  await assert.rejects(h.window.__capCaptureNetworkJson(), /selected.*missing/i);
  assert.equal(h.navigationListeners(), 0);
});

test("Gemini: late installation builds a fresh RPC from native bootstrap without earlier traffic", async () => {
  const h = setup("gemini");
  h.window.WIZ_global_data.cfb2h = "native-build";
  h.window.WIZ_global_data.FdrFJe = "native-session";
  assert.equal((await h.window.__capCaptureNetworkJson()).text, h.fixture.expected);
  assert.equal(h.requests.length, 3);
  for (const { url, options } of h.requests) {
    assert.equal(url.pathname, "/_/BardChatUi/data/batchexecute");
    assert.equal(url.searchParams.get("bl"), "native-build");
    assert.equal(url.searchParams.get("f.sid"), "native-session");
    assert.equal(url.searchParams.get("source-path"), "/app/smoke");
    assert.equal(new URLSearchParams(options.body).get("at"), "CSRF_SENTINEL");
  }
});
test("Grok orders shuffled nodes and bodies before returning the transcript", async () => {
  for (const nullRoot of [false, true]) {
    const f = fixtures("grok", "smoke", 3);
    if (nullRoot) {
      f.nodes.responseNodes[0].parentResponseId = null;
      f.responses[0].parentResponseId = null;
    }
    f.nodes.responseNodes.reverse();
    const h = setup("grok", f);
    assert.equal(h.api.grok(f.nodes, [...f.responses].reverse()).text, f.expected);
    const capture = await h.window.__capCaptureNetworkJson();
    assert.equal(capture.text, f.expected);
    assert.equal(capture.messageTurnCount, 6);
    const loaded = h.requests.find(request => request.url.pathname.endsWith("load-responses"));
    assert.deepEqual(JSON.parse(loaded.options.body).responseIds,
      ["user_0", "answer_0", "user_1", "answer_1", "user_2", "answer_2"]);
  }
});

test("Grok rejects broken internal links and ambiguous external roots even with a selected leaf", () => {
  const h = setup("grok");
  for (const mutate of [
    f => { f.nodes.responseNodes.splice(1, 1); },
    f => { f.nodes.responseNodes.splice(2, 1); },
    f => { f.nodes.responseNodes[2].parentResponseId = "missing-parent"; },
    f => { f.nodes.responseNodes[2].parentResponseId = null; },
    f => { f.nodes.responseNodes[0].sender = "assistant"; },
    f => { f.nodes.responseNodes[0].parentResponseId = ""; },
    f => { f.nodes.responseNodes[0].parentResponseId = 123; },
    f => { f.nodes.responseNodes[0].parentResponseId = "answer_2"; },
    f => { f.nodes.responseNodes.push({ responseId: "competing-start", parentResponseId: "aaaaaaaa-bbbb-5ccc-8ddd-eeeeeeeeeeee", sender: "human" }); }
  ]) {
    const f = fixtures("grok", "smoke", 3);
    mutate(f);
    assert.throws(() => h.api.grokBranch(f.nodes, "answer_2"), /missing|cycle/);
  }
});

test("Grok keeps JSON on the selected branch despite broken parents on unused replies", async () => {
  for (const nullRoot of [false, true]) for (const parent of ["00000000-0000-4000-8000-000000000099", null]) {
    const f = fixtures("grok", "smoke", 3);
    if (nullRoot) f.nodes.responseNodes[0].parentResponseId = f.responses[0].parentResponseId = null;
    f.nodes.responseNodes.push({ responseId: "unused-reply", parentResponseId: parent, sender: "assistant" });
    f.responses.push({ responseId: "unused-reply", parentResponseId: parent, sender: "assistant", message: "UNUSED_REPLY_SENTINEL" });
    const h = setup("grok", f);
    h.location.href += "?rid=answer_2";
    const capture = await h.window.__capCaptureNetworkJson();
    assert.equal(capture.text, f.expected);
    assert.equal(capture.messageTurnCount, 6);
    assert.equal(h.requests.length, 2);
    const loaded = h.requests.find(request => request.url.pathname.endsWith("load-responses"));
    assert.deepEqual(JSON.parse(loaded.options.body).responseIds,
      ["user_0", "answer_0", "user_1", "answer_1", "user_2", "answer_2"]);
  }
});

test("Grok rejects the same broken parents when they belong to the selected reply", async () => {
  const root = fixtures("grok", "smoke", 3).nodes.responseNodes[0].parentResponseId;
  for (const parent of ["00000000-0000-4000-8000-000000000099", root, null]) {
    const f = fixtures("grok", "smoke", 3);
    f.nodes.responseNodes.at(-1).parentResponseId = f.responses.at(-1).parentResponseId = parent;
    const h = setup("grok", f);
    h.location.href += "?rid=answer_2";
    await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
      assert.equal(error.captureFailureReason, "incomplete");
      assert.equal(error.diagnostics.capture_detail, "parent_missing");
      return true;
    });
    assert.equal(h.requests.length, 1, "Reject the broken selected path before downloading bodies.");
  }
});

test("Grok ignores an unused reply without a parent field but rejects one on the selected path", async () => {
  const f = fixtures("grok", "smoke", 3);
  f.nodes.responseNodes.push({ responseId: "unused-reply", sender: "assistant" });
  const h = setup("grok", f);
  h.location.href += "?rid=answer_2";
  const capture = await h.window.__capCaptureNetworkJson();
  assert.equal(capture.text, f.expected);
  const loaded = h.requests.find(request => request.url.pathname.endsWith("load-responses"));
  assert.deepEqual(JSON.parse(loaded.options.body).responseIds,
    ["user_0", "answer_0", "user_1", "answer_1", "user_2", "answer_2"]);
  delete f.nodes.responseNodes[2].parentResponseId;
  assert.throws(() => h.api.grokBranch(f.nodes, "answer_2"), error => {
    assert.equal(error.captureFailureReason, "incomplete");
    return true;
  });
});

test("Grok rejects a missing oldest pair rather than accepting an ordinary message ID as its root", async () => {
  const f = fixtures("grok", "smoke", 3);
  const ids = new Map(f.responses.map((message, index) =>
    [message.responseId, `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`]));
  for (const message of [...f.nodes.responseNodes, ...f.responses]) {
    message.responseId = ids.get(message.responseId);
    message.parentResponseId = ids.get(message.parentResponseId) || message.parentResponseId;
  }
  // The loader still has all bodies, but the node tree silently lost its head.
  f.nodes.responseNodes.splice(0, 2);
  const h = setup("grok", f);
  await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
    assert.equal(error.captureFailureReason, "incomplete");
    assert.equal(error.diagnostics.capture_detail, "parent_missing");
    return true;
  });
  assert.equal(h.requests.length, 1, "Reject the shortened tree before downloading or returning its suffix.");
  assert.ok(h.replies.every(reply => !reply.capture));
  assert.equal(h.navigationListeners(), 0);
});

test("Grok rejects unknown starting-marker formats while retaining a bounded capture error", async () => {
  for (const parent of ["unknown-root", "11111111-2222-7333-8444-555555555555", "11111111-2222-5333-0444-555555555555"]) {
    const f = fixtures("grok", "smoke", 1);
    f.nodes.responseNodes[0].parentResponseId = f.responses[0].parentResponseId = parent;
    const h = setup("grok", f);
    await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
      assert.equal(error.captureFailureReason, "incomplete");
      assert.equal(error.diagnostics.capture_detail, "parent_missing");
      return true;
    });
    assert.equal(h.requests.length, 1);
    assert.ok(h.replies.every(reply => !reply.capture));
  }
});

test("Grok shared external roots retain explicit first-turn branch selection regardless of node order", () => {
  const f = fixtures("grok", "smoke", 1);
  f.nodes.responseNodes.unshift({ responseId: "other-user", parentResponseId: f.nodes.responseNodes[0].parentResponseId, sender: "human" });
  const h = setup("grok", f);
  assert.equal(h.api.grok(f.nodes, f.responses, "answer_0").text, f.expected);
  assert.throws(() => h.api.grokBranch(f.nodes), /active/);
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
  assert.equal(h.api.grokBranch(f.nodes, "answer_23").length, f.nodes.responseNodes.length - 1);
});
test("DeepSeek keeps selected JSON despite broken or duplicate unused replies", async () => {
  const f = fixtures("deepseek", "smoke", 3);
  const history = f.data.data.biz_data;
  history.chat_messages.unshift(null, { message_id: {}, role: "ASSISTANT" });
  history.chat_messages.push(
    { message_id: 99, role: "ASSISTANT", truncated: true, fragments: [{ type: "RESPONSE", content: "UNUSED_REPLY_SENTINEL" + "x".repeat(13000000) }] },
    { message_id: 99, parent_id: 987, role: "ASSISTANT", fragments: [] },
    { message_id: 100, role: "USER", fragments: [{ type: "FILE", files: [{ ...f.file, id: "unused-file", file_size: 9999999 }] }] }
  );
  const h = setup("deepseek", f); await h.observe();
  const capture = await h.window.__capCaptureNetworkJson();
  assert.equal(capture.text, f.expected);
  assert.equal(capture.messageTurnCount, 6);
  assert.ok(capture.jsonCapture.raw_bytes > 12000000, "Unused branches may exceed the former 12 MB download cap.");
  assert.equal(h.requests.filter(request => request.url.pathname.includes("history_messages")).length, 1);
  assert.equal(h.requests.filter(request => request.url.hostname === "files.deepseeksvc.com").length, 1,
    "Only the selected user file may be downloaded.");
  assert.equal(h.navigationListeners(), 0);
});

test("DeepSeek still rejects missing or ambiguous selected messages before file reads", async () => {
  for (const [mutate, detail] of [
    [history => { delete history.chat_messages.at(-1).parent_id; }, "parent_missing"],
    [history => { history.chat_messages.push({ ...history.chat_messages.at(-1) }); }, "invalid_branch"],
    [history => { history.chat_messages.push({ ...history.chat_messages[0], parent_id: 99 }); }, "invalid_branch"],
    [history => { history.chat_messages[0].parent_id = history.chat_messages.at(-1).message_id; }, "branch_cycle"]
  ]) {
    const f = fixtures("deepseek", "smoke", 3); mutate(f.data.data.biz_data);
    const h = setup("deepseek", f); await h.observe();
    await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
      assert.equal(error.captureFailureReason, "incomplete");
      assert.equal(error.diagnostics.capture_detail, detail);
      return true;
    });
    assert.equal(h.requests.length, 1, "Do not read files or return partial text for a broken selected path.");
    assert.equal(h.navigationListeners(), 0);
  }
});

test("DeepSeek: reject cache deltas and missing parents while excluding incomplete uploads", () => {
  const h = setup("deepseek");
  for (const mutate of [
    f => { f.data.data.biz_data.cache_control = "MERGE"; },
    f => { f.data.data.biz_data.chat_messages.splice(4, 1); },
    f => { f.data.code = 40003; }
  ]) {
    const f = fixtures("deepseek"); mutate(f);
    assert.throws(() => h.api.deepseek(f.data, "smoke", f.files), /cache|missing|unfinished|incomplete|could not/);
  }
  const f = fixtures("deepseek"); f.file.file_size++;
  assert.ok(!h.api.deepseek(f.data, "smoke", f.files).text.includes("File contents"));
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
test("slow/release: Gemini, Grok and DeepSeek capture admit transcripts through 1,000,000 characters without clipping", async () => {
  for (const platform of ["gemini", "grok", "deepseek"]) {
    const baseline = setup(platform);
    await baseline.observe();
    const original = await baseline.window.__capCaptureNetworkJson();
    const f = fixtures(platform);
    const originalText = platform === "gemini" ? f.pages[0].turns[0][2][0][0]
      : platform === "grok" ? f.responses[0].message : f.data.data.biz_data.chat_messages[1].fragments[0].content;
    const overhead = original.text.length - originalText.length;
    for (const length of [350001, 1000000, 1000001]) {
      const f = fixtures(platform), text = "漢".repeat(length - overhead);
      if (platform === "gemini") f.pages[0].turns[0][2][0][0] = text;
      else if (platform === "grok") f.responses[0].message = text;
      else f.data.data.biz_data.chat_messages[1].fragments[0].content = text;
      const h = setup(platform, f);
      await h.observe();
      if (length > 1000000) await assert.rejects(h.window.__capCaptureNetworkJson(), /too long/);
      else assert.equal((await h.window.__capCaptureNetworkJson()).text.length, length, platform);
    }
  }
});

test("All adapters reject zero own text and oversize text without truncation", () => {
  const g = setup("gemini"), t = geminiTurn(0, "smoke", "", "");
  assert.throws(() => g.api.gemini([{ turns: [t], cursor: null }], "smoke"), /No usable/);
  t[2][0][0] = "x".repeat(1000001);
  assert.throws(() => g.api.gemini([{ turns: [t], cursor: null }], "smoke"), /size/);
  const k = setup("grok"); k.fixture.responses.forEach(message => { message.message = ""; });
  assert.throws(() => k.api.grok(k.fixture.nodes, k.fixture.responses), /No usable/);
  k.fixture.responses[0].message = "x".repeat(1000001);
  assert.throws(() => k.api.grok(k.fixture.nodes, k.fixture.responses), /size/);
  const d = setup("deepseek");
  d.fixture.data.data.biz_data.chat_messages.forEach(message => { message.fragments = [{ type: message.role === "USER" ? "REQUEST" : "RESPONSE", content: "" }]; });
  assert.throws(() => d.api.deepseek(d.fixture.data, "smoke"), /No usable/);
  d.fixture.data.data.biz_data.chat_messages[0].fragments[0].content = "x".repeat(1000001);
  assert.throws(() => d.api.deepseek(d.fixture.data, "smoke"), /size/);
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
    assert.equal(installs, 1); assert.equal(h.listeners.size, 2);
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
  await assert.rejects(pending, error => error.diagnosticCode === "conversation_changed");
  assert.ok(h.replies.every(reply => !reply.capture));
});

test("slow/release: DeepSeek: the shared history/file budget accepts exactly 32 MB and rejects one extra byte", async () => {
  for (const extra of [0, 1]) {
    const f = fixtures("deepseek", "smoke", 1);
    f.data.unused_metadata = "";
    const historyBytes = Buffer.byteLength(JSON.stringify(f.data));
    f.data.unused_metadata = " ".repeat(32000000 - historyBytes - f.file.file_size + extra);
    assert.equal(Buffer.byteLength(JSON.stringify(f.data)) + f.file.file_size, 32000000 + extra);
    const h = setup("deepseek", f);
    await h.observe();
    if (extra) {
      await assert.rejects(h.window.__capCaptureNetworkJson(), error => {
        assert.equal(error.captureFailureReason, "size_limit");
        return true;
      });
      assert.ok(h.replies.every(reply => !reply.capture));
    } else assert.equal((await h.window.__capCaptureNetworkJson()).text, f.expected);
  }
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
  assert.equal(h.listeners.size, 2);
});

test("Grok skips unsupported file bodies and preserves the conversation's readable text", async () => {
  for (const metadata of [{ fileAttachments: ["file-id"] }, { fileAttachmentsMetadata: [{ fileName: "source.py", fileMimeType: "text/x-python", fileUri: "PRIVATE_FILE_SENTINEL" }] }]) {
    const f = fixtures("grok", "smoke", 1);
    Object.assign(f.responses[0], { message: "", ...metadata });
    const h = setup("grok", f);
    const capture = await h.window.__capCaptureNetworkJson();
    assert.ok(capture.text.includes(f.responses[1].message));
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

test("Gemini: optional user metadata cannot reject a complete paginated text history", async () => {
  const f = fixtures("gemini");
  const metadata = [
    [["CONTEXT_SENTINEL", { text: "NESTED_BODY_SENTINEL" }]],
    [null, [null, null, null, null, null]],
    [[null, null, null, null, [null, { file_name: "GUESS_SENTINEL" }, [null, null, "NOT_A_FILE_SENTINEL"]]]],
    { text: "UNSUPPORTED_OBJECT_SENTINEL" },
    "UNSUPPORTED_STRING_SENTINEL"
  ];
  f.pages.flatMap(page => page.turns).forEach((item, i) => { item[2][0][4] = metadata[i % metadata.length]; });
  const h = setup("gemini", f);
  assert.equal(h.requests.length, 0);
  const capture = await h.window.__capCaptureNetworkJson();
  assert.equal(capture.text, f.expected);
  assert.equal(capture.messageTurnCount, 48);
  assert.deepEqual([...capture.excludedContentTypes], ["other"]);
  assert.equal(h.requests.length, 3);
  assert.doesNotMatch(JSON.stringify(h.replies), /CONTEXT_SENTINEL|NESTED_BODY_SENTINEL|GUESS_SENTINEL|NOT_A_FILE_SENTINEL|UNSUPPORTED_.*_SENTINEL/);
  assert.equal(h.navigationListeners(), 0);
});

test("Gemini: known upload names survive mixed optional metadata without guessing other names", async () => {
  const f = fixtures("gemini", "smoke", 1), item = f.pages[0].turns[0];
  item[2][0][4] = [
    null,
    ["CONTEXT_SENTINEL"],
    [null, null, null, null, [[null, 11, "Guide.pdf"], ["ID_SENTINEL", null, "NOT_A_FILE_SENTINEL"], { text: "BODY_SENTINEL" }]]
  ];
  f.expected = f.expected.replace("\n\nAssistant:", '\n\nAttachment: "Guide.pdf"\n\nAssistant:');
  const h = setup("gemini", f);
  const capture = await h.window.__capCaptureNetworkJson();
  assert.equal(capture.text, f.expected);
  assert.deepEqual([...capture.excludedContentTypes], ["other", "uploads"]);
  assert.equal(h.requests.length, 1);
  assert.doesNotMatch(JSON.stringify(h.replies), /CONTEXT_SENTINEL|ID_SENTINEL|NOT_A_FILE_SENTINEL|BODY_SENTINEL/);
  // Unsupported metadata cannot discard the remaining readable answer.
  item[2][0][0] = " \r\n";
  assert.ok((await h.window.__capCaptureNetworkJson()).text.includes("Assistant:"));
  assert.equal(h.navigationListeners(), 0);
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
  assert.equal(h.api.gemini([{ turns: [t], cursor: null }], "smoke").text, "Gemini conversation:\n\nAssistant: Answer");
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
  assert.ok(!h.api.deepseek(h.fixture.data, "smoke", { empty: "", code: source }).text.includes(source));
});

for (const platform of ["gemini", "grok", "deepseek"]) test(`${platform}: rough estimation survives strict history rejection without a false size rejection`, async () => {
  const f = fixtures(platform);
  if (platform === "deepseek") f.data.data.biz_data.is_partial = true;
  else if (platform === "grok") f.nodes.is_partial = true;
  else f.pages[0].turns[0][1] = ["c_smoke", "missing_parent", "missing_response"];
  const h = setup(platform, f); await h.observe();
  await assert.rejects(h.window.__capCaptureNetworkJson());
  const result = await h.window.__capMeasureNetworkJson();
  assert.equal(result.characterCount, 0);
  assert.ok(result.messageTurnCount > 0);
  assert.ok(Object.values(result).every(value => Number.isSafeInteger(value)));
  assert.equal(h.replies.at(-1).capture, undefined);
});

test("DeepSeek publishes a rough estimate before file downloads finish without releasing the native read", async () => {
  const f = fixtures("deepseek", "smoke", 2);
  let observed, finished = false, releaseFile;
  const estimateReady = new Promise(resolve => { observed = resolve; });
  const file = new Promise(resolve => { releaseFile = resolve; });
  const h = setup("deepseek", f, { fetchImpl: request => request.url.pathname.includes("history_messages") ? Response.json(f.data) : file });
  await h.observe();
  const pending = h.window.__capMeasureNetworkJson(undefined, undefined, observed).then(result => { finished = true; return result; });
  const estimate = await estimateReady;
  assert.equal(estimate.messageTurnCount, 4);
  assert.ok(estimate.estimatedCharacterCount > 0);
  assert.equal(finished, false);
  releaseFile(new Response(f.files[f.file.id], { headers: { "content-type": "text/plain" } }));
  const final = await pending;
  assert.ok(final.characterCount > estimate.estimatedCharacterCount, "The final guard includes downloaded supported text.");
  assert.equal(final.messageTurnCount, 4);
});

for (const platform of ["gemini","grok","deepseek"]) test(platform+": checkpoints preserve native read progress and successful validation",async()=>{
  const h=setup(platform); await h.observe(); const progress=[];
  const c=await h.window.__capCaptureNetworkJson(undefined,false,d=>progress.push(d));
  assert.equal(c.jsonCapture.step,"complete"); assert.equal(c.jsonCapture.hook_ready,true);
  assert.equal(c.jsonCapture.route_found,true); assert.equal(c.jsonCapture.history_request_sent,true);
  assert.equal(c.jsonCapture.history_response_read,true); assert.equal(c.jsonCapture.history_parsed,true); assert.equal(c.jsonCapture.history_checked,true);
  for (const step of ["hook","route","request","response","read","parse","check","serialize","complete"]) assert.ok(progress.some(d=>d.step===step),step);
  assert.doesNotMatch(JSON.stringify(progress),/AUTH_SENTINEL|SIGNED_SENTINEL|PRIVATE|https/);
});
