if (!globalThis.CapTransferDiagnostics && typeof importScripts === "function") importScripts("transfer-diagnostics.js");
const SUMMARY_BACKEND_URL = "https://context-generator-five.vercel.app/api/summarize";
const SUMMARY_CLIENT_HEADER = "cap-context-extension/1";
const PLATFORM_CONTENT_SCRIPT = "platform-content.js";
const SOURCE_MESSAGE_TIMEOUT_MS = 12000;
const DESTINATION_MESSAGE_TIMEOUT_MS = 30000;
const MESSAGE_RETRY_INTERVAL_MS = 120;
const DESTINATION_WARMUP_TIMEOUT_MS = 9000;
const SUMMARY_BACKEND_TIMEOUT_MS = 320000;
const SUMMARY_TELEMETRY_WAIT_MS = 1000;
const SUMMARY_SERVICE_WORKER_KEEPALIVE_MS = 25000;
const SUMMARY_CACHE_TTL_MS = 120000;
const SUMMARY_CACHE_MAX_ENTRIES = 8;
const LAST_TRANSFER_STATS_STORAGE_KEY = "context-generator-last-transfer-stats-v1";
const RAW_TRANSCRIPT_RETENTION_MS = 24 * 60 * 60 * 1000;
const RAW_TRANSCRIPT_EXPIRY_ALARM = "expire-latest-run-raw-transcript";
const TELEMETRY_ENDPOINT_URL = "https://context-generator-five.vercel.app/api/telemetry";
const TELEMETRY_INSTALL_ID_STORAGE_KEY = "context-generator-install-id-v1";
const TELEMETRY_OUTBOX_STORAGE_KEY = "context-generator-telemetry-outbox-v1";
const TELEMETRY_ACTIVE_STORAGE_KEY = "context-generator-active-transfers-v1";
const TELEMETRY_DIAGNOSTICS_STORAGE_KEY = "context-generator-telemetry-diagnostics-v1";
const TELEMETRY_OUTBOX_MAX_ENTRIES = 500;
const TELEMETRY_OUTBOX_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const TELEMETRY_ACTIVE_MAX_AGE_MS = 6 * 60 * 1000;
const TELEMETRY_DIAGNOSTICS_MAX_ENTRIES = 100;
const TELEMETRY_RETRY_ALARM = "retry-transfer-telemetry";
const TELEMETRY_REQUEST_TIMEOUT_MS = 8000;
const TELEMETRY_RETRY_BASE_MS = 30000;
const TELEMETRY_RETRY_MAX_MS = 60 * 60 * 1000;
const TELEMETRY_CONFIG_RETRY_BASE_MS = 5 * 60 * 1000;
const TELEMETRY_MAX_CHARACTER_COUNT = 2147483647;
const TELEMETRY_PLATFORMS = new Set(["claude", "chatgpt", "gemini", "grok", "deepseek"]);
const TELEMETRY_STATUSES = new Set(["started", "succeeded", "failed"]);
// Only serving-route identifiers enter reports; transcript text and attempted
// providers never belong in this field. Keep the catalog aligned with ingress.
const TELEMETRY_REPORTED_MODELS = new Set(["local-direct", "gemini-3.6-flash", "gemini-3.5-flash-lite", "ministral-14b-2512",
  "inclusionai/ling-3.1-flash", "qwen/qwen3.8-27b:free", "dots-studio/dots-3-note-preview:free", "google/gemma-4-26b-a4b-it:free"]);
const TELEMETRY_MODEL_STAGES = new Set(["summary_completed", "paste_started", "completed"]);
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
const transferOperations = new Map();
const activeTransferTelemetry = new Map();
const activeTransferSourceTabs = new Map();
const summaryProofs = new Map();
let telemetryInstallIdPromise = null;
let telemetryWorkChain = Promise.resolve();
let telemetryDeliveryChain = Promise.resolve();
let telemetryDeliveryRunning = false;
let telemetryDeliveryRequested = false;
const DESTINATIONS = {
  claude: {
    name: "Claude",
    url: "https://claude.ai/",
    // Reveal the native composer before it hydrates and restores its draft.
    focusBeforePaste: true,
    activationSettleMs: 350
  },
  chatgpt: {
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    focusBeforePaste: true,
    activationSettleMs: 350,
    messageTimeoutMs: 45000,
    warmupTimeoutMs: 12000
  },
  gemini: {
    name: "Gemini",
    url: "https://gemini.google.com/"
  },
  grok: {
    name: "Grok",
    url: "https://grok.com/",
    focusBeforePaste: true
  },
  deepseek: {
    name: "DeepSeek",
    url: "https://chat.deepseek.com/"
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
// Only reuse the new-chat surfaces opened by this extension, never a saved chat.
const DESTINATION_LANDING_PATHS = {
  claude: ["/", "/new"], chatgpt: ["/"], gemini: ["/", "/app"],
  grok: ["/", "/chat"], deepseek: ["/", "/a/chat"]
};

chrome.runtime.onInstalled.addListener(initializeBackground);
chrome.runtime.onStartup.addListener(initializeBackground);

chrome.tabs.onRemoved?.addListener((tabId) => {
  // Revoke delivery synchronously; optional telemetry/storage must not delay it.
  const cancelledIds = [];
  for (const operation of transferOperations.values()) {
    if (!operation.tabIds.has(tabId)) continue;
    cancelTransferOperation(operation);
    cancelledIds.push(operation.transferId);
  }
  return recordUserCancelledTransfersForTab(tabId, cancelledIds).catch(() => {});
});

function createTransferCancelledError() {
  const error = new Error("Transfer cancelled because a transfer tab was closed.");
  error.code = "user_cancelled";
  return error;
}

function getTransferOperation(transferId, sourceTab, deadlineAt) {
  // Legacy/internal calls without an owner retain their existing behavior.
  if (!transferId || !Number.isInteger(sourceTab?.id)) return null;
  for (const [id, operation] of transferOperations) {
    if (operation.expiresAt <= Date.now()) transferOperations.delete(id);
  }
  let operation = transferOperations.get(transferId);
  if (!operation) {
    operation = { transferId, sourceTabId: sourceTab.id, tabIds: new Set([sourceTab.id]),
      controller: new AbortController(), deadlineAt, expiresAt: deadlineAt || Date.now() + 360000 };
    transferOperations.set(transferId, operation);
  }
  if (operation.sourceTabId !== sourceTab.id) throw createTransferCancelledError();
  checkTransferOperation(operation);
  return operation;
}

function checkTransferOperation(operation) {
  operation?.controller.signal.throwIfAborted();
  checkTransferDeadline(operation?.deadlineAt);
}

function cancelTransferOperation(operation) {
  if (operation.controller.signal.aborted) return;
  operation.controller.abort(createTransferCancelledError());
  for (const tabId of operation.tabIds) {
    chrome.tabs.sendMessage(tabId, { type: "CANCEL_TRANSFER", transferId: operation.transferId }).catch(() => {});
  }
}

async function checkTransferSource(operation) {
  checkTransferOperation(operation);
  if (!operation) return;
  try { await chrome.tabs.get(operation.sourceTabId); }
  catch { cancelTransferOperation(operation); }
  checkTransferOperation(operation);
}

async function waitForTransferWork(work, operation) {
  if (!operation) return work;
  const signal = operation.controller.signal;
  let onAbort;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      onAbort = () => reject(signal.reason);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
    })]);
  } finally { signal.removeEventListener("abort", onAbort); }
}

async function checkDestinationTransfer(transferId, sourceTabId) {
  const operation = transferOperations.get(transferId);
  checkTransferOperation(operation);
  // Destination work can survive a worker restart. Recheck the source rather
  // than treating a lost in-memory cancellation token as permission to paste.
  if (!Number.isInteger(sourceTabId) || (operation && operation.sourceTabId !== sourceTabId)) {
    throw createTransferCancelledError();
  }
  try { await chrome.tabs.get(sourceTabId); }
  catch { throw createTransferCancelledError(); }
  checkTransferOperation(operation);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[LAST_TRANSFER_STATS_STORAGE_KEY]) return;
  scheduleRawTranscriptExpiry(changes[LAST_TRANSFER_STATS_STORAGE_KEY].newValue || null);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === RAW_TRANSCRIPT_EXPIRY_ALARM) expireStoredRawTranscript();
  if (alarm?.name === TELEMETRY_RETRY_ALARM) initializeTelemetryDelivery();
});

initializeBackground();

function initializeBackground() {
  injectIntoOpenSupportedTabs();
  scheduleStoredRawTranscriptExpiry();
  initializeTelemetryDelivery();
}

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
  telemetryDeliveryRequested = true;
  if (telemetryDeliveryRunning) return;
  // The storage chain never waits for a network request. One delivery loop is
  // enough, even while many progress updates arrive during a slow request.
  telemetryDeliveryRunning = true;
  telemetryDeliveryChain = (async () => {
    do {
      telemetryDeliveryRequested = false;
      await enqueueTelemetryWork(async () => {
        await getOrCreateTelemetryInstallId();
        await restoreActiveTransferTelemetry();
      });
      await flushTelemetryOutbox();
    } while (telemetryDeliveryRequested);
  })().catch(() => {
    chrome.alarms.create(TELEMETRY_RETRY_ALARM, { delayInMinutes: 5 });
  }).finally(() => {
    telemetryDeliveryRunning = false;
    if (telemetryDeliveryRequested) initializeTelemetryDelivery();
  });
}

