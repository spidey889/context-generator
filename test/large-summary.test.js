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
  process.env.OPENROUTER_API_KEY = "test-primary";
  delete process.env.TOKENHARBOR_API_KEY;
  delete process.env.TOKENHARBOR_BACKUP_API_KEY;
  delete process.env.TOKENHARBOR_ENABLED;
  delete process.env.LARGE_SUMMARY_ENABLED;
  delete process.env.OPENROUTER_ENABLED;
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

test("parts use only one NVIDIA OpenRouter request and return no completed-summary proof", async t => {
  const calls = [];
  setup(t, async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }] }), { status: 200 });
  });
  const res = response();
  await handler(request({ conversation: "a".repeat(600000), large: metadata, telemetry }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  const provider = JSON.parse(calls[0].options.body);
  assert.equal(provider.model, "nvidia/nemotron-3.5-super-vl:free");
  assert.equal(provider.stream, true);
  assert.equal(provider.temperature, 1);
  assert.equal(provider.top_p, 0.95);
  assert.deepEqual(provider.reasoning, { enabled: false, exclude: true });
  assert.deepEqual(provider.plugins, [{ id: "context-compression", enabled: false }]);
  assert.deepEqual(provider.provider, { require_parameters: true, data_collection: "allow", max_price: { prompt: 0, completion: 0, request: 0 } });
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-primary");
  assert.ok(Buffer.byteLength(calls[0].options.body) <= 3800000);
  assert.ok(res.body.receipt);
  assert.equal(res.body.summaryProofV3, undefined);
  assert.equal(res.body.summaryModel, undefined);
});

test("large streams acknowledge the request before waiting for a model without exposing partial summaries", async t => {
  const chunks = [], res = response();
  let started, finish;
  const pending = new Promise(resolve => { started = resolve; });
  setup(t, async () => {
    started();
    return new Promise(resolve => { finish = () => resolve(new Response(JSON.stringify({
      choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }]
    }))); });
  });
  res.write = chunk => chunks.push(chunk);
  res.flushHeaders = () => { res.headersSent = true; };
  const work = handler(request({ conversation: "a".repeat(600000), large: metadata },
    { accept: "application/x-ndjson" }), res);
  try {
    await pending;
    assert.equal(res.headersSent, true, "The client must not wait for a heartbeat or model output to receive headers.");
    assert.deepEqual(chunks.map(chunk => JSON.parse(chunk)), [{ type: "reset" }]);
  } finally { finish(); await work; }
  const events = chunks.map(chunk => JSON.parse(chunk));
  assert.deepEqual(events.map(event => event.type), ["reset", "result"]);
  assert.ok(events[1].data.summary.startsWith(usefulSummary));
  assert.ok(events[1].data.receipt);
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
  assert.equal(res.body.summaryModel, "nvidia/nemotron-3.5-super-vl:free");
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

test("large beta disablement and absence of enabled provider credentials stop before provider work", async t => {
  let calls = 0; setup(t, async () => { calls++; throw new Error("No provider work allowed"); });
  const body = { conversation: "a".repeat(600000), large: metadata };
  process.env.TOKENHARBOR_API_KEY = "test-backup";
  process.env.LARGE_SUMMARY_ENABLED = "false";
  const disabled = response(); await handler(request(body), disabled); assert.equal(disabled.statusCode, 503);
  delete process.env.LARGE_SUMMARY_ENABLED;
  process.env.OPENROUTER_ENABLED = "false";
  process.env.TOKENHARBOR_ENABLED = "false";
  const gatewayDisabled = response(); await handler(request(body), gatewayDisabled); assert.equal(gatewayDisabled.statusCode, 503);
  delete process.env.OPENROUTER_ENABLED;
  delete process.env.OPENROUTER_API_KEY;
  const missing = response(); await handler(request(body), missing); assert.equal(missing.statusCode, 503);
  assert.equal(calls, 0, "Disabled TokenHarbor credentials cannot substitute for NVIDIA.");
});

