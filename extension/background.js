const CHATGPT_URL = "https://chatgpt.com/";
const SUMMARY_BACKEND_URL = "https://context-generator-five.vercel.app/api/summarize";
const SUMMARY_CLIENT_HEADER = "cap-context-extension/1";
const PLATFORM_CONTENT_SCRIPT = "platform-content.js";
const SOURCE_MESSAGE_TIMEOUT_MS = 12000;
const DESTINATION_MESSAGE_TIMEOUT_MS = 30000;
const MESSAGE_RETRY_INTERVAL_MS = 120;
const DESTINATION_WARMUP_TIMEOUT_MS = 9000;
const SUMMARY_BACKEND_TIMEOUT_MS = 210000;
const SUMMARY_SERVICE_WORKER_KEEPALIVE_MS = 25000;
const SUMMARY_CACHE_TTL_MS = 120000;
const SUMMARY_CACHE_MAX_ENTRIES = 8;
const LAST_TRANSFER_STATS_STORAGE_KEY = "context-generator-last-transfer-stats-v1";
const RAW_TRANSCRIPT_RETENTION_MS = 24 * 60 * 60 * 1000;
const RAW_TRANSCRIPT_EXPIRY_ALARM = "expire-latest-run-raw-transcript";
const TELEMETRY_ENDPOINT_URL = "https://context-generator-five.vercel.app/api/telemetry";
const TELEMETRY_INSTALL_ID_STORAGE_KEY = "context-generator-install-id-v1";
const TELEMETRY_OUTBOX_STORAGE_KEY = "context-generator-telemetry-outbox-v1";
const TELEMETRY_RETRY_ALARM = "retry-transfer-telemetry";
const TELEMETRY_REQUEST_TIMEOUT_MS = 8000;
const TELEMETRY_RETRY_DELAY_MINUTES = 5;
const TELEMETRY_MAX_CHARACTER_COUNT = 2147483647;
const TELEMETRY_PLATFORMS = new Set(["claude", "chatgpt", "gemini", "grok", "deepseek"]);
const TELEMETRY_STATUSES = new Set(["started", "succeeded", "failed"]);
const TELEMETRY_STAGES = new Set([
  "intent_started",
  "capture_started",
  "capture_completed",
  "summary_request_started",
  "summary_response_started",
  "summary_completed",
  "paste_started",
  "completed"
]);
const TELEMETRY_FAILURE_REASONS = new Set([
  "no_conversation",
  "conversation_too_large",
  "capture_failed",
  "summary_rate_limited",
  "summary_service_busy",
  "summary_access_denied",
  "summary_failed",
  "destination_open_failed",
  "paste_failed",
  "extension_reloaded",
  "client_interrupted",
  "user_cancelled",
  "unknown_failure"
]);
const summaryCache = new Map();
const summaryInflight = new Map();
const activeTransferTelemetry = new Map();
const activeTransferSourceTabs = new Map();
let telemetryInstallIdPromise = null;
let telemetryWorkChain = Promise.resolve();
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
// Keep these rules aligned with manifest host access. Ordinary OpenAI pages are
// not ChatGPT surfaces and must never receive programmatic injection.
const DESTINATION_HOST_RULES = {
  claude: { domains: ["claude.ai"] },
  chatgpt: { domains: ["chatgpt.com"], exact: ["chat.openai.com"] },
  gemini: { exact: ["gemini.google.com"] },
  grok: { exact: ["grok.com"] },
  deepseek: { exact: ["chat.deepseek.com"] }
};

chrome.runtime.onInstalled.addListener(() => {
  injectIntoOpenSupportedTabs();
  scheduleStoredRawTranscriptExpiry();
  initializeTelemetryDelivery();
});

chrome.runtime.onStartup.addListener(() => {
  injectIntoOpenSupportedTabs();
  scheduleStoredRawTranscriptExpiry();
  initializeTelemetryDelivery();
});

