const CHATGPT_URL = "https://chatgpt.com/";
const SUMMARY_BACKEND_URL = "https://context-generator-five.vercel.app/api/summarize";
const SUMMARY_CLIENT_HEADER = "cap-context-extension/1";
const PLATFORM_CONTENT_SCRIPT = "platform-content.js";
const SOURCE_MESSAGE_TIMEOUT_MS = 12000;
const DESTINATION_MESSAGE_TIMEOUT_MS = 30000;
const MESSAGE_RETRY_INTERVAL_MS = 120;
const DESTINATION_WARMUP_TIMEOUT_MS = 9000;
const SUMMARY_BACKEND_TIMEOUT_MS = 210000;
const SUMMARY_CACHE_TTL_MS = 120000;
const SUMMARY_CACHE_MAX_ENTRIES = 8;
const LAST_TRANSFER_STATS_STORAGE_KEY = "context-generator-last-transfer-stats-v1";
const RAW_TRANSCRIPT_RETENTION_MS = 24 * 60 * 60 * 1000;
const RAW_TRANSCRIPT_EXPIRY_ALARM = "expire-latest-run-raw-transcript";
const summaryCache = new Map();
const summaryInflight = new Map();
const DESTINATIONS = {
  claude: {
    name: "Claude",
    url: "https://claude.ai/",
    contentScript: PLATFORM_CONTENT_SCRIPT
  },
  chatgpt: {
    name: "ChatGPT",
    url: CHATGPT_URL,
    contentScript: PLATFORM_CONTENT_SCRIPT,
    focusBeforePaste: true,
    activationSettleMs: 350,
    messageTimeoutMs: 45000,
    warmupTimeoutMs: 12000
  },
  gemini: {
    name: "Gemini",
    url: "https://gemini.google.com/",
    contentScript: PLATFORM_CONTENT_SCRIPT
  },
  grok: {
    name: "Grok",
    url: "https://grok.com/",
    contentScript: PLATFORM_CONTENT_SCRIPT,
    focusBeforePaste: true
  },
  deepseek: {
    name: "DeepSeek",
    url: "https://chat.deepseek.com/",
    contentScript: PLATFORM_CONTENT_SCRIPT
  }
};
const DESTINATION_HOSTS = {
  claude: ["claude.ai"],
  chatgpt: ["chatgpt.com", "openai.com"],
  gemini: ["gemini.google.com"],
  grok: ["grok.com"],
  deepseek: ["chat.deepseek.com"]
};

chrome.runtime.onInstalled.addListener(() => {
  injectIntoOpenSupportedTabs();
  scheduleStoredRawTranscriptExpiry();
});

chrome.runtime.onStartup.addListener(() => {
  injectIntoOpenSupportedTabs();
  scheduleStoredRawTranscriptExpiry();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[LAST_TRANSFER_STATS_STORAGE_KEY]) return;
  scheduleRawTranscriptExpiry(changes[LAST_TRANSFER_STATS_STORAGE_KEY].newValue || null);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === RAW_TRANSCRIPT_EXPIRY_ALARM) expireStoredRawTranscript();
});

injectIntoOpenSupportedTabs();
scheduleStoredRawTranscriptExpiry();

async function scheduleStoredRawTranscriptExpiry() {
  try {
    const result = await chrome.storage.local.get(LAST_TRANSFER_STATS_STORAGE_KEY);
    await scheduleRawTranscriptExpiry(result?.[LAST_TRANSFER_STATS_STORAGE_KEY] || null);
  } catch (error) {
    console.debug("[Context Generator] Could not schedule raw transcript expiry:", error?.message || error);
  }
}

async function scheduleRawTranscriptExpiry(stats) {
  const expiresAt = getRawTranscriptExpiryEpoch(stats);
  if (!expiresAt) {
    await chrome.alarms.clear(RAW_TRANSCRIPT_EXPIRY_ALARM);
    return;
  }

  if (expiresAt <= Date.now()) {
    await expireStoredRawTranscript();
    return;
  }

  chrome.alarms.create(RAW_TRANSCRIPT_EXPIRY_ALARM, { when: expiresAt });
}