function enqueueTelemetryWork(work) {
  const next = telemetryWorkChain.catch(() => {}).then(work);
  telemetryWorkChain = next.catch(() => {});
  return next;
}

async function recordTransferTelemetry(event, sourceTabId = null) {
  const sanitizedEvent = sanitizeTransferTelemetryEvent(event);
  if (!sanitizedEvent) return;
  return enqueueTelemetryWork(async () => {
    await restoreActiveTransferTelemetry();
    const known = activeTransferTelemetry.get(sanitizedEvent.attemptId);
    if (known && !sameTransferIdentity(known, sanitizedEvent)) {
      await recordTelemetryDiagnostic("identity_conflict", makeTelemetryPayload(sanitizedEvent, null));
      return;
    }
    const queuedIdentity = (await readTelemetryOutbox()).find(entry => entry.payload.attempt_id === sanitizedEvent.attemptId)?.payload;
    const mergedEvent = mergeTransferTelemetryEvents(known, {
      ...sanitizedEvent, extensionVersion: queuedIdentity?.extension_version || known?.extensionVersion || chrome.runtime.getManifest?.().version || null
    });
    if (known?.status !== "started" && known?.status && known.status !== sanitizedEvent.status && sanitizedEvent.status !== "started") {
      await recordTelemetryDiagnostic("terminal_conflict", makeTelemetryPayload(sanitizedEvent, null));
    }
    activeTransferTelemetry.set(mergedEvent.attemptId, mergedEvent);
    if (Number.isInteger(sourceTabId)) activeTransferSourceTabs.set(mergedEvent.attemptId, sourceTabId);
    const installId = await getOrCreateTelemetryInstallId();
    const payload = makeTelemetryPayload(mergedEvent, installId);
    await appendTelemetryOutbox(payload);
    await persistActiveTransferTelemetry(mergedEvent.attemptId);
    initializeTelemetryDelivery();
  });
}

function sameTransferIdentity(first, second) {
  return first.attemptId === second.attemptId && first.attemptedAt === second.attemptedAt
    && first.sourcePlatform === second.sourcePlatform && first.destinationPlatform === second.destinationPlatform;
}

function mergeTransferTelemetryEvents(previous, next) {
  if (!previous) return next;
  // First terminal outcome wins as a unit: never produce failed + completed.
  if (previous.status !== "started") return {
    ...previous,
    ...(!previous.diagnostics && next.status === previous.status && next.lastStage === previous.lastStage
      && next.failureReason === previous.failureReason && next.diagnostics ? { diagnostics: next.diagnostics } : {}),
    ...(TELEMETRY_MODEL_STAGES.has(previous.lastStage) && !previous.reportedModel && next.reportedModel
      ? { reportedModel: next.reportedModel } : {})
  };
  const stages = [...TELEMETRY_STAGES];
  return {
    ...next,
    lastStage: next.status === "succeeded" ? "completed"
      : stages.indexOf(previous.lastStage) > stages.indexOf(next.lastStage) ? previous.lastStage : next.lastStage,
    characterCount: next.characterCount ?? previous.characterCount,
    ...((previous.diagnostics || next.diagnostics) ? { diagnostics: {
      ...(previous.diagnostics || {}), ...(next.status !== "started" || stages.indexOf(next.lastStage) >= stages.indexOf(previous.lastStage)
        ? next.diagnostics || {} : {}) } } : {}),
    ...(previous.reportedModel || next.reportedModel ? { reportedModel: previous.reportedModel || next.reportedModel } : {})
  };
}

function makeTelemetryPayload(event, installId) {
  const confirmation = summaryProofs.get(event.attemptId);
  return {
    attempt_id: event.attemptId,
    install_id: installId,
    attempted_at: event.attemptedAt,
    source_platform: event.sourcePlatform,
    destination_platform: event.destinationPlatform,
    character_count: event.characterCount,
    status: event.status,
    last_stage: event.lastStage,
    failure_reason: event.failureReason,
    extension_version: event.extensionVersion || chrome.runtime.getManifest?.().version || null,
    ...(event.diagnostics ? { diagnostics: event.diagnostics } : {}),
    ...(event.completedAt ? { completed_at: event.completedAt } : {}),
    ...(event.reportedModel ? { reported_model: event.reportedModel } : {}),
    ...(confirmation ? confirmation : {})
  };
}

async function restoreActiveTransferTelemetry() {
  const activeStorage = chrome.storage.session || chrome.storage.local;
  const stored = await activeStorage.get(TELEMETRY_ACTIVE_STORAGE_KEY);
  const entries = stored?.[TELEMETRY_ACTIVE_STORAGE_KEY] || {};
  const retained = {};
  activeTransferTelemetry.clear();
  activeTransferSourceTabs.clear();
  summaryProofs.clear();
  for (const [attemptId, entry] of Object.entries(entries)) {
    const event = sanitizeTransferTelemetryEvent(entry?.event, false);
    if (!event || event.attemptId !== attemptId) continue;
    if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= Date.now()) {
      if (event.status === "started") await recordTelemetryDiagnostic("outcome_unknown", makeTelemetryPayload(event, null));
      continue;
    }
    retained[attemptId] = { event, tabId: Number.isInteger(entry.tabId) ? entry.tabId : null, expiresAt: entry.expiresAt };
    activeTransferTelemetry.set(attemptId, event);
    if (Number.isInteger(entry.tabId)) activeTransferSourceTabs.set(attemptId, entry.tabId);
    const confirmation = sanitizeSummaryConfirmation(entry);
    if (confirmation) {
      summaryProofs.set(attemptId, confirmation);
      Object.assign(retained[attemptId], confirmation);
    }
  }
  // Normal progress rereads clean records; only expiry/schema cleanup needs a
  // write. Avoid putting unchanged snapshots back on the summary's I/O path.
  if (JSON.stringify(entries) !== JSON.stringify(retained)) {
    await activeStorage.set({ [TELEMETRY_ACTIVE_STORAGE_KEY]: retained });
  }
}

async function persistActiveTransferTelemetry(attemptId) {
  const activeStorage = chrome.storage.session || chrome.storage.local;
  const stored = await activeStorage.get(TELEMETRY_ACTIVE_STORAGE_KEY);
  const entries = stored?.[TELEMETRY_ACTIVE_STORAGE_KEY] || {};
  const currentEvent = activeTransferTelemetry.get(attemptId);
  const currentSourceTabId = activeTransferSourceTabs.get(attemptId);
  const currentConfirmation = summaryProofs.get(attemptId);
  for (const [id, entry] of Object.entries(entries)) {
    if (entry?.expiresAt > Date.now()) continue;
    const event = sanitizeTransferTelemetryEvent(entry?.event, false);
    if (event?.status === "started") await recordTelemetryDiagnostic("outcome_unknown", makeTelemetryPayload(event, null));
    delete entries[id];
    activeTransferTelemetry.delete(id);
    activeTransferSourceTabs.delete(id);
    summaryProofs.delete(id);
  }
  if (currentEvent) entries[attemptId] = {
    event: currentEvent,
    tabId: currentSourceTabId ?? null,
    expiresAt: Date.now() + TELEMETRY_ACTIVE_MAX_AGE_MS,
    ...(currentConfirmation || {})
  };
  if (currentEvent) activeTransferTelemetry.set(attemptId, currentEvent);
  if (Number.isInteger(currentSourceTabId)) activeTransferSourceTabs.set(attemptId, currentSourceTabId);
  if (currentConfirmation) summaryProofs.set(attemptId, currentConfirmation);
  while (Object.keys(entries).length > TELEMETRY_OUTBOX_MAX_ENTRIES) {
    const oldestId = Object.keys(entries).find(id => entries[id].event?.status !== "started") || Object.keys(entries)[0];
    const removed = entries[oldestId];
    if (removed.event?.status === "started") await recordTelemetryDiagnostic("outcome_unknown", makeTelemetryPayload(removed.event, null));
    delete entries[oldestId];
    activeTransferTelemetry.delete(oldestId);
    activeTransferSourceTabs.delete(oldestId);
    summaryProofs.delete(oldestId);
  }
  await activeStorage.set({ [TELEMETRY_ACTIVE_STORAGE_KEY]: entries });
}

