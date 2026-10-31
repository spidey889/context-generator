const test = require("node:test");
const assert = require("node:assert/strict");
const { createProviderFailureLog } = require("../api/provider-failure-log");
const schema = require("../supabase/functions/_shared/provider-failure");
const { createSummaryWithFallback, getSummaryProfile } = require("../api/summarize").__test;
const { createSummaryWithProvider, getInitialSummaryMessages } = require("../api/summarize").__test;
const event = changes => ({ id: "11111111-1111-4111-8111-111111111111", request_id: "22222222-2222-4222-8222-222222222222",
  occurred_at: "2026-10-23T00:00:00.000Z", environment: "development", provider: "tokenharbor", model: "deepseek-v4.1-flash:free",
  failure_reason: "provider_timeout", phase: "waiting_answer", timeout_kind: "first_answer", route_index: 2,
  request_attempt: 1, input_chars: 39955, request_bytes: 45000, max_output_tokens: 10092,
  elapsed_ms: 45000, budget_ms: 45000, reasoning_chars: 2000, ...changes });
function configure(t) {
  for (const [key, value] of Object.entries({ SUPABASE_TELEMETRY_FUNCTION_URL: "https://edge.invalid/failures",
    SUPABASE_TELEMETRY_PUBLISHABLE_KEY: "PUBLIC_TEST", TELEMETRY_RELAY_SECRET: "TEST_ONLY_PRIVATE_RELAY_0123456789abcdef" })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous);
  }
}

test("provider rejection logs keep the specific cause without rejected output", async t => {
  const previous = global.fetch;
  t.after(() => { global.fetch = previous; });
  const conversation = "User: Prepare the library review.\n".repeat(400), profile = getSummaryProfile(conversation);
  for (const [payload, detail] of [[null, "response_shape_invalid"],
    [{ choices: [{ message: { content: "" } }] }, "empty_answer"],
    [{ choices: [{ message: { content: "..." } }] }, "empty_content"],
    [{ choices: [{ message: { content: "I cannot help summarize this conversation." } }] }, "refusal_only"],
    [{ choices: [{ message: { content: "<think>PRIVATE" } }] }, "unfinished_thinking"]]) {
    const observations = [];
    global.fetch = async () => new Response(JSON.stringify(payload));
    await assert.rejects(createSummaryWithProvider({ provider: { id: "openrouter", label: "OpenRouter", url: "https://provider.invalid" },
      model: "dots-studio/dots-3-note-preview:free", apiKey: "PRIVATE", profile,
      initialMessages: getInitialSummaryMessages(conversation, profile), requestBudgetMs: 1000,
      requestContext: { onProviderFailure: observation => observations.push(observation) } }));
    assert.equal(observations.length, 1);
    assert.equal(observations[0].failure_detail, detail);
    assert.doesNotMatch(JSON.stringify(observations), /PRIVATE/);
  }
});

test("provider failure schema rejects private content, invalid limits and mismatched models", () => {
  assert.ok(schema.validate(event()));
  for (const changes of [{ error: "PRIVATE_BODY" }, { prompt: "PRIVATE_CHAT" }, { reasoning: "PRIVATE_THINKING" },
    { elapsed_ms: -1 }, { max_output_tokens: 0 }, { phase: "https://private.invalid" }, { provider: "gemini" },
    { request_attempt: 3 }, { input_chars: 1000001 }, { occurred_at: "2026-02-31T00:00:00.000Z" },
    { failure_reason: "provider_empty", timeout_kind: "completion" }]) assert.equal(schema.validate(event(changes)), null);
});

test("failure writes retry the same ID, overlap fallback work and flush before shutdown", async t => {
  configure(t);
  const calls = [];
  let release;
  const recorder = createProviderFailureLog({ attemptId: "33333333-3333-4333-8333-333333333333", fetchImpl: async (_url, options) => {
    calls.push(JSON.parse(options.body));
    if (calls.length === 1) return new Response(null, { status: 503 });
    return new Promise(resolve => { release = () => resolve(new Response(null, { status: 204 })); });
  } });
  recorder.record(event());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  let finished = false;
  const flush = recorder.flush().then(() => { finished = true; });
  await Promise.resolve(); assert.equal(finished, false);
  release(); await flush; assert.equal(finished, true);
});

