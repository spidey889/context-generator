import "../_shared/transfer-diagnostics.js";
export const TELEMETRY_PLATFORMS = new Set(["claude", "chatgpt", "gemini", "grok", "deepseek"]);
const TELEMETRY_DESTINATIONS = new Set([...TELEMETRY_PLATFORMS, "clipboard"]);
export const TELEMETRY_STATUSES = new Set(["started", "succeeded", "failed"]);
export const TELEMETRY_STAGE_ORDER = [
  "intent_started",
  "capture_started",
  "capture_completed",
  "summary_request_started",
  "summary_response_started",
  "summary_completed",
  "paste_started",
  "completed"
];
export const TELEMETRY_STAGES = new Set(TELEMETRY_STAGE_ORDER);
export const TELEMETRY_MAX_CHARACTER_COUNT = 2147483647;
// Client reports preserve observed outcomes without granting receipt/counter
// trust or accepting arbitrary text. Keep aligned with Vercel and the worker.
const REPORTED_MODELS = new Set(["local-direct", "gemini-3.6-flash", "gemini-3.5-flash-lite", "ministral-14b-2512",
  "inclusionai/ling-3.1-flash", "qwen/qwen3.8-27b:free", "dots-studio/dots-3-note-preview:free", "google/gemma-4-26b-a4b-it:free"]);
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
  "user_cancelled",
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
  "last_stage",
  "failure_reason",
  "extension_version",
  "summary_proof",
  "completed_at",
  "summary_confirmed_at",
  "model",
  "reported_model",
  "diagnostics"
]);

export function validateTelemetryPayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (Object.keys(input).some((key) => !TELEMETRY_KEYS.has(key))) return null;
  const diagnostics = input.diagnostics === undefined ? undefined : globalThis.CapTransferDiagnostics.validate(input.diagnostics);
  if (input.diagnostics !== undefined && !diagnostics) return null;
  if (input.summary_proof !== undefined &&
      (typeof input.summary_proof !== "string" || !/^[0-9a-f]{64}$/.test(input.summary_proof))) return null;
  if (!isUuid(input.attempt_id) || !isUuid(input.install_id)) return null;
  if (!TELEMETRY_PLATFORMS.has(input.source_platform)) return null;
  if (!TELEMETRY_DESTINATIONS.has(input.destination_platform)) return null;
  if (!TELEMETRY_STATUSES.has(input.status)) return null;
  if (!TELEMETRY_STAGES.has(input.last_stage)) return null;
  if (input.status === "succeeded" && input.last_stage !== "completed") return null;
  if (input.status !== "succeeded" && input.last_stage === "completed") return null;

  const attemptedAt = normalizeTimestamp(input.attempted_at);
  if (!attemptedAt) return null;
  const completedAt = input.completed_at === undefined ? undefined : normalizeTimestamp(input.completed_at);
  const summaryConfirmedAt = input.summary_confirmed_at === undefined ? undefined : normalizeTimestamp(input.summary_confirmed_at);
  if (input.completed_at !== undefined && (!completedAt || input.status === "started")) return null;
  if (input.summary_confirmed_at !== undefined && (!summaryConfirmedAt || input.summary_proof === undefined)) return null;
  if (input.model !== undefined && (!summaryConfirmedAt || input.summary_proof === undefined
      || typeof input.model !== "string" || !/^[a-z0-9][a-z0-9._:/-]{0,159}$/.test(input.model))) return null;
  if (input.reported_model !== undefined && (!REPORTED_MODELS.has(input.reported_model)
      || !["summary_completed", "paste_started", "completed"].includes(input.last_stage))) return null;

  const characterCount = input.character_count === null || input.character_count === undefined
    ? null
    : input.character_count;
  if (characterCount !== null && (!Number.isInteger(characterCount) || characterCount < 0 || characterCount > TELEMETRY_MAX_CHARACTER_COUNT)) {
    return null;
  }

  const failureReason = input.status === "failed" ? input.failure_reason : null;
  if (input.status === "failed" && !TELEMETRY_FAILURE_REASONS.has(failureReason)) return null;
  if (typeof input.extension_version !== "string" || input.extension_version.length > 64 || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(input.extension_version)) {
    return null;
  }

  return {
    attempt_id: input.attempt_id,
    install_id: input.install_id,
    attempted_at: attemptedAt,
    source_platform: input.source_platform,
    destination_platform: input.destination_platform,
    character_count: characterCount,
    status: input.status,
    last_stage: input.last_stage,
    failure_reason: failureReason,
    extension_version: input.extension_version,
    ...(diagnostics ? { diagnostics } : {}),
    ...(input.summary_proof !== undefined ? { summary_proof: input.summary_proof } : {}),
    ...(completedAt !== undefined ? { completed_at: completedAt } : {}),
    ...(summaryConfirmedAt !== undefined ? { summary_confirmed_at: summaryConfirmedAt } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.reported_model !== undefined ? { reported_model: input.reported_model } : {})
  };
}

function normalizeTimestamp(value) {
  if (typeof value !== "string") return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) return null;
  const [year, month, day, hour, minute, second, offsetHour = 0, offsetMinute = 0] = parts.slice(1).map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