async function recordUserCancelledTransfersForTab(tabId, cancelledIds = []) {
  await enqueueTelemetryWork(() => restoreActiveTransferTelemetry());
  const work = [];
  for (const [attemptId, sourceTabId] of activeTransferSourceTabs.entries()) {
    if (sourceTabId !== tabId && !cancelledIds.includes(attemptId)) continue;
    const active = activeTransferTelemetry.get(attemptId);
    if (!active || active.status !== "started") continue;

    // Closing the source tab is the one unambiguous user-side cancellation
    // signal available after a transfer has started.
    work.push(recordTransferTelemetry({
      ...active,
      status: "failed",
      failureReason: "user_cancelled",
      diagnostics: { ...(active.diagnostics || { version: 1 }), error_code: sourceTabId === tabId ? "source_tab_closed" : "destination_tab_closed",
        error_origin: "background", cancelled: true }
    }));
  }
  await Promise.all(work);
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

function sanitizeTransferTelemetryEvent(event, captureCompletionTime = true) {
  if (!event || typeof event !== "object") return null;
  if (!isUuid(event.attemptId)) return null;
  if (!TELEMETRY_PLATFORMS.has(event.sourcePlatform)) return null;
  if (!TELEMETRY_PLATFORMS.has(event.destinationPlatform)) return null;
  if (!TELEMETRY_STATUSES.has(event.status)) return null;
  if (!TELEMETRY_STAGES.has(event.lastStage)) return null;
  if (event.status === "succeeded" && event.lastStage !== "completed") return null;
  if (event.status !== "succeeded" && event.lastStage === "completed") return null;
  if (event.reportedModel !== undefined && (!TELEMETRY_REPORTED_MODELS.has(event.reportedModel)
    || !TELEMETRY_MODEL_STAGES.has(event.lastStage))) return null;
  const diagnostics = event.diagnostics === undefined ? undefined : globalThis.CapTransferDiagnostics?.validate(event.diagnostics);
  if (event.diagnostics !== undefined && !diagnostics) return null;

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
    failureReason,
    ...(diagnostics ? { diagnostics } : {}),
    ...(event.reportedModel ? { reportedModel: event.reportedModel } : {}),
    ...(!captureCompletionTime && typeof event.extensionVersion === "string" && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(event.extensionVersion)
      ? { extensionVersion: event.extensionVersion } : {}),
    ...(event.status !== "started" && (event.completedAt || captureCompletionTime)
      ? { completedAt: Number.isFinite(Date.parse(event.completedAt || ""))
        ? new Date(event.completedAt).toISOString() : new Date().toISOString() } : {})
  };
}