chrome.tabs.onRemoved?.addListener((tabId) => {
  recordUserCancelledTransfersForTab(tabId);
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[LAST_TRANSFER_STATS_STORAGE_KEY]) return;
  scheduleRawTranscriptExpiry(changes[LAST_TRANSFER_STATS_STORAGE_KEY].newValue || null);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === RAW_TRANSCRIPT_EXPIRY_ALARM) expireStoredRawTranscript();
  if (alarm?.name === TELEMETRY_RETRY_ALARM) initializeTelemetryDelivery();
});

injectIntoOpenSupportedTabs();
scheduleStoredRawTranscriptExpiry();
initializeTelemetryDelivery();

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

function initializeTelemetryDelivery() {
  getOrCreateTelemetryInstallId().catch(() => {});
  enqueueTelemetryWork(() => flushTelemetryOutbox()).catch(() => {});
}

function enqueueTelemetryWork(work) {
  const next = telemetryWorkChain.catch(() => {}).then(work);
  telemetryWorkChain = next.catch(() => {});
  return next;
}

async function recordTransferTelemetry(event, sourceTabId = null) {
  const sanitizedEvent = sanitizeTransferTelemetryEvent(event);
  if (!sanitizedEvent) return;
  activeTransferTelemetry.set(sanitizedEvent.attemptId, sanitizedEvent);
  if (Number.isInteger(sourceTabId)) {
    activeTransferSourceTabs.set(sanitizedEvent.attemptId, sourceTabId);
  }

  const work = enqueueTelemetryWork(async () => {
    const installId = await getOrCreateTelemetryInstallId();
    const payload = {
      attempt_id: sanitizedEvent.attemptId,
      install_id: installId,
      attempted_at: sanitizedEvent.attemptedAt,
      source_platform: sanitizedEvent.sourcePlatform,
      destination_platform: sanitizedEvent.destinationPlatform,
      character_count: sanitizedEvent.characterCount,
      status: sanitizedEvent.status,
      last_stage: sanitizedEvent.lastStage,
      failure_reason: sanitizedEvent.failureReason,
      extension_version: chrome.runtime.getManifest?.().version || null
    };

    await appendTelemetryOutbox(payload);
    await flushTelemetryOutbox();
  });

  if (sanitizedEvent.status === "succeeded" || sanitizedEvent.status === "failed") {
    work.finally(() => {
      if (activeTransferTelemetry.get(sanitizedEvent.attemptId)?.status !== "started") {
        activeTransferTelemetry.delete(sanitizedEvent.attemptId);
        activeTransferSourceTabs.delete(sanitizedEvent.attemptId);
      }
    }).catch(() => {});
  }
  return work;
}

function recordUserCancelledTransfersForTab(tabId) {
  for (const [attemptId, sourceTabId] of activeTransferSourceTabs.entries()) {
    if (sourceTabId !== tabId) continue;
    const active = activeTransferTelemetry.get(attemptId);
    if (!active || active.status !== "started") continue;

    // Closing the source tab is the one unambiguous user-side cancellation
    // signal available after a transfer has started.
    recordTransferTelemetry({
      ...active,
      status: "failed",
      failureReason: "user_cancelled"
    }).catch(() => {});
  }
}

function recordKnownTransferTelemetryStage(attemptId, lastStage) {
  const active = activeTransferTelemetry.get(attemptId);
  if (!active || active.status !== "started" || !TELEMETRY_STAGES.has(lastStage)) return;
  recordTransferTelemetry({
    ...active,
    status: "started",
    lastStage,
    failureReason: null
  }).catch(() => {});
}

