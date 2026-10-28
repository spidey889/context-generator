// Bounded observations only. This helper never receives response content or
// identifiers; MAIN records transport costs and the isolated bridge adds timing.
(function (root) {
  const contract = root.CapTransferDiagnostics;
  const clock = () => Date.now();
  // The complete transcript may be summarized in bounded pieces later. Keep
  // capture capacity separate from request-body and native file-download caps.
  const transcriptCharLimit = 4000000, transcriptByteLimit = 16000000;
  function create(initial = {}, onProgress) {
    const started = clock();
    const data = { outcome: "succeeded", mode: "fresh", history_request_sent: false, history_response_read: false, history_parsed: false, history_checked: false };
    let currentStage, recoveredFileFailure = false;
    const stage = value => {
      if (!contract.jsonAttemptSchema.failure_stage.values.includes(value)) return;
      currentStage = value;
      if (["hook", "serialize"].includes(value)) checkpoint(value, value);
    };
    const set = changes => {
      for (const [key, value] of Object.entries(changes || {})) {
        const rule = contract.jsonAttemptSchema[key];
        if (rule?.type === "number" && Number.isFinite(value) && value >= (rule.min || 0)) {
          if (value > rule.max) data.numeric_saturated = "lower_bound";
          data[key] = Math.min(rule.max, Math.round(value));
        } else if (rule?.values?.includes(value) || rule?.type === "boolean" && typeof value === "boolean") data[key] = value;
      }
    };
    const add = (key, value = 1) => set({ [key]: (data[key] || 0) + value });
    function checkpoint(step, requestStage = currentStage, facts) {
      if (data.failure_check && !recoveredFileFailure) return; // Freeze terminal failures, not skipped files.
      set({ step, step_stage: requestStage, total_ms: clock() - started, ...facts });
      if (contract.jsonAttemptSchema.failure_stage.values.includes(requestStage)) currentStage = requestStage;
      try { onProgress?.(contract.validateJsonAttempt({ ...data, outcome: "started" })); } catch {}
    }
    const fail = (check, stage, source, value, limit, status, details) => {
      // Concurrent files may fail together. Retain the first actual guard,
      // rather than replacing it with a sibling's abort after cancellation.
      if (data.failure_check && !recoveredFileFailure) return;
      // A skipped file keeps its first closed cause separately. A later fatal
      // guard must own failure_* so its stage, size and type remain consistent.
      if (recoveredFileFailure) for (const key of Object.keys(data)) if (key.startsWith("failure_")) delete data[key];
      recoveredFileFailure = false;
      set({ ...details, failure_check: check, failure_stage: stage, failure_value_source: source,
        failure_value: value, failure_limit: limit, http_status: status });
    };
    const recoverFile = (error, requestStage = "attachment_body") => {
      if (!data.failure_check) fail(error?.captureDetail || "attachment_failed", requestStage);
      set({ skipped_file_check: data.skipped_file_check || data.failure_check, outcome: "partial" });
      add("files_skipped");
      recoveredFileFailure = true;
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
      if (key === "serialize_ms") stage("serialize");
      try { return fn(); } finally { add(key, clock() - began); }
    };
    const transcript = text => {
      set({ transcript_chars: text.length, transcript_char_limit: transcriptCharLimit, transcript_byte_limit: transcriptByteLimit });
      if (text.length > transcriptCharLimit) { fail("transcript_char_limit", "serialize", "string_length", text.length, transcriptCharLimit); return false; }
      const bytes = new TextEncoder().encode(text).length;
      set({ transcript_bytes: bytes });
      if (bytes > transcriptByteLimit) { fail("transcript_byte_limit", "serialize", "utf8_bytes", bytes, transcriptByteLimit); return false; }
      return true;
    };
    const ignored = (type, image = false) => {
      add("files_ignored");
      add(image ? "files_ignored_image" : type === "pdf" || type === "application/pdf" ? "files_ignored_pdf" : "files_ignored_other");
    };
    const exception = error => {
      // A bridge may replace the native exception with a safe generic Error.
      // Retain only the first allowlisted class, never its message or stack.
      if (!data.failure_error_type && contract.jsonAttemptSchema.failure_error_type.values.includes(error?.name))
        set({ failure_error_type: error.name });
    };
    const finish = error => {
      set({ total_ms: clock() - started });
      if (error) {
        if (data.step === "hook") set({ hook_ms: clock() - started });
        const detail = error.diagnostics?.capture_detail || error.captureDetail;
        const site = error.diagnostics?.failure_site;
        const failedStage = error.diagnostics?.capture_request_stage || error.captureRequestStage
          || (contract.jsonAttemptSchema.failure_stage.values.includes(site?.slice(8)) ? site.slice(8) : currentStage);
        fail(detail || "unknown", failedStage);
        // Do not derive categories from exception prose or fetch/parser snippets.
        if (!data.failure_check) fail("unknown", failedStage);
        exception(error);
        set({ outcome: detail === "conversation_changed" || detail === "cancelled" ? "cancelled" : "failed" });
      }
      return contract.validateJsonAttempt(data);
    };
    set(initial);
    return { data, set, add, fail, response, timed, transcript, ignored, finish, stage, exception, checkpoint, recoverFile,
      adopt(value) { const safe = contract.validateJsonAttempt(value); if (safe) { set(safe); recoveredFileFailure = ["partial", "started"].includes(safe.outcome) && Boolean(safe.skipped_file_check); checkpoint(safe.step, safe.step_stage); } } };
  }
  root.CapJsonCaptureMetrics = { create };
})(globalThis);
