const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { clockTest } = require("./helpers/clock");

const source = fs.readFileSync(path.join(__dirname, "..", "extension", "transfer-diagnostics.js"), "utf8") + "\n"
  + fs.readFileSync(path.join(__dirname, "..", "extension", "background.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "extension", "manifest.json"), "utf8"));
const compiledBackground = new vm.Script(source, { filename: "extension/background.js" });
const compiledTransferBackground = new vm.Script(`${source}\n;globalThis.__backgroundTestHooks = { getPlatformFromUrl, sendMessageWhenReady };`, {
  filename: "extension/background.js"
});

function loadBackgroundForSummaryTest(fetchImpl, { tabs = [], injections = [], injectionError = false, cssCalls = [], cssError = false, onMessage = () => {}, clock = Date, progressMessages = [] } = {}) {
  let messageListener = null;
  let tabRemovedListener;
  const closedTabs = new Set();
  const event = { addListener: () => {} };
  const sandbox = {
    AbortController,
    TextDecoder,
    TextEncoder,
    Date: clock,
    URL,
    clearTimeout,
    console: { debug() {}, error() {}, log() {}, warn() {} },
    fetch: fetchImpl,
    performance: { now: () => clock.now() },
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
        id: "cap-context-test",
        onInstalled: event,
        onStartup: event,
        onMessage: {
          addListener(listener) {
            messageListener = listener;
            onMessage(listener);
          }
        }
      },
      scripting: {
        executeScript: async args => { injections.push(args); if (injectionError) throw new Error("not available"); },
        insertCSS: async args => { cssCalls.push({ operation: "apply", ...args }); if (cssError) throw new Error("not available"); },
        removeCSS: async args => { cssCalls.push({ operation: "remove", ...args }); if (cssError) throw new Error("not available"); }
      },
      storage: {
        local: {
          get: async () => ({}),
          set: async () => {}
        },
        onChanged: event
      },
      tabs: {
        get: async id => {
          const tab = tabs.find(tab => tab.id === id);
          if (!tab || closedTabs.has(id)) throw new Error(`No tab with id: ${id}`);
          return tab;
        },
        onRemoved: { addListener: listener => { tabRemovedListener = listener; } },
        create: async () => ({}),
        query: async () => tabs,
        sendMessage: async (tabId, message) => {
          if (message.type === "SUMMARY_NEAR_END") progressMessages.push({ tabId, message });
          return {};
        },
        update: async () => ({})
      },
      windows: { update: async () => ({}) }
    }
  };

  vm.createContext(sandbox);
  compiledBackground.runInContext(sandbox);
  assert.ok(messageListener, "background summary listener was registered");

  const sendSummary = async function (conversation, deadlineAt = null, sourceTabId = null, structured = {}) {
    return new Promise((resolve, reject) => {
      const keepsChannelOpen = messageListener(
        { type: "SUMMARIZE_WITH_BACKEND", conversation, ...structured, transferId: sourceTabId === null ? "cache-test" : `summary-${sourceTabId}`, deadlineAt },
        { tab: sourceTabId === null ? null : { id: sourceTabId } },
        resolve
      );
      if (keepsChannelOpen !== true) reject(new Error("summary listener did not keep the response channel open"));
    });
  };
  sendSummary.closeTab = id => { closedTabs.add(id); return tabRemovedListener(id); };
  sendSummary.cancel = (id, sender = {}) => new Promise(resolve => messageListener(
    { type: "CANCEL_TRANSFER", transferId: `summary-${id}` },
    { id: "cap-context-test", frameId: 0, tab: { id }, ...sender }, resolve));
  sendSummary.backendError = response => sandbox.createSummaryBackendError(response);
  return sendSummary;
}

function loadBackgroundForTransferTest({
  preparedTab,
  sourceTab,
  updateError = false,
  tabUpdateImpl,
  windowUpdateImpl,
  sendMessageImpl,
  createTabImpl,
  firstCreatedTabId = 100,
  useRealTimers = false
} = {}) {
  let messageListener = null;
  let toolbarClickListener = null;
  let tabRemovedListener;
  const closedTabs = new Set();
  let nextCreatedTabId = firstCreatedTabId;
  const operations = {
    cancellationOrder: [],
    created: [],
    gotten: [],
    sent: [],
    updated: [],
    injected: [],
    fetched: [],
    removed: [],
    errors: [],
    badges: []
  };
  const event = { addListener: () => {} };
  const fastSetTimeout = (callback, _delay, ...args) => setTimeout(callback, 0, ...args);
  const sandbox = {
    AbortController,
    Date,
    URL,
    clearTimeout,
    console: { debug() {}, error(...args) { operations.errors.push(args); }, log() {}, warn() {} },
    fetch: async (...args) => { operations.fetched.push(args); throw new Error("fetch is not expected in transfer tests"); },
    performance: { now: () => Date.now() },
    setTimeout: useRealTimers ? setTimeout : fastSetTimeout,
    chrome: {
      action: {
        onClicked: { addListener: listener => { toolbarClickListener = listener; } },
        setBadgeBackgroundColor: async () => {},
        setBadgeText: async options => { operations.badges.push(options.text); }
      },
      alarms: {
        clear: async () => true,
        create: () => {},
        onAlarm: event
      },
      runtime: {
        id: "cap-context-test",
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
        onRemoved: { addListener: listener => { tabRemovedListener = listener; } },
        create: async (options) => {
          const tab = { id: nextCreatedTabId++, url: options.url, windowId: options.windowId ?? 1, status: "complete" };
          operations.created.push({ options, tab });
          return createTabImpl ? createTabImpl(tab) : tab;
        },
        remove: async tabId => { operations.cancellationOrder.push("remove"); operations.removed.push(tabId); closedTabs.add(tabId); },
        get: async (tabId) => {
          operations.gotten.push(tabId);
          if (closedTabs.has(tabId)) throw new Error(`No tab with id: ${tabId}`);
          if (sourceTab?.id === tabId) return sourceTab;
          if (preparedTab?.id === tabId) return preparedTab;
          const created = operations.created.find(entry => entry.tab.id === tabId);
          if (created) return created.tab;
          throw new Error(`No tab with id: ${tabId}`);
        },
        query: async () => [],
        sendMessage: async (tabId, message) => {
          if (message.type === "CANCEL_TRANSFER") operations.cancellationOrder.push("notify");
          operations.sent.push({ tabId, message });
          return sendMessageImpl ? sendMessageImpl(tabId, message) : { ok: true };
        },
        update: async (tabId, options) => {
          operations.updated.push({ tabId, options });
          if (updateError) throw new Error("No tab with id");
          return tabUpdateImpl ? tabUpdateImpl(tabId, options) : { id: tabId, windowId: 1 };
        }
      },
      windows: { update: async (...args) => windowUpdateImpl ? windowUpdateImpl(...args) : ({}) }
    }
  };

  vm.createContext(sandbox);
  compiledTransferBackground.runInContext(sandbox);
  assert.ok(messageListener, "background transfer listener was registered");
  assert.ok(toolbarClickListener, "toolbar listener was registered");

  return {
    operations,
    clickToolbar: toolbarClickListener,
    cancel(tabId, sender = {}) {
      return new Promise(resolve => messageListener({ type: "CANCEL_TRANSFER", transferId: "transfer-test" },
        { id: "cap-context-test", frameId: 0, tab: { id: tabId }, ...sender }, resolve));
    },
    getPlatformFromUrl: sandbox.__backgroundTestHooks.getPlatformFromUrl,
    sendMessageWhenReady: sandbox.__backgroundTestHooks.sendMessageWhenReady,
    closeTab(tabId, notify = true) { closedTabs.add(tabId); return notify ? tabRemovedListener(tabId) : undefined; },
    prepare(destination, senderTab = null, deadlineAt = null, transferId = "transfer-test") {
      return new Promise(resolve => messageListener(
        { type: "PREPARE_DESTINATION", destination, deadlineAt, transferId },
        { tab: senderTab }, resolve
      ));
    },
    sendTransfer(destination, preparedTabId = null, deferFinalActivation = false, deadlineAt = null, senderTab = null, transferId = "transfer-test") {
      return new Promise((resolve, reject) => {
        const keepsChannelOpen = messageListener(
          {
            type: "TRANSFER_TO_DESTINATION",
            destination,
            text: "CONTEXT CARRY — READY TO PASTE\nUseful transfer context",
            preparedTabId,
            transferId,
            deferFinalActivation,
            deadlineAt
          },
          { tab: senderTab },
          resolve
        );
        if (keepsChannelOpen !== true) reject(new Error("transfer listener did not keep the response channel open"));
      });
    },
    revealDestination(destination, tabId, senderTab, deadlineAt = Date.now() + 10000) {
      return new Promise(resolve => messageListener({ type: "REVEAL_DESTINATION_PROGRESS",
        destination, tabId, transferId: "transfer-test", deadlineAt }, { tab: senderTab }, resolve));
    },
    endProgress(tabId, senderTab) {
      return new Promise(resolve => messageListener({ type: "END_DESTINATION_PROGRESS",
        tabId, transferId: "transfer-test" }, { tab: senderTab }, resolve));
    },
    activateDestination(destination, tabId, deadlineAt = null, senderTab = null) {
      return new Promise((resolve, reject) => {
        const keepsChannelOpen = messageListener(
          { type: "ACTIVATE_DESTINATION_TAB", destination, tabId, deadlineAt, transferId: "transfer-test" },
          { tab: senderTab },
          resolve
        );
        if (keepsChannelOpen !== true) reject(new Error("activation listener did not keep the response channel open"));
      });
    }
  };
}