function sanitizeTransferTelemetryEvent(event) {
  if (!event || typeof event !== "object") return null;
  if (!isUuid(event.attemptId)) return null;
  if (!TELEMETRY_PLATFORMS.has(event.sourcePlatform)) return null;
  if (!TELEMETRY_PLATFORMS.has(event.destinationPlatform)) return null;
  if (!TELEMETRY_STATUSES.has(event.status)) return null;
  if (!TELEMETRY_STAGES.has(event.lastStage)) return null;
  if (event.status === "succeeded" && event.lastStage !== "completed") return null;
  if (event.status !== "succeeded" && event.lastStage === "completed") return null;

  const attemptedAtEpoch = Date.parse(event.attemptedAt || "");
  if (!Number.isFinite(attemptedAtEpoch)) return null;

  const characterCount = event.characterCount === null || event.characterCount === undefined
    ? null
    : Number(event.characterCount);
  if (characterCount !== null && (!Number.isInteger(characterCount) || characterCount < 0 || characterCount > TELEMETRY_MAX_CHARACTER_COUNT)) {
    return null;
  }

  const failureReason = event.status === "failed" ? event.failureReason : null;
  if (event.status === "failed" && !TELEMETRY_FAILURE_REASONS.has(failureReason)) return null;

  return {
    attemptId: event.attemptId,
    attemptedAt: new Date(attemptedAtEpoch).toISOString(),
    sourcePlatform: event.sourcePlatform,
    destinationPlatform: event.destinationPlatform,
    characterCount,
    status: event.status,
    lastStage: event.lastStage,
    failureReason
  };
}

async function getOrCreateTelemetryInstallId() {
  if (telemetryInstallIdPromise) return telemetryInstallIdPromise;

  telemetryInstallIdPromise = (async () => {
    const stored = await chrome.storage.local.get(TELEMETRY_INSTALL_ID_STORAGE_KEY);
    const existing = stored?.[TELEMETRY_INSTALL_ID_STORAGE_KEY];
    if (isUuid(existing)) return existing;

    const installId = createTelemetryUuid();
    await chrome.storage.local.set({ [TELEMETRY_INSTALL_ID_STORAGE_KEY]: installId });
    return installId;
  })();

  try {
    return await telemetryInstallIdPromise;
  } catch (error) {
    telemetryInstallIdPromise = null;
    throw error;
  }
}

async function appendTelemetryOutbox(payload) {
  const stored = await chrome.storage.local.get(TELEMETRY_OUTBOX_STORAGE_KEY);
  const outbox = Array.isArray(stored?.[TELEMETRY_OUTBOX_STORAGE_KEY])
    ? stored[TELEMETRY_OUTBOX_STORAGE_KEY]
    : [];
  outbox.push({ deliveryId: createTelemetryUuid(), payload });
  await chrome.storage.local.set({ [TELEMETRY_OUTBOX_STORAGE_KEY]: outbox });
}

async function flushTelemetryOutbox() {
  while (true) {
    const stored = await chrome.storage.local.get(TELEMETRY_OUTBOX_STORAGE_KEY);
    const outbox = Array.isArray(stored?.[TELEMETRY_OUTBOX_STORAGE_KEY])
      ? stored[TELEMETRY_OUTBOX_STORAGE_KEY]
      : [];
    const next = outbox[0];

    if (!next?.deliveryId || !next?.payload) {
      if (outbox.length) {
        await chrome.storage.local.set({ [TELEMETRY_OUTBOX_STORAGE_KEY]: outbox.slice(1) });
        continue;
      }
      await chrome.alarms.clear(TELEMETRY_RETRY_ALARM);
      return;
    }

    if (!await deliverTelemetryPayload(next.payload)) {
      chrome.alarms.create(TELEMETRY_RETRY_ALARM, { delayInMinutes: TELEMETRY_RETRY_DELAY_MINUTES });
      return;
    }

    const refreshed = await chrome.storage.local.get(TELEMETRY_OUTBOX_STORAGE_KEY);
    const currentOutbox = Array.isArray(refreshed?.[TELEMETRY_OUTBOX_STORAGE_KEY])
      ? refreshed[TELEMETRY_OUTBOX_STORAGE_KEY]
      : [];
    await chrome.storage.local.set({
      [TELEMETRY_OUTBOX_STORAGE_KEY]: currentOutbox.filter((entry) => entry?.deliveryId !== next.deliveryId)
    });
  }
}

