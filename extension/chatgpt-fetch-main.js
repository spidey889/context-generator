(() => {
  const version = 2;
  const channel = "cap-context-chatgpt-json-v2";
  const currentChat = pathname => (pathname ?? location.pathname).match(/\/c\/([^/]+)\/?$/)?.[1];
  const previous = window.__capChatGptFetchState;
  if (previous?.version === version && window.fetch === previous.fetch) return;
  let auth = previous?.headers?.() || null;
  previous?.dispose();
  const nativeFetch = window.fetch;
  let active = null;
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
    if (event.source !== window || event.origin !== location.origin || request?.channel !== channel || request.type !== "request") return;
    if (typeof request.id !== "string" || request.id.length > 80) return;
    const chat = currentChat();
    const reply = { channel, type: "response", id: request.id, chat };
    if (active) { window.postMessage({ ...reply, error: "busy" }, location.origin); return; }
    const controller = new AbortController();
    active = controller;
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
    const fetchJson = (url, options = {}) => Reflect.apply(nativeFetch, window, [url, {
      ...options, credentials: "same-origin", cache: "no-store", signal: controller.signal
    }]);
    const checkTransport = response => {
      if (response.status !== 200) { reply.status = response.status; throw new Error("http"); }
      if (response.headers.has("content-range")) throw new Error("partial");
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("format");
    };
    const refreshAuth = async () => {
      // Late hooks cannot recover headers from resource timing. Read the existing
      // same-origin session only on explicit capture, keeping tokens in MAIN.
      const revision = authRevision;
      const response = await fetchJson("/api/auth/session");
      checkTransport(response);
      const session = await response.json();
      if (typeof session.accessToken !== "string" || !session.accessToken) throw new Error("auth");
      if (revision !== authRevision && auth) return new Headers(auth);
      const headers = new Headers(auth || undefined);
      headers.set("authorization", `Bearer ${session.accessToken}`);
      if (!headers.has("chatgpt-account-id") && typeof session.account?.id === "string") headers.set("chatgpt-account-id", session.account.id);
      auth = headers;
      return new Headers(headers);
    };
    try {
      if (!chat || request.chat !== chat) throw new Error("changed");
      let headers = auth ? new Headers(auth) : await refreshAuth();
      if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
      const url = `/backend-api/conversation/${encodeURIComponent(chat)}`;
      let response = await fetchJson(url, { headers });
      // Retry an expired bearer token once. Never retry a partial tree or guess
      // another workspace on 403; both must fail visibly.
      if (response.status === 401) {
        headers = await refreshAuth();
        response = await fetchJson(url, { headers });
      }
      checkTransport(response);
      const data = await response.json();
      if (controller.signal.aborted || currentChat() !== chat || (data.conversation_id ?? data.id) !== chat) throw new Error("changed");
      reply.data = data;
    } catch (error) {
      // Never expose tokens, parser snippets, or arbitrary upstream errors.
      reply.error = navigated || controller.signal.reason === "account_changed" ? "changed" : controller.signal.aborted ? "timeout"
        : ["http", "partial", "format", "auth", "changed"].includes(error?.message) ? error.message : "network";
    } finally {
      clearTimeout(timer);
      window.navigation?.removeEventListener("navigate", changed);
      window.removeEventListener("popstate", changed);
      if (active === controller) active = null;
    }
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
