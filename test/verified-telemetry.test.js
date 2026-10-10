const assert = require("node:assert/strict");
const test = require("node:test");
const summarize = require("../api/summarize.js");
const { withFundedBudget } = require("./helpers/funded-budget");
const telemetry = require("../api/telemetry.js");
const { validateTelemetryPayload } = require("../api/telemetry-validation.js");
const KEY = "test-only-signing-key-0123456789abcdef";
const RELAY_KEY = "test-only-relay-key-0123456789abcdef";
const payload = (changes = {}) => ({
  attempt_id: "11111111-1111-4111-8111-111111111111",
  install_id: "22222222-2222-4222-8222-222222222222",
  attempted_at: "2026-10-02T00:00:00.000Z",
  source_platform: "claude", destination_platform: "chatgpt",
  character_count: 50, status: "succeeded", last_stage: "completed",
  failure_reason: null, extension_version: "1.4.6", ...changes
});
const response = () => ({
  setHeader() {}, status(code) { this.code = code; return this; },
  json(body) { this.body = body; return this; }, end() { return this; }
});
async function proofHelpers() { return import("../supabase/functions/_shared/summary-proof.mjs"); }
async function edgeHarness(secret = KEY) {
  const { createTelemetryHandler } = await import("../supabase/functions/transfer-telemetry/handler.mjs");
  const calls = [];
  const handler = createTelemetryHandler({
    getEnv: name => ({ TELEMETRY_RELAY_SECRET: RELAY_KEY, SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "server-only-test-key", TELEMETRY_SIGNING_KEY: secret })[name],
    log() {},
    createClient: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { error: null }; } })
  });
  return {
    calls,
    async send(body) {
      return handler(new Request("https://example.invalid/telemetry", {
        method: "POST", headers: { "x-cap-context-relay": RELAY_KEY, "Content-Type": "application/json" }, body: JSON.stringify(body)
      }));
    }
  };
}

test("observed models survive missing receipts without granting server verification", async () => {
  const { LEGACY_RECEIPT_MODELS, createSummaryProof } = await proofHelpers();
  const edge = await edgeHarness();
  for (const reported_model of LEGACY_RECEIPT_MODELS) {
    const report = payload({ reported_model });
    assert.equal(validateTelemetryPayload(report).reported_model, reported_model);
    assert.equal((await edge.send(report)).status, 204);
    assert.equal(edge.calls.at(-1).args.p_reported_model, reported_model);
    assert.equal(edge.calls.at(-1).args.p_model, null);
    assert.equal(edge.calls.at(-1).args.p_summary_verified, false);
    assert.equal(edge.calls.at(-1).args.p_summary_confirmed_at, null);
  }
  for (const change of [{ reported_model: "PRIVATE_TEXT_SENTINEL" },
    { reported_model: null }, { status: "started", last_stage: "capture_started" }]) {
    const report = payload({ reported_model: "local-direct", ...change });
    assert.equal(validateTelemetryPayload(report), null);
    assert.equal((await edge.send(report)).status, 400);
  }
  const signed = payload({ model: "gemini-3.5-flash-lite", reported_model: "local-direct",
    summary_confirmed_at: "2026-10-02T00:00:08.000Z" });
  signed.summary_proof = await createSummaryProof(signed, KEY);
  assert.equal((await edge.send(signed)).status, 204);
  assert.equal(edge.calls.at(-1).args.p_model, "gemini-3.5-flash-lite");
  assert.equal(edge.calls.at(-1).args.p_summary_verified, true);
  assert.equal((await edge.send({ ...signed, model: "gemini-3.6-flash" })).status, 422);
});

test("summary confirmation binds attempt, installation, timestamp, route and extension version", async () => {
  const { createSummaryProof, verifySummaryProof } = await proofHelpers();
  const signed = { ...payload(), summary_proof: await createSummaryProof(payload(), KEY) };
  assert.equal(await verifySummaryProof(signed, KEY), true);
  for (const change of [
    { attempt_id: "33333333-3333-4333-8333-333333333333" },
    { install_id: "44444444-4444-4444-8444-444444444444" },
    { attempted_at: "2026-10-02T00:00:01.000Z" },
    { source_platform: "grok" }, { destination_platform: "gemini" }, { extension_version: "1.4.7" },
    { summary_proof: "0".repeat(64) }
  ]) assert.equal(await verifySummaryProof({ ...signed, ...change }, KEY), false);
  assert.equal(await verifySummaryProof(signed, undefined), false);
  assert.equal(await verifySummaryProof(signed, "short"), false);
  assert.equal(await verifySummaryProof(payload(), KEY), false);
});

