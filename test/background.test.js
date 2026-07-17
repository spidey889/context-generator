const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "extension", "background.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "extension", "manifest.json"), "utf8"));

function loadBackgroundForSummaryTest(fetchImpl) {
  let messageListener = null;
  const event = { addListener: () => {} };
  const sandbox = {
    AbortController,
    URL,
    clearTimeout,
    console: { debug() {}, error() {}, log() {}, warn() {} },
    fetch: fetchImpl,
    performance: { now: () => Date.now() },
    setTimeout,
    chrome: {
      action: {
        onClicked: event,
        setBadgeBackgroundColor: async () => {},
        setBadgeText: async () => {}
      },
      alarms: {
        clear: async () => true,
        create: () => {},
        onAlarm: event
      },
      runtime: {
        onInstalled: event,
        onStartup: event,
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          }
        }
      },
      scripting: { executeScript: async () => {} },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {}
        },
        onChanged: event
      },
      tabs: {
        create: async () => ({}),
        query: async () => [],
        sendMessage: async () => ({}),
        update: async () => ({})
      },
      windows: { update: async () => ({}) }
    }
  };

  vm.createContext(sandbox);
  new vm.Script(source, { filename: "extension/background.js" }).runInContext(sandbox);
  assert.ok(messageListener, "background summary listener was registered");

  return async function sendSummary(conversation) {
    return new Promise((resolve, reject) => {
      const keepsChannelOpen = messageListener(
        { type: "SUMMARIZE_WITH_BACKEND", conversation, transferId: "cache-test" },
        {},
        resolve
      );
      if (keepsChannelOpen !== true) reject(new Error("summary listener did not keep the response channel open"));
    });
  };
}

test("extension sends each summary job to the backend only once", () => {
  assert.match(source, /const SUMMARY_BACKEND_TIMEOUT_MS = 210000/);
  assert.doesNotMatch(source, /SUMMARY_BACKEND_ATTEMPTS|SUMMARY_BACKEND_RETRY_BUDGET_MS/);
  assert.equal((source.match(/fetch\(SUMMARY_BACKEND_URL/g) || []).length, 1);
});

test("destination preconnect and warmup never include conversation content", () => {
  const prepareStart = source.indexOf("async function prepareDestination(");
  const prepareEnd = source.indexOf("async function createDestinationTab(", prepareStart);
  const warmupStart = source.indexOf("async function warmDestinationTab(");
  const warmupEnd = source.indexOf("async function pingTab(", warmupStart);
  const warmupSource = `${source.slice(prepareStart, prepareEnd)}\n${source.slice(warmupStart, warmupEnd)}`;

  assert.ok(prepareStart >= 0 && prepareEnd > prepareStart && warmupEnd > warmupStart);
  assert.match(warmupSource, /pingTab\(tabId\)/);
  assert.match(source, /sendMessage\(tabId, \{ type: "CONTEXT_GENERATOR_PING" \}\)/);
  assert.doesNotMatch(warmupSource, /SUMMARIZE_WITH_BACKEND|conversationText|summary|PASTE_CONTEXT/);
});

test("backend errors expose only bounded user-safe messages", () => {
  assert.match(source, /conversation_too_large/);
  assert.match(source, /rate_limited/);
  assert.match(source, /payload\.error\.length <= 240/);
  assert.doesNotMatch(source, /response\.text\(\)/);
});

test("latest-run raw transcript expires without deleting diagnostic metadata", () => {
  assert.ok(manifest.permissions.includes("alarms"));
  assert.match(source, /const RAW_TRANSCRIPT_RETENTION_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /delete retainedStats\.rawScrapedText/);
  assert.match(source, /delete retainedStats\.rawScrapedTextExpiresAt/);
  assert.doesNotMatch(source, /chrome\.storage\.local\.remove\(LAST_TRANSFER_STATS_STORAGE_KEY\)/);
});

test("summary cache preserves original result metadata and labels cache hits", async () => {
  let fetchCalls = 0;
  const backendTiming = {
    servedBy: "mistral",
    provider: "mistral",
    primaryModel: "gemini-3.5-flash",
    model: "mistral-medium-2604",
    modelsTried: ["gemini-3.5-flash", "mistral-medium-2604"],
    mistralModelsTried: ["mistral-medium-2604"],
    providerMs: 812,
    fallback: {
      attempted: true,
      used: true,
      servedBy: "mistral",
      model: "mistral-medium-2604",
      reason: "Gemini failed validation"
    },
    usage: { promptTokens: 1200, completionTokens: 240, totalTokens: 1440, cachedTokens: 0 }
  };
  const sendSummary = loadBackgroundForSummaryTest(async () => {
    fetchCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ summary: "Cached Context Carry", timing: backendTiming })
    };
  });

  const fresh = await sendSummary("same exact conversation");
  const cached = await sendSummary("same exact conversation");

  assert.equal(fetchCalls, 1);
  assert.equal(fresh.ok, true);
  assert.equal(fresh.timing.source, "backend");
  assert.equal(cached.ok, true);
  assert.equal(cached.summary, "Cached Context Carry");
  assert.equal(cached.timing.source, "cache");
  assert.equal(cached.timing.cacheHit, true);
  assert.equal(cached.timing.summaryMs, 0);
  assert.equal(cached.timing.fetchMs, 0);
  assert.equal(cached.timing.originalSource, "backend");
  assert.equal(cached.timing.originalSummaryMs, fresh.timing.summaryMs);
  assert.deepEqual(JSON.parse(JSON.stringify(cached.timing.backend)), backendTiming);
});
