// Metadata contract shared by the worker, content scripts and telemetry relay.
// The Edge copy is checked byte-for-byte in tests. Never admit free-form errors,
// selectors, URLs, chat text or summaries here, even when a failure is unknown.
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
    error_code: codes, recovery_error_code: codes, summary_error_code: codes, editor_last_error_code: codes,
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
  const booleans = ["online", "source_saved", "speed_enabled", "json_attempted", "source_changed", "cancelled",
    "destination_prepared", "prepared_reused", "prepared_rejected", "fresh_recovery", "script_injected",
    "editor_seen", "editor_connected", "draft_present", "paste_populated", "paste_stable", "user_handled",
    "summary_cache_hit", "summary_fallback", "events_truncated"];
  const numbers = ["duration_ms", "deadline_remaining_ms", "capture_ms", "capture_chars", "capture_bytes",
    "candidate_turns", "captured_turns", "useful_turns", "raw_candidate_chars", "initial_rendered_turns",
    "sweep_scrolls", "sweep_stale_scrolls", "sweep_quiet_checks", "capture_retries", "expanded_blocks",
    "summary_chars", "summary_bytes", "summary_ms", "summary_fetch_ms", "summary_parse_ms", "summary_service_ms",
    "summary_provider_attempts", "summary_http_status", "destination_open_ms", "activation_ms", "activation_settle_ms",
    "delivery_ms", "message_ms", "message_attempts", "script_injections", "paste_ms", "paste_attempts",
    "composer_wait_ms", "paste_retry_limit_ms", "paste_verify_limit_ms", "paste_stability_ms", "editor_remounts",
    "editor_text_chars", "page_load_ms"];
  const schema = { version: { type: "number", values: [1] },
    ...Object.fromEntries(Object.entries(enums).map(([key, values]) => [key, { type: "string", values }])),
    ...Object.fromEntries(booleans.map(key => [key, { type: "boolean" }])),
    ...Object.fromEntries(numbers.map(key => [key, { type: "number", max: 2147483647 }])),
    events: { type: "array" }, delivery_events: { type: "array" }, paste_events: { type: "array" }, prepared_diagnostics: { type: "object" }
  };
  function validField(key, value) {
    const rule = schema[key];
    if (!rule || typeof value !== rule.type) return false;
    if (rule.values) return rule.values.includes(value);
    return rule.type !== "number" || (Number.isInteger(value) && value >= 0 && value <= rule.max);
  }
  function validate(input, depth = 0) {
    if (!input || typeof input !== "object" || Array.isArray(input) || input.version !== 1) return null;
    const result = {};
    for (const [key, value] of Object.entries(input)) {
      if (key === "prepared_diagnostics") {
        if (depth >= 1) return null;
        result[key] = validate(value, depth + 1);
        if (!result[key]) return null;
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
    return codes.includes(error?.diagnosticCode) ? error.diagnosticCode
      : codes.includes(error?.code) ? error.code : fallback;
  }
  function failure(target, error, origin, atMs) {
    update(target, { error_code: errorCode(error), error_origin: origin });
    event(target, "failure", atMs, origin === "destination" ? "paste_events" : origin === "background" ? "delivery_events" : "events", errorCode(error));
  }
  const api = { schema, codes, operations, events, validate, snapshot, update, event, errorCode, failure };
  root.CapTransferDiagnostics = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