test("summary worker rejects oversized JSON before fetch and admits a full Unicode million-character chat", async () => {
  let calls = 0;
  const send = loadBackgroundForSummaryTest(async (_url, request) => {
    calls++;
    const { conversation } = JSON.parse(request.body);
    assert.equal(conversation, "漢".repeat(1000000));
    return new Response(JSON.stringify({ summary: "The full conversation was summarized." }));
  });
  const rejected = await send("\u0001".repeat(1000000));
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, "request_too_large");
  assert.equal(calls, 0);
  assert.match(rejected.error, /4\.4 MB/);
  const accepted = await send("漢".repeat(1000000));
  assert.equal(accepted.ok, true);
  assert.equal(calls, 1);
});

test("toolbar opens the picker on supported tabs without starting a transfer or RUN badge", async () => {
  for (const url of ["https://chatgpt.com/c/source", "https://claude.ai/chat/source", "https://gemini.google.com/app/source", "https://grok.com/c/source", "https://chat.deepseek.com/a/chat/s/source"]) {
    const { clickToolbar, operations } = loadBackgroundForTransferTest();
    await clickToolbar({ id: 7, url });
    assert.equal(operations.sent.length, 1, url);
    assert.equal(operations.sent[0].tabId, 7);
    assert.deepEqual(JSON.parse(JSON.stringify(operations.sent[0].message)), { type: "OPEN_DESTINATION_PICKER" });
    assert.equal(operations.created.length + operations.fetched.length, 0);
    assert.deepEqual(operations.badges, [""], "opening the picker only clears an old badge");
  }
});

test("toolbar repairs a missing receiver but rejects unsupported tabs and failed picker replies", async () => {
  const sourceTab = { id: 7, url: "https://chatgpt.com/c/source" };
  let sends = 0;
  const repaired = loadBackgroundForTransferTest({ sourceTab, sendMessageImpl: () => {
    if (++sends === 1) throw new Error("Could not establish connection. Receiving end does not exist.");
    return { ok: true };
  } });
  await repaired.clickToolbar(sourceTab);
  assert.deepEqual(repaired.operations.injected.map(item => [...item.files]), [
    ["json-capture-metrics-main.js", "chatgpt-fetch-main.js"],
    ["transfer-diagnostics.js", "json-capture-metrics.js", "chatgpt-json-capture.js"],
    ["transfer-diagnostics.js", "platform-content.js"]
  ], "repair must restore JSON before opening the picker");
  assert.deepEqual(repaired.operations.sent.map(entry => entry.message.type), ["OPEN_DESTINATION_PICKER", "OPEN_DESTINATION_PICKER"]);
  assert.equal(repaired.operations.created.length, 0);
  for (const tab of [{ id: 7, url: "https://example.com/" }, { url: sourceTab.url }, sourceTab]) {
    const rejected = loadBackgroundForTransferTest({ sendMessageImpl: () => ({ ok: false, error: "Picker unavailable" }) });
    await rejected.clickToolbar(tab);
    assert.equal(rejected.operations.sent.length, tab === sourceTab ? 1 : 0);
    assert.equal(rejected.operations.badges.at(-1), "ERR");
    assert.equal(rejected.operations.created.length, 0);
  }
});

test("preparation and fresh recovery open beside the source in its current window", async () => {
  const currentSource = { id: 9, windowId: 7, index: 3 };
  const senderSnapshot = { id: 9, windowId: 1, index: 0 };
  const harness = loadBackgroundForTransferTest({ sourceTab: currentSource,
    preparedTab: { id: 41, url: "https://chatgpt.com/c/occupied" } });
  const prepared = await harness.prepare("claude", senderSnapshot);
  assert.equal(prepared.ok, true);
  // Warmup may send only a readiness ping and must make no fetch request.
  await new Promise(setImmediate);
  assert.ok(harness.operations.sent.length > 0);
  assert.ok(harness.operations.sent.every(({ message }) => JSON.stringify(message) === '{"type":"CONTEXT_GENERATOR_PING"}'));
  assert.equal(harness.operations.fetched.length, 0);
  const recovered = await harness.sendTransfer("claude", 41, false, null, senderSnapshot);
  assert.equal(recovered.ok, true);
  assert.equal(harness.operations.created.length, 2);
  for (const { options } of harness.operations.created) {
    assert.equal(options.windowId, 7);
    assert.equal(options.index, 4);
    assert.equal(options.openerTabId, 9);
  }
  assert.equal(harness.operations.created[0].options.active, false);
});

clockTest("a closed source cannot open a destination in an unrelated current window", async () => {
  const harness = loadBackgroundForTransferTest();
  const response = await harness.prepare("claude", { id: 9 });
  assert.equal(response.ok, false);
  assert.equal(harness.operations.created.length, 0);
});

test("closing the source revokes an outstanding paste without recovery or activation", async () => {
  let acknowledge, pasteStarted;
  const started = new Promise(resolve => { pasteStarted = resolve; });
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  const harness = loadBackgroundForTransferTest({ sourceTab, useRealTimers: true,
    preparedTab: { id: 41, url: "https://gemini.google.com/app" },
    sendMessageImpl: (_tabId, message) => {
      if (message.type !== "PASTE_CONTEXT") return { ok: true };
      pasteStarted();
      return new Promise(resolve => { acknowledge = resolve; });
    }
  });
  const pending = harness.sendTransfer("gemini", 41, false, null, sourceTab);
  await started;
  await harness.closeTab(9);
  const response = await pending;
  assert.equal(response.code, "user_cancelled");
  acknowledge({ ok: true });
  await new Promise(setImmediate);
  assert.equal(harness.operations.created.length, 0);
  assert.equal(harness.operations.updated.length, 0);
  assert.ok(harness.operations.sent.some(({ tabId, message }) => tabId === 41 && message.type === "CANCEL_TRANSFER"));
  assert.equal(harness.operations.sent.filter(({ message }) => message.type === "PASTE_CONTEXT").length, 1);
});

for (const notify of [true, false]) test(`a closed prepared destination reopens with the ready carry (removal event: ${notify})`, async () => {
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  const harness = loadBackgroundForTransferTest({ sourceTab });
  const prepared = await harness.prepare("gemini", sourceTab);
  await harness.closeTab(prepared.tabId, notify);
  const response = await harness.sendTransfer("gemini", prepared.tabId, false, null, sourceTab);
  assert.equal(response.ok, true);
  assert.equal(harness.operations.created.length, 2, "Reuse the existing single fresh-tab recovery.");
  const paste = harness.operations.sent.filter(({ message }) => message.type === "PASTE_CONTEXT");
  assert.equal(paste.length, 1);
  assert.equal(paste[0].tabId, response.timing.tabId);
  assert.notEqual(paste[0].tabId, prepared.tabId);
  assert.equal(paste[0].message.transferId, "transfer-test");
  assert.equal(paste[0].message.text, "CONTEXT CARRY — READY TO PASTE\nUseful transfer context");
  assert.equal(harness.operations.fetched.length, 0, "Keep the ready carry without another summary request.");
  assert.ok(harness.operations.sent.every(({ message }) => message.type !== "CANCEL_TRANSFER"));
});

