const assert = require("node:assert/strict");
const test = require("node:test");
const location = require("../supabase/functions/_shared/request-location");
const relay = require("../api/telemetry");
const { validateTelemetryPayload } = require("../api/telemetry-validation");
const { resetTelemetryRateLimitForTests } = require("../api/telemetry-rate-limit");
const unknown = { country: "unknown", region: "unknown", city: "unknown" };
const payload = { attempt_id: "11111111-1111-4111-8111-111111111111", install_id: "22222222-2222-4222-8222-222222222222",
  attempted_at: "2026-10-31T10:00:00.000Z", source_platform: "claude", destination_platform: "chatgpt", character_count: 500,
  status: "started", last_stage: "capture_started", failure_reason: null, extension_version: "1.4.36" };

test("Vercel location decodes city once and independently replaces unsafe or absent hints", () => {
  const read = headers => location.fromHeaders(name => headers[name] || "");
  assert.deepEqual(read({}), unknown);
  for (const city of ["São Paulo", "Zürich", "東京", "हैदराबाद", "A+B"]) {
    assert.deepEqual(read({ "x-vercel-ip-country": "BR", "x-vercel-ip-country-region": "SP", "x-vercel-ip-city": encodeURIComponent(city) }),
      { country: "BR", region: "SP", city });
  }
  for (const city of ["%E0%A4%A", "%2520", "x".repeat(81), "City%0ASecret", "192.0.2.5", "IP 192.0.2.5", "City%20https%3A%2F%2Fsecret"]) {
    assert.deepEqual(read({ "x-vercel-ip-country": "IN", "x-vercel-ip-city": city }), { country: "IN", region: "unknown", city: "unknown" });
  }
  assert.equal(location.validate({ ...unknown, country: "US\n" }), null);
  assert.equal(location.validate({ ...unknown, region: "SP\n" }), null);
  assert.equal(location.validate({ ...unknown, latitude: "12.3" }), null);
});

test("relay and authenticated Edge put only coarse header location into transfer diagnostics", async t => {
  const saved = { ...process.env }, originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(saved, key)) delete process.env[key];
    Object.assign(process.env, saved); resetTelemetryRateLimitForTests();
  });
  const secret = "test-location-relay-secret-0123456789abcdef";
  Object.assign(process.env, { SUPABASE_TELEMETRY_FUNCTION_URL: "https://edge.invalid/telemetry",
    SUPABASE_TELEMETRY_PUBLISHABLE_KEY: "test-public", TELEMETRY_RELAY_SECRET: secret });
  for (const key of ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete process.env[key];
  resetTelemetryRateLimitForTests();
  const { createTelemetryHandler } = await import("../supabase/functions/transfer-telemetry/handler.mjs");
  const calls = [], bodies = [];
  const edge = createTelemetryHandler({ getEnv: name => ({ TELEMETRY_RELAY_SECRET: secret, SUPABASE_URL: "https://db.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "test-service" })[name],
    createClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; } }) });
  global.fetch = async (url, options) => { bodies.push(JSON.parse(options.body)); return edge(new Request(url, options)); };
  const send = async (body, headers = {}) => {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, end() {}, json() {} };
    await relay({ method: "POST", body, headers: { "content-type": "application/json", "x-cap-context-client": "cap-context-extension/1", ...headers } }, res);
    return res.code;
  };
  const diagnostic = { version: 1, capture_method: "structured" };
  assert.equal(await send({ ...payload, diagnostics: diagnostic }, { "X-Vercel-IP-Country": "BR", "x-vercel-ip-country-region": "SP",
    "x-vercel-ip-city": "S%C3%A3o%20Paulo", "x-forwarded-for": "192.0.2.5", "x-vercel-ip-latitude": "12.3456", "x-vercel-ip-longitude": "65.4321" }), 204);
  assert.equal(calls[0].name, "record_transfer_event");
  assert.deepEqual(calls[0].args.p_diagnostics, { ...diagnostic, location: { country: "BR", region: "SP", city: "São Paulo" } });
  assert.doesNotMatch(JSON.stringify(bodies), /192\.0\.2\.5|12\.3456|65\.4321|latitude|longitude|S%C3/);
  assert.equal(await send(payload), 204);
  assert.deepEqual(calls[1].args.p_diagnostics, { version: 1, location: unknown });
  // The public/client contract remains closed, even for a syntactically valid forgery.
  assert.equal(validateTelemetryPayload({ ...payload, diagnostics: { version: 1, location: unknown } }), null);
  assert.equal(await send({ ...payload, diagnostics: { version: 1, location: unknown } }), 400);
  assert.equal(calls.length, 2);
  for (const value of [{ ...unknown, ip: "192.0.2.5" }, { ...unknown, city: "192.0.2.5" }, { ...unknown, city: "x".repeat(81) }]) {
    const rejected = await edge(new Request("https://edge.invalid/telemetry", { method: "POST",
      headers: { "content-type": "application/json", "x-cap-context-relay": secret },
      body: JSON.stringify({ ...payload, diagnostics: { version: 1, location: value } }) }));
    assert.equal(rejected.status, 400);
  }
  assert.equal(calls.length, 2);
});
