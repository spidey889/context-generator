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
  const waitForHook = (timeout, install = false, signal, metrics) => new Promise(resolve => {
    if (signal?.aborted) return resolve(false);
    const id = crypto.randomUUID();
    let poll, settled = false;
    const finish = ready => { if (settled) return; settled = true; clearTimeout(timer); clearTimeout(poll); window.removeEventListener("message", receive); signal?.removeEventListener("abort", onAbort); resolve(ready); };
    const onAbort = () => finish(false);
    const receive = event => {
      const reply = event.data;
      if (event.source === window && event.origin === location.origin && reply?.channel === channel && reply.platform === platform && reply.type === "pong" && reply.id === id
          && reply.version !== (platform === "deepseek" ? 34 : platform === "grok" ? 23 : 20)) metrics?.set({ hook_status: "version_mismatch" });
      if (event.source === window && event.origin === location.origin && reply?.channel === channel && reply.platform === platform && reply.type === "pong" && reply.id === id && reply.version === (platform === "deepseek" ? 34 : platform === "grok" ? 23 : 20)) finish(true);
    };
    const ping = () => { if (settled) return; window.postMessage({ channel, platform, type: "ping", id }, location.origin); poll = setTimeout(ping, 100); };
    const timer = setTimeout(() => finish(false), timeout);
    signal?.addEventListener("abort", onAbort, { once: true });
    window.addEventListener("message", receive); ping();
    if (install) Promise.resolve().then(() => chrome.runtime.sendMessage({ type: "ENSURE_NETWORK_JSON_HOOK" })).then(reply => { if (!settled && !reply?.ok) { metrics?.set({ hook_status: "install_rejected" }); finish(false); } }, () => { if (!settled) { metrics?.set({ hook_status: "install_failed" }); finish(false); } });
  });
  window.__capCaptureNetworkJson = async (expectedPath = platform === "grok" ? location.href : location.pathname, metrics, measureOnly = false, signal, onEstimate, omitLargeFiles = false) => {
    const hookStarted = Date.now();
    // Grok branch selection lives in the query string; pin it with the clicked chat.
    const expectedUrl = platform === "grok" ? new URL(expectedPath, location.origin) : null;
    const before = expectedUrl ? current(expectedUrl.pathname, expectedUrl.searchParams.get("rid")) : current(expectedPath);
    metrics.set({ saved_chat: Boolean(before.chat) });
    if (!before.chat) { metrics.set({ route_reason: "path_unrecognized", route_found: false }); metrics.fail("routing_unavailable", "hook"); throw new Error("Open a saved conversation to use fast capture."); }
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
      metrics.set({ hook_ready: false, hook_status: "no_reply" });
      if (!await waitForHook(250, false, signal, metrics)) {
        if (signal?.aborted) throw new Error("Size check cancelled.");
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) metrics.set({ hook_status: "runtime_missing" });
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage || !await waitForHook(8000, true, signal, metrics)) throw captureError("Fast capture isn't ready yet. Refresh this chat and try again, or turn off the lightning button.", "unavailable", "hook_unavailable", "hook");
      }
      if (signal?.aborted) throw new Error("Size check cancelled.");
      metrics.set({ hook_ready: true, hook_status: "ready", hook_ms: Date.now() - hookStarted });
      if (changed || JSON.stringify(current()) !== JSON.stringify(before)) throw changedError("The conversation changed during capture.");
      metrics.checkpoint("route", "history");
      return await new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        // Await the native cancellation reply before releasing the shared read
        // queue; rejecting immediately could race a still-active old download.
        const onAbort = () => window.postMessage({ channel, platform, type: "cancel_measurement", id }, location.origin);
        const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); signal?.removeEventListener("abort", onAbort); };
        const receive = event => {
          const reply = event.data;
          if (event.source !== window || event.origin !== location.origin || reply?.channel !== channel || reply.platform !== platform || !["response", "measurement_progress", "capture_progress"].includes(reply.type) || reply.id !== id) return;
          if (reply.type === "measurement_progress") {
            if (measureOnly && !signal?.aborted && !changed && reply.chat === before.chat && reply.selected === before.selected
                && JSON.stringify(current()) === JSON.stringify(before) && Number.isSafeInteger(reply.messageTurnCount)
                && reply.messageTurnCount > 0 && Number.isSafeInteger(reply.estimatedCharacterCount) && reply.estimatedCharacterCount >= 0) {
              try { onEstimate?.({ messageTurnCount: reply.messageTurnCount, estimatedCharacterCount: reply.estimatedCharacterCount }); } catch {}
            }
            return;
          }
          if (reply.type === "capture_progress") {
            if (!measureOnly && reply.chat === before.chat && reply.selected === before.selected && !changed) metrics.adopt(reply.jsonCapture);
            return;
          }
          cleanup();
          try {
            if (signal?.aborted) return reject(new Error("Size check cancelled."));
            metrics.adopt(reply.jsonCapture);
            if (changed || reply.chat !== before.chat || reply.selected !== before.selected || JSON.stringify(current()) !== JSON.stringify(before)) return reject(changedError("The conversation changed during capture."));
            if (measureOnly && reply.captureDetail === "conversation_changed") return reject(changedError("The conversation changed during capture."));
            if (measureOnly && Number.isSafeInteger(reply.characterCount) && reply.characterCount >= 0) return resolve({ characterCount: reply.characterCount,
              ...(Number.isSafeInteger(reply.messageTurnCount) && reply.messageTurnCount >= 0 ? { messageTurnCount: reply.messageTurnCount } : {}),
              ...(Number.isSafeInteger(reply.estimatedCharacterCount) && reply.estimatedCharacterCount >= 0 ? { estimatedCharacterCount: reply.estimatedCharacterCount } : {}) });
            if (reply.error) return reject(captureError(reply.error === "size" ? "This chat is too long to transfer (limit: 1,000,000 characters). Try a shorter chat." : `Fast capture failed: ${reply.error} Turn off the lightning button to use standard capture.`, reply.captureFailureReason,
              reply.captureDetail || "network_error", reply.captureRequestStage || "history", reply.status));
            metrics.stage("serialize");
            const capture = reply.capture;
            if (capture?.skippedFiles !== undefined && (platform !== "deepseek" || !Array.isArray(capture.skippedFiles)
              || capture.skippedFiles.some(file => !file || typeof file.name !== "string" || !file.name.trim() || /\.pdf$/i.test(file.name.trim()))))
              return reject(captureError("Invalid unreadable-file notice.", "incomplete"));
            if (capture?.omittedFiles !== undefined && (!omitLargeFiles || platform !== "deepseek" || !Array.isArray(capture.omittedFiles)
              || capture.omittedFiles.some(file => !file || typeof file.name !== "string" || !file.name.trim()
                || !Number.isSafeInteger(file.bytes) || file.bytes <= 4100000))) return reject(captureError("Invalid separate-file notice.", "incomplete"));
            if (typeof capture?.text !== "string" || !capture.text.trim() || !Number.isSafeInteger(capture.messageTurnCount) || capture.messageTurnCount < 1 || capture.text.length > 1000000 || new TextEncoder().encode(capture.text).length > 4000000) return reject(captureError("Fast capture returned an invalid or incomplete conversation.", "incomplete"));
            const name = { gemini: "Gemini", grok: "Grok", deepseek: "DeepSeek" }[platform];
            // MAIN owns the native adapter. Verify both views agree before accepting
            // its message boundaries; never infer roles from flattened text.
            if (!Array.isArray(capture.messages) || capture.messages.length !== capture.messageTurnCount
              || capture.messages.some(turn => !turn || !["user", "assistant"].includes(turn.role) || typeof turn.text !== "string" || !turn.text.trim())
              || capture.text !== `${name} conversation:\n\n${capture.messages.map(turn => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`).join("\n\n")}`) return reject(captureError("Fast capture returned invalid message boundaries.", "incomplete"));
            resolve(capture);
          } catch (error) { reject(error); }
        };
        const timer = setTimeout(() => { cleanup(); reject(captureError("Fast capture timed out. Refresh this chat or turn off the lightning button.", "timeout", "timeout", "history")); }, 27000);
        signal?.addEventListener("abort", onAbort, { once: true });
        window.addEventListener("message", receive);
        window.postMessage({ channel, platform, type: "request", id, ...before, ...(measureOnly ? { measureOnly: true } : {}), ...(omitLargeFiles ? { omitLargeFiles: true } : {}) }, location.origin);
        if (signal?.aborted) onAbort();
      });
    } finally {
      if (pinChat) {
        window.navigation?.removeEventListener("navigate", navigated);
        window.removeEventListener("popstate", navigated);
      }
    }
  };

  // Only an accepted source attempt is persisted by platform-content. Unused
  // picker snapshots stay in memory and never create telemetry reports.
  const readCapture = window.__capCaptureNetworkJson;
  window.__capMeasureNetworkJson = (expectedPath, signal, onEstimate) => readCapture(expectedPath,
    globalThis.CapJsonCaptureMetrics.create({ deadline_ms: 27000 }), true, signal, onEstimate);
  window.__capCaptureNetworkJson = async (expectedPath, omitLargeFiles = false, onProgress) => {
    const metrics = globalThis.CapJsonCaptureMetrics.create({ deadline_ms: 27000 }, onProgress);
    metrics.stage("hook");
    try {
      const capture = await readCapture(expectedPath, metrics, false, undefined, undefined, omitLargeFiles);
      metrics.checkpoint("complete", "serialize", { history_checked: true });
      metrics.set({ selected_turns: capture.messageTurnCount });
      if (capture.captureWarning) metrics.set({ outcome: "partial", failure_check: "text_invalid", failure_stage: "serialize" });
      return { ...capture, jsonCapture: metrics.finish() };
    } catch (error) { error.jsonCapture = metrics.finish(error); throw error; }
  };
})();
