(() => {
  const version = 15;
  // HTTP media types ignore casing; parameters do not change the base type.
  const responseMediaType = response => response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  // Unused branches and site metadata need room beyond the selected text cap.
  const maxHistoryBytes = 32000000;
  const previous = window.__capClaudeFetchState;
  if (previous?.version === version && window.fetch === previous.fetch) return;
  previous?.dispose();
  const nativeFetch = window.fetch;
  const endpoints = new Map();
  let active = null, activeMeasurementId = null;
  const channel = "cap-context-claude-json-v2";
  const remember = input => {
    try {
      const url = new URL(input, location.href);
      const match = url.pathname.match(/^\/api\/organizations\/[^/]+\/chat_conversations\/([^/]+)$/);
      if (url.origin !== location.origin || !match) return;
      endpoints.delete(match[1]);
      endpoints.set(match[1], url.href);
      if (endpoints.size > 64) endpoints.delete(endpoints.keys().next().value);
    } catch { /* Invalid fetch arguments must retain native behavior. */ }
  };
  // Resource timing is bounded and can be cleared by the page. Keep routes
  // already observed by the replaced hook, without retaining response bodies.
  for (const url of previous?.endpoints?.values() || []) remember(url);
  // Late installation (including extension reload) recovers routing URLs only.
  // No response bodies, credentials, or cross-chat endpoint guessing.
  const recover = () => {
    for (const entry of window.performance?.getEntriesByType("resource") || []) remember(entry.name);
  };
  recover();
  const wrappedFetch = function (...args) {
    const method = args[1]?.method || (args[0] instanceof Request ? args[0].method : "GET");
    if (typeof method === "string" && method.toUpperCase() === "GET") remember(args[0] instanceof Request ? args[0].url : args[0]);
    return Reflect.apply(nativeFetch, this, args);
  };
  window.fetch = wrappedFetch;

  const receive = async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.channel !== channel) return;
    if (typeof request.id !== "string" || request.id.length > 80) return;
    if (request.type === "cancel_measurement") {
      if (activeMeasurementId === request.id) active?.abort("measurement_cancelled");
      return;
    }
    if (request.type === "ping") {
      if (window.fetch === wrappedFetch) window.postMessage({ channel, type: "pong", id: request.id, version }, location.origin);
      return;
    }
    if (request.type !== "request") return;
    const chat = location.pathname.match(/^\/chat\/([^/]+)$/)?.[1];
    const reply = { channel, type: "response", id: request.id, chat };
    if (active) {
      window.postMessage({ ...reply, error: "busy" }, location.origin);
      return;
    }
    const controller = new AbortController();
    const metrics = globalThis.CapJsonCaptureMetrics.create({ adapter_version: version, deadline_ms: 15000, raw_limit_bytes: maxHistoryBytes, raw_bytes: 0, requests: 0 });
    active = controller;
    activeMeasurementId = request.measureOnly === true ? request.id : null;
    const timer = setTimeout(() => controller.abort("capture_timeout"), 15000);
    let captureFailureReason = "request_failed";
    let observation;
    const changed = event => {
      const destination = event?.destination ? new URL(event.destination.url) : location;
      if (destination.origin !== location.origin || destination.pathname !== `/chat/${chat}`) controller.abort();
    };
    window.navigation?.addEventListener("navigate", changed);
    window.addEventListener("popstate", changed);
    try {
      if (!chat || request.chat !== chat) throw new Error("changed");
      // Give an in-flight initial/SPA load a bounded opportunity to expose routing.
      const deadline = Date.now() + 1500;
      const routingStarted = Date.now();
      while (!endpoints.has(chat) && Date.now() < deadline && !controller.signal.aborted) {
        recover();
        if (endpoints.has(chat)) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      metrics.set({ auth_ms: Date.now() - routingStarted });
      if (controller.signal.aborted || location.pathname !== `/chat/${chat}`) throw new Error("changed");
      if (!endpoints.has(chat)) {
        captureFailureReason = "unavailable";
        reply.captureDetail = "routing_unavailable";
        throw new Error("routing");
      }
      const captureUrl = new URL(endpoints.get(chat));
      captureUrl.search = "";
      captureUrl.searchParams.set("tree", "True");
      captureUrl.searchParams.set("rendering_mode", "messages");
      captureUrl.searchParams.set("render_all_tools", "true");
      captureUrl.searchParams.set("include_inline_comparison", "true");
      captureUrl.searchParams.set("consistency", "strong");
      observation = metrics.response("history", maxHistoryBytes);
      const response = await Reflect.apply(nativeFetch, window, [captureUrl.href, { credentials: "same-origin", cache: "no-store", signal: controller.signal }]);
      reply.status = response.status;
      metrics.set({ http_status: response.status });
      observation.header(response.headers.get("content-length"));
      if (response.status !== 200 || response.headers.has("content-range") || responseMediaType(response) !== "application/json") {
        captureFailureReason = [401, 403].includes(response.status) ? "unavailable"
          : response.status === 206 || response.headers.has("content-range") || response.status === 200 ? "incomplete" : "request_failed";
        reply.captureDetail = response.status !== 200 && response.status !== 206 ? "http_error"
          : response.status === 206 || response.headers.has("content-range") ? "partial_response" : "non_json_response";
        metrics.fail(reply.captureDetail, "history", undefined, undefined, undefined, response.status);
        observation.end();
        // The rejected fresh response has no reader. Stop its unused body before
        // fallback, retaining the safe transport reason even if cleanup rejects.
        await response.body?.cancel().catch(() => {});
        throw new Error("transport");
      }
      let data, reader, bodyReadFailed = false;
      try {
        if (Number(response.headers.get("content-length")) > maxHistoryBytes) { metrics.fail("raw_header_limit", "history", "content_length", Number(response.headers.get("content-length")), maxHistoryBytes, response.status); throw new Error("size"); }
        // Transcript limits apply after parsing. Bound the owned raw stream too,
        // including inactive/tool metadata and bodies without Content-Length.
        reader = response.body?.getReader();
        const decoder = new TextDecoder("utf-8", { fatal: true });
        const parts = [];
        let size = 0;
        if (reader) while (true) {
          // Only a rejected native read qualifies for the existing JSON retry.
          const { done, value } = await reader.read().catch(() => {
            if (controller.signal.aborted || location.pathname !== `/chat/${chat}`) throw new Error("changed");
            bodyReadFailed = true;
            metrics.fail("network_error", "history");
            throw new Error("network");
          });
          if (controller.signal.aborted || location.pathname !== `/chat/${chat}`) throw new Error("changed");
          if (done) break;
          size += value.byteLength;
          observation.chunk(value.byteLength);
          if (size > maxHistoryBytes) { metrics.fail("raw_total_stream_limit", "history", "reader_bytes", size, maxHistoryBytes, response.status); throw new Error("size"); }
          let part;
          try { part = decoder.decode(value, { stream: true }); } catch (error) { metrics.fail("invalid_utf8", "history"); throw error; }
          if (part) parts.push(part);
        }
        // Preserve split UTF-8/BOM state and reject unfinished final bytes;
        // replacing corrupt bytes would silently change the captured text.
        try { parts.push(decoder.decode()); } catch (error) { metrics.fail("invalid_utf8", "history"); throw error; }
        observation.end();
        data = metrics.timed("parse_ms", () => JSON.parse(parts.join("")));
      } catch (error) {
        captureFailureReason = bodyReadFailed ? "request_failed" : "incomplete";
        if (reader) await reader.cancel().catch(() => {});
        else await response.body?.cancel().catch(() => {});
        throw error;
      } finally {
        observation.end();
        reader?.releaseLock();
      }
      if (controller.signal.aborted || location.pathname !== `/chat/${chat}` || data.uuid !== chat) throw new Error("changed");
      reply.data = data;
      metrics.set({ history_items: data.chat_messages?.length });
    } catch (error) {
      // Upstream/network/JSON-parser errors may contain private response content.
      reply.error = "capture_failed";
      reply.captureFailureReason = controller.signal.reason === "capture_timeout" ? "timeout" : captureFailureReason;
      reply.captureDetail = controller.signal.reason === "capture_timeout" ? "timeout"
        : error?.message === "changed" ? "conversation_changed" : reply.captureDetail
        || (error?.message === "size" ? "size_limit" : error?.name === "SyntaxError" ? "invalid_json" : captureFailureReason === "incomplete" ? "partial_response" : "network_error");
      metrics.finish({ captureDetail: reply.captureDetail, captureRequestStage: "history" });
    } finally {
      observation?.end();
      clearTimeout(timer);
      window.navigation?.removeEventListener("navigate", changed);
      window.removeEventListener("popstate", changed);
      if (active === controller) { active = null; activeMeasurementId = null; }
    }
    reply.jsonCapture = metrics.finish();
    window.postMessage(reply, location.origin);
  };
  window.addEventListener("message", receive);
  window.__capClaudeFetchState = {
    version, fetch: wrappedFetch, endpoints,
    dispose() {
      active?.abort();
      window.removeEventListener("message", receive);
      if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
    }
  };
})();
