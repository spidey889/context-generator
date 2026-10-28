if (!globalThis.CapTransferDiagnostics && typeof importScripts === "function") importScripts("transfer-diagnostics.js");
// MV3 must discover worker dependencies during startup, before an event tries
// to use them. Importing a new script lazily from a transfer event can fail.
if (!globalThis.CapLargeTransfer && typeof importScripts === "function") importScripts("large-transfer.js");
// This optional, ignored file exists only during an owner-run preview test.
if (typeof importScripts === "function") { try { importScripts("local-preview-auth.js"); } catch {} }
const SUMMARY_BACKEND_URL = "https://context-generator-five.vercel.app/api/summarize";
function localPreviewAuthHeaders(url) {
  const auth = globalThis.CapLocalPreviewAuth;
  try {
    if (auth && new URL(url).origin === auth.origin && auth.origin !== "https://context-generator-five.vercel.app" &&
        Number.isFinite(auth.expiresAt) && Date.now() < auth.expiresAt && typeof auth.token === "string" && auth.token)
      return { "x-vercel-trusted-oidc-idp-token": auth.token };
  } catch {}
  return {};
}
// Opening a page after removal needs no host access. Keep this URL fixed and
// anonymous; never add the form to manifest permissions or content-script matches.
const UNINSTALL_FEEDBACK_URL = "https://docs.google.com/forms/d/e/1FAIpQLSdrKf4ajWa1BVa8Hs3yna2_qafP_RJoOPPytdWQ3HYDXh3aGw/viewform";
const SUMMARY_CLIENT_HEADER = "cap-context-extension/1";
// Keep the serialized body below Vercel's 4.5 MB ceiling. Character count
// alone cannot bound JSON escaping; never submit a clipped conversation.
const SUMMARY_MAX_REQUEST_BYTES = 4400000;
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
  "inclusionai/ling-3.1-flash", "qwen/qwen3.8-27b:free", "dots-studio/dots-3-note-preview:free", "google/gemma-4-26b-a4b-it:free", "claude-haiku-5.5:free", "deepseek-v4.1-flash:free", "nvidia/nemotron-3.5-super-vl:free"]);
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
const preparedSummaryTelemetry = new Map();
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
    // Use Gemini's own New chat route, avoiding the root-to-app redirect.
    // Visibility lets the app finish mounting/restoring its native composer.
    url: "https://gemini.google.com/app",
    focusBeforePaste: true,
    activationSettleMs: 350
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
  // Only losing the source cancels. A closed destination uses fresh-tab recovery
  // once the carry is ready, without discarding capture or provider work.
  for (const operation of transferOperations.values()) {
    if (operation.sourceTabId === tabId) cancelTransferOperation(operation);
    else operation.tabIds.delete(tabId);
  }
  return recordUserCancelledTransfersForTab(tabId).catch(() => {});
});

chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "loading") return;
  // A new document destroys the source's pending reply/final-report code even
  // though its tab ID survives. Record the observed interruption in the worker.
  const interruptedAt = Date.now();
  for (const operation of transferOperations.values()) {
    if (operation.sourceTabId === tabId) cancelTransferOperation(operation);
  }
  return recordInterruptedTransfersForTab(tabId, "client_interrupted", "conversation_changed", interruptedAt).catch(() => {});
});

function createTransferCancelledError() {
  const error = new Error("Transfer cancelled.");
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
    operation = { transferId, sourceTabId: sourceTab.id, tabIds: new Set([sourceTab.id]), createdTabIds: new Set(),
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

function cancelTransferOperation(operation, { closeDestinations = false, waitForDestinations = false } = {}) {
  const newlyCancelled = !operation.controller.signal.aborted;
  if (newlyCancelled) operation.controller.abort(createTransferCancelledError());
  // Revoke ownership before touching browser tabs, then submit closure before
  // notifications/receipts. A removed destination must never start recovery.
  // Association alone never grants permission to close a pre-existing tab.
  const closing = closeDestinations
    ? Promise.all([...operation.createdTabIds].map(tabId => chrome.tabs.remove(tabId).catch(() => {}))) : undefined;
  if (waitForDestinations) {
    // Manual takeover keeps tabs open. Acknowledge only after their guards are
    // revoked; aborting the worker alone cannot stop a paste already dispatched.
    return Promise.all([...operation.tabIds].filter(tabId => tabId !== operation.sourceTabId).map(async tabId => {
      try {
        const reply = await sendMessageBeforeDeadline(tabId, { type: "CANCEL_TRANSFER", transferId: operation.transferId }, Date.now() + 3000, "destination cancellation");
        return reply?.ok === true;
      } catch (error) {
        if (/Receiving end does not exist|Could not establish connection/.test(String(error?.message || ""))) return true;
        try { await chrome.tabs.get(tabId); }
        catch (tabError) { return /No tab with id/i.test(String(tabError?.message || "")); }
        return false;
      }
    })).then(results => results.every(Boolean));
  }
  if (newlyCancelled) {
    for (const tabId of operation.tabIds) {
      chrome.tabs.sendMessage(tabId, { type: "CANCEL_TRANSFER", transferId: operation.transferId }).catch(() => {});
    }
  }
  return closing;
}

async function checkTransferSource(operation) {
  checkTransferOperation(operation);
  if (!operation) return;
  let source;
  try { source = await chrome.tabs.get(operation.sourceTabId); }
  catch { cancelTransferOperation(operation); }
  checkTransferOperation(operation);
  return source;
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
  scheduleRawTranscriptExpiry(changes[LAST_TRANSFER_STATS_STORAGE_KEY].newValue || null).catch(() => {
    console.debug("[Context Generator] Raw transcript expiry alarm unavailable; retrying on startup.");
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm?.name === RAW_TRANSCRIPT_EXPIRY_ALARM) expireStoredRawTranscript();
  if (alarm?.name === TELEMETRY_RETRY_ALARM) initializeTelemetryDelivery();
});

initializeBackground();

function initializeBackground() {
  registerUninstallFeedback();
  injectIntoOpenSupportedTabs();
  scheduleStoredRawTranscriptExpiry();
  initializeTelemetryDelivery();
}

async function registerUninstallFeedback() {
  try {
    // Initialization also runs on updates so existing installations get the form.
    await chrome.runtime.setUninstallURL(UNINSTALL_FEEDBACK_URL);
  } catch {
    // Optional feedback must never prevent normal extension startup.
    console.debug("[Context Generator] Could not register uninstall feedback.");
  }
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

  await chrome.alarms.create(RAW_TRANSCRIPT_EXPIRY_ALARM, { when: expiresAt });
}

async function expireStoredRawTranscript() {
  try {
    const result = await chrome.storage.local.get(LAST_TRANSFER_STATS_STORAGE_KEY);
    const stats = result?.[LAST_TRANSFER_STATS_STORAGE_KEY];
    const expiresAt = getRawTranscriptExpiryEpoch(stats);
    if (!expiresAt) return;

    if (expiresAt > Date.now()) {
      await chrome.alarms.create(RAW_TRANSCRIPT_EXPIRY_ALARM, { when: expiresAt });
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
      let recoveryUnavailable = false;
      await enqueueTelemetryWork(async () => {
        await getOrCreateTelemetryInstallId();
        try {
          const restored = await restoreActiveTransferTelemetry();
          await recoverPendingTransferTelemetry(restored);
        } catch {
          // Active snapshots are recovery aids. Their failure must not stop a
          // healthy local outbox from reaching the database.
          console.warn("cap_context_telemetry", { reason: "active_storage_unavailable" });
          recoveryUnavailable = true;
        }
      });
      await flushTelemetryOutbox();
      if (recoveryUnavailable) await enqueueTelemetryWork(async () => {
        // An empty local queue does not prove that the unreadable fallback is
        // empty. Keep a wakeup even if flushing just cleared the ordinary alarm.
        const diagnostics = await readTelemetryDiagnostics();
        await chrome.alarms.create(TELEMETRY_RETRY_ALARM, {
          when: Math.min(Date.now() + TELEMETRY_CONFIG_RETRY_BASE_MS, diagnostics.retry?.nextAttemptAt || Infinity)
        });
      });
    } while (telemetryDeliveryRequested);
  })().catch(async () => {
    try {
      await chrome.alarms.create(TELEMETRY_RETRY_ALARM, { delayInMinutes: 5 });
    } catch {
      // Reload/shutdown can reject even this fallback with "No SW". The durable
      // outbox and retry timestamp remain available to the next worker startup.
      console.debug("[Context Generator] Telemetry retry alarm unavailable; saved reports retry on startup.");
    }
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
  if (!sanitizedEvent) return false;
  // Once capture has resolved the durable identity, later progress can update
  // its memory snapshot without waiting behind unrelated storage writes.
  updatePreparedSummaryTelemetry(sanitizedEvent);
  return enqueueTelemetryWork(async () => {
    try { await restoreActiveTransferTelemetry(); }
    catch { console.warn("cap_context_telemetry", { reason: "active_storage_unavailable" }); }
    const known = activeTransferTelemetry.get(sanitizedEvent.attemptId);
    if (known && !sameTransferIdentity(known, sanitizedEvent)) {
      await recordTelemetryDiagnostic("identity_conflict", makeTelemetryPayload(sanitizedEvent, null));
      return false;
    }
    let queuedIdentity;
    try { queuedIdentity = (await readTelemetryOutbox()).find(entry => entry.payload.attempt_id === sanitizedEvent.attemptId)?.payload; }
    catch { console.warn("cap_context_telemetry", { reason: "outbox_storage_unavailable" }); }
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
    updatePreparedSummaryTelemetry(mergedEvent, installId);
    return queueActiveTransferTelemetry(payload, mergedEvent.attemptId);
  });
}

async function queueActiveTransferTelemetry(payload, attemptId) {
  let queued = false;
  try {
    queued = await appendTelemetryOutbox(payload);
    if (!queued) return false; // A diagnosed identity conflict is not recoverable.
  } catch {
    console.warn("cap_context_telemetry", { reason: "outbox_storage_unavailable" });
  }
  try {
    // Preserve a failed queue append in the existing active store. The pending
    // bit survives worker restart and is cleared only after an outbox commit.
    await persistActiveTransferTelemetry(attemptId, !queued);
  } catch (error) {
    console.warn("cap_context_telemetry", { reason: "active_storage_unavailable" });
    if (!queued) throw error;
  } finally { initializeTelemetryDelivery(); }
  return true;
}

async function recoverPendingTransferTelemetry(entries) {
  const installId = await getOrCreateTelemetryInstallId();
  for (const [attemptId, entry] of Object.entries(entries)) {
    const event = activeTransferTelemetry.get(attemptId);
    if (entry?.outboxPending !== true || !event || entry.expiresAt <= Date.now()) continue;
    await appendTelemetryOutbox(makeTelemetryPayload(event, installId));
    // Replaying a committed revision after a crash is safe: server writes are
    // idempotent. Keeping this marker after ordinary delivery would loop forever.
    await persistActiveTransferTelemetry(attemptId, false);
  }
}

function updatePreparedSummaryTelemetry(event, installId = null) {
  const previous = preparedSummaryTelemetry.get(event.attemptId);
  if (!installId && (!previous || previous.expiresAt <= Date.now())) return;
  if (previous && !sameTransferIdentity(previous.event, event)) return;
  preparedSummaryTelemetry.set(event.attemptId, {
    event: previous ? { ...mergeTransferTelemetryEvents(previous.event, event), extensionVersion: event.extensionVersion || previous.event.extensionVersion } : event,
    installId: installId || previous.installId,
    expiresAt: installId ? Math.max(Date.now() + TELEMETRY_ACTIVE_MAX_AGE_MS,
      transferOperations.get(event.attemptId)?.expiresAt || 0) : previous.expiresAt
  });
  while (preparedSummaryTelemetry.size > TELEMETRY_OUTBOX_MAX_ENTRIES) {
    preparedSummaryTelemetry.delete(preparedSummaryTelemetry.keys().next().value);
  }
}

function getPreparedSummaryTelemetry(transferId) {
  const prepared = preparedSummaryTelemetry.get(transferId);
  if (!prepared) return null;
  if (prepared.expiresAt <= Date.now()) {
    preparedSummaryTelemetry.delete(transferId);
    return null;
  }
  return prepared.event.status === "started" ? makeTelemetryPayload(prepared.event, prepared.installId) : null;
}

function sameTransferIdentity(first, second) {
  return first.attemptId === second.attemptId && first.attemptedAt === second.attemptedAt
    && first.sourcePlatform === second.sourcePlatform && first.destinationPlatform === second.destinationPlatform;
}

function mergePasteCheckpointEvents(first = [], second = [], key = "paste_events") {
  if (!first.length && !second.length) return {};
  const records = new Map();
  for (const entry of [...first, ...second]) records.set(`${entry.event}:${entry.at_ms}:${entry.code || ""}`, entry);
  const ordered = [...records.values()].sort((a, b) => a.at_ms - b.at_ms);
  return { [key]: ordered.length > 32 ? [...ordered.slice(0, 16), ...ordered.slice(-16)] : ordered,
    ...(ordered.length > 32 ? { events_truncated: true } : {}) };
}

function mergeRecoveryDiagnostics(first, second) {
  if (!first?.recovery_events && !second?.recovery_events) return {};
  return { version: 1, recovery_events: globalThis.CapTransferDiagnostics.mergeRecoveryEvents(first?.recovery_events, second?.recovery_events) };
}

function mergeTransferTelemetryEvents(previous, next) {
  if (!previous) return next;
  // First terminal outcome wins as a unit: never produce failed + completed.
  if (previous.status !== "started") return {
    ...previous,
    ...(!previous.diagnostics && next.status === previous.status && next.lastStage === previous.lastStage
      && next.failureReason === previous.failureReason && next.diagnostics ? { diagnostics: next.diagnostics } : {}),
    ...((previous.diagnostics?.recovery_events || next.diagnostics?.recovery_events) ? { diagnostics: {
      ...(previous.diagnostics || {}), ...mergeRecoveryDiagnostics(previous.diagnostics, next.diagnostics) } } : {}),
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
        ? next.diagnostics || {} : {}),
      ...mergePasteCheckpointEvents(previous.diagnostics?.paste_events, next.diagnostics?.paste_events),
      ...mergePasteCheckpointEvents(previous.diagnostics?.delivery_events, next.diagnostics?.delivery_events, "delivery_events"),
      ...mergeRecoveryDiagnostics(previous.diagnostics, next.diagnostics),
      ...((previous.diagnostics?.json_attempts || next.diagnostics?.json_attempts) ? { version: 1,
        json_attempts: globalThis.CapTransferDiagnostics.mergeJsonAttempts(previous.diagnostics?.json_attempts, next.diagnostics?.json_attempts) } : {}),
      ...((previous.diagnostics?.summary_response_failures || next.diagnostics?.summary_response_failures) ? {
        version: 1,
        summary_response_failures: globalThis.CapTransferDiagnostics.mergeSummaryResponseFailures(
          previous.diagnostics?.summary_response_failures, next.diagnostics?.summary_response_failures) } : {}) } } : {}),
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
      await recordActiveTelemetryDrop(event, entry, true);
      continue;
    }
    retained[attemptId] = { event, tabId: Number.isInteger(entry.tabId) ? entry.tabId : null, expiresAt: entry.expiresAt,
      ...(entry.outboxPending === true ? { outboxPending: true } : {}) };
    activeTransferTelemetry.set(attemptId, event);
    if (Number.isInteger(entry.tabId)) activeTransferSourceTabs.set(attemptId, entry.tabId);
    const confirmation = sanitizeSummaryConfirmation(entry);
    if (confirmation) {
      summaryProofs.set(attemptId, confirmation);
      Object.assign(retained[attemptId], confirmation);
    }
  }
  for (const [attemptId, prepared] of preparedSummaryTelemetry) {
    const restored = activeTransferTelemetry.get(attemptId);
    if (!restored || !sameTransferIdentity(prepared.event, restored)) preparedSummaryTelemetry.delete(attemptId);
    else {
      updatePreparedSummaryTelemetry(restored);
      preparedSummaryTelemetry.get(attemptId).expiresAt = retained[attemptId].expiresAt;
    }
  }
  // Normal progress rereads clean records; only expiry/schema cleanup needs a
  // write. Avoid putting unchanged snapshots back on the summary's I/O path.
  if (JSON.stringify(entries) !== JSON.stringify(retained)) {
    await activeStorage.set({ [TELEMETRY_ACTIVE_STORAGE_KEY]: retained });
  }
  return retained;
}