test("v2 receipts authenticate server completion time while v1 never authenticates an added time", async () => {
  const { createSummaryProof, verifySummaryProof } = await proofHelpers();
  const confirmed = payload({
    completed_at: "2026-10-02T00:00:10.000Z",
    summary_confirmed_at: "2026-10-02T00:00:08.000Z"
  });
  const signed = { ...confirmed, summary_proof: await createSummaryProof(confirmed, KEY) };
  assert.equal(await verifySummaryProof(signed, KEY), true);
  assert.equal(await verifySummaryProof({ ...signed, summary_confirmed_at: "2026-10-01T23:59:59.000Z" }, KEY), false);
  const { summary_confirmed_at, ...withoutTime } = signed;
  assert.equal(await verifySummaryProof(withoutTime, KEY), false);
  const v1 = { ...confirmed, summary_proof: await createSummaryProof(payload(), KEY) };
  assert.equal(await verifySummaryProof(v1, KEY), false);
  const edge = await edgeHarness();
  // Client completion time is diagnostic; only a v2 proof authenticates summary time.
  await edge.send(payload({ completed_at: confirmed.completed_at }));
  assert.equal(edge.calls[0].args.p_completed_at, confirmed.completed_at);
  assert.equal(edge.calls[0].args.p_summary_verified, false);
  assert.equal(edge.calls[0].args.p_summary_confirmed_at, null);
  assert.equal((await edge.send(signed)).status, 204);
  assert.equal(edge.calls[1].args.p_completed_at, confirmed.completed_at);
  assert.equal(edge.calls[1].args.p_summary_verified, true);
  assert.equal(edge.calls[1].args.p_summary_confirmed_at, confirmed.summary_confirmed_at);
  assert.equal((await edge.send({ ...signed, summary_confirmed_at: "2026-10-01T23:59:59.000Z" })).status, 422);
});

test("direct edge calls cannot promote fake successes or externally supplied verification booleans", async () => {
  const edge = await edgeHarness();
  for (let i = 1; i <= 50; i++) {
    const res = await edge.send(payload({ attempt_id: `11111111-1111-4111-8111-${String(i).padStart(12, "0")}` }));
    assert.equal(res.status, 204); // Legacy diagnostics still drain from the outbox.
  }
  assert.equal(edge.calls.length, 50);
  assert.ok(edge.calls.every(call => call.args.p_summary_verified === false));
  assert.equal((await edge.send(payload({ summary_verified: true }))).status, 400);
  assert.equal((await edge.send(payload({ p_summary_verified: true }))).status, 400);
  assert.equal((await edge.send(payload({ summary_proof: "0".repeat(64) }))).status, 422);
  assert.equal(edge.calls.at(-1).args.p_summary_verified, false);
});

test("originless forged successes remain unverified through Vercel and the actual edge handler", async t => {
  const edge = await edgeHarness();
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_TELEMETRY_FUNCTION_URL;
  const originalKey = process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY;
  const originalRelayKey = process.env.TELEMETRY_RELAY_SECRET;
  t.after(() => {
    global.fetch = originalFetch;
    for (const [name, old] of [["SUPABASE_TELEMETRY_FUNCTION_URL", originalUrl], ["SUPABASE_TELEMETRY_PUBLISHABLE_KEY", originalKey], ["TELEMETRY_RELAY_SECRET", originalRelayKey]]) {
      if (old === undefined) delete process.env[name]; else process.env[name] = old;
    }
  });
  process.env.SUPABASE_TELEMETRY_FUNCTION_URL = "https://example.invalid/telemetry";
  process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY = "public-key";
  process.env.TELEMETRY_RELAY_SECRET = RELAY_KEY;
  global.fetch = async (_url, options) => edge.send(JSON.parse(options.body));
  const res = response();
  await telemetry({ method: "POST", headers: { "content-type": "application/json", "x-cap-context-client": "cap-context-extension/1" }, body: payload() }, res);
  assert.equal(res.code, 204);
  assert.equal(edge.calls[0].args.p_summary_verified, false);
});