test("provider logging does not mistake HTTP 200 or 202 for a committed observation", async t => {
  configure(t);
  for (const status of [200, 202]) {
    const calls = [], warnings = [];
    const recorder = createProviderFailureLog({ attemptId: "33333333-3333-4333-8333-333333333333",
      warn: (...args) => warnings.push(args), fetchImpl: async (_url, options) => {
        calls.push(JSON.parse(options.body));
        return new Response(null, { status });
      } });
    recorder.record(event());
    await recorder.flush();
    assert.equal(warnings.length, 1, "An unconfirmed write must produce the fixed delivery warning.");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], calls[1]);
  }
});

test("provider logging's bounded capacity emits one fixed warning when observations are dropped", async t => {
  configure(t);
  const warnings = [];
  const recorder = createProviderFailureLog({ attemptId: "33333333-3333-4333-8333-333333333333",
    fetchImpl: async () => new Response(null, { status: 204 }), warn: (...args) => warnings.push(args) });
  for (let i = 0; i < 18; i++) recorder.record(event());
  await recorder.flush();
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][1].reason, "capacity_reached");
});

test("logging outages, stalled transports and rejected auth never block or expose bodies", async t => {
  configure(t);
  for (const status of [401, 500, null]) {
    const warnings = [], calls = [];
    const recorder = createProviderFailureLog({ attemptId: "33333333-3333-4333-8333-333333333333", timeoutMs: 15, warn: (...args) => warnings.push(args),
      fetchImpl: async (_url, options) => { calls.push(options); return status === null ? new Promise(() => {})
        : new Response("PRIVATE_PROVIDER_BODY", { status }); } });
    recorder.record(event()); await recorder.flush();
    if (status === null) assert.ok(calls.length >= 1 && calls.length <= 2);
    else assert.equal(calls.length, status === 401 ? 1 : 2);
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(JSON.stringify(warnings), /PRIVATE_PROVIDER_BODY|PRIVATE_RELAY/);
    if (status === null) assert.equal(calls[0].signal.aborted, true);
  }
});

test("the private Edge writer accepts failure logs but rejects spoofed or expanded records", async () => {
  const { createTelemetryHandler } = await import("../supabase/functions/transfer-telemetry/handler.mjs");
  const calls = [];
  const secret = "TEST_ONLY_PRIVATE_RELAY_0123456789abcdef";
  const handler = createTelemetryHandler({ getEnv: name => ({ TELEMETRY_RELAY_SECRET: secret,
    SUPABASE_URL: "https://db.invalid", SUPABASE_SERVICE_ROLE_KEY: "TEST_ONLY" })[name],
    createClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; } }) });
  const send = (body, relay = secret) => handler(new Request("https://edge.invalid", { method: "POST",
    headers: { "content-type": "application/json", "x-cap-context-relay": relay }, body: JSON.stringify(body) }));
  assert.equal((await send({ kind: "provider_failure", event: event() }, "wrong")).status, 401);
  assert.equal((await send({ kind: "provider_failure", event: event({ message: "PRIVATE_CHAT" }) })).status, 400);
  assert.equal((await send({ kind: "provider_failure", event: event(), extra: true })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await send({ kind: "provider_failure", event: event() })).status, 204);
  assert.deepEqual(calls[0], { name: "record_provider_failure", args: { p_event: event() } });
});