async function expireStoredRawTranscript() {
  try {
    const result = await chrome.storage.local.get(LAST_TRANSFER_STATS_STORAGE_KEY);
    const stats = result?.[LAST_TRANSFER_STATS_STORAGE_KEY];
    const expiresAt = getRawTranscriptExpiryEpoch(stats);
    if (!expiresAt) return;

    if (expiresAt > Date.now()) {
      chrome.alarms.create(RAW_TRANSCRIPT_EXPIRY_ALARM, { when: expiresAt });
      return;
    }

    // Preserve the receipt as-is and remove only the sensitive, short-lived payload.
    const retainedStats = { ...stats };
    delete retainedStats.rawScrapedText;
    delete retainedStats.rawScrapedTextExpiresAt;
    await chrome.storage.local.set({ [LAST_TRANSFER_STATS_STORAGE_KEY]: retainedStats });
  } catch (error) {
    console.debug("[Context Generator] Could not expire raw transcript:", error?.message || error);
  }
}

function getRawTranscriptExpiryEpoch(stats) {
  if (!stats || typeof stats.rawScrapedText !== "string" || !stats.rawScrapedText) return null;

  const explicitExpiry = Date.parse(stats.rawScrapedTextExpiresAt || "");
  if (Number.isFinite(explicitExpiry)) return explicitExpiry;

  // Receipts created before expiry metadata existed still receive the same 24-hour limit.
  const completedAt = Date.parse(stats.completedAt || "");
  return Number.isFinite(completedAt) ? completedAt + RAW_TRANSCRIPT_RETENTION_MS : Date.now();
}

chrome.action.onClicked.addListener(async (tab) => {
  try {
    clearBadge();

    const platform = getPlatformFromUrl(tab.url);
    if (!tab.id || !platform) {
      throw new Error("Open a supported AI chat, then click the extension icon.");
    }

    const startResult = await sendMessageWhenReady(
      tab.id,
      { type: "START_CONTEXT_TRANSFER" },
      PLATFORM_CONTENT_SCRIPT,
      SOURCE_MESSAGE_TIMEOUT_MS,
      "source AI tab"
    );

    if (!startResult?.ok) {
      throw new Error(startResult?.error || "Could not start context transfer.");
    }

    await setBadge("RUN", "#565add");
  } catch (error) {
    console.error("[Context Generator Relay]", error);
    await setBadge("ERR", "#b42318", 5000);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SUMMARIZE_WITH_BACKEND") {
    summarizeWithBackend(message.conversation, message.transferId)
      .then((result) => sendResponse({ ok: true, summary: result.summary, timing: result.timing }))
      .catch((error) => {
        console.error("[Context Generator Relay]", error);
        setBadge("ERR", "#b42318", 5000);
        sendResponse({
          ok: false,
          error: error.message,
          code: error.code || null,
          status: error.status || null
        });
      });

    return true;
  }

  if (message?.type === "TRANSFER_TO_DESTINATION") {
    transferToDestination(message.destination, message.text, message.preparedTabId, message.transferId)
      .then((result) => sendResponse({ ok: true, timing: result?.timing || null, marks: result?.marks || [] }))
      .catch((error) => {
        console.error("[Context Generator Relay]", error);
        setBadge("ERR", "#b42318", 5000);
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === "PREPARE_DESTINATION") {
    prepareDestination(message.destination, message.transferId)
      .then((result) => sendResponse({ ok: true, tabId: result.tabId, timing: result.timing }))
      .catch((error) => {
        console.error("[Context Generator Relay]", error);
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === "CONTEXT_TRANSFER_ERROR") {
    console.error("[Context Generator Relay]", message.error);
    setBadge("ERR", "#b42318", 5000);
  }

  return false;
});

async function summarizeWithBackend(conversation, transferId = null) {
  const conversationText = conversation?.trim();
  if (!conversationText) {
    throw new Error("AI conversation text could not be captured.");
  }

  const cachedSummary = getCachedSummary(conversationText);
  if (cachedSummary) {
    logPerf(transferId, "summary cache hit", { chars: cachedSummary.length });
    return {
      summary: cachedSummary,
      timing: { source: "cache", summaryMs: 0, chars: cachedSummary.length }
    };
  }

  const inFlightSummary = summaryInflight.get(conversationText);
  if (inFlightSummary) {
    logPerf(transferId, "summary inflight join", { chars: conversationText.length });
    return inFlightSummary;
  }

  const summaryPromise = fetchSummaryFromBackend(conversationText, transferId)
    .then((result) => {
      cacheSummary(conversationText, result.summary);
      return result;
    })
    .finally(() => {
      summaryInflight.delete(conversationText);
    });

  summaryInflight.set(conversationText, summaryPromise);
  return summaryPromise;
}

async function fetchSummaryFromBackend(conversationText, transferId = null) {
  const summaryStartedAt = nowMs();
  logPerf(transferId, "summary backend request start", { chars: conversationText.length, inputChars: conversationText.length });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUMMARY_BACKEND_TIMEOUT_MS);

  try {
    const fetchStartedAt = nowMs();
    const response = await fetch(SUMMARY_BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cap-Context-Client": SUMMARY_CLIENT_HEADER
      },
      body: JSON.stringify({ conversation: conversationText }),
      signal: controller.signal
    });
    const fetchMs = Math.round(nowMs() - fetchStartedAt);

    if (!response.ok) {
      logPerf(transferId, "summary backend response error", { status: response.status, fetchMs, attempt: 1 });
      throw await createSummaryBackendError(response);
    }

    const parseStartedAt = nowMs();
    const data = await response.json();
    const parseMs = Math.round(nowMs() - parseStartedAt);
    if (!data.summary?.trim()) throw new Error("Backup summarizer returned no summary.");

    const summary = data.summary.trim();
    const timing = {
      source: "backend",
      status: response.status,
      attempt: 1,
      summaryMs: Math.round(nowMs() - summaryStartedAt),
      fetchMs,
      parseMs,
      chars: summary.length,
      requestChars: conversationText.length,
      backendInputChars: data.timing?.inputChars || null,
      backend: data.timing || null
    };
    logPerf(transferId, "summary backend response done", timing);
    return { summary, timing };
  } finally {
    clearTimeout(timeout);
  }
}

async function createSummaryBackendError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Error bodies are optional; never expose an unparsed provider or platform response.
  }

  const code = typeof payload?.code === "string" ? payload.code : "summary_failed";
  const safeBackendMessage = typeof payload?.error === "string" && payload.error.length <= 240
    ? payload.error
    : "";
  const publicMessages = {
    conversation_too_large: safeBackendMessage || "This conversation is too large for Cap Context to transfer.",
    request_too_large: "This conversation is too large for Cap Context to transfer.",
    rate_limited: "Too many transfers were started from this network. Wait a moment, then try again.",
    service_busy: "Cap Context is busy right now. Wait a moment, then try again.",
    client_not_allowed: "This Cap Context extension version could not access the summary service."
  };
  const error = new Error(publicMessages[code] || "Cap Context could not create the summary. Please try again.");
  error.code = code;
  error.status = response.status;
  return error;
}

