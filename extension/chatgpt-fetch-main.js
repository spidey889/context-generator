(() => {
  if (window.__capChatGptFetchInstalled) return;
  window.__capChatGptFetchInstalled = true;
  const nativeFetch = window.fetch;
  const channel = "cap-context-chatgpt-json-v1";
  const currentChat = () => location.pathname.match(/\/c\/([^/]+)\/?$/)?.[1];
  let observed = null;
  let busy = false;

  // Keep routing/auth in page memory only, never message bodies or cookie values.
  // A paginated request can supply auth, but capture always reads the full-tree URL.
  window.fetch = function (...args) {
    try {
      const input = args[0];
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      const method = args[1]?.method || (input instanceof Request ? input.method : "GET");
      const chat = url.pathname.match(/^\/backend-api\/conversations?\/([^/]+)$/)?.[1];
      if (url.origin === location.origin && method.toUpperCase() === "GET" && chat && chat === currentChat()) {
        const incoming = new Headers(args[1]?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (incoming.get("authorization")) {
          const headers = new Headers();
          for (const key of ["authorization", "chatgpt-account-id", "oai-did", "oai-language", "originator"]) {
            if (incoming.has(key)) headers.set(key, incoming.get(key));
          }
          observed = { chat, headers };
        }
      }
    } catch { /* Invalid arguments must retain native fetch behavior. */ }
    return Reflect.apply(nativeFetch, this, args);
  };

  window.addEventListener("message", async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.channel !== channel || request.type !== "request") return;
    if (typeof request.id !== "string" || request.id.length > 80 || busy) return;
    busy = true;
    const chat = currentChat();
    const reply = { channel, type: "response", id: request.id, chat };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      if (!chat || request.chat !== chat || observed?.chat !== chat) {
        reply.error = "refresh";
      } else {
        const response = await window.fetch(`/backend-api/conversation/${encodeURIComponent(chat)}`, {
          headers: observed.headers, credentials: "same-origin", cache: "no-store", signal: controller.signal
        });
        if (!response.ok) { reply.error = "http"; reply.status = response.status; }
        else if (!response.headers.get("content-type")?.includes("application/json")) reply.error = "format";
        else {
          const data = await response.clone().json();
          if (currentChat() !== chat || (data.conversation_id ?? data.id) !== chat) reply.error = "changed";
          else reply.data = data;
        }
      }
    } catch (error) { reply.error = error.name === "AbortError" ? "timeout" : "network"; }
    finally { clearTimeout(timer); busy = false; }
    window.postMessage(reply, location.origin);
  });
})();
