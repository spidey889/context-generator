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

function loadBackgroundForTransferTest({
  preparedTab,
  sendMessageImpl,
  firstCreatedTabId = 100,
  useRealTimers = false
} = {}) {
  let messageListener = null;
  let nextCreatedTabId = firstCreatedTabId;
  const operations = {
    created: [],
    gotten: [],
    sent: [],
    updated: []
  };
  const event = { addListener: () => {} };
  const fastSetTimeout = (callback, _delay, ...args) => setTimeout(callback, 0, ...args);
  const sandbox = {
    AbortController,
    URL,
    clearTimeout,
    console: { debug() {}, error() {}, log() {}, warn() {} },
    fetch: async () => { throw new Error("fetch is not expected in transfer tests"); },
    performance: { now: () => Date.now() },
    setTimeout: useRealTimers ? setTimeout : fastSetTimeout,
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
        create: async (options) => {
          const tab = { id: nextCreatedTabId++, url: options.url, windowId: 1 };
          operations.created.push({ options, tab });
          return tab;
        },
        get: async (tabId) => {
          operations.gotten.push(tabId);
          if (!preparedTab) throw new Error(`No tab with id: ${tabId}`);
          return preparedTab;
        },
        query: async () => [],
        sendMessage: async (tabId, message) => {
          operations.sent.push({ tabId, message });
          return sendMessageImpl ? sendMessageImpl(tabId, message) : { ok: true };
        },
        update: async (tabId, options) => {
          operations.updated.push({ tabId, options });
          return { id: tabId, windowId: 1 };
        }
      },
      windows: { update: async () => ({}) }
    }
  };

  vm.createContext(sandbox);
  new vm.Script(`${source}\n;globalThis.__backgroundTestHooks = { getPlatformFromUrl, sendMessageWhenReady };`, {
    filename: "extension/background.js"
  }).runInContext(sandbox);
  assert.ok(messageListener, "background transfer listener was registered");

  return {
    operations,
    getPlatformFromUrl: sandbox.__backgroundTestHooks.getPlatformFromUrl,
    sendMessageWhenReady: sandbox.__backgroundTestHooks.sendMessageWhenReady,
    sendTransfer(destination, preparedTabId = null, deferFinalActivation = false) {
      return new Promise((resolve, reject) => {
        const keepsChannelOpen = messageListener(
          {
            type: "TRANSFER_TO_DESTINATION",
            destination,
            text: "CONTEXT CARRY — READY TO PASTE\nUseful transfer context",
            preparedTabId,
            transferId: "transfer-test",
            deferFinalActivation
          },
          {},
          resolve
        );
        if (keepsChannelOpen !== true) reject(new Error("transfer listener did not keep the response channel open"));
      });
    },
    activateDestination(destination, tabId) {
      return new Promise((resolve, reject) => {
        const keepsChannelOpen = messageListener(
          { type: "ACTIVATE_DESTINATION_TAB", destination, tabId },
          {},
          resolve
        );
        if (keepsChannelOpen !== true) reject(new Error("activation listener did not keep the response channel open"));
      });
    }
  };
}

test("destination messaging enforces its deadline while a response is still pending", async () => {
  const harness = loadBackgroundForTransferTest({
    sendMessageImpl: () => new Promise(() => {}),
    useRealTimers: true
  });
  const startedAt = Date.now();

  await assert.rejects(
    harness.sendMessageWhenReady(
      41,
      { type: "PASTE_CONTEXT", destination: "claude", text: "context" },
      "platform-content.js",
      40,
      "Claude"
    ),
    (error) => error?.code === "message_timeout" && error.message === "Timed out connecting to Claude."
  );

  assert.ok(Date.now() - startedAt < 500, "The in-flight destination response must not outlive its deadline.");
});

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

test("prepared destination is reused only while it remains on the selected platform", async () => {
  const harness = loadBackgroundForTransferTest({
    preparedTab: { id: 41, url: "https://example.com/user-navigated-away", windowId: 1 },
    sendMessageImpl: async () => ({ ok: true })
  });

  const response = await harness.sendTransfer("chatgpt", 41);

  assert.equal(response.ok, true);
  assert.deepEqual(harness.operations.gotten, [41]);
  assert.equal(harness.operations.created.length, 1);
  assert.equal(harness.operations.sent.some(({ tabId }) => tabId === 41), false);
  assert.deepEqual(harness.operations.sent.map(({ tabId }) => tabId), [100]);
});