function getCachedSummary(conversationText) {
  const cached = summaryCache.get(conversationText);
  if (!cached) return "";

  if (Date.now() > cached.expiresAt) {
    summaryCache.delete(conversationText);
    return "";
  }

  return cached.summary;
}

function cacheSummary(conversationText, summary) {
  if (!summary?.trim()) return;

  summaryCache.set(conversationText, {
    summary: summary.trim(),
    expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS
  });

  while (summaryCache.size > SUMMARY_CACHE_MAX_ENTRIES) {
    const oldestKey = summaryCache.keys().next().value;
    summaryCache.delete(oldestKey);
  }
}

async function transferToDestination(destinationId, text, preparedTabId = null, transferId = null) {
  if (!text?.trim()) {
    throw new Error("Context summary text was not available.");
  }

  const trace = createBackgroundTrace(transferId);
  const destination = DESTINATIONS[destinationId];
  if (!destination) {
    throw new Error("Unknown AI destination.");
  }

  const trimmedText = text.trim();
  let pasteResult;
  let destinationTabId;

  try {
    if (preparedTabId) {
      destinationTabId = preparedTabId;
      markBackgroundTrace(trace, "prepared tab reused", { tabId: destinationTabId, destination: destinationId });
    } else {
      markBackgroundTrace(trace, "tab open start", { destination: destinationId, active: destination.focusBeforePaste === true });
      destinationTabId = await createDestinationTab(destination);
      markBackgroundTrace(trace, "tab open done", { tabId: destinationTabId });
    }
    if (destination.focusBeforePaste) {
      markBackgroundTrace(trace, "tab activate before paste start", { tabId: destinationTabId });
      await activateDestinationTab(destinationTabId);
      markBackgroundTrace(trace, "tab activate before paste done", { tabId: destinationTabId });
      if (destination.activationSettleMs) {
        markBackgroundTrace(trace, "tab activation settle start", { tabId: destinationTabId, settleMs: destination.activationSettleMs });
        await delay(destination.activationSettleMs);
        markBackgroundTrace(trace, "tab activation settle done", { tabId: destinationTabId });
      }
    }
    markBackgroundTrace(trace, "paste message start", { tabId: destinationTabId, destination: destinationId });
    pasteResult = await pasteIntoDestinationTab(destinationTabId, destinationId, destination, trimmedText, transferId, trace);
    markBackgroundTrace(trace, "paste message done", { tabId: destinationTabId, responseTiming: pasteResult?.timing || null });
  } catch (error) {
    if (!preparedTabId) throw error;

    markBackgroundTrace(trace, "fresh fallback tab open start", { destination: destinationId });
    destinationTabId = await createDestinationTab(destination, { active: destination.focusBeforePaste === true });
    markBackgroundTrace(trace, "fresh fallback tab open done", { tabId: destinationTabId });
    markBackgroundTrace(trace, "fresh fallback paste start", { tabId: destinationTabId });
    pasteResult = await pasteIntoDestinationTab(destinationTabId, destinationId, destination, trimmedText, transferId, trace);
    markBackgroundTrace(trace, "fresh fallback paste done", { tabId: destinationTabId, responseTiming: pasteResult?.timing || null });
  }

  if (!pasteResult?.ok && preparedTabId) {
    console.debug(
      "[Context Generator Relay] Prepared destination paste failed; retrying in a fresh tab:",
      pasteResult?.error || "No paste response."
    );
    markBackgroundTrace(trace, "prepared paste failed; fresh tab open start", { error: pasteResult?.error || "No paste response." });
    destinationTabId = await createDestinationTab(destination, { active: destination.focusBeforePaste === true });
    markBackgroundTrace(trace, "prepared paste failed; fresh tab open done", { tabId: destinationTabId });
    markBackgroundTrace(trace, "prepared paste failed; fresh paste start", { tabId: destinationTabId });
    pasteResult = await pasteIntoDestinationTab(destinationTabId, destinationId, destination, trimmedText, transferId, trace);
    markBackgroundTrace(trace, "prepared paste failed; fresh paste done", { tabId: destinationTabId, responseTiming: pasteResult?.timing || null });
  }

  if (!pasteResult?.ok) {
    throw new Error(pasteResult?.error || `Could not paste into ${destination.name}.`);
  }

  markBackgroundTrace(trace, "final tab activate start", { tabId: destinationTabId });
  await activateDestinationTab(destinationTabId);
  markBackgroundTrace(trace, "final tab activate done", { tabId: destinationTabId });
  await setBadge("OK", "#1f8f4d", 2500);
  return {
    timing: {
      totalMs: Math.round(nowMs() - trace.startedAt),
      tabId: destinationTabId,
      paste: pasteResult?.timing || null
    },
    marks: trace.marks
  };
}