async function deliverTelemetryPayload(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEMETRY_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(TELEMETRY_ENDPOINT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cap-Context-Client": SUMMARY_CLIENT_HEADER
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function createTelemetryUuid() {
  return crypto.randomUUID();
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "RECORD_TRANSFER_TELEMETRY") {
    recordTransferTelemetry(message.event, sender?.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

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
    transferToDestination(
      message.destination,
      message.text,
      message.preparedTabId,
      message.transferId,
      message.deferFinalActivation === true
    )
      .then((result) => sendResponse({ ok: true, timing: result?.timing || null, marks: result?.marks || [] }))
      .catch((error) => {
        console.error("[Context Generator Relay]", error);
        setBadge("ERR", "#b42318", 5000);
        sendResponse({ ok: false, error: error.message, code: error.code || "paste_failed" });
      });

    return true;
  }

  if (message?.type === "ACTIVATE_DESTINATION_TAB") {
    activateVerifiedDestinationTab(message.tabId, message.destination)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: "destination_open_failed" }));
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

  const cachedEntry = getCachedSummaryEntry(conversationText);
  if (cachedEntry) {
    const cachedResult = createCacheHitSummaryResult(cachedEntry);
    if (cachedResult) {
      recordKnownTransferTelemetryStage(transferId, "summary_response_started");
      logPerf(transferId, "summary cache hit", {
        chars: cachedResult.summary.length,
        cacheAgeMs: cachedResult.timing.cacheAgeMs
      });
      return cachedResult;
    }
    summaryCache.delete(conversationText);
  }

  const inFlightSummary = summaryInflight.get(conversationText);
  if (inFlightSummary) {
    logPerf(transferId, "summary inflight join", { chars: conversationText.length });
    return inFlightSummary.then((result) => {
      recordKnownTransferTelemetryStage(transferId, "summary_response_started");
      return result;
    });
  }

  const summaryPromise = fetchSummaryFromBackend(conversationText, transferId)
    .then((result) => {
      cacheSummaryResult(conversationText, result);
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
  const stopServiceWorkerKeepAlive = startSummaryServiceWorkerKeepAlive();

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
    recordKnownTransferTelemetryStage(transferId, "summary_response_started");
    const fetchMs = Math.round(nowMs() - fetchStartedAt);

    if (!response.ok) {
      logPerf(transferId, "summary backend response error", { status: response.status, fetchMs, attempt: 1 });
      throw await createSummaryBackendError(response);
    }

    const parseStartedAt = nowMs();
    const data = await response.json();
    const parseMs = Math.round(nowMs() - parseStartedAt);
    if (data?.ok === false || (data?.code && !data?.summary?.trim())) {
      throw createSummaryBackendPayloadError(data, data?.status || response.status);
    }
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
    stopServiceWorkerKeepAlive();
  }
}

function startSummaryServiceWorkerKeepAlive() {
  let stopped = false;
  let keepAliveTimer = null;

  const pingRuntime = () => {
    if (stopped) return;
    try {
      // Chromium resets the MV3 worker idle timer when an extension API call begins.
      chrome.runtime.getPlatformInfo?.(() => void chrome.runtime.lastError);
    } catch {
      // Firefox and test shims may not expose this optional API; the streamed response still remains valid.
    }
    keepAliveTimer = setTimeout(pingRuntime, SUMMARY_SERVICE_WORKER_KEEPALIVE_MS);
  };

  keepAliveTimer = setTimeout(pingRuntime, SUMMARY_SERVICE_WORKER_KEEPALIVE_MS);
  return () => {
    stopped = true;
    if (keepAliveTimer) clearTimeout(keepAliveTimer);
  };
}

async function createSummaryBackendError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Error bodies are optional; never expose an unparsed provider or platform response.
  }

  return createSummaryBackendPayloadError(payload, response.status);
}

function createSummaryBackendPayloadError(payload, status) {
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
  error.status = Number(status) || 500;
  return error;
}

function getCachedSummaryEntry(conversationText) {
  const cached = summaryCache.get(conversationText);
  if (!cached) return null;

  if (Date.now() > cached.expiresAt) {
    summaryCache.delete(conversationText);
    return null;
  }

  return cached;
}