test("prepared-tab recovery opens at most one fresh destination", async () => {
  const harness = loadBackgroundForTransferTest({
    preparedTab: { id: 41, url: "https://chatgpt.com/", windowId: 1 },
    sendMessageImpl: async (tabId) => {
      if (tabId === 41) throw new Error("Prepared tab message failed");
      return { ok: false, error: "Fresh editor unavailable" };
    }
  });

  const response = await harness.sendTransfer("chatgpt", 41);

  assert.equal(response.ok, false);
  assert.equal(harness.operations.created.length, 1);
  assert.deepEqual(harness.operations.sent.map(({ tabId }) => tabId), [41, 100]);
});

test("fresh ChatGPT recovery uses the same activation settle as the normal path", async () => {
  const harness = loadBackgroundForTransferTest({
    preparedTab: { id: 41, url: "https://chatgpt.com/", windowId: 1 },
    sendMessageImpl: async (tabId) => {
      if (tabId === 41) throw new Error("Prepared tab message failed");
      return { ok: true, timing: { pasteMs: 5 } };
    }
  });

  const response = await harness.sendTransfer("chatgpt", 41);

  assert.equal(response.ok, true);
  assert.equal(harness.operations.created.length, 1);
  const freshOpenIndex = response.marks.findIndex(({ label }) => label === "fresh fallback tab open done");
  const recoveryMarks = response.marks.slice(freshOpenIndex + 1).map(({ label }) => label);
  assert.ok(freshOpenIndex >= 0);
  assert.ok(recoveryMarks.includes("tab activation settle start"));
  assert.ok(recoveryMarks.includes("tab activation settle done"));
});

test("successful paste defers destination activation until the completion UI finishes", async () => {
  const harness = loadBackgroundForTransferTest({
    preparedTab: { id: 41, url: "https://claude.ai/new", windowId: 1 },
    sendMessageImpl: async () => ({ ok: true, timing: { pasteMs: 5 } })
  });

  const response = await harness.sendTransfer("claude", 41, true);

  assert.equal(response.ok, true);
  assert.equal(response.timing.tabId, 41);
  assert.equal(response.marks.at(-1).label, "final tab activation deferred");
  assert.equal(harness.operations.updated.length, 0);
  assert.equal("showHandoffCompletion" in harness.operations.sent[0].message, false);

  const activation = await harness.activateDestination("claude", 41);
  assert.equal(activation.ok, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(harness.operations.updated)),
    [{ tabId: 41, options: { active: true } }]
  );
});

test("focus-required destinations preserve activation and settle before paste", async () => {
  const harness = loadBackgroundForTransferTest({
    preparedTab: { id: 41, url: "https://chatgpt.com/", windowId: 1 },
    sendMessageImpl: async () => ({ ok: true, timing: { pasteMs: 5 } })
  });

  const response = await harness.sendTransfer("chatgpt", 41, true);

  assert.equal(response.ok, true);
  assert.equal(harness.operations.updated.length, 1);
  assert.equal("showHandoffCompletion" in harness.operations.sent[0].message, false);
  assert.equal(response.marks.some(({ label }) => label === "tab activate before paste start"), true);
  assert.equal(response.marks.some(({ label }) => label === "tab activation settle done"), true);
  assert.equal(response.marks.at(-1).label, "final tab activation deferred");

  const activation = await harness.activateDestination("chatgpt", 41);
  assert.equal(activation.ok, true);
  assert.equal(harness.operations.updated.length, 2);
});

test("ordinary OpenAI pages are never classified as ChatGPT", () => {
  const harness = loadBackgroundForTransferTest();

  assert.equal(harness.getPlatformFromUrl("https://chatgpt.com/c/123"), "chatgpt");
  assert.equal(harness.getPlatformFromUrl("https://chat.openai.com/c/123"), "chatgpt");
  assert.equal(harness.getPlatformFromUrl("https://platform.openai.com/docs"), null);
  assert.equal(harness.getPlatformFromUrl("https://openai.com/research"), null);
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
    primaryModel: "gemini-3.6-flash",
    model: "mistral-medium-2604",
    modelsTried: ["gemini-3.6-flash", "mistral-medium-2604"],
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
