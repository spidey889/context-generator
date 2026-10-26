(() => {
  const version = 24;
  // HTTP media types ignore casing; parameters do not change the base type.
  const responseMediaType = response => response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  // Match MIME metadata by base type, keeping the serializer's paste gate aligned.
  const isPlainTextPaste = file => file?.is_big_paste === true && typeof file.mime_type === "string"
    && file.mime_type.split(";", 1)[0].trim().toLowerCase() === "text/plain";
  // ChatGPT's native endpoint returns every branch. This is a transport safety
  // ceiling, not the selected transcript's 1M-character / 4 MB content limit.
  const maxCaptureBytes = 32000000;
  // Shared across unique pasted files; the final transcript has its own limits.
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
    if (event.source !== window || event.origin !== location.origin || request?.channel !== channel || !["request", "ping", "cancel_measurement", "cancel_capture"].includes(request.type)) return;
    if (typeof request.id !== "string" || request.id.length > 80) return;
    if (request.type === "cancel_measurement") {
      if (activeMeasurementId === request.id) active?.abort("measurement_cancelled");
      return;
    }
    if (request.type === "cancel_capture") {
      // Correlate ordinary cancellation separately: an old picker or a count
      // cancellation must never abort a newer capture or a measurement.
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
    if (active) { window.postMessage({ ...reply, error: "busy" }, location.origin); return; }
    const controller = new AbortController();
    const metrics = globalThis.CapJsonCaptureMetrics.create({ adapter_version: version, deadline_ms: 15000, raw_limit_bytes: maxCaptureBytes,
      raw_bytes: 0, requests: 0, auth_refreshes: 0 });
    active = controller;
    activeMeasurementId = request.measureOnly === true ? request.id : null;
    activeCaptureId = request.measureOnly === true ? null : request.id;
    let navigated = false;
    const changed = event => {
      const destination = event?.destination ? new URL(event.destination.url) : location;
      if (destination.origin !== location.origin || currentChat(destination.pathname) !== chat) {
        navigated = true;
        controller.abort();
      }
    };
    const timer = setTimeout(() => controller.abort(), 15000);
    window.navigation?.addEventListener("navigate", changed);
    window.addEventListener("popstate", changed);
    const fetchJson = async (url, options = {}) => {
      delete reply.status;
      delete metrics.data.http_status;
      metrics.add("requests");
      const began = Date.now();
      try { const response = await Reflect.apply(nativeFetch, window, [url, {
      ...options, credentials: "same-origin", cache: "no-store", signal: controller.signal
      }]); metrics.set({ http_status: response.status }); return response;
      } finally { metrics.add("download_ms", Date.now() - began); }
    };
    // Discard owned responses before retry/fallback; cleanup must never replace
    // the bounded capture error with private upstream cancellation details.
    const discardResponse = response => response.body?.cancel().catch(() => {});
    // Bound the entire owned read, not each request: session refreshes and
    // repeated descriptors share the allowance with history and original files.
    let bytesRead = 0;
    const readJson = async (response, responseLimit = 6000000) => {
      let reader, bodyReadFailed = false;
      const stage = reply.captureRequestStage || "history";
      const remaining = Math.min(responseLimit, maxCaptureBytes - bytesRead);
      const observation = metrics.response(stage, remaining, response.headers.get("content-length"), false);
      try {
        if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
        if (Number(response.headers.get("content-length")) > remaining) { metrics.fail("raw_header_limit", stage, "content_length", Number(response.headers.get("content-length")), remaining, response.status); throw new Error("partial"); }
        reader = response.body?.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        const parts = [];
        let responseBytes = 0;
        if (reader) while (true) {
          // Retry a rejected network read, not decoder/JSON/size failures.
          const { done, value } = await reader.read().catch(() => {
            if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
            bodyReadFailed = true;
            metrics.fail("network_error", stage);
            throw new Error("network");
          });
          if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
          if (done) break;
          bytesRead += value.byteLength;
          responseBytes += value.byteLength;
          observation.chunk(value.byteLength);
          if (responseBytes > remaining) { metrics.fail("raw_response_stream_limit", stage, "reader_bytes", responseBytes, remaining, response.status); throw new Error("partial"); }
          let part;
          try { part = decoder.decode(value, { stream: true }); } catch (error) { metrics.fail("invalid_utf8", stage); throw error; }
          if (part) parts.push(part);
        }
        // Flush partial UTF-8 at EOF. Silent replacement would alter source
        // text; parse only a complete, strictly decoded response.
        try { parts.push(decoder.decode()); } catch (error) { metrics.fail("invalid_utf8", stage); throw error; }
        observation.end();
        return metrics.timed("parse_ms", () => JSON.parse(parts.join("")));
      } catch (error) {
        if (error?.name === "SyntaxError") metrics.fail("invalid_json", stage);
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
      const observation = metrics.response("attachment_body", maxCaptureBytes - bytesRead, response.headers.get("content-length"), false);
      try {
        if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
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
        if (reader) while (true) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
          if (done) break;
          observation.chunk(value.byteLength);
          if (size + value.byteLength > expectedSize) { metrics.fail("attachment_length_mismatch", "attachment_body", "reader_bytes", size + value.byteLength, expectedSize); throw new Error("paste"); }
          bytesRead += value.byteLength;
          if (bytesRead > maxCaptureBytes) { metrics.fail("raw_total_stream_limit", "attachment_body", "reader_bytes", bytesRead, maxCaptureBytes); throw new Error("paste"); }
          bytes.set(value, size); size += value.byteLength;
        }
        if (size !== expectedSize) { metrics.fail("attachment_length_mismatch", "attachment_body", "reader_bytes", size, expectedSize); throw new Error("paste"); }
        // Preserve complete UTF-8, BOM and whitespace through chunk boundaries.
        try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); } catch (error) { metrics.fail("invalid_utf8", "attachment_body"); throw error; }
      } catch (error) {
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
      } catch (error) { metrics.fail(({ http: "http_error", partial: "partial_response", format: "non_json_response" })[error?.message], reply.captureRequestStage, undefined, undefined, undefined, response.status); await discardResponse(response); throw error; }
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
          } catch (error) { if (request.measureOnly !== true) throw error; }
        }
      }
      // Validate the complete qualifying manifest before remote file work.
      // Repeated IDs share one read, but every declaration must match its bytes.
      if (request.measureOnly !== true && pastedBytes > maxCaptureBytes - bytesRead) { metrics.fail("raw_remaining_files_limit", "attachment_descriptor", "declared_files", pastedBytes, maxCaptureBytes - bytesRead); throw new Error("paste"); }
      for (const file of uploads.values()) {
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
          if (file.size > maxCaptureBytes - bytesRead) { metrics.fail("raw_remaining_files_limit", "attachment_body", "declared_files", file.size, maxCaptureBytes - bytesRead); throw new Error("paste"); }
          reply.captureRequestStage = "attachment_body";
          const textResponse = await fetchJson(download.href, { redirect: "error" });
          reply.status = textResponse.status;
          pastedTexts[file.id] = await readPaste(textResponse, file.size);
        } catch (error) {
          if (request.measureOnly === true && !controller.signal.aborted && currentChat() === chat) continue;
          // Preserve readJson's transport marker; file validation stays closed.
          throw new Error(error?.message === "network" ? "network" : "paste");
        }
      }
      if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
      reply.pastedTexts = pastedTexts;
      reply.data = data;
      reply.sourceTreeCounts = sourceTreeCounts;
    } catch (error) {
      // Never expose tokens, parser snippets, or arbitrary upstream errors.
      reply.error = navigated || controller.signal.reason === "account_changed" ? "changed"
        : controller.signal.reason === "capture_cancelled" ? "cancelled" : controller.signal.aborted ? "timeout"
        : ["http", "partial", "format", "auth", "changed", "paste", "size"].includes(error?.message) ? error.message : error?.name === "SyntaxError" ? "invalid_json" : "network";
      metrics.finish({ captureDetail: ({ http: "http_error", partial: "partial_response", format: "non_json_response", auth: "auth_missing", changed: "conversation_changed", paste: "attachment_failed", timeout: "timeout", cancelled: "cancelled", invalid_json: "invalid_json", network: "network_error" })[reply.error], captureRequestStage: reply.captureRequestStage });
    } finally {
      clearTimeout(timer);
      window.navigation?.removeEventListener("navigate", changed);
      window.removeEventListener("popstate", changed);
      if (active === controller) { active = null; activeMeasurementId = null; activeCaptureId = null; }
    }
    reply.jsonCapture = metrics.finish();
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
