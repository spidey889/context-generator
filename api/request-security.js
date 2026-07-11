const MAX_CONVERSATION_CHARS = 160000;
const MAX_CONVERSATION_BYTES = 640000;
const MAX_REQUEST_BYTES = 1000000;
const CLIENT_HEADER_NAME = "x-cap-context-client";
const CLIENT_HEADER_VALUE = "cap-context-extension/1";
const RATE_LIMIT_MINUTE_MS = 60000;
const RATE_LIMIT_HOUR_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_PER_MINUTE = 8;
const RATE_LIMIT_MAX_PER_HOUR = 40;
const RATE_LIMIT_MAX_CONCURRENT = 8;
const RATE_LIMIT_ENTRY_TTL_MS = 2 * RATE_LIMIT_HOUR_MS;
const RATE_LIMIT_MAX_ENTRIES = 5000;
const RATE_LIMIT_STATE_KEY = Symbol.for("cap-context.request-security.v1");

function getRateLimitState() {
  if (!globalThis[RATE_LIMIT_STATE_KEY]) {
    globalThis[RATE_LIMIT_STATE_KEY] = {
      clients: new Map(),
      activeRequests: 0,
      lastPrunedAt: 0
    };
  }
  return globalThis[RATE_LIMIT_STATE_KEY];
}

function applyCorsHeaders(req, res) {
  const origin = getHeader(req, "origin");
  const allowedOrigin = isAllowedExtensionOrigin(origin);

  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", `Content-Type, ${CLIENT_HEADER_NAME}`);
  res.setHeader("Access-Control-Max-Age", "600");
  res.setHeader("Cache-Control", "no-store");
  if (allowedOrigin) res.setHeader("Access-Control-Allow-Origin", origin);

  return { origin, allowedOrigin };
}

function isValidPreflightRequest(req) {
  if (!isAllowedExtensionOrigin(getHeader(req, "origin"))) return false;

  const requestedMethod = getHeader(req, "access-control-request-method").toUpperCase();
  if (requestedMethod !== "POST") return false;

  const requestedHeaders = getHeader(req, "access-control-request-headers")
    .toLowerCase()
    .split(",")
    .map((header) => header.trim())
    .filter(Boolean);
  const allowedHeaders = new Set(["content-type", CLIENT_HEADER_NAME]);
  return requestedHeaders.every((header) => allowedHeaders.has(header));
}

function isAllowedExtensionOrigin(origin) {
  if (!origin || origin === "null") return false;
  return (
    /^chrome-extension:\/\/[a-p]{32}$/i.test(origin) ||
    /^moz-extension:\/\/[a-z0-9-]+$/i.test(origin)
  );
}

function isTrustedExtensionRequest(req) {
  const origin = getHeader(req, "origin");
  const clientMarker = getHeader(req, CLIENT_HEADER_NAME);
  const extensionOrigin = isAllowedExtensionOrigin(origin);
  const originMayBeSuppressedByExtensionRuntime = !origin || origin === "null";

  if (extensionOrigin) {
    // Keep already-running pre-security Chrome/Firefox workers compatible. The
    // marker is public and adds no authentication value when the browser has
    // already supplied an extension-only Origin.
    return !clientMarker || clientMarker === CLIENT_HEADER_VALUE;
  }

  // Firefox can suppress Origin for privileged extension requests. In that
  // case the public marker is still required to reject ordinary originless
  // HTTP clients before rate limiting and provider work.
  return originMayBeSuppressedByExtensionRuntime && clientMarker === CLIENT_HEADER_VALUE;
}

function validateSummarizeRequest(req) {
  const contentType = getHeader(req, "content-type").toLowerCase();
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return invalid(415, "unsupported_content_type", "Content-Type must be application/json");
  }

  const declaredLength = Number.parseInt(getHeader(req, "content-length"), 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BYTES) {
    return invalid(413, "request_too_large", "Request payload is too large");
  }

  let body = req.body;
  let requestBytes = 0;
  if (typeof body === "string") {
    requestBytes = Buffer.byteLength(body, "utf8");
    if (requestBytes > MAX_REQUEST_BYTES) {
      return invalid(413, "request_too_large", "Request payload is too large");
    }
    try {
      body = JSON.parse(body);
    } catch {
      return invalid(400, "invalid_json", "Invalid JSON body");
    }
  } else {
    try {
      requestBytes = Buffer.byteLength(JSON.stringify(body ?? null), "utf8");
    } catch {
      return invalid(400, "invalid_json", "Invalid JSON body");
    }
    if (requestBytes > MAX_REQUEST_BYTES) {
      return invalid(413, "request_too_large", "Request payload is too large");
    }
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return invalid(400, "invalid_schema", "JSON body must be an object");
  }

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "conversation") {
    return invalid(400, "invalid_schema", "JSON body must contain only the conversation field");
  }

  const conversation = body.conversation;
  if (typeof conversation !== "string") {
    return invalid(400, "invalid_schema", "conversation must be a string");
  }
  if (!conversation.trim()) {
    return invalid(400, "invalid_schema", "conversation must not be empty");
  }
  if (conversation.length > MAX_CONVERSATION_CHARS) {
    return invalid(
      413,
      "conversation_too_large",
      `Conversation exceeds the supported ${MAX_CONVERSATION_CHARS.toLocaleString("en-US")} character limit`
    );
  }
  if (Buffer.byteLength(conversation, "utf8") > MAX_CONVERSATION_BYTES) {
    return invalid(413, "conversation_too_large", "Conversation exceeds the supported encoded size");
  }

  return { ok: true, conversation, requestBytes };
}

