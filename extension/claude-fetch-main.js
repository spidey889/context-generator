(() => {
  const version = 4;
  const previous = window.__capClaudeFetchState;
  if (previous?.version === version && window.fetch === previous.fetch) return;
  previous?.dispose();
  const nativeFetch = window.fetch;
  const endpoints = new Map();
  let active = null;
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
    active = controller;
    const timer = setTimeout(() => controller.abort("capture_timeout"), 15000);
    let captureFailureReason = "request_failed";
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
      while (!endpoints.has(chat) && Date.now() < deadline && !controller.signal.aborted) {
        recover();
        if (endpoints.has(chat)) break;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (controller.signal.aborted || location.pathname !== `/chat/${chat}`) throw new Error("changed");
      if (!endpoints.has(chat)) {
        captureFailureReason = "unavailable";
        throw new Error("routing");
      }
      const captureUrl = new URL(endpoints.get(chat));
      captureUrl.search = "";
      captureUrl.searchParams.set("tree", "True");
      captureUrl.searchParams.set("rendering_mode", "messages");
      captureUrl.searchParams.set("render_all_tools", "true");
      captureUrl.searchParams.set("include_inline_comparison", "true");
      captureUrl.searchParams.set("consistency", "strong");
      const response = await Reflect.apply(nativeFetch, window, [captureUrl.href, { credentials: "same-origin", cache: "no-store", signal: controller.signal }]);
      if (response.status !== 200 || response.headers.has("content-range") || !response.headers.get("content-type")?.includes("application/json")) {
        captureFailureReason = [401, 403].includes(response.status) ? "unavailable"
          : response.status === 206 || response.headers.has("content-range") || response.status === 200 ? "incomplete" : "request_failed";
        throw new Error("transport");
      }
      let data;
      try { data = await response.clone().json(); }
      catch (error) { captureFailureReason = "incomplete"; throw error; }
      if (controller.signal.aborted || location.pathname !== `/chat/${chat}` || data.uuid !== chat) throw new Error("changed");
      reply.data = data;
    } catch {
      // Upstream/network/JSON-parser errors may contain private response content.
      reply.error = "capture_failed";
      reply.captureFailureReason = controller.signal.reason === "capture_timeout" ? "timeout" : captureFailureReason;
    } finally {
      clearTimeout(timer);
      window.navigation?.removeEventListener("navigate", changed);
      window.removeEventListener("popstate", changed);
      if (active === controller) active = null;
    }
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