test("a failed NVIDIA part falls back once to DeepSeek with the same complete input", async t => {
  const calls = [];
  setup(t, async (url, options) => {
    calls.push({ url, options, body: JSON.parse(options.body) });
    return calls.length === 1 ? new Response("private provider error", { status: 429 })
      : new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }] }));
  });
  process.env.TOKENHARBOR_API_KEY = "test-backup";
  process.env.TOKENHARBOR_BACKUP_API_KEY = "must-not-try-another-key";
  const res = response(), conversation = "a".repeat(600000);
  await handler(request({ conversation, large: metadata, telemetry }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://tokenharbor.ai/v1/chat/completions");
  assert.equal(calls[1].options.headers.Authorization, "Bearer test-backup");
  assert.equal(calls[1].body.model, "deepseek-v4.1-flash:free");
  assert.deepEqual(calls[1].body.messages, calls[0].body.messages);
  assert.equal(calls[1].body.provider, undefined, "OpenRouter-specific policy must not leak into TokenHarbor.");
  assert.equal(calls[1].body.max_tokens, calls[0].body.max_tokens + 8192);
  assert.equal(calls[1].body.temperature, 0.1);
  assert.equal(calls[1].body.stream, true);
  assert.ok(res.body.receipt);
  assert.equal(res.body.summaryProofV3, undefined);
  assert.deepEqual(res.body.timing.modelsTried, [calls[0].body.model, calls[1].body.model]);
  assert.deepEqual(res.body.timing.tokenharborModelsTried, [calls[1].body.model]);
  assert.equal(res.body.timing.fallback.used, true);
  assert.equal(res.body.timing.provider, "tokenharbor");
  assert.equal(JSON.stringify(res.body).includes("private provider error"), false);
});

test("mixed-provider parts remain verifiable and a DeepSeek final proof binds the actual serving model", async t => {
  const calls = [];
  setup(t, async (_url, options) => {
    calls.push(JSON.parse(options.body));
    const body = calls.at(-1), text = JSON.parse(body.messages[1].content).conversation;
    // First part and final win on DeepSeek; the second part wins on NVIDIA.
    const secondPart = text.startsWith("b"), nvidia = body.model.startsWith("nvidia/");
    return nvidia !== secondPart ? new Response("", { status: 503 })
      : new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }] }));
  });
  process.env.TOKENHARBOR_API_KEY = "test-backup";
  const parts = [];
  for (const index of [0, 1]) {
    const res = response();
    await handler(request({ conversation: (index ? "b" : "a").repeat(600000),
      large: { ...metadata, index, offset: index * 600000 }, telemetry }), res);
    assert.equal(res.statusCode, 200);
    parts.push({ summary: res.body.summary, receipt: res.body.receipt });
  }
  const body = finalBody(parts), res = response();
  assert.equal(protocol.verifyParts(body, secret), true);
  await handler(request(body), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 6, "Each part/final has at most one call to each configured free provider.");
  assert.deepEqual(calls[4].messages, calls[5].messages);
  assert.equal(res.body.summaryModel, "deepseek-v4.1-flash:free");
  const { verifySummaryReceipt } = await import("../supabase/functions/_shared/summary-proof.mjs");
  const receipt = { ...telemetry, summary_proof: res.body.summaryProofV3, summary_confirmed_at: res.body.summaryConfirmedAt };
  assert.deepEqual(await verifySummaryReceipt({ ...receipt, model: res.body.summaryModel }, secret), { model: res.body.summaryModel });
  assert.equal(await verifySummaryReceipt({ ...receipt, model: "nvidia/nemotron-3.5-super-vl:free" }, secret), null);
});

test("the first valid NVIDIA result wins; absent or disabled NVIDIA uses the configured DeepSeek key", async t => {
  const calls = [];
  setup(t, async (_url, options) => {
    calls.push({ body: JSON.parse(options.body), auth: options.headers.Authorization });
    return new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }] }));
  });
  process.env.TOKENHARBOR_BACKUP_API_KEY = "test-backup-slot";
  const body = { conversation: "a".repeat(600000), large: metadata };
  const primary = response(); await handler(request(body), primary);
  assert.equal(primary.statusCode, 200); assert.equal(calls.length, 2);
  assert.equal(primary.body.timing.model, "nvidia/nemotron-3.5-super-vl:free");
  assert.equal(primary.body.timing.fallback.attempted, true);
  assert.equal(primary.body.timing.fallback.used, false);
  delete process.env.OPENROUTER_API_KEY;
  const missing = response(); await handler(request(body), missing);
  assert.equal(missing.statusCode, 200); assert.equal(calls[2].body.model, "deepseek-v4.1-flash:free");
  assert.equal(calls[2].auth, "Bearer test-backup-slot");
  process.env.OPENROUTER_API_KEY = "test-primary";
  process.env.OPENROUTER_ENABLED = "false";
  const disabled = response(); await handler(request(body), disabled);
  assert.equal(disabled.statusCode, 200); assert.equal(calls[3].body.model, "deepseek-v4.1-flash:free");
});