test("closing the prepared destination during paste uses one fresh tab with the same carry", async () => {
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  const harness = loadBackgroundForTransferTest({ sourceTab,
    preparedTab: { id: 41, url: "https://gemini.google.com/app" },
    sendMessageImpl: async (tabId, message) => {
      if (tabId === 41 && message.type === "PASTE_CONTEXT") {
        await harness.closeTab(tabId);
        throw new Error("The message port closed before a response was received");
      }
      return { ok: true };
    }
  });
  const response = await harness.sendTransfer("gemini", 41, false, null, sourceTab);
  assert.equal(response.ok, true);
  assert.equal(harness.operations.created.length, 1);
  const pastes = harness.operations.sent.filter(({ message }) => message.type === "PASTE_CONTEXT");
  assert.equal(pastes.length, 2);
  assert.equal(pastes[0].message.text, pastes[1].message.text);
  assert.equal(pastes[0].message.transferId, pastes[1].message.transferId);
  assert.ok(harness.operations.sent.every(({ message }) => message.type !== "CANCEL_TRANSFER"));
});

for (const stop of ["source closure", "Escape"]) test(`a tab creation already submitted before ${stop} is cleaned up without delivery`, async () => {
  let finishCreation, creationStarted;
  const started = new Promise(resolve => { creationStarted = resolve; });
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  const harness = loadBackgroundForTransferTest({ sourceTab,
    createTabImpl: tab => { creationStarted(); return new Promise(resolve => { finishCreation = () => resolve(tab); }); }
  });
  const pending = harness.prepare("gemini", sourceTab);
  await started;
  if (stop === "Escape") await harness.cancel(9);
  else await harness.closeTab(9);
  finishCreation();
  assert.equal((await pending).code, "user_cancelled");
  assert.deepEqual(harness.operations.removed, [100]);
  assert.ok(harness.operations.sent.every(({ message }) => message.type !== "PASTE_CONTEXT" && message.type !== "CONTEXT_GENERATOR_PING"));
});

test("closing the last source aborts its outstanding backend request", async () => {
  let requestStarted, signal;
  const started = new Promise(resolve => { requestStarted = resolve; });
  const sendSummary = loadBackgroundForSummaryTest(async (_url, options) => {
    signal = options.signal;
    requestStarted();
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  }, { tabs: [{ id: 9 }] });
  const pending = sendSummary("Stop this summary when I close its source.", null, 9);
  await started;
  await sendSummary.closeTab(9);
  assert.equal((await pending).code, "user_cancelled");
  assert.equal(signal.aborted, true);
});

test("streaming summary stays pending through previews and preserves the final result in one fetch", async () => {
  const encoder = new TextEncoder();
  let controller, fetches = 0, readStarted;
  const started = new Promise(resolve => { readStarted = resolve; });
  const sendSummary = loadBackgroundForSummaryTest(async (url, options) => {
    fetches++;
    assert.equal(url, "https://context-generator-five.vercel.app/api/summarize");
    assert.equal(options.credentials, "omit");
    assert.equal(options.redirect, "error");
    assert.ok(manifest.host_permissions.includes(new URL(url).origin + "/*"));
    assert.ok(manifest.host_permissions.every(host => !host.includes("context-generator-git-")));
    assert.equal(options.headers.Accept, "application/x-ndjson");
    return new Response(new ReadableStream({ start(stream) {
      controller = stream;
      stream.enqueue(encoder.encode(`${JSON.stringify({ type: "reset" })}\n${JSON.stringify({ type: "delta", text: "Unused preview" })}\n`));
      readStarted();
    } }), { headers: { "content-type": "application/x-ndjson" } });
  });
  let completed = false;
  const pending = sendSummary("stream this conversation").then(value => { completed = true; return value; });
  await started; await new Promise(setImmediate);
  assert.equal(completed, false);
  const final = encoder.encode(`${JSON.stringify({ type: "result", data: { summary: "Complete résumé 🧠", timing: { model: "test-model" } } })}\n`);
  for (let i = 0; i < final.length; i += 3) controller.enqueue(final.slice(i, i + 3));
  controller.close();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.summary, "Complete résumé 🧠");
  assert.equal(fetches, 1);
});

test("stream near-end hints handle split headings, retries and shared live sources without forwarding text", async (t) => {
  const encoder = new TextEncoder();
  const progressMessages = [];
  let controller, fetches = 0;
  t.after(() => { try { controller?.close(); } catch {} });
  const sendSummary = loadBackgroundForSummaryTest(async () => {
    fetches++;
    return new Response(new ReadableStream({ start(stream) { controller = stream; } }),
      { headers: { "content-type": "application/x-ndjson" } });
  }, { tabs: [{ id: 9 }, { id: 10 }, { id: 11 }], progressMessages });
  const first = sendSummary("shared streamed chat", null, 9);
  await new Promise(setImmediate);
  const second = sendSummary("shared streamed chat", null, 10);
  await new Promise(setImmediate);
  const chunk = events => controller.enqueue(encoder.encode(events.map(event => JSON.stringify(event) + "\n").join("")));
  chunk([{ type: "delta", text: "📦 KEY CONTEXT\nPrivate preview" }, { type: "reset" }, { type: "delta", text: "\n🔁 NEXT STEP\n" }]);
  await new Promise(setImmediate);
  assert.equal(progressMessages.length, 0, "A discarded attempt cannot complete the new attempt's headings.");
  await sendSummary.closeTab(9);
  assert.equal((await first).code, "user_cancelled");
  chunk([{ type: "reset" }, { type: "delta", text: "📦 KEY CON" }]);
  chunk([{ type: "delta", text: "TEXT\nPrivate preview\n🔁 NEXT" }]);
  await new Promise(setImmediate);
  assert.equal(progressMessages.length, 0);
  chunk([{ type: "delta", text: " STEP\nReply only:" }]);
  await new Promise(setImmediate);
  assert.deepEqual(progressMessages.map(({ tabId, message }) => ({ tabId, ...message })),
    [{ tabId: 10, type: "SUMMARY_NEAR_END", transferId: "summary-10" }]);
  const late = sendSummary("shared streamed chat", null, 11);
  await new Promise(setImmediate);
  chunk([{ type: "delta", text: "More final instruction" }]);
  await new Promise(setImmediate);
  assert.equal(progressMessages.length, 2, "Each live waiter gets one text-free hint, including a late joiner.");
  assert.equal(progressMessages[1].tabId, 11);
  chunk([{ type: "result", data: { summary: "Accepted complete carry" } }]);
  controller.close();
  assert.equal((await second).summary, "Accepted complete carry");
  assert.equal((await late).summary, "Accepted complete carry");
  assert.equal(fetches, 1);
});

test("a final result buffered with preview headings skips optional near-end messaging", async () => {
  const progressMessages = [];
  const sendSummary = loadBackgroundForSummaryTest(async () => new Response([
    { type: "delta", text: "📦 KEY CONTEXT\nContext\n🔁 NEXT STEP\n" },
    { type: "result", data: { summary: "Already finished" } }
  ].map(event => JSON.stringify(event) + "\n").join(""), { headers: { "content-type": "application/x-ndjson" } }),
  { tabs: [{ id: 9 }], progressMessages });
  assert.equal((await sendSummary("buffered summary", null, 9)).summary, "Already finished");
  assert.equal(progressMessages.length, 0);
});

test("truncated summary streams fail and source closure cancels an outstanding streamed body", async () => {
  const encoder = new TextEncoder();
  const truncated = loadBackgroundForSummaryTest(async () => new Response(`${JSON.stringify({ type: "delta", text: "Partial" })}\n`,
    { headers: { "content-type": "application/x-ndjson" } }));
  assert.equal((await truncated("incomplete stream")).ok, false);
  let started, cancelled = false;
  const ready = new Promise(resolve => { started = resolve; });
  const sendSummary = loadBackgroundForSummaryTest(async (_url, options) => new Response(new ReadableStream({ start(controller) {
    controller.enqueue(encoder.encode(`${JSON.stringify({ type: "delta", text: "Partial" })}\n`));
    options.signal.addEventListener("abort", () => { cancelled = true; controller.error(options.signal.reason); }, { once: true });
    started();
  } }), { headers: { "content-type": "application/x-ndjson" } }), { tabs: [{ id: 9 }] });
  const pending = sendSummary("cancel this streamed conversation", null, 9);
  await ready; await sendSummary.closeTab(9);
  assert.equal((await pending).code, "user_cancelled");
  assert.equal(cancelled, true);
});