async function getOrCreateTelemetryInstallId() {
  if (telemetryInstallIdPromise) return telemetryInstallIdPromise;

  telemetryInstallIdPromise = (async () => {
    const stored = await chrome.storage.local.get(TELEMETRY_INSTALL_ID_STORAGE_KEY);
    const existing = stored?.[TELEMETRY_INSTALL_ID_STORAGE_KEY];
    if (isUuid(existing)) return existing;

    const installId = crypto.randomUUID();
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

// This function is called only on the storage chain. Legacy entries without
// queuedAt get their retention clock on upgrade, preserving existing reports.
async function readTelemetryOutbox() {
  const stored = await chrome.storage.local.get(TELEMETRY_OUTBOX_STORAGE_KEY);
  const entries = Array.isArray(stored?.[TELEMETRY_OUTBOX_STORAGE_KEY])
    ? stored[TELEMETRY_OUTBOX_STORAGE_KEY]
    : [];
  const retained = await compactTelemetryOutbox(entries);
  if (JSON.stringify(entries) !== JSON.stringify(retained)) {
    await chrome.storage.local.set({ [TELEMETRY_OUTBOX_STORAGE_KEY]: retained });
  }
  return retained;
}

async function compactTelemetryOutbox(entries) {
  const retained = [];
  for (const entry of entries) {
    const payload = sanitizeStoredTelemetryPayload(entry?.payload);
    if (!entry?.deliveryId || typeof entry.deliveryId !== "string" || !payload) {
      await recordTelemetryDiagnostic("quarantined_local", entry?.payload);
      continue;
    }
    const queuedAt = Number.isFinite(entry.queuedAt) ? entry.queuedAt : Date.now();
    if (queuedAt <= Date.now() - TELEMETRY_OUTBOX_MAX_AGE_MS) {
      await recordTelemetryDiagnostic(payload.status === "started" ? "expired_progress" : "expired_terminal", payload);
      continue;
    }
    const previousIndex = retained.findIndex(item => item.payload.attempt_id === payload.attempt_id);
    if (previousIndex !== -1 && samePayloadIdentity(retained[previousIndex].payload, payload)) {
      const previous = retained[previousIndex];
      retained[previousIndex] = {
        ...entry, payload: mergeTelemetryPayloads(previous.payload, payload), queuedAt: Math.min(previous.queuedAt, queuedAt)
      };
    } else retained.push({ deliveryId: entry.deliveryId, payload, queuedAt });
  }
  while (retained.length > TELEMETRY_OUTBOX_MAX_ENTRIES) {
    const progressIndex = retained.findIndex(entry => telemetryDeliveryPriority(entry.payload) === 0);
    const confirmationIndex = retained.findIndex(entry => telemetryDeliveryPriority(entry.payload) === 1);
    const removed = retained.splice(progressIndex !== -1 ? progressIndex : confirmationIndex !== -1 ? confirmationIndex : 0, 1)[0];
    await recordTelemetryDiagnostic(removed.payload.status !== "started" ? "overflow_terminal"
      : removed.payload.summary_proof ? "overflow_confirmation" : "overflow_progress", removed.payload);
  }
  return retained;
}

async function appendTelemetryOutbox(payload) {
  const outbox = await readTelemetryOutbox();
  const previousIndex = outbox.findIndex(entry => entry.payload.attempt_id === payload.attempt_id);
  if (previousIndex !== -1 && !samePayloadIdentity(outbox[previousIndex].payload, payload)) {
    await recordTelemetryDiagnostic("identity_conflict", payload);
    return;
  }
  const previous = previousIndex === -1 ? null : outbox[previousIndex];
  const mergedPayload = previous ? mergeTelemetryPayloads(previous.payload, payload) : payload;
  if (previous && JSON.stringify(previous.payload) === JSON.stringify(mergedPayload)) return;
  const entry = {
    // A revision gets a new delivery ID so an in-flight acknowledgement cannot
    // remove a newer terminal report or proof appended during its request.
    deliveryId: crypto.randomUUID(),
    payload: mergedPayload,
    queuedAt: previous?.queuedAt ?? Date.now()
  };
  if (previousIndex === -1) outbox.push(entry);
  else outbox[previousIndex] = entry;
  // Validate/prune the new snapshot before its one durable commit. A worker
  // stopping after this write must never leave an oversized or unsanitized queue.
  const retained = await compactTelemetryOutbox(outbox);
  await chrome.storage.local.set({ [TELEMETRY_OUTBOX_STORAGE_KEY]: retained });
}

async function flushTelemetryOutbox() {
  while (true) {
    const next = await enqueueTelemetryWork(async () => {
      const outbox = await readTelemetryOutbox();
      const diagnostics = await readTelemetryDiagnostics();
      if (!outbox.length) return null;
      if (diagnostics.retry?.nextAttemptAt > Date.now()) {
        chrome.alarms.create(TELEMETRY_RETRY_ALARM, { when: diagnostics.retry.nextAttemptAt });
        return false;
      }
      return outbox.reduce((selected, entry) => !selected || telemetryDeliveryPriority(entry.payload) > telemetryDeliveryPriority(selected.payload)
        ? entry : selected, null);
    });
    if (next === false) return;
    if (!next) {
      await chrome.alarms.clear(TELEMETRY_RETRY_ALARM);
      return;
    }

    const result = await deliverTelemetryPayload(next.payload);
    if (result.kind === "retry" || result.kind === "configuration") {
      await enqueueTelemetryWork(() => scheduleTelemetryRetry(result));
      return;
    }

    await enqueueTelemetryWork(async () => {
      const currentOutbox = await readTelemetryOutbox();
      await chrome.storage.local.set({
        [TELEMETRY_OUTBOX_STORAGE_KEY]: currentOutbox.filter(entry => entry.deliveryId !== next.deliveryId)
      });
      await recordTelemetryDiagnostic(result.kind === "delivered" ? "delivered" : "quarantined_remote", next.payload, result);
      const diagnostics = await readTelemetryDiagnostics();
      delete diagnostics.retry;
      await chrome.storage.local.set({ [TELEMETRY_DIAGNOSTICS_STORAGE_KEY]: diagnostics });
    });
  }
}

function telemetryDeliveryPriority(payload) {
  return payload.status !== "started" ? 2 : payload.summary_proof ? 1 : 0;
}

function samePayloadIdentity(first, second) {
  return first.attempt_id === second.attempt_id && first.install_id === second.install_id
    && first.attempted_at === second.attempted_at && first.source_platform === second.source_platform
    && first.destination_platform === second.destination_platform;
}

function mergeTelemetryPayloads(previous, next) {
  const terminal = previous.status !== "started";
  const stages = [...TELEMETRY_STAGES];
  const previousProof = sanitizeSummaryConfirmation(previous);
  const nextProof = sanitizeSummaryConfirmation(next);
  // Upgrade legacy receipts, but retain the first attribution at the same
  // version so retries cannot switch the model of an already completed run.
  const proofVersion = proof => proof?.model ? 3 : proof?.summary_confirmed_at ? 2 : 1;
  const useNextProof = nextProof && (!previousProof || proofVersion(nextProof) > proofVersion(previousProof));
  const proof = useNextProof ? nextProof : previousProof;
  const merged = {
    ...next,
    status: terminal ? previous.status : next.status,
    last_stage: terminal ? previous.last_stage : next.status === "succeeded" ? "completed"
      : stages.indexOf(previous.last_stage) > stages.indexOf(next.last_stage) ? previous.last_stage : next.last_stage,
    failure_reason: terminal ? previous.failure_reason : next.failure_reason,
    ...((previous.diagnostics || next.diagnostics) ? { diagnostics: terminal
      ? previous.diagnostics || (next.status === previous.status && next.last_stage === previous.last_stage && next.failure_reason === previous.failure_reason ? next.diagnostics : undefined)
      : { ...(previous.diagnostics || {}), ...(next.status !== "started" || stages.indexOf(next.last_stage) >= stages.indexOf(previous.last_stage) ? next.diagnostics || {} : {}) } } : {}),
    // Late incomplete progress cannot erase the known captured count or the
    // extension version authenticated by an already generated receipt.
    character_count: previous.summary_proof ? previous.character_count : next.character_count ?? previous.character_count,
    // Keep a proof paired with the version it authenticated, including an
    // in-flight backend response created across an extension update.
    extension_version: useNextProof ? next.extension_version : previous.extension_version,
    ...(terminal && previous.completed_at ? { completed_at: previous.completed_at } : {}),
    ...(proof || {})
  };
  if (proof && !proof.summary_confirmed_at) delete merged.summary_confirmed_at;
  if (!proof?.model) delete merged.model;
  // Later progress and restart compaction must preserve an observed model
  // independently of the signed proof/model pair.
  if (TELEMETRY_MODEL_STAGES.has(merged.last_stage) && (previous.reported_model || next.reported_model)) {
    merged.reported_model = previous.reported_model || next.reported_model;
  } else delete merged.reported_model;
  if (terminal && !previous.completed_at) delete merged.completed_at;
  return merged;
}

function sanitizeSummaryConfirmation(input) {
  if (typeof input?.summary_proof !== "string" || !/^[0-9a-f]{64}$/.test(input.summary_proof)) return null;
  if (input.summary_confirmed_at !== undefined && !Number.isFinite(Date.parse(input.summary_confirmed_at))) return null;
  if (input.model !== undefined && (!input.summary_confirmed_at || typeof input.model !== "string"
      || !/^[a-z0-9][a-z0-9._:/-]{0,159}$/.test(input.model))) return null;
  return {
    summary_proof: input.summary_proof,
    ...(input.summary_confirmed_at ? { summary_confirmed_at: new Date(input.summary_confirmed_at).toISOString() } : {}),
    ...(input.model !== undefined ? { model: input.model } : {})
  };
}

function sanitizeStoredTelemetryPayload(payload) {
  const keys = new Set(["attempt_id", "install_id", "attempted_at", "source_platform", "destination_platform",
    "character_count", "status", "last_stage", "failure_reason", "extension_version", "summary_proof", "completed_at", "summary_confirmed_at", "model", "reported_model", "diagnostics"]);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some(key => !keys.has(key))) return null;
  if (!isUuid(payload.install_id) || typeof payload.extension_version !== "string"
    || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(payload.extension_version)) return null;
  const event = sanitizeTransferTelemetryEvent({
    attemptId: payload.attempt_id, attemptedAt: payload.attempted_at, sourcePlatform: payload.source_platform,
    destinationPlatform: payload.destination_platform, characterCount: payload.character_count,
    status: payload.status, lastStage: payload.last_stage, failureReason: payload.failure_reason, completedAt: payload.completed_at,
    reportedModel: payload.reported_model, diagnostics: payload.diagnostics
  }, false);
  if (!event || (payload.completed_at !== undefined && (payload.status === "started" || !Number.isFinite(Date.parse(payload.completed_at))))) return null;
  const confirmation = sanitizeSummaryConfirmation(payload);
  if ((payload.summary_proof !== undefined || payload.summary_confirmed_at !== undefined || payload.model !== undefined) && !confirmation) return null;
  return {
    attempt_id: event.attemptId, install_id: payload.install_id, attempted_at: event.attemptedAt,
    source_platform: event.sourcePlatform, destination_platform: event.destinationPlatform,
    character_count: event.characterCount, status: event.status, last_stage: event.lastStage,
    failure_reason: event.failureReason, extension_version: payload.extension_version,
    ...(event.diagnostics ? { diagnostics: event.diagnostics } : {}),
    ...(event.completedAt ? { completed_at: event.completedAt } : {}),
    ...(event.reportedModel ? { reported_model: event.reportedModel } : {}), ...(confirmation || {})
  };
}

async function readTelemetryDiagnostics() {
  const stored = await chrome.storage.local.get(TELEMETRY_DIAGNOSTICS_STORAGE_KEY);
  const diagnostics = stored?.[TELEMETRY_DIAGNOSTICS_STORAGE_KEY];
  return diagnostics && typeof diagnostics === "object" ? diagnostics : { counts: {}, recent: [] };
}

async function recordTelemetryDiagnostic(reason, payload, result = {}) {
  const diagnostics = await readTelemetryDiagnostics();
  diagnostics.counts = diagnostics.counts || {};
  diagnostics.counts[reason] = Math.min(Number.MAX_SAFE_INTEGER, (diagnostics.counts[reason] || 0) + 1);
  // Only fixed enums and bounded metadata enter diagnostics. Rejected arbitrary
  // payloads, server bodies, proofs and errors never get copied into this log.
  const event = {
    at: new Date().toISOString(), reason,
    ...(isUuid(payload?.attempt_id) ? { attemptId: payload.attempt_id } : {}),
    ...(TELEMETRY_STATUSES.has(payload?.status) ? { status: payload.status } : {}),
    ...(TELEMETRY_STAGES.has(payload?.last_stage) ? { lastStage: payload.last_stage } : {}),
    ...(TELEMETRY_FAILURE_REASONS.has(payload?.failure_reason) ? { failureReason: payload.failure_reason } : {}),
    ...(typeof payload?.summary_proof === "string" && /^[0-9a-f]{64}$/.test(payload.summary_proof) ? { summaryConfirmed: true } : {}),
    ...(Number.isInteger(result.status) && result.status >= 100 && result.status <= 599 ? { httpStatus: result.status } : {})
  };
  if (reason !== "delivered") diagnostics.recent = [...(diagnostics.recent || []), event].slice(-TELEMETRY_DIAGNOSTICS_MAX_ENTRIES);
  diagnostics.lastDelivery = reason === "delivered" ? event : diagnostics.lastDelivery;
  await chrome.storage.local.set({ [TELEMETRY_DIAGNOSTICS_STORAGE_KEY]: diagnostics });
}

async function scheduleTelemetryRetry(result) {
  const diagnostics = await readTelemetryDiagnostics();
  const failures = Math.min(12, (diagnostics.retry?.failures || 0) + 1);
  const base = result.kind === "configuration" ? TELEMETRY_CONFIG_RETRY_BASE_MS : TELEMETRY_RETRY_BASE_MS;
  const exponential = Math.min(TELEMETRY_RETRY_MAX_MS, base * 2 ** (failures - 1));
  const delayMs = Math.min(TELEMETRY_RETRY_MAX_MS, Math.max(result.retryAfterMs || 0, exponential * (0.75 + Math.random() * 0.5)));
  const nextAttemptAt = Date.now() + Math.max(TELEMETRY_RETRY_BASE_MS, Math.round(delayMs));
  diagnostics.retry = { failures, nextAttemptAt, kind: result.kind, ...(result.status ? { httpStatus: result.status } : {}) };
  await chrome.storage.local.set({ [TELEMETRY_DIAGNOSTICS_STORAGE_KEY]: diagnostics });
  await recordTelemetryDiagnostic(result.kind === "configuration" ? "configuration_retry" : "transient_retry", null, result);
  chrome.alarms.create(TELEMETRY_RETRY_ALARM, { when: nextAttemptAt });
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
    if (response.ok) return { kind: "delivered", status: response.status };
    const status = response.status;
    let code = null;
    try {
      const body = await response.json();
      if (typeof body?.code === "string") code = body.code;
    } catch {}
    if ([400, 413, 415, 422].includes(status) || (status === 409 && code === "attempt_identity_mismatch")) {
      return { kind: "quarantined", status };
    }
    const retryAfter = response.headers?.get?.("retry-after");
    const seconds = Number(retryAfter);
    const retryAfterMs = retryAfter && Number.isFinite(seconds) ? Math.max(0, seconds * 1000)
      : retryAfter && Number.isFinite(Date.parse(retryAfter)) ? Math.max(0, Date.parse(retryAfter) - Date.now()) : 0;
    return {
      kind: [401, 403, 404, 405].includes(status) || (status === 503 && code === "telemetry_unavailable") ? "configuration" : "retry",
      status, retryAfterMs: Math.min(TELEMETRY_RETRY_MAX_MS, retryAfterMs)
    };
  } catch {
    return { kind: "retry" };
  } finally {
    clearTimeout(timeout);
  }
}

function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
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
  if (message?.type === "CHECK_TRANSFER_ACTIVE") {
    checkDestinationTransfer(message.transferId, message.sourceTabId)
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: error.message, code: "user_cancelled" }));
    return true;
  }
  if (message?.type === "ENSURE_NETWORK_JSON_HOOK") {
    if (!sender?.tab?.id || !["gemini", "grok", "deepseek"].includes(getPlatformFromUrl(sender.tab.url)) || sender.frameId !== 0) {
      sendResponse({ ok: false }); return false;
    }
    ensureNetworkJsonHook(sender.tab.id).then(ok => sendResponse({ ok }));
    return true;
  }

  if (message?.type === "ENSURE_CHATGPT_JSON_HOOK") {
    if (!sender?.tab?.id || getPlatformFromUrl(sender.tab.url) !== "chatgpt" || sender.frameId !== 0) {
      sendResponse({ ok: false }); return false;
    }
    ensureChatGptJsonHook(sender.tab.id).then(ok => sendResponse({ ok }));
    return true;
  }

  if (message?.type === "ENSURE_CLAUDE_JSON_HOOK") {
    if (!sender?.tab?.id || getPlatformFromUrl(sender.tab.url) !== "claude" || sender.frameId !== 0) {
      sendResponse({ ok: false }); return false;
    }
    ensureClaudeJsonHook(sender.tab.id).then(ok => sendResponse({ ok }));
    return true;
  }

  if (message?.type === "RECORD_TRANSFER_TELEMETRY") {
    recordTransferTelemetry(message.event, sender?.tab?.id)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "SUMMARIZE_WITH_BACKEND") {
    summarizeWithBackend(message.conversation, message.transferId, message.deadlineAt, sender?.tab)
      .then((result) => sendResponse({ ok: true, summary: result.summary, timing: result.timing }))
      .catch((error) => {
        if (error.code !== "user_cancelled") {
          console.error("[Context Generator Relay]", error);
          setBadge("ERR", "#b42318", 5000);
        }
        sendResponse({
          ok: false,
          error: error.message,
          code: error.code || null,
          status: error.status || null,
          diagnostics: getBackgroundFailureDiagnostics(error, "summary_request")
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
      message.deferFinalActivation === true,
      message.deadlineAt,
      sender?.tab
    )
      .then((result) => sendResponse({ ok: true, timing: result?.timing || null, marks: result?.marks || [], diagnostics: result?.diagnostics || null }))
      .catch((error) => {
        if (error.code !== "user_cancelled") {
          console.error("[Context Generator Relay]", error);
          setBadge("ERR", "#b42318", 5000);
        }
        sendResponse({ ok: false, error: error.message, code: error.code || "paste_failed", diagnostics: error.diagnostics || null });
      });

    return true;
  }

  if (message?.type === "ACTIVATE_DESTINATION_TAB") {
    activateVerifiedDestinationTab(message.tabId, message.destination, message.deadlineAt, message.transferId, sender?.tab)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code || "destination_open_failed",
        diagnostics: getBackgroundFailureDiagnostics(error, "destination_activate") }));
    return true;
  }

  if (message?.type === "PREPARE_DESTINATION") {
    prepareDestination(message.destination, message.deadlineAt, sender?.tab, message.transferId)
      .then((result) => sendResponse({ ok: true, tabId: result.tabId, timing: result.timing }))
      .catch((error) => {
        console.error("[Context Generator Relay]", error);
        sendResponse({ ok: false, error: error.message, code: error.code || "destination_open_failed",
          diagnostics: getBackgroundFailureDiagnostics(error, "destination_prepare") });
      });

    return true;
  }

  if (message?.type === "CONTEXT_TRANSFER_ERROR") {
    console.error("[Context Generator Relay]", message.error);
    setBadge("ERR", "#b42318", 5000);
  }

  return false;
});

