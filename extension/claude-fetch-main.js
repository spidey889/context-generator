(() => {
  const version = 2;
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
    if (event.source !== window || event.origin !== location.origin || request?.channel !== channel || request.type !== "request") return;
    if (typeof request.id !== "string" || request.id.length > 80) return;
    const chat = location.pathname.match(/^\/chat\/([^/]+)$/)?.[1];
    const reply = { channel, type: "response", id: request.id, chat };
    if (active) {
      window.postMessage({ ...reply, error: "busy" }, location.origin);
      return;
    }
    const controller = new AbortController();
    active = controller;
    const timer = setTimeout(() => controller.abort(), 15000);
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
      if (!endpoints.has(chat)) throw new Error("routing");
      const captureUrl = new URL(endpoints.get(chat));
      captureUrl.search = "";
      captureUrl.searchParams.set("tree", "True");
      captureUrl.searchParams.set("rendering_mode", "messages");
      captureUrl.searchParams.set("render_all_tools", "true");
      captureUrl.searchParams.set("include_inline_comparison", "true");
      captureUrl.searchParams.set("consistency", "strong");
      const response = await Reflect.apply(nativeFetch, window, [captureUrl.href, { credentials: "same-origin", cache: "no-store", signal: controller.signal }]);
      if (response.status !== 200 || response.headers.has("content-range") || !response.headers.get("content-type")?.includes("application/json")) throw new Error("transport");
      const data = await response.clone().json();
      if (controller.signal.aborted || location.pathname !== `/chat/${chat}` || data.uuid !== chat) throw new Error("changed");
      reply.data = data;
    } catch {
      // Upstream/network/JSON-parser errors may contain private response content.
      reply.error = "capture_failed";
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
    version, fetch: wrappedFetch,
    dispose() {
      active?.abort();
      window.removeEventListener("message", receive);
      if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
    }
  };
})();
