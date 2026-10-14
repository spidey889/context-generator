// Numeric observations only. This helper never receives response content or
// identifiers; MAIN records transport costs and the isolated bridge adds timing.
(function (root) {
  const contract = root.CapTransferDiagnostics;
  const clock = () => Date.now();
  function create(initial = {}) {
    const started = clock();
    const data = { outcome: "succeeded", mode: "fresh" };
    const set = changes => {
      for (const [key, value] of Object.entries(changes || {})) {
        const rule = contract.jsonAttemptSchema[key];
        if (rule?.type === "number" && Number.isFinite(value) && value >= (rule.min || 0)) {
          if (value > rule.max) data.numeric_saturated = "lower_bound";
          data[key] = Math.min(rule.max, Math.round(value));
        } else if (rule?.values?.includes(value)) data[key] = value;
      }
    };
    const add = (key, value = 1) => set({ [key]: (data[key] || 0) + value });
    const fail = (check, stage, source, value, limit, status) => {
      // Concurrent files may fail together. Retain the first actual guard,
      // rather than replacing it with a sibling's abort after cancellation.
      if (data.failure_check) return;
      set({ failure_check: check, failure_stage: stage, failure_value_source: source,
        failure_value: value, failure_limit: limit, http_status: status });
    };
    const response = (stage, limit, header, countRequest = true) => {
      const began = clock();
      if (countRequest) add("requests");
      const recordHeader = header => { if (header !== null && header !== undefined && Number.isFinite(Number(header)) && Number(header) >= 0) {
        const value = Number(header);
        if (data.raw_header_bytes === undefined || value / Math.max(1, limit) > data.raw_header_bytes / Math.max(1, data.raw_header_limit_bytes))
          set({ raw_header_bytes: value, raw_header_limit_bytes: limit, raw_header_stage: stage });
      } };
      recordHeader(header);
      let bytes = 0;
      let ended = false;
      return {
        header: recordHeader,
        chunk(value) {
          bytes += value;
          add("raw_bytes", value);
          add(({ session: "session_bytes", attachment_descriptor: "descriptor_bytes", attachment_body: "file_body_bytes" })[stage] || "history_bytes", value);
          if (stage === "attachment_body") add("files_downloaded_bytes", value);
          if (data.raw_response_bytes === undefined || bytes / Math.max(1, limit) > data.raw_response_bytes / Math.max(1, data.raw_response_limit_bytes))
            set({ raw_response_bytes: bytes, raw_response_limit_bytes: limit, raw_response_stage: stage });
        },
        end() { if (!ended) { ended = true; add("download_ms", clock() - began); } }
      };
    };
    const timed = (key, fn) => {
      const began = clock();
      try { return fn(); } finally { add(key, clock() - began); }
    };
    const transcript = text => {
      set({ transcript_chars: text.length, transcript_char_limit: 500000, transcript_byte_limit: 2000000 });
      if (text.length > 500000) { fail("transcript_char_limit", "serialize", "string_length", text.length, 500000); return false; }
      const bytes = new TextEncoder().encode(text).length;
      set({ transcript_bytes: bytes });
      if (bytes > 2000000) { fail("transcript_byte_limit", "serialize", "utf8_bytes", bytes, 2000000); return false; }
      return true;
    };
    const ignored = (type, image = false) => {
      add("files_ignored");
      add(image ? "files_ignored_image" : type === "pdf" || type === "application/pdf" ? "files_ignored_pdf" : "files_ignored_other");
    };
    const finish = error => {
      set({ total_ms: clock() - started });
      if (error) {
        const detail = error.diagnostics?.capture_detail || error.captureDetail;
        const site = error.diagnostics?.failure_site;
        const stage = error.diagnostics?.capture_request_stage || error.captureRequestStage
          || (contract.jsonAttemptSchema.failure_stage.values.includes(site?.slice(8)) ? site.slice(8) : "serialize");
        fail(detail || "unknown", stage);
        // Do not derive categories from exception prose or fetch/parser snippets.
        if (!data.failure_check) fail("unknown", "serialize");
        set({ outcome: detail === "conversation_changed" || detail === "cancelled" ? "cancelled" : "failed" });
      }
      return contract.validateJsonAttempt(data);
    };
    set(initial);
    return { data, set, add, fail, response, timed, transcript, ignored, finish,
      adopt(value) { const safe = contract.validateJsonAttempt(value); if (safe) set(safe); } };
  }
  root.CapJsonCaptureMetrics = { create };
})(globalThis);
