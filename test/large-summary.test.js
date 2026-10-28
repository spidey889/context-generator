const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { clockTest } = require("./helpers/clock");
const handler = require("../api/large-summary");
const protocol = require("../api/large-summary-protocol");
const { resetRequestSecurityForTests } = require("../api/request-security");

const secret = "large-summary-test-secret-32-characters-minimum";
const transferId = "11111111-1111-4111-8111-111111111111";
const metadata = { version: 1, phase: "part", transferId, index: 0, total: 2, totalChars: 1200000, offset: 0 };
const telemetry = { attempt_id: transferId, install_id: "22222222-2222-4222-8222-222222222222",
  attempted_at: "2026-10-29T01:00:00.000Z", source_platform: "deepseek", destination_platform: "claude",
  character_count: metadata.totalChars, status: "started", last_stage: "summary_request_started", failure_reason: null, extension_version: "1.4.34" };
const usefulSummary = "The project keeps the accepted implementation, preserves every outstanding requirement, and continues the user's latest pending debugging task.";

function request(body, headers = {}) {
  return { method: "POST", body, headers: { origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "content-type": "application/json", "x-cap-context-client": "cap-context-extension/1", "x-forwarded-for": "203.0.113.144", ...headers } };
}

function response() {
  const res = new EventEmitter();
  Object.assign(res, { statusCode: 200, headers: {}, destroyed: false, writableEnded: false,
    status(code) { this.statusCode = code; return this; }, setHeader(name, value) { this.headers[name] = value; },
    json(body) { this.body = body; this.writableEnded = true; return this; }, end() { this.writableEnded = true; return this; } });
  return res;
}

function setup(t, fetchImpl) {
  const env = { ...process.env }, originalFetch = global.fetch;
  process.env.TELEMETRY_SIGNING_KEY = secret;
  process.env.TOKENHARBOR_API_KEY = "test-primary";
  process.env.TOKENHARBOR_BACKUP_API_KEY = "test-backup";
  delete process.env.LARGE_SUMMARY_ENABLED;
  delete process.env.TOKENHARBOR_ENABLED;
  delete process.env.SUPABASE_TELEMETRY_FUNCTION_URL;
  global.fetch = fetchImpl || (async () => new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }] }), { status: 200 }));
  handler.__test.resetRateLimit(); resetRequestSecurityForTests();
  t.after(() => {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(env, key)) delete process.env[key];
    Object.assign(process.env, env);
    handler.__test.resetRateLimit(); resetRequestSecurityForTests();
  });
}

function signedParts(now = Date.now()) {
  return [0, 1].map(index => {
    const large = { ...metadata, index, offset: index * 600000 };
    const conversation = (index ? "b" : "a").repeat(600000), summary = `${usefulSummary} Part ${index + 1}.`;
    return { summary, receipt: protocol.signPart({ large, conversation, summary, telemetry }, secret, now) };
  });
}
function finalBody(parts = signedParts()) {
  const { index, offset, ...large } = metadata;
  return { large: { ...large, phase: "final" }, parts, telemetry };
}

test("large summary rejects malformed envelopes, private extras, excess parts and wire sizes", () => {
  const valid = { conversation: "a".repeat(600000), large: metadata, telemetry };
  assert.equal(protocol.validateRequest(request(valid)).ok, true);
  for (const body of [
    { ...valid, arbitrary: "private" }, { ...valid, large: { ...metadata, token: "private" } },
    { ...valid, large: { ...metadata, totalChars: 1000000 } }, { ...valid, large: { ...metadata, total: 17 } },
    { ...valid, large: { ...metadata, index: 2 } }, { ...valid, large: { ...metadata, offset: 1000000 } },
    { ...valid, conversation: "a".repeat(750001) }, { ...valid, telemetry: { ...telemetry, attempt_id: telemetry.install_id } },
    { ...valid, telemetry: { ...telemetry, character_count: 1 } }, { ...valid, telemetry: { ...telemetry, summary_proof: "a".repeat(64) } }
  ]) assert.equal(protocol.validateRequest(request(body)).ok, false);
  assert.equal(protocol.validateRequest(request(valid, { "content-length": "3000001" })).status, 413);
  assert.equal(protocol.validateRequest(request({ ...valid, conversation: "\\".repeat(750000) }, { "content-type": "text/plain" })).status, 415);
  assert.equal(protocol.validateRequest(request(finalBody([]))).ok, false);
});