async function readSummaryResponse(response, checkDeadline) {
  // Older deployments return ordinary JSON. The new stream still has exactly
  // one authoritative final result; previews never become pasted context.
  if (!response.headers?.get("content-type")?.includes("application/x-ndjson")) return response.json();
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", result, eof = false;
  const consume = () => {
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const event = JSON.parse(line);
      if (result || !["reset", "delta", "result"].includes(event.type)) throw new Error("Invalid summary stream");
      if (event.type === "result") {
        if (!event.data || typeof event.data !== "object") throw new Error("Invalid summary stream result");
        result = event.data;
      }
    }
  };
  try {
    while (!eof) {
      checkDeadline();
      const chunk = await reader.read();
      checkDeadline();
      eof = chunk.done;
      buffer += eof ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      consume();
    }
    if (buffer.trim() || !result) throw new Error("Summary stream ended before completion");
    return result;
  } finally {
    if (!eof) { try { reader.cancel().catch(() => {}); } catch {} }
    reader.releaseLock();
  }
}

async function summarizeWithBackend(conversation, transferId = null, deadlineAt = null, sourceTab = null) {
  const operation = getTransferOperation(transferId, sourceTab, deadlineAt);
  checkTransferDeadline(deadlineAt);
  await checkTransferSource(operation);
  const conversationText = conversation?.trim();
  if (!conversationText) {
    throw new Error("AI conversation text could not be captured.");
  }

  const cachedEntry = getCachedSummaryEntry(conversationText);
  if (cachedEntry) {
    const cachedResult = createCacheHitSummaryResult(cachedEntry);
    if (cachedResult) {
      recordKnownTransferTelemetryStage(transferId, "summary_response_started");
      return cachedResult;
    }
    summaryCache.delete(conversationText);
  }

  let entry = summaryInflight.get(conversationText);
  if (!entry) {
    entry = { controller: new AbortController(), waiters: 0, settled: false };
    const ownedEntry = entry;
    entry.promise = fetchSummaryFromBackend(conversationText, transferId, deadlineAt, entry.controller.signal)
      .then(result => {
        ownedEntry.controller.signal.throwIfAborted();
        cacheSummaryResult(conversationText, result);
        return result;
      }).finally(() => {
        ownedEntry.settled = true;
        if (summaryInflight.get(conversationText) === ownedEntry) summaryInflight.delete(conversationText);
      });
    summaryInflight.set(conversationText, entry);
  }
  entry.waiters += 1;
  let timeout;
  try {
    // A closed/expired waiter leaves independently; shared work stops only
    // when nobody still needs it. Preserve the first request's own deadline.
    const work = deadlineAt ? Promise.race([entry.promise, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(createTransferTimeoutError()), Math.max(0, deadlineAt - Date.now()));
    })]) : entry.promise;
    const result = await waitForTransferWork(work, operation);
    checkTransferDeadline(deadlineAt);
    await checkTransferSource(operation);
    recordKnownTransferTelemetryStage(transferId, "summary_response_started");
    return result;
  } catch (error) {
    checkTransferOperation(operation);
    checkTransferDeadline(deadlineAt);
    throw error;
  } finally {
    clearTimeout(timeout);
    entry.waiters -= 1;
    if (!entry.waiters && !entry.settled) {
      entry.controller.abort(createTransferCancelledError());
      if (summaryInflight.get(conversationText) === entry) summaryInflight.delete(conversationText);
    }
  }
}

