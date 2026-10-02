const assert = require("node:assert/strict");
const test = require("node:test");
const relay = require("../api/telemetry.js");
const { validateTelemetryPayload } = require("../api/telemetry-validation.js");
const { consumeTelemetryRateLimit, resetTelemetryRateLimitForTests } = require("../api/telemetry-rate-limit.js");
const RELAY_KEY = "test-only-private-relay-0123456789abcdef";
const SIGNING_KEY = "test-only-signing-key-0123456789abcdef";
const payload = changes => ({
  attempt_id: "11111111-1111-4111-8111-111111111111", install_id: "22222222-2222-4222-8222-222222222222",
  attempted_at: "2026-10-02T00:00:00.000Z", source_platform: "claude", destination_platform: "chatgpt",
  character_count: 50, status: "succeeded", last_stage: "completed", failure_reason: null, extension_version: "1.4.6", ...changes
});

async function edgeHarness({ error = null, throwRpc = false, stallRpc = false, env = {}, bodyTimeoutMs = 1000, rpcTimeoutMs = 4000 } = {}) {
  const { createTelemetryHandler } = await import("../supabase/functions/transfer-telemetry/handler.mjs");
  const calls = [], logs = [];
  const config = { TELEMETRY_RELAY_SECRET: RELAY_KEY, TELEMETRY_SIGNING_KEY: SIGNING_KEY, SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key", ...env };
  const handler = createTelemetryHandler({
    getEnv: name => config[name], bodyTimeoutMs, rpcTimeoutMs,
    log: (...args) => logs.push(args),
    createClient: (_url, _key, options) => ({ rpc: async (name, args) => {
      calls.push({ name, args, options });
      if (stallRpc) return new Promise(() => {});
      if (throwRpc) throw new Error("PRIVATE_ERROR_BODY");
      return { error };
    } })
  });
  return { calls, logs, handler, send: (body = payload(), headers = {}) => handler(new Request("https://example.invalid/telemetry", {
    method: "POST", headers: { "x-cap-context-relay": RELAY_KEY, "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body)
  })) };
}

function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}

function relayEnv(t) {
  const values = { SUPABASE_TELEMETRY_FUNCTION_URL: "https://example.invalid/telemetry", SUPABASE_TELEMETRY_PUBLISHABLE_KEY: "public-key", TELEMETRY_RELAY_SECRET: RELAY_KEY,
    KV_REST_API_URL: undefined, KV_REST_API_TOKEN: undefined, UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined };
  const previous = Object.fromEntries(Object.keys(values).map(name => [name, process.env[name]]));
  const originalFetch = global.fetch, originalWarn = console.warn;
  for (const [name, value] of Object.entries(values)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  resetTelemetryRateLimitForTests();
  console.warn = () => {};
  t.after(() => {
    global.fetch = originalFetch; console.warn = originalWarn; resetTelemetryRateLimitForTests();
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  });
}

test("Node and Edge validators agree on optional times, strict types and metadata boundaries", async () => {
  const edge = await import("../supabase/functions/transfer-telemetry/validation.mjs");
  for (const changes of [{}, { completed_at: "2026-10-02T00:00:10.000Z" },
    { summary_proof: "0".repeat(64), summary_confirmed_at: "2026-10-02T00:00:05.000Z" },
    { status: "started", last_stage: "capture_completed", completed_at: "2026-10-02T00:00:10.000Z" },
    { character_count: true }, { character_count: "50" }, { character_count: -1 }, { attempted_at: 1 }, { attempted_at: "1" },
    { attempted_at: "2026-02-31T00:00:00.000Z" }, { attempted_at: "2026-10-02T24:00:00.000Z" },
    { completed_at: null }, { summary_confirmed_at: "2026-10-02T00:00:05.000Z" }, { extension_version: "1.2.3+" + "x".repeat(80) },
    { error: "private" }, { summary_verified: true }]) {
    assert.deepEqual(validateTelemetryPayload(payload(changes)), edge.validateTelemetryPayload(payload(changes)), JSON.stringify(changes));
  }
  assert.ok(validateTelemetryPayload(payload({ completed_at: "2026-10-02T05:30:10+05:30" })));
  for (const changes of [{ character_count: true }, { character_count: "50" }, { attempted_at: "1" }, { attempted_at: "2026-02-31T00:00:00.000Z" }, { attempted_at: "2026-10-02T24:00:00.000Z" }, { completed_at: null }, { summary_verified: true }]) assert.equal(validateTelemetryPayload(payload(changes)), null);
});

test("public Supabase credentials cannot reach the privileged writer", async () => {
  const edge = await edgeHarness();
  const response = await edge.send(payload(), { apikey: "public-key", "x-cap-context-relay": "" });
  assert.equal(response.status, 401);
  assert.equal(edge.calls.length, 0);
  const missing = await edgeHarness({ env: { TELEMETRY_RELAY_SECRET: undefined } });
  assert.equal((await missing.send()).status, 503);
  assert.equal(missing.calls.length, 0);
});

test("Edge bounds streamed UTF-8 bytes and body time before SQL", async () => {
  const edge = await edgeHarness({ bodyTimeoutMs: 15 });
  assert.equal((await edge.send("{}", { "content-length": "9999999" })).status, 413);
  assert.equal((await edge.send(JSON.stringify({ value: "🙂".repeat(1500) }))).status, 413);
  assert.equal((await edge.send("{")).status, 400);
  assert.equal((await edge.send(payload(), { "content-type": "text/plain" })).status, 415);
  let cancelled = false;
  const stream = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } });
  const result = await edge.handler(new Request("https://example.invalid/telemetry", { method: "POST", duplex: "half", headers: { "x-cap-context-relay": RELAY_KEY, "content-type": "application/json" }, body: stream }));
  assert.equal(result.status, 408);
  assert.equal(cancelled, true);
  assert.equal(edge.calls.length, 0);
});

