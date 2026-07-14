(() => {
  const STORAGE_KEY = "context-generator-last-transfer-stats-v1";
  const PAGE_SOURCE = "context-generator-analysis-page";
  const BRIDGE_SOURCE = "context-generator-analysis-bridge";
  const RAW_TRANSCRIPT_RETENTION_MS = 24 * 60 * 60 * 1000;

  if (window.__contextGeneratorAnalysisBridgeLoaded) return;
  window.__contextGeneratorAnalysisBridgeLoaded = true;

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.data?.source !== PAGE_SOURCE) return;
    if (event.data.type !== "REQUEST_LAST_TRANSFER_STATS") return;

    postStats(await readLastTransferStats());
  });

  chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) return;
    postStats(changes[STORAGE_KEY].newValue || null);
  });

  postToPage("BRIDGE_READY", null);

  function readLastTransferStats() {
    return new Promise((resolve) => {
      chrome.storage.local.get(STORAGE_KEY, (result) => {
        const stats = result?.[STORAGE_KEY] || null;
        const retainedStats = withoutExpiredRawTranscript(stats);
        if (retainedStats === stats) {
          resolve(stats);
          return;
        }

        chrome.storage.local.set({ [STORAGE_KEY]: retainedStats }, () => resolve(retainedStats));
      });
    });
  }

  function withoutExpiredRawTranscript(stats) {
    if (!stats || typeof stats.rawScrapedText !== "string" || !stats.rawScrapedText) return stats;

    const explicitExpiry = Date.parse(stats.rawScrapedTextExpiresAt || "");
    const completedAt = Date.parse(stats.completedAt || "");
    const expiresAt = Number.isFinite(explicitExpiry)
      ? explicitExpiry
      : Number.isFinite(completedAt)
        ? completedAt + RAW_TRANSCRIPT_RETENTION_MS
        : 0;
    if (expiresAt > Date.now()) return stats;

    const retainedStats = { ...stats };
    delete retainedStats.rawScrapedText;
    delete retainedStats.rawScrapedTextExpiresAt;
    return retainedStats;
  }

  function postStats(stats) {
    postToPage("LAST_TRANSFER_STATS", stats);
  }

  function postToPage(type, payload) {
    window.postMessage({
      source: BRIDGE_SOURCE,
      type,
      payload
    }, window.location.origin);
  }
})();
