(() => {
  if (window.__capClaudeFetchInstalled) return;
  window.__capClaudeFetchInstalled = true;
  const nativeFetch = window.fetch;
  let endpoint = null;
  let busy = false;
  const channel = "cap-context-claude-json-v1";

  // Remember routing only. Opening the picker must never capture message bodies.
  window.fetch = function (...args) {
    try {
      const url = new URL(args[0] instanceof Request ? args[0].url : args[0], location.href);
      const method = args[1]?.method || (args[0] instanceof Request ? args[0].method : "GET");
      if (method.toUpperCase() === "GET" && url.origin === location.origin && /^\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+$/.test(url.pathname)) {
        endpoint = url.href;
      }
    } catch { /* Preserve native fetch behavior for invalid arguments. */ }
    return Reflect.apply(nativeFetch, this, args);
  };

  window.addEventListener("message", async (event) => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.channel !== channel || request.type !== "request") return;
    if (typeof request.id !== "string" || request.id.length > 80 || busy) return;
    busy = true;
    const chat = location.pathname.match(/^\/chat\/([^/]+)$/)?.[1];
    const reply = { channel, type: "response", id: request.id, chat };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      if (!chat || request.chat !== chat || !endpoint || new URL(endpoint).pathname.split("/").pop() !== chat) {
        throw new Error("Refresh this Claude conversation before using JSON capture.");
      }
      // On-demand reads reuse browser cookies; no credentials are extracted or stored.
      const response = await window.fetch(endpoint, { credentials: "same-origin", cache: "no-store", signal: controller.signal });
      if (!response.ok || !response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("Claude JSON capture could not load this conversation. Use DOM capture or refresh.");
      }
      const data = await response.clone().json();
      if (location.pathname !== `/chat/${chat}` || data.uuid !== chat) throw new Error("The Claude conversation changed during capture.");
      reply.data = data;
    } catch (error) {
      reply.error = error.name === "AbortError" ? "Claude JSON capture timed out. Try again or use DOM capture." : error.message;
    } finally {
      clearTimeout(timer);
      busy = false;
    }
    window.postMessage(reply, location.origin);
  });
})();