test("closing one source does not cancel a shared summary needed by another source", async () => {
  let finish, fetches = 0, signal;
  const sendSummary = loadBackgroundForSummaryTest(async (_url, options) => {
    fetches++; signal = options.signal;
    return new Promise(resolve => { finish = () => resolve({ ok: true, status: 200, json: async () => ({ summary: "Shared context" }) }); });
  }, { tabs: [{ id: 9 }, { id: 10 }] });
  const owner = sendSummary("same conversation", null, 9);
  await new Promise(setImmediate);
  const waiter = sendSummary("same conversation", null, 10);
  await new Promise(setImmediate);
  await sendSummary.closeTab(9);
  assert.equal((await owner).code, "user_cancelled");
  assert.equal(signal.aborted, false);
  finish();
  assert.equal((await waiter).summary, "Shared context");
  assert.equal(fetches, 1);
});

test("Escape cancels an active summary body and rejects late work for that attempt", async () => {
  let started, signal, fetches = 0;
  const ready = new Promise(resolve => { started = resolve; });
  const sendSummary = loadBackgroundForSummaryTest(async (_url, options) => {
    fetches++;
    signal = options.signal;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode('{"type":"delta","text":"Halfway"}\n'));
      signal.addEventListener("abort", () => controller.error(signal.reason), { once: true });
      started();
    } }), { headers: { "content-type": "application/x-ndjson" } });
  }, { tabs: [{ id: 9 }, { id: 10 }] });
  const pending = sendSummary("cancel pending summary", null, 9);
  await ready;
  assert.equal((await sendSummary.cancel(9, { tab: { id: 10 } })).ok, false, "An unrelated tab cannot cancel this attempt.");
  assert.equal((await sendSummary.cancel(9, { frameId: 1 })).ok, false);
  assert.equal(signal.aborted, false);
  assert.equal((await sendSummary.cancel(9)).ok, true);
  assert.equal((await pending).code, "user_cancelled");
  assert.equal(signal.aborted, true);
  assert.equal((await sendSummary("cancel pending summary", null, 9)).code, "user_cancelled");
  assert.equal(fetches, 1, "A late request cannot restart generation.");
});

for (const from of ["source", "destination"]) test(`Escape from the ${from} closes its created destination and revokes delivery`, async () => {
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  const harness = loadBackgroundForTransferTest({ sourceTab });
  const prepared = await harness.prepare("gemini", sourceTab);
  assert.equal((await harness.cancel(from === "source" ? sourceTab.id : prepared.tabId)).ok, true);
  assert.deepEqual(harness.operations.removed, [prepared.tabId]);
  assert.equal(harness.operations.cancellationOrder[0], "remove", "Native closure is issued before cancellation notifications.");
  assert.equal((await harness.sendTransfer("gemini", prepared.tabId, false, null, sourceTab)).code, "user_cancelled");
  assert.equal(harness.operations.created.length, 1);
  assert.equal(harness.operations.updated.length, 0);
  assert.equal(harness.operations.sent.filter(({ message }) => message.type === "PASTE_CONTEXT").length, 0);
  assert.ok(harness.operations.sent.some(({ tabId, message }) => tabId === 9 && message.type === "CANCEL_TRANSFER"));
});

test("Escape closes a fresh recovery tab while preserving an existing destination", async () => {
  let pasteStarted, acknowledge;
  const started = new Promise(resolve => { pasteStarted = resolve; });
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  const harness = loadBackgroundForTransferTest({ sourceTab, useRealTimers: true,
    preparedTab: { id: 41, url: "https://gemini.google.com/app" },
    sendMessageImpl: (_tabId, message) => {
      if (message.type !== "PASTE_CONTEXT") return { ok: true };
      if (_tabId === 41) return { ok: false, code: "paste_failed", error: "Composer unavailable" };
      pasteStarted(); return new Promise(resolve => { acknowledge = resolve; });
    }
  });
  const pending = harness.sendTransfer("gemini", 41, false, null, sourceTab);
  await started;
  assert.equal((await harness.cancel(9)).ok, true);
  assert.equal((await pending).code, "user_cancelled");
  acknowledge({ ok: true });
  assert.equal(harness.operations.created.length, 1);
  assert.deepEqual(harness.operations.removed, [harness.operations.created[0].tab.id], "Only the fresh recovery tab can be closed.");
});

test("Escape before preparation latches cancellation before any destination work", async () => {
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  const harness = loadBackgroundForTransferTest({ sourceTab });
  assert.equal((await harness.cancel(9)).ok, true);
  assert.equal((await harness.prepare("gemini", sourceTab)).code, "user_cancelled");
  assert.equal(harness.operations.created.length, 0);
});

test("a new transfer opens and delivers after Escape on every destination", async () => {
  for (const destination of ["claude", "chatgpt", "gemini", "grok", "deepseek"]) {
    const sourceTab = { id: 9, windowId: 1, index: 0 };
    const harness = loadBackgroundForTransferTest({ sourceTab });
    const first = await harness.prepare(destination, sourceTab);
    assert.equal(first.ok, true, destination);
    await harness.cancel(sourceTab.id);
    const next = await harness.prepare(destination, sourceTab, null, "next-attempt");
    assert.equal(next.ok, true, `${destination}: cancellation cannot poison a later attempt`);
    const delivered = await harness.sendTransfer(destination, next.tabId, false, null, sourceTab, "next-attempt");
    assert.equal(delivered.ok, true, destination);
    assert.deepEqual(harness.operations.removed, [first.tabId], destination);
    assert.equal(harness.operations.created.length, 2, destination);
    assert.ok(harness.operations.sent.some(({ tabId, message }) => tabId === next.tabId && message.type === "PASTE_CONTEXT"), destination);
  }
});

test("near-end reveal is text-free and subsequent delivery never steals focus again", async () => {
  for (const destination of ["claude", "chatgpt", "grok", "gemini", "deepseek"]) {
    const sourceTab = { id: 9, windowId: 1, index: 0 };
    const harness = loadBackgroundForTransferTest({ sourceTab });
    const prepared = await harness.prepare(destination, sourceTab);
    const reveal = await harness.revealDestination(destination, prepared.tabId, sourceTab);
    assert.equal(reveal.ok, true, destination);
    const progress = harness.operations.sent.find(({ message }) => message.type === "SHOW_TRANSFER_PROGRESS");
    assert.equal(progress.message.phase, "polishing");
    assert.equal(Object.hasOwn(progress.message, "text"), false);
    assert.equal(harness.operations.sent.filter(({ message }) => message.type === "SHOW_TRANSFER_PROGRESS").length, 1,
      "Show the waiting cue once after native activation.");
    assert.equal(harness.operations.updated.length, 1);
    assert.equal(harness.operations.sent.some(({ message }) => message.type === "PASTE_CONTEXT"), false);
    const response = await harness.sendTransfer(destination, prepared.tabId, false, null, sourceTab);
    assert.equal(response.ok, true, destination);
    assert.equal(harness.operations.updated.length, 1, destination + ": no second focus while delivering");
    assert.equal(harness.operations.sent.filter(({ message }) => message.type === "PASTE_CONTEXT").length, 1);
    assert.equal((await harness.activateDestination(destination, prepared.tabId, null, sourceTab)).ok, true);
    assert.equal(harness.operations.updated.length, 1, "Final reveal also respects the earlier switch.");
  }
});

