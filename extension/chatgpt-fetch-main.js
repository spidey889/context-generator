(() => {
  const version = 6;
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
    if (event.source !== window || event.origin !== location.origin || request?.channel !== channel || !["request", "ping"].includes(request.type)) return;
    if (typeof request.id !== "string" || request.id.length > 80) return;
    // Readiness probes never fetch session data or conversation messages.
    if (request.type === "ping") {
      if (window.fetch === wrappedFetch) window.postMessage({ channel, type: "pong", id: request.id, version }, location.origin);
      return;
    }
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
    const readPaste = async (response, expectedSize) => {
      let reader;
      try {
        if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
        if (response.status !== 200 || response.headers.has("content-range")
          || response.headers.get("content-type")?.split(";", 1)[0].trim() !== "text/plain"
          || Number(response.headers.get("content-length")) > expectedSize) throw new Error("paste");
        // The manifest bounds this allocation. Never buffer an oversized body
        // first: reject the first excess chunk, including without Content-Length.
        const bytes = new Uint8Array(expectedSize);
        reader = response.body?.getReader();
        let size = 0;
        if (reader) while (true) {
          const { done, value } = await reader.read();
          if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
          if (done) break;
          if (size + value.byteLength > expectedSize) throw new Error("paste");
          bytes.set(value, size); size += value.byteLength;
        }
        if (size !== expectedSize) throw new Error("paste");
        // Preserve complete UTF-8, BOM and whitespace through chunk boundaries.
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch (error) {
        if (reader) await reader.cancel().catch(() => {});
        else await response.body?.cancel().catch(() => {});
        throw error;
      } finally {
        reader?.releaseLock();
      }
    };
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
        authRetried = true;
        if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
        headers = revision !== authRevision && auth ? new Headers(auth) : await refreshAuth();
        if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
        response = await fetchJson(url, { ...options, headers });
      }
      return response;
    };
    try {
      if (!chat || request.chat !== chat) throw new Error("changed");
      const url = `/backend-api/conversation/${encodeURIComponent(chat)}`;
      // Retry an expired bearer token once. Never retry a partial tree or guess
      // another workspace on 403; both must fail visibly.
      const response = await fetchAuthenticatedJson(url);
      checkTransport(response);
      const data = await response.json();
      if (controller.signal.aborted || currentChat() !== chat || (data.conversation_id ?? data.id) !== chat) throw new Error("changed");
      // Big pastes are user text stored as files, not text.parts. Read only
      // active-branch user pastes; never use a tool's extracted/rephrased copy.
      const branch = [];
      const seen = new Set();
      let nodeId = data.current_node;
      while (typeof nodeId === "string" && !seen.has(nodeId)) {
        seen.add(nodeId);
        const node = Object.hasOwn(data.mapping || {}, nodeId) ? data.mapping[nodeId] : null;
        if (!node || !Object.hasOwn(node, "parent")) break;
        branch.push(node.message);
        if (node.parent === null) break;
        nodeId = node.parent;
      }
      // A broken chain is left to the bridge's existing structural validator;
      // do not fetch attachments until the chain reaches a real root.
      const rooted = data.mapping?.[nodeId]?.parent === null;
      const pastedTexts = Object.create(null);
      let pastedBytes = 0;
      for (const message of rooted ? branch : []) {
        if (message?.author?.role !== "user" || message.metadata?.is_visually_hidden_from_conversation
          || (message.recipient && message.recipient !== "all")) continue;
        for (const file of Array.isArray(message.metadata?.attachments) ? message.metadata.attachments : []) {
          if (file?.is_big_paste !== true || file.mime_type !== "text/plain") continue;
          if (typeof file.id !== "string" || !/^file[-_][a-zA-Z0-9_-]+$/.test(file.id)
            || !Number.isSafeInteger(file.size) || file.size < 0) throw new Error("paste");
          if (Object.hasOwn(pastedTexts, file.id)) continue;
          pastedBytes += file.size;
          if (pastedBytes > 1400000) throw new Error("size");
          try {
            const descriptorResponse = await fetchAuthenticatedJson(`/backend-api/files/download/${encodeURIComponent(file.id)}`, { redirect: "error" });
            if (descriptorResponse.status !== 200 || descriptorResponse.headers.has("content-range")
              || !descriptorResponse.headers.get("content-type")?.includes("application/json")) throw new Error("paste");
            const descriptor = await descriptorResponse.json();
            if (descriptor.status !== "success" || descriptor.file_size_bytes !== file.size || typeof descriptor.download_url !== "string") throw new Error("paste");
            const download = new URL(descriptor.download_url, location.origin);
            // Native preview uses this signed same-origin content route. Keep the
            // URL in MAIN and never forward bearer headers or follow other hosts.
            if (download.origin !== location.origin || download.pathname !== "/backend-api/estuary/content"
              || download.searchParams.get("id") !== file.id) throw new Error("paste");
            const textResponse = await fetchJson(download.href, { redirect: "error" });
            pastedTexts[file.id] = await readPaste(textResponse, file.size);
          } catch { throw new Error("paste"); }
        }
      }
      if (controller.signal.aborted || currentChat() !== chat) throw new Error("changed");
      reply.pastedTexts = pastedTexts;
      reply.data = data;
    } catch (error) {
      // Never expose tokens, parser snippets, or arbitrary upstream errors.
      reply.error = navigated || controller.signal.reason === "account_changed" ? "changed" : controller.signal.aborted ? "timeout"
        : ["http", "partial", "format", "auth", "changed", "paste", "size"].includes(error?.message) ? error.message : "network";
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