test("Edge preserves diagnostic terminal time while server confirmation time requires a v2 receipt", async () => {
  const { createSummaryProof } = await import("../supabase/functions/_shared/summary-proof.mjs");
  const edge = await edgeHarness();
  const terminal = payload({ completed_at: "2026-10-02T00:00:10.000Z" });
  await edge.send(terminal);
  assert.equal(edge.calls[0].args.p_completed_at, terminal.completed_at);
  assert.equal(edge.calls[0].args.p_summary_verified, false);
  assert.equal(edge.calls[0].args.p_summary_confirmed_at, null);
  const confirmed = { ...terminal, summary_confirmed_at: "2026-10-02T00:00:05.000Z" };
  confirmed.summary_proof = await createSummaryProof(confirmed, SIGNING_KEY);
  await edge.send(confirmed);
  assert.equal(edge.calls[1].args.p_summary_verified, true);
  assert.equal(edge.calls[1].args.p_summary_confirmed_at, confirmed.summary_confirmed_at);
});

test("Edge SQL failures have safe permanent/configuration/transient classification", async () => {
  for (const [error, status, code] of [[{ code: "22023", message: "PRIVATE_BODY" }, 422, "attempt_identity_mismatch"],
    [{ code: "23514", details: "PRIVATE_BODY" }, 422, "invalid_payload"], [{ code: "42501" }, 503, "telemetry_unavailable"],
    [{ code: "PGRST202" }, 503, "telemetry_unavailable"], [{ code: "08006", message: "PRIVATE_BODY" }, 503, "telemetry_upstream_unavailable"]]) {
    const edge = await edgeHarness({ error });
    const res = await edge.send();
    assert.equal(res.status, status);
    const body = await res.text();
    assert.equal(JSON.parse(body).code, code);
    assert.doesNotMatch(body + JSON.stringify(edge.logs), /PRIVATE_BODY|test-only|server-only/);
  }
  for (const options of [{ throwRpc: true }, { stallRpc: true, rpcTimeoutMs: 15 }]) {
    const edge = await edgeHarness(options);
    const res = await edge.send();
    assert.equal(res.status, 503);
    assert.equal((await res.json()).code, "telemetry_upstream_unavailable");
    assert.doesNotMatch(JSON.stringify(edge.logs), /PRIVATE_ERROR_BODY/);
  }
});

test("relay carries only normalized metadata and private credentials to actual Edge handler", async t => {
  relayEnv(t);
  const edge = await edgeHarness();
  global.fetch = async (_url, options) => {
    assert.equal(options.headers["X-Cap-Context-Relay"], RELAY_KEY);
    assert.ok(options.signal);
    return edge.handler(new Request("https://example.invalid/telemetry", options));
  };
  const res = response();
  await relay({ method: "POST", headers: { "content-type": "application/json", "x-cap-context-client": "cap-context-extension/1" }, body: payload() }, res);
  assert.equal(res.code, 204);
  assert.equal(edge.calls[0].args.p_summary_verified, false);
});

test("relay preserves permanent payload failures and retries configuration/network failures without leaking bodies", async t => {
  relayEnv(t);
  const request = { method: "POST", headers: { "content-type": "application/json", "x-cap-context-client": "cap-context-extension/1" }, body: payload() };
  for (const [status, code, expectedStatus, expectedCode] of [[422, "attempt_identity_mismatch", 422, "attempt_identity_mismatch"],
    [422, "invalid_summary_proof", 422, "invalid_summary_proof"], [413, "request_too_large", 413, "request_too_large"],
    [401, "relay_not_authorized", 503, "telemetry_unavailable"], [503, "telemetry_unavailable", 503, "telemetry_unavailable"],
    [503, "telemetry_upstream_unavailable", 503, "telemetry_upstream_unavailable"], [400, "PRIVATE_CODE", 503, "telemetry_upstream_unavailable"]]) {
    global.fetch = async () => new Response(JSON.stringify({ code, error: "PRIVATE_BODY" }), { status });
    const res = response(); await relay(request, res);
    assert.equal(res.code, expectedStatus); assert.equal(res.body.code, expectedCode);
    assert.doesNotMatch(JSON.stringify(res.body), /PRIVATE_BODY|PRIVATE_CODE/);
  }
  global.fetch = async () => { throw new Error("PRIVATE_BODY"); };
  const offline = response(); await relay(request, offline);
  assert.equal(offline.body.code, "telemetry_upstream_unavailable");
  global.fetch = async () => new Response("{}", { status: 429, headers: { "retry-after": "90" } });
  const throttled = response(); await relay(request, throttled);
  assert.equal(throttled.code, 429); assert.equal(throttled.headers["retry-after"], "90");
});