test("early reveal waits for native navigation and document readiness before showing one cue", async () => {
  for (const waitingOn of ["load", "pending navigation", "document"]) {
    const sourceTab = { id: 9, windowId: 1, index: 0 };
    let readinessChecks = 0;
    const harness = loadBackgroundForTransferTest({ sourceTab, sendMessageImpl: async (_tabId, message) => {
      if (message.type === "CHECK_TRANSFER_PROGRESS_READY") {
        readinessChecks++;
        assert.equal(harness.operations.updated.length, 0, "Readiness never focuses the tab.");
        if (waitingOn === "document" && readinessChecks === 1) return { ok: false, code: "destination_loading" };
      }
      if (message.type === "SHOW_TRANSFER_PROGRESS") assert.equal(harness.operations.updated.length, 1);
      return { ok: true };
    } });
    const prepared = await harness.prepare("claude", sourceTab);
    const tab = harness.operations.created[0].tab;
    if (waitingOn === "load") tab.status = "loading";
    if (waitingOn === "pending navigation") tab.pendingUrl = tab.url;
    const reveal = harness.revealDestination("claude", prepared.tabId, sourceTab);
    assert.equal(harness.operations.updated.length, 0);
    setTimeout(() => { tab.status = "complete"; delete tab.pendingUrl; }, 0);
    assert.equal((await reveal).ok, true, waitingOn);
    assert.equal(harness.operations.sent.filter(({ message }) => message.type === "SHOW_TRANSFER_PROGRESS").length, 1);
    assert.ok(readinessChecks >= (waitingOn === "document" ? 2 : 1));
    assert.equal(harness.operations.created.length, 1);
    assert.ok(harness.operations.updated.every(({ options }) => !Object.hasOwn(options, "url")), "Focus never reloads or navigates the destination.");
  }
});

test("ending a pending early reveal prevents later focus without cancelling real delivery", async () => {
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  const harness = loadBackgroundForTransferTest({ sourceTab });
  const prepared = await harness.prepare("claude", sourceTab);
  const tab = harness.operations.created[0].tab;
  tab.status = "loading";
  const reveal = harness.revealDestination("claude", prepared.tabId, sourceTab);
  await new Promise(setImmediate);
  await harness.endProgress(prepared.tabId, sourceTab);
  tab.status = "complete";
  const result = await reveal;
  assert.equal(harness.operations.updated.length, 0, "A finished/failed summary must not trigger a late optional switch.");
  assert.equal(result.revealed, false);
  assert.equal(harness.operations.sent.some(({ message }) => message.type === "SHOW_TRANSFER_PROGRESS"), false);
  assert.equal((await harness.sendTransfer("claude", prepared.tabId, false, null, sourceTab)).ok, true);
  assert.equal(harness.operations.updated.length, 1, "Real delivery keeps its normal activation.");
});

test("stopping an already-submitted activation completes window focus without a second switch", async () => {
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  let acknowledge, submitted, focuses = 0;
  const started = new Promise(resolve => { submitted = resolve; });
  const harness = loadBackgroundForTransferTest({ sourceTab,
    tabUpdateImpl: () => { submitted(); return new Promise(resolve => { acknowledge = resolve; }); },
    windowUpdateImpl: async () => { focuses++; return {}; }
  });
  const prepared = await harness.prepare("claude", sourceTab);
  const reveal = harness.revealDestination("claude", prepared.tabId, sourceTab);
  await started;
  await harness.endProgress(prepared.tabId, sourceTab);
  acknowledge({ id: prepared.tabId, windowId: 1 });
  assert.equal((await reveal).revealed, true);
  assert.equal(focuses, 1, "An acknowledged tab switch must finish its native window focus.");
  assert.equal(harness.operations.sent.some(({ message }) => message.type === "SHOW_TRANSFER_PROGRESS"), false);
  assert.equal((await harness.sendTransfer("claude", prepared.tabId, false, null, sourceTab)).ok, true);
  assert.equal(harness.operations.updated.length, 1);
  assert.equal(focuses, 1);
});

test("navigation during the readiness reply cannot trigger an early switch", async () => {
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  const harness = loadBackgroundForTransferTest({ sourceTab, sendMessageImpl: async (_tabId, message) => {
    if (message.type === "CHECK_TRANSFER_PROGRESS_READY") harness.operations.created[0].tab.url = "https://claude.ai/chat/saved";
    return { ok: true };
  } });
  const prepared = await harness.prepare("claude", sourceTab);
  assert.equal((await harness.revealDestination("claude", prepared.tabId, sourceTab)).ok, false);
  assert.equal(harness.operations.updated.length, 0);
});

test("an early window-focus failure retains ordinary focused-paste recovery", async () => {
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  let focuses = 0;
  const harness = loadBackgroundForTransferTest({ sourceTab, windowUpdateImpl: async () => {
    if (++focuses === 1) throw new Error("Window focus failed");
    return {};
  } });
  const prepared = await harness.prepare("claude", sourceTab);
  assert.equal((await harness.revealDestination("claude", prepared.tabId, sourceTab)).ok, false);
  assert.equal((await harness.sendTransfer("claude", prepared.tabId, false, null, sourceTab)).ok, true);
  assert.equal(focuses, 2);
});

clockTest("a destination that stays loading expires readiness without switching or showing a cue", async () => {
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  const harness = loadBackgroundForTransferTest({ sourceTab, useRealTimers: true });
  const prepared = await harness.prepare("claude", sourceTab);
  harness.operations.created[0].tab.status = "loading";
  assert.equal((await harness.revealDestination("claude", prepared.tabId, sourceTab)).ok, false);
  assert.equal(harness.operations.updated.length, 0);
  assert.equal(harness.operations.sent.some(({ message }) => message.type === "SHOW_TRANSFER_PROGRESS"), false);
});

test("a status failure after switching never causes a second focus during paste", async () => {
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  let progressRequests = 0;
  const harness = loadBackgroundForTransferTest({ sourceTab, sendMessageImpl: async (_tabId, message) => {
    if (message.type === "SHOW_TRANSFER_PROGRESS") { progressRequests++; return { ok: false }; }
    return { ok: true };
  } });
  const prepared = await harness.prepare("claude", sourceTab);
  assert.equal((await harness.revealDestination("claude", prepared.tabId, sourceTab)).ok, false);
  assert.equal(progressRequests, 1);
  assert.equal(harness.operations.updated.length, 1);
  assert.equal((await harness.sendTransfer("claude", prepared.tabId, false, null, sourceTab)).ok, true);
  assert.equal(harness.operations.updated.length, 1);
});

test("early reveal rejects unrelated, navigated and closed destinations", async () => {
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  for (const variant of ["unrelated", "navigated", "closed", "expired"]) {
    const harness = loadBackgroundForTransferTest({ sourceTab });
    const prepared = await harness.prepare("chatgpt", sourceTab);
    const created = harness.operations.created[0].tab;
    if (variant === "navigated") created.url = "https://chatgpt.com/c/saved-chat";
    if (variant === "closed") await harness.closeTab(prepared.tabId);
    const result = await harness.revealDestination("chatgpt",
      variant === "unrelated" ? 999 : prepared.tabId, sourceTab,
      variant === "expired" ? Date.now() - 1 : Date.now() + 10000);
    assert.equal(result.ok, false, variant);
    assert.equal(harness.operations.updated.length, 0, variant);
    assert.equal(harness.operations.sent.some(({ message }) => message.type === "SHOW_TRANSFER_PROGRESS"), false, variant);
  }
});

test("a failed early focus clears its status and retains normal paste recovery", async () => {
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  const harness = loadBackgroundForTransferTest({ sourceTab, updateError: true });
  const prepared = await harness.prepare("claude", sourceTab);
  assert.equal((await harness.revealDestination("claude", prepared.tabId, sourceTab)).ok, false);
  assert.ok(harness.operations.sent.some(({ message }) => message.type === "FINISH_TRANSFER_PROGRESS"));
  assert.equal(harness.operations.sent.some(({ message }) => message.type === "PASTE_CONTEXT"), false);
});

test("focused delivery switches once and never reactivates after verification", async () => {
  for (const [destination, url] of [["claude", "https://claude.ai/new"], ["chatgpt", "https://chatgpt.com/"], ["grok", "https://grok.com/"]]) {
    const harness = loadBackgroundForTransferTest({ preparedTab: { id: 41, url, windowId: 1 } });
    assert.equal((await harness.sendTransfer(destination, 41)).ok, true);
    assert.equal(harness.operations.updated.length, 1);
  }
});

clockTest("activation failure is reported and focused delivery never pastes hidden", async () => {
  const harness = loadBackgroundForTransferTest({
    preparedTab: { id: 41, url: "https://claude.ai/new", windowId: 1 }, updateError: true
  });
  const response = await harness.sendTransfer("claude", 41);
  assert.equal(response.ok, false);
  assert.equal(response.code, "destination_open_failed");
  assert.equal(harness.operations.sent.length, 0);
  const activation = await harness.activateDestination("claude", 41);
  assert.equal(activation.ok, false);
  assert.equal(activation.code, "destination_open_failed");
});

