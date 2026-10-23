const assert = require("node:assert/strict");
const test = require("node:test");
const handler = require("../api/summarize");
const { resetRequestSecurityForTests } = require("../api/request-security");
const { clockTest } = require("./helpers/clock");
const { createSummaryWithFallback, getSummaryProfile, getConfiguredSummaryRoutes, getSummarySystemPrompt } = handler.__test;
const DOTS = "dots-studio/dots-3-note-preview:free";
const DEEPSEEK = "deepseek-v4.1-flash:free";
const keys = { openrouterApiKey: "TEST_ONLY_ROUTER", tokenharborApiKey: "TEST_ONLY_HARBOR",
  tokenharborBackupApiKey: "TEST_ONLY_BACKUP", geminiApiKey: "TEST_ONLY_GOOGLE", mistralApiKey: "TEST_ONLY_MISTRAL" };
const answer = "Keep the accepted configuration. Linux testing remains pending. Do not deploy.";
const jsonAnswer = () => Response.json({ choices: [{ message: { content: answer }, finish_reason: "stop" }] });

function configure(t) {
  const env = { OPENROUTER_ENABLED: "true", OPENROUTER_DOTS_ENABLED: "true", OPENROUTER_QWEN_ENABLED: "true",
    OPENROUTER_GEMMA_ENABLED: "true", MISTRAL_ENABLED: "true", OPENROUTER_API_KEY: keys.openrouterApiKey,
    TOKENHARBOR_API_KEY: keys.tokenharborApiKey, TOKENHARBOR_BACKUP_API_KEY: keys.tokenharborBackupApiKey,
    GEMINI_API_KEY: keys.geminiApiKey, MISTRAL_API_KEY: keys.mistralApiKey };
  const saved = Object.keys(env).map(name => [name, process.env[name]]);
  Object.assign(process.env, env);
  const fetch = global.fetch;
  t.after(() => { global.fetch = fetch; for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  } });
}
function run(conversation = "x".repeat(500000), requestContext = {}) {
  return createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation), ...keys, requestContext });
}
function streamAnswer(firstMs, endMs, signal) {
  const encoder = new TextEncoder();
  let first, end, onAbort;
  const cleanup = () => { clearTimeout(first); clearTimeout(end); signal?.removeEventListener("abort", onAbort); };
  return new Response(new ReadableStream({
    start(controller) {
      // A mock Response must mirror native fetch: aborting its request also
      // interrupts a pending body read, rather than waiting for another chunk.
      onAbort = () => { cleanup(); controller.error(signal.reason); };
      signal?.addEventListener("abort", onAbort, { once: true });
      first = setTimeout(() => controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}\n\n`)), firstMs);
      end = setTimeout(() => { cleanup(); controller.enqueue(encoder.encode('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')); controller.close(); }, endMs);
    },
    cancel: cleanup
  }), { headers: { "content-type": "text/event-stream" } });
}

test("350k keeps its profile and prompt; only larger input gains output headroom", () => {
  const old = getSummaryProfile("x".repeat(350000));
  for (const length of [350001, 500000, 1000000]) {
    const large = getSummaryProfile("x".repeat(length));
    assert.equal(large.maxTokens, 10000);
    assert.deepEqual({ ...large, maxTokens: 7000 }, old);
    assert.equal(getSummarySystemPrompt(large), getSummarySystemPrompt(old));
  }
  assert.equal(old.maxTokens, 7000);
});

test("large chats select only Dots and one TokenHarbor key, respecting disabled/missing gateways", t => {
  configure(t);
  const routes = options => getConfiguredSummaryRoutes({ ...keys, largeInput: true, ...options });
  assert.deepEqual(routes().map(route => [route.model, route.apiKey]), [[DOTS, keys.openrouterApiKey], [DEEPSEEK, keys.tokenharborApiKey]]);
  assert.deepEqual(routes({ tokenharborApiKey: undefined }).map(route => route.apiKey), [keys.openrouterApiKey, keys.tokenharborBackupApiKey]);
  process.env.OPENROUTER_DOTS_ENABLED = "false";
  assert.deepEqual(routes().map(route => route.model), [DEEPSEEK]);
  assert.deepEqual(routes({ tokenharborEnabled: false }), []);
  assert.ok(getConfiguredSummaryRoutes(keys).some(route => route.provider.id === "gemini"));
});

for (const failure of ["http", "network", "empty"]) test(`large chats try each gateway once after ${failure} failure`, async t => {
  configure(t);
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body), key: options.headers.Authorization });
    if (calls.length === 1) {
      if (failure === "network") throw new TypeError("fetch failed");
      return failure === "http" ? new Response(null, { status: 503 }) : Response.json({ choices: [{ message: { content: "" } }] });
    }
    return jsonAnswer();
  };
  const result = await run();
  assert.deepEqual(calls.map(call => call.body.model), [DOTS, DEEPSEEK]);
  assert.equal(calls[0].body.max_tokens, 10000);
  assert.equal(calls[1].body.max_tokens, 18192, "Retain the existing separate DeepSeek reasoning allowance");
  assert.equal(calls[1].key, `Bearer ${keys.tokenharborApiKey}`);
  assert.equal(result.provider, "tokenharbor");
  assert.equal(result.fallback.used, true);
});

test("exhausted large-chat gateways preserve the full transcript through existing exact recovery", async t => {
  configure(t);
  const conversation = "BEGIN\n" + "x".repeat(999980) + "\nEND";
  let calls = 0;
  global.fetch = async () => { calls++; return new Response(null, { status: 503 }); };
  const result = await run(conversation);
  assert.equal(calls, 2);
  assert.equal(result.provider, "local-direct");
  assert.deepEqual(result.modelsTried, [DOTS, DEEPSEEK]);
  assert.ok(result.summary.includes(conversation.split("\n").map(line => `> ${line}`).join("\n")));
});

for (const provider of ["openrouter", "tokenharbor"]) clockTest(`${provider} can start its large-chat answer after 80 seconds`,
  { tickMs: 100, maxElapsedMs: 100000 }, async t => {
    configure(t);
    let calls = 0;
    global.fetch = async (_url, { signal }) => {
      calls++;
      if (provider === "tokenharbor" && calls === 1) return new Response(null, { status: 503 });
      return streamAnswer(80000, 85000, signal);
    };
    const result = await run(undefined, { onDelta() {} });
    assert.equal(result.provider, provider);
    assert.equal(calls, provider === "openrouter" ? 1 : 2);
  });

clockTest("a stalled 90-second Dots completion leaves TokenHarbor its own full 90-second window",
  { tickMs: 100, maxElapsedMs: 185000 }, async t => {
    configure(t);
    const failures = [];
    let calls = 0;
    global.fetch = async (_url, { signal }) => ++calls === 1 ? streamAnswer(5000, 100000, signal) : streamAnswer(80000, 85000, signal);
    const result = await run(undefined, { onDelta() {}, onProviderFailure: value => failures.push(value) });
    assert.equal(calls, 2);
    assert.equal(result.provider, "tokenharbor");
    assert.equal(failures.length, 1);
    assert.equal(failures[0].request_attempt, 1);
    assert.equal(failures[0].budget_ms, 90000);
    assert.equal(failures[0].timeout_kind, "completion");
    assert.ok(result.openrouterMs >= 90000 && result.openrouterMs < 90500);
    assert.ok(result.tokenharborMs >= 85000 && result.tokenharborMs < 85500);
  });

test("the endpoint accepts a million-character structured Unicode conversation without changing turns", async t => {
  configure(t);
  resetRequestSecurityForTests();
  const overhead = "ChatGPT conversation:\n\nUser: ".length;
  const messages = [{ role: "user", text: "漢".repeat(1000000 - overhead) }];
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.equal(body.model, DOTS);
    assert.equal(body.max_tokens, 10000);
    assert.deepEqual(JSON.parse(body.messages[1].content).messages, messages);
    return jsonAnswer();
  };
  const response = { statusCode: 200, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.payload = value; } };
  await handler({ method: "POST", headers: { origin: `chrome-extension://${"a".repeat(32)}`, "content-type": "application/json" },
    body: JSON.stringify({ platform: "ChatGPT", messages }) }, response);
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.timing.inputChars, 1000000);
  assert.equal(response.payload.timing.model, DOTS);
  assert.equal(calls, 1);
});
