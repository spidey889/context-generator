(() => {
  const platform = ({ "gemini.google.com": "gemini", "grok.com": "grok", "chat.deepseek.com": "deepseek" })[location.hostname];
  if (!platform) return;
  const channel = "cap-context-network-json-v1";
  const captureError = (message, captureFailureReason) => Object.assign(new Error(message), { captureFailureReason });
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
      if (event.source === window && event.origin === location.origin && reply?.channel === channel && reply.platform === platform && reply.type === "pong" && reply.id === id && reply.version === (platform === "deepseek" ? 8 : platform === "gemini" ? 8 : 6)) finish(true);
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
      if (pinChat && (expectedUrl && expectedUrl.origin !== location.origin || JSON.stringify(current()) !== JSON.stringify(before))) throw new Error("The conversation changed during capture.");
      if (!await waitForHook(250)) {
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage || !await waitForHook(8000, true)) throw captureError("Fast capture isn't ready yet. Refresh this chat and try again, or turn off the lightning button.", "unavailable");
      }
      if (changed || JSON.stringify(current()) !== JSON.stringify(before)) throw new Error("The conversation changed during capture.");
      return await new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); };
        const receive = event => {
          const reply = event.data;
          if (event.source !== window || event.origin !== location.origin || reply?.channel !== channel || reply.platform !== platform || reply.type !== "response" || reply.id !== id) return;
          cleanup();
          if (changed || reply.chat !== before.chat || reply.selected !== before.selected || JSON.stringify(current()) !== JSON.stringify(before)) return reject(new Error("The conversation changed during capture."));
          if (reply.error) return reject(captureError(reply.error === "size" ? "This chat is too long to transfer (limit: 350,000 characters). Try a shorter chat." : `Fast capture failed: ${reply.error} Turn off the lightning button to use standard capture.`, reply.captureFailureReason));
          const capture = reply.capture;
          if (typeof capture?.text !== "string" || !capture.text.trim() || !Number.isSafeInteger(capture.messageTurnCount) || capture.messageTurnCount < 1 || capture.text.length > 350000 || new TextEncoder().encode(capture.text).length > 1400000) return reject(captureError("Fast capture returned an invalid or incomplete conversation.", "incomplete"));
          resolve(capture);
        };
        const timer = setTimeout(() => { cleanup(); reject(captureError("Fast capture timed out. Refresh this chat or turn off the lightning button.", "timeout")); }, 27000);
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
