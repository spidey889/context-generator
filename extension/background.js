const SUMMARY_BACKEND_URL = "https://context-generator-five.vercel.app/api/summarize";
const SUMMARY_CLIENT_HEADER = "cap-context-extension/1";
const PLATFORM_CONTENT_SCRIPT = "platform-content.js";
const SOURCE_MESSAGE_TIMEOUT_MS = 12000;
const DESTINATION_MESSAGE_TIMEOUT_MS = 30000;
const MESSAGE_RETRY_INTERVAL_MS = 120;
const DESTINATION_WARMUP_TIMEOUT_MS = 9000;
const SUMMARY_BACKEND_TIMEOUT_MS = 320000;
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

chrome.runtime.onInstalled.addListener(initializeBackground);
chrome.runtime.onStartup.addListener(initializeBackground);

chrome.tabs.onRemoved?.addListener((tabId) => {
  return recordUserCancelledTransfersForTab(tabId).catch(() => {});
});

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
  if (previous.status !== "started") return previous;
  const stages = [...TELEMETRY_STAGES];
  return {
    ...next,
    lastStage: next.status === "succeeded" ? "completed"
      : stages.indexOf(previous.lastStage) > stages.indexOf(next.lastStage) ? previous.lastStage : next.lastStage,
    characterCount: next.characterCount ?? previous.characterCount
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
    ...(event.completedAt ? { completed_at: event.completedAt } : {}),
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
  await activeStorage.set({ [TELEMETRY_ACTIVE_STORAGE_KEY]: retained });
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

async function recordUserCancelledTransfersForTab(tabId) {
  await enqueueTelemetryWork(() => restoreActiveTransferTelemetry());
  const work = [];
  for (const [attemptId, sourceTabId] of activeTransferSourceTabs.entries()) {
    if (sourceTabId !== tabId) continue;
    const active = activeTransferTelemetry.get(attemptId);
    if (!active || active.status !== "started") continue;

    // Closing the source tab is the one unambiguous user-side cancellation
    // signal available after a transfer has started.
    work.push(recordTransferTelemetry({
      ...active,
      status: "failed",
      failureReason: "user_cancelled"
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
  if (JSON.stringify(entries) !== JSON.stringify(retained)) {
    await chrome.storage.local.set({ [TELEMETRY_OUTBOX_STORAGE_KEY]: retained });
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
  await chrome.storage.local.set({ [TELEMETRY_OUTBOX_STORAGE_KEY]: outbox });
  await readTelemetryOutbox();
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
    "character_count", "status", "last_stage", "failure_reason", "extension_version", "summary_proof", "completed_at", "summary_confirmed_at", "model"]);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some(key => !keys.has(key))) return null;
  if (!isUuid(payload.install_id) || typeof payload.extension_version !== "string"
    || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(payload.extension_version)) return null;
  const event = sanitizeTransferTelemetryEvent({
    attemptId: payload.attempt_id, attemptedAt: payload.attempted_at, sourcePlatform: payload.source_platform,
    destinationPlatform: payload.destination_platform, characterCount: payload.character_count,
    status: payload.status, lastStage: payload.last_stage, failureReason: payload.failure_reason, completedAt: payload.completed_at
  }, false);
  if (!event || (payload.completed_at !== undefined && (payload.status === "started" || !Number.isFinite(Date.parse(payload.completed_at))))) return null;
  const confirmation = sanitizeSummaryConfirmation(payload);
  if ((payload.summary_proof !== undefined || payload.summary_confirmed_at !== undefined || payload.model !== undefined) && !confirmation) return null;
  return {
    attempt_id: event.attemptId, install_id: payload.install_id, attempted_at: event.attemptedAt,
    source_platform: event.sourcePlatform, destination_platform: event.destinationPlatform,
    character_count: event.characterCount, status: event.status, last_stage: event.lastStage,
    failure_reason: event.failureReason, extension_version: payload.extension_version,
    ...(event.completedAt ? { completed_at: event.completedAt } : {}), ...(confirmation || {})
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
    summarizeWithBackend(message.conversation, message.transferId, message.deadlineAt)
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
      message.deferFinalActivation === true,
      message.deadlineAt
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
    activateVerifiedDestinationTab(message.tabId, message.destination, message.deadlineAt)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message, code: error.code || "destination_open_failed" }));
    return true;
  }

  if (message?.type === "PREPARE_DESTINATION") {
    prepareDestination(message.destination, message.deadlineAt)
      .then((result) => sendResponse({ ok: true, tabId: result.tabId, timing: result.timing }))
      .catch((error) => {
        console.error("[Context Generator Relay]", error);
        sendResponse({ ok: false, error: error.message, code: error.code || "destination_open_failed" });
      });

    return true;
  }

  if (message?.type === "CONTEXT_TRANSFER_ERROR") {
    console.error("[Context Generator Relay]", message.error);
    setBadge("ERR", "#b42318", 5000);
  }

  return false;
});