async function recordActiveTelemetryDrop(event, entry, expired = false) {
  if (entry.outboxPending === true) {
    const payload = { ...makeTelemetryPayload(event, null), ...(sanitizeSummaryConfirmation(entry) || {}) };
    const priority = telemetryDeliveryPriority(payload);
    await recordTelemetryDiagnostic(`${expired ? "expired" : "overflow"}_${priority === 2 ? "terminal" : priority === 1 ? "confirmation" : "progress"}`,
      payload);
  } else if (event.status === "started") {
    await recordTelemetryDiagnostic("outcome_unknown", makeTelemetryPayload(event, null));
  }
}

async function persistActiveTransferTelemetry(attemptId, outboxPending = null) {
  const activeStorage = chrome.storage.session || chrome.storage.local;
  const stored = await activeStorage.get(TELEMETRY_ACTIVE_STORAGE_KEY);
  const entries = stored?.[TELEMETRY_ACTIVE_STORAGE_KEY] || {};
  const currentEvent = activeTransferTelemetry.get(attemptId);
  const currentSourceTabId = activeTransferSourceTabs.get(attemptId);
  const currentConfirmation = summaryProofs.get(attemptId);
  for (const [id, entry] of Object.entries(entries)) {
    if (entry?.expiresAt > Date.now()) continue;
    const event = sanitizeTransferTelemetryEvent(entry?.event, false);
    if (event) await recordActiveTelemetryDrop(event, entry, true);
    delete entries[id];
    activeTransferTelemetry.delete(id);
    preparedSummaryTelemetry.delete(id);
    activeTransferSourceTabs.delete(id);
    summaryProofs.delete(id);
  }
  if (currentEvent) entries[attemptId] = {
    event: currentEvent,
    tabId: currentSourceTabId ?? null,
    expiresAt: Math.max(Date.now() + TELEMETRY_ACTIVE_MAX_AGE_MS, transferOperations.get(attemptId)?.expiresAt || 0),
    ...((outboxPending ?? entries[attemptId]?.outboxPending) === true ? { outboxPending: true } : {}),
    ...(currentConfirmation || {})
  };
  if (currentEvent) activeTransferTelemetry.set(attemptId, currentEvent);
  if (Number.isInteger(currentSourceTabId)) activeTransferSourceTabs.set(attemptId, currentSourceTabId);
  if (currentConfirmation) summaryProofs.set(attemptId, currentConfirmation);
  while (Object.keys(entries).length > TELEMETRY_OUTBOX_MAX_ENTRIES) {
    // Already queued snapshots can be discarded before this store's only copy
    // of an unsent report. Among pending copies, retain outcomes and proofs first.
    const priority = entry => entry.outboxPending === true
      ? 2 + telemetryDeliveryPriority({ status: entry.event?.status, summary_proof: entry.summary_proof })
      : entry.event?.status === "started" ? 1 : 0;
    const oldestId = Object.keys(entries).reduce((selected, id) =>
      selected === null || priority(entries[id]) < priority(entries[selected]) ? id : selected, null);
    const removed = entries[oldestId];
    const removedEvent = sanitizeTransferTelemetryEvent(removed.event, false);
    if (removedEvent) await recordActiveTelemetryDrop(removedEvent, removed);
    delete entries[oldestId];
    activeTransferTelemetry.delete(oldestId);
    preparedSummaryTelemetry.delete(oldestId);
    activeTransferSourceTabs.delete(oldestId);
    summaryProofs.delete(oldestId);
  }
  await activeStorage.set({ [TELEMETRY_ACTIVE_STORAGE_KEY]: entries });
}

async function recordUserCancelledTransfersForTab(tabId) {
  return recordInterruptedTransfersForTab(tabId, "user_cancelled", "source_tab_closed");
}

