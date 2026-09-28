(() => {
  const platform = ({ "gemini.google.com": "gemini", "grok.com": "grok", "chat.deepseek.com": "deepseek" })[location.hostname];
  if (!platform) return;
  const channel = "cap-context-network-json-v1";
  const current = () => {
    const pattern = platform === "gemini" ? /\/app\/([^/]+)\/?$/ : platform === "grok" ? /\/c\/([^/]+)\/?$/ : /\/a\/chat\/s\/([^/]+)\/?$/;
    return { chat: location.pathname.match(pattern)?.[1], selected: platform === "grok" ? new URL(location.href).searchParams.get("rid") : null };
  };
  const waitForHook = (timeout, install = false) => new Promise(resolve => {
    const id = crypto.randomUUID();
    let poll, settled = false;
    const finish = ready => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(poll); window.removeEventListener("message", receive); resolve(ready); };
    const receive = event => {
      const reply = event.data;
      if (event.source === window && event.origin === location.origin && reply?.channel === channel && reply.platform === platform && reply.type === "pong" && reply.id === id && reply.version === 1) finish(true);
    };
    const ping = () => { if (settled) return; window.postMessage({ channel, platform, type: "ping", id }, location.origin); poll = setTimeout(ping, 100); };
    const timer = setTimeout(() => finish(false), timeout);
    window.addEventListener("message", receive); ping();
    if (install) Promise.resolve().then(() => chrome.runtime.sendMessage({ type: "ENSURE_NETWORK_JSON_HOOK" })).then(reply => { if (!reply?.ok) finish(false); }, () => finish(false));
  });
  window.__capCaptureNetworkJson = async () => {
    const before = current();
    if (!before.chat) throw new Error("Open a saved conversation to use fast capture.");
    if (!await waitForHook(250)) {
      if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage || !await waitForHook(8000, true)) throw new Error("Fast capture isn't ready yet. Refresh this chat and try again, or turn off the lightning button.");
    }
    if (JSON.stringify(current()) !== JSON.stringify(before)) throw new Error("The conversation changed during capture.");
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); };
      const receive = event => {
        const reply = event.data;
        if (event.source !== window || event.origin !== location.origin || reply?.channel !== channel || reply.platform !== platform || reply.type !== "response" || reply.id !== id) return;
        cleanup();
        if (reply.chat !== before.chat || reply.selected !== before.selected || JSON.stringify(current()) !== JSON.stringify(before)) return reject(new Error("The conversation changed during capture."));
        if (reply.error) return reject(new Error(reply.error === "size" ? "This chat is too long to transfer (limit: 350,000 characters). Try a shorter chat." : `Fast capture failed: ${reply.error} Turn off the lightning button to use standard capture.`));
        const capture = reply.capture;
        if (typeof capture?.text !== "string" || !capture.text.trim() || !Number.isSafeInteger(capture.messageTurnCount) || capture.messageTurnCount < 1 || capture.text.length > 350000 || new TextEncoder().encode(capture.text).length > 1400000) return reject(new Error("Fast capture returned an invalid or incomplete conversation."));
        resolve(capture);
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error("Fast capture timed out. Refresh this chat or turn off the lightning button.")); }, 27000);
      window.addEventListener("message", receive);
      window.postMessage({ channel, platform, type: "request", id, ...before }, location.origin);
    });
  };
})();
