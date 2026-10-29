(() => {
  const version = 30;
  // A large history and its original files share one bounded capture, but a
  // healthy later request must not inherit milliseconds left by earlier work.
  const captureTimeoutMs = 45000;
  const readIdleTimeoutMs = 15000;
  // HTTP media types ignore casing; parameters do not change the base type.
  const responseMediaType = response => response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  // Match MIME metadata by base type, keeping the serializer's paste gate aligned.
  const isPlainTextPaste = file => file?.is_big_paste === true && typeof file.mime_type === "string"
    && file.mime_type.split(";", 1)[0].trim().toLowerCase() === "text/plain";
  // ChatGPT's native endpoint returns every branch. This is a transport safety
  // ceiling, not the selected transcript's 4M-character / 16 MB content limit.
  const maxCaptureBytes = 32000000;
  // Shared across unique pasted files; the larger transcript cap does not raise
  // this pool or the 32 MB native download allowance.
  const maxPastedBytes = 4100000;
  const channel = "cap-context-chatgpt-json-v2";
  const currentChat = pathname => (pathname ?? location.pathname).match(/\/c\/([^/]+)\/?$/)?.[1];
  const previous = window.__capChatGptFetchState;
  if (previous?.version === version && window.fetch === previous.fetch) return;
  let auth = previous?.headers?.() || null;
  previous?.dispose();
  const nativeFetch = window.fetch;
  let active = null, activeMeasurementId = null, activeCaptureId = null;
  let authRevision = 0;
  const authKeys = ["authorization", "chatgpt-account-id", "oai-did", "oai-language", "originator"];

  // Temporary, page-local timing report. Never admit URLs, IDs, headers, error
  // prose or captured content, including from isolated-world debug messages.
  const debugReport = { version: 1, main_build: version, started_at_ms: Date.now(), dropped: 0, events: [] };
  window.__capChatGptCaptureDebug = debugReport;
  const debugEvents = new Set(["loaded", "picker_open", "picker_close", "selection", "handoff", "queued", "dequeued", "queue_done", "prefetch_wait", "retry", "hook_wait", "hook_reply", "hook_done", "hook_install", "bridge_request", "bridge_reply", "serialize_start", "serialize_done", "cancel", "capture_start", "fetch_start", "headers", "body_start", "first_byte", "body_done", "parse_done", "waiting", "capture_done", "resource_timing", "destination_start", "destination_reply", "destination_ready", "carry_start", "carry_done", "paste_start", "paste_done", "transfer_done"]);
  const debugNumbers = ["build", "queue", "native", "observed_version", "wait_ms", "elapsed_ms", "status", "bytes", "chars", "turns", "requests", "headers_ms", "total_ms", "queue_ms", "dns_ms", "connect_ms", "server_ms", "body_ms"];
  const debugBooleans = ["aborted", "selected", "measure", "owns_fetch", "online", "pending", "ok"];
  function debug(event, fields = {}, world = "main", quiet = false) {
    try {
      if (!debugEvents.has(event) || !["main", "source", "bridge"].includes(world)) return;
      const row = { ms: Math.max(0, Date.now() - debugReport.started_at_ms), world, event };
      for (const key of debugNumbers) if (Number.isFinite(fields[key]) && fields[key] >= 0) row[key] = Math.min(2147483647, Math.round(fields[key]));
      for (const key of debugBooleans) if (typeof fields[key] === "boolean") row[key] = fields[key];
      if (["hook", "queue", "session", "history", "attachment_descriptor", "attachment_body", "serialize"].includes(fields.stage)) row.stage = fields.stage;
      if (["headers", "body", "processing"].includes(fields.phase)) row.phase = fields.phase;
      if (["succeeded", "failed", "cancelled", "busy", "timeout", "network", "http", "partial", "format", "auth", "changed", "paste", "size", "invalid_json", "unknown"].includes(fields.result)) row.result = fields.result;
      if (["visible", "hidden", "prerender"].includes(fields.visibility)) row.visibility = fields.visibility;
      debugReport.events.push(row);
      if (debugReport.events.length > 160) { debugReport.events.shift(); debugReport.dropped++; }
      if (!quiet) console.info?.(`[CapCapture] ${JSON.stringify(row)}`);
    } catch { /* Optional timing cannot interfere with capture. */ }
  }
  let debugSequence = 0;
  debug("loaded", { build: version });

  // Auth is session/account scoped, not chat scoped: cached sidebar navigation
  // may make no new conversation request. Never read native response bodies.
  const wrappedFetch = function (...args) {
    try {
      const input = args[0];
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      if (url.origin === location.origin && url.pathname.startsWith("/backend-api/")) {
        const incoming = new Headers(args[1]?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (incoming.get("authorization")) {
          const headers = new Headers();
          for (const key of authKeys) if (incoming.has(key)) headers.set(key, incoming.get(key));
          if (auth && headers.get("chatgpt-account-id") !== auth.get("chatgpt-account-id")) active?.abort("account_changed");
          auth = headers;
          authRevision++;
        }
      }
    } catch { /* Keep invalid arguments subject to native fetch behavior. */ }
    return Reflect.apply(nativeFetch, this, args);
  };
  window.fetch = wrappedFetch;

  const receive = async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.channel !== channel || !["request", "ping", "cancel_measurement", "cancel_capture", "debug"].includes(request.type)) return;
    if (request.type === "debug") { debug(request.event, request.fields, request.world, true); return; }
    if (typeof request.id !== "string" || request.id.length > 80) return;
    if (request.type === "cancel_measurement") {
      if (activeMeasurementId === request.id) active?.abort("measurement_cancelled");
      return;
    }
    if (request.type === "cancel_capture") {
      // Correlate ordinary cancellation separately: an old picker or a count
      // cancellation must never abort a newer capture or a measurement.
      debug("cancel", { ok: activeCaptureId === request.id });
      if (activeCaptureId === request.id) active?.abort("capture_cancelled");
      return;
    }
    // Readiness probes never fetch session data or conversation messages.
    if (request.type === "ping") {
      if (window.fetch === wrappedFetch) window.postMessage({ channel, type: "pong", id: request.id, version }, location.origin);
      return;
    }
    const chat = currentChat();
    const reply = { channel, type: "response", id: request.id, chat };
    if (active) { debug("capture_done", { result: "busy" }); window.postMessage({ ...reply, error: "busy" }, location.origin); return; }
    const native = ++debugSequence, debugStarted = Date.now();
    let debugPhase = "processing", debugTimer = null;
    let currentRead, currentFile;
    debug("capture_start", { native, measure: request.measureOnly === true, visibility: globalThis.document?.visibilityState,
      owns_fetch: window.fetch === wrappedFetch, online: globalThis.navigator?.onLine });
    const controller = new AbortController();
    const metrics = globalThis.CapJsonCaptureMetrics.create({ adapter_version: version, deadline_ms: captureTimeoutMs, raw_limit_bytes: maxCaptureBytes,
      raw_bytes: 0, requests: 0, auth_refreshes: 0 }, progress => {
      if (request.measureOnly !== true) window.postMessage({ ...reply, type: "capture_progress", jsonCapture: progress }, location.origin);
    });
    active = controller;
    activeMeasurementId = request.measureOnly === true ? request.id : null;
    activeCaptureId = request.measureOnly === true ? null : request.id;
    let resourceObserver = null;
    const debugRequests = [];
    const logResourceTiming = entries => {
      for (const entry of entries) {
        if (!debugRequests.some(owned => owned.url === entry.name && entry.startTime >= owned.started - 1)) continue;
        const fields = { native, total_ms: entry.duration, bytes: entry.encodedBodySize };
        if (entry.requestStart > 0) fields.queue_ms = entry.requestStart - entry.fetchStart;
        if (entry.responseStart > 0 && entry.requestStart > 0) fields.server_ms = entry.responseStart - entry.requestStart;
        if (entry.responseEnd > 0 && entry.responseStart > 0) fields.body_ms = entry.responseEnd - entry.responseStart;
        if (entry.domainLookupEnd > 0) fields.dns_ms = entry.domainLookupEnd - entry.domainLookupStart;
        if (entry.connectEnd > 0) fields.connect_ms = entry.connectEnd - entry.connectStart;
        debug("resource_timing", fields);
      }
    };
    try {
      if (typeof PerformanceObserver !== "undefined") {
        resourceObserver = new PerformanceObserver(list => { try { logResourceTiming(list.getEntries()); } catch {} });
        resourceObserver.observe({ type: "resource", buffered: false });
      }
    } catch { resourceObserver = null; }
    const logWaiting = () => {
      debug("waiting", { native, stage: reply.captureRequestStage || "history", phase: debugPhase,
        elapsed_ms: Date.now() - debugStarted, bytes: metrics.data.raw_bytes || 0, aborted: controller.signal.aborted,
        visibility: globalThis.document?.visibilityState });
      if (!controller.signal.aborted) debugTimer = setTimeout(logWaiting, 1000);
    };
    debugTimer = setTimeout(logWaiting, 1000);
    let navigated = false;
    const changed = event => {
      const destination = event?.destination ? new URL(event.destination.url) : location;
      if (destination.origin !== location.origin || currentChat(destination.pathname) !== chat) {
        navigated = true;
        controller.abort();
      }
    };
    const captureDeadline = Date.now() + captureTimeoutMs;
    const timer = setTimeout(() => controller.abort(), captureTimeoutMs);
    let idleTimer, idleDeadline;
    const checkCaptureActive = () => {
      if (Date.now() >= captureDeadline || idleDeadline !== undefined && Date.now() >= idleDeadline) controller.abort();
      if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
    };
    const finishReadProgress = () => { clearTimeout(idleTimer); idleDeadline = undefined; };
    const noteReadProgress = () => {
      clearTimeout(idleTimer);
      if (!controller.signal.aborted) {
        idleDeadline = Math.min(captureDeadline, Date.now() + readIdleTimeoutMs);
        idleTimer = setTimeout(() => controller.abort(), Math.max(0, idleDeadline - Date.now()));
      }
    };
    window.navigation?.addEventListener("navigate", changed);
    window.addEventListener("popstate", changed);
    const recordReadFailure = (error, completedDescriptor = false) => {
      if (!currentRead || currentRead.failed || currentRead.complete && !completedDescriptor) return;
      currentRead.failed = true;
      const response = currentRead.response;
      const rules = globalThis.CapTransferDiagnostics.jsonAttemptSchema;
      const reason = navigated || controller.signal.reason === "account_changed" ? "conversation_changed"
        : ["capture_cancelled", "measurement_cancelled"].includes(controller.signal.reason) ? "cancelled"
        : controller.signal.aborted ? "timeout" : error?.name === "SyntaxError" ? "invalid_json"
        : ({ http: "http_error", partial: "partial_response", format: "non_json_response", auth: "auth_missing",
          changed: "conversation_changed", paste: "attachment_failed", network: "network_error" })[error?.message] || "network_error";
      const mediaType = response && responseMediaType(response);
      const details = {
        failure_phase: currentRead.phase,
        failure_error_type: rules.failure_error_type.values.includes(currentRead.errorType || error?.name) ? currentRead.errorType || error.name : "other",
        failure_request_ms: Date.now() - currentRead.began,
        failure_read_bytes: currentRead.bytes,
        failure_response_type: !response ? "none" : rules.failure_response_type.values.includes(response.type) ? response.type : "other",
        failure_online: typeof navigator === "undefined" || typeof navigator.onLine !== "boolean" ? "unknown" : navigator.onLine ? "online" : "offline",
        failure_abort: !controller.signal.aborted ? "none" : navigated || ["account_changed", "capture_cancelled", "measurement_cancelled"].includes(controller.signal.reason) ? "other" : "capture_timeout",
        ...(response ? { failure_http_status: response.status, failure_content_type: mediaType === "text/plain" ? "text"
          : mediaType === "application/json" ? "json" : mediaType === "text/html" ? "html"
          : mediaType === "application/octet-stream" ? "octet_stream" : mediaType ? "other" : "missing" } : {}),
        ...(currentRead.file ? { failure_file_index: currentRead.file.index, failure_file_bytes: currentRead.file.size } : {})
      };
      // These fields already pass the hosted closed schema. Keep only counts
      // and fixed labels from the actual failing request, never the preceding
      // history/descriptor status, native exception prose, file ID or URL.
      metrics.fail(reason, currentRead.stage, undefined, undefined, undefined, response?.status, details);
      if (metrics.data.failure_stage === currentRead.stage) metrics.set(details);
    };
    const fetchJson = async (url, options = {}) => {
      checkCaptureActive();
      noteReadProgress();
      delete reply.status;
      delete metrics.data.http_status;
      const stage = reply.captureRequestStage || "history";
      metrics.checkpoint("request", stage, stage === "history" ? { history_request_sent: true } : undefined);
      metrics.add("requests");
      const began = Date.now();
      currentRead = { began, stage, phase: "fetch", bytes: 0, file: currentFile };
      try {
        if (debugRequests.length < 64) debugRequests.push({ url: new URL(url, location.href).href,
          started: globalThis.performance?.now?.() ?? 0 });
      } catch {}
      debugPhase = "headers";
      debug("fetch_start", { native, stage: reply.captureRequestStage || "history", requests: metrics.data.requests });
      try { const response = await Reflect.apply(nativeFetch, window, [url, {
      ...options, credentials: "same-origin", cache: "no-store", signal: controller.signal
      }]); currentRead.response = response; currentRead.phase = "headers";
        checkCaptureActive();
        noteReadProgress();
        metrics.set({ http_status: response.status }); metrics.checkpoint("response", stage);
        debugPhase = "body";
        debug("headers", { native, stage: reply.captureRequestStage || "history", status: response.status, headers_ms: Date.now() - began });
        return response;
      } catch (error) {
        recordReadFailure(error);
        // A late headers response still owns a body even if the absolute
        // deadline wins before a reader can start.
        try { currentRead.response?.body?.cancel()?.catch?.(() => {}); } catch {}
        throw error;
      }
      finally { metrics.add("download_ms", Date.now() - began); }
    };
    // Discard owned responses before retry/fallback; cleanup must never replace
    // the bounded capture error with private upstream cancellation details.
    const discardResponse = response => response.body?.cancel().catch(() => {});
    // Bound the entire owned read, not each request: session refreshes and
    // repeated descriptors share the allowance with history and original files.
    let bytesRead = 0, readLimitExceeded = false;
    const readJson = async (response, responseLimit = 6000000) => {
      let reader, bodyReadFailed = false;
      const stage = reply.captureRequestStage || "history";
      debug("body_start", { native, stage });
      const remaining = Math.min(responseLimit, maxCaptureBytes - bytesRead);
      const observation = metrics.response(stage, remaining, response.headers.get("content-length"), false);
      try {
        checkCaptureActive();
        if (Number(response.headers.get("content-length")) > remaining) { readLimitExceeded = true; metrics.fail("raw_header_limit", stage, "content_length", Number(response.headers.get("content-length")), remaining, response.status); throw new Error("partial"); }
        reader = response.body?.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        const parts = [];
        let responseBytes = 0;
        currentRead.phase = "body";
        metrics.checkpoint("read", stage);
        if (reader) while (true) {
          // Retry a rejected network read, not decoder/JSON/size failures.
          const { done, value } = await reader.read().catch(error => {
            currentRead.errorType = error?.name;
            metrics.exception(error);
            if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
            bodyReadFailed = true;
            metrics.fail("network_error", stage);
            throw new Error("network");
          });
          checkCaptureActive();
          if (done) break;
          noteReadProgress();
          if (!responseBytes) debug("first_byte", { native, stage });
          bytesRead += value.byteLength;
          responseBytes += value.byteLength;
          currentRead.bytes += value.byteLength;
          observation.chunk(value.byteLength);
          if (responseBytes > remaining) { readLimitExceeded = true; metrics.fail("raw_response_stream_limit", stage, "reader_bytes", responseBytes, remaining, response.status); throw new Error("partial"); }
          let part;
          currentRead.phase = "decode";
          try { part = decoder.decode(value, { stream: true }); } catch (error) { metrics.fail("invalid_utf8", stage); throw error; }
          if (part) parts.push(part);
          currentRead.phase = "body";
        }
        // Flush partial UTF-8 at EOF. Silent replacement would alter source
        // text; parse only a complete, strictly decoded response.
        finishReadProgress();
        currentRead.phase = "decode";
        try { parts.push(decoder.decode()); } catch (error) { metrics.fail("invalid_utf8", stage); throw error; }
        observation.end();
        debugPhase = "processing";
        debug("body_done", { native, stage, bytes: responseBytes });
        metrics.checkpoint("parse", stage, stage === "history" ? { history_response_read: true } : undefined);
        currentRead.phase = "parse";
        const parsed = metrics.timed("parse_ms", () => JSON.parse(parts.join("")));
        checkCaptureActive();
        debug("parse_done", { native, stage });
        metrics.checkpoint("check", stage, stage === "history" ? { history_parsed: true } : undefined);
        currentRead.complete = true;
        return parsed;
      } catch (error) {
        metrics.exception(error);
        if (error?.name === "SyntaxError") metrics.fail("invalid_json", stage);
        recordReadFailure(error);
        if (error?.name === "SyntaxError") reply.captureDetail = "invalid_json";
        if (reader) await reader.cancel().catch(() => {});
        else await discardResponse(response);
        throw new Error(bodyReadFailed ? "network" : "partial");
      } finally {
        observation.end();
        reader?.releaseLock();
      }
    };
    const readPaste = async (response, expectedSize) => {
      let reader;
      debug("body_start", { native, stage: "attachment_body" });
      const observation = metrics.response("attachment_body", maxCaptureBytes - bytesRead, response.headers.get("content-length"), false);
      try {
        checkCaptureActive();
        if (response.status !== 200 || response.headers.has("content-range")
          || responseMediaType(response) !== "text/plain") {
          metrics.fail(response.status !== 200 ? "http_error" : response.headers.has("content-range") ? "partial_response" : "non_json_response", "attachment_body", undefined, undefined, undefined, response.status);
          throw new Error("paste");
        }
        if (Number(response.headers.get("content-length")) > expectedSize) {
          metrics.fail("attachment_length_mismatch", "attachment_body", "content_length", Number(response.headers.get("content-length")), expectedSize, response.status);
          throw new Error("paste");
        }
        if (expectedSize > maxCaptureBytes - bytesRead) { metrics.fail("raw_remaining_files_limit", "attachment_body", "declared_files", expectedSize, maxCaptureBytes - bytesRead); throw new Error("paste"); }
        // The manifest bounds this allocation. Never buffer an oversized body
        // first: reject the first excess chunk, including without Content-Length.
        const bytes = new Uint8Array(expectedSize);
        reader = response.body?.getReader();
        let size = 0;
        currentRead.phase = "body";
        metrics.checkpoint("read", "attachment_body");
        if (reader) while (true) {
          const { done, value } = await reader.read();
          checkCaptureActive();
          if (done) break;
          noteReadProgress();
          if (!size) debug("first_byte", { native, stage: "attachment_body" });
          observation.chunk(value.byteLength);
          currentRead.bytes += value.byteLength;
          // Rejected chunks still consume the shared read budget. Skipping a
          // bad file must not reset that allowance for the following files.
          bytesRead += value.byteLength;
          if (bytesRead > maxCaptureBytes) { readLimitExceeded = true; metrics.fail("raw_total_stream_limit", "attachment_body", "reader_bytes", bytesRead, maxCaptureBytes); throw new Error("paste"); }
          if (size + value.byteLength > expectedSize) { metrics.fail("attachment_length_mismatch", "attachment_body", "reader_bytes", size + value.byteLength, expectedSize); throw new Error("paste"); }
          bytes.set(value, size); size += value.byteLength;
        }
        if (size !== expectedSize) { metrics.fail("attachment_length_mismatch", "attachment_body", "reader_bytes", size, expectedSize); throw new Error("paste"); }
        finishReadProgress();
        debugPhase = "processing";
        debug("body_done", { native, stage: "attachment_body", bytes: size });
        // Preserve complete UTF-8, BOM and whitespace through chunk boundaries.
        currentRead.phase = "decode";
        let text;
        try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch (error) { metrics.fail("invalid_utf8", "attachment_body"); throw error; }
        checkCaptureActive();
        return text;
      } catch (error) {
        recordReadFailure(error);
        if (reader) await reader.cancel().catch(() => {});
        else await discardResponse(response);
        throw error;
      } finally {
        observation.end();
        reader?.releaseLock();
      }
    };
    const checkTransport = async response => {
      reply.status = response.status;
      metrics.set({ http_status: response.status });
      try {
        if (response.status !== 200) { reply.status = response.status; throw new Error("http"); }
        if (response.headers.has("content-range")) throw new Error("partial");
        if (responseMediaType(response) !== "application/json") throw new Error("format");
      } catch (error) { metrics.fail(({ http: "http_error", partial: "partial_response", format: "non_json_response" })[error?.message], reply.captureRequestStage, undefined, undefined, undefined, response.status); recordReadFailure(error); await discardResponse(response); throw error; }
    };
    const refreshAuth = async () => {
      metrics.add("auth_refreshes");
      const authStarted = Date.now();
      const previousStage = reply.captureRequestStage;
      reply.captureRequestStage = "session";
      // Late hooks cannot recover headers from resource timing. Read the existing
      // same-origin session only on explicit capture, keeping tokens in MAIN.
      const revision = authRevision;
      const response = await fetchJson("/api/auth/session");
      await checkTransport(response);
      const session = await readJson(response);
      metrics.add("auth_ms", Date.now() - authStarted);
      if (typeof session.accessToken !== "string" || !session.accessToken) throw new Error("auth");
      if (revision !== authRevision && auth) return new Headers(auth);
      const headers = new Headers(auth || undefined);
      headers.set("authorization", `Bearer ${session.accessToken}`);
      if (!headers.has("chatgpt-account-id") && typeof session.account?.id === "string") headers.set("chatgpt-account-id", session.account.id);
      auth = headers;
      reply.captureRequestStage = previousStage;
      return new Headers(headers);
    };
    let authRetried = false;
    const fetchAuthenticatedJson = async (url, options = {}) => {
      if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
      const revision = authRevision;
      let headers = auth ? new Headers(auth) : await refreshAuth();
      if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
      let response = await fetchJson(url, { ...options, headers });
      // Every authenticated read uses the latest observed same-account headers.
      // One expired-token retry is shared by the tree and all paste descriptors.
      if (response.status === 401 && !authRetried) {
        await discardResponse(response);
        authRetried = true;
        if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
        headers = revision !== authRevision && auth ? new Headers(auth) : await refreshAuth();
        if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
        response = await fetchJson(url, { ...options, headers });
      }
      return response;
    };
    try {
      reply.captureRequestStage = "history";
      if (!chat || request.chat !== chat) throw new Error("changed");
      metrics.checkpoint("route", "history", { saved_chat: true, route_found: true, route_reason: "available" });
      const url = `/backend-api/conversation/${encodeURIComponent(chat)}`;
      // Retry an expired bearer token once. Never retry a partial tree or guess
      // another workspace on 403; both must fail visibly.
      const response = await fetchAuthenticatedJson(url);
      await checkTransport(response);
      const data = await readJson(response, maxCaptureBytes);
      if (controller.signal.aborted || currentChat() !== chat || (data.conversation_id ?? data.id) !== chat) throw new Error("changed");
      if (!data.mapping || typeof data.mapping !== "object" || Array.isArray(data.mapping)) throw new Error("partial");
      // Preserve full-response counts for the bridge's advertised-total checks,
      // then discard alternate branches before crossing the page bridge.
      const sourceTreeCounts = { nodes: Object.keys(data.mapping).length,
        messages: Object.values(data.mapping).filter(node => node?.message).length };
      metrics.set({ history_items: sourceTreeCounts.nodes, files_limit_bytes: maxPastedBytes,
        files_supported: 0, files_ignored: 0, files_declared_bytes: 0, files_downloaded_bytes: 0 });
      const selectedMapping = Object.create(null);
      // Big pastes are user text stored as files, not text.parts. Read only
      // active-branch user pastes; never use a tool's extracted/rephrased copy.
      const branch = [];
      const seen = new Set();
      let nodeId = data.current_node;
      while (typeof nodeId === "string" && !seen.has(nodeId)) {
        seen.add(nodeId);
        const node = Object.hasOwn(data.mapping || {}, nodeId) ? data.mapping[nodeId] : null;
        if (!node || !Object.hasOwn(node, "parent")) break;
        selectedMapping[nodeId] = node;
        branch.push(node.message);
        if (node.parent === null) break;
        nodeId = node.parent;
      }
      const rooted = data.mapping?.[nodeId]?.parent === null;
      if (!rooted) throw new Error("partial");
      for (const node of Object.values(selectedMapping)) {
        if (Array.isArray(node.children)) node.children = node.children.filter(id => Object.hasOwn(selectedMapping, id));
      }
      data.mapping = selectedMapping;
      if (request.measureOnly === true) {
        const messages = branch.filter(message => ["user", "assistant"].includes(message?.author?.role)
          && !message.metadata?.is_visually_hidden_from_conversation);
        window.postMessage({ channel, type: "measurement_progress", id: request.id, chat, messageTurnCount: messages.length,
          estimatedCharacterCount: messages.reduce((sum, message) => sum + (typeof message.content?.text === "string" ? message.content.text.length : 0)
            + (Array.isArray(message.content?.parts) ? message.content.parts : []).reduce((n, part) => n + (typeof part === "string" ? part.length : 0), 0), 0) }, location.origin);
      }
      const pastedTexts = Object.create(null);
      const uploads = new Map();
      let pastedBytes = 0;
      for (const message of rooted ? branch : []) {
        if (message?.author?.role !== "user" || message.metadata?.is_visually_hidden_from_conversation
          || (message.recipient && message.recipient !== "all")) continue;
        for (const file of Array.isArray(message.metadata?.attachments) ? message.metadata.attachments : []) {
          try {
            if (!isPlainTextPaste(file)) { metrics.ignored(typeof file?.mime_type === "string" && /^application\/pdf(?:;|$)/i.test(file.mime_type) ? "pdf" : "other", typeof file?.mime_type === "string" && /^image\//i.test(file.mime_type)); continue; }
            if (typeof file.id !== "string" || !/^file[-_][a-zA-Z0-9_-]+$/.test(file.id)
              || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error("paste");
            if (uploads.has(file.id)) {
              if (uploads.get(file.id).size !== file.size) throw new Error("paste");
              continue;
            }
            const nextPastedBytes = pastedBytes + file.size;
            metrics.add("files_supported"); metrics.set({ files_declared_bytes: nextPastedBytes });
            if (nextPastedBytes > maxPastedBytes) {
              reply.captureDetail = "attachment_size_limit";
              reply.captureRequestStage = "attachment_descriptor";
              metrics.fail("supported_files_limit", "attachment_descriptor", "declared_files", nextPastedBytes, maxPastedBytes);
              throw new Error("size");
            }
            pastedBytes = nextPastedBytes;
            uploads.set(file.id, file);
          } catch (error) { if (request.measureOnly !== true && error.message === "size") throw error; }
        }
      }
      // Validate the complete qualifying manifest before remote file work.
      // Repeated IDs share one read, but every declaration must match its bytes.
      if (request.measureOnly !== true && pastedBytes > maxCaptureBytes - bytesRead) { metrics.fail("raw_remaining_files_limit", "attachment_descriptor", "declared_files", pastedBytes, maxCaptureBytes - bytesRead); throw new Error("paste"); }
      let fileIndex = 0;
      for (const file of uploads.values()) {
        currentFile = { index: ++fileIndex, size: file.size };
        currentRead = null;
        try {
          reply.captureRequestStage = "attachment_descriptor";
          const descriptorResponse = await fetchAuthenticatedJson(`/backend-api/files/download/${encodeURIComponent(file.id)}`, { redirect: "error" });
          reply.status = descriptorResponse.status;
          if (descriptorResponse.status !== 200 || descriptorResponse.headers.has("content-range")
            || responseMediaType(descriptorResponse) !== "application/json") {
            reply.status = descriptorResponse.status;
            await discardResponse(descriptorResponse);
            throw new Error("paste");
          }
          const descriptor = await readJson(descriptorResponse);
          if (descriptor.status !== "success" || descriptor.file_size_bytes !== file.size || typeof descriptor.download_url !== "string") throw new Error("paste");
          const download = new URL(descriptor.download_url, location.origin);
          // Native preview uses this signed same-origin content route. Keep the
          // URL in MAIN and never forward bearer headers or follow other hosts.
          if (download.origin !== location.origin || download.pathname !== "/backend-api/estuary/content"
            || download.searchParams.get("id") !== file.id) throw new Error("paste");
          // Descriptor/session reads also consume the budget. Recheck before
          // starting a signed download whose declared body cannot fit.
          if (file.size > maxCaptureBytes - bytesRead) { readLimitExceeded = true; metrics.fail("raw_remaining_files_limit", "attachment_body", "declared_files", file.size, maxCaptureBytes - bytesRead); throw new Error("paste"); }
          reply.captureRequestStage = "attachment_body";
          const textResponse = await fetchJson(download.href, { redirect: "error" });
          reply.status = textResponse.status;
          pastedTexts[file.id] = await readPaste(textResponse, file.size);
        } catch (error) {
          recordReadFailure(error, currentRead?.stage === "attachment_descriptor" && reply.captureRequestStage === "attachment_descriptor");
          // File-local failure excludes the entire body, never a decoded prefix.
          // Capture-wide identity, cancellation and read limits remain terminal.
          if (!readLimitExceeded && !controller.signal.aborted && !navigated && currentChat() === chat && error.message !== "auth") {
            metrics.recoverFile(error, reply.captureRequestStage);
            continue;
          }
          throw new Error(error?.message === "network" ? "network" : "paste");
        }
      }
      checkCaptureActive();
      reply.pastedTexts = pastedTexts;
      reply.data = data;
      reply.sourceTreeCounts = sourceTreeCounts;
    } catch (error) {
      // Never expose tokens, parser snippets, or arbitrary upstream errors.
      reply.error = navigated || controller.signal.reason === "account_changed" ? "changed"
        : controller.signal.reason === "capture_cancelled" ? "cancelled" : controller.signal.aborted ? "timeout"
        : ["http", "partial", "format", "auth", "changed", "paste", "size"].includes(error?.message) ? error.message : error?.name === "SyntaxError" ? "invalid_json" : "network";
      metrics.finish({ name: error?.name, captureDetail: ({ http: "http_error", partial: "partial_response", format: "non_json_response", auth: "auth_missing", changed: "conversation_changed", paste: "attachment_failed", timeout: "timeout", cancelled: "cancelled", invalid_json: "invalid_json", network: "network_error" })[reply.error], captureRequestStage: reply.captureRequestStage });
    } finally {
      clearTimeout(debugTimer);
      try { if (resourceObserver) logResourceTiming(resourceObserver.takeRecords()); } catch {}
      try { resourceObserver?.disconnect(); } catch {}
      clearTimeout(timer);
      clearTimeout(idleTimer);
      window.navigation?.removeEventListener("navigate", changed);
      window.removeEventListener("popstate", changed);
      if (active === controller) { active = null; activeMeasurementId = null; activeCaptureId = null; }
    }
    reply.jsonCapture = metrics.finish();
    debug("capture_done", { native, result: reply.error || "succeeded", bytes: metrics.data.raw_bytes,
      total_ms: Date.now() - debugStarted, aborted: controller.signal.aborted });
    window.postMessage(reply, location.origin);
  };
  window.addEventListener("message", receive);
  // The v2 channel leaves legacy v1 listeners inert after extension updates.
  window.__capChatGptFetchState = {
    version, fetch: wrappedFetch, headers: () => auth ? new Headers(auth) : null,
    dispose() {
      active?.abort();
      window.removeEventListener("message", receive);
      if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
    }
  };
})();
