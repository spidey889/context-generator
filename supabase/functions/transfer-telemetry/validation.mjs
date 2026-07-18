export const TELEMETRY_PLATFORMS = new Set(["claude", "chatgpt", "gemini", "grok", "deepseek"]);
export const TELEMETRY_STATUSES = new Set(["started", "succeeded", "failed"]);
export const TELEMETRY_MAX_CHARACTER_COUNT = 2147483647;
export const TELEMETRY_FAILURE_REASONS = new Set([
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
  "unknown_failure"
]);

const TELEMETRY_KEYS = new Set([
  "attempt_id",
  "install_id",
  "attempted_at",
  "source_platform",
  "destination_platform",
  "character_count",
  "status",
  "failure_reason",
  "extension_version"
]);

export function validateTelemetryPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (Object.keys(input).some((key) => !TELEMETRY_KEYS.has(key))) return null;
  if (!isUuid(input.attempt_id) || !isUuid(input.install_id)) return null;
  if (!TELEMETRY_PLATFORMS.has(input.source_platform)) return null;
  if (!TELEMETRY_PLATFORMS.has(input.destination_platform)) return null;
  if (!TELEMETRY_STATUSES.has(input.status)) return null;

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
    failure_reason: failureReason,
    extension_version: input.extension_version
  };
}

function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
