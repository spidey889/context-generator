const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "extension", "background.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "extension", "manifest.json"), "utf8"));

function loadBackgroundForSummaryTest(fetchImpl, { tabs = [], injections = [], injectionError = false, onMessage = () => {} } = {}) {
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
            onMessage(listener);
          }
        }
      },
      scripting: { executeScript: async args => { injections.push(args); if (injectionError) throw new Error("not available"); } },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {}
        },
        onChanged: event
      },
      tabs: {
        create: async () => ({}),
        query: async () => tabs,
        sendMessage: async () => ({}),
        update: async () => ({})
      },
      windows: { update: async () => ({}) }
    }
  };

  vm.createContext(sandbox);
  new vm.Script(source, { filename: "extension/background.js" }).runInContext(sandbox);
  assert.ok(messageListener, "background summary listener was registered");

  return async function sendSummary(conversation, deadlineAt = null) {
    return new Promise((resolve, reject) => {
      const keepsChannelOpen = messageListener(
        { type: "SUMMARIZE_WITH_BACKEND", conversation, transferId: "cache-test", deadlineAt },
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
    updated: [],
    injected: []
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
      scripting: { executeScript: async (options) => { operations.injected.push(options); } },
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
    sendTransfer(destination, preparedTabId = null, deferFinalActivation = false, deadlineAt = null) {
      return new Promise((resolve, reject) => {
        const keepsChannelOpen = messageListener(
          {
            type: "TRANSFER_TO_DESTINATION",
            destination,
            text: "CONTEXT CARRY — READY TO PASTE\nUseful transfer context",
            preparedTabId,
            transferId: "transfer-test",
            deferFinalActivation,
            deadlineAt
          },
          {},
          resolve
        );
        if (keepsChannelOpen !== true) reject(new Error("transfer listener did not keep the response channel open"));
      });
    },
    activateDestination(destination, tabId, deadlineAt = null) {
      return new Promise((resolve, reject) => {
        const keepsChannelOpen = messageListener(
          { type: "ACTIVATE_DESTINATION_TAB", destination, tabId, deadlineAt },
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
      40,
      "Claude"
    ),
    (error) => error?.code === "message_timeout" && error.message === "Timed out connecting to Claude."
  );

  assert.ok(Date.now() - startedAt < 500, "The in-flight destination response must not outlive its deadline.");
});

test("expired transfer messages cannot fetch summaries, open tabs, paste or activate destinations", async () => {
  let fetches = 0;
  const sendSummary = loadBackgroundForSummaryTest(async () => { fetches++; });
  const expiredAt = Date.now() - 1;
  const summary = await sendSummary("captured conversation", expiredAt);
  assert.equal(summary.ok, false);
  assert.equal(summary.code, "transfer_timeout");
  assert.equal(fetches, 0);

  const harness = loadBackgroundForTransferTest();
  const transfer = await harness.sendTransfer("claude", null, false, expiredAt);
  const activation = await harness.activateDestination("claude", 41, expiredAt);
  for (const response of [transfer, activation]) {
    assert.equal(response.ok, false);
    assert.equal(response.code, "transfer_timeout");
  }
  assert.deepEqual(harness.operations, { created: [], gotten: [], sent: [], updated: [], injected: [] });
});

test("a transfer deadline aborts an outstanding summary request", { timeout: 2000 }, async () => {
  let signal;
  const sendSummary = loadBackgroundForSummaryTest(async (_url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    });
  });
  const response = await sendSummary("captured conversation", Date.now() + 100);
  assert.equal(signal.aborted, true);
  assert.equal(response.ok, false);
  assert.equal(response.code, "transfer_timeout");
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
    servedBy: "openrouter",
    provider: "openrouter",
    primaryModel: "inclusionai/ling-3.1-flash",
    model: "inclusionai/ling-3.1-flash",
    modelsTried: ["inclusionai/ling-3.1-flash"],
    mistralModelsTried: [],
    openrouterModelsTried: ["inclusionai/ling-3.1-flash"],
    openrouterMs: 812,
    providerMs: 812,
    fallback: {
      attempted: false,
      used: false,
      servedBy: null,
      model: null,
      reason: null
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

for (const firstReply of ["missing receiver", "no response"]) {
  test(`destination messaging retries after injection: ${firstReply}`, async () => {
    let calls = 0;
    const harness = loadBackgroundForTransferTest({ sendMessageImpl: async () => {
      if (++calls === 1) {
        if (firstReply === "missing receiver") throw new Error("Receiving end does not exist");
        return undefined;
      }
      return { ok: true };
    } });
    const trace = { startedAt: Date.now(), lastAt: null, marks: [] };
    const result = await harness.sendMessageWhenReady(41, { type: "PASTE_CONTEXT" }, 1000, "Claude", trace);
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(harness.operations.injected)), [{ target: { tabId: 41 }, files: ["platform-content.js"] }]);
    assert.deepEqual(Array.from(trace.marks, mark => mark.label), ["content script inject attempt", "tab ready/message response after inject"]);
    assert.equal(trace.marks.at(-1).detail.attempts, 1);
  });
}

test("destination messaging stops immediately on a non-retryable failure", async () => {
  const harness = loadBackgroundForTransferTest({ sendMessageImpl: async () => { throw new Error("Tab access denied"); } });
  await assert.rejects(harness.sendMessageWhenReady(41, { type: "PASTE_CONTEXT" }, 1000, "Claude"), /Tab access denied/);
  assert.equal(harness.operations.sent.length, 1);
  assert.equal(harness.operations.injected.length, 0);
});

test("JSON scripts reinstall in MAIN then isolated on the matching platform tabs", async () => {
  const injections = [];
  loadBackgroundForSummaryTest(async () => {}, { injections, tabs: [
    { id: 1, url: "https://claude.ai/chat/a" },
    { id: 2, url: "https://chatgpt.com/c/b" },
    { id: 3, url: "https://gemini.google.com/app/c" },
    { id: 4, url: "https://grok.com/c/d" },
    { id: 5, url: "https://chat.deepseek.com/a/chat/s/e" }
  ] });
  await new Promise(resolve => setTimeout(resolve, 0));
  const claude = injections.filter(item => item.target.tabId === 1);
  assert.deepEqual(claude.map(item => [...item.files]), [["claude-fetch-main.js"], ["claude-json-capture.js"], ["platform-content.js"]]);
  assert.equal(claude[0].world, "MAIN");
  const chatgpt = injections.filter(item => item.target.tabId === 2);
  assert.deepEqual(chatgpt.map(item => [...item.files]), [["chatgpt-fetch-main.js"], ["chatgpt-json-capture.js"], ["platform-content.js"]]);
  assert.equal(chatgpt[0].world, "MAIN");
  for (const id of [3, 4, 5]) {
    const platform = injections.filter(item => item.target.tabId === id);
    assert.deepEqual(platform.map(item => [...item.files]), [["network-json-data.js", "network-fetch-main.js"], ["network-json-capture.js"], ["platform-content.js"]]);
    assert.equal(platform[0].world, "MAIN");
  }
});

test("Claude on-demand MAIN installation accepts only a Claude top-frame sender", async () => {
  let listener;
  const injections = [];
  loadBackgroundForSummaryTest(async () => {}, { injections, onMessage: value => { listener = value; } });
  const request = sender => new Promise(resolve => listener({ type: "ENSURE_CLAUDE_JSON_HOOK" }, sender, resolve));
  for (const sender of [{}, { tab: { id: 1, url: "https://chatgpt.com/c/a" }, frameId: 0 }, { tab: { id: 1, url: "https://claude.ai/chat/a" }, frameId: 2 }]) {
    assert.equal((await request(sender)).ok, false);
  }
  assert.equal(injections.length, 0);
  assert.equal((await request({ tab: { id: 1, url: "https://claude.ai/chat/a" }, frameId: 0 })).ok, true);
  assert.equal(injections.length, 1);
  assert.equal(injections[0].world, "MAIN");
  assert.deepEqual([...injections[0].files], ["claude-fetch-main.js"]);
});

test("Claude MAIN installation failures are returned without affecting default startup injection", async () => {
  let listener;
  loadBackgroundForSummaryTest(async () => {}, { injectionError: true, onMessage: value => { listener = value; } });
  const reply = await new Promise(resolve => listener({ type: "ENSURE_CLAUDE_JSON_HOOK" }, { tab: { id: 1, url: "https://claude.ai/chat/a" }, frameId: 0 }, resolve));
  assert.equal(reply.ok, false);
});


test("ChatGPT on-demand MAIN readiness is restricted to its top-frame source", async () => {
  let listener;
  const injections = [];
  loadBackgroundForSummaryTest(async () => {}, { injections, onMessage: value => { listener = value; } });
  const request = sender => new Promise(resolve => listener({ type: "ENSURE_CHATGPT_JSON_HOOK" }, sender, resolve));
  for (const sender of [{}, { tab: { id: 1, url: "https://claude.ai/chat/a" }, frameId: 0 }, { tab: { id: 1, url: "https://chatgpt.com/c/a" }, frameId: 2 }]) assert.equal((await request(sender)).ok, false);
  assert.equal(injections.length, 0);
  assert.equal((await request({ tab: { id: 1, url: "https://chatgpt.com/g/project/c/a" }, frameId: 0 })).ok, true);
  assert.equal(injections.length, 1);
  assert.equal(injections[0].world, "MAIN");
  assert.deepEqual([...injections[0].files], ["chatgpt-fetch-main.js"]);
});

test("New network MAIN readiness accepts only Gemini/Grok/DeepSeek top frames", async () => {
  let listener; const injections = [];
  loadBackgroundForSummaryTest(async () => {}, { injections, onMessage: value => { listener = value; } });
  const request = sender => new Promise(resolve => listener({ type: "ENSURE_NETWORK_JSON_HOOK" }, sender, resolve));
  for (const sender of [{}, { tab: { id: 1, url: "https://chatgpt.com/c/a" }, frameId: 0 }, { tab: { id: 1, url: "https://grok.com/c/a" }, frameId: 2 }]) assert.equal((await request(sender)).ok, false);
  assert.equal(injections.length, 0);
  for (const url of ["https://gemini.google.com/app/a", "https://grok.com/c/a", "https://chat.deepseek.com/a/chat/s/a"]) assert.equal((await request({ tab: { id: 1, url }, frameId: 0 })).ok, true);
  assert.equal(injections.length, 3);
  assert.ok(injections.every(item => item.world === "MAIN"));
});