test("part receipts reject forgery, changed summaries, reordered, gapped, missing, expired or other identities", () => {
  const now = Date.now(), body = finalBody(signedParts(now));
  assert.equal(protocol.verifyParts(body, secret, now), true);
  const mutate = fn => { const value = structuredClone(body); fn(value); return value; };
  for (const changed of [
    mutate(x => { x.parts[0].receipt = x.parts[0].receipt.replace(/.$/, x.parts[0].receipt.endsWith("a") ? "b" : "a"); }),
    mutate(x => { x.parts[0].summary += "forged"; }), mutate(x => x.parts.reverse()),
    mutate(x => { x.parts[1] = { ...x.parts[0] }; }), mutate(x => { x.parts.pop(); }),
    mutate(x => { x.telemetry.install_id = transferId; }), mutate(x => { delete x.telemetry; }),
    mutate(x => { x.large.transferId = telemetry.install_id; }), mutate(x => { x.large.totalChars++; })
  ]) assert.equal(protocol.verifyParts(changed, secret, now), false);
  const gap = structuredClone(body);
  gap.parts[1].receipt = protocol.signPart({ large: { ...metadata, index: 1, offset: 600001 },
    conversation: "b".repeat(600000), summary: gap.parts[1].summary, telemetry }, secret, now);
  assert.equal(protocol.verifyParts(gap, secret, now), false);
  assert.equal(protocol.verifyParts(body, secret, now + protocol.RECEIPT_TTL_MS), false);
  assert.equal(protocol.verifyParts(body, "other-test-secret-long-enough-for-signing", now), false);
  assert.equal(protocol.verifyParts({ ...body, telemetry: { ...telemetry, last_stage: "summary_response_started" } }, secret, now), true,
    "ordinary progress does not change original identity");
});

test("parts use only one TokenHarbor request and return no completed-summary proof", async t => {
  const calls = [];
  setup(t, async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }] }), { status: 200 });
  });
  const res = response();
  await handler(request({ conversation: "a".repeat(600000), large: metadata, telemetry }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://tokenharbor.ai/v1/chat/completions");
  const provider = JSON.parse(calls[0].options.body);
  assert.equal(provider.model, "deepseek-v4.1-flash:free");
  assert.equal(provider.stream, true);
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-primary");
  assert.ok(Buffer.byteLength(calls[0].options.body) <= 3800000);
  assert.ok(res.body.receipt);
  assert.equal(res.body.summaryProofV3, undefined);
  assert.equal(res.body.summaryModel, undefined);
});

test("only a verified complete final consolidation receives one original-transfer summary proof", async t => {
  const calls = [];
  setup(t, async (url, options) => {
    calls.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }] }), { status: 200 });
  });
  const res = response(), body = finalBody();
  await handler(request(body), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].messages[1].content, /Conversation part 1 of 2/);
  assert.match(calls[0].messages[1].content, /Conversation part 2 of 2/);
  assert.equal(res.body.receipt, undefined);
  assert.match(res.body.summaryProofV3, /^[0-9a-f]{64}$/);
  assert.equal(res.body.summaryModel, "deepseek-v4.1-flash:free");
  const { verifySummaryReceipt } = await import("../supabase/functions/_shared/summary-proof.mjs");
  assert.deepEqual(await verifySummaryReceipt({ ...telemetry, summary_proof: res.body.summaryProofV3,
    summary_confirmed_at: res.body.summaryConfirmedAt, model: res.body.summaryModel }, secret), { model: res.body.summaryModel });
  assert.equal(await verifySummaryReceipt({ ...telemetry, install_id: transferId, summary_proof: res.body.summaryProofV3,
    summary_confirmed_at: res.body.summaryConfirmedAt, model: res.body.summaryModel }, secret), null);
});

test("forged final receipts stop before any provider work", async t => {
  let calls = 0; setup(t, async () => { calls++; throw new Error("Should never run"); });
  const body = finalBody(); body.parts[0].summary += "changed";
  const res = response(); await handler(request(body), res);
  assert.equal(res.statusCode, 400); assert.equal(res.body.code, "invalid_parts"); assert.equal(calls, 0);
});

test("disabled, unconfigured and backup-only routes fail closed or use the single permitted key", async t => {
  let calls = 0; setup(t, async (_url, options) => {
    calls++; assert.equal(options.headers.Authorization, "Bearer test-backup");
    return new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }] }), { status: 200 });
  });
  const body = { conversation: "a".repeat(600000), large: metadata };
  process.env.LARGE_SUMMARY_ENABLED = "false";
  const disabled = response(); await handler(request(body), disabled); assert.equal(disabled.statusCode, 503);
  delete process.env.LARGE_SUMMARY_ENABLED;
  delete process.env.TOKENHARBOR_API_KEY; delete process.env.TOKENHARBOR_BACKUP_API_KEY;
  const missing = response(); await handler(request(body), missing); assert.equal(missing.statusCode, 503);
  process.env.TOKENHARBOR_BACKUP_API_KEY = "test-backup";
  const backup = response(); await handler(request(body), backup); assert.equal(backup.statusCode, 200); assert.equal(calls, 1);
});

