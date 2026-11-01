(function (root) {
  const STORAGE_KEY = "context-generator-user-notices-v1";
  const INSTALL_KEY = "context-generator-install-id-v1";
  const LEGACY_SEEN_KEY = "context-generator-deepseek-retry-notice-seen-v1";
  const CHECK_INTERVAL_MS = 5 * 60 * 1000;
  // This ID is the hash of the original #49 message, not its installation ID.
  const LEGACY_NOTICE_ID = "0f8c623da1fe622fd75aa5d7f7f42169f127c8d359c9f644e2deb39e3331e227";
  const validNotice = value => value && typeof value.id === "string" && /^[a-f0-9]{64}$/.test(value.id)
    && typeof value.message === "string" && value.message.trim().length > 0 && value.message.length <= 1000;

  function create({ chrome, fetchImpl = (...args) => fetch(...args), endpoint, headers = () => ({}),
    hasConsent = async () => true, now = Date.now, timeoutMs = 8000, displayTimeoutMs = 2000 }) {
    let chain = Promise.resolve();
    async function dismiss(noticeId) {
      if (typeof noticeId !== "string" || !/^[a-f0-9]{64}$/.test(noticeId) || !await hasConsent()) return { logged: false };
      const stored = await chrome.storage.local.get([INSTALL_KEY, STORAGE_KEY]);
      const installId = stored[INSTALL_KEY], state = stored[STORAGE_KEY];
      if (!installId || state?.installId !== installId || !state.seen?.includes(noticeId)) return { logged: false };
      const controller = new AbortController();
      let timer;
      try {
        if (!await hasConsent()) return { logged: false };
        const response = await Promise.race([fetchImpl(endpoint(), {
          method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", "X-Cap-Context-Client": "cap-context-extension/1", ...headers(endpoint()) },
          body: JSON.stringify({ install_id: installId, event: "dismiss", notice_id: noticeId })
        }), new Promise((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error("notice_timeout")); }, timeoutMs);
        })]);
        return { logged: response.status === 204 };
      } catch { return { logged: false }; }
      finally { clearTimeout(timer); }
    }
    async function check(sender) {
      const work = chain.then(async () => {
        if (!await hasConsent()) return { shown: false };
        const stored = await chrome.storage.local.get([INSTALL_KEY, STORAGE_KEY, LEGACY_SEEN_KEY]);
        const installId = stored[INSTALL_KEY];
        if (typeof installId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(installId))
          return { shown: false };
        const previous = stored[STORAGE_KEY]?.installId === installId ? stored[STORAGE_KEY] : {};
        const state = { installId, checkedAt: Number(previous.checkedAt) || 0, notice: validNotice(previous.notice) ? previous.notice : null,
          seen: Array.isArray(previous.seen) ? previous.seen.filter(id => /^[a-f0-9]{64}$/.test(id)) : [] };
        if (stored[LEGACY_SEEN_KEY] === true && !state.seen.includes(LEGACY_NOTICE_ID)) state.seen.push(LEGACY_NOTICE_ID);
        if (!state.checkedAt || now() - state.checkedAt >= CHECK_INTERVAL_MS || now() < state.checkedAt) {
          const controller = new AbortController();
          let timer;
          try {
            state.notice = await Promise.race([(async () => {
              const response = await fetchImpl(endpoint(), {
                method: "POST", redirect: "error", credentials: "omit", cache: "no-store", signal: controller.signal,
                headers: { "Content-Type": "application/json", "X-Cap-Context-Client": "cap-context-extension/1", ...headers(endpoint()) },
                body: JSON.stringify({ install_id: installId })
              });
              if (!response.ok) throw new Error("notice_unavailable");
              const body = await response.text();
              if (body.length > 7000) throw new Error("notice_invalid");
              const result = JSON.parse(body);
              if (result.notice !== null && !validNotice(result.notice)) throw new Error("notice_invalid");
              return result.notice;
            })(), new Promise((_, reject) => {
              timer = setTimeout(() => { controller.abort(); reject(new Error("notice_timeout")); }, timeoutMs);
            })]);
            state.checkedAt = now();
          } catch {
            // Retry after one minute; a failed refresh may still deliver the
            // last successfully fetched, unseen notice while offline.
            state.checkedAt = now() - CHECK_INTERVAL_MS + 60000;
          } finally { clearTimeout(timer); }
          await chrome.storage.local.set({ [STORAGE_KEY]: state });
        }
        const notice = state.notice;
        if (!validNotice(notice) || state.seen.includes(notice.id)) return { shown: false };
        if (!await hasConsent()) return { shown: false };
        // Reserve durably before dispatch. A worker restart or lost reply must
        // not show the same notice twice. Only an explicit refusal releases it.
        state.seen.push(notice.id);
        await chrome.storage.local.set({ [STORAGE_KEY]: state });
        let timer;
        try {
          const reply = await Promise.race([
            chrome.tabs.sendMessage(sender.tab.id, { type: "SHOW_USER_NOTICE", notice },
              sender.documentId ? { documentId: sender.documentId } : { frameId: 0 }),
            new Promise(resolve => { timer = setTimeout(() => resolve(null), displayTimeoutMs); })
          ]);
          if (reply?.shown === false) {
            state.seen = state.seen.filter(id => id !== notice.id);
            await chrome.storage.local.set({ [STORAGE_KEY]: state });
          }
          return { shown: reply?.shown === true };
        } catch (error) {
          // These failures mean no document received the message. A closed
          // reply port/timeout is ambiguous and keeps the durable reservation.
          if (/Receiving end does not exist|Could not establish connection|No tab with id|No document with id|No frame with id/i.test(String(error?.message || ""))) {
            state.seen = state.seen.filter(id => id !== notice.id);
            await chrome.storage.local.set({ [STORAGE_KEY]: state });
          }
          return { shown: false };
        } finally { clearTimeout(timer); }
      });
      chain = work.catch(() => ({ shown: false }));
      return chain;
    }
    return { check, dismiss };
  }
  root.CapUserNotices = { create, validNotice };
  if (typeof module !== "undefined") module.exports = root.CapUserNotices;
})(globalThis);