function consumeRateLimit(req, now = Date.now()) {
  const state = getRateLimitState();
  pruneRateLimitState(state, now);
  const clientKey = getClientKey(req);
  let entry = state.clients.get(clientKey);

  if (!entry) {
    entry = {
      minuteStartedAt: now,
      minuteCount: 0,
      hourStartedAt: now,
      hourCount: 0,
      lastSeenAt: now
    };
    state.clients.set(clientKey, entry);
  }

  if (now - entry.minuteStartedAt >= RATE_LIMIT_MINUTE_MS) {
    entry.minuteStartedAt = now;
    entry.minuteCount = 0;
  }
  if (now - entry.hourStartedAt >= RATE_LIMIT_HOUR_MS) {
    entry.hourStartedAt = now;
    entry.hourCount = 0;
  }

  if (entry.minuteCount >= RATE_LIMIT_MAX_PER_MINUTE) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.minuteStartedAt + RATE_LIMIT_MINUTE_MS - now) / 1000))
    };
  }
  if (entry.hourCount >= RATE_LIMIT_MAX_PER_HOUR) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.hourStartedAt + RATE_LIMIT_HOUR_MS - now) / 1000))
    };
  }

  entry.minuteCount += 1;
  entry.hourCount += 1;
  entry.lastSeenAt = now;
  return { allowed: true, remainingMinute: RATE_LIMIT_MAX_PER_MINUTE - entry.minuteCount };
}

function acquireRequestSlot() {
  const state = getRateLimitState();
  if (state.activeRequests >= RATE_LIMIT_MAX_CONCURRENT) return null;

  state.activeRequests += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.activeRequests = Math.max(0, state.activeRequests - 1);
  };
}

function pruneRateLimitState(state, now) {
  if (now - state.lastPrunedAt < RATE_LIMIT_MINUTE_MS && state.clients.size <= RATE_LIMIT_MAX_ENTRIES) return;

  state.lastPrunedAt = now;
  for (const [key, entry] of state.clients) {
    if (now - entry.lastSeenAt > RATE_LIMIT_ENTRY_TTL_MS || state.clients.size > RATE_LIMIT_MAX_ENTRIES) {
      state.clients.delete(key);
    }
  }
}

function getClientKey(req) {
  const forwardedFor = getHeader(req, "x-forwarded-for").split(",")[0]?.trim();
  return forwardedFor || req.socket?.remoteAddress || "unknown-client";
}

function getHeader(req, name) {
  const headers = req.headers || {};
  const directValue = headers[name] ?? headers[name.toLowerCase()];
  const matchingKey = directValue === undefined
    ? Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase())
    : null;
  const value = directValue ?? (matchingKey ? headers[matchingKey] : undefined);
  if (Array.isArray(value)) return String(value[0] || "").trim();
  return String(value || "").trim();
}

function invalid(status, code, error) {
  return { ok: false, status, code, error };
}

function resetRequestSecurityForTests() {
  globalThis[RATE_LIMIT_STATE_KEY] = {
    clients: new Map(),
    activeRequests: 0,
    lastPrunedAt: 0
  };
}

module.exports = {
  MAX_CONVERSATION_CHARS,
  MAX_CONVERSATION_BYTES,
  MAX_REQUEST_BYTES,
  CLIENT_HEADER_NAME,
  CLIENT_HEADER_VALUE,
  RATE_LIMIT_MAX_PER_MINUTE,
  RATE_LIMIT_MAX_PER_HOUR,
  RATE_LIMIT_MAX_CONCURRENT,
  applyCorsHeaders,
  isValidPreflightRequest,
  isAllowedExtensionOrigin,
  isTrustedExtensionRequest,
  validateSummarizeRequest,
  consumeRateLimit,
  acquireRequestSlot,
  resetRequestSecurityForTests
};