test("completed server summary yields a usable receipt, including local server direct carry", async t => {
  const { verifySummaryProof, verifySummaryReceipt } = await proofHelpers();
  const originalKey = process.env.TELEMETRY_SIGNING_KEY;
  t.after(() => {
    if (originalKey === undefined) delete process.env.TELEMETRY_SIGNING_KEY;
    else process.env.TELEMETRY_SIGNING_KEY = originalKey;
  });
  process.env.TELEMETRY_SIGNING_KEY = KEY;
  const context = payload({ status: "started", last_stage: "summary_request_started", failure_reason: null });
  const res = response();
  await summarize({ method: "POST", headers: { "content-type": "application/json", "x-cap-context-client": "cap-context-extension/1" }, body: { conversation: "User: Keep the build result.\nClaude: The build passed.", telemetry: context } }, res);
  assert.equal(res.code, 200);
  assert.ok(res.body.summary);
  const signed = { ...payload(), summary_proof: res.body.summaryProof };
  assert.equal(await verifySummaryProof(signed, KEY), true);
  const signedV2 = { ...payload(), summary_proof: res.body.summaryProofV2, summary_confirmed_at: res.body.summaryConfirmedAt };
  assert.equal(res.body.summaryProofV2, res.body.summaryProofV3);
  assert.deepEqual(await verifySummaryReceipt(signedV2, KEY), { model: "local-direct" });
  const edge = await edgeHarness();
  assert.equal((await edge.send(signed)).status, 204);
  assert.equal(edge.calls[0].args.p_summary_verified, true);
  assert.equal(edge.calls[0].args.p_summary_confirmed_at, null);
  await edge.send(signedV2);
  assert.equal(edge.calls[1].args.p_summary_confirmed_at, res.body.summaryConfirmedAt);
  assert.equal(edge.calls[1].args.p_model, "local-direct");
  assert.equal(res.body.summaryModel, "local-direct");
  const signedV3 = { ...signedV2, model: res.body.summaryModel, summary_proof: res.body.summaryProofV3 };
  assert.equal(await verifySummaryProof(signedV3, KEY), true);
  // Paste outcomes are distinct from completed server summary work.
  await edge.send({ ...signed, status: "failed", last_stage: "paste_started", failure_reason: "paste_failed" });
  assert.equal(edge.calls[2].args.p_summary_verified, true);
  const unconfigured = await edgeHarness("");
  assert.equal((await unconfigured.send(signed)).status, 503);
  assert.equal(unconfigured.calls.length, 0);
});

test("summary validation rejects forged proofs, verification flags and malformed contexts", async () => {
  for (const changes of [{ summary_proof: "0".repeat(64) }, { summary_verified: true }, { install_id: "invalid" }]) {
    const res = response();
    await summarize({ method: "POST", headers: { "content-type": "application/json", "x-cap-context-client": "cap-context-extension/1" }, body: {
      conversation: "User: hello", telemetry: payload({ status: "started", last_stage: "summary_request_started", ...changes })
    } }, res);
    assert.equal(res.code, 400);
  }
  assert.equal(validateTelemetryPayload(payload({ summary_proof: "x".repeat(10000) })), null);
});

test("v3 receipts bind the served model and retain v1/v2 compatibility through Edge", async () => {
  const { createSummaryProof } = await proofHelpers();
  const signed = payload({ model: "inclusionai/ling-3.1-flash", summary_confirmed_at: "2026-10-02T00:00:08.000Z" });
  signed.summary_proof = await createSummaryProof(signed, KEY);
  assert.equal(validateTelemetryPayload(signed).model, signed.model);
  const edge = await edgeHarness();
  assert.equal((await edge.send(signed)).status, 204);
  assert.equal(edge.calls[0].args.p_model, signed.model);
  for (const change of [{ model: "local-direct" },
    { summary_confirmed_at: "2026-10-02T00:00:09.000Z" }]) {
    assert.equal((await edge.send({ ...signed, ...change })).status, 422);
  }
  assert.equal(edge.calls.length, 1, "altered attribution must never reach SQL");
  assert.equal((await edge.send({ ...signed, model: undefined })).status, 204);
  assert.equal(edge.calls.at(-1).args.p_model, signed.model, "old store worker can omit model without losing attribution");
  for (const confirmed of [undefined, signed.summary_confirmed_at]) {
    const legacy = payload(confirmed ? { summary_confirmed_at: confirmed } : {});
    legacy.summary_proof = await createSummaryProof(legacy, KEY);
    assert.equal((await edge.send(legacy)).status, 204);
    assert.equal(edge.calls.at(-1).args.p_model, null);
    assert.equal((await edge.send({ ...legacy, model: signed.model })).status, confirmed ? 422 : 400);
  }
});

