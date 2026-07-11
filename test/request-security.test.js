const assert = require("node:assert/strict");
const test = require("node:test");

const summarize = require("../api/summarize.js");
const {
  MAX_CONVERSATION_CHARS,
  MAX_REQUEST_BYTES,
  RATE_LIMIT_MAX_PER_MINUTE,
  RATE_LIMIT_MAX_CONCURRENT,
  applyCorsHeaders,
  isAllowedExtensionOrigin,
  isValidPreflightRequest,
  isTrustedExtensionRequest,
  validateSummarizeRequest,
  consumeRateLimit,
  acquireRequestSlot,
  resetRequestSecurityForTests
} = require("../api/request-security.js");

const CHROME_ORIGIN = `chrome-extension://${"a".repeat(32)}`;
const FIREFOX_ORIGIN = "moz-extension://4f6cd370-29a4-4ea1-bf5d-548f5f79f112";

test("CORS accepts extension schemes and never reflects ordinary web origins", () => {
  assert.equal(isAllowedExtensionOrigin(CHROME_ORIGIN), true);
  assert.equal(isAllowedExtensionOrigin(FIREFOX_ORIGIN), true);
  assert.equal(isAllowedExtensionOrigin("https://spidey889.github.io"), false);
  assert.equal(isAllowedExtensionOrigin("https://attacker.example"), false);
  assert.equal(isAllowedExtensionOrigin("null"), false);

  const allowedResponse = createMockResponse();
  applyCorsHeaders(makeRequest({ headers: { origin: CHROME_ORIGIN } }), allowedResponse);
  assert.equal(allowedResponse.headers["Access-Control-Allow-Origin"], CHROME_ORIGIN);

  const blockedResponse = createMockResponse();
  applyCorsHeaders(makeRequest({ headers: { origin: "https://attacker.example" } }), blockedResponse);
  assert.equal(blockedResponse.headers["Access-Control-Allow-Origin"], undefined);
  assert.equal(blockedResponse.headers.Vary, "Origin");
});

