(() => {
  const platform = ({ "gemini.google.com": "gemini", "grok.com": "grok", "chat.deepseek.com": "deepseek" })[location.hostname];
  if (!platform) return;
  const channel = "cap-context-network-json-v1";
  window.__capNetworkReplyObserver?.();
  const observeReply = event => {
    const reply = event.data;
    if (event.source === window && event.origin === location.origin && reply?.channel === channel && reply.platform === platform
      && reply.type === "generation" && reply.pathname === location.pathname && typeof reply.active === "boolean") {
      window.__capNetworkReplyState = { pathname: reply.pathname, active: reply.active };
    }
  };
  window.addEventListener("message", observeReply);
  window.__capNetworkReplyObserver = () => window.removeEventListener("message", observeReply);
  const changedError = message => Object.assign(new Error(message), { diagnosticCode: "conversation_changed", diagnostics: { version: 1, capture_detail: "conversation_changed", failure_site: "capture_history" } });
  const captureError = (message, captureFailureReason, detail = "incomplete_history", stage = "serialize", status) => Object.assign(new Error(message), {
    captureFailureReason, diagnosticCode: captureFailureReason === "size_limit" ? "conversation_too_large"
      : detail === "conversation_changed" ? "conversation_changed" : captureFailureReason === "unavailable" ? "capture_json_unavailable" : "capture_json_failed",
    diagnostics: { version: 1, capture_detail: captureFailureReason === "size_limit" && detail !== "attachment_size_limit" ? "size_limit" : detail, capture_request_stage: stage, failure_site: `capture_${stage}`,
      ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { capture_http_status: status } : {}) }
  });
  const pinChat = ["gemini", "grok", "deepseek"].includes(platform);
  const current = (pathname = location.pathname, selected = platform === "grok" ? new URL(location.href).searchParams.get("rid") : null) => {
    const pattern = platform === "gemini" ? /\/app\/([^/]+)\/?$/ : platform === "grok" ? /\/c\/([^/]+)\/?$/ : /\/a\/chat\/s\/([^/]+)\/?$/;
    return { chat: pathname.match(pattern)?.[1], selected };
  };
  const waitForHook = (timeout, install = false) => new Promise(resolve => {
    const id = crypto.randomUUID();
    let poll, settled = false;
    const finish = ready => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(poll); window.removeEventListener("message", receive); resolve(ready); };
    const receive = event => {
      const reply = event.data;
      if (event.source === window && event.origin === location.origin && reply?.channel === channel && reply.platform === platform && reply.type === "pong" && reply.id === id && reply.version === (platform === "deepseek" ? 14 : platform === "gemini" ? 12 : 10)) finish(true);
    };
    const ping = () => { if (settled) return; window.postMessage({ channel, platform, type: "ping", id }, location.origin); poll = setTimeout(ping, 100); };
    const timer = setTimeout(() => finish(false), timeout);
    window.addEventListener("message", receive); ping();
    if (install) Promise.resolve().then(() => chrome.runtime.sendMessage({ type: "ENSURE_NETWORK_JSON_HOOK" })).then(reply => { if (!reply?.ok) finish(false); }, () => finish(false));
  });
  window.__capCaptureNetworkJson = async (expectedPath = platform === "grok" ? location.href : location.pathname) => {
    // Grok branch selection lives in the query string; pin it with the clicked chat.
    const expectedUrl = platform === "grok" ? new URL(expectedPath, location.origin) : null;
    const before = expectedUrl ? current(expectedUrl.pathname, expectedUrl.searchParams.get("rid")) : current(expectedPath);
    if (!before.chat) throw new Error("Open a saved conversation to use fast capture.");
    let changed = false;
    const navigated = event => {
      const target = event?.destination ? new URL(event.destination.url) : location;
      if (target.origin !== location.origin || JSON.stringify(current(target.pathname, platform === "grok" ? new URL(target.href).searchParams.get("rid") : null)) !== JSON.stringify(before)) changed = true;
    };
    // Pinned JSON sources latch readiness and queued response delivery, including
    // away-and-back changes after MAIN has removed its network listeners.
    if (pinChat) {
      window.navigation?.addEventListener("navigate", navigated);
      window.addEventListener("popstate", navigated);
    }
    try {
      if (pinChat && (expectedUrl && expectedUrl.origin !== location.origin || JSON.stringify(current()) !== JSON.stringify(before))) throw changedError("The conversation changed during capture.");
      if (!await waitForHook(250)) {
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage || !await waitForHook(8000, true)) throw captureError("Fast capture isn't ready yet. Refresh this chat and try again, or turn off the lightning button.", "unavailable", "hook_unavailable", "hook");
      }
      if (changed || JSON.stringify(current()) !== JSON.stringify(before)) throw changedError("The conversation changed during capture.");
      return await new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); };
        const receive = event => {
          const reply = event.data;
          if (event.source !== window || event.origin !== location.origin || reply?.channel !== channel || reply.platform !== platform || reply.type !== "response" || reply.id !== id) return;
          cleanup();
          if (changed || reply.chat !== before.chat || reply.selected !== before.selected || JSON.stringify(current()) !== JSON.stringify(before)) return reject(changedError("The conversation changed during capture."));
          if (reply.error) return reject(captureError(reply.error === "size" ? "This chat is too long to transfer (limit: 500,000 characters). Try a shorter chat." : `Fast capture failed: ${reply.error} Turn off the lightning button to use standard capture.`, reply.captureFailureReason,
            reply.captureDetail || "network_error", reply.captureRequestStage || "history", reply.status));
          const capture = reply.capture;
          if (typeof capture?.text !== "string" || !capture.text.trim() || !Number.isSafeInteger(capture.messageTurnCount) || capture.messageTurnCount < 1 || capture.text.length > 500000 || new TextEncoder().encode(capture.text).length > 2000000) return reject(captureError("Fast capture returned an invalid or incomplete conversation.", "incomplete"));
          const name = { gemini: "Gemini", grok: "Grok", deepseek: "DeepSeek" }[platform];
          // MAIN owns the native adapter. Verify both views agree before accepting
          // its message boundaries; never infer roles from flattened text.
          if (!Array.isArray(capture.messages) || capture.messages.length !== capture.messageTurnCount
            || capture.messages.some(turn => !turn || !["user", "assistant"].includes(turn.role) || typeof turn.text !== "string" || !turn.text.trim())
            || capture.text !== `${name} conversation:\n\n${capture.messages.map(turn => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`).join("\n\n")}`) return reject(captureError("Fast capture returned invalid message boundaries.", "incomplete"));
          resolve(capture);
        };
        const timer = setTimeout(() => { cleanup(); reject(captureError("Fast capture timed out. Refresh this chat or turn off the lightning button.", "timeout", "timeout", "history")); }, 27000);
        window.addEventListener("message", receive);
        window.postMessage({ channel, platform, type: "request", id, ...before }, location.origin);
      });
    } finally {
      if (pinChat) {
        window.navigation?.removeEventListener("navigate", navigated);
        window.removeEventListener("popstate", navigated);
      }
    }
  };
})();