test("provider failure and refusal never become signed partial summaries or retries", async t => {
  let calls = 0; setup(t, async () => { calls++; return new Response("private error body", { status: 503 }); });
  const body = { conversation: "a".repeat(600000), large: metadata };
  const res = response(); await handler(request(body), res);
  assert.equal(res.statusCode, 502); assert.equal(calls, 1); assert.equal(res.body.receipt, undefined);
  global.fetch = async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: "I cannot help with this request." } }] }), { status: 200 }); };
  const refused = response(); await handler(request(body), refused);
  assert.equal(refused.statusCode, 502); assert.equal(calls, 2); assert.equal(refused.body.receipt, undefined);
});

test("native client cancellation aborts the sole upstream request without a part receipt", async t => {
  let signal, started;
  const pending = new Promise(resolve => { started = resolve; });
  setup(t, async (_url, options) => {
    signal = options.signal; started();
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true }));
  });
  const res = response();
  const work = handler(request({ conversation: "a".repeat(600000), large: metadata }), res);
  await pending; res.destroyed = true; res.emit("close"); await work;
  assert.equal(signal.aborted, true); assert.equal(res.body?.receipt, undefined);
});

test("truncated provider output cannot certify complete coverage of a conversation part", async t => {
  setup(t, async () => new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "length" }] }), { status: 200 }));
  const res = response();
  await handler(request({ conversation: "a".repeat(600000), large: metadata, telemetry }), res);
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.receipt, undefined);
  assert.equal(res.body.summaryProofV3, undefined);
});

clockTest("large summary total deadline aborts a silent provider without retry or receipt", { tickMs: 1000, maxElapsedMs: 80000 }, async t => {
  let calls = 0, signal;
  setup(t, async (_url, options) => {
    calls++; signal = options.signal;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Timeout", "AbortError")), { once: true }));
  });
  const res = response(), started = Date.now();
  await handler(request({ conversation: "a".repeat(600000), large: metadata }), res);
  assert.equal(res.statusCode, 504);
  assert.equal(res.body.code, "summary_timeout");
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  assert.equal(res.body.receipt, undefined);
  assert.ok(Date.now() - started <= 75000);
});

test("large summary keeps extension request admission and CORS boundaries", async t => {
  let calls = 0; setup(t, async () => { calls++; throw new Error("Unexpected provider work"); });
  const get = response(); await handler({ method: "GET", headers: {} }, get); assert.equal(get.statusCode, 405);
  const browser = response(); await handler(request({ conversation: "a", large: metadata }, { origin: "https://example.com" }), browser);
  assert.equal(browser.statusCode, 403);
  const preflight = response(); await handler({ method: "OPTIONS", headers: { origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "access-control-request-method": "POST", "access-control-request-headers": "Content-Type,X-Cap-Context-Client" } }, preflight);
  assert.equal(preflight.statusCode, 204);
  assert.equal(calls, 0);
});

test("nested provider escaping and the separate large-request rate limit stay bounded", async t => {
  setup(t);
  const body = { conversation: "\\".repeat(750000), large: metadata };
  assert.equal(protocol.validateRequest(request(body)).ok, true);
  const res = response(); await handler(request(body), res);
  assert.equal(res.statusCode, 200, "3M escaped bytes plus the envelope fit the provider bound");
  handler.__test.resetRateLimit();
  for (let n = 0; n < 32; n++) assert.equal(handler.__test.consumeRateLimit(request({}), 1000), true);
  assert.equal(handler.__test.consumeRateLimit(request({}), 1000), false);
  assert.equal(handler.__test.consumeRateLimit(request({}), 61000), true);
});

test("short last parts and compact final handoffs retain a remote answer allowance", async t => {
  const requests = [];
  setup(t, async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }] }), { status: 200 });
  });
  const tail = response();
  const tailText = "The latest request is to continue debugging.";
  await handler(request({ conversation: tailText,
    large: { ...metadata, index: 1, offset: metadata.totalChars - tailText.length } }), tail);
  assert.equal(tail.statusCode, 200);
  const final = response();
  await handler(request(finalBody()), final);
  assert.equal(final.statusCode, 200);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(body => body.max_tokens >= 1900 + 8192));
});