function createCacheHitSummaryResult(cachedEntry) {
  const summary = cachedEntry?.result?.summary?.trim();
  if (!summary) return null;

  const originalTiming = cachedEntry.result.timing && typeof cachedEntry.result.timing === "object"
    ? cachedEntry.result.timing
    : {};
  return {
    summary,
    timing: {
      ...originalTiming,
      source: "cache",
      cacheHit: true,
      cacheAgeMs: Math.max(0, Date.now() - cachedEntry.cachedAt),
      originalSource: originalTiming.source || null,
      originalSummaryMs: originalTiming.summaryMs ?? null,
      summaryMs: 0,
      fetchMs: 0,
      parseMs: 0,
      chars: summary.length
    }
  };
}

function cacheSummaryResult(conversationText, result) {
  const summary = result?.summary?.trim();
  if (!summary) return;

  const cachedAt = Date.now();
  summaryCache.set(conversationText, {
    result: {
      summary,
      timing: result.timing && typeof result.timing === "object" ? result.timing : null
    },
    cachedAt,
    expiresAt: cachedAt + SUMMARY_CACHE_TTL_MS
  });

  while (summaryCache.size > SUMMARY_CACHE_MAX_ENTRIES) {
    const oldestKey = summaryCache.keys().next().value;
    summaryCache.delete(oldestKey);
  }
}

async function transferToDestination(
  destinationId,
  text,
  preparedTabId = null,
  transferId = null,
  deferFinalActivation = false
) {
  if (!text?.trim()) {
    const error = new Error("Context summary text was not available.");
    error.code = "paste_failed";
    throw error;
  }

  const trace = createBackgroundTrace(transferId);
  const destination = DESTINATIONS[destinationId];
  if (!destination) {
    const error = new Error("Unknown AI destination.");
    error.code = "destination_open_failed";
    throw error;
  }

  const trimmedText = text.trim();
  let pasteResult = null;
  let destinationTabId = null;
  let preparedAttempted = false;

  if (preparedTabId && await isPreparedDestinationTabUsable(preparedTabId, destinationId)) {
    preparedAttempted = true;
    destinationTabId = preparedTabId;
    markBackgroundTrace(trace, "prepared tab reused", { tabId: destinationTabId, destination: destinationId });
    try {
      pasteResult = await pasteIntoDestinationWithActivation(
        destinationTabId,
        destinationId,
        destination,
        trimmedText,
        transferId,
        trace,
        deferFinalActivation && destination.focusBeforePaste === true
      );
    } catch (error) {
      pasteResult = { ok: false, error: error?.message || "Prepared destination paste failed." };
    }
  } else if (preparedTabId) {
    markBackgroundTrace(trace, "prepared tab rejected", {
      tabId: preparedTabId,
      destination: destinationId,
      reason: "missing_or_navigated"
    });
  }

  if (!pasteResult?.ok) {
    const recoveringPreparedTab = Boolean(preparedTabId);
    if (preparedAttempted) {
      console.debug(
        "[Context Generator Relay] Prepared destination paste failed; retrying in one fresh tab:",
        pasteResult?.error || "No paste response."
      );
    }
    const openLabel = recoveringPreparedTab ? "fresh fallback tab" : "tab";
    markBackgroundTrace(trace, `${openLabel} open start`, {
      destination: destinationId,
      active: destination.focusBeforePaste === true,
      previousError: preparedAttempted ? pasteResult?.error || "No paste response." : null
    });
    destinationTabId = await createDestinationTab(destination, {
      active: deferFinalActivation
        ? destination.focusBeforePaste === true
        : (recoveringPreparedTab ? destination.focusBeforePaste === true : true)
    });
    markBackgroundTrace(trace, `${openLabel} open done`, { tabId: destinationTabId });
    pasteResult = await pasteIntoDestinationWithActivation(
      destinationTabId,
      destinationId,
      destination,
      trimmedText,
      transferId,
      trace,
      deferFinalActivation && destination.focusBeforePaste === true
    );
  }

  if (!pasteResult?.ok) {
    const error = new Error(pasteResult?.error || `Could not paste into ${destination.name}.`);
    error.code = "paste_failed";
    throw error;
  }

  if (!deferFinalActivation) {
    markBackgroundTrace(trace, "final tab activate start", { tabId: destinationTabId });
    await activateDestinationTab(destinationTabId);
    markBackgroundTrace(trace, "final tab activate done", { tabId: destinationTabId });
  } else {
    markBackgroundTrace(trace, "final tab activation deferred", { tabId: destinationTabId });
  }
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

async function isPreparedDestinationTabUsable(tabId, destinationId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const currentOrPendingUrl = tab?.pendingUrl || tab?.url || "";
    return getPlatformFromUrl(currentOrPendingUrl) === destinationId;
  } catch {
    return false;
  }
}