test("Web Store receipt recovery authenticates every served route and rejects tampering", async () => {
  const { createSummaryProof, verifySummaryReceipt, LEGACY_RECEIPT_MODELS } = await proofHelpers();
  const edge = await edgeHarness();
  for (const model of LEGACY_RECEIPT_MODELS) {
    const signed = payload({ model, summary_confirmed_at: "2026-10-02T00:00:08.000Z" });
    const proof = await createSummaryProof(signed, KEY);
    // Published 1.4.8 persists only proof/time. This remains valid through its
    // ordinary outbox serialization/restart, including failed destination paste.
    const { model: omitted, ...oldWorker } = signed;
    const legacy = JSON.parse(JSON.stringify({ ...oldWorker, summary_proof: proof,
      status: "failed", last_stage: "paste_started", failure_reason: "paste_failed" }));
    assert.deepEqual(await verifySummaryReceipt(legacy, KEY), { model });
    assert.equal((await edge.send(legacy)).status, 204);
    assert.equal(edge.calls.at(-1).args.p_model, model);
    assert.equal(edge.calls.at(-1).args.p_status, "failed");
    const before = edge.calls.length;
    for (const change of [{ summary_confirmed_at: undefined },
      { summary_confirmed_at: "2026-10-02T00:00:09.000Z" }, { install_id: "44444444-4444-4444-8444-444444444444" },
      { attempt_id: "33333333-3333-4333-8333-333333333333" }, { destination_platform: "gemini" },
      { extension_version: "1.4.7" }, { summary_proof: "0".repeat(64) }, { model: "made-up-model" }]) {
      assert.equal((await edge.send({ ...legacy, ...change })).status, 422);
    }
    assert.equal(edge.calls.length, before);
    assert.equal(await verifySummaryReceipt(legacy, "short"), null);
  }
  const unknown = payload({ model: "future/model", summary_confirmed_at: "2026-10-02T00:00:08.000Z" });
  unknown.summary_proof = await createSummaryProof(unknown, KEY);
  assert.equal((await edge.send({ ...unknown, model: undefined })).status, 422, "unsupported omitted models never get guessed");
  assert.equal((await edge.send(unknown)).status, 204, "explicit authenticated v3 models remain supported");
});