test("a rate-limited TokenHarbor primary uses its distinct backup once with the same input", async t => {
  const calls = [];
  setup(t, async (url, options) => {
    calls.push({ url, auth: options.headers.Authorization, body: JSON.parse(options.body) });
    if (url.includes("openrouter")) return new Response("", { status: 502 });
    if (options.headers.Authorization === "Bearer limited-primary") return new Response("PRIVATE_QUOTA", { status: 429 });
    return new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }] }));
  });
  process.env.TOKENHARBOR_API_KEY = "limited-primary";
  process.env.TOKENHARBOR_BACKUP_API_KEY = "working-backup";
  const res = response();
  await handler(request({ conversation: "a".repeat(600000), large: metadata, telemetry }), res);
  assert.equal(res.statusCode, 200);
  const token = calls.filter(call => call.url.includes("tokenharbor"));
  assert.deepEqual(token.map(call => call.auth), ["Bearer limited-primary", "Bearer working-backup"]);
  assert.deepEqual(token[0].body, token[1].body);
  assert.equal(calls.length, 3);
  assert.equal(res.body.timing.keySlot, "backup");
  assert.ok(res.body.timing.providerFailures.some(entry => entry.provider === "tokenharbor" && entry.key_slot === "primary" && entry.http_status === 429));
  assert.ok(res.body.receipt);
  assert.doesNotMatch(JSON.stringify(res.body), /limited-primary|working-backup|PRIVATE_QUOTA/);
});

test("two rate-limited TokenHarbor keys are bounded and skipped on subsequent warm requests", async t => {
  const calls = [];
  setup(t, async (_url, options) => { calls.push(options.headers.Authorization); return new Response("", { status: 429 }); });
  delete process.env.OPENROUTER_API_KEY;
  process.env.TOKENHARBOR_API_KEY = "limited-primary";
  process.env.TOKENHARBOR_BACKUP_API_KEY = "limited-backup";
  const body = { conversation: "a".repeat(600000), large: metadata };
  const first = response(); await handler(request(body), first);
  assert.equal(first.statusCode, 502);
  assert.equal(first.body.providerFailures.length, 2);
  assert.deepEqual(first.body.providerFailures.map(entry => entry.key_slot), ["primary", "backup"]);
  assert.ok(first.body.providerFailures.every(entry => Object.keys(entry).every(key =>
    ["provider", "key_slot", "failure_reason", "phase", "elapsed_ms", "http_status"].includes(key))));
  assert.deepEqual(calls, ["Bearer limited-primary", "Bearer limited-backup"]);
  const second = response(); await handler(request(body), second);
  assert.equal(second.statusCode, 503);
  assert.equal(calls.length, 2, "Do not repeatedly hit known rate-limited keys while they cool down.");
  assert.equal(second.body.receipt, undefined);
  process.env.TOKENHARBOR_API_KEY = "fresh-primary";
  global.fetch = async (_url, options) => {
    calls.push(options.headers.Authorization);
    return new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }] }));
  };
  const rotated = response(); await handler(request(body), rotated);
  assert.equal(rotated.statusCode, 200);
  assert.equal(calls[2], "Bearer fresh-primary", "An environment rotation must not inherit another key's cooldown.");
});