async function recordInterruptedTransfersForTab(tabId, failureReason, errorCode, interruptedAt = Infinity) {
  const restored = await enqueueTelemetryWork(async () => {
    try { await restoreActiveTransferTelemetry(); return true; }
    catch {
      console.warn("cap_context_telemetry", { reason: "active_storage_unavailable" });
      return false;
    }
  });
  const work = [];
  for (const [attemptId, sourceTabId] of activeTransferSourceTabs.entries()) {
    if (sourceTabId !== tabId) continue;
    const active = activeTransferTelemetry.get(attemptId);
    if (!active || active.status !== "started") continue;
    if (!restored) {
      // A session read failure must not hide a real tab interruption when this
      // worker still has a live, identity-matched snapshot. Never revive expiry.
      const prepared = preparedSummaryTelemetry.get(attemptId);
      if (!prepared || prepared.expiresAt <= Date.now() || !sameTransferIdentity(prepared.event, active)) continue;
    }
    // Storage work can finish after the new document starts its next transfer.
    // A delayed interruption must never finalize that newer attempt.
    if (Date.parse(active.attemptedAt) > interruptedAt) continue;

    // Tab closure is a user cancellation; document replacement is an observed
    // interruption. Neither tells us whether an unacknowledged paste happened.
    const diagnostics = { ...(active.diagnostics || { version: 1 }), error_code: errorCode,
      error_origin: "background", cancelled: true };
    if (errorCode === "conversation_changed") diagnostics.source_changed = true;
    globalThis.CapTransferDiagnostics?.event(diagnostics, "cancelled", Date.now() - Date.parse(active.attemptedAt), "events", errorCode);
    work.push(recordTransferTelemetry({
      ...active,
      status: "failed",
      failureReason,
      diagnostics
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

function recordDeliveryDiagnostics(attemptId, destinationId, sourceTab, diagnostics) {
  const snapshot = globalThis.CapTransferDiagnostics?.snapshot(diagnostics);
  if (!attemptId || !snapshot || !Number.isInteger(sourceTab?.id)) return;
  // Independent of the reply channel: a source reload must not erase what the
  // worker observed. Optional logging never waits on storage before delivery.
  enqueueTelemetryWork(async () => {
    await restoreActiveTransferTelemetry();
    const active = activeTransferTelemetry.get(attemptId);
    if (active?.status !== "started" || active.destinationPlatform !== destinationId
      || activeTransferSourceTabs.get(attemptId) !== sourceTab.id) return null;
    return { ...active, lastStage: "paste_started", diagnostics: { ...(active.diagnostics || {}), ...snapshot } };
  }).then(event => event && recordTransferTelemetry(event, sourceTab.id)).catch(() => {});
}

function recordPasteCheckpoint(message, sender) {
  const steps = ["received", "editor_found", "inserted", "verified"];
  const index = steps.indexOf(message.checkpoint);
  const operation = transferOperations.get(message.transferId);
  const target = operation?.pasteCheckpoint;
  const active = activeTransferTelemetry.get(message.transferId);
  if (sender?.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)
      || index < 0 || !target || target.tabId !== sender.tab.id || sender.tab.id === operation.sourceTabId
      || target.destinationId !== message.destination || getPlatformFromUrl(sender.url || sender.tab.url) !== message.destination
      || operation.controller.signal.aborted || operation.expiresAt <= Date.now()
      || active?.status !== "started" || active.destinationPlatform !== message.destination
      || activeTransferSourceTabs.get(message.transferId) !== operation.sourceTabId
      || Object.keys(message).some(key => !["type", "transferId", "destination", "checkpoint", "diagnostics"].includes(key))) return false;
  const safe = globalThis.CapTransferDiagnostics?.validate(message.diagnostics);
  if (!safe || (index === 1 || index === 2) && safe.editor_seen !== true || index === 3 && safe.paste_populated !== true) return false;
  // Each dispatched paste has four fixed observations. Duplicates and delayed
  // earlier milestones cannot overwrite newer progress or flood the outbox.
  if (target.seen.has(index) || index < target.lastIndex) return false;
  target.seen.add(index);
  target.lastIndex = index;
  const snapshot = { version: 1, diagnostics_revision: 3, summary_chars: target.textChars };
  const keys = ["document_ready_state", "visibility", "editor_seen", "editor_connected", "editor_kind", "editor_text_chars",
    "composer_wait_ms", "paste_retry_limit_ms", "paste_verify_limit_ms", "paste_stability_ms", "paste_attempts", "editor_remounts",
    "insertion_method", "paste_populated", "paste_stable", "draft_present", "user_handled", "page_load_ms", "destination_message_count",
    "destination_auth_prompt", "paste_ms"];
  for (const key of keys) if (safe[key] !== undefined) snapshot[key] = safe[key];
  snapshot.last_operation = ["paste_start", "editor_wait", "paste_verify", "paste_complete"][index];
  target.events.push({ event: snapshot.last_operation,
    at_ms: safe.paste_ms ?? Math.max(0, Date.now() - target.startedAt) });
  snapshot.paste_events = target.events.slice();
  // Keep these observations in the delivery trace before queuing storage, so a
  // lost final paste reply still carries them into the worker's failure report.
  Object.assign(target.trace.diagnostics, snapshot,
    mergePasteCheckpointEvents(target.trace.diagnostics?.paste_events, snapshot.paste_events));
  return recordTransferTelemetry({ ...active, lastStage: "paste_started", diagnostics: {
    ...(active.diagnostics || {}), ...snapshot,
    ...mergePasteCheckpointEvents(active.diagnostics?.paste_events, snapshot.paste_events)
  } }, operation.sourceTabId);
}

async function recordRecoveryCheckpoint(message, sender) {
  if (sender?.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)
      || !isUuid(message.transferId)
      || Object.keys(message).some(key => !["type", "transferId", "destination", "checkpoint", "surface", "method", "stopConfirmed"].includes(key))
      || message.stopConfirmed !== undefined && typeof message.stopConfirmed !== "boolean") return false;
  const event = await enqueueTelemetryWork(async () => {
    await restoreActiveTransferTelemetry();
    const active = activeTransferTelemetry.get(message.transferId);
    const sourceTabId = activeTransferSourceTabs.get(message.transferId);
    if (!active || active.destinationPlatform !== message.destination || !Number.isInteger(sourceTabId)) return null;
    const platform = getPlatformFromUrl(sender.url || sender.tab.url);
    const operation = transferOperations.get(message.transferId);
    const side = sender.tab.id === sourceTabId && platform === active.sourcePlatform ? "source"
      : operation?.sourceTabId === sourceTabId && operation.tabIds.has(sender.tab.id)
        && platform === active.destinationPlatform ? "destination" : null;
    if (!side) return null;
    const observation = globalThis.CapTransferDiagnostics.validateRecoveryEvent({ event: message.checkpoint, surface: message.surface, side,
      at_ms: Math.max(0, Math.min(2147483647, Date.now() - Date.parse(active.attemptedAt))),
      ...(message.method !== undefined ? { method: message.method } : {}),
      ...(message.stopConfirmed !== undefined ? { stop_confirmed: message.stopConfirmed } : {}) });
    if (!observation) return null;
    const previous = active.diagnostics?.recovery_events || [];
    const recovery_events = globalThis.CapTransferDiagnostics.mergeRecoveryEvents(previous, [observation]);
    if (JSON.stringify(previous) === JSON.stringify(recovery_events)) return null;
    // Only this bounded append-only trail may enrich a terminal client report.
    // Clipboard recovery never rewrites the original delivery or counting facts.
    return { ...active, diagnostics: { ...(active.diagnostics || { version: 1 }), recovery_events } };
  });
  return event ? recordTransferTelemetry(event, activeTransferSourceTabs.get(message.transferId)) : false;
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
    return false;
  }
  const previous = previousIndex === -1 ? null : outbox[previousIndex];
  const mergedPayload = previous ? mergeTelemetryPayloads(previous.payload, payload) : payload;
  if (previous && JSON.stringify(previous.payload) === JSON.stringify(mergedPayload)) return true;
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
  return true;
}

async function flushTelemetryOutbox() {
  while (true) {
    const next = await enqueueTelemetryWork(async () => {
      const outbox = await readTelemetryOutbox();
      const diagnostics = await readTelemetryDiagnostics();
      if (!outbox.length) return null;
      if (diagnostics.retry?.nextAttemptAt > Date.now()) {
        await chrome.alarms.create(TELEMETRY_RETRY_ALARM, { when: diagnostics.retry.nextAttemptAt });
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
      ? (previous.diagnostics?.recovery_events || next.diagnostics?.recovery_events
        ? { ...(previous.diagnostics || { version: 1 }), ...mergeRecoveryDiagnostics(previous.diagnostics, next.diagnostics) }
        : previous.diagnostics || (next.status === previous.status && next.last_stage === previous.last_stage && next.failure_reason === previous.failure_reason ? next.diagnostics : undefined))
      : { ...(previous.diagnostics || {}), ...(next.status !== "started" || stages.indexOf(next.last_stage) >= stages.indexOf(previous.last_stage) ? next.diagnostics || {} : {}),
        ...mergePasteCheckpointEvents(previous.diagnostics?.paste_events, next.diagnostics?.paste_events),
        ...mergePasteCheckpointEvents(previous.diagnostics?.delivery_events, next.diagnostics?.delivery_events, "delivery_events"),
        ...mergeRecoveryDiagnostics(previous.diagnostics, next.diagnostics),
        ...((previous.diagnostics?.json_attempts || next.diagnostics?.json_attempts) ? { version: 1,
          json_attempts: globalThis.CapTransferDiagnostics.mergeJsonAttempts(previous.diagnostics?.json_attempts, next.diagnostics?.json_attempts) } : {}),
        ...((previous.diagnostics?.summary_response_failures || next.diagnostics?.summary_response_failures) ? {
          version: 1,
          summary_response_failures: globalThis.CapTransferDiagnostics.mergeSummaryResponseFailures(
            previous.diagnostics?.summary_response_failures, next.diagnostics?.summary_response_failures) } : {}) } } : {}),
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
  await chrome.alarms.create(TELEMETRY_RETRY_ALARM, { when: nextAttemptAt });
}

async function deliverTelemetryPayload(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEMETRY_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(TELEMETRY_ENDPOINT_URL, {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      headers: {
        ...localPreviewAuthHeaders(TELEMETRY_ENDPOINT_URL),
        "Content-Type": "application/json",
        "X-Cap-Context-Client": SUMMARY_CLIENT_HEADER
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    // Only the recorder's explicit acknowledgement permits removing a report.
    // A redirected HTML page or an accidental 200/202 cannot confirm a commit.
    if (response.status === 204) return { kind: "delivered", status: response.status };
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

async function handleToolbarClick(tab) {
  try {
    clearBadge();
    setToolbarMessage(tab?.id);

    const platform = getPlatformFromUrl(tab.url);
    if (!tab.id || !platform) {
      throw new Error("Open a supported AI chat, then click the extension icon.");
    }

    const pickerResult = await sendMessageWhenReady(
      tab.id,
      { type: "OPEN_DESTINATION_PICKER" },
      SOURCE_MESSAGE_TIMEOUT_MS,
      "source AI tab"
    );

    if (!pickerResult?.ok) {
      throw new Error(pickerResult?.error || "Could not open the destination picker.");
    }
  } catch (error) {
    console.error("[Context Generator Relay]", error);
    setToolbarMessage(tab?.id, getPlatformFromUrl(tab?.url)
      ? "Cap Context couldn’t open here. Refresh this chat and try again."
      : "Open a Claude, ChatGPT, Gemini, Grok, or DeepSeek chat to use Cap Context.");
    await setBadge("ERR", "#b42318", 5000);
  }
}

async function setToolbarMessage(tabId, title = "Carry context to another AI") {
  if (!Number.isInteger(tabId)) return;
  try {
    // Per-tab tooltips can explain failure even where we cannot inject a notice.
    // The next click restores the ordinary title; decoration cannot block work.
    await chrome.action.setTitle?.({ tabId, title });
  } catch {
    console.debug("[Context Generator] Toolbar message unavailable.");
  }
}

chrome.action.onClicked.addListener(handleToolbarClick);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CANCEL_TRANSFER") {
    const tabId = sender?.tab?.id;
    let operation = transferOperations.get(message.transferId);
    if (!Number.isInteger(tabId) || sender.frameId !== 0 || sender.id !== chrome.runtime.id
        || typeof message.transferId !== "string" || !message.transferId || message.transferId.length > 128
        || (operation && !operation.tabIds.has(tabId))) {
      sendResponse({ ok: false }); return false;
    }
    // Retain a cancelled token even if Escape beats the first preparation
    // message. Late requests for this attempt must never start new work.
    const knownOperation = Boolean(operation);
    if (!operation) operation = getTransferOperation(message.transferId, sender.tab);
    if (message.preserveDestination === true) {
      if (operation.sourceTabId !== tabId) { sendResponse({ ok: false }); return false; }
      // A restarted worker may have lost the destination inventory. Latch the
      // cancellation, but keep recovery cautious rather than claiming revocation.
      cancelTransferOperation(operation, { waitForDestinations: true }).then(ok => sendResponse({ ok: ok && knownOperation }));
      return true;
    }
    cancelTransferOperation(operation, { closeDestinations: true }).then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === "PROTECT_HANDOFF_PALETTE") {
    // This private UI channel may style only the sending AI page's top document.
    // Document targeting prevents a delayed worker wakeup styling a new page.
    if (!sender?.tab?.id || !getPlatformFromUrl(sender.tab.url) || sender.frameId !== 0
        || sender.id !== chrome.runtime.id || !["apply", "remove"].includes(message.operation)
        || typeof message.css !== "string" || message.css.length > 65536
        || !message.css.startsWith("/* Cap Context handoff ") || !message.css.includes("#context-generator-overlay")) {
      sendResponse({ ok: false }); return false;
    }
    const target = sender.documentId
      ? { tabId: sender.tab.id, documentIds: [sender.documentId] }
      : { tabId: sender.tab.id, frameIds: [0] };
    const method = message.operation === "remove" ? "removeCSS" : "insertCSS";
    Promise.resolve().then(() => chrome.scripting[method]({ target, css: message.css, origin: "USER" }))
      .then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
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
      .then(accepted => sendResponse({ ok: accepted === true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "RECORD_PASTE_CHECKPOINT") {
    Promise.resolve(recordPasteCheckpoint(message, sender))
      .then(accepted => sendResponse({ ok: accepted === true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "RECORD_RECOVERY_CHECKPOINT") {
    recordRecoveryCheckpoint(message, sender)
      .then(accepted => sendResponse({ ok: accepted === true })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message?.type === "EXTEND_DOM_CAPTURE_DEADLINE") {
    const operation = transferOperations.get(message.transferId);
    const now = Date.now();
    if (sender?.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || !getPlatformFromUrl(sender.tab?.url)
        || typeof message.transferId !== "string" || !message.transferId || message.transferId.length > 128
        || !Number.isSafeInteger(message.deadlineAt) || message.deadlineAt <= now
        || message.deadlineAt > now + 126 * 60 * 1000
        || (operation && (operation.sourceTabId !== sender.tab.id || operation.controller.signal.aborted
          || operation.expiresAt <= now))) {
      sendResponse({ ok: false }); return false;
    }
    const owned = operation || getTransferOperation(message.transferId, sender.tab, message.deadlineAt);
    owned.deadlineAt = Math.max(owned.deadlineAt || 0, message.deadlineAt);
    owned.expiresAt = owned.deadlineAt;
    // Keep the accepted allowance durable even if scrolling sends no further
    // snapshot before browser sleep/restart. Reuse the storage queue without
    // manufacturing a new telemetry event or delaying capture acknowledgement.
    enqueueTelemetryWork(async () => {
      await restoreActiveTransferTelemetry();
      if (activeTransferSourceTabs.get(message.transferId) !== sender.tab.id
          || activeTransferTelemetry.get(message.transferId)?.status !== "started") return;
      await persistActiveTransferTelemetry(message.transferId);
      const prepared = preparedSummaryTelemetry.get(message.transferId);
      if (prepared) prepared.expiresAt = Math.max(prepared.expiresAt, owned.expiresAt);
    }).catch(() => {});
    sendResponse({ ok: true }); return false;
  }

  if (message?.type === "SUMMARIZE_WITH_BACKEND") {
    summarizeWithBackend(message.conversation, message.transferId, message.deadlineAt, sender?.tab, message.messages, message.platform)
      .then((result) => sendResponse({ ok: true, summary: result.summary, timing: result.timing,
        ...(result.diagnostics ? { diagnostics: result.diagnostics } : {}) }))
      .catch((error) => {
        // The source recovers summary-service failures with a verified local
        // carry. Only terminal errors should advertise a failed transfer here.
        const terminal = ["request_too_large", "transfer_timeout", "extension_reloaded"].includes(error.code);
        if (terminal) {
          console.error("[Context Generator Relay]", error);
          setBadge("ERR", "#b42318", 5000);
        } else if (error.code !== "user_cancelled") {
          console.info?.("[Cap Context] Summary unavailable; local carry recovery is available.", {
            code: error.diagnostics?.error_code || error.code || "summary_failed"
          });
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
      sender?.tab,
      message.localDirect === true
    )
      .then((result) => sendResponse({ ok: true, timing: result?.timing || null, marks: result?.marks || [], diagnostics: result?.diagnostics || null }))
      .catch((error) => {
        const draftPresent = [error?.code, error?.diagnosticCode, error?.diagnostics?.error_code].includes("editor_has_draft");
        if (error.code !== "user_cancelled" && !draftPresent) {
          console.error("[Context Generator Relay]", error);
          setBadge("ERR", "#b42318", 5000);
        }
        sendResponse({ ok: false, error: error.message, code: error.code || "paste_failed", diagnostics: error.diagnostics || null });
      });

    return true;
  }

  if (message?.type === "REVEAL_DESTINATION_PROGRESS") {
    revealDestinationProgress(message.tabId, message.destination, message.deadlineAt, message.transferId, sender?.tab)
      .then(revealed => sendResponse({ ok: true, revealed }))
      .catch(error => sendResponse({ ok: false, error: error.message, code: error.code || "destination_open_failed" }));
    return true;
  }
  if (message?.type === "END_DESTINATION_PROGRESS") {
    const operation = transferOperations.get(message.transferId);
    if (operation && operation.sourceTabId === sender?.tab?.id && operation.tabIds.has(message.tabId)
        && message.tabId !== operation.sourceTabId) {
      // Stop only presentation work. The real transfer may already have its
      // summary and must retain its normal cancellation/deadline token.
      operation.earlyRevealStopped = true;
      operation.earlyRevealController?.abort(Object.assign(new Error("Early reveal stopped."), { code: "early_reveal_stopped" }));
      chrome.tabs.sendMessage(message.tabId, { type: "FINISH_TRANSFER_PROGRESS", transferId: message.transferId,
        failed: message.failed === true })
        .catch(() => {});
    }
    sendResponse({ ok: true });
    return false;
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
        if (error.code !== "user_cancelled") console.error("[Context Generator Relay]", error);
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

async function readSummaryResponse(response, checkDeadline, onNearEnd = () => {}, debug = {}) {
  // Older deployments return ordinary JSON. The new stream still has exactly
  // one authoritative final result; previews never become pasted context.
  debug.phase = "response_body";
  debug.format = response.headers?.get("content-type")?.includes("application/x-ndjson") ? "ndjson" : "json";
  debug.final_result = false;
  if (debug.format === "json") return response.json().catch(markInterruptedSummaryResponse).then(data => {
    debug.eof = true;
    debug.final_result = Boolean(data && typeof data === "object");
    return data;
  });
  debug.bytes = 0; debug.chunks = 0; debug.events = 0;
  debug.eof = false;
  const responseStartedAt = Date.parse(debug.started_at);
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", result, eof = false;
  let tail = "", hasKeyContext = false, nearEnd = false;
  const consume = () => {
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      debug.phase = "stream_json_parse";
      const event = JSON.parse(line);
      debug.events++;
      debug.phase = "stream_event_validation";
      if (result || !["reset", "delta", "result"].includes(event.type)) throw new Error("Invalid summary stream");
      if (event.type === "reset") {
        tail = ""; hasKeyContext = false; nearEnd = false;
        onNearEnd(false);
      }
      if (event.type === "delta" && typeof event.text === "string") {
        // Keep only a bounded suffix for split headings. This is a presentation
        // hint, never summary acceptance, and retries discard the old attempt.
        const text = tail + event.text;
        hasKeyContext ||= /(?:^|\n)📦 KEY CONTEXT\s*(?:\n|$)/u.test(text);
        nearEnd ||= hasKeyContext && /(?:^|\n)🔁 NEXT STEP\s*(?:\n|$)/u.test(text);
        tail = text.slice(-256);
      }
      if (event.type === "result") {
        if (!event.data || typeof event.data !== "object") throw new Error("Invalid summary stream result");
        result = event.data;
        debug.final_result = true;
      }
    }
  };
  try {
    while (!eof) {
      checkDeadline();
      debug.phase = "stream_read";
      const chunk = await reader.read().catch(markInterruptedSummaryResponse);
      checkDeadline();
      eof = chunk.done;
      debug.eof = eof;
      if (!eof) {
        debug.bytes += chunk.value.byteLength;
        debug.chunks++;
        debug.last_chunk_at = new Date().toISOString();
        debug.last_chunk_ms = Date.now() - responseStartedAt;
      }
      debug.phase = "stream_utf8_decode";
      buffer += eof ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      consume();
      // A buffered final result needs immediate delivery, not another switch.
      if (!result && nearEnd) { debug.phase = "near_end_callback"; onNearEnd(true); }
    }
    debug.phase = "stream_completion_validation";
    if (buffer.trim() || !result) throw new Error("Summary stream ended before completion");
    return result;
  } finally {
    if (!eof) { try { reader.cancel().catch(() => {}); } catch {} }
    reader.releaseLock();
  }
}

function logSummaryResponseFailure(debug, error) {
  // Retain the existing local copy. Remote reports use a separate closed
  // schema below, never this debug object or its local-only Vercel request ID.
  const message = String(error?.message || "");
  const entry = { ...debug, failed_at: new Date().toISOString(),
    error_name: ["TypeError", "SyntaxError", "AbortError", "TimeoutError", "Error"].includes(error?.name) ? error.name : "Other",
    error_kind: /network|fetch|connection|terminated|aborted/i.test(message) ? "network_or_abort"
      : /utf|encoded|encoding/i.test(message) ? "encoding"
      : /json/i.test(message) ? "json"
      : /stream ended before completion/i.test(message) ? "stream_incomplete" : "other" };
  console.info?.("[Cap Context] Summary response failure (local diagnostic)", entry);
  // Keep only the latest failure; logging must never delay or replace fallback.
  try { Promise.resolve(chrome.storage.local.set({ "context-generator-summary-response-debug-v1": entry })).catch(() => {}); } catch {}
}

function makeSummaryResponseFailure(debug, error, attempt, requestSignal, requestDeadlineAt, deadlineAt) {
  const contract = globalThis.CapTransferDiagnostics;
  if (!contract) return null;
  const phase = contract.summaryResponseFailureSchema.phase.values.includes(debug.phase) ? debug.phase : "unknown";
  const reason = debug.aborted ? "aborted" : debug.http_status >= 400 ? "http_rejected"
    : phase === "request" ? "fetch_failed"
    : error?.summaryServiceFailure ? "service_rejected"
    : phase === "stream_utf8_decode" ? "utf8_decode_failed"
    : phase === "stream_json_parse" || (phase === "response_body" && error?.name === "SyntaxError") ? "json_parse_failed"
    : phase === "stream_event_validation" ? "stream_event_invalid"
    : phase === "stream_completion_validation" ? "stream_completion_invalid"
    : phase === "summary_validation" ? "summary_invalid"
    : phase === "near_end_callback" ? "callback_failed"
    : phase === "stream_read" || (phase === "response_body" && error?.summaryResponseInterrupted) ? "body_read_failed" : "unexpected_exception";
  const record = { attempt, phase, reason,
    error_type: contract.summaryResponseFailureSchema.error_type.values.includes(error?.name) ? error.name : "other",
    format: ["json", "ndjson"].includes(debug.format) ? debug.format : "unknown",
    aborted: debug.aborted === true, caller_aborted: requestSignal?.aborted === true,
    deadline_elapsed: Date.now() >= requestDeadlineAt,
    transfer_deadline_elapsed: Number.isFinite(deadlineAt) && Date.now() >= deadlineAt };
  for (const [key, value] of Object.entries({ http_status: debug.http_status, bytes_received: debug.bytes,
    chunks_received: debug.chunks, events_received: debug.events, elapsed_ms: debug.elapsed_ms,
    headers_ms: debug.headers_ms, last_chunk_ms: debug.last_chunk_ms, deadline_remaining_ms: debug.deadline_remaining_ms })) {
    if (Number.isFinite(value)) record[key] = Math.max(0, Math.min(2147483647, Math.round(value)));
  }
  for (const key of ["eof", "final_result"]) if (typeof debug[key] === "boolean") record[key] = debug[key];
  if (error?.summaryServiceFailure) {
    record.service_code = contract.summaryResponseFailureSchema.service_code.values.includes(error.code) ? error.code : "other";
    if (Number.isInteger(error.status) && error.status >= 100 && error.status <= 599) record.service_status = error.status;
  }
  if (typeof globalThis.navigator?.onLine === "boolean") record.online = globalThis.navigator.onLine;
  return contract.validateSummaryResponseFailure(record);
}

function recordKnownSummaryResponseFailures(transferId, failures) {
  const active = activeTransferTelemetry.get(transferId);
  if (!active || active.status !== "started") return;
  // Independent of the source reply: a reload or successful retry must not
  // erase an observed failure. Persist through the normal outbox, without
  // awaiting storage/network or changing the transfer's outcome/stage.
  recordTransferTelemetry({ ...active, diagnostics: { ...(active.diagnostics || {}),
    version: 1, summary_response_failures: failures.map(record => ({ ...record })) } }).catch(() => {});
}

function markInterruptedSummaryResponse(error) {
  // Tag only rejected body reads, not malformed JSON, UTF-8 or summary content.
  if (error?.name === "TypeError") error.summaryResponseInterrupted = true;
  throw error;
}

async function summarizeWithBackend(conversation, transferId = null, deadlineAt = null, sourceTab = null, messages = null, platform = null) {
  const operation = getTransferOperation(transferId, sourceTab, deadlineAt);
  checkTransferDeadline(deadlineAt);
  await checkTransferSource(operation);
  // Keep the established <=1M transport/cache/retry path intact. Larger chats
  // have their own bounded part protocol and never share partial cache entries.
  if (typeof conversation === "string" && conversation.length > 1000000)
    return summarizeLargeWithBackend(conversation, transferId, deadlineAt, operation);
  const conversationText = conversation?.trim();
  if (!conversationText) {
    throw Object.assign(new Error("AI conversation text could not be captured."), { diagnosticCode: "capture_dom_failed" });
  }

  const payload = messages ? { platform, messages } : { conversation: conversationText };
  // Identical flattened text can represent different native message boundaries.
  // Cache and share only requests with the same complete model input.
  const cacheKey = JSON.stringify(payload);
  const cachedEntry = getCachedSummaryEntry(cacheKey);
  if (cachedEntry) {
    const cachedResult = createCacheHitSummaryResult(cachedEntry);
    if (cachedResult) {
      recordKnownTransferTelemetryStage(transferId, "summary_response_started");
      return cachedResult;
    }
    summaryCache.delete(cacheKey);
  }

  let entry = summaryInflight.get(cacheKey);
  if (!entry) {
    entry = { controller: new AbortController(), waiters: 0, settled: false, nearEnd: false, progressListeners: new Set() };
    const ownedEntry = entry;
    entry.promise = fetchSummaryFromBackend(conversationText, transferId, deadlineAt, entry.controller.signal, nearEnd => {
      if (ownedEntry.nearEnd === nearEnd) return;
      ownedEntry.nearEnd = nearEnd;
      if (nearEnd) for (const listener of ownedEntry.progressListeners) listener();
    }, payload)
      .then(result => {
        ownedEntry.controller.signal.throwIfAborted();
        cacheSummaryResult(cacheKey, result);
        return result;
      }).finally(() => {
        ownedEntry.settled = true;
        if (summaryInflight.get(cacheKey) === ownedEntry) summaryInflight.delete(cacheKey);
      });
    summaryInflight.set(cacheKey, entry);
  }
  entry.waiters += 1;
  const reportNearEnd = () => {
    if (!transferId || !Number.isInteger(operation?.sourceTabId) || operation.controller.signal.aborted || entry.settled
        || (deadlineAt && Date.now() >= deadlineAt)) return;
    // Fan out only a text-free hint to each live source sharing this request.
    // Optional UI messaging cannot hold up the stream or the final carry.
    try {
      chrome.tabs.sendMessage(operation.sourceTabId, { type: "SUMMARY_NEAR_END", transferId }).catch(() => {});
    } catch {}
  };
  entry.progressListeners.add(reportNearEnd);
  if (entry.nearEnd) reportNearEnd();
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
    if (result.diagnostics?.summary_response_failures) recordKnownSummaryResponseFailures(transferId, result.diagnostics.summary_response_failures);
    return result;
  } catch (error) {
    checkTransferOperation(operation);
    checkTransferDeadline(deadlineAt);
    throw error;
  } finally {
    clearTimeout(timeout);
    entry.progressListeners.delete(reportNearEnd);
    entry.waiters -= 1;
    if (!entry.waiters && !entry.settled) {
      entry.controller.abort(createTransferCancelledError());
      if (summaryInflight.get(cacheKey) === entry) summaryInflight.delete(cacheKey);
    }
  }
}

async function summarizeLargeWithBackend(conversation, transferId, deadlineAt, operation) {
  if (!globalThis.CapLargeTransfer || !isUuid(transferId))
    throw Object.assign(new Error("Large-chat summarization is unavailable."), { code: "summary_failed" });
  const started = nowMs(), stopKeepAlive = startSummaryServiceWorkerKeepAlive();
  const signal = operation?.controller.signal;
  let fetchMs = 0, parseMs = 0, requestCount = 0;
  try {
    const telemetry = getPreparedSummaryTelemetry(transferId) || await waitForSummaryTelemetry(enqueueTelemetryWork(async () => {
      await restoreActiveTransferTelemetry();
      const active = activeTransferTelemetry.get(transferId);
      if (!active || active.status !== "started") return null;
      const installId = await getOrCreateTelemetryInstallId();
      updatePreparedSummaryTelemetry(active, installId);
      return getPreparedSummaryTelemetry(transferId);
    }), signal || new AbortController().signal);
    checkTransferOperation(operation);
    checkTransferDeadline(deadlineAt);
    const result = await globalThis.CapLargeTransfer.summarize({ conversation, transferId, signal,
      deadlineAt: deadlineAt || Infinity,
      onProgress(progress) {
        if (signal?.aborted || !Number.isInteger(operation?.sourceTabId)) return;
        try { chrome.tabs.sendMessage(operation.sourceTabId, { type: "LARGE_SUMMARY_PROGRESS", transferId,
          ...progress }).catch(() => {}); } catch {}
      },
      async post(payload, { signal: requestSignal, deadlineAt: requestDeadline }) {
        checkTransferOperation(operation);
        await checkTransferSource(operation);
        const controller = new AbortController();
        const onAbort = () => controller.abort(requestSignal.reason);
        requestSignal.addEventListener("abort", onAbort, { once: true });
        if (requestSignal.aborted) onAbort();
        const expiresAt = Math.min(requestDeadline, Date.now() + 85000);
        const timer = setTimeout(() => controller.abort(), Math.max(0, expiresAt - Date.now()));
        const check = () => {
          checkTransferOperation(operation);
          checkTransferDeadline(deadlineAt);
          if (Date.now() >= expiresAt) controller.abort();
          controller.signal.throwIfAborted();
        };
        try {
          check();
          const body = JSON.stringify({ ...payload, ...(telemetry ? { telemetry } : {}) });
          if (new TextEncoder().encode(body).length > 3000000)
            throw Object.assign(new Error("Large-chat part exceeds the request bound."), { code: "request_too_large" });
          const fetchedAt = nowMs();
          requestCount++;
          const response = await fetch(SUMMARY_BACKEND_URL.replace(/\/summarize$/, "/large-summary"), {
            method: "POST", credentials: "omit", redirect: "error", signal: controller.signal,
            headers: { ...localPreviewAuthHeaders(SUMMARY_BACKEND_URL.replace(/\/summarize$/, "/large-summary")), "Content-Type": "application/json", "Accept": "application/x-ndjson",
              "X-Cap-Context-Client": SUMMARY_CLIENT_HEADER }, body
          });
          fetchMs += nowMs() - fetchedAt;
          check();
          if (!response.ok) throw await createSummaryBackendError(response);
          const parsedAt = nowMs();
          const data = await readSummaryResponse(response, check);
          parseMs += nowMs() - parsedAt;
          check();
          if (data?.ok === false || data?.code && !data?.summary?.trim())
            throw createSummaryBackendPayloadError(data, data.status || response.status);
          await checkTransferSource(operation);
          return data;
        } finally {
          clearTimeout(timer);
          requestSignal.removeEventListener("abort", onAbort);
        }
      }
    });
    checkTransferOperation(operation);
    await checkTransferSource(operation);
    checkTransferDeadline(deadlineAt);
    // Parts never touch summaryProofs. Only the server-verified final receipt
    // authenticates the completed handoff and may advance summary accounting.
    const confirmation = sanitizeSummaryConfirmation({
      summary_proof: result.summaryProofV3 || result.summaryProofV2 || result.summaryProof,
      ...(result.summaryProofV3 || result.summaryProofV2 ? { summary_confirmed_at: result.summaryConfirmedAt } : {}),
      ...(result.summaryProofV3 ? { model: result.summaryModel } : {})
    });
    if (telemetry && confirmation) {
      await waitForSummaryTelemetry(enqueueTelemetryWork(async () => {
        const active = activeTransferTelemetry.get(transferId);
        if (active) {
          summaryProofs.set(transferId, confirmation);
          activeTransferTelemetry.set(transferId, mergeTransferTelemetryEvents(active, { ...active, lastStage: "summary_completed" }));
        }
        await queueActiveTransferTelemetry({ ...telemetry, last_stage: "summary_completed", ...confirmation }, transferId);
      }), signal || new AbortController().signal);
      initializeTelemetryDelivery();
    }
    return { summary: result.summary, timing: { source: "backend", status: 200,
      summaryMs: Math.round(nowMs() - started), fetchMs: Math.round(fetchMs), parseMs: Math.round(parseMs),
      chars: result.summary.length, requestChars: conversation.length, backendInputChars: conversation.length,
      backend: { ...result.timing, largeChat: { parts: result.partCount, requests: requestCount } } } };
  } finally { stopKeepAlive(); }
}

async function fetchSummaryFromBackend(conversationText, transferId = null, deadlineAt = null, requestSignal = null, onNearEnd = () => {}, payload = { conversation: conversationText }) {
  const startedAt = nowMs();
  const retryDeadlineAt = Math.min(Date.now() + SUMMARY_BACKEND_TIMEOUT_MS, deadlineAt || Infinity);
  const responseFailures = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    requestSignal?.throwIfAborted();
    checkTransferDeadline(deadlineAt);
    try {
      const result = await fetchSummaryFromBackendOnce(conversationText, transferId, deadlineAt, requestSignal, onNearEnd, payload, retryDeadlineAt, attempt, responseFailures);
      result.timing.attempt = attempt;
      result.timing.summaryMs = Math.round(nowMs() - startedAt);
      return result;
    } catch (error) {
      if (attempt === 2 || !error.summaryResponseInterrupted) throw error;
      // Restart the whole response once, with the same identity and total time
      // budget. Partial text and near-end hints never survive the failed read.
      onNearEnd(false);
    }
  }
}

async function fetchSummaryFromBackendOnce(conversationText, transferId = null, deadlineAt = null, requestSignal = null, onNearEnd = () => {}, payload = { conversation: conversationText }, retryDeadlineAt = Infinity, attempt = 1, responseFailures = []) {
  checkTransferDeadline(deadlineAt);
  const summaryStartedAt = nowMs();
  const diagnostics = { version: 1, diagnostics_revision: 3, last_operation: "summary_request" };
  let responseReceived = false, requestSent = false;
  const responseDebug = { attempt_id: transferId, started_at: new Date().toISOString(), phase: "request" };
  const controller = new AbortController();
  const onCancel = () => controller.abort(requestSignal.reason);
  requestSignal?.addEventListener("abort", onCancel, { once: true });
  if (requestSignal?.aborted) onCancel();
  const requestDeadlineAt = Math.min(Date.now() + SUMMARY_BACKEND_TIMEOUT_MS, deadlineAt || Infinity, retryDeadlineAt);
  const timeout = setTimeout(() => controller.abort(), Math.max(0, requestDeadlineAt - Date.now()));
  const stopServiceWorkerKeepAlive = startSummaryServiceWorkerKeepAlive();
  const checkSummaryDeadline = () => {
    checkTransferDeadline(deadlineAt);
    // Response/storage microtasks may run before an overdue abort timer.
    if (Date.now() >= requestDeadlineAt) controller.abort();
    controller.signal.throwIfAborted();
  };

  try {
    // Capture normally prepares this identity before the AI request. A cold
    // worker/legacy attempt still gets the bounded storage recovery path.
    const telemetry = getPreparedSummaryTelemetry(transferId) || await waitForSummaryTelemetry(enqueueTelemetryWork(async () => {
      await restoreActiveTransferTelemetry();
      const active = activeTransferTelemetry.get(transferId);
      if (!active || active.status !== "started") return null;
      // Older workers persisted active events without a version. An existing
      // outbox envelope is the best available identity across an update.
      const queuedIdentity = (await readTelemetryOutbox()).find(entry => entry.payload.attempt_id === transferId)?.payload;
      active.extensionVersion = queuedIdentity?.extension_version || active.extensionVersion || chrome.runtime.getManifest?.().version || null;
      await persistActiveTransferTelemetry(transferId);
      const installId = await getOrCreateTelemetryInstallId();
      updatePreparedSummaryTelemetry(active, installId);
      return getPreparedSummaryTelemetry(transferId);
    }), controller.signal);
    checkSummaryDeadline();
    const requestBody = JSON.stringify({ ...payload, ...(telemetry ? { telemetry } : {}) });
    if (new TextEncoder().encode(requestBody).byteLength > SUMMARY_MAX_REQUEST_BYTES) {
      throw Object.assign(new Error("This chat is too large to send for an AI summary. Our request limit is 4.4 MB."), {
        code: "request_too_large", diagnosticCode: "request_too_large"
      });
    }
    const fetchStartedAt = nowMs();
    requestSent = true;
    const response = await fetch(SUMMARY_BACKEND_URL, {
      method: "POST",
      credentials: "omit",
      redirect: "error", // Never forward conversation text to another origin on a redirect.
      headers: {
        ...localPreviewAuthHeaders(SUMMARY_BACKEND_URL),
        "Content-Type": "application/json",
        "Accept": "application/x-ndjson",
        "X-Cap-Context-Client": SUMMARY_CLIENT_HEADER
      },
      body: requestBody,
      signal: controller.signal
    });
    responseReceived = true;
    responseDebug.phase = "response_headers";
    responseDebug.headers_at = new Date().toISOString();
    responseDebug.http_status = response.status;
    responseDebug.headers_ms = Math.round(nowMs() - summaryStartedAt);
    responseDebug.format = response.headers?.get("content-type")?.includes("application/x-ndjson") ? "ndjson" : "json";
    const vercelId = response.headers?.get("x-vercel-id");
    if (typeof vercelId === "string" && /^[a-zA-Z0-9:;._=-]{1,160}$/.test(vercelId)) responseDebug.vercel_request_id = vercelId;
    globalThis.CapTransferDiagnostics?.update(diagnostics, { summary_http_status: response.status,
      summary_fetch_ms: Math.round(nowMs() - fetchStartedAt), last_operation: "summary_response" });
    checkSummaryDeadline();
    recordKnownTransferTelemetryStage(transferId, "summary_response_started");
    const fetchMs = Math.round(nowMs() - fetchStartedAt);

    if (!response.ok) {
      throw await createSummaryBackendError(response);
    }

    const parseStartedAt = nowMs();
    const data = await readSummaryResponse(response, checkSummaryDeadline, onNearEnd, responseDebug);
    responseDebug.phase = "summary_validation";
    const parseMs = Math.round(nowMs() - parseStartedAt);
    if (data?.ok === false || (data?.code && !data?.summary?.trim())) {
      throw createSummaryBackendPayloadError(data, data?.status || response.status);
    }
    if (!data.summary?.trim()) throw Object.assign(new Error("Backup summarizer returned no summary."), { diagnosticCode: "summary_empty" });
    responseDebug.phase = "summary_confirmation";
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
        if (active) {
          summaryProofs.set(transferId, confirmation);
          activeTransferTelemetry.set(transferId, mergeTransferTelemetryEvents(active, { ...active, lastStage: "summary_completed" }));
        }
        await queueActiveTransferTelemetry({ ...telemetry, last_stage: "summary_completed", ...confirmation }, transferId);
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
    return { summary, timing, ...(responseFailures.length ? { diagnostics: { version: 1,
      summary_response_failures: responseFailures.map(record => ({ ...record })) } } : {}) };
  } catch (error) {
    responseDebug.elapsed_ms = Math.round(nowMs() - summaryStartedAt);
    responseDebug.deadline_remaining_ms = Math.max(0, requestDeadlineAt - Date.now());
    let failure = error;
    try { checkSummaryDeadline(); } catch (deadlineError) { failure = deadlineError; }
    responseDebug.aborted = controller.signal.aborted;
    if (responseReceived || requestSent) {
      // Reporting is optional. Even broken storage/console hooks must not
      // suppress the original error, retry, local carry or deadline handling.
      try { logSummaryResponseFailure(responseDebug, error); } catch {}
      try {
        const record = makeSummaryResponseFailure(responseDebug, error, attempt, requestSignal, requestDeadlineAt, deadlineAt);
        if (record && responseFailures.length < 2) responseFailures.push(record);
        if (responseFailures.length) {
          diagnostics.summary_response_failures = responseFailures.map(entry => ({ ...entry }));
          recordKnownSummaryResponseFailures(transferId, responseFailures);
        }
      } catch {}
    }
    const fallback = controller.signal.aborted ? "summary_timeout" : responseReceived ? "summary_invalid_response" : "summary_transport_failed";
    globalThis.CapTransferDiagnostics?.update(diagnostics, { summary_ms: Math.round(nowMs() - summaryStartedAt),
      ...globalThis.CapTransferDiagnostics?.errorDetails(failure, responseReceived ? "summary_response" : "summary_request"),
      error_code: globalThis.CapTransferDiagnostics?.errorCode(failure, fallback),
      error_origin: responseReceived && (diagnostics.summary_http_status >= 400 || failure.summaryServiceFailure) ? "summary_service" : "background" });
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
  error.diagnostics = globalThis.CapTransferDiagnostics?.validate(payload?.diagnostics) || undefined;
  error.code = code;
  error.summaryServiceFailure = true;
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
  deferFinalActivation = false, deadlineAt = null, sourceTab = null, localDirect = false) {
  const trace = createBackgroundTrace();
  trace.localDirect = localDirect;
  trace.diagnostics = { version: 1, diagnostics_revision: 3 };
  globalThis.CapTransferDiagnostics?.event(trace.diagnostics, "paste_start", 0, "delivery_events");
  recordDeliveryDiagnostics(transferId, destinationId, sourceTab, trace.diagnostics);
  try {
    const result = await transferToDestinationObserved(destinationId, text, preparedTabId, transferId,
      deferFinalActivation, deadlineAt, sourceTab, trace);
    globalThis.CapTransferDiagnostics?.update(trace.diagnostics, { delivery_ms: Math.round(nowMs() - trace.startedAt) });
    recordDeliveryDiagnostics(transferId, destinationId, sourceTab, trace.diagnostics);
    return { ...result, diagnostics: globalThis.CapTransferDiagnostics?.snapshot(trace.diagnostics) || null };
  } catch (error) {
    globalThis.CapTransferDiagnostics?.update(trace.diagnostics, { delivery_ms: Math.round(nowMs() - trace.startedAt) });
    if (!trace.diagnostics.error_code) globalThis.CapTransferDiagnostics?.failure(trace.diagnostics, error, "background", nowMs() - trace.startedAt);
    error.diagnostics = globalThis.CapTransferDiagnostics?.snapshot(trace.diagnostics) || null;
    recordDeliveryDiagnostics(transferId, destinationId, sourceTab, trace.diagnostics);
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
  if (trace.localDirect) checkTransferOperation(operation);
  else await checkTransferSource(operation);
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
  if (preparedTabId && await isPreparedDestinationTabUsable(preparedTabId, destinationId, operation, trace.diagnostics)) {
    if (trace.localDirect) checkTransferOperation(operation);
    else await checkTransferSource(operation);
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
    // These checks describe the rejected prepared tab, not its replacement.
    if (typeof trace.diagnostics.destination_platform_match === "boolean") {
      trace.diagnostics.prepared_diagnostics = { version: 1, diagnostics_revision: 3, claude_page: trace.diagnostics.claude_page,
        destination_auth_prompt: trace.diagnostics.destination_auth_prompt,
        destination_platform_match: trace.diagnostics.destination_platform_match,
        destination_route_allowed: trace.diagnostics.destination_route_allowed };
      delete trace.diagnostics.claude_page;
      delete trace.diagnostics.destination_platform_match;
      delete trace.diagnostics.destination_route_allowed;
      delete trace.diagnostics.destination_auth_prompt;
    }
    markBackgroundTrace(trace, "prepared tab rejected", {
      tabId: preparedTabId,
      destination: destinationId,
      reason: "missing_or_navigated"
    });
  }

  // A draft is intentional user state. Report the first rejection directly so
  // the source can offer its copy dialog without opening a second destination.
  const pasteErrorCode = pasteResult?.diagnostics?.error_code || globalThis.CapTransferDiagnostics?.errorCode(pasteResult);
  if (!pasteResult?.ok && pasteErrorCode !== "editor_has_draft") {
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
      for (const key of ["claude_page", "destination_platform_match", "destination_route_allowed", "destination_message_count", "destination_auth_prompt"]) delete trace.diagnostics[key];
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
    error.diagnosticCode = pasteResult?.diagnostics?.error_code || globalThis.CapTransferDiagnostics?.errorCode(pasteResult) || "unknown_error";
    throw error;
  }

  await checkTransferSource(operation);
  if (!deferFinalActivation && !destination.focusBeforePaste && !trace.localDirect && operation?.earlyRevealedTabId !== destinationTabId) {
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
  // A badge is optional presentation, not an acknowledgement prerequisite.
  setBadge("OK", "#1f8f4d", 2500).catch(() => {});
  return {
    timing: {
      totalMs: Math.round(nowMs() - trace.startedAt),
      tabId: destinationTabId,
      paste: pasteResult?.timing || null
    },
    marks: trace.marks
  };
}

async function isPreparedDestinationTabUsable(tabId, destinationId, operation = null, diagnostics = null) {
  try {
    const tab = await chrome.tabs.get(tabId);
    globalThis.CapTransferDiagnostics?.update(diagnostics, { destination_tab_status: tab?.status });
    const currentOrPendingUrl = tab?.pendingUrl || tab?.url || "";
    if (destinationId === "claude" && currentOrPendingUrl) {
      globalThis.CapTransferDiagnostics?.update(diagnostics, {
        claude_page: globalThis.CapTransferDiagnostics.claudePage(currentOrPendingUrl)
      });
    }
    const platformMatches = getPlatformFromUrl(currentOrPendingUrl) === destinationId;
    let routeAllowed = false;
    try { routeAllowed = Boolean(DESTINATION_LANDING_PATHS[destinationId]?.includes(new URL(currentOrPendingUrl).pathname.replace(/\/+$/, "") || "/")); }
    catch { /* An invalid URL is unusable; observing it must not cancel a live tab. */ }
    globalThis.CapTransferDiagnostics?.update(diagnostics, {
      destination_platform_match: platformMatches, destination_route_allowed: routeAllowed,
      destination_auth_prompt: globalThis.CapTransferDiagnostics?.authPromptFromUrl(currentOrPendingUrl)
    });
    return platformMatches && routeAllowed;
  } catch {
    // Missing destinations are recoverable even if the removal event was lost.
    checkTransferOperation(operation);
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
  if (trace?.localDirect) checkTransferOperation(trace?.operation);
  else await checkTransferSource(trace?.operation);
  checkTransferDeadline(trace?.deadlineAt);
  // Focus is a paste prerequisite on these destinations, independent of whether
  // final activation is deferred. Near-end reveal already provides that focus;
  // ordinary callers sequence the source completion cue first.
  if ((destination.focusBeforePaste || trace?.localDirect) && trace?.operation?.earlyRevealedTabId !== tabId) {
    markBackgroundTrace(trace, "tab activate before paste start", { tabId });
    await activateDestinationTab(tabId, trace?.deadlineAt, trace?.operation, trace?.operation,
      destinationId === "claude" ? trace?.diagnostics : null);
    markBackgroundTrace(trace, "tab activate before paste done", { tabId });
    if (destination.activationSettleMs) {
      markBackgroundTrace(trace, "tab activation settle start", { tabId, settleMs: destination.activationSettleMs });
      await delay(destination.activationSettleMs);
      markBackgroundTrace(trace, "tab activation settle done", { tabId });
    }
  }

  if (destination.focusBeforePaste && trace?.operation?.earlyRevealedTabId === tabId) {
    const remainingSettle = Math.max(0, (destination.activationSettleMs || 0) - (Date.now() - trace.operation.earlyRevealedAt));
    if (remainingSettle) await delay(remainingSettle);
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

function recordDestinationObservation(operation, event, changes = {}, { destination = null, tabId = null, error = null, site = event } = {}) {
  try {
    if (!operation || (Number.isInteger(tabId) && !operation.tabIds.has(tabId))) return;
    const observedAt = Date.now();
    const contract = globalThis.CapTransferDiagnostics;
    if (!contract) return;
    const observed = operation.destinationDiagnostics ||= { version: 1 };
    const seen = operation.destinationDiagnosticSteps ||= new Set();
    const key = `${site}:${event}:${tabId ?? "new"}`;
    if (seen.has(key) || seen.size >= 12) return;
    seen.add(key);
    contract.update(observed, changes);
    if (error) {
      const details = contract.errorDetails(error, site);
      for (const field of ["error_type", "error_file", "error_line", "error_column", "failure_site"]) {
        contract.update(observed, { [field]: details[field] });
      }
      contract.update(observed, { recovery_error_code: contract.errorCode(error,
        site === "destination_activate" ? "destination_activation_failed" : "destination_open_failed"), error_origin: "background" });
    }
    const snapshot = contract.snapshot(observed);
    // Queue behind the initial identity even on a cold/stalled worker. Commit
    // within this queue slot so a later terminal report cannot overtake it.
    enqueueTelemetryWork(async () => {
      await restoreActiveTransferTelemetry();
      const active = activeTransferTelemetry.get(operation.transferId);
      if (active?.status !== "started" || activeTransferSourceTabs.get(operation.transferId) !== operation.sourceTabId
          || (destination && DESTINATIONS[active.destinationPlatform] !== destination)) return;
      const diagnostics = { ...(active.diagnostics || { version: 1 }), ...snapshot };
      contract.event(diagnostics, event, Math.max(0, observedAt - Date.parse(active.attemptedAt)), "delivery_events",
        error ? snapshot.recovery_error_code : null);
      const merged = mergeTransferTelemetryEvents(active, { ...active, diagnostics });
      activeTransferTelemetry.set(active.attemptId, merged);
      const installId = await getOrCreateTelemetryInstallId();
      updatePreparedSummaryTelemetry(merged, installId);
      await queueActiveTransferTelemetry(makeTelemetryPayload(merged, installId), active.attemptId);
    }).catch(() => {});
  } catch { /* Optional diagnosis must not alter native tab operations. */ }
}

async function prepareDestination(destinationId, deadlineAt = null, sourceTab = null, transferId = null) {
  const operation = getTransferOperation(transferId, sourceTab, deadlineAt);
  checkTransferDeadline(deadlineAt);
  const startedAt = nowMs();
  const destination = DESTINATIONS[destinationId];
  if (!destination) {
    throw Object.assign(new Error("Unknown AI destination."), { diagnosticCode: "destination_unsupported" });
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
  const openedAt = nowMs();
  recordDestinationObservation(options.operation, "destination_prepare", {}, { destination });
  try {
    const checkedSource = await checkTransferSource(options.operation);
    let placement = {};
    if (Number.isInteger(options.sourceTab?.id)) {
      // The user can focus a different window while capture runs. Resolve the
      // source's current position rather than opening in Chrome's current window.
      const source = checkedSource?.id === options.sourceTab.id ? checkedSource : await chrome.tabs.get(options.sourceTab.id);
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
    options.operation?.createdTabIds.add(destinationTab.id);
    if (options.operation?.controller.signal.aborted) {
      // Creation was already submitted when Escape or source closure cancelled
      // the attempt. Its late result must not leave a new destination behind.
      await chrome.tabs.remove(destinationTab.id).catch(() => {});
      checkTransferOperation(options.operation);
    }
    recordDestinationObservation(options.operation, "destination_open", {
      destination_prepared: true, destination_open_ms: Math.round(nowMs() - openedAt), destination_tab_status: destinationTab.status
    }, { destination, tabId: destinationTab.id });
    return destinationTab.id;
  } catch (error) {
    error.code = error.code || "destination_open_failed";
    error.diagnosticCode ||= "destination_open_failed";
    recordDestinationObservation(options.operation, "failure", { destination_prepared: false,
      destination_open_ms: Math.round(nowMs() - openedAt) }, { destination, error, site: "destination_open" });
    throw error;
  }
}

async function activateDestinationTab(tabId, deadlineAt = null, operation = null, completionOperation = operation, diagnostics = null) {
  await checkTransferSource(operation);
  checkTransferDeadline(deadlineAt);
  const activatedAt = nowMs();
  recordDestinationObservation(completionOperation, "destination_activate", {}, { tabId });
  try {
    const tab = await chrome.tabs.update(tabId, { active: true });
    if (tab?.url) globalThis.CapTransferDiagnostics?.update(diagnostics, {
      claude_page: globalThis.CapTransferDiagnostics.claudePage(tab.url)
    });
    // Once native activation is submitted, finish its window-focus pair even
    // if optional polishing stops. Real transfer cancellation still revokes it.
    await checkTransferSource(completionOperation);
    checkTransferDeadline(deadlineAt);
    if (tab?.windowId) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    checkTransferOperation(completionOperation);
    operation?.onTabActivated?.(tabId);
    recordDestinationObservation(completionOperation, "destination_activate", { activation_ms: Math.round(nowMs() - activatedAt) },
      { tabId, site: "destination_activated" });
  } catch (error) {
    checkTransferOperation(completionOperation);
    if (["transfer_timeout", "user_cancelled"].includes(error?.code)) throw error;
    // Focus is required for several composers to restore their native drafts.
    // Never report a successful switch or paste into a hidden tab after failure.
    const activationError = new Error("Could not switch to the destination tab. Return to your original tab and try again.");
    activationError.code = "destination_open_failed";
    activationError.diagnosticCode = "destination_activation_failed";
    recordDestinationObservation(completionOperation, "failure", { activation_ms: Math.round(nowMs() - activatedAt) },
      { tabId, error: activationError, site: "destination_activate" });
    throw activationError;
  }
}

async function revealDestinationProgress(tabId, destinationId, deadlineAt, transferId, sourceTab) {
  const operation = getTransferOperation(transferId, sourceTab, deadlineAt);
  // This text-free status can reveal only the tab prepared for this attempt.
  if (!operation || !operation.tabIds.has(tabId) || tabId === operation.sourceTabId
      || !DESTINATIONS[destinationId] || !Number.isFinite(deadlineAt)) {
    throw Object.assign(new Error("The prepared destination was not available."), { diagnosticCode: "destination_tab_unavailable" });
  }
  if (operation.earlyRevealStopped) return false;
  await checkTransferSource(operation);
  if (!await isPreparedDestinationTabUsable(tabId, destinationId, operation)) {
    throw Object.assign(new Error("The destination is no longer a new chat."), { diagnosticCode: "destination_not_new_chat" });
  }
  const controller = new AbortController();
  operation.earlyRevealController = controller;
  const onTransferAbort = () => controller.abort(operation.controller.signal.reason);
  operation.controller.signal.addEventListener("abort", onTransferAbort, { once: true });
  if (operation.controller.signal.aborted) onTransferAbort();
  if (operation.earlyRevealStopped) controller.abort(Object.assign(new Error("Early reveal stopped."), { code: "early_reveal_stopped" }));
  const revealOperation = { ...operation, controller, onTabActivated: () => {
    // Record completed native activation even if optional status work stopped
    // while it was in flight; delivery must not refocus or paste hidden.
    operation.earlyRevealedTabId = tabId;
    operation.earlyRevealedAt = Date.now();
  } };
  try {
    const statusMessage = {
      type: "SHOW_TRANSFER_PROGRESS", phase: "polishing", destination: destinationId,
      transferId, deadlineAt
    };
    const statusDeadlineAt = Math.min(deadlineAt, Date.now() + 6000);
    const waitForProgressReady = async (type) => {
      while (Date.now() < statusDeadlineAt) {
        await checkTransferSource(revealOperation);
        if (!await isPreparedDestinationTabUsable(tabId, destinationId, revealOperation)) {
          throw Object.assign(new Error("The destination is no longer a new chat."), { diagnosticCode: "destination_not_new_chat" });
        }
        const tab = await chrome.tabs.get(tabId);
        // A content-script ping alone does not prove the final document loaded.
        if (tab.status === "complete" && !tab.pendingUrl) {
          const response = await sendMessageWhenReady(tabId, { ...statusMessage, type },
            Math.max(1, statusDeadlineAt - Date.now()), DESTINATIONS[destinationId].name,
            { ...createBackgroundTrace(), operation: revealOperation });
          if (response?.ok === true) return;
          if (response?.code !== "destination_loading") throw Object.assign(new Error("The destination was not ready."), { diagnosticCode: "destination_tab_unavailable" });
        }
        await waitForTransferWork(delay(Math.min(MESSAGE_RETRY_INTERVAL_MS,
          Math.max(0, statusDeadlineAt - Date.now()))), revealOperation);
      }
      throw Object.assign(new Error("The destination did not finish loading in time."), { diagnosticCode: "message_timeout" });
    };
    await waitForProgressReady("CHECK_TRANSFER_PROGRESS_READY");
    if (operation.earlyRevealedTabId !== tabId) {
      if (!await isPreparedDestinationTabUsable(tabId, destinationId, revealOperation)) {
        throw Object.assign(new Error("The destination is no longer a new chat."), { diagnosticCode: "destination_not_new_chat" });
      }
      await activateDestinationTab(tabId, deadlineAt, revealOperation, operation);
    }
    // Show one cue in the loaded visible document; retries reuse that cue.
    await waitForProgressReady("SHOW_TRANSFER_PROGRESS");
    return true;
  } catch (error) {
    chrome.tabs.sendMessage(tabId, { type: "FINISH_TRANSFER_PROGRESS", transferId, failed: false }).catch(() => {});
    if (error?.code === "early_reveal_stopped") return operation.earlyRevealedTabId === tabId;
    throw error;
  } finally {
    operation.controller.signal.removeEventListener("abort", onTransferAbort);
    if (operation.earlyRevealController === controller) delete operation.earlyRevealController;
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
  if (operation?.earlyRevealedTabId !== tabId) await activateDestinationTab(tabId, deadlineAt, operation);
}

async function pasteIntoDestinationTab(
  tabId,
  destinationId,
  destination,
  text,
  transferId = null,
  trace = null
) {
  if (trace?.operation) trace.operation.pasteCheckpoint = {
    tabId, destinationId, trace, textChars: text.length, startedAt: Date.now(), seen: new Set(), lastIndex: -1, events: []
  };
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
    await chrome.scripting.executeScript({ target: { tabId }, files: file === PLATFORM_CONTENT_SCRIPT ? ["transfer-diagnostics.js", file] : ["transfer-diagnostics.js", "json-capture-metrics.js", file] });
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
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["json-capture-metrics-main.js", "claude-fetch-main.js"] });
    return true;
  } catch { return false; }
}

async function ensureChatGptJsonHook(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["json-capture-metrics-main.js", "chatgpt-fetch-main.js"] });
    return true;
  } catch { return false; }
}

async function ensureNetworkJsonHook(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: ["json-capture-metrics-main.js", "network-json-data.js", "network-fetch-main.js"] });
    return true;
  } catch { return false; }
}

async function ensureSourceContentScripts(tabId, platform) {
  if (platform === "claude") {
    await ensureClaudeJsonHook(tabId);
    await ensureContentScript(tabId, "claude-json-capture.js");
  } else if (platform === "chatgpt") {
    await ensureChatGptJsonHook(tabId);
    await ensureContentScript(tabId, "chatgpt-json-capture.js");
  } else if (["gemini", "grok", "deepseek"].includes(platform)) {
    await ensureNetworkJsonHook(tabId);
    await ensureContentScript(tabId, "network-json-capture.js");
  } else return false;
  return ensureContentScript(tabId, PLATFORM_CONTENT_SCRIPT);
}

async function injectIntoOpenSupportedTabs() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        .filter((tab) => tab.id && getPlatformFromUrl(tab.url))
        .map(tab => ensureSourceContentScripts(tab.id, getPlatformFromUrl(tab.url)))
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
      if (message.type === "PASTE_CONTEXT" && trace?.operation) {
        try { await chrome.tabs.get(tabId); }
        catch (tabError) {
          // A gone tab cannot retain a paste. Let the existing fresh-tab path
          // recover; lost acknowledgements from live tabs remain unconfirmed.
          if (/No tab with id/i.test(String(tabError?.message || ""))) {
            throw Object.assign(new Error("The destination tab was closed."), {
              code: "destination_open_failed", diagnosticCode: "destination_tab_closed"
            });
          }
        }
      }
      // For a live tab, only a missing receiver proves the paste never started.
      // A lost reply or timeout may follow insertion, so never duplicate it.
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
      // A toolbar source needs its JSON bridge as well as the picker receiver.
      injected = message.type === "OPEN_DESTINATION_PICKER"
        ? await ensureSourceContentScripts(tabId, getPlatformFromUrl((await chrome.tabs.get(tabId)).url))
        : await ensureContentScript(tabId);
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
  // Toolbar decoration is optional, including in error handlers. A worker
  // teardown must not turn a badge failure into another uncaught error.
  try {
    await chrome.action.setBadgeBackgroundColor({ color });
    await chrome.action.setBadgeText({ text });

    if (timeoutMs) setTimeout(clearBadge, timeoutMs);
  } catch {
    console.debug("[Context Generator] Toolbar badge unavailable.");
  }
}

async function clearBadge() {
  try {
    await chrome.action.setBadgeText({ text: "" });
  } catch {
    console.debug("[Context Generator] Toolbar badge unavailable.");
  }
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
    version: 1, ...globalThis.CapTransferDiagnostics?.errorDetails(error, operation),
    error_code: globalThis.CapTransferDiagnostics?.errorCode(error, globalThis.CapTransferDiagnostics.operationErrorCode(operation)) || "unknown_error",
    error_origin: "background", last_operation: operation
  };
}

function nowMs() {
  return globalThis.performance?.now?.() || Date.now();
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