async function summarizeWithBackend(conversation, transferId = null, deadlineAt = null) {
  checkTransferDeadline(deadlineAt);
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

  const inFlightSummary = summaryInflight.get(conversationText);
  if (inFlightSummary) {
    return inFlightSummary.then((result) => {
      recordKnownTransferTelemetryStage(transferId, "summary_response_started");
      return result;
    });
  }

  const summaryPromise = fetchSummaryFromBackend(conversationText, transferId, deadlineAt)
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

async function fetchSummaryFromBackend(conversationText, transferId = null, deadlineAt = null) {
  checkTransferDeadline(deadlineAt);
  const summaryStartedAt = nowMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(SUMMARY_BACKEND_TIMEOUT_MS, deadlineAt ? deadlineAt - Date.now() : SUMMARY_BACKEND_TIMEOUT_MS));
  const stopServiceWorkerKeepAlive = startSummaryServiceWorkerKeepAlive();

  try {
    // Telemetry storage is optional: a failed read/write must not prevent the
    // summary request, which remains usable without an attribution context.
    const telemetry = await enqueueTelemetryWork(async () => {
      await restoreActiveTransferTelemetry();
      const active = activeTransferTelemetry.get(transferId);
      if (!active || active.status !== "started") return null;
      // Older workers persisted active events without a version. An existing
      // outbox envelope is the best available identity across an update.
      const queuedIdentity = (await readTelemetryOutbox()).find(entry => entry.payload.attempt_id === transferId)?.payload;
      active.extensionVersion = queuedIdentity?.extension_version || active.extensionVersion || chrome.runtime.getManifest?.().version || null;
      await persistActiveTransferTelemetry(transferId);
      return makeTelemetryPayload(active, await getOrCreateTelemetryInstallId());
    }).catch(() => null);
    // Optional storage can finish after the transfer deadline. Do not begin a
    // request for an already-expired attempt after that wait.
    checkTransferDeadline(deadlineAt);
    const fetchStartedAt = nowMs();
    const response = await fetch(SUMMARY_BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cap-Context-Client": SUMMARY_CLIENT_HEADER
      },
      body: JSON.stringify({ conversation: conversationText, ...(telemetry ? { telemetry } : {}) }),
      signal: controller.signal
    });
    recordKnownTransferTelemetryStage(transferId, "summary_response_started");
    const fetchMs = Math.round(nowMs() - fetchStartedAt);

    if (!response.ok) {
      throw await createSummaryBackendError(response);
    }

    const parseStartedAt = nowMs();
    const data = await response.json();
    const parseMs = Math.round(nowMs() - parseStartedAt);
    if (data?.ok === false || (data?.code && !data?.summary?.trim())) {
      throw createSummaryBackendPayloadError(data, data?.status || response.status);
    }
    if (!data.summary?.trim()) throw new Error("Backup summarizer returned no summary.");
    const confirmation = sanitizeSummaryConfirmation({
      summary_proof: data.summaryProofV3 || data.summaryProofV2 || data.summaryProof,
      ...(data.summaryProofV3 || data.summaryProofV2 ? { summary_confirmed_at: data.summaryConfirmedAt } : {}),
      ...(data.summaryProofV3 ? { model: data.summaryModel } : {})
    });
    if (telemetry && confirmation) {
      // A summary may finish after its source tab closes. Its receipt confirms
      // generation, never a paste; persist it before returning when storage works.
      await enqueueTelemetryWork(async () => {
        const active = activeTransferTelemetry.get(transferId);
        if (active) summaryProofs.set(transferId, confirmation);
        try {
          await appendTelemetryOutbox({ ...telemetry, last_stage: "summary_completed", ...confirmation });
        } finally {
          // Retain the receipt in session storage even if the local outbox
          // failed. Neither telemetry store may discard a successful summary.
          if (active) await persistActiveTransferTelemetry(transferId);
        }
      }).catch(() => {});
      initializeTelemetryDelivery();
    }

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
    checkTransferDeadline(deadlineAt);
    throw error;
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

function checkTransferDeadline(deadlineAt) {
  if (deadlineAt && Date.now() >= deadlineAt) {
    const error = new Error("Transfer timed out. Please try again.");
    error.code = "transfer_timeout";
    throw error;
  }
}

