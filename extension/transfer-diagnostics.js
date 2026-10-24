// Metadata contract shared by the worker, content scripts and telemetry relay.
// The Edge copy is checked byte-for-byte in tests. Never admit free-form errors,
// selectors, raw URLs, chat text or summaries here, even when a failure is unknown.
(function (root) {
  const codes = ["unknown_error", "no_conversation", "conversation_too_large", "request_too_large",
    "capture_roles_unverified", "capture_json_unavailable", "capture_json_failed", "capture_dom_failed",
    "conversation_changed", "transfer_timeout", "user_cancelled", "source_tab_closed", "destination_tab_closed",
    "extension_reloaded", "rate_limited", "service_busy", "client_not_allowed", "summary_failed",
    "summary_empty", "summary_transport_failed", "summary_timeout", "summary_invalid_response",
    "destination_unsupported", "destination_open_failed", "destination_activation_failed", "destination_not_new_chat",
    "destination_tab_unavailable", "editor_missing", "editor_has_draft", "editor_detached",
    "paste_not_populated", "paste_not_retained", "paste_focus_changed", "paste_empty", "paste_failed",
    "paste_unconfirmed", "message_timeout", "message_receiver_missing", "message_reply_missing",
    "message_reply_invalid", "message_transport_failed", "insertion_exception"];
  const operations = ["admission", "capture_prepare", "capture_json", "capture_dom", "capture_complete",
    "summary_request", "summary_response", "summary_complete", "destination_prepare", "destination_open",
    "destination_activate", "destination_settle", "message_send", "script_inject", "paste_start",
    "editor_wait", "editor_insert", "paste_verify", "paste_stability", "paste_focus", "paste_complete", "completed"];
  const events = [...operations, "json_fallback", "local_fallback", "prepared_reused", "prepared_rejected",
    "fresh_recovery", "editor_remounted", "failure", "cancelled", "deadline_expired"];
  const enums = {
    error_type: ["Error", "TypeError", "SyntaxError", "RangeError", "ReferenceError", "AbortError", "TimeoutError", "SecurityError", "NotAllowedError", "NotFoundError", "InvalidStateError", "other"],
    error_file: ["background.js", "platform-content.js", "chatgpt-json-capture.js", "chatgpt-fetch-main.js", "claude-json-capture.js", "claude-fetch-main.js", "network-json-capture.js", "network-fetch-main.js", "network-json-data.js"],
    failure_site: [...operations, "capture_hook", "capture_session", "capture_history", "capture_attachment_descriptor", "capture_attachment_body", "capture_serialize", "clipboard_write"],
    capture_request_stage: ["hook", "session", "history", "attachment_descriptor", "attachment_body", "serialize"],
    capture_detail: ["auth_missing", "hook_unavailable", "busy", "http_error", "network_error", "invalid_json", "non_json_response", "partial_response", "incomplete_history", "invalid_branch", "branch_cycle", "parent_missing", "count_mismatch", "text_invalid", "canvas_invalid", "missing_text", "attachment_failed", "attachment_size_limit", "size_limit", "timeout", "conversation_changed", "unsupported_content", "routing_unavailable"],
    document_ready_state: ["loading", "interactive", "complete"],
    destination_tab_status: ["loading", "complete"],
    summary_failed_provider: ["tokenharbor", "openrouter", "gemini", "mistral"],
    summary_failure_detail: ["provider_http_error", "provider_timeout", "provider_request_failed", "provider_invalid_json", "provider_generation_failed", "provider_empty", "provider_output_rejected", "funded_budget_unavailable", "providers_unavailable", "unexpected_exception"],
    // Fixed page labels only: chat/project IDs, unknown paths and query values
    // must never become telemetry. The worker and destination use this helper.
    claude_page: ["claude.ai/", "claude.ai/new", "claude.ai/chat/:id", "claude.ai/project/:id",
      "claude.ai/login", "claude.ai/signup", "claude.ai/onboarding", "claude.ai/settings",
      "claude.ai/other", "claude_subdomain", "other_site", "unavailable"],
    error_code: codes, recovery_error_code: codes, summary_error_code: codes, capture_error_code: codes, editor_last_error_code: codes,
    error_origin: ["source", "background", "destination", "summary_service"],
    last_operation: operations, entry_point: ["picker", "toolbar", "other"],
    browser: ["chromium", "firefox"], visibility: ["visible", "hidden", "prerender", "unknown"],
    capture_method: ["structured", "sweep", "claude-json", "chatgpt-json", "gemini-json", "grok-json", "deepseek-json", "unknown"],
    json_fallback_code: ["unavailable", "timeout", "size_limit", "incomplete", "unsupported", "request_failed", "unknown"],
    sweep_exit: ["max-advances-reached", "quiet-check-passed", "no-scroll-movement", "stale-limit-hit", "other"],
    summary_mode: ["remote", "local", "local_fallback", "cache"],
    message_reply: ["ack_success", "ack_failed", "timeout", "missing", "invalid", "transport_failed", "receiver_missing"],
    editor_kind: ["textarea", "input", "contenteditable", "other"],
    insertion_method: ["value_setter", "insert_text", "insert_html", "dom_text", "chatgpt", "already_present"]
  };
  enums.summary_failure_site = enums.capture_failure_site = enums.failure_site;
  enums.summary_error_type = enums.capture_error_type = enums.error_type;
  // JSON measurements survive DOM recovery. A closed, flat record keeps this
  // useful on failures without allowing native responses or private file data.
  const jsonAttemptEnums = {
    outcome: ["succeeded", "partial", "failed", "cancelled"],
    mode: ["prefetch", "fresh", "retry"],
    failure_check: ["raw_header_limit", "raw_total_stream_limit", "raw_response_stream_limit", "raw_remaining_files_limit", "supported_files_limit", "transcript_char_limit", "transcript_byte_limit",
      "auth_missing", "hook_unavailable", "busy", "http_error", "network_error", "invalid_json", "invalid_utf8", "non_json_response",
      "partial_response", "incomplete_history", "invalid_branch", "branch_cycle", "parent_missing", "duplicate_id", "count_mismatch",
      "text_invalid", "canvas_invalid", "missing_text", "attachment_failed", "attachment_length_mismatch", "timeout", "conversation_changed",
      "unsupported_content", "routing_unavailable", "cancelled", "unknown"],
    failure_value_source: ["content_length", "reader_bytes", "declared_files", "string_length", "utf8_bytes"],
    failure_stage: enums.capture_request_stage,
    raw_response_stage: enums.capture_request_stage,
    raw_header_stage: enums.capture_request_stage,
    failure_phase: ["fetch", "headers", "body", "decode", "parse"],
    failure_error_type: [...enums.error_type, "CaptureError"],
    failure_response_type: ["none", "basic", "cors", "default", "opaque", "opaqueredirect", "error", "other"],
    failure_abort: ["none", "capture_timeout", "attachment_failed", "other"],
    failure_online: ["online", "offline", "unknown"],
    failure_content_type: ["text", "json", "html", "octet_stream", "other", "missing"],
    numeric_saturated: ["lower_bound"]
  };
  const jsonAttemptNumbers = ["adapter_version", "failure_value", "failure_limit", "http_status", "raw_bytes", "raw_limit_bytes",
    "raw_response_bytes", "raw_response_limit_bytes", "raw_header_bytes", "raw_header_limit_bytes", "history_bytes", "session_bytes",
    "descriptor_bytes", "file_body_bytes", "requests", "pages", "history_items", "selected_turns", "files_supported", "files_ignored",
    "files_ignored_pdf", "files_ignored_image", "files_ignored_other", "files_declared_bytes", "files_downloaded_bytes", "files_limit_bytes",
    "transcript_chars", "transcript_bytes", "transcript_char_limit", "transcript_byte_limit", "hook_ms", "auth_ms", "download_ms",
    "parse_ms", "serialize_ms", "total_ms", "deadline_ms", "auth_refreshes", "failure_read_bytes", "failure_request_ms"];
  const jsonAttemptSchema = {
    ...Object.fromEntries(Object.entries(jsonAttemptEnums).map(([key, values]) => [key, { type: "string", values }])),
    ...Object.fromEntries(jsonAttemptNumbers.map(key => [key, { type: "number", max: 2147483647 }])),
    http_status: { type: "number", min: 100, max: 599 },
    failure_http_status: { type: "number", min: 100, max: 599 },
    failure_file_index: { type: "number", min: 1, max: 2147483647 },
    failure_file_bytes: { type: "number", max: 4100000 }
  };
  const booleans = ["online", "source_saved", "speed_enabled", "json_attempted", "source_changed", "cancelled",
    "destination_prepared", "prepared_reused", "prepared_rejected", "fresh_recovery", "script_injected",
    "editor_seen", "editor_connected", "draft_present", "paste_populated", "paste_stable", "user_handled",
    "summary_cache_hit", "summary_fallback", "events_truncated", "destination_route_allowed", "destination_platform_match", "destination_auth_prompt"];
  const numbers = ["duration_ms", "deadline_remaining_ms", "capture_ms", "capture_chars", "capture_bytes",
    "candidate_turns", "captured_turns", "useful_turns", "raw_candidate_chars", "initial_rendered_turns",
    "sweep_scrolls", "sweep_stale_scrolls", "sweep_quiet_checks", "capture_retries", "expanded_blocks",
    "summary_chars", "summary_bytes", "summary_ms", "summary_fetch_ms", "summary_parse_ms", "summary_service_ms",
    "summary_provider_attempts", "summary_http_status", "destination_open_ms", "activation_ms", "activation_settle_ms",
    "delivery_ms", "message_ms", "message_attempts", "script_injections", "paste_ms", "paste_attempts",
    "composer_wait_ms", "paste_retry_limit_ms", "paste_verify_limit_ms", "paste_stability_ms", "editor_remounts",
    "editor_text_chars", "page_load_ms", "destination_message_count", "diagnostics_revision", "error_line", "error_column"];
  const schema = { version: { type: "number", values: [1] },
    ...Object.fromEntries(Object.entries(enums).map(([key, values]) => [key, { type: "string", values }])),
    ...Object.fromEntries(booleans.map(key => [key, { type: "boolean" }])),
    ...Object.fromEntries(numbers.map(key => [key, { type: "number", max: 2147483647 }])),
    capture_http_status: { type: "number", min: 100, max: 599 },
    summary_provider_status: { type: "number", min: 100, max: 599 },
    events: { type: "array" }, delivery_events: { type: "array" }, paste_events: { type: "array" }, json_attempts: { type: "array" }, prepared_diagnostics: { type: "object" }
  };
  function validField(key, value, rules = schema) {
    const rule = rules[key];
    if (!rule || typeof value !== rule.type) return false;
    if (rule.values) return rule.values.includes(value);
    return rule.type !== "number" || (Number.isInteger(value) && value >= (rule.min || 0) && value <= rule.max);
  }
  function validateJsonAttempt(input) {
    if (!input || typeof input !== "object" || Array.isArray(input)
      || !jsonAttemptEnums.outcome.includes(input.outcome) || !jsonAttemptEnums.mode.includes(input.mode)) return null;
    if (Object.entries(input).some(([key, value]) => !validField(key, value, jsonAttemptSchema))) return null;
    return { ...input };
  }
  function jsonAttempt(target, input) {
    const safe = validateJsonAttempt(input);
    if (!target || !safe || (target.json_attempts?.length || 0) >= 2) return;
    (target.json_attempts || (target.json_attempts = [])).push(safe);
  }
  function validate(input, depth = 0) {
    if (!input || typeof input !== "object" || Array.isArray(input) || input.version !== 1) return null;
    const result = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === "prepared_diagnostics") {
        if (depth >= 1) return null;
        result[key] = validate(value, depth + 1);
        if (!result[key]) return null;
      } else if (key === "json_attempts") {
        if (!Array.isArray(value) || value.length > 2) return null;
        result[key] = value.map(validateJsonAttempt);
        if (result[key].some(entry => !entry)) return null;
      } else if (["events", "delivery_events", "paste_events"].includes(key)) {
        if (!Array.isArray(value) || value.length > 32) return null;
        if (value.some(event => !event || typeof event !== "object" || Array.isArray(event)
          || Object.keys(event).some(key => !["event", "at_ms", "code"].includes(key)) || !events.includes(event.event)
          || (event.code !== undefined && !codes.includes(event.code))
          || !Number.isInteger(event.at_ms) || event.at_ms < 0 || event.at_ms > 2147483647)) return null;
        result[key] = value.map(({ event, at_ms, code }) => ({ event, at_ms, ...(code ? { code } : {}) }));
      } else {
        if (!validField(key, value)) return null;
        result[key] = value;
      }
    }
    return JSON.stringify(result).length <= 12288 ? result : null;
  }
  function update(target, changes) {
    if (!target) return;
    for (const [key, value] of Object.entries(changes || {})) {
      // Internal optional measurements can be absent; do not fabricate zeros.
      if (!["array", "object"].includes(schema[key]?.type) && validField(key, value)) target[key] = value;
    }
  }
  function snapshot(input) {
    if (!input) return null;
    const result = JSON.parse(JSON.stringify(input));
    // Keep counters and the first/last observations when retry storms reach the
    // envelope bound. Validation still rejects every unknown key/value.
    while (JSON.stringify(result).length > 12288) {
      const lists = [result, result.prepared_diagnostics].filter(Boolean)
        .flatMap(owner => ["events", "delivery_events", "paste_events"].map(key => ({ owner, list: owner[key] })))
        .filter(({ list }) => Array.isArray(list) && list.length > 2).sort((a, b) => b.list.length - a.list.length);
      if (!lists.length) return null;
      lists[0].list.splice(1, 1); lists[0].owner.events_truncated = true;
    }
    return validate(result);
  }
  function event(target, name, atMs, key = "events", code = null) {
    if (!target || !events.includes(name)) return;
    if (!["events", "delivery_events", "paste_events"].includes(key)) return;
    const entries = target[key] || (target[key] = []);
    const entry = { event: name, at_ms: Math.max(0, Math.min(2147483647, Math.round(atMs || 0))),
      ...(codes.includes(code) ? { code } : {}) };
    if (entries.length >= 32) { entries.splice(1, 1); target.events_truncated = true; }
    entries.push(entry);
  }
  function errorCode(error, fallback = "unknown_error") {
    // A generic wrapper must not erase a known inner failure. Broad capture
    // categories are evidence, but never infer network/auth causes from prose.
    if (codes.includes(error?.diagnosticCode) && error.diagnosticCode !== "unknown_error") return error.diagnosticCode;
    if (codes.includes(error?.code) && error.code !== "unknown_error") return error.code;
    return ({ size_limit: "conversation_too_large", unavailable: "capture_json_unavailable",
      timeout: "capture_json_failed", incomplete: "capture_json_failed", unsupported: "capture_json_failed",
      request_failed: "capture_json_failed" })[error?.captureFailureReason] || fallback;
  }
  function errorDetails(error, operation) {
    const details = { diagnostics_revision: 3 };
    // Only fixed observations cross contexts. Exception messages/stacks can
    // contain response snippets, tokens or conversation content.
    const safe = validate(error?.diagnostics);
    if (safe) update(details, safe);
    // Retain only a packaged extension filename and numeric location from the
    // first matching frame. Never send a stack, extension ID, host or path.
    if (!safe?.error_file && typeof error?.stack === "string") {
      const frame = error.stack.match(/(?:chrome|moz)-extension:\/\/[\w-]+\/([\w-]+\.js):(\d+):(\d+)/);
      if (frame && enums.error_file.includes(frame[1])) update(details, {
        error_file: frame[1], error_line: Number(frame[2]), error_column: Number(frame[3])
      });
    }
    update(details, { error_type: safe?.error_type || (enums.error_type.includes(error?.name) ? error.name : "other"),
      failure_site: safe?.failure_site || operation });
    return details;
  }
  function operationErrorCode(operation) {
    if (operation === "capture_json") return "capture_json_failed";
    if (["capture_prepare", "capture_dom", "capture_complete"].includes(operation)) return "capture_dom_failed";
    if (operation?.startsWith("summary_")) return "summary_failed";
    if (operation === "destination_prepare" || operation === "destination_open") return "destination_open_failed";
    if (operation === "destination_activate") return "destination_activation_failed";
    if (operation === "editor_insert") return "insertion_exception";
    if (operation?.startsWith("paste_") || operation === "editor_wait") return "paste_failed";
    return "unknown_error";
  }
  // False means no explicit login/signup route was observed, not signed in.
  // Only inspect sites already covered by the manifest; never return URL data.
  function authPromptFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" || !["claude.ai", "chatgpt.com", "gemini.google.com", "grok.com", "chat.deepseek.com"].includes(parsed.hostname)) return undefined;
      return /^\/(?:a\/|auth\/)?(?:log[-_]?in|sign[-_]?in|sign[-_]?up|register)(?:\/|$)/i.test(parsed.pathname);
    } catch { return undefined; }
  }
  function claudePage(url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") return "other_site";
      if (parsed.hostname !== "claude.ai") return parsed.hostname.endsWith(".claude.ai") ? "claude_subdomain" : "other_site";
      const path = parsed.pathname.replace(/\/+$/, "") || "/";
      if (["/", "/new", "/login", "/signup", "/onboarding", "/settings"].includes(path)) return `claude.ai${path}`;
      if (/^\/chat\/[\w-]+$/.test(path)) return "claude.ai/chat/:id";
      if (/^\/project\/[\w-]+$/.test(path)) return "claude.ai/project/:id";
      return "claude.ai/other";
    } catch { return "unavailable"; }
  }
  function failure(target, error, origin, atMs) {
    const code = errorCode(error, operationErrorCode(target?.last_operation));
    update(target, { ...errorDetails(error, target?.last_operation), error_code: code, error_origin: origin });
    event(target, "failure", atMs, origin === "destination" ? "paste_events" : origin === "background" ? "delivery_events" : "events", code);
  }
  const api = { schema, jsonAttemptSchema, validateJsonAttempt, jsonAttempt, codes, operations, events, validate, snapshot, update, event, errorCode, errorDetails, operationErrorCode, failure, claudePage, authPromptFromUrl };
  root.CapTransferDiagnostics = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