for (const answerStarted of [false, true]) test(`provider timeout records ${answerStarted ? "answer stall" : "thinking wait"} before successful fallback`, async t => {
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const observations = [];
  const conversation = "User: Keep the library quiet. Prepare the review.\n".repeat(250);
  global.fetch = async (url, options) => {
    if (!url.includes("tokenharbor")) return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "The library must remain quiet. Prepare the review." }] }, finishReason: "STOP" }]
    }));
    let reads = 0;
    return { ok: true, status: 200, headers: new Headers({ "content-type": "text/event-stream" }), body: { getReader: () => ({
      async read() {
        if (reads++ === 0) return { done: false, value: new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ index: 0,
          delta: answerStarted ? { content: "Partial library answer." } : { reasoning_content: "PRIVATE_THINKING" } }] })}\n\n`) };
        t.mock.timers.setTime(Date.now() + (answerStarted ? 90000 : 45000));
        throw Object.assign(new Error("aborted"), { name: "AbortError" });
      }, cancel: async () => {}, releaseLock() {}
    }) } };
  };
  const result = await createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation),
    tokenharborApiKey: "TEST_ONLY", geminiApiKey: "TEST_ONLY", requestContext: { onDelta() {},
      onProviderFailure: observation => observations.push(observation) } });
  assert.equal(result.model, "gemini-3.6-flash");
  const failures = observations.filter(entry => entry.failure_reason !== "provider_skipped");
  assert.equal(failures.length, 1);
  const observation = failures[0];
  assert.equal(observation.failure_reason, "provider_timeout");
  assert.equal(observation.phase, answerStarted ? "answer_stream" : "waiting_answer");
  assert.equal(observation.timeout_kind, answerStarted ? "completion" : "first_answer");
  assert.equal(observation.first_answer_budget_ms, 45000);
  assert.equal(observation.max_output_tokens, 10092);
  assert.equal(observation.http_status, 200);
  assert.equal(observation.stream_chunks, 1);
  if (answerStarted) assert.equal(observation.answer_chars, "Partial library answer.".length);
  else assert.equal(observation.reasoning_chars, "PRIVATE_THINKING".length);
  assert.doesNotMatch(JSON.stringify(observation), /PRIVATE_THINKING|Partial library|TEST_ONLY|Keep the library/);
});

test("empty output exhausted by thinking retains actual tokens and the length finish reason", async t => {
  const originalFetch = global.fetch; t.after(() => { global.fetch = originalFetch; });
  const observations = [];
  const conversation = "User: Keep the library quiet. Prepare the review.\n".repeat(250);
  global.fetch = async url => url.includes("tokenharbor") ? new Response(JSON.stringify({
    choices: [{ message: { content: "", reasoning_content: "PRIVATE_THINKING" }, finish_reason: "length" }],
    usage: { prompt_tokens: 4200, completion_tokens: 10092, completion_tokens_details: { reasoning_tokens: 10092 } }
  })) : new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "The quiet library is ready for review." }] }, finishReason: "STOP" }] }));
  const result = await createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation),
    tokenharborApiKey: "TEST_ONLY", geminiApiKey: "TEST_ONLY", requestContext: { onProviderFailure: value => observations.push(value) } });
  assert.equal(result.model, "gemini-3.6-flash");
  const failures = observations.filter(entry => entry.failure_reason !== "provider_skipped");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].failure_reason, "provider_empty");
  assert.equal(failures[0].finish_reason, "length");
  assert.equal(failures[0].completion_tokens, 10092);
  assert.equal(failures[0].reasoning_tokens, 10092);
  assert.equal(failures[0].answer_chars, 0);
  assert.doesNotMatch(JSON.stringify(observations), /PRIVATE_THINKING|TEST_ONLY/);
});

test("summary callers without transfer identity do not create unrelated diagnosis records", async t => {
  configure(t);
  const env = { OPENROUTER_API_KEY: "TEST_ONLY", TOKENHARBOR_API_KEY: undefined, TOKENHARBOR_BACKUP_API_KEY: undefined,
    GEMINI_API_KEY: undefined, MISTRAL_API_KEY: undefined, OPENROUTER_ENABLED: "true",
    OPENROUTER_DOTS_ENABLED: "true", OPENROUTER_QWEN_ENABLED: "false", OPENROUTER_GEMMA_ENABLED: "false" };
  for (const [name, value] of Object.entries(env)) {
    const old = process.env[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value;
    t.after(() => old === undefined ? delete process.env[name] : process.env[name] = old);
  }
  const oldFetch = global.fetch; t.after(() => { global.fetch = oldFetch; });
  let recorded, sent = false;
  global.fetch = async (url, options) => {
    if (url.includes("edge.invalid")) {
      recorded = JSON.parse(options.body).event;
      return new Response(null, { status: 204 });
    }
    return new Response("PRIVATE_PROVIDER_BODY", { status: 401 });
  };
  const res = { setHeader() {}, status() { return this; }, json() { sent = true; return this; } };
  const done = require("../api/summarize")({ method: "POST", headers: { "content-type": "application/json", "x-cap-context-client": "cap-context-extension/1" },
    body: { conversation: "User: Prepare the quiet library for review.\n".repeat(300) } }, res);
  await done;
  assert.equal(recorded, undefined);
  assert.equal(sent, true);
});

test("HTTP-200 upstream errors retain safe status, type and request identity", async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; });
  global.fetch = async () => new Response(JSON.stringify({ error: { code: 429, type: "rate_limit_error", message: "PRIVATE prompt" } }),
    { headers: { "x-request-id": "req_abcdefgh1234" } });
  const observed = [];
  const { createSummaryWithProvider, getSummaryProfile } = require("../api/summarize").__test;
  await assert.rejects(createSummaryWithProvider({ provider: { id: "openrouter", label: "OpenRouter", url: "https://provider.invalid" },
    apiKey: "TEST_ONLY", model: "dots-studio/dots-3-note-preview:free", profile: getSummaryProfile("x".repeat(10000)),
    initialMessages: [{ role: "user", content: "PRIVATE" }], requestBudgetMs: 1000,
    requestContext: { maxAttempts: 1, inputChars: 10000, onProviderFailure: value => observed.push(value) } }));
  assert.equal(observed.length, 1); assert.equal(observed[0].http_status, 200);
  assert.equal(observed[0].upstream_code, "429"); assert.equal(observed[0].upstream_request_id, "req_abcdefgh1234");
  assert.doesNotMatch(JSON.stringify(observed), /PRIVATE|TEST_ONLY/);
});

test("missing keys and budget refusal produce one skip per reached provider without HTTP work", async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; });
  global.fetch = () => assert.fail("Missing credentials or a refused budget must not contact a provider");
  const conversation = "User: Prepare the quiet library review.\n".repeat(300), observed = [];
  await createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation),
    geminiApiKey: "PRIVATE", mistralApiKey: "PRIVATE", tokenharborEnabled: true,
    requestContext: { reserveFunded: async () => false, onProviderFailure: entry => observed.push(entry) } });
  assert.deepEqual(observed.map(entry => [entry.provider, entry.skip_reason]), [
    ["openrouter", "missing_key"], ["tokenharbor", "missing_key"], ["gemini", "funded_budget_refused"], ["mistral", "funded_budget_refused"]
  ]);
  for (const entry of observed) {
    assert.equal(entry.request_attempt, 0);
    const sample = event({ ...entry, timeout_kind: undefined }); delete sample.timeout_kind;
    assert.ok(schema.validate(sample));
  }
  assert.doesNotMatch(JSON.stringify(observed), /PRIVATE|quiet library/);
});

test("an exhausted free window logs one skipped TokenHarbor provider and preserves funded fallback", async t => {
  const original = global.fetch; t.after(() => { global.fetch = original; });
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  const observed = [], calls = [], conversation = "User: Prepare the library review.\n".repeat(350);
  global.fetch = async url => {
    calls.push(url);
    if (url.includes("openrouter")) {
      t.mock.timers.setTime(Date.now() + 90000);
      return new Response(null, { status: 429 });
    }
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Prepare the library review." }] }, finishReason: "STOP" }] }));
  };
  const result = await createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation),
    openrouterApiKey: "PRIVATE", tokenharborApiKey: "PRIVATE", tokenharborBackupApiKey: "PRIVATE_BACKUP", geminiApiKey: "PRIVATE",
    requestContext: { onProviderFailure: entry => observed.push(entry) } });
  assert.equal(result.provider, "gemini");
  assert.equal(calls.length, 2);
  assert.ok(!calls.some(url => url.includes("tokenharbor")));
  assert.deepEqual(observed.filter(entry => entry.failure_reason === "provider_skipped").map(entry => [entry.provider, entry.skip_reason]),
    [["tokenharbor", "route_budget_exhausted"]]);
});
