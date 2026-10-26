(() => {
  const platform = ({ "gemini.google.com": "gemini", "grok.com": "grok", "chat.deepseek.com": "deepseek" })[location.hostname];
  if (!platform || !globalThis.__capNetworkJsonData) return;
  // Advance readiness version with adapter/contract changes: old MAIN closures
  // can survive extension reloads and must be replaced before a new capture.
  const version = platform === "deepseek" ? 31 : platform === "grok" ? 22 : 19, channel = "cap-context-network-json-v1";
  // Bound the whole download, including unused branches, separately from text.
  const maxCaptureBytes = 32000000;
  // Shared across unique text files; the final transcript has its own limits.
  const maxUploadBytes = 4100000;
  const previous = window.__capNetworkFetchState;
  if (previous?.version === version && window.fetch === previous.fetch
    && (platform === "grok" || previous?.ownsObservation?.())) return;
  let auth = previous?.auth?.() || null;
  let geminiTemplate = previous?.template?.() || null;
  previous?.dispose();
  const nativeFetch = window.fetch;
  const api = globalThis.__capNetworkJsonData;
  const current = () => {
    const pattern = platform === "gemini" ? /\/app\/([^/]+)\/?$/ : platform === "grok" ? /\/c\/([^/]+)\/?$/ : /\/a\/chat\/s\/([^/]+)\/?$/;
    return { chat: location.pathname.match(pattern)?.[1], selected: platform === "grok" ? new URL(location.href).searchParams.get("rid") : null };
  };
  let active = null, activeAuth = null, activeMeasurementId = null, onAuthObserved = null;
  // A cached chat or extension reload can precede our request observer. Use
  // DeepSeek's own current session, not a request that may never happen again.
  // Keep this credential in MAIN memory and send it only to same-origin history.
  const readDeepSeekAuth = () => {
    try {
      const saved = window.localStorage.getItem("userToken");
      if (saved === null) return null; // The site cleared its login; never reuse cached auth.
      const token = JSON.parse(saved)?.value;
      if (token === "" || token === null) return null;
      return typeof token === "string" && !/\s/.test(token) ? `Bearer ${token}` : undefined;
    } catch { return undefined; } // Unknown/blocked storage retains native observation.
  };
  const observe = (input, options) => {
    try {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      if (url.origin !== location.origin) return;
      if (platform === "deepseek" && url.pathname.startsWith("/api/v0/")) {
        const headers = new Headers(options?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (headers.get("authorization")) {
          // Compare with this read's credential, not a stale observation from
          // before it began. A current native request can confirm stored auth.
          if (activeAuth && activeAuth !== headers.get("authorization")) active?.abort("session_changed");
          auth = headers.get("authorization");
          onAuthObserved?.();
        }
      }
      if (platform === "gemini" && url.pathname === "/_/BardChatUi/data/batchexecute") {
        geminiTemplate = { ...geminiTemplate, url: url.href };
        if (typeof options?.body === "string" || options?.body instanceof URLSearchParams) {
          const form = new URLSearchParams(options.body);
          if (form.get("at")) geminiTemplate.at = form.get("at");
          const rpc = JSON.parse(form.get("f.req") || "null")?.[0]?.find(row => row?.[0] === "hNvQHb");
          if (rpc) geminiTemplate.args = JSON.parse(rpc[1]);
        }
      }
    } catch { /* Observing must never change the site's native fetch/XHR. */ }
  };
  // A native login request can arrive just after capture starts. Wait only for
  // observed same-origin auth; this grace period shares the capture deadline.
  const waitForAuth = signal => new Promise(resolve => {
    let timer, settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      if (onAuthObserved === finish) onAuthObserved = null;
      resolve();
    };
    onAuthObserved = finish;
    signal.addEventListener("abort", finish, { once: true });
    timer = setTimeout(finish, 1500);
    if (auth || signal.aborted) finish();
  });
  const wrappedFetch = function (...args) { observe(args[0], args[1]); return Reflect.apply(nativeFetch, this, args); };
  window.fetch = wrappedFetch;
  // Gemini's RPC and DeepSeek's authenticated history both use native XHR.
  // Observe outgoing routing/auth only, without reading any response bodies.
  const xhr = platform !== "grok" ? window.XMLHttpRequest?.prototype : null;
  const nativeOpen = xhr?.open, nativeSend = xhr?.send, nativeSetHeader = xhr?.setRequestHeader;
  const xhrRequests = new WeakMap();
  const replyingRequests = new Set();
  let disposed = false;
  const wrappedOpen = function (...args) { xhrRequests.set(this, { url: args[1], headers: new Headers() }); return Reflect.apply(nativeOpen, this, args); };
  const wrappedSetHeader = function (...args) {
    try { xhrRequests.get(this)?.headers.append(args[0], args[1]); } catch { /* Native XHR owns header validation. */ }
    return Reflect.apply(nativeSetHeader, this, args);
  };
  const publishReplyState = () => {
    if (!disposed) window.postMessage({ channel, platform, type: "generation", pathname: location.pathname,
      active: [...replyingRequests].some(request => request.pathname === location.pathname) }, location.origin);
  };
  const wrappedSend = function (...args) {
    const meta = xhrRequests.get(this);
    observe(meta?.url, { headers: meta?.headers, body: args[0] });
    // DeepSeek's stop control has no stable accessible label. Observe only the
    // native request lifetime; never read its stream or change its response.
    let url;
    try { url = new URL(meta?.url || location.href, location.href); } catch { /* Observation cannot reject native requests. */ }
    if (platform === "deepseek" && url?.origin === location.origin && /^\/api\/v0\/chat\/(?:completion|continue)$/.test(url.pathname) && typeof this.addEventListener === "function") {
      const request = { pathname: location.pathname };
      replyingRequests.add(request);
      const finished = () => { replyingRequests.delete(request); publishReplyState(); };
      this.addEventListener("loadend", finished, { once: true });
      publishReplyState();
      try { return Reflect.apply(nativeSend, this, args); } catch (error) { finished(); throw error; }
    }
    return Reflect.apply(nativeSend, this, args);
  };
  if (xhr) { xhr.open = wrappedOpen; xhr.send = wrappedSend; if (nativeSetHeader) xhr.setRequestHeader = wrappedSetHeader; }
  // Gemini and DeepSeek use XHR as well as fetch. A replacement of either surface
  // makes the cached observer stale and must trigger bounded hook recovery.
  const ownsObservation = () => window.fetch === wrappedFetch && (!xhr
    || (window.XMLHttpRequest?.prototype === xhr && xhr.open === wrappedOpen
      && xhr.send === wrappedSend && (!nativeSetHeader || xhr.setRequestHeader === wrappedSetHeader)));

  const receive = async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.channel !== channel || request.platform !== platform || typeof request.id !== "string" || request.id.length > 80) return;
    if (request.type === "cancel_measurement") {
      if (activeMeasurementId === request.id) active?.abort("measurement_cancelled");
      return;
    }
    if (request.type === "ping") {
      publishReplyState();
      if (platform === "grok" || ownsObservation()) window.postMessage({ channel, type: "pong", platform, version, id: request.id }, location.origin);
      return;
    }
    if (request.type !== "request") return;
    const { chat, selected } = current();
    const reply = { channel, type: "response", platform, chat, selected, id: request.id };
    if (active) { window.postMessage({ ...reply, error: "Another fast capture is running. Try again after it finishes.", captureFailureReason: "unavailable", captureDetail: "busy", captureRequestStage: "history" }, location.origin); return; }
    const controller = new AbortController();
    let storedAuth = null;
    const metrics = globalThis.CapJsonCaptureMetrics.create({ adapter_version: version, deadline_ms: 25000, raw_limit_bytes: maxCaptureBytes, raw_bytes: 0, requests: 0 });
    const measureOnly = request.measureOnly === true;
    const omitLargeFiles = platform === "deepseek" && !measureOnly && request.omitLargeFiles === true;
    // The independent DOM size check reports numbers only. Its best-effort
    // strings must never pass through ordinary capture's acceptance path.
    if (measureOnly) metrics.transcript = () => true;
    const publishCount = capture => {
      reply.characterCount = capture.text.length;
      reply.messageTurnCount = capture.messageTurnCount;
    };
    let roughEstimate;
    const publishEstimate = value => {
      roughEstimate = value;
      window.postMessage({ channel, platform, type: "measurement_progress", id: request.id, chat, selected, ...value }, location.origin);
    };
    active = controller;
    activeMeasurementId = measureOnly ? request.id : null;
    const timer = setTimeout(() => controller.abort("capture_timeout"), 25000);
    const check = () => {
      const now = current();
      if (controller.signal.aborted) throw new api.CaptureError("The capture request timed out or was cancelled.", controller.signal.reason === "capture_timeout" ? "timeout" : "request_failed", controller.signal.reason === "capture_timeout" ? "timeout" : "conversation_changed");
      if (!chat || request.chat !== chat || request.selected !== selected || now.chat !== chat || now.selected !== selected) throw new api.CaptureError("The conversation changed during capture.", "request_failed", "conversation_changed");
      if (storedAuth && readDeepSeekAuth() !== storedAuth) {
        controller.abort("session_changed");
        throw new api.CaptureError("The conversation changed during capture.", "request_failed", "conversation_changed");
      }
    };
    const changed = event => {
      if (event?.destination?.url) {
        const target = new URL(event.destination.url);
        if (target.pathname === location.pathname && target.search === location.search) return;
      }
      controller.abort();
    };
    window.navigation?.addEventListener("navigate", changed);
    window.addEventListener("popstate", changed);
    const sessionChanged = event => {
      if (storedAuth && (event.key === "userToken" || event.key === null) && readDeepSeekAuth() !== storedAuth) controller.abort("session_changed");
    };
    if (platform === "deepseek") window.addEventListener("storage", sessionChanged);
    let bytesRead = 0;
    const read = async (url, options = {}, type = "json", expectedSize, fileIndex) => {
      check();
      let response, reader, size = 0, phase = "fetch";
      const began = Date.now();
      const stage = type === "file" ? "attachment_body" : "history";
      const remaining = maxCaptureBytes - bytesRead;
      const observation = metrics.response(stage, remaining);
      // Capture only what the browser actually exposed. A rejected fetch may
      // hide CORS/redirect/DNS causes; never infer them or copy exception prose.
      const failRead = (reason, error, source, value, limit) => {
        const rules = globalThis.CapTransferDiagnostics.jsonAttemptSchema;
        const mime = response?.headers?.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
        const errorType = error instanceof api.CaptureError ? "CaptureError" : error?.name;
        metrics.fail(reason, stage, source, value, limit, response?.status, type === "file" ? {
          failure_phase: phase,
          failure_error_type: rules.failure_error_type.values.includes(errorType) ? errorType : "other",
          failure_response_type: response ? (rules.failure_response_type.values.includes(response.type) ? response.type : "other") : "none",
          failure_abort: !controller.signal.aborted ? "none" : ["capture_timeout", "attachment_failed"].includes(controller.signal.reason) ? controller.signal.reason : "other",
          failure_online: typeof navigator === "undefined" || typeof navigator.onLine !== "boolean" ? "unknown" : navigator.onLine ? "online" : "offline",
          failure_content_type: !mime ? "missing" : mime === "text/html" ? "html" : mime === "application/json" ? "json"
            : mime === "application/octet-stream" ? "octet_stream" : mime.startsWith("text/") ? "text" : "other",
          failure_http_status: response?.status,
          failure_file_index: fileIndex, failure_file_bytes: expectedSize,
          failure_read_bytes: size, failure_request_ms: Date.now() - began
        } : undefined);
      };
      try {
        // Native text preview follows its file service's redirects. Only these
        // validated signed GETs may do so: never send login cookies or a chat
        // referrer, and keep authenticated history requests redirect-strict.
        const fileDownload = platform === "deepseek" && type === "file";
        response = await Reflect.apply(nativeFetch, window, [url, { ...options,
          credentials: fileDownload ? "omit" : options.credentials || "same-origin",
          redirect: fileDownload ? "follow" : "error",
          ...(fileDownload ? { referrerPolicy: "no-referrer" } : {}), signal: controller.signal }]);
        phase = "headers";
        check();
        if (response.status !== 200 || response.headers.get("content-range")) throw new api.CaptureError("The history request failed or returned a partial response.", response.status === 206 || response.headers.get("content-range") ? "incomplete" : "request_failed", response.status === 206 || response.headers.get("content-range") ? "partial_response" : "http_error");
        const contentType = response.headers.get("content-type") || "";
        if (type === "json" && !/application\/json/i.test(contentType)) throw new api.CaptureError("The history request returned an unsupported response.", "incomplete", "non_json_response");
        if (type === "rpc" && !/(application\/json|text\/plain)/i.test(contentType)) throw new api.CaptureError("Gemini returned an unsupported RPC response.", "incomplete", "non_json_response");
        if (type === "file" && !/^(text\/plain|text\/markdown|text\/csv|application\/(json|octet-stream))(;|$)/i.test(contentType)) throw new api.CaptureError("A text attachment returned an unsupported response.", "incomplete", "non_json_response");
        const header = response.headers.get("content-length");
        metrics.set({ http_status: response.status });
        observation.header(header);
        if (Number(header) > maxCaptureBytes - bytesRead) {
          failRead("raw_header_limit", null, "content_length", Number(header), maxCaptureBytes - bytesRead);
          throw new api.CaptureError("size");
        }
        // Enforce the shared budget while reading, including history without
        // Content-Length. Files also stop at their declared original byte count.
        reader = response.body?.getReader();
        // Decode accepted chunks directly: retaining bytes and copying them into
        // a second complete buffer adds no validation. One decoder preserves
        // split UTF-8/BOM state; the final flush rejects an incomplete codepoint.
        const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: type === "file" });
        const parts = [];
        if (reader) while (true) {
          phase = "body";
          const { done, value } = await reader.read().catch(error => { failRead(controller.signal.reason === "capture_timeout" ? "timeout" : controller.signal.aborted ? "conversation_changed" : "network_error", error); throw error; });
          check();
          if (done) break;
          size += value.byteLength;
          bytesRead += value.byteLength;
          observation.chunk(value.byteLength);
          if (bytesRead > maxCaptureBytes) {
            failRead("raw_total_stream_limit", null, "reader_bytes", bytesRead, maxCaptureBytes);
            throw new api.CaptureError("size");
          }
          if (type === "file" && size > expectedSize) {
            failRead("attachment_length_mismatch", null, "reader_bytes", size, expectedSize);
            throw new api.CaptureError("A text attachment is incomplete.", "incomplete", "attachment_failed");
          }
          phase = "decode";
          const part = metrics.timed("parse_ms", () => { try { return decoder.decode(value, { stream: true }); } catch (error) { failRead("invalid_utf8", error); throw error; } });
          if (part) parts.push(part);
        }
        check();
        phase = "decode";
        try { parts.push(decoder.decode()); } catch (error) { failRead("invalid_utf8", error); throw error; }
        observation.end();
        const text = parts.join("");
        phase = "parse";
        return type === "json" ? metrics.timed("parse_ms", () => JSON.parse(text)) : { text, size };
      } catch (error) {
        failRead(error?.captureDetail || (error?.name === "SyntaxError" ? "invalid_json" : "network_error"), error);
        // Per-read metadata stays on the error: overlapping attachment reads
        // must never replace the failing request's status with a sibling's.
        error.captureRequestStage = type === "file" ? "attachment_body" : "history";
        error.captureHttpStatus = response?.status;
        // Rejected headers still own an unread body. Cancel that body too,
        // preserving the structural error even if native cancellation fails.
        if (reader) await reader.cancel().catch(() => {});
        else await response?.body?.cancel().catch(() => {});
        throw error;
      } finally {
        observation.end();
        reader?.releaseLock();
      }
    };
    try {
      check();
      if (platform === "gemini") {
        // Resource timing recovers routing after a late extension install. The
        // native bootstrap exposes the same CSRF value sent as the RPC's `at`.
        if (!geminiTemplate?.url) {
          const entries = performance.getEntriesByType("resource");
          const endpoint = entries.map(entry => entry.name).reverse().find(name => {
            const url = new URL(name, location.href);
            return url.origin === location.origin && url.pathname === "/_/BardChatUi/data/batchexecute";
          });
          if (endpoint) geminiTemplate = { url: endpoint };
        }
        const bootstrap = window.WIZ_global_data;
        const at = bootstrap?.SNlM0e || geminiTemplate?.at;
        if (typeof at !== "string" || !at) throw new api.CaptureError("Refresh this signed-in Gemini chat to make fast capture ready.", "unavailable", "auth_missing");
        // A cached chat or late install need not have a batchexecute timing entry.
        // The native bootstrap is sufficient to make this explicit fresh read;
        // do not click response menus merely to observe a request template.
        const url = new URL(geminiTemplate?.url || "/_/BardChatUi/data/batchexecute", location.origin);
        url.searchParams.set("rpcids", "hNvQHb");
        url.searchParams.set("source-path", location.pathname);
        if (typeof bootstrap?.cfb2h === "string") url.searchParams.set("bl", bootstrap.cfb2h);
        if (typeof bootstrap?.FdrFJe === "string") url.searchParams.set("f.sid", bootstrap.FdrFJe);
        const args = Array.isArray(geminiTemplate?.args) ? [...geminiTemplate.args] : [null, 10, null, 1, [1], [4], null, 1];
        args[0] = `c_${chat}`; args[1] = 10; args[2] = null;
        const pages = [], cursors = new Set();
        do {
          const body = new URLSearchParams({ at, "f.req": JSON.stringify([[["hNvQHb", JSON.stringify(args), null, "generic"]]]) });
          const response = await read(url.href, { method: "POST", body }, "rpc");
          const page = metrics.timed("parse_ms", () => api.geminiPage(response.text));
          metrics.add("pages"); metrics.add("history_items", page.turns.length);
          pages.push(page);
          if (measureOnly) publishEstimate(api.roughSize(platform, pages, null, chat));
          if (page.cursor !== null && (cursors.has(page.cursor) || !page.turns.length)) throw new api.CaptureError("Gemini history pagination did not advance.");
          cursors.add(page.cursor); args[2] = page.cursor;
        } while (args[2] !== null);
        reply.capture = metrics.timed("serialize_ms", () => api.gemini(pages, chat, metrics, measureOnly));
      } else if (platform === "grok") {
        const base = `/rest/app-chat/conversations/${encodeURIComponent(chat)}`;
        const nodes = await read(`${base}/response-node`);
        metrics.set({ history_items: nodes?.responseNodes?.length });
        if (measureOnly) publishEstimate(api.roughSize(platform, nodes, selected));
        const branch = api.grokBranch(nodes, selected);
        const responses = [];
        // Load only the active branch, bounded batches using the site's native
        // load-responses request. No file, search or tool result fetches.
        for (let i = 0; i < branch.length; i += 100) {
          const data = await read(`${base}/load-responses`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ responseIds: branch.slice(i, i + 100).map(node => node.responseId) }) });
          api.complete(data);
          if (!Array.isArray(data?.responses)) throw new api.CaptureError("Grok returned incomplete message bodies.");
          responses.push(...data.responses);
        }
        reply.capture = metrics.timed("serialize_ms", () => api.grok(nodes, responses, selected, metrics, measureOnly));
      } else {
        // Omitting x-device-id/cache client headers makes DeepSeek return a
        // full REPLACE snapshot. A MERGE/delta must never count as full history.
        storedAuth = readDeepSeekAuth();
        if (storedAuth === null) auth = null;
        if (!storedAuth && !auth) { const began = Date.now(); await waitForAuth(controller.signal); metrics.set({ auth_ms: Date.now() - began }); check(); }
        // Login may have completed while waiting, without another observed request.
        storedAuth = readDeepSeekAuth();
        const captureAuth = storedAuth === undefined ? auth : storedAuth;
        if (!captureAuth) throw new api.CaptureError("Refresh this signed-in DeepSeek chat to make fast capture ready.", "unavailable", "auth_missing");
        activeAuth = captureAuth;
        const data = await read(`/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(chat)}`, { headers: { authorization: captureAuth } });
        if (measureOnly && data?.code === 0 && data?.data?.biz_code === 0 && data.data.biz_data?.chat_session?.id === chat)
          publishEstimate(api.roughSize(platform, data.data.biz_data, data.data.biz_data.chat_session.current_message_id));
        metrics.set({ history_items: data?.data?.biz_data?.chat_messages?.length, files_limit_bytes: maxUploadBytes,
          files_supported: 0, files_ignored: 0, files_declared_bytes: 0, files_downloaded_bytes: 0 });
        const branch = api.deepseekBranch(data, chat);
        const files = Object.create(null);
        const measureDeepseek = () => {
          try { publishCount(api.deepseek(data, chat, files, metrics, true)); }
          catch (error) {
            // A file-only turn may have no readable text until its download
            // finishes. Zero here means unknown content, never safe admission.
            if (error.captureDetail !== "missing_text") throw error;
            reply.characterCount = 0;
          }
        };
        if (measureOnly) {
          measureDeepseek();
          // The fresh history alone can already prove excess. Otherwise fetch
          // text files too; their contents may be what pushes it over the cap.
          if (reply.characterCount > 1000000) return;
        }
        const uploads = new Map();
        let uploadBytes = 0;
        for (const message of branch) {
          if (message.role !== "USER") continue;
          for (const fragment of message.fragments || []) for (const file of fragment.type === "FILE" ? api.fileList(fragment.files) : []) {
            try {
              if (!api.textFile(file)) { metrics.ignored(typeof file?.file_name === "string" && /\.pdf$/i.test(file.file_name) ? "pdf" : "other", file?.is_image === true); continue; }
              if (file.status !== "SUCCESS" || !Number.isSafeInteger(file.file_size) || file.file_size < 0 || typeof file.signed_path !== "string") throw new api.CaptureError("A text attachment is unavailable or incomplete.", "incomplete", "attachment_failed");
              // DeepSeek's native preview uses this signed file service with ty=r
              // for original bytes. No session bearer/cookies go to that host.
              const url = new URL(file.signed_path.startsWith("/") ? `https://files.deepseeksvc.com/api${file.signed_path}` : file.signed_path);
              if (url.origin !== "https://files.deepseeksvc.com" || url.pathname !== "/api/file" || url.username || url.password || url.searchParams.get("file_id") !== file.id?.replace(/^file-/, "")) throw new api.CaptureError("A text attachment has an unsupported download address.", "incomplete", "attachment_failed");
              // Match the native append-only builder. URLSearchParams.set
              // re-encodes existing signed query bytes (%20, ~, hex case).
              url.search += (url.search ? "&" : "?") + "ty=r";
              if (uploads.has(file.id)) {
                if (uploads.get(file.id).file.file_size !== file.file_size) throw new api.CaptureError("A text attachment is incomplete.", "incomplete", "attachment_failed");
                continue;
              }
              const nextUploadBytes = uploadBytes + file.file_size;
              metrics.add("files_supported"); metrics.add("files_declared_bytes", file.file_size);
              // Only the selected DeepSeek -> ChatGPT path requests this mode.
              // Retain file identity/size, but never fetch its oversized body.
              if (omitLargeFiles && file.file_size > maxUploadBytes) {
                uploads.set(file.id, { file, url, omitted: true });
                continue;
              }
              if (nextUploadBytes > maxUploadBytes) { metrics.fail("supported_files_limit", "attachment_descriptor", "declared_files", nextUploadBytes, maxUploadBytes); throw Object.assign(
                new api.CaptureError("Text attachments exceed the combined 4.1 MB capture limit.", "size_limit", "attachment_size_limit"),
                { captureRequestStage: "attachment_descriptor" }); }
              uploadBytes = nextUploadBytes;
              uploads.set(file.id, { file, url });
            } catch (error) {
              if (!measureOnly && error.captureFailureReason === "size_limit") throw error;
              // A bad descriptor excludes this file, never the verified history.
              check();
            }
          }
        }
        // Independent original-file reads overlap; serialization still follows
        // branch/fragment order. Validate all descriptors before any download.
        const pending = [...uploads.values()].filter(upload => !upload.omitted);
        let next = 0, failure;
        const download = async () => {
          try {
            while (next < pending.length) {
              check();
              const fileIndex = next++;
              const { file, url } = pending[fileIndex];
              try {
                const content = await read(url.href, { credentials: "omit" }, "file", file.file_size, fileIndex + 1);
                if (content.size !== file.file_size) { metrics.fail("attachment_length_mismatch", "attachment_body", "reader_bytes", content.size, file.file_size); throw new api.CaptureError("A text attachment is incomplete.", "incomplete", "attachment_failed"); }
                files[file.id] = content.text;
                if (measureOnly) {
                  measureDeepseek();
                  if (reply.characterCount > 1000000) { controller.abort("size_limit"); return; }
                }
              } catch (error) {
                if (!measureOnly && error.captureFailureReason === "size_limit") throw error;
                // read() has cancelled/released this body's reader. Continue
                // healthy siblings and queued files; do not accept partial bytes.
                check();
              }
            }
          } catch (error) {
            if (!failure) { failure = error; if (!measureOnly) controller.abort("attachment_failed"); }
          }
        };
        // Global cancellation/size failures still settle every owned read before
        // releasing capture. File-local failures leave healthy siblings running.
        await Promise.all(Array.from({ length: Math.min(4, pending.length) }, download));
        if (failure && !measureOnly) throw failure;
        if (measureOnly) {
          if (controller.signal.reason !== "size_limit") check();
          measureDeepseek();
          return;
        }
        reply.capture = metrics.timed("serialize_ms", () => api.deepseek(data, chat, files, metrics, false, omitLargeFiles));
        if (reply.capture.omittedFiles?.length) metrics.set({ outcome: "partial" });
      }
      check();
      if (measureOnly) { publishCount(reply.capture); delete reply.capture; }
    } catch (error) {
      delete reply.capture;
      if (controller.signal.reason === "session_changed") error = new api.CaptureError("The conversation changed during capture.", "request_failed", "conversation_changed");
      metrics.fail(error?.jsonFailureCheck || error?.captureDetail, error?.captureRequestStage || "serialize");
      // Adapter errors contain structural reasons only. Never return fetch,
      // JSON parser or decoder errors, which can contain private response text.
      const reason = error?.message;
      reply.error = error instanceof api.CaptureError && reason.length < 180
        ? reason : "The conversation could not be read completely. Refresh this chat and try again.";
      reply.captureFailureReason = error instanceof api.CaptureError ? error.captureFailureReason
        : controller.signal.reason === "capture_timeout" ? "timeout" : "request_failed";
      reply.captureDetail = controller.signal.reason === "capture_timeout" ? "timeout"
        : error?.captureDetail || (error?.name === "SyntaxError" ? "invalid_json" : "network_error");
      reply.captureRequestStage = error?.captureRequestStage || "serialize";
      if (Number.isInteger(error?.captureHttpStatus)) reply.status = error.captureHttpStatus;
      metrics.finish({ captureDetail: reply.captureDetail, captureRequestStage: reply.captureRequestStage });
    } finally {
      clearTimeout(timer);
      window.navigation?.removeEventListener("navigate", changed);
      window.removeEventListener("popstate", changed);
      if (platform === "deepseek") window.removeEventListener("storage", sessionChanged);
      if (active === controller) { active = null; activeAuth = null; activeMeasurementId = null; }
      // Release the native read before resolving its count, so a new transfer
      // cannot race cancelled sibling downloads and get a false busy failure.
      if (measureOnly) {
        delete reply.capture;
        if (reply.captureDetail !== "conversation_changed" && !controller.signal.aborted && roughEstimate?.messageTurnCount > 0
            && reply.characterCount === undefined) Object.assign(reply, { characterCount: 0 }, roughEstimate);
        window.postMessage(reply, location.origin);
      }
    }
    if (measureOnly) return;
    reply.jsonCapture = metrics.finish();
    window.postMessage(reply, location.origin);
  };
  window.addEventListener("message", receive);
  window.__capNetworkFetchState = { version, fetch: wrappedFetch, ownsObservation, auth: () => auth, template: () => geminiTemplate,
    dispose() {
      replyingRequests.clear(); publishReplyState(); disposed = true;
      active?.abort(); window.removeEventListener("message", receive);
      if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
      if (xhr?.open === wrappedOpen) xhr.open = nativeOpen;
      if (xhr?.send === wrappedSend) xhr.send = nativeSend;
      if (xhr?.setRequestHeader === wrappedSetHeader) xhr.setRequestHeader = nativeSetHeader;
    }
  };
})();