async function prepareDestination(destinationId, transferId = null) {
  const startedAt = nowMs();
  const destination = DESTINATIONS[destinationId];
  if (!destination) {
    throw new Error("Unknown AI destination.");
  }

  logPerf(transferId, "tab open start", { destination: destinationId, active: false });
  const destinationTabId = await createDestinationTab(destination, { active: false });
  const openMs = Math.round(nowMs() - startedAt);
  logPerf(transferId, "tab open done", { destination: destinationId, tabId: destinationTabId, openMs });
  warmDestinationTab(destinationTabId, destination, transferId);
  return {
    tabId: destinationTabId,
    timing: { openMs, tabId: destinationTabId }
  };
}

async function createDestinationTab(destination, options = {}) {
  const destinationTab = await chrome.tabs.create({
    url: destination.url,
    active: options.active !== false
  });
  return destinationTab.id;
}

async function activateDestinationTab(tabId) {
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (error) {
    console.debug("[Context Generator Relay] Destination activation skipped:", error?.message || error);
  }
}

async function pasteIntoDestinationTab(tabId, destinationId, destination, text, transferId = null, trace = null) {
  return sendMessageWhenReady(
    tabId,
    {
      type: "PASTE_CONTEXT",
      destination: destinationId,
      text,
      transferId
    },
    destination.contentScript,
    destination.messageTimeoutMs || DESTINATION_MESSAGE_TIMEOUT_MS,
    destination.name,
    transferId,
    trace
  );
}

async function warmDestinationTab(tabId, destination, transferId = null) {
  try {
    const startedAt = Date.now();
    const timeoutMs = destination.warmupTimeoutMs || DESTINATION_WARMUP_TIMEOUT_MS;
    while (Date.now() - startedAt <= timeoutMs) {
      if (await pingTab(tabId)) {
        logPerf(transferId, "tab ready", {
          tabId,
          destination: destination.name,
          readyMs: Date.now() - startedAt
        });
        return;
      }
      if (await ensureContentScript(tabId, destination.contentScript) && await pingTab(tabId)) {
        logPerf(transferId, "tab ready", {
          tabId,
          destination: destination.name,
          readyMs: Date.now() - startedAt
        });
        return;
      }
      await delay(MESSAGE_RETRY_INTERVAL_MS);
    }
    logPerf(transferId, "tab ready timeout", { tabId, destination: destination.name, timeoutMs });
  } catch (error) {
    console.debug("[Context Generator Relay] Destination warmup skipped:", error?.message || error);
  }
}