async function transferToDestination(
  destinationId,
  text,
  preparedTabId = null,
  transferId = null,
  deferFinalActivation = false,
  deadlineAt = null
) {
  if (!text?.trim()) {
    const error = new Error("Context summary text was not available.");
    error.code = "paste_failed";
    throw error;
  }

  checkTransferDeadline(deadlineAt);
  const trace = createBackgroundTrace();
  trace.deadlineAt = deadlineAt;
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
    checkTransferDeadline(deadlineAt);
    const recoveringPreparedTab = Boolean(preparedTabId);
    if (preparedAttempted) {
      console.debug(
        "[Context Generator Relay] Prepared destination paste failed; retrying in one fresh tab:",
        pasteResult?.error || "No paste response."
      );
    }
    const openLabel = recoveringPreparedTab ? "fresh fallback tab" : "tab";
    const activateFreshTab = deferFinalActivation
      ? false
      : (recoveringPreparedTab ? destination.focusBeforePaste === true : true);
    markBackgroundTrace(trace, `${openLabel} open start`, {
      destination: destinationId,
      active: activateFreshTab,
      previousError: preparedAttempted ? pasteResult?.error || "No paste response." : null
    });
    destinationTabId = await createDestinationTab(destination, {
      active: activateFreshTab
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
    const error = new Error(pasteResult?.error || `Could not paste into ${destination.name}.`);
    error.code = "paste_failed";
    throw error;
  }

  if (!deferFinalActivation) {
    markBackgroundTrace(trace, "final tab activate start", { tabId: destinationTabId });
    await activateDestinationTab(destinationTabId, deadlineAt);
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
  trace
) {
  checkTransferDeadline(trace?.deadlineAt);
  // Focus is a paste prerequisite on these destinations, independent of whether
  // final activation is deferred. Callers sequence the source completion cue first.
  if (destination.focusBeforePaste) {
    markBackgroundTrace(trace, "tab activate before paste start", { tabId });
    await activateDestinationTab(tabId, trace?.deadlineAt);
    markBackgroundTrace(trace, "tab activate before paste done", { tabId });
    if (destination.activationSettleMs) {
      markBackgroundTrace(trace, "tab activation settle start", { tabId, settleMs: destination.activationSettleMs });
      await delay(destination.activationSettleMs);
      markBackgroundTrace(trace, "tab activation settle done", { tabId });
    }
  }

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
  markBackgroundTrace(trace, "paste message done", { tabId, responseTiming: pasteResult?.timing || null });
  return pasteResult;
}

async function prepareDestination(destinationId, deadlineAt = null) {
  checkTransferDeadline(deadlineAt);
  const startedAt = nowMs();
  const destination = DESTINATIONS[destinationId];
  if (!destination) {
    throw new Error("Unknown AI destination.");
  }

  const destinationTabId = await createDestinationTab(destination, { active: false });
  const openMs = Math.round(nowMs() - startedAt);
  warmDestinationTab(destinationTabId, destination);
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

async function activateDestinationTab(tabId, deadlineAt = null) {
  checkTransferDeadline(deadlineAt);
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    checkTransferDeadline(deadlineAt);
    if (tab?.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (error) {
    if (error?.code === "transfer_timeout") throw error;
    console.debug("[Context Generator Relay] Destination activation skipped:", error?.message || error);
  }
}

async function activateVerifiedDestinationTab(tabId, destinationId, deadlineAt = null) {
  checkTransferDeadline(deadlineAt);
  if (!Number.isInteger(tabId) || !DESTINATIONS[destinationId]) {
    throw new Error("Destination tab was not available.");
  }
  if (!await isPreparedDestinationTabUsable(tabId, destinationId)) {
    throw new Error("Destination tab changed before activation.");
  }
  await activateDestinationTab(tabId, deadlineAt);
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

async function warmDestinationTab(tabId, destination) {
  try {
    const startedAt = Date.now();
    const timeoutMs = destination.warmupTimeoutMs || DESTINATION_WARMUP_TIMEOUT_MS;
    while (Date.now() - startedAt <= timeoutMs) {
      if (await pingTab(tabId)) {
        return;
      }
      if (await ensureContentScript(tabId) && await pingTab(tabId)) {
        return;
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

  // Both attempts use the same deadline and error policy; injection stays between them.
  async function tryMessage(label) {
    try {
      const response = await sendMessageBeforeDeadline(tabId, message, deadline, name);
      if (response !== undefined) {
        const readyMs = Date.now() - startedAt;
        markBackgroundTrace(trace, label, { tabId, readyMs, attempts });
        return response;
      }
      lastError = new Error(`No response from ${name}.`);
    } catch (error) {
      lastError = error;
      checkTransferDeadline(message.deadlineAt);
      if (!isRetryableMessageError(error)) {
        throw error;
      }
    }
    return undefined;
  }

  while (Date.now() <= deadline) {
    attempts += 1;
    let response = await tryMessage("tab ready/message response");
    if (response !== undefined) return response;

    if (Date.now() > deadline) break;
    markBackgroundTrace(trace, "content script inject attempt", { tabId, attempts });
    await ensureContentScript(tabId);

    response = await tryMessage("tab ready/message response after inject");
    if (response !== undefined) return response;

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
}

function nowMs() {
  return globalThis.performance?.now?.() || Date.now();
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