async function fetchSummaryFromBackend(conversationText, transferId = null, deadlineAt = null, requestSignal = null) {
  checkTransferDeadline(deadlineAt);
  const summaryStartedAt = nowMs();
  const diagnostics = { version: 1, last_operation: "summary_request" };
  let responseReceived = false;
  const controller = new AbortController();
  const onCancel = () => controller.abort(requestSignal.reason);
  requestSignal?.addEventListener("abort", onCancel, { once: true });
  if (requestSignal?.aborted) onCancel();
  const requestDeadlineAt = Math.min(Date.now() + SUMMARY_BACKEND_TIMEOUT_MS, deadlineAt || Infinity);
  const timeout = setTimeout(() => controller.abort(), Math.max(0, requestDeadlineAt - Date.now()));
  const stopServiceWorkerKeepAlive = startSummaryServiceWorkerKeepAlive();
  const checkSummaryDeadline = () => {
    checkTransferDeadline(deadlineAt);
    // Response/storage microtasks may run before an overdue abort timer.
    if (Date.now() >= requestDeadlineAt) controller.abort();
    controller.signal.throwIfAborted();
  };

  try {
    // Attribution is optional. Bound stalled storage as well as rejected I/O;
    // queued work can finish later without holding up the summary request.
    const telemetry = await waitForSummaryTelemetry(enqueueTelemetryWork(async () => {
      await restoreActiveTransferTelemetry();
      const active = activeTransferTelemetry.get(transferId);
      if (!active || active.status !== "started") return null;
      // Older workers persisted active events without a version. An existing
      // outbox envelope is the best available identity across an update.
      const queuedIdentity = (await readTelemetryOutbox()).find(entry => entry.payload.attempt_id === transferId)?.payload;
      active.extensionVersion = queuedIdentity?.extension_version || active.extensionVersion || chrome.runtime.getManifest?.().version || null;
      await persistActiveTransferTelemetry(transferId);
      return makeTelemetryPayload(active, await getOrCreateTelemetryInstallId());
    }), controller.signal);
    checkSummaryDeadline();
    const fetchStartedAt = nowMs();
    const response = await fetch(SUMMARY_BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/x-ndjson",
        "X-Cap-Context-Client": SUMMARY_CLIENT_HEADER
      },
      body: JSON.stringify({ conversation: conversationText, ...(telemetry ? { telemetry } : {}) }),
      signal: controller.signal
    });
    responseReceived = true;
    globalThis.CapTransferDiagnostics?.update(diagnostics, { summary_http_status: response.status,
      summary_fetch_ms: Math.round(nowMs() - fetchStartedAt), last_operation: "summary_response" });
    checkSummaryDeadline();
    recordKnownTransferTelemetryStage(transferId, "summary_response_started");
    const fetchMs = Math.round(nowMs() - fetchStartedAt);

    if (!response.ok) {
      throw await createSummaryBackendError(response);
    }

    const parseStartedAt = nowMs();
    const data = await readSummaryResponse(response, checkSummaryDeadline);
    const parseMs = Math.round(nowMs() - parseStartedAt);
    if (data?.ok === false || (data?.code && !data?.summary?.trim())) {
      throw createSummaryBackendPayloadError(data, data?.status || response.status);
    }
    if (!data.summary?.trim()) throw Object.assign(new Error("Backup summarizer returned no summary."), { diagnosticCode: "summary_empty" });
    const confirmation = sanitizeSummaryConfirmation({
      summary_proof: data.summaryProofV3 || data.summaryProofV2 || data.summaryProof,
      ...(data.summaryProofV3 || data.summaryProofV2 ? { summary_confirmed_at: data.summaryConfirmedAt } : {}),
      ...(data.summaryProofV3 ? { model: data.summaryModel } : {})
    });
    if (telemetry && confirmation) {
      // Already received receipts confirm generation, never a paste. Give
      // persistence a bounded head start;
      // keep the serialized write queued if storage stalls or the wait expires.
      await waitForSummaryTelemetry(enqueueTelemetryWork(async () => {
        const active = activeTransferTelemetry.get(transferId);
        if (active) summaryProofs.set(transferId, confirmation);
        try {
          await appendTelemetryOutbox({ ...telemetry, last_stage: "summary_completed", ...confirmation });
        } finally {
          // Retain the receipt in session storage even if the local outbox
          // failed. Neither telemetry store may discard a successful summary.
          if (active) await persistActiveTransferTelemetry(transferId);
        }
      }), controller.signal);
      initializeTelemetryDelivery();
    }

    checkSummaryDeadline();
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
    return { summary, timing };
  } catch (error) {
    let failure = error;
    try { checkSummaryDeadline(); } catch (deadlineError) { failure = deadlineError; }
    const fallback = controller.signal.aborted ? "summary_timeout" : responseReceived ? "summary_invalid_response" : "summary_transport_failed";
    globalThis.CapTransferDiagnostics?.update(diagnostics, { summary_ms: Math.round(nowMs() - summaryStartedAt),
      error_code: globalThis.CapTransferDiagnostics?.errorCode(failure, fallback),
      error_origin: responseReceived && diagnostics.summary_http_status >= 400 ? "summary_service" : "background" });
    failure.diagnostics = globalThis.CapTransferDiagnostics?.validate(diagnostics) || null;
    throw failure;
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener("abort", onCancel);
    stopServiceWorkerKeepAlive();
  }
}

async function waitForSummaryTelemetry(work, signal) {
  let timeout, onAbort;
  try {
    return await Promise.race([
      work.catch(() => null),
      new Promise(resolve => {
        onAbort = () => resolve(null);
        if (signal.aborted) return onAbort();
        signal.addEventListener("abort", onAbort, { once: true });
        timeout = setTimeout(onAbort, SUMMARY_TELEMETRY_WAIT_MS);
      })
    ]);
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", onAbort);
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

function checkTransferDeadline(deadlineAt) {
  if (deadlineAt && Date.now() >= deadlineAt) throw createTransferTimeoutError();
}

function createTransferTimeoutError() {
  const error = new Error("Transfer timed out. Please try again.");
  error.code = "transfer_timeout";
  return error;
}

async function transferToDestination(destinationId, text, preparedTabId = null, transferId = null,
  deferFinalActivation = false, deadlineAt = null, sourceTab = null) {
  const trace = createBackgroundTrace();
  trace.diagnostics = { version: 1 };
  try {
    const result = await transferToDestinationObserved(destinationId, text, preparedTabId, transferId,
      deferFinalActivation, deadlineAt, sourceTab, trace);
    globalThis.CapTransferDiagnostics?.update(trace.diagnostics, { delivery_ms: Math.round(nowMs() - trace.startedAt) });
    return { ...result, diagnostics: globalThis.CapTransferDiagnostics?.snapshot(trace.diagnostics) || null };
  } catch (error) {
    globalThis.CapTransferDiagnostics?.update(trace.diagnostics, { delivery_ms: Math.round(nowMs() - trace.startedAt) });
    if (!trace.diagnostics.error_code) globalThis.CapTransferDiagnostics?.failure(trace.diagnostics, error, "background", nowMs() - trace.startedAt);
    error.diagnostics = globalThis.CapTransferDiagnostics?.snapshot(trace.diagnostics) || null;
    throw error;
  }
}

async function transferToDestinationObserved(
  destinationId,
  text,
  preparedTabId = null,
  transferId = null,
  deferFinalActivation = false,
  deadlineAt = null,
  sourceTab = null,
  trace = createBackgroundTrace()
) {
  const operation = getTransferOperation(transferId, sourceTab, deadlineAt);
  if (!text?.trim()) {
    const error = new Error("Context summary text was not available.");
    error.code = "paste_failed";
    error.diagnosticCode = "paste_empty";
    throw error;
  }

  checkTransferDeadline(deadlineAt);
  await checkTransferSource(operation);
  trace.deadlineAt = deadlineAt;
  trace.operation = operation;
  const destination = DESTINATIONS[destinationId];
  if (!destination) {
    const error = new Error("Unknown AI destination.");
    error.code = "destination_open_failed";
    error.diagnosticCode = "destination_unsupported";
    throw error;
  }

  const trimmedText = text.trim();
  let pasteResult = null;
  let destinationTabId = null;
  let preparedAttempted = false;

  if (preparedTabId) operation?.tabIds.add(preparedTabId);
  if (preparedTabId && await isPreparedDestinationTabUsable(preparedTabId, destinationId, operation)) {
    await checkTransferSource(operation);
    checkTransferDeadline(deadlineAt);
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
        trace
      );
    } catch (error) {
      checkTransferOperation(operation);
      if (["user_cancelled", "paste_unconfirmed"].includes(error?.code)) throw error;
      pasteResult = { ok: false, error: error?.message || "Prepared destination paste failed.",
        code: error.code, diagnosticCode: error.diagnosticCode, diagnostics: error.diagnostics };
    }
  } else if (preparedTabId) {
    markBackgroundTrace(trace, "prepared tab rejected", {
      tabId: preparedTabId,
      destination: destinationId,
      reason: "missing_or_navigated"
    });
  }

  if (!pasteResult?.ok) {
    if (pasteResult?.code === "user_cancelled") throw createTransferCancelledError();
    await checkTransferSource(operation);
    checkTransferDeadline(deadlineAt);
    const recoveringPreparedTab = Boolean(preparedTabId);
    if (preparedAttempted) {
      const previous = globalThis.CapTransferDiagnostics?.validate(pasteResult?.diagnostics);
      if (previous) {
        // These observations belong to the first editor. A fresh destination's
        // missing fields mean unobserved, not a carry-over draft or editor state.
        for (const key of Object.keys(previous)) {
          if (key !== "version" && key !== "last_operation") delete trace.diagnostics[key];
        }
        trace.diagnostics.prepared_diagnostics = previous;
      }
      globalThis.CapTransferDiagnostics?.update(trace.diagnostics, { recovery_error_code: previous?.error_code || globalThis.CapTransferDiagnostics?.errorCode(pasteResult) });
      delete trace.diagnostics.error_code;
      delete trace.diagnostics.error_origin;
    }
    if (recoveringPreparedTab) markBackgroundTrace(trace, "fresh recovery");
    if (preparedAttempted) {
      console.debug(
        "[Context Generator Relay] Prepared destination paste failed; retrying in one fresh tab:",
        pasteResult?.error || "No paste response."
      );
    }
    const openLabel = recoveringPreparedTab ? "fresh fallback tab" : "tab";
    // Keep all creation inactive; the platform's explicit activation point
    // decides when to reveal it, including fresh recovery.
    const activateFreshTab = false;
    markBackgroundTrace(trace, `${openLabel} open start`, {
      destination: destinationId,
      active: activateFreshTab,
      previousError: preparedAttempted ? pasteResult?.error || "No paste response." : null
    });
    destinationTabId = await createDestinationTab(destination, {
      active: activateFreshTab,
      sourceTab,
      deadlineAt,
      operation
    });
    markBackgroundTrace(trace, `${openLabel} open done`, { tabId: destinationTabId });
    pasteResult = await pasteIntoDestinationWithActivation(
      destinationTabId,
      destinationId,
      destination,
      trimmedText,
      transferId,
      trace
    );
  }

  if (!pasteResult?.ok) {
    if (pasteResult?.code === "user_cancelled") throw createTransferCancelledError();
    const error = new Error(pasteResult?.error || `Could not paste into ${destination.name}.`);
    error.code = "paste_failed";
    error.diagnosticCode = pasteResult?.diagnostics?.error_code || "unknown_error";
    throw error;
  }

  await checkTransferSource(operation);
  if (!deferFinalActivation && !destination.focusBeforePaste) {
    markBackgroundTrace(trace, "final tab activate start", { tabId: destinationTabId });
    await activateDestinationTab(destinationTabId, deadlineAt, operation);
    markBackgroundTrace(trace, "final tab activate done", { tabId: destinationTabId });
  } else if (deferFinalActivation) {
    markBackgroundTrace(trace, "final tab activation deferred", { tabId: destinationTabId });
  } else {
    // Focused delivery already revealed this tab. A second activation both
    // wastes an API round-trip and yanks the user back if they switched away.
    markBackgroundTrace(trace, "destination already revealed", { tabId: destinationTabId });
  }
  checkTransferOperation(operation);
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

async function isPreparedDestinationTabUsable(tabId, destinationId, operation = null) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const currentOrPendingUrl = tab?.pendingUrl || tab?.url || "";
    return getPlatformFromUrl(currentOrPendingUrl) === destinationId &&
      DESTINATION_LANDING_PATHS[destinationId]?.includes(new URL(currentOrPendingUrl).pathname.replace(/\/+$/, "") || "/");
  } catch {
    // A closed transfer tab is cancellation, not a reason to recreate it.
    if (operation) {
      cancelTransferOperation(operation);
      checkTransferOperation(operation);
    }
    return false;
  }
}