test("TokenHarbor does not rotate identical credentials or use a second key after non-quota errors", async t => {
  let calls = 0;
  setup(t, async () => { calls++; return new Response("", { status: 429 }); });
  delete process.env.OPENROUTER_API_KEY;
  process.env.TOKENHARBOR_API_KEY = process.env.TOKENHARBOR_BACKUP_API_KEY = "same-key";
  const body = { conversation: "a".repeat(600000), large: metadata };
  await handler(request(body), response());
  assert.equal(calls, 1);
  for (const status of [401, 403, 503]) {
    handler.__test.resetRateLimit(); calls = 0;
    process.env.TOKENHARBOR_API_KEY = "primary"; process.env.TOKENHARBOR_BACKUP_API_KEY = "backup";
    global.fetch = async () => { calls++; return new Response("", { status }); };
    await handler(request(body), response());
    assert.equal(calls, 1, `HTTP ${status} must not consume a second key.`);
  }
});

test("cancellation before a TokenHarbor quota response cannot spend the backup key", async t => {
  let calls = 0;
  const res = response();
  setup(t, async () => {
    calls++;
    res.destroyed = true; res.emit("close");
    return new Response("", { status: 429 });
  });
  delete process.env.OPENROUTER_API_KEY;
  process.env.TOKENHARBOR_API_KEY = "primary"; process.env.TOKENHARBOR_BACKUP_API_KEY = "backup";
  await handler(request({ conversation: "a".repeat(600000), large: metadata }), res);
  assert.equal(calls, 1);
  assert.equal(res.body?.receipt, undefined);
});

clockTest("the TokenHarbor backup shares the original deadline and a limited key recovers after cooldown", { tickMs: 1000, maxElapsedMs: 85000 }, async t => {
  const calls = [];
  setup(t, async (_url, options) => {
    calls.push(options.headers.Authorization);
    if (options.headers.Authorization === "Bearer primary") return new Response("", { status: 429 });
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
  });
  delete process.env.OPENROUTER_API_KEY;
  process.env.TOKENHARBOR_API_KEY = "primary"; process.env.TOKENHARBOR_BACKUP_API_KEY = "backup";
  const body = { conversation: "a".repeat(600000), large: metadata }, first = response(), start = Date.now();
  await handler(request(body), first);
  assert.equal(first.statusCode, 504);
  assert.deepEqual(calls, ["Bearer primary", "Bearer backup"]);
  assert.ok(Date.now() - start <= 75000);
  global.fetch = async (_url, options) => {
    calls.push(options.headers.Authorization);
    return new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }] }));
  };
  const second = response(); await handler(request(body), second);
  assert.equal(second.statusCode, 200);
  assert.equal(calls[2], "Bearer primary", "A 429 is a temporary cooldown, not permanent disablement.");
});

test("rejected or truncated NVIDIA output falls back, while two failures produce no receipt or extra retry", async t => {
  let calls = 0;
  setup(t);
  process.env.TOKENHARBOR_API_KEY = "test-backup";
  process.env.TOKENHARBOR_BACKUP_API_KEY = "must-not-retry";
  const body = { conversation: "a".repeat(600000), large: metadata };
  for (const rejected of [
    { message: { content: "I cannot help with this request." }, finish_reason: "stop" },
    { message: { content: usefulSummary }, finish_reason: "length" }
  ]) {
    global.fetch = async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [calls % 2 ? rejected : { message: { content: usefulSummary }, finish_reason: "stop" }] }));
    };
    const res = response(); await handler(request(body), res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.timing.provider, "tokenharbor");
  }
  assert.equal(calls, 4);
  global.fetch = async () => { calls++; return new Response("private failure", { status: 503 }); };
  const failed = response(); await handler(request(body), failed);
  assert.equal(calls, 6); assert.equal(failed.statusCode, 502);
  assert.equal(failed.body.receipt, undefined); assert.equal(failed.body.summaryProofV3, undefined);
});

