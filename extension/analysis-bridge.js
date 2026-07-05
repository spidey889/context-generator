(() => {
  const STORAGE_KEY = "context-generator-last-transfer-stats-v1";
  const PAGE_SOURCE = "context-generator-analysis-page";
  const BRIDGE_SOURCE = "context-generator-analysis-bridge";

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
        resolve(result?.[STORAGE_KEY] || null);
      });
    });
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