async function pasteIntoDestinationWithActivation(
  tabId,
  destinationId,
  destination,
  text,
  transferId,
  trace,
  showHandoffCompletion = false
) {
  if (destination.focusBeforePaste) {
    markBackgroundTrace(trace, "tab activate before paste start", { tabId });
    await activateDestinationTab(tabId);
    markBackgroundTrace(trace, "tab activate before paste done", { tabId });
    if (destination.activationSettleMs) {
      markBackgroundTrace(trace, "tab activation settle start", { tabId, settleMs: destination.activationSettleMs });
      await delay(destination.activationSettleMs);
      markBackgroundTrace(trace, "tab activation settle done", { tabId });
    }
  }

  markBackgroundTrace(trace, "paste message start", { tabId, destination: destinationId });
  const pasteResult = await pasteIntoDestinationTab(
    tabId,
    destinationId,
    destination,
    text,
    transferId,
    trace,
    showHandoffCompletion
  );
  markBackgroundTrace(trace, "paste message done", { tabId, responseTiming: pasteResult?.timing || null });
  return pasteResult;
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
  try {
    const destinationTab = await chrome.tabs.create({
      url: destination.url,
      active: options.active !== false
    });
    return destinationTab.id;
  } catch (error) {
    error.code = error.code || "destination_open_failed";
    throw error;
  }
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

async function activateVerifiedDestinationTab(tabId, destinationId) {
  if (!Number.isInteger(tabId) || !DESTINATIONS[destinationId]) {
    throw new Error("Destination tab was not available.");
  }
  if (!await isPreparedDestinationTabUsable(tabId, destinationId)) {
    throw new Error("Destination tab changed before activation.");
  }
  await activateDestinationTab(tabId);
}

async function pasteIntoDestinationTab(
  tabId,
  destinationId,
  destination,
  text,
  transferId = null,
  trace = null,
  showHandoffCompletion = false
) {
  try {
    return await sendMessageWhenReady(
      tabId,
      {
        type: "PASTE_CONTEXT",
        destination: destinationId,
        text,
        transferId,
        showHandoffCompletion
      },
      destination.contentScript,
      destination.messageTimeoutMs || DESTINATION_MESSAGE_TIMEOUT_MS,
      destination.name,
      transferId,
      trace
    );
  } catch (error) {
    error.code = error.code || "paste_failed";
    throw error;
  }
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
  const deadline = startedAt + timeoutMs;
  let lastError = null;
  let attempts = 0;

  while (Date.now() <= deadline) {
    attempts += 1;
    try {
      const response = await sendMessageBeforeDeadline(tabId, message, deadline, name);
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

    if (Date.now() > deadline) break;
    markBackgroundTrace(trace, "content script inject attempt", { tabId, attempts });
    await ensureContentScript(tabId, contentScript);

    try {
      const response = await sendMessageBeforeDeadline(tabId, message, deadline, name);
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

async function sendMessageBeforeDeadline(tabId, message, deadline, name) {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw createMessageTimeoutError(name);

  let timeout = null;
  try {
    return await Promise.race([
      sendMessage(tabId, message),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(createMessageTimeoutError(name)), remainingMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function createMessageTimeoutError(name) {
  const error = new Error(`Timed out connecting to ${name}.`);
  error.code = "message_timeout";
  return error;
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
    return Object.entries(DESTINATION_HOST_RULES).find(([, rules]) => {
      if ((rules.exact || []).includes(hostname)) return true;
      return (rules.domains || []).some((host) => hostname === host || hostname.endsWith(`.${host}`));
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