async function pasteIntoDestinationWithActivation(
  tabId,
  destinationId,
  destination,
  text,
  transferId,
  trace
) {
  await checkTransferSource(trace?.operation);
  checkTransferDeadline(trace?.deadlineAt);
  // Focus is a paste prerequisite on these destinations, independent of whether
  // final activation is deferred. Callers sequence the source completion cue first.
  if (destination.focusBeforePaste) {
    markBackgroundTrace(trace, "tab activate before paste start", { tabId });
    await activateDestinationTab(tabId, trace?.deadlineAt, trace?.operation);
    markBackgroundTrace(trace, "tab activate before paste done", { tabId });
    if (destination.activationSettleMs) {
      markBackgroundTrace(trace, "tab activation settle start", { tabId, settleMs: destination.activationSettleMs });
      await delay(destination.activationSettleMs);
      markBackgroundTrace(trace, "tab activation settle done", { tabId });
    }
  }

  await checkTransferSource(trace?.operation);
  checkTransferDeadline(trace?.deadlineAt);
  markBackgroundTrace(trace, "paste message start", { tabId, destination: destinationId });
  const pasteResult = await pasteIntoDestinationTab(
    tabId,
    destinationId,
    destination,
    text,
    transferId,
    trace
  );
  const pasteDiagnostics = globalThis.CapTransferDiagnostics?.validate(pasteResult?.diagnostics);
  if (pasteDiagnostics) Object.assign(trace.diagnostics ||= { version: 1 }, pasteDiagnostics);
  globalThis.CapTransferDiagnostics?.update(trace?.diagnostics, { message_reply: pasteResult?.ok ? "ack_success" : "ack_failed" });
  markBackgroundTrace(trace, "paste message done", { tabId, responseTiming: pasteResult?.timing || null });
  return pasteResult;
}

async function prepareDestination(destinationId, deadlineAt = null, sourceTab = null, transferId = null) {
  const operation = getTransferOperation(transferId, sourceTab, deadlineAt);
  checkTransferDeadline(deadlineAt);
  await checkTransferSource(operation);
  const startedAt = nowMs();
  const destination = DESTINATIONS[destinationId];
  if (!destination) {
    throw new Error("Unknown AI destination.");
  }

  const destinationTabId = await createDestinationTab(destination, { active: false, sourceTab, deadlineAt, operation });
  const openMs = Math.round(nowMs() - startedAt);
  warmDestinationTab(destinationTabId, destination, operation);
  return {
    tabId: destinationTabId,
    timing: { openMs, tabId: destinationTabId }
  };
}

async function createDestinationTab(destination, options = {}) {
  try {
    await checkTransferSource(options.operation);
    let placement = {};
    if (Number.isInteger(options.sourceTab?.id)) {
      // The user can focus a different window while capture runs. Resolve the
      // source's current position rather than opening in Chrome's current window.
      const source = await chrome.tabs.get(options.sourceTab.id);
      placement = { windowId: source.windowId, index: source.index + 1, openerTabId: source.id };
    }
    checkTransferOperation(options.operation);
    checkTransferDeadline(options.deadlineAt);
    const destinationTab = await chrome.tabs.create({
      url: destination.url,
      active: options.active !== false,
      ...placement
    });
    options.operation?.tabIds.add(destinationTab.id);
    if (options.operation?.controller.signal.aborted) {
      // Creation was already submitted when the source closed. Remove only
      // this newly created tab; never erase an existing draft or pasted carry.
      await chrome.tabs.remove(destinationTab.id).catch(() => {});
      checkTransferOperation(options.operation);
    }
    return destinationTab.id;
  } catch (error) {
    error.code = error.code || "destination_open_failed";
    error.diagnosticCode ||= "destination_open_failed";
    throw error;
  }
}

async function activateDestinationTab(tabId, deadlineAt = null, operation = null) {
  await checkTransferSource(operation);
  checkTransferDeadline(deadlineAt);
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    await checkTransferSource(operation);
    checkTransferDeadline(deadlineAt);
    if (tab?.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    checkTransferOperation(operation);
  } catch (error) {
    checkTransferOperation(operation);
    if (["transfer_timeout", "user_cancelled"].includes(error?.code)) throw error;
    // Focus is required for several composers to restore their native drafts.
    // Never report a successful switch or paste into a hidden tab after failure.
    const activationError = new Error("Could not switch to the destination tab. Return to your original tab and try again.");
    activationError.code = "destination_open_failed";
    activationError.diagnosticCode = "destination_activation_failed";
    throw activationError;
  }
}

async function activateVerifiedDestinationTab(tabId, destinationId, deadlineAt = null, transferId = null, sourceTab = null) {
  const operation = getTransferOperation(transferId, sourceTab, deadlineAt);
  await checkTransferSource(operation);
  if (Number.isInteger(tabId)) operation?.tabIds.add(tabId);
  checkTransferDeadline(deadlineAt);
  if (!Number.isInteger(tabId) || !DESTINATIONS[destinationId]) {
    throw Object.assign(new Error("Destination tab was not available."), { diagnosticCode: "destination_tab_unavailable" });
  }
  if (!await isPreparedDestinationTabUsable(tabId, destinationId, operation)) {
    throw Object.assign(new Error("Destination tab changed before activation."), { diagnosticCode: "destination_not_new_chat" });
  }
  await activateDestinationTab(tabId, deadlineAt, operation);
}

async function pasteIntoDestinationTab(
  tabId,
  destinationId,
  destination,
  text,
  transferId = null,
  trace = null
) {
  try {
    return await sendMessageWhenReady(
      tabId,
      {
        type: "PASTE_CONTEXT",
        destination: destinationId,
        text,
        transferId,
        sourceTabId: trace?.operation?.sourceTabId ?? null,
        deadlineAt: trace?.deadlineAt
      },
      destination.messageTimeoutMs || DESTINATION_MESSAGE_TIMEOUT_MS,
      destination.name,
      trace
    );
  } catch (error) {
    error.code = error.code || "paste_failed";
    throw error;
  }
}

