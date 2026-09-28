(() => {
  const platform = ({ "gemini.google.com": "gemini", "grok.com": "grok", "chat.deepseek.com": "deepseek" })[location.hostname];
  if (!platform || !globalThis.__capNetworkJsonData) return;
  // Advance readiness version with adapter/contract changes: old MAIN closures
  // can survive extension reloads and must be replaced before a new capture.
  const version = platform === "gemini" ? 2 : 1, channel = "cap-context-network-json-v1";
  const previous = window.__capNetworkFetchState;
  if (previous?.version === version && window.fetch === previous.fetch
    && (platform !== "gemini" || previous?.ownsObservation?.())) return;
  let auth = previous?.auth?.() || null;
  let geminiTemplate = previous?.template?.() || null;
  previous?.dispose();
  const nativeFetch = window.fetch;
  const api = globalThis.__capNetworkJsonData;
  const current = () => {
    const pattern = platform === "gemini" ? /\/app\/([^/]+)\/?$/ : platform === "grok" ? /\/c\/([^/]+)\/?$/ : /\/a\/chat\/s\/([^/]+)\/?$/;
    return { chat: location.pathname.match(pattern)?.[1], selected: platform === "grok" ? new URL(location.href).searchParams.get("rid") : null };
  };
  let active = null;
  const observe = (input, options) => {
    try {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      if (url.origin !== location.origin) return;
      if (platform === "deepseek" && url.pathname.startsWith("/api/v0/")) {
        const headers = new Headers(options?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (headers.get("authorization")) {
          if (auth && auth !== headers.get("authorization")) active?.abort();
          auth = headers.get("authorization");
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
  const wrappedFetch = function (...args) { observe(args[0], args[1]); return Reflect.apply(nativeFetch, this, args); };
  window.fetch = wrappedFetch;
  // Gemini's RPC and DeepSeek's authenticated history both use native XHR.
  // Observe outgoing routing/auth only, without reading any response bodies.
  const xhr = platform !== "grok" ? window.XMLHttpRequest?.prototype : null;
  const nativeOpen = xhr?.open, nativeSend = xhr?.send, nativeSetHeader = xhr?.setRequestHeader;
  const xhrRequests = new WeakMap();
  const wrappedOpen = function (...args) { xhrRequests.set(this, { url: args[1], headers: new Headers() }); return Reflect.apply(nativeOpen, this, args); };
  const wrappedSetHeader = function (...args) {
    try { xhrRequests.get(this)?.headers.append(args[0], args[1]); } catch { /* Native XHR owns header validation. */ }
    return Reflect.apply(nativeSetHeader, this, args);
  };
  const wrappedSend = function (...args) { const meta = xhrRequests.get(this); observe(meta?.url, { headers: meta?.headers, body: args[0] }); return Reflect.apply(nativeSend, this, args); };
  if (xhr) { xhr.open = wrappedOpen; xhr.send = wrappedSend; if (nativeSetHeader) xhr.setRequestHeader = wrappedSetHeader; }
  // Gemini uses XHR as well as fetch. A page replacement of either surface
  // makes the cached observer stale and must trigger bounded hook recovery.
  const ownsObservation = () => window.fetch === wrappedFetch && (!xhr
    || (window.XMLHttpRequest?.prototype === xhr && xhr.open === wrappedOpen
      && xhr.send === wrappedSend && (!nativeSetHeader || xhr.setRequestHeader === wrappedSetHeader)));

  const receive = async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.channel !== channel || request.platform !== platform || typeof request.id !== "string" || request.id.length > 80) return;
    if (request.type === "ping") {
      if (platform !== "gemini" || ownsObservation()) window.postMessage({ channel, type: "pong", platform, version, id: request.id }, location.origin);
      return;
    }
    if (request.type !== "request") return;
    const { chat, selected } = current();
    const reply = { channel, type: "response", platform, chat, selected, id: request.id };
    if (active) { window.postMessage({ ...reply, error: "Another fast capture is running. Try again after it finishes." }, location.origin); return; }
    const controller = new AbortController();
    active = controller;
    const timer = setTimeout(() => controller.abort(), 25000);
    const check = () => {
      const now = current();
      if (controller.signal.aborted) throw new api.CaptureError("The capture request timed out or was cancelled.");
      if (!chat || request.chat !== chat || request.selected !== selected || now.chat !== chat || now.selected !== selected) throw new api.CaptureError("The conversation changed during capture.");
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
    let bytesRead = 0;
    const read = async (url, options = {}, type = "json") => {
      check();
      const response = await Reflect.apply(nativeFetch, window, [url, { credentials: "same-origin", ...options, redirect: "error", signal: controller.signal }]);
      check();
      if (response.status !== 200 || response.headers.get("content-range")) throw new api.CaptureError("The history request failed or returned a partial response.");
      const contentType = response.headers.get("content-type") || "";
      if (type === "json" && !/application\/json/i.test(contentType)) throw new api.CaptureError("The history request returned an unsupported response.");
      if (type === "rpc" && !/(application\/json|text\/plain)/i.test(contentType)) throw new api.CaptureError("Gemini returned an unsupported RPC response.");
      if (type === "file" && !/^(text\/plain|text\/markdown|text\/csv|application\/(json|octet-stream))(;|$)/i.test(contentType)) throw new api.CaptureError("A text attachment returned an unsupported response.");
      if (Number(response.headers.get("content-length")) > 6000000 - bytesRead) throw new api.CaptureError("size");
      const bytes = new Uint8Array(await response.arrayBuffer());
      bytesRead += bytes.length;
      if (bytesRead > 6000000) throw new api.CaptureError("size");
      check();
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: type === "file" }).decode(bytes);
      return type === "json" ? JSON.parse(text) : { text, size: bytes.length };
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
        const at = window.WIZ_global_data?.SNlM0e || geminiTemplate?.at;
        if (!geminiTemplate?.url || typeof at !== "string" || !at) throw new api.CaptureError("Refresh this signed-in Gemini chat to make fast capture ready.");
        const url = new URL(geminiTemplate.url);
        url.searchParams.set("rpcids", "hNvQHb");
        url.searchParams.set("source-path", location.pathname);
        const args = Array.isArray(geminiTemplate.args) ? [...geminiTemplate.args] : [null, 10, null, 1, [1], [4], null, 1];
        args[0] = `c_${chat}`; args[1] = 10; args[2] = null;
        const pages = [], cursors = new Set();
        do {
          const body = new URLSearchParams({ at, "f.req": JSON.stringify([[["hNvQHb", JSON.stringify(args), null, "generic"]]]) });
          const response = await read(url.href, { method: "POST", body }, "rpc");
          const page = api.geminiPage(response.text);
          pages.push(page);
          if (page.cursor !== null && (cursors.has(page.cursor) || !page.turns.length)) throw new api.CaptureError("Gemini history pagination did not advance.");
          cursors.add(page.cursor); args[2] = page.cursor;
        } while (args[2] !== null);
        reply.capture = api.gemini(pages, chat);
      } else if (platform === "grok") {
        const base = `/rest/app-chat/conversations/${encodeURIComponent(chat)}`;
        const nodes = await read(`${base}/response-node`);
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
        reply.capture = api.grok(nodes, responses, selected);
      } else {
        // Omitting x-device-id/cache client headers makes DeepSeek return a
        // full REPLACE snapshot. A MERGE/delta must never count as full history.
        if (!auth) throw new api.CaptureError("Refresh this signed-in DeepSeek chat to make fast capture ready.");
        const data = await read(`/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(chat)}`, { headers: { authorization: auth } });
        const branch = api.deepseekBranch(data, chat);
        const files = Object.create(null);
        for (const message of branch) {
          if (message.role !== "USER") continue;
          for (const fragment of message.fragments || []) for (const file of fragment.type === "FILE" && Array.isArray(fragment.files) ? fragment.files : []) {
            if (!api.textFile(file) || Object.hasOwn(files, file.id)) continue;
            if (file.status !== "SUCCESS" || !Number.isSafeInteger(file.file_size) || file.file_size < 0 || file.file_size > 1400000 || typeof file.signed_path !== "string") throw new api.CaptureError("A text attachment is unavailable or incomplete.");
            // DeepSeek's native preview uses this signed file service with ty=r
            // for original bytes. No session bearer/cookies go to that host.
            const url = new URL(file.signed_path.startsWith("/") ? `https://files.deepseeksvc.com/api${file.signed_path}` : file.signed_path);
            if (url.origin !== "https://files.deepseeksvc.com" || url.pathname !== "/api/file" || url.username || url.password || url.searchParams.get("file_id") !== file.id?.replace(/^file-/, "")) throw new api.CaptureError("A text attachment has an unsupported download address.");
            url.searchParams.set("ty", "r");
            const content = await read(url.href, { credentials: "omit" }, "file");
            if (content.size !== file.file_size) throw new api.CaptureError("A text attachment is incomplete.");
            files[file.id] = content.text;
          }
        }
        reply.capture = api.deepseek(data, chat, files);
      }
      check();
    } catch (error) {
      delete reply.capture;
      // Adapter errors contain structural reasons only. Never return fetch,
      // JSON parser or decoder errors, which can contain private response text.
      const reason = error?.message;
      reply.error = error instanceof api.CaptureError && reason.length < 180
        ? reason : "The conversation could not be read completely. Refresh this chat and try again.";
    } finally {
      clearTimeout(timer);
      window.navigation?.removeEventListener("navigate", changed);
      window.removeEventListener("popstate", changed);
      if (active === controller) active = null;
    }
    window.postMessage(reply, location.origin);
  };
  window.addEventListener("message", receive);
  window.__capNetworkFetchState = { version, fetch: wrappedFetch, ownsObservation, auth: () => auth, template: () => geminiTemplate,
    dispose() {
      active?.abort(); window.removeEventListener("message", receive);
      if (window.fetch === wrappedFetch) window.fetch = nativeFetch;
      if (xhr?.open === wrappedOpen) xhr.open = nativeOpen;
      if (xhr?.send === wrappedSend) xhr.send = nativeSend;
      if (xhr?.setRequestHeader === wrappedSetHeader) xhr.setRequestHeader = nativeSetHeader;
    }
  };
})();
