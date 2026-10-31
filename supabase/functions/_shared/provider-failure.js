// Server observations only. Never add prompt text, reasoning text, URLs, keys,
// arbitrary errors or upstream bodies to this contract.
(function (root) {
  const models = {
    tokenharbor: ["deepseek-v4.1-flash:free"],
    openrouter: ["dots-studio/dots-3-note-preview:free", "qwen/qwen3.8-27b:free", "google/gemma-4-26b-a4b-it:free", "nvidia/nemotron-3.5-super-vl:free"],
    gemini: ["gemini-3.6-flash", "gemini-3.5-flash-lite"],
    mistral: ["ministral-14b-2512"]
  };
  const enumeration = values => ({ type: "string", values });
  const integer = (min = 0, max = 2147483647) => ({ type: "number", min, max });
  const schema = {
    id: { type: "uuid" }, request_id: { type: "uuid" }, attempt_id: { type: "uuid" },
    occurred_at: { type: "timestamp" },
    environment: enumeration(["production", "preview", "development"]),
    provider: enumeration(Object.keys(models)), model: enumeration(Object.values(models).flat()),
    failure_reason: enumeration(["provider_timeout", "provider_request_failed", "provider_http_error", "provider_invalid_json",
      "provider_generation_failed", "provider_empty", "provider_output_rejected"]),
    phase: enumeration(["waiting_headers", "reading_body", "waiting_answer", "answer_stream", "parsing_response", "validating_output", "http_error"]),
    timeout_kind: enumeration(["first_answer", "completion"]), key_slot: enumeration(["primary", "backup"]),
    route_index: integer(1, 16), request_attempt: integer(1, 2), input_chars: integer(0, 1000000),
    request_bytes: integer(0, 10000000), max_output_tokens: integer(1, 1000000),
    elapsed_ms: integer(0, 360000), budget_ms: integer(1, 90000), first_answer_budget_ms: integer(1, 90000), headers_ms: integer(0, 360000),
    first_answer_ms: integer(0, 360000), answer_chars: integer(), reasoning_chars: integer(), stream_chunks: integer(),
    http_status: integer(100, 599), finish_reason: enumeration(["stop", "length", "other"]),
    prompt_tokens: integer(), completion_tokens: integer(), reasoning_tokens: integer(),
    upstream_code: enumeration(["400", "401", "402", "403", "404", "408", "413", "422", "429", "500", "502", "503", "504", "529",
      "INVALID_ARGUMENT", "UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND", "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "INTERNAL", "UNAVAILABLE", "DEADLINE_EXCEEDED"]),
    upstream_type: enumeration(["rate_limit_error", "insufficient_quota", "invalid_api_key", "authentication_error", "insufficient_credits",
      "permission_error", "invalid_request_error", "context_length_exceeded", "server_error", "overloaded_error", "content_filter", "safety",
      "RESOURCE_EXHAUSTED", "UNAUTHENTICATED", "PERMISSION_DENIED", "INVALID_ARGUMENT", "INTERNAL", "UNAVAILABLE", "DEADLINE_EXCEEDED"]),
    upstream_message: enumeration(["Rate limit exceeded.", "Quota exhausted.", "Authentication failed.", "Insufficient credits.",
      "Request blocked by safety policy.", "Context length exceeded.", "Provider unavailable.", "Provider returned an error."]),
    retry_after_ms: integer(0, 86400000)
  };
  const required = ["id", "request_id", "occurred_at", "environment", "provider", "model", "failure_reason", "phase", "route_index",
    "request_attempt", "input_chars", "request_bytes", "max_output_tokens", "elapsed_ms", "budget_ms"];
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function validate(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || required.some(key => input[key] === undefined)) return null;
    for (const [key, value] of Object.entries(input)) {
      const rule = schema[key];
      if (!rule) return null;
      if (rule.type === "uuid") { if (typeof value !== "string" || !uuid.test(value)) return null; }
      else if (rule.type === "timestamp") {
        if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) return null;
      } else if (rule.values ? !rule.values.includes(value)
        : !Number.isInteger(value) || value < rule.min || value > rule.max) return null;
    }
    if (!models[input.provider]?.includes(input.model)) return null;
    if (input.timeout_kind !== undefined && input.failure_reason !== "provider_timeout") return null;
    return { ...input };
  }
  const api = { validate, schema, required, models };
  root.CapProviderFailure = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