test("preflight is limited to POST and the two required extension headers", () => {
  assert.equal(isValidPreflightRequest(makeRequest({
    method: "OPTIONS",
    headers: {
      origin: CHROME_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type, x-cap-context-client"
    }
  })), true);
  assert.equal(isValidPreflightRequest(makeRequest({
    method: "OPTIONS",
    headers: {
      origin: CHROME_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  })), true);
  assert.equal(isValidPreflightRequest(makeRequest({
    method: "OPTIONS",
    headers: { origin: CHROME_ORIGIN, "access-control-request-method": "DELETE" }
  })), false);
  assert.equal(isValidPreflightRequest(makeRequest({
    method: "OPTIONS",
    headers: {
      origin: CHROME_ORIGIN,
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization"
    }
  })), false);
});

test("extension origins remain compatible with workers started before the client marker shipped", () => {
  assert.equal(isTrustedExtensionRequest(makeRequest()), true);
  assert.equal(isTrustedExtensionRequest(makeRequest({ headers: { origin: FIREFOX_ORIGIN } })), true);
  assert.equal(isTrustedExtensionRequest(makeRequest({
    headers: { origin: CHROME_ORIGIN, "x-cap-context-client": "" }
  })), true);
  assert.equal(isTrustedExtensionRequest(makeRequest({
    headers: { origin: FIREFOX_ORIGIN, "x-cap-context-client": "" }
  })), true);
  assert.equal(isTrustedExtensionRequest(makeRequest({ headers: { origin: "null" } })), true);
  assert.equal(isTrustedExtensionRequest(makeRequest({ headers: { origin: "" } })), true);
  assert.equal(isTrustedExtensionRequest(makeRequest({
    headers: { origin: "null", "x-cap-context-client": "" }
  })), false);
  assert.equal(isTrustedExtensionRequest(makeRequest({
    headers: { origin: "", "x-cap-context-client": "" }
  })), false);
  assert.equal(isTrustedExtensionRequest(makeRequest({ headers: { origin: "https://attacker.example" } })), false);
  assert.equal(isTrustedExtensionRequest(makeRequest({
    headers: { origin: CHROME_ORIGIN, "x-cap-context-client": "wrong" }
  })), false);
});

test("summary endpoint accepts the exact pre-marker Chrome worker request shape", async () => {
  resetRequestSecurityForTests();
  const req = makeRequest({
    body: { conversation: "User: continue this short chat" },
    headers: {
      origin: CHROME_ORIGIN,
      "content-type": "application/json",
      "x-cap-context-client": "",
      "x-forwarded-for": "198.51.100.77"
    }
  });
  const res = createMockResponse();

  await summarize(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.timing.provider, "local-direct");
  assert.equal(res.payload.timing.inputChars, 30);
});

test("backend schema accepts exactly one conversation string at the canonical limit", () => {
  const exactLimit = validateSummarizeRequest(makeRequest({
    body: { conversation: "x".repeat(MAX_CONVERSATION_CHARS) }
  }));
  assert.equal(exactLimit.ok, true);
  assert.equal(exactLimit.conversation.length, 210000);

  for (const body of [
    null,
    [],
    { conversation: 123 },
    { conversation: "" },
    { conversation: "valid", unexpected: true }
  ]) {
    const result = validateSummarizeRequest(makeRequest({ body }));
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
  }
});

test("backend rejects oversized bodies and conversations before provider work", async () => {
  const oversizedConversation = "x".repeat(MAX_CONVERSATION_CHARS + 1);
  const validation = validateSummarizeRequest(makeRequest({
    body: { conversation: oversizedConversation }
  }));
  assert.deepEqual(
    { status: validation.status, code: validation.code },
    { status: 413, code: "conversation_too_large" }
  );

  const declaredOversize = validateSummarizeRequest(makeRequest({
    headers: { "content-length": String(MAX_REQUEST_BYTES + 1) }
  }));
  assert.deepEqual(
    { status: declaredOversize.status, code: declaredOversize.code },
    { status: 413, code: "request_too_large" }
  );

  const originalFetch = global.fetch;
  let providerCalled = false;
  global.fetch = async () => {
    providerCalled = true;
    throw new Error("provider must not be called");
  };
  const res = createMockResponse();
  try {
    await summarize(makeRequest({ body: { conversation: oversizedConversation } }), res);
    assert.equal(res.statusCode, 413);
    assert.equal(res.payload.code, "conversation_too_large");
    assert.equal(providerCalled, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("endpoint rejects wrong methods, content types, origins, and malformed JSON safely", async () => {
  const cases = [
    [makeRequest({ method: "GET" }), 405, "method_not_allowed"],
    [makeRequest({ headers: { origin: "https://attacker.example" } }), 403, "client_not_allowed"],
    [makeRequest({ headers: { "content-type": "text/plain" } }), 415, "unsupported_content_type"],
    [makeRequest({ body: "{broken" }), 400, "invalid_json"]
  ];

  for (const [req, status, code] of cases) {
    const res = createMockResponse();
    await summarize(req, res);
    assert.equal(res.statusCode, status);
    assert.equal(res.payload.code, code);
    assert.equal(typeof res.payload.error, "string");
  }
});

test("rate limiting caps bursts per client and returns a retry window", () => {
  resetRequestSecurityForTests();
  const req = makeRequest({ headers: { "x-forwarded-for": "198.51.100.42" } });

  for (let index = 0; index < RATE_LIMIT_MAX_PER_MINUTE; index += 1) {
    assert.equal(consumeRateLimit(req, 1000).allowed, true);
  }
  const blocked = consumeRateLimit(req, 1000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 60);

  assert.equal(consumeRateLimit(req, 61000).allowed, true);
});

test("global concurrency guard releases slots exactly once", () => {
  resetRequestSecurityForTests();
  const releases = Array.from({ length: RATE_LIMIT_MAX_CONCURRENT }, () => acquireRequestSlot());
  assert.ok(releases.every((release) => typeof release === "function"));
  assert.equal(acquireRequestSlot(), null);

  releases[0]();
  releases[0]();
  const replacement = acquireRequestSlot();
  assert.equal(typeof replacement, "function");
  replacement();
  releases.slice(1).forEach((release) => release());
});

function makeRequest(overrides = {}) {
  return {
    method: "POST",
    body: { conversation: "User: carry this context" },
    socket: { remoteAddress: "127.0.0.1" },
    ...overrides,
    headers: {
      origin: CHROME_ORIGIN,
      "content-type": "application/json",
      "x-cap-context-client": "cap-context-extension/1",
      "x-forwarded-for": "203.0.113.10",
      ...(overrides.headers || {})
    }
  };
}

function createMockResponse() {
  return {
    statusCode: null,
    payload: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return payload;
    },
    end() {
      return this;
    }
  };
}
