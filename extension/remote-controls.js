(function (root) {
  const STORAGE_KEY = "context-generator-remote-controls-v1";
  const ALARM = "refresh-cap-context-remote-controls";
  const INTERVAL_MS = 60000;
  const FEATURES = ["transfers", "inlineOrb", "jsonCapture", "automaticPaste"];
  const PLATFORMS = ["*", "claude", "chatgpt", "gemini", "grok", "deepseek"];
  const defaults = () => ({ version: 1, disabled: Object.fromEntries(FEATURES.map(key => [key, []])) });

  // Remote data can only turn packaged behavior off. Never accept code, URLs,
  // selectors or arbitrary commands here. Reject mistakes as a whole so a bad
  // edit cannot accidentally clear an already active emergency stop.
  function validate(value) {
    if (!value || value.version !== 1 || Object.keys(value).some(key => !["version", "disabled"].includes(key))
        || !value.disabled || typeof value.disabled !== "object" || Array.isArray(value.disabled)
        || Object.keys(value.disabled).some(key => !FEATURES.includes(key))) return null;
    const config = defaults();
    for (const key of FEATURES) {
      const sites = Object.hasOwn(value.disabled, key) ? value.disabled[key] : [];
      if (!Array.isArray(sites) || sites.length > PLATFORMS.length || sites.some(site => !PLATFORMS.includes(site))) return null;
      config.disabled[key] = [...new Set(sites)];
    }
    return config;
  }

  function disabled(config, feature, ...platforms) {
    const sites = config?.disabled?.[feature] || [];
    return sites.includes("*") || platforms.some(site => site && sites.includes(site));
  }

  function create({ chrome, endpoint, headers = () => ({}), fetchImpl = (...args) => fetch(...args),
    now = Date.now, timeoutMs = 3000 } = {}) {
    let config = defaults(), checkedAt = 0, inflight = null;
    const ready = Promise.resolve().then(() => chrome.storage.local.get(STORAGE_KEY)).then(stored => {
      const state = stored?.[STORAGE_KEY];
      const saved = validate(state?.config);
      if (saved) {
        config = saved;
        checkedAt = Number.isFinite(state.checkedAt) ? state.checkedAt : 0;
      }
    }).catch(() => {});

    async function refresh() {
      await ready;
      if (inflight) return inflight;
      if (checkedAt && now() >= checkedAt && now() - checkedAt < INTERVAL_MS) return config;
      inflight = (async () => {
        const controller = new AbortController();
        let timer, reader;
        try {
          const next = await Promise.race([(async () => {
            const url = endpoint();
            const response = await fetchImpl(url, { method: "GET", credentials: "omit", redirect: "error",
              cache: "no-store", headers: headers(url), signal: controller.signal });
            if (response.status !== 200 || response.redirected
                || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) throw new Error("invalid_controls");
            // Bound bytes while streaming, including responses without a length.
            if (controller.signal.aborted) throw new Error("controls_timeout");
            reader = response.body.getReader();
            try {
              let size = 0;
              const chunks = [];
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                size += value.byteLength;
                if (size > 8192) throw new Error("invalid_controls");
                chunks.push(value);
              }
              const bytes = new Uint8Array(size);
              let offset = 0;
              for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
              const result = validate(JSON.parse(new TextDecoder().decode(bytes)));
              if (!result) throw new Error("invalid_controls");
              return result;
            } finally { void reader.cancel().catch(() => {}); }
          })(), new Promise((_, reject) => {
            timer = setTimeout(() => { controller.abort(); reject(new Error("controls_timeout")); }, timeoutMs);
          })]);
          config = next;
        } catch {
          // Offline, invalid and missing configurations retain the last good
          // stop indefinitely. A first install without a cached stop stays usable.
        } finally {
          clearTimeout(timer);
          controller.abort();
          if (reader) void reader.cancel().catch(() => {});
          checkedAt = now();
          try { await chrome.storage.local.set({ [STORAGE_KEY]: { config, checkedAt } }); } catch {}
        }
        return config;
      })();
      try { return await inflight; } finally { inflight = null; }
    }
    return { ready, refresh, current: () => config };
  }

  root.CapRemoteControls = { STORAGE_KEY, ALARM, INTERVAL_MS, defaults, validate, disabled, create };
  if (typeof module !== "undefined") module.exports = root.CapRemoteControls;
})(globalThis);
