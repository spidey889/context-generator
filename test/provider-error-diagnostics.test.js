const assert = require("node:assert/strict");
const test = require("node:test");
const { safeProviderError, retryAfterMs, readSafeProviderError, providerRequestId, embeddedProviderError } = require("../lib/provider-error-diagnostics");

test("Vercel automatic API entries stay within the project's 12-function limit", () => {
  const fs = require("node:fs"), path = require("node:path");
  const root = path.join(__dirname, "..");
  const ignored = new Set(fs.readFileSync(path.join(root, ".vercelignore"), "utf8").split(/\r?\n/));
  // Vercel counts helper files in api/ as functions too, even without a handler.
  const entries = fs.readdirSync(path.join(root, "api"), { recursive: true })
    .filter(name => /\.(?:[cm]?js|[cm]?ts|py|go|rb)$/.test(name)
      && !ignored.has(`api/${name.replace(/\\/g, "/")}`));
  assert.ok(entries.length <= 12, `${entries.length} automatic API functions exceed the deployment limit`);
});

test("provider errors retain fixed safe fields and never echoed text", async () => {
  const result = await readSafeProviderError(new Response(JSON.stringify({ error: { code: 429, type: "rate_limit_error",
    message: "Rate limit exceeded for PRIVATE transcript at https://secret" }, echoed_prompt: "PRIVATE" })));
  assert.deepEqual(result, { upstream_code: "429", upstream_type: "rate_limit_error", upstream_message: "Rate limit exceeded." });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|secret/);
  assert.deepEqual(safeProviderError({ code: "PRIVATE", type: "PRIVATE", message: "PRIVATE" }), { upstream_message: "Provider returned an error." });
  assert.deepEqual(await readSafeProviderError(new Response("x".repeat(8193))), {});
});
test("retry-after observations support seconds and dates with a one-day cap", () => {
  const now = Date.parse("2026-10-31T10:00:00Z");
  for (const [value, expected] of [["2", 2000], ["0.5", 500], ["999999", 86400000], ["Sat, 31 Oct 2026 10:00:03 GMT", 3000], ["PRIVATE", undefined]])
    assert.equal(retryAfterMs(new Headers({ "retry-after": value }), now), expected);
});

test("a stalled error body and cleanup cannot hold the diagnostics reader open", async () => {
  let cancelled = false;
  const result = await readSafeProviderError({ body: { getReader: () => ({
    read: () => new Promise(() => {}), cancel: () => { cancelled = true; return new Promise(() => {}); }, releaseLock() {}
  }) } }, 10);
  assert.deepEqual(result, {});
  assert.equal(cancelled, true);
});
test("request IDs come only from named headers and embedded errors cover all providers", () => {
  assert.equal(providerRequestId(new Headers({ "x-request-id": "req_abcdefgh1234" })), "req_abcdefgh1234");
  assert.equal(providerRequestId(new Headers({ "x-request-id": "PRIVATE chat https://secret", "x-unknown-id": "req_12345678" })), undefined);
  for (const provider of ["openrouter", "tokenharbor", "gemini", "mistral"]) {
    const error = embeddedProviderError({ error: { code: 429, message: "PRIVATE echoed prompt" } }, provider);
    assert.equal(safeProviderError(error).upstream_code, "429");
    assert.doesNotMatch(JSON.stringify(safeProviderError(error)), /PRIVATE/);
  }
  assert.deepEqual(embeddedProviderError({ promptFeedback: { blockReason: "PRIVATE" } }, "gemini"), { type: "safety" });
  assert.deepEqual(embeddedProviderError({ choices: [{ finish_reason: "content_filter" }] }, "openrouter"), { type: "content_filter" });
  assert.equal(embeddedProviderError({ choices: "PRIVATE" }, "openrouter"), null);
});
test("stream parser identifies bad JSON, invalid UTF-8 and incomplete completion separately", async () => {
  const { readProviderStream } = require("../api/provider-stream");
  for (const [body, detail] of [["data: PRIVATE\n\n", "stream_event_json_invalid"], ["data: null\n\n", "stream_event_shape_invalid"],
    ['data: {"choices":"PRIVATE"}\n\n', "stream_event_shape_invalid"],
    ['data: {"choices":[{"delta":{"content":"answer"}}]}\n\n', "stream_incomplete"], [new Uint8Array([255]), "utf8_decode_failed"]]) {
    await assert.rejects(readProviderStream(new Response(body), "openrouter", { onDelta() {}, checkDeadline() {} }),
      error => error.providerFailureDetail === detail && !error.message.includes("PRIVATE"));
  }
});
