const assert = require("node:assert/strict");
const test = require("node:test");
const { safeProviderError, retryAfterMs, readSafeProviderError } = require("../api/provider-error-diagnostics");

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