async function pingTab(tabId) {
  try {
    const response = await sendMessage(tabId, { type: "CONTEXT_GENERATOR_PING" });
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId, file) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
    return true;
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes("Cannot access") && !message.includes("No tab with id")) {
      console.debug("[Context Generator Relay] Content script injection skipped:", message);
    }
    return false;
  }
}

async function injectIntoOpenSupportedTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        .filter((tab) => tab.id && getPlatformFromUrl(tab.url))
        .map((tab) => ensureContentScript(tab.id, PLATFORM_CONTENT_SCRIPT))
    );
  } catch (error) {
    console.debug("[Context Generator Relay] Startup content script injection skipped:", error?.message || error);
  }
}

function sendMessage(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function sendMessageWhenReady(tabId, message, contentScript, timeoutMs, name, transferId = null, trace = null) {
  const startedAt = Date.now();
  let lastError = null;
  let attempts = 0;

  while (Date.now() - startedAt <= timeoutMs) {
    attempts += 1;
    try {
      const response = await sendMessage(tabId, message);
      if (response !== undefined) {
        const readyMs = Date.now() - startedAt;
        logPerf(transferId, "tab ready/message response", { tabId, name, readyMs, attempts });
        markBackgroundTrace(trace, "tab ready/message response", { tabId, readyMs, attempts });
        return response;
      }
      lastError = new Error(`No response from ${name}.`);
    } catch (error) {
      lastError = error;
      if (!isRetryableMessageError(error)) {
        throw error;
      }
    }

    if (Date.now() - startedAt > timeoutMs) break;
    markBackgroundTrace(trace, "content script inject attempt", { tabId, attempts });
    await ensureContentScript(tabId, contentScript);

    try {
      const response = await sendMessage(tabId, message);
      if (response !== undefined) {
        const readyMs = Date.now() - startedAt;
        logPerf(transferId, "tab ready/message response after inject", { tabId, name, readyMs, attempts });
        markBackgroundTrace(trace, "tab ready/message response after inject", { tabId, readyMs, attempts });
        return response;
      }
      lastError = new Error(`No response from ${name}.`);
    } catch (error) {
      lastError = error;
      if (!isRetryableMessageError(error)) {
        throw error;
      }
    }

    await delay(MESSAGE_RETRY_INTERVAL_MS);
  }

  const detail = lastError?.message ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out connecting to ${name}.${detail}`);
}

function isRetryableMessageError(error) {
  const message = String(error?.message || error || "");
  return (
    message.includes("Receiving end does not exist") ||
    message.includes("Could not establish connection") ||
    message.includes("The message port closed before a response was received") ||
    message.includes("Extension context invalidated")
  );
}

function getPlatformFromUrl(url) {
  if (!url) return null;

  try {
    const hostname = new URL(url).hostname;
    return Object.entries(DESTINATION_HOSTS).find(([, hosts]) => {
      return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    })?.[0] || null;
  } catch {
    return null;
  }
}

async function setBadge(text, color, timeoutMs) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });

  if (timeoutMs) {
    setTimeout(clearBadge, timeoutMs);
  }
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}

function createBackgroundTrace(transferId) {
  return {
    id: transferId,
    startedAt: nowMs(),
    lastAt: null,
    marks: []
  };
}

function markBackgroundTrace(trace, label, detail = null) {
  if (!trace) return;
  const at = nowMs();
  const previous = trace.lastAt || trace.startedAt;
  const mark = {
    label,
    deltaMs: Math.round(at - previous),
    totalMs: Math.round(at - trace.startedAt),
    detail: detail || null
  };
  trace.lastAt = at;
  trace.marks.push(mark);
  logPerf(trace.id, label, {
    totalMs: mark.totalMs,
    deltaMs: mark.deltaMs,
    ...(detail || {})
  });
}

function logPerf(transferId, label, detail = null) {
  const suffix = detail ? ` ${JSON.stringify(detail)}` : "";
  console.debug(`[Context Generator Perf ${transferId || "no-trace"}] ${label}${suffix}`);
}

function nowMs() {
  return globalThis.performance?.now?.() || Date.now();
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
