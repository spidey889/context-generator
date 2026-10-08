const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const diagnostics = require("../extension/transfer-diagnostics.js");
const { validateTelemetryPayload, validateTelemetryRequest } = require("../api/telemetry-validation.js");
const payload = changes => ({ attempt_id: "11111111-1111-4111-8111-111111111111", install_id: "22222222-2222-4222-8222-222222222222",
  attempted_at: "2026-10-09T00:00:00Z", source_platform: "deepseek", destination_platform: "claude", character_count: 300000,
  status: "failed", last_stage: "paste_started", failure_reason: "paste_failed", extension_version: "1.4.12", ...changes });

test("every relay uses the same diagnostic contract and rejects private data at every depth", async () => {
  const canonical = fs.readFileSync(path.join(__dirname, "../extension/transfer-diagnostics.js"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(fs.readFileSync(path.join(__dirname, "../supabase/functions/_shared/transfer-diagnostics.js"), "utf8").replace(/\r\n/g, "\n"), canonical);
  const edge = await import("../supabase/functions/transfer-telemetry/validation.mjs");
  const safe = { version: 1, error_code: "paste_not_retained", error_origin: "destination", paste_populated: true, paste_stable: false,
    summary_chars: 1400, summary_bytes: 1500, paste_attempts: 3, prepared_diagnostics: { version: 1, error_code: "editor_has_draft" },
    paste_events: [{ event: "paste_verify", at_ms: 100 }, { event: "failure", at_ms: 650, code: "paste_not_retained" }] };
  assert.deepEqual(edge.validateTelemetryPayload(payload({ diagnostics: safe })), validateTelemetryPayload(payload({ diagnostics: safe })));
  for (const invalid of [{ ...safe, raw_error: "PRIVATE" }, { ...safe, error_code: "PRIVATE" },
    { ...safe, summary_chars: -1 }, { ...safe, summary_chars: 1.2 }, { ...safe, online: "PRIVATE" },
    { ...safe, paste_events: [{ event: "failure", at_ms: 0, text: "PRIVATE" }] },
    { ...safe, prepared_diagnostics: { version: 1, stack: "PRIVATE" } },
    { ...safe, prepared_diagnostics: { version: 1, prepared_diagnostics: { version: 1 } } }]) {
    assert.equal(validateTelemetryPayload(payload({ diagnostics: invalid })), null);
    assert.equal(edge.validateTelemetryPayload(payload({ diagnostics: invalid })), null);
  }
  assert.ok(validateTelemetryPayload(payload()), "Old clients retain the metadata API.");
});

test("unknown errors preserve observations without inventing a cause or copying error text", () => {
  const record = { version: 1, last_operation: "paste_verify", editor_seen: true, paste_populated: false };
  diagnostics.failure(record, new Error("PRIVATE account URL and chat text"), "destination", 500);
  assert.equal(record.error_code, "unknown_error");
  assert.equal(record.last_operation, "paste_verify");
  assert.equal(record.editor_seen, true);
  assert.equal(record.paste_events[0].code, "unknown_error");
  assert.doesNotMatch(JSON.stringify(record), /PRIVATE|account|URL|chat/);
});

test("retry storms retain bounded first and last observations and the counts", () => {
  const record = { version: 1, paste_attempts: 200 };
  for (let i = 0; i < 200; i++) diagnostics.event(record, "paste_verify", i, "paste_events");
  assert.equal(record.paste_events.length, 32);
  assert.equal(record.paste_events[0].at_ms, 0);
  assert.equal(record.paste_events.at(-1).at_ms, 199);
  assert.equal(record.events_truncated, true);
  assert.ok(diagnostics.validate(record));
  const maximal = { version: 1 };
  for (const [key, rule] of Object.entries(diagnostics.schema)) {
    if (rule.type === "string") maximal[key] = rule.values.reduce((a, b) => a.length > b.length ? a : b);
    if (rule.type === "number") maximal[key] = rule.values?.[0] || 2147483647;
    if (rule.type === "boolean") maximal[key] = true;
    if (rule.type === "array") maximal[key] = Array(32).fill({ event: "destination_activate", at_ms: 2147483647, code: "destination_activation_failed" });
  }
  maximal.prepared_diagnostics = structuredClone(maximal);
  const snapshot = diagnostics.snapshot(maximal);
  assert.ok(snapshot);
  assert.ok(JSON.stringify(snapshot).length <= 12288);
  assert.equal(snapshot.paste_attempts, maximal.paste_attempts);
  assert.ok(validateTelemetryRequest({ headers: { "content-type": "application/json" }, body: payload({ diagnostics: snapshot }) }).ok);
});

test("Edge forwards diagnostics as the optional RPC argument without changing receipt trust", async () => {
  const { createTelemetryHandler } = await import("../supabase/functions/transfer-telemetry/handler.mjs");
  const calls = [];
  const secret = "test-only-relay-0123456789abcdef0123456789";
  const handler = createTelemetryHandler({ getEnv: key => ({ TELEMETRY_RELAY_SECRET: secret, SUPABASE_URL: "https://example.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "test-only" })[key], log() {}, createClient: () => ({ rpc: async (_name, args) => { calls.push(args); return {}; } }) });
  const safe = { version: 1, error_code: "message_timeout", error_origin: "background", message_reply: "timeout", message_attempts: 1 };
  const send = body => handler(new Request("https://example.invalid", { method: "POST", headers: { "content-type": "application/json", "x-cap-context-relay": secret }, body: JSON.stringify(body) }));
  assert.equal((await send(payload({ diagnostics: safe }))).status, 204);
  assert.deepEqual(calls[0].p_diagnostics, safe);
  assert.equal(calls[0].p_summary_verified, false);
  assert.equal((await send(payload())).status, 204);
  assert.equal(calls[1].p_diagnostics, undefined);
});