test("server receipts cover remote success and emergency carry, and missing keys keep summaries usable", async t => {
  const { verifySummaryProof, verifySummaryReceipt } = await proofHelpers();
  const originalFetch = global.fetch;
  const names = ["TELEMETRY_SIGNING_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY", "MISTRAL_ENABLED",
    "OPENROUTER_API_KEY", "OPENROUTER_ENABLED", "OPENROUTER_LING_ENABLED",
    "OPENROUTER_QWEN_ENABLED", "OPENROUTER_DOTS_ENABLED", "OPENROUTER_GEMMA_ENABLED"];
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  t.after(() => {
    global.fetch = originalFetch;
    for (const name of names) {
      if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
  });
  process.env.TELEMETRY_SIGNING_KEY = KEY;
  delete process.env.GEMINI_API_KEY;
  process.env.MISTRAL_API_KEY = "test-provider-key";
  process.env.MISTRAL_ENABLED = "true";
  process.env.OPENROUTER_API_KEY = "test-openrouter-key";
  process.env.OPENROUTER_LING_ENABLED = "true";
  for (const name of ["OPENROUTER_QWEN_ENABLED", "OPENROUTER_DOTS_ENABLED", "OPENROUTER_GEMMA_ENABLED"]) process.env[name] = "false";
  const context = payload({ status: "started", last_stage: "summary_request_started", failure_reason: null });
  const req = { method: "POST", headers: { "content-type": "application/json", "x-cap-context-client": "cap-context-extension/1" }, body: {
    conversation: "User: Windows build passed.\nClaude: Linux checks remain pending.\n".repeat(80), telemetry: context
  } };
  // The merged router must sign every completion path for the current Edge
  // contract, including OpenRouter and the exact emergency local carry.
  for (const provider of ["openrouter", "mistral", "gemini", "local-direct"]) {
    process.env.OPENROUTER_ENABLED = ["mistral", "gemini"].includes(provider) ? "false" : "true";
    if (provider === "gemini") process.env.GEMINI_API_KEY = "test-gemini-key";
    else delete process.env.GEMINI_API_KEY;
    global.fetch = async (url) => {
      if (provider === "gemini") {
        if (url.includes("gemini-3.6-flash:")) return new Response("{}", { status: 429 });
        assert.match(url, /gemini-3\.5-flash-lite:generateContent$/);
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{
          text: "Windows build passed; Linux checks remain pending."
        }] }, finishReason: "STOP" }] }));
      }
      if (provider === "local-direct") {
        return new Response(JSON.stringify({ error: { code: "unavailable" } }), { status: 400 });
      }
      assert.equal(url, provider === "openrouter"
        ? "https://openrouter.ai/api/v1/chat/completions" : "https://api.mistral.ai/v1/chat/completions");
      return new Response(JSON.stringify({ choices: [{ message: { content: "Windows build passed; Linux checks remain pending." } }] }));
    };
    const res = response();
    await withFundedBudget(() => summarize(req, res));
    assert.equal(res.code, 200);
    assert.equal(res.body.timing.provider, provider);
    if (provider === "openrouter") assert.equal(res.body.timing.primaryModel, "inclusionai/ling-3.1-flash");
    assert.equal(await verifySummaryProof({ ...context, summary_proof: res.body.summaryProof }, KEY), true);
    const signedV2 = { ...context, last_stage: "summary_completed",
      summary_proof: res.body.summaryProofV2, summary_confirmed_at: res.body.summaryConfirmedAt };
    const expectedModel = { openrouter: "inclusionai/ling-3.1-flash", mistral: "ministral-14b-2512",
      gemini: "gemini-3.5-flash-lite", "local-direct": "local-direct" }[provider];
    assert.deepEqual(await verifySummaryReceipt(signedV2, KEY), { model: expectedModel });
    const edge = await edgeHarness();
    assert.equal((await edge.send(signedV2)).status, 204);
    assert.equal(edge.calls[0].args.p_summary_verified, true);
    assert.equal(edge.calls[0].args.p_summary_confirmed_at, res.body.summaryConfirmedAt);
    assert.equal(edge.calls[0].args.p_model, expectedModel, "store-shaped receipt retains final serving model");
    assert.equal(res.body.summaryModel, expectedModel);
    const signedV3 = { ...signedV2, summary_proof: res.body.summaryProofV3, model: res.body.summaryModel };
    assert.equal(await verifySummaryProof(signedV3, KEY), true);
    assert.equal((await edge.send(signedV3)).status, 204);
    assert.equal(edge.calls[1].args.p_model, expectedModel, "persist final fallback model, not the failed primary");
  }
  // Fail the full configured chain so every runtime route appears in the receipt
  // diagnostics. A newly added route must also be recoverable by old workers.
  process.env.GEMINI_API_KEY = "test-gemini-key";
  process.env.OPENROUTER_ENABLED = "true";
  for (const name of ["OPENROUTER_QWEN_ENABLED", "OPENROUTER_DOTS_ENABLED", "OPENROUTER_GEMMA_ENABLED"]) process.env[name] = "true";
  global.fetch = async () => new Response("{}", { status: 400 });
  const allRoutes = response();
  await withFundedBudget(() => summarize(req, allRoutes));
  assert.equal(allRoutes.code, 200);
  const { LEGACY_RECEIPT_MODELS } = await proofHelpers();
  assert.deepEqual(new Set([...allRoutes.body.timing.modelsTried, "local-direct"]), new Set(LEGACY_RECEIPT_MODELS));
  delete process.env.TELEMETRY_SIGNING_KEY;
  const res = response();
  await summarize(req, res);
  assert.equal(res.code, 200);
  assert.ok(res.body.summary);
  assert.equal(res.body.summaryProof, undefined);
});


test("Copy summary receipts authenticate the actual clipboard route through Edge", async () => {
  const { createSummaryProof } = await proofHelpers();
  const edge = await edgeHarness();
  const report = payload({ destination_platform: "clipboard", summary_confirmed_at: new Date().toISOString(), model: "gemini-3.6-flash", reported_model: "gemini-3.6-flash" });
  report.summary_proof = await createSummaryProof(report, KEY);
  assert.equal((await edge.send(report)).status, 204);
  assert.equal(edge.calls[0].args.p_destination_platform, "clipboard");
  assert.equal(edge.calls[0].args.p_summary_verified, true);
  assert.equal(edge.calls[0].args.p_model, "gemini-3.6-flash");
  assert.equal((await edge.send({ ...report, destination_platform: "claude" })).status, 422);
});