async function warmDestinationTab(tabId, destination, operation = null) {
  try {
    const startedAt = Date.now();
    const timeoutMs = destination.warmupTimeoutMs || DESTINATION_WARMUP_TIMEOUT_MS;
    let injected = false;
    while (Date.now() - startedAt <= timeoutMs) {
      await checkTransferSource(operation);
      if (await pingTab(tabId)) {
        return;
      }
      if (!injected) {
        checkTransferOperation(operation);
        injected = await ensureContentScript(tabId);
        checkTransferOperation(operation);
        if (injected && await pingTab(tabId)) return;
      }
      await delay(MESSAGE_RETRY_INTERVAL_MS);
    }
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

async function ensureContentScript(tabId, file = PLATFORM_CONTENT_SCRIPT) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: file === PLATFORM_CONTENT_SCRIPT ? ["transfer-diagnostics.js", file] : [file] });
    return true;
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes("Cannot access") && !message.includes("No tab with id")) {
      console.debug("[Context Generator Relay] Content script injection skipped:", message);
    }
    return false;
  }
}

async function ensureClaudeJsonHook(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["claude-fetch-main.js"] });
    return true;
  } catch { return false; }
}

async function ensureChatGptJsonHook(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["chatgpt-fetch-main.js"] });
    return true;
  } catch { return false; }
}

async function ensureNetworkJsonHook(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["network-json-data.js", "network-fetch-main.js"] });
    return true;
  } catch { return false; }
}

async function injectIntoOpenSupportedTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        .filter((tab) => tab.id && getPlatformFromUrl(tab.url))
        .map(async (tab) => {
          if (getPlatformFromUrl(tab.url) === "claude") {
            await ensureClaudeJsonHook(tab.id);
            await ensureContentScript(tab.id, "claude-json-capture.js");
          } else if (getPlatformFromUrl(tab.url) === "chatgpt") {
            await ensureChatGptJsonHook(tab.id);
            await ensureContentScript(tab.id, "chatgpt-json-capture.js");
          } else if (["gemini", "grok", "deepseek"].includes(getPlatformFromUrl(tab.url))) {
            await ensureNetworkJsonHook(tab.id);
            await ensureContentScript(tab.id, "network-json-capture.js");
          }
          return ensureContentScript(tab.id, PLATFORM_CONTENT_SCRIPT);
        })
    );
  } catch (error) {
    console.debug("[Context Generator Relay] Startup content script injection skipped:", error?.message || error);
  }
}

function sendMessage(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

async function sendMessageWhenReady(tabId, message, timeoutMs, name, trace = null) {
  const startedAt = Date.now();
  const deadline = Math.min(startedAt + timeoutMs, message.deadlineAt || Infinity);
  let lastError = null;
  let attempts = 0;
  let injected = false;

  // Both attempts use the same deadline and error policy; injection stays between them.
  async function tryMessage(label) {
    try {
      await checkTransferSource(trace?.operation);
      const response = await sendMessageBeforeDeadline(tabId, message, deadline, name, trace?.operation);
      checkTransferOperation(trace?.operation);
      if (message.type === "PASTE_CONTEXT" && typeof response?.ok !== "boolean") {
        globalThis.CapTransferDiagnostics?.update(trace?.diagnostics, { message_reply: response === undefined ? "missing" : "invalid" });
        throw Object.assign(createUnconfirmedPasteError(), { diagnosticCode: response === undefined ? "message_reply_missing" : "message_reply_invalid" });
      }
      if (response !== undefined) {
        const readyMs = Date.now() - startedAt;
        markBackgroundTrace(trace, label, { tabId, readyMs, attempts });
        return response;
      }
      lastError = new Error(`No response from ${name}.`);
    } catch (error) {
      lastError = error;
      checkTransferOperation(trace?.operation);
      checkTransferDeadline(message.deadlineAt);
      // Only a missing receiver proves the paste never started. A lost reply
      // or timeout may follow insertion, so neither re-send nor open a fresh tab.
      if (message.type === "PASTE_CONTEXT" &&
          !/Receiving end does not exist|Could not establish connection/.test(String(error?.message || ""))) {
        globalThis.CapTransferDiagnostics?.update(trace?.diagnostics, { message_attempts: attempts, message_ms: Date.now() - startedAt,
          message_reply: error.code === "message_timeout" ? "timeout" : trace?.diagnostics?.message_reply || "transport_failed" });
        throw Object.assign(createUnconfirmedPasteError(), { diagnosticCode: error.diagnosticCode || (error.code === "message_timeout" ? "message_timeout" : "message_transport_failed") });
      }
      if (!isRetryableMessageError(error)) {
        throw error;
      }
    }
    return undefined;
  }

  while (Date.now() <= deadline) {
    attempts += 1;
    globalThis.CapTransferDiagnostics?.update(trace?.diagnostics, { message_attempts: attempts, message_ms: Date.now() - startedAt, last_operation: "message_send" });
    let response = await tryMessage("tab ready/message response");
    if (response !== undefined) return response;

    if (Date.now() > deadline) break;
    // A successful injection need not be repeated every 120 ms while the page
    // hydrates. Native navigation installs the manifest script in its new document.
    if (!injected) {
      checkTransferOperation(trace?.operation);
      markBackgroundTrace(trace, "content script inject attempt", { tabId, attempts });
      injected = await ensureContentScript(tabId);
      globalThis.CapTransferDiagnostics?.update(trace?.diagnostics, { script_injected: injected });
      response = await tryMessage("tab ready/message response after inject");
      if (response !== undefined) return response;
    }

    await delay(MESSAGE_RETRY_INTERVAL_MS);
  }

  const detail = lastError?.message ? ` Last error: ${lastError.message}` : "";
  throw Object.assign(new Error(`Timed out connecting to ${name}.${detail}`), { diagnosticCode: "message_receiver_missing" });
}

async function sendMessageBeforeDeadline(tabId, message, deadline, name, operation = null) {
  checkTransferOperation(operation);
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw createMessageTimeoutError(name);

  let timeout = null;
  try {
    return await waitForTransferWork(Promise.race([
      sendMessage(tabId, message),
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(createMessageTimeoutError(name)), remainingMs);
      })
    ]), operation);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function createMessageTimeoutError(name) {
  const error = new Error(`Timed out connecting to ${name}.`);
  error.code = "message_timeout";
  return error;
}

function createUnconfirmedPasteError() {
  const error = new Error("The paste was not confirmed. Check the destination tab before copying your context.");
  error.code = "paste_unconfirmed";
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

function createBackgroundTrace() {
  return {
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
  const operations = { "prepared tab reused": "prepared_reused", "prepared tab rejected": "prepared_rejected",
    "fresh recovery": "fresh_recovery", "tab open start": "destination_open", "fresh fallback tab open start": "destination_open",
    "tab open done": "destination_open", "fresh fallback tab open done": "destination_open",
    "tab activate before paste start": "destination_activate", "tab activate before paste done": "destination_activate",
    "final tab activate start": "destination_activate", "final tab activate done": "destination_activate",
    "tab activation settle start": "destination_settle", "tab activation settle done": "destination_settle",
    "paste message start": "message_send", "paste message done": "paste_complete",
    "content script inject attempt": "script_inject", "tab ready/message response": "message_send", "tab ready/message response after inject": "message_send" };
  const operation = operations[label];
  if (!operation) return;
  trace.diagnostics ||= { version: 1 };
  globalThis.CapTransferDiagnostics?.update(trace.diagnostics, { last_operation: operation,
    ...(label === "prepared tab reused" ? { prepared_reused: true } : {}),
    ...(label === "prepared tab rejected" ? { prepared_rejected: true } : {}),
    ...(label === "fresh recovery" ? { fresh_recovery: true } : {}),
    ...(label === "content script inject attempt" ? { script_injections: (trace.diagnostics.script_injections || 0) + 1 } : {}),
    ...(label.includes("message response") ? { message_ms: detail?.readyMs, message_attempts: detail?.attempts } : {}),
    ...(label === "tab activation settle start" ? { activation_settle_ms: detail?.settleMs } : {}) });
  globalThis.CapTransferDiagnostics?.event(trace.diagnostics, operation, mark.totalMs, "delivery_events");
  if (label.endsWith("open start")) trace.diagnosticOpenAt = at;
  if (label.endsWith("open done")) globalThis.CapTransferDiagnostics?.update(trace.diagnostics, { destination_open_ms: Math.round(at - trace.diagnosticOpenAt) });
  if (label.endsWith("activate before paste start") || label === "final tab activate start") trace.diagnosticActivateAt = at;
  if (label.endsWith("activate before paste done") || label === "final tab activate done") globalThis.CapTransferDiagnostics?.update(trace.diagnostics, { activation_ms: Math.round(at - trace.diagnosticActivateAt) });
}

function getBackgroundFailureDiagnostics(error, operation) {
  return globalThis.CapTransferDiagnostics?.validate(error?.diagnostics) || {
    version: 1, error_code: globalThis.CapTransferDiagnostics?.errorCode(error) || "unknown_error",
    error_origin: "background", last_operation: operation
  };
}

function nowMs() {
  return globalThis.performance?.now?.() || Date.now();
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