clockTest("a timed-out paste and its late acknowledgement cannot create a duplicate destination", async (t) => {
  let acknowledge, pasteStarted;
  const started = new Promise(resolve => { pasteStarted = resolve; });
  const harness = loadBackgroundForTransferTest({
    preparedTab: { id: 41, url: "https://chat.deepseek.com/" },
    sendMessageImpl: (_tabId, message) => {
      if (message.type !== "PASTE_CONTEXT") return { ok: true };
      pasteStarted();
      return new Promise(resolve => { acknowledge = resolve; });
    },
    useRealTimers: true
  });
  const pending = harness.sendTransfer("deepseek", 41, true);
  await started;
  t.mock.timers.tick(30001);
  assert.equal((await pending).code, "paste_unconfirmed");
  acknowledge({ ok: true });
  await new Promise(setImmediate);
  assert.equal(harness.operations.created.length, 0);
  assert.equal(harness.operations.updated.length, 0);
  assert.equal(harness.operations.sent.length, 1, "a late success cannot trigger another paste");
});

clockTest("unconfirmed paste replies never re-send or fall back to another tab", async () => {
  const sourceTab = { id: 9, windowId: 1, index: 0 };
  for (const reply of [undefined, null, {}, new Error("The message port closed before a response was received"),
    new Error("A listener indicated an asynchronous response by returning true, but the message channel closed before a response was received"),
    new Error("Extension context invalidated")]) {
    const harness = loadBackgroundForTransferTest({
      sourceTab,
      preparedTab: { id: 41, url: "https://chat.deepseek.com/" },
      sendMessageImpl: () => { if (reply instanceof Error) throw reply; return reply; }
    });
    const response = await harness.sendTransfer("deepseek", 41, true, null, sourceTab);
    assert.equal(response.code, "paste_unconfirmed");
    assert.equal(response.diagnostics.error_code, reply instanceof Error ? "message_transport_failed" : reply === undefined ? "message_reply_missing" : "message_reply_invalid");
    assert.equal(response.diagnostics.message_reply, reply instanceof Error ? "transport_failed" : reply === undefined ? "missing" : "invalid");
    assert.equal(harness.operations.created.length, 0);
    assert.equal(harness.operations.injected.length, 0);
    assert.equal(harness.operations.sent.length, 1);
  }
});

test("Claude recovery preserves the rejected prepared page and observes the activated page without extra reads", async () => {
  const harness = loadBackgroundForTransferTest({
    preparedTab: { id: 41, url: "https://claude.ai/new", pendingUrl: "https://claude.ai/chat/PRIVATE?secret=PRIVATE" },
    tabUpdateImpl: async tabId => ({ id: tabId, windowId: 1, url: "https://claude.ai/login?returnTo=PRIVATE" }),
    sendMessageImpl: async (_tabId, message) => message.type === "PASTE_CONTEXT"
      ? { ok: false, diagnostics: { version: 1, error_code: "destination_not_new_chat" } } : { ok: true }
  });
  const response = await harness.sendTransfer("claude", 41);
  assert.equal(response.ok, false);
  assert.equal(response.diagnostics.prepared_diagnostics.claude_page, "claude.ai/chat/:id");
  assert.equal(response.diagnostics.prepared_diagnostics.destination_route_allowed, false);
  assert.equal(response.diagnostics.prepared_diagnostics.destination_platform_match, true);
  assert.equal(response.diagnostics.claude_page, "claude.ai/login");
  assert.equal(response.diagnostics.destination_route_allowed, undefined);
  assert.equal(harness.operations.created.length, 1);
  assert.deepEqual(harness.operations.gotten, [41]);
  assert.doesNotMatch(JSON.stringify(response.diagnostics), /PRIVATE/);
});

clockTest("the first destination draft rejection returns immediately without opening or pasting into another tab", async () => {
  for (const report of [
    { code: "editor_has_draft" },
    { diagnostics: { version: 1, error_code: "editor_has_draft", error_origin: "destination", draft_present: true } }
  ]) {
    const harness = loadBackgroundForTransferTest({ preparedTab: { id: 41, url: "https://claude.ai/new" },
      sendMessageImpl: (_tabId, message) => message.type === "PASTE_CONTEXT" ? { ok: false, ...report } : { ok: true } });
    const response = await harness.sendTransfer("claude", 41);
    assert.equal(response.ok, false);
    assert.equal(response.code, "paste_failed");
    assert.equal(response.diagnostics.error_code, "editor_has_draft");
    assert.equal(response.diagnostics.fresh_recovery, undefined);
    assert.equal(harness.operations.created.length, 0);
    const pastes = harness.operations.sent.filter(({ message }) => message.type === "PASTE_CONTEXT");
    assert.equal(pastes.length, 1);
    assert.equal(pastes[0].tabId, 41);
    assert.equal(harness.operations.errors.length, 0, "an expected draft must not be logged as a crash");
    assert.ok(!harness.operations.badges.includes("ERR"));
  }
});

clockTest("fresh recovery retains the first editor failure alongside the final destination observations", async () => {
  for (const outcome of ["success", "not_retained", "missing_editor"]) {
    const finalOk = outcome === "success";
    const first = { version: 1, error_code: "paste_not_retained", error_origin: "destination", draft_present: false,
      editor_kind: "textarea", editor_text_chars: 42, composer_wait_ms: 10, paste_attempts: 1,
      paste_events: [{ event: "failure", at_ms: 10, code: "paste_not_retained" }] };
    const last = outcome === "missing_editor"
      ? { version: 1, error_code: "editor_missing", error_origin: "destination", editor_seen: false, paste_attempts: 3 }
      : { version: 1, paste_populated: finalOk, editor_seen: true, paste_attempts: 3, draft_present: false,
        ...(finalOk ? {} : { error_code: "paste_not_retained", error_origin: "destination" }) };
    const harness = loadBackgroundForTransferTest({ preparedTab: { id: 41, url: "https://claude.ai/new" },
      sendMessageImpl: (tabId, message) => message.type !== "PASTE_CONTEXT" ? { ok: true } : tabId === 41
        ? { ok: false, error: "PRIVATE first error", diagnostics: first }
        : { ok: finalOk, error: "PRIVATE final error", diagnostics: last } });
    const response = await harness.sendTransfer("claude", 41);
    assert.equal(response.ok, finalOk);
    assert.deepEqual(JSON.parse(JSON.stringify(response.diagnostics.prepared_diagnostics)), first);
    assert.equal(response.diagnostics.recovery_error_code, "paste_not_retained");
    assert.equal(response.diagnostics.fresh_recovery, true);
    for (const key of ["paste_populated", "draft_present", "editor_seen", "editor_kind", "editor_text_chars", "composer_wait_ms", "paste_events"]) {
      assert.deepEqual(response.diagnostics[key], last[key], `${outcome}: ${key} must describe only the fresh destination`);
    }
    assert.equal(response.diagnostics.error_code, last.error_code);
    assert.doesNotMatch(JSON.stringify(response.diagnostics), /PRIVATE/);
    assert.equal(harness.operations.created.length, 1);
  }
});

// Error paths leave a five-second badge timer; scoped clocks also clean it up after these cases.
clockTest("expired transfer messages cannot fetch summaries, open tabs, paste or activate destinations", async () => {
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
  const { errors, badges, ...transferOperations } = harness.operations;
  assert.deepEqual(transferOperations, { cancellationOrder: [], created: [], gotten: [], sent: [], updated: [], injected: [], fetched: [], removed: [] });
  assert.equal(errors[0][1].code, "transfer_timeout", "real failures must still be logged");
  assert.ok(badges.includes("ERR"));
});

clockTest("a transfer deadline aborts an outstanding summary request", { timeout: 2000 }, async () => {
  let signal, abortedAt;
  const sendSummary = loadBackgroundForSummaryTest(async (_url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => {
        abortedAt = Date.now();
        reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
      }, { once: true });
    });
  });
  const deadlineAt = Date.now() + 100;
  const response = await sendSummary("captured conversation", deadlineAt);
  assert.equal(signal.aborted, true);
  assert.equal(abortedAt, deadlineAt, "the request must abort exactly at the transfer deadline");
  assert.equal(response.ok, false);
  assert.equal(response.code, "transfer_timeout");
});