clockTest("DeepSeek gets enough time to finish when NVIDIA stalls, inside the shared 75-second deadline", { tickMs: 1000, maxElapsedMs: 80000 }, async t => {
  const calls = [];
  setup(t, async (url, options) => {
    calls.push({ url, signal: options.signal, at: Date.now() });
    if (calls.length === 1) return new Promise((_resolve, reject) => options.signal.addEventListener("abort",
      () => reject(new DOMException("Timeout", "AbortError")), { once: true }));
    await new Promise(resolve => setTimeout(resolve, 50000));
    return new Response(JSON.stringify({ choices: [{ message: { content: usefulSummary }, finish_reason: "stop" }] }));
  });
  process.env.TOKENHARBOR_API_KEY = "test-backup";
  const res = response(), start = Date.now();
  await handler(request({ conversation: "a".repeat(600000), large: metadata }), res);
  assert.equal(res.statusCode, 200); assert.equal(calls.length, 2);
  assert.equal(calls[0].signal.aborted, true);
  assert.ok(calls[1].at - start < 1000, "The backup must not wait for the primary to exhaust its budget.");
  assert.ok(Date.now() - start >= 50000 && Date.now() - start < 75000);
  assert.equal(res.body.timing.provider, "tokenharbor");
  assert.ok(res.body.receipt);
});

clockTest("two silent models cannot exceed the shared deadline or certify partial work", { tickMs: 1000, maxElapsedMs: 80000 }, async t => {
  let calls = 0;
  setup(t, async (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort",
      () => reject(new DOMException("Timeout", "AbortError")), { once: true }));
  });
  process.env.TOKENHARBOR_API_KEY = "test-backup";
  const res = response(), start = Date.now();
  await handler(request({ conversation: "a".repeat(600000), large: metadata }), res);
  assert.equal(calls, 2); assert.equal(res.statusCode, 504);
  assert.equal(res.body.receipt, undefined); assert.ok(Date.now() - start <= 75000);
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

test("native client cancellation aborts both upstream routes without retries", async t => {
  let started, calls = 0;
  const signals = [];
  const pending = new Promise(resolve => { started = resolve; });
  setup(t, async (_url, options) => {
    calls++; signals.push(options.signal); started();
    return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true }));
  });
  process.env.TOKENHARBOR_API_KEY = "test-backup";
  const res = response();
  const work = handler(request({ conversation: "a".repeat(600000), large: metadata }), res);
  await pending; res.destroyed = true; res.emit("close"); await work;
  assert.ok(signals.every(signal => signal.aborted)); assert.equal(res.body?.receipt, undefined);
  assert.equal(calls, 2);
});

clockTest("the large endpoint finishes at its deadline even when upstream adapters ignore abort", { tickMs: 1000, maxElapsedMs: 80000 }, async t => {
  let calls = 0;
  setup(t, () => { calls++; return new Promise(() => {}); });
  process.env.TOKENHARBOR_API_KEY = "test-backup";
  const res = response(), start = Date.now();
  await handler(request({ conversation: "a".repeat(600000), large: metadata }), res);
  assert.equal(calls, 2);
  assert.equal(res.statusCode, 504);
  assert.equal(res.body.code, "summary_timeout");
  assert.equal(res.body.receipt, undefined);
  assert.ok(Date.now() - start <= 75000);
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
  assert.equal(requests[0].max_tokens, 1900, "A short tail still gets answer tokens.");
  assert.equal(requests[1].max_tokens, 10000, "Compact part summaries must not shrink the original large chat's final answer allowance.");
});

test("the NVIDIA beta exception does not change ordinary OpenRouter routing or its data policy", () => {
  const shared = require("../api/summarize").__test;
  const profile = shared.getSummaryProfile("x".repeat(1000000));
  const messages = shared.getInitialSummaryMessages("ordinary chat", profile);
  const model = "nvidia/nemotron-3.5-super-vl:free";
  const ordinary = shared.getProviderRequestBody({ id: "openrouter" }, messages, profile, model);
  assert.equal(ordinary.provider.data_collection, "deny", "The model ID alone cannot opt into collection.");
  assert.equal(ordinary.temperature, 0.1);
  assert.equal(ordinary.top_p, undefined);
  const unrelated = shared.getProviderRequestBody({ id: "openrouter", allowNvidiaDataCollection: true }, messages, profile,
    "dots-studio/dots-3-note-preview:free");
  assert.equal(unrelated.provider.data_collection, "deny");
  assert.equal(unrelated.temperature, 0.1);
  assert.ok(shared.getConfiguredSummaryRoutes({ openrouterApiKey: "test", largeInput: true }).every(route => route.model !== model));
});
