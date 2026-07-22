const TELEMETRY_PLATFORMS = new Set(["claude", "chatgpt", "gemini", "grok", "deepseek"]);
const TELEMETRY_STATUSES = new Set(["started", "succeeded", "failed"]);
const TELEMETRY_STAGES = new Set([
  "intent_started",
  "capture_started",
  "capture_completed",
  "summary_request_started",
  "summary_response_started",
  "summary_completed",
  "paste_started",
  "completed"
]);
const TELEMETRY_FAILURE_REASONS = new Set([
  "no_conversation",
  "conversation_too_large",
  "capture_failed",
  "summary_rate_limited",
  "summary_service_busy",
  "summary_access_denied",
  "summary_failed",
  "destination_open_failed",
  "paste_failed",
  "extension_reloaded",
  "client_interrupted",
  "user_cancelled",
  "unknown_failure"
]);
const TELEMETRY_MAX_CHARACTER_COUNT = 2147483647;
const TELEMETRY_MAX_REQUEST_BYTES = 4096;
const TELEMETRY_KEYS = new Set([
  "attempt_id",
  "install_id",
  "attempted_at",
  "source_platform",
  "destination_platform",
  "character_count",
  "status",
  "last_stage",
  "failure_reason",
  "extension_version"
]);

function validateTelemetryRequest(req) {
  const contentType = getHeader(req, "content-type").toLowerCase();
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
    return invalid(415, "unsupported_content_type", "Content-Type must be application/json");
  }

  const declaredLength = Number.parseInt(getHeader(req, "content-length"), 10);
  if (Number.isFinite(declaredLength) && declaredLength > TELEMETRY_MAX_REQUEST_BYTES) {
    return invalid(413, "request_too_large", "Telemetry payload is too large");
  }

  let body = req.body;
  let requestBytes;
  if (typeof body === "string") {
    requestBytes = Buffer.byteLength(body, "utf8");
    if (requestBytes > TELEMETRY_MAX_REQUEST_BYTES) {
      return invalid(413, "request_too_large", "Telemetry payload is too large");
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
    if (requestBytes > TELEMETRY_MAX_REQUEST_BYTES) {
      return invalid(413, "request_too_large", "Telemetry payload is too large");
    }
  }

  const payload = validateTelemetryPayload(body);
  if (!payload) return invalid(400, "invalid_schema", "Invalid telemetry payload");
  return { ok: true, payload, requestBytes };
}

function validateTelemetryPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (Object.keys(input).some((key) => !TELEMETRY_KEYS.has(key))) return null;
  if (!isUuid(input.attempt_id) || !isUuid(input.install_id)) return null;
  if (!TELEMETRY_PLATFORMS.has(input.source_platform)) return null;
  if (!TELEMETRY_PLATFORMS.has(input.destination_platform)) return null;
  if (!TELEMETRY_STATUSES.has(input.status)) return null;
  if (!TELEMETRY_STAGES.has(input.last_stage)) return null;
  if (input.status === "succeeded" && input.last_stage !== "completed") return null;
  if (input.status !== "succeeded" && input.last_stage === "completed") return null;

  const attemptedAt = Date.parse(input.attempted_at || "");
  if (!Number.isFinite(attemptedAt)) return null;

  const characterCount = input.character_count === null || input.character_count === undefined
    ? null
    : Number(input.character_count);
  if (characterCount !== null && (!Number.isInteger(characterCount) || characterCount < 0 || characterCount > TELEMETRY_MAX_CHARACTER_COUNT)) {
    return null;
  }

  const failureReason = input.status === "failed" ? input.failure_reason : null;
  if (input.status === "failed" && !TELEMETRY_FAILURE_REASONS.has(failureReason)) return null;
  if (typeof input.extension_version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(input.extension_version)) {
    return null;
  }

  return {
    attempt_id: input.attempt_id,
    install_id: input.install_id,
    attempted_at: new Date(attemptedAt).toISOString(),
    source_platform: input.source_platform,
    destination_platform: input.destination_platform,
    character_count: characterCount,
    status: input.status,
    last_stage: input.last_stage,
    failure_reason: failureReason,
    extension_version: input.extension_version
  };
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

function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function invalid(status, code, error) {
  return { ok: false, status, code, error };
}

module.exports = {
  TELEMETRY_MAX_REQUEST_BYTES,
  validateTelemetryRequest,
  validateTelemetryPayload
};