clockTest("a shared summary waiter expires at its own deadline without cancelling the original request", async () => {
  let finish, signal, fetches = 0;
  const sendSummary = loadBackgroundForSummaryTest(async (_url, options) => {
    fetches++; signal = options.signal;
    return new Promise(resolve => {
      let timer;
      finish = () => { clearTimeout(timer); resolve({ ok: true, status: 200,
        json: async () => ({ summary: "Shared complete Context Carry" }) }); };
      timer = setTimeout(finish, 250);
    });
  });
  const owner = sendSummary("same exact conversation", Date.now() + 1000);
  await new Promise(setImmediate);
  const unboundedWaiter = sendSummary("same exact conversation");
  const deadlineAt = Date.now() + 100;
  const response = await sendSummary("same exact conversation", deadlineAt);
  assert.equal(Date.now(), deadlineAt, "Joining an older request must retain the joining transfer's time limit.");
  assert.equal(response.ok, false);
  assert.equal(response.code, "transfer_timeout");
  assert.equal(signal.aborted, false, "A waiting transfer cannot cancel another transfer's request.");
  const laterWaiter = sendSummary("same exact conversation", Date.now() + 500);
  finish();
  for (const result of await Promise.all([owner, unboundedWaiter, laterWaiter])) {
    assert.equal(result.ok, true);
    assert.equal(result.summary, "Shared complete Context Carry");
  }
  assert.equal(fetches, 1, "Expiry must not evict the still-running shared request.");
  const cached = await sendSummary("same exact conversation", Date.now() + 500);
  assert.equal(cached.timing.source, "cache");
  assert.equal(fetches, 1);
});

clockTest("shared summary failures retain the backend error and allow a fresh request", async () => {
  let finish, fetches = 0;
  const sendSummary = loadBackgroundForSummaryTest(async () => {
    if (++fetches > 1) return { ok: true, status: 200, json: async () => ({ summary: "Fresh Context Carry" }) };
    return new Promise(resolve => { finish = () => resolve({ ok: false, status: 503,
      json: async () => ({ code: "service_busy" }) }); });
  });
  const owner = sendSummary("same exact conversation", Date.now() + 1000);
  await new Promise(setImmediate);
  const waiter = sendSummary("same exact conversation", Date.now() + 500);
  finish();
  for (const response of await Promise.all([owner, waiter])) {
    assert.equal(response.ok, false);
    assert.equal(response.code, "service_busy");
  }
  assert.equal((await sendSummary("same exact conversation", Date.now() + 500)).summary, "Fresh Context Carry");
  assert.equal(fetches, 2);
});

test("summary errors after HTTP 200 retain service origin and closed provider evidence", async () => {
  const sendSummary = loadBackgroundForSummaryTest(async () => ({ ok: true, status: 200, json: async () => ({
    ok: false, code: "summary_failed", status: 502, error: "PRIVATE provider body",
    diagnostics: { version: 1, summary_failed_provider: "gemini", summary_provider_status: 429, summary_failure_detail: "provider_http_error" }
  }) }));
  const response = await sendSummary("Complete captured conversation");
  assert.equal(response.ok, false);
  assert.equal(response.diagnostics.error_origin, "summary_service");
  assert.equal(response.diagnostics.summary_http_status, 200);
  assert.equal(response.diagnostics.summary_provider_status, 429);
  assert.equal(response.diagnostics.summary_failure_detail, "provider_http_error");
  assert.doesNotMatch(JSON.stringify(response.diagnostics), /PRIVATE|body/);
});