test("relay times out both stalled headers and stalled error bodies before the worker deadline", async t => {
  relayEnv(t);
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, ms, ...args) => originalSetTimeout(callback, ms === 5000 ? 20 : ms, ...args);
  t.after(() => { global.setTimeout = originalSetTimeout; });
  for (const stalledBody of [false, true]) {
    let signal;
    global.fetch = async (_url, options) => {
      signal = options.signal;
      if (!stalledBody) return new Promise(() => {});
      return new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }), { status: 503 });
    };
    const res = response();
    await relay({ method: "POST", headers: { "content-type": "application/json", "x-cap-context-client": "cap-context-extension/1" }, body: payload() }, res);
    assert.equal(res.code, 503); assert.equal(res.body.code, "telemetry_upstream_unavailable"); assert.equal(signal.aborted, true);
  }
});

test("distributed limiter is atomic across invocation state, hashes identifiers and expires every budget", async () => {
  const counts = new Map(), commands = [];
  const env = { KV_REST_API_URL: "https://example.invalid/redis", KV_REST_API_TOKEN: "test-private-redis-key", TELEMETRY_RELAY_SECRET: RELAY_KEY };
  const fetchImpl = async (_url, options) => {
    const command = JSON.parse(options.body); commands.push(command);
    assert.equal(command[0], "EVAL");
    const count = command[2], keys = command.slice(3, 3 + count), args = command.slice(3 + count);
    for (let i = 0; i < count; i++) {
      if ((counts.get(keys[i]) || 0) >= Number(args[i * 3])) return Response.json({ result: [0, args[i * 3 + 2]] });
      assert.ok(args[i * 3 + 1] > 0 && args[i * 3 + 1] <= 86402);
    }
    for (const key of keys) counts.set(key, (counts.get(key) || 0) + 1);
    return Response.json({ result: [1, 0] });
  };
  const req = { headers: { "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "attacker-spoof" } };
  for (let i = 0; i < 180; i++) {
    resetTelemetryRateLimitForTests();
    assert.equal((await consumeTelemetryRateLimit(req, payload(), { env, now: 1000, fetchImpl })).allowed, true);
  }
  const blocked = await consumeTelemetryRateLimit(req, payload(), { env, now: 1000, fetchImpl });
  assert.equal(blocked.allowed, false); assert.equal(blocked.tracking, "shared"); assert.equal(blocked.retryAfterSeconds, 59);
  assert.doesNotMatch(JSON.stringify(commands), /203\.0\.113\.7|attacker-spoof|22222222-2222|test-private-redis-key/);
  assert.equal((await consumeTelemetryRateLimit(req, payload(), { env, now: 61000, fetchImpl })).allowed, true);
  const command = commands.at(-1), count = command[2], keys = command.slice(3, 3 + count), args = command.slice(3 + count);
  assert.equal(keys.length, 7);
  assert.equal(args[5 * 3], 60000); assert.equal(args[6 * 3], 200000);
  counts.set(keys[5], 60000);
  const before = new Map(counts);
  assert.equal((await consumeTelemetryRateLimit(req, payload(), { env, now: 61000, fetchImpl })).allowed, false);
  assert.deepEqual(counts, before, "a rejected global budget cannot consume any installation or IP budget");
  counts.set(keys[5], 0); counts.set(keys[6], 200000);
  const daily = await consumeTelemetryRateLimit(req, payload(), { env, now: 61000, fetchImpl });
  assert.equal(daily.allowed, false); assert.equal(daily.retryAfterSeconds, 86339);
});

test("Redis failures/timeouts fall back to bounded local limits without losing all telemetry", async () => {
  resetTelemetryRateLimitForTests();
  const logs = [], env = { KV_REST_API_URL: "https://example.invalid/redis", KV_REST_API_TOKEN: "private" };
  const options = { env, now: 1000, fetchImpl: async () => { throw new Error("PRIVATE_STORE_ERROR"); }, log: (...args) => logs.push(args) };
  for (let i = 0; i < 180; i++) assert.equal((await consumeTelemetryRateLimit({}, payload(), options)).allowed, true);
  assert.equal((await consumeTelemetryRateLimit({}, payload(), options)).allowed, false);
  assert.equal(logs.length, 1); assert.doesNotMatch(JSON.stringify(logs), /PRIVATE_STORE_ERROR/);
  resetTelemetryRateLimitForTests();
  const timeout = await consumeTelemetryRateLimit({}, payload(), { ...options, timeoutMs: 10, fetchImpl: async () => new Promise(() => {}) });
  assert.equal(timeout.allowed, true); assert.equal(timeout.tracking, "local");
  resetTelemetryRateLimitForTests();
});