for (const ok of [true, false]) clockTest(`an expired shared waiter rejects a queued ${ok ? "success" : "failure"} before a delayed timer fires`, async () => {
  let now = Date.now(), finish;
  class QueuedResultClock extends Date { static now() { return now; } }
  const sendSummary = loadBackgroundForSummaryTest(async () => new Promise(resolve => {
    finish = () => resolve({ ok, status: ok ? 200 : 503,
      json: async () => ok ? { summary: "Complete Context Carry" } : { code: "service_busy" } });
  }), { clock: QueuedResultClock });
  const owner = sendSummary("same exact conversation", now + 1000);
  await new Promise(setImmediate);
  const waiter = sendSummary("same exact conversation", now + 100);
  // Advance elapsed time without dispatching timer tasks. Response microtasks
  // can run first on a busy event loop; the acceptance guard must still apply.
  now += 150;
  finish();
  const response = await waiter;
  assert.equal(response.ok, false);
  assert.equal(response.code, "transfer_timeout");
  assert.equal((await owner).ok, ok);
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

test("same-platform saved chats, including pending navigation, never receive a prepared carry", async () => {
  for (const [destination, url] of [
    ["claude", "https://claude.ai/chat/other"], ["chatgpt", "https://chatgpt.com/c/other"],
    ["gemini", "https://gemini.google.com/app/other"], ["grok", "https://grok.com/c/other"],
    ["deepseek", "https://chat.deepseek.com/a/chat/s/other"]
  ]) {
    for (const pending of [false, true]) {
      const harness = loadBackgroundForTransferTest({ preparedTab: {
        id: 41, url: pending ? new URL(url).origin + "/" : url,
        ...(pending ? { pendingUrl: url } : {}), windowId: 1
      } });
      const response = await harness.sendTransfer(destination, 41, true);
      assert.equal(response.ok, true);
      assert.equal(harness.operations.created.length, 1);
      assert.deepEqual(harness.operations.sent.map(({ tabId }) => tabId), [100]);
      assert.equal((await harness.activateDestination(destination, 41)).ok, false);
    }
  }
});

test("prepared-tab recovery opens at most one fresh destination", async () => {
  const harness = loadBackgroundForTransferTest({
    preparedTab: { id: 41, url: "https://chatgpt.com/", windowId: 1 },
    sendMessageImpl: async (tabId) => {
      if (tabId === 41) return { ok: false, error: "Prepared editor unavailable" };
      return { ok: false, error: "Fresh editor unavailable" };
    }
  });

  const response = await harness.sendTransfer("chatgpt", 41);

  assert.equal(response.ok, false);
  assert.equal(harness.operations.created.length, 1);
  assert.deepEqual(harness.operations.sent.map(({ tabId }) => tabId), [41, 100]);
});

test("Claude and ChatGPT focus and settle prepared and fresh composers before paste", async () => {
  for (const [destination, url] of [["claude", "https://claude.ai/new"], ["chatgpt", "https://chatgpt.com/"]]) {
    const harness = loadBackgroundForTransferTest({
      preparedTab: { id: 41, url, windowId: 1 },
      sendMessageImpl: async tabId => {
        assert.ok(harness.operations.updated.some(update => update.tabId === tabId), "focus precedes delivery");
        return { ok: tabId !== 41, error: tabId === 41 ? "Startup editor remounted" : undefined };
      }
    });
    const response = await harness.sendTransfer(destination, 41);
    assert.equal(response.ok, true);
    assert.equal(harness.operations.created.length, 1);
    assert.equal(harness.operations.created[0].options.active, false);
    for (const tabId of [41, 100]) {
      const focusIndex = response.marks.findIndex(mark => mark.label === "tab activate before paste start" && mark.detail.tabId === tabId);
      const settleIndex = response.marks.findIndex((mark, index) => index > focusIndex && mark.label === "tab activation settle done");
      const pasteIndex = response.marks.findIndex(mark => mark.label === "paste message start" && mark.detail.tabId === tabId);
      assert.ok(focusIndex >= 0 && settleIndex > focusIndex && pasteIndex > settleIndex, `${destination}: tab ${tabId}`);
    }
  }
});

test("successful paste defers destination activation until the completion UI finishes", async () => {
  const harness = loadBackgroundForTransferTest({
    preparedTab: { id: 41, url: "https://gemini.google.com/app", windowId: 1 },
    sendMessageImpl: async () => ({ ok: true, timing: { pasteMs: 5 } })
  });

  const response = await harness.sendTransfer("gemini", 41, true);

  assert.equal(response.ok, true);
  assert.equal(response.timing.tabId, 41);
  assert.equal(response.marks.at(-1).label, "final tab activation deferred");
  assert.equal(harness.operations.updated.length, 0);
  assert.equal("showHandoffCompletion" in harness.operations.sent[0].message, false);

  const activation = await harness.activateDestination("gemini", 41);
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

test("backend errors expose bounded known messages and suppress private or malformed bodies", async () => {
  const { backendError } = loadBackgroundForSummaryTest(() => assert.fail("Error formatting must not fetch"));
  for (const [payload, expected] of [
    [{ code: "conversation_too_large", error: "x".repeat(240) }, "x".repeat(240)],
    [{ code: "conversation_too_large", error: "x".repeat(241) }, "This conversation is too large for Cap Context to transfer."],
    [{ code: "rate_limited", error: "PRIVATE_SENTINEL" }, "Too many transfers were started from this network. Wait a moment, then try again."],
    [{ code: "unknown", error: "PRIVATE_SENTINEL" }, "Cap Context could not create the summary. Please try again."],
    [null, "Cap Context could not create the summary. Please try again."]
  ]) {
    const error = await backendError({ status: 429, json: async () => payload, text() { assert.fail("Unread private bodies must stay unread"); } });
    assert.equal(error.message, expected);
    assert.equal(error.status, 429);
    assert.equal(error.summaryServiceFailure, true);
    assert.doesNotMatch(error.message, /PRIVATE_SENTINEL/);
  }
  const malformed = await backendError({ status: 502, json() { throw new Error("PRIVATE_PARSE_SENTINEL"); }, text() { assert.fail("Never read raw provider errors"); } });
  assert.equal(malformed.message, "Cap Context could not create the summary. Please try again.");
  assert.equal(malformed.code, "summary_failed");
  assert.equal(malformed.status, 502);
});

test("structured histories reach the backend once and cache by native boundaries", async () => {
  const requests = [];
  const sendSummary = loadBackgroundForSummaryTest(async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return { ok: true, status: 200, json: async () => ({ summary: `Carry ${requests.length}` }) };
  });
  const conversation = "ChatGPT conversation:\n\nUser: Example\n\nAssistant: quoted";
  const quoted = { platform: "ChatGPT", messages: [{ role: "user", text: "Example\n\nAssistant: quoted" }] };
  const separate = { platform: "ChatGPT", messages: [{ role: "user", text: "Example" }, { role: "assistant", text: "quoted" }] };
  assert.equal((await sendSummary(conversation, null, null, quoted)).summary, "Carry 1");
  assert.equal((await sendSummary(conversation, null, null, quoted)).timing.source, "cache");
  assert.equal((await sendSummary(conversation, null, null, separate)).summary, "Carry 2");
  assert.equal((await sendSummary(conversation)).summary, "Carry 3");
  assert.equal((await sendSummary(JSON.stringify(quoted))).summary, "Carry 4", "Literal JSON in a legacy transcript cannot collide with a structured cache key.");
  assert.deepEqual(requests.slice(0, 2), [quoted, separate]);
  assert.deepEqual(requests[2], { conversation });
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
    const result = await harness.sendMessageWhenReady(41, { type: firstReply === "no response" ? "CONTEXT_GENERATOR_PING" : "PASTE_CONTEXT" }, 1000, "Claude", trace);
    assert.equal(result.ok, true);
    assert.equal(calls, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(harness.operations.injected)), [{ target: { tabId: 41 }, files: ["transfer-diagnostics.js", "platform-content.js"] }]);
    assert.deepEqual(Array.from(trace.marks, mark => mark.label), ["content script inject attempt", "tab ready/message response after inject"]);
    assert.equal(trace.marks.at(-1).detail.attempts, 1);
  });
}

test("a receiver still mounting after successful injection does not repeatedly reinject", async () => {
  let calls = 0;
  const harness = loadBackgroundForTransferTest({ sendMessageImpl: async () => {
    if (++calls < 4) throw new Error("Receiving end does not exist");
    return { ok: true };
  } });
  const response = await harness.sendMessageWhenReady(41, { type: "PASTE_CONTEXT" }, 1000, "Claude");
  assert.equal(response.ok, true);
  assert.equal(harness.operations.injected.length, 1);
});

test("destination messaging stops immediately on a non-retryable failure", async () => {
  const harness = loadBackgroundForTransferTest({ sendMessageImpl: async () => { throw new Error("Tab access denied"); } });
  await assert.rejects(harness.sendMessageWhenReady(41, { type: "PASTE_CONTEXT" }, 1000, "Claude"), error => error.code === "paste_unconfirmed");
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
  assert.deepEqual(claude.map(item => [...item.files]), [["json-capture-metrics-main.js", "claude-fetch-main.js"], ["transfer-diagnostics.js", "json-capture-metrics.js", "claude-json-capture.js"], ["transfer-diagnostics.js", "platform-content.js"]]);
  assert.equal(claude[0].world, "MAIN");
  const chatgpt = injections.filter(item => item.target.tabId === 2);
  assert.deepEqual(chatgpt.map(item => [...item.files]), [["json-capture-metrics-main.js", "chatgpt-fetch-main.js"], ["transfer-diagnostics.js", "json-capture-metrics.js", "chatgpt-json-capture.js"], ["transfer-diagnostics.js", "platform-content.js"]]);
  assert.equal(chatgpt[0].world, "MAIN");
  for (const id of [3, 4, 5]) {
    const platform = injections.filter(item => item.target.tabId === id);
    assert.deepEqual(platform.map(item => [...item.files]), [["json-capture-metrics-main.js", "network-json-data.js", "network-fetch-main.js"], ["transfer-diagnostics.js", "json-capture-metrics.js", "network-json-capture.js"], ["transfer-diagnostics.js", "platform-content.js"]]);
    assert.equal(platform[0].world, "MAIN");
  }
});

test("handoff palette uses USER origin on the sending AI document and removes only its exact CSS", async () => {
  let listener; const cssCalls = [];
  loadBackgroundForSummaryTest(async () => {}, { cssCalls, onMessage: value => { listener = value; } });
  const css = "/* Cap Context handoff test */\n#context-generator-overlay{color:#C8B6E9 !important}";
  for (const host of ["chatgpt.com", "claude.ai", "gemini.google.com", "grok.com", "chat.deepseek.com"]) {
    const sender = { id: "cap-context-test", tab: { id: 7, url: `https://${host}/` }, frameId: 0, documentId: "source-document" };
    const reply = await new Promise(resolve => listener({ type: "PROTECT_HANDOFF_PALETTE", operation: "apply", css, tabId: 999 }, sender, resolve));
    assert.equal(reply.ok, true);
    assert.deepEqual(JSON.parse(JSON.stringify(cssCalls.at(-1))), { operation: "apply", css, origin: "USER", target: { tabId: 7, documentIds: ["source-document"] } });
  }
  const reply = await new Promise(resolve => listener({ type: "PROTECT_HANDOFF_PALETTE", operation: "remove", css },
    { id: "cap-context-test", tab: { id: 7, url: "https://chatgpt.com/" }, frameId: 0 }, resolve));
  assert.equal(reply.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(cssCalls.at(-1))), { operation: "remove", css, origin: "USER", target: { tabId: 7, frameIds: [0] } });
});

test("handoff styling rejects untrusted or oversized requests and reports API failure safely", async () => {
  let listener; const cssCalls = [];
  loadBackgroundForSummaryTest(async () => {}, { cssCalls, cssError: true, onMessage: value => { listener = value; } });
  const css = "/* Cap Context handoff test */\n#context-generator-overlay{color:white !important}";
  const message = { type: "PROTECT_HANDOFF_PALETTE", operation: "apply", css };
  const sender = { id: "cap-context-test", tab: { id: 7, url: "https://chatgpt.com/" }, frameId: 0 };
  for (const invalid of [{}, { ...sender, id: "another-extension" }, { ...sender, frameId: 2 }, { ...sender, tab: { id: 7, url: "https://example.com/" } }]) {
    assert.equal((await new Promise(resolve => listener(message, invalid, resolve))).ok, false);
  }
  assert.equal((await new Promise(resolve => listener({ ...message, css: css + " ".repeat(65536) }, sender, resolve))).ok, false);
  assert.equal(cssCalls.length, 0);
  assert.equal((await new Promise(resolve => listener(message, sender, resolve))).ok, false);
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
  assert.deepEqual([...injections[0].files], ["json-capture-metrics-main.js", "claude-fetch-main.js"]);
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
  assert.deepEqual([...injections[0].files], ["json-capture-metrics-main.js", "chatgpt-fetch-main.js"]);
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
