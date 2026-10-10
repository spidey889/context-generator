const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");

const SOURCE_PATH = path.join(__dirname, "..", "extension", "platform-content.js");
const MANIFEST_PATH = path.join(__dirname, "..", "extension", "manifest.json");
const PLATFORM_CONTENT_SOURCE = fs.readFileSync(SOURCE_PATH, "utf8");
const COMPILED_PLATFORM_CONTENT_SCRIPT = new vm.Script(
  fs.readFileSync(path.join(__dirname, "..", "extension", "transfer-diagnostics.js"), "utf8") + "\n" + PLATFORM_CONTENT_SOURCE,
  { filename: SOURCE_PATH }
);
const virtualSweepTests = [];
const loadedInstances = new Set();

test.after(() => {
  for (const hooks of loadedInstances) hooks.teardownContextGeneratorInstance();
  loadedInstances.clear();
});

function clockTest(name, options, fn) {
  if (typeof options === "function") [fn, options] = [options, {}];
  test(name, { timeout: 5000, ...options }, async (t) => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: Date.now() });
    const existingInstances = new Set(loadedInstances);
    let finished = false;
    const result = Promise.resolve().then(() => fn(t));
    // Attach both handlers immediately so assertion failures cannot go unhandled.
    result.then(() => { finished = true; }, () => { finished = true; });
    try {
      for (let elapsed = 0; !finished && elapsed < 60000; elapsed += 10) {
        await new Promise(setImmediate);
        t.mock.timers.tick(10);
      }
      assert.ok(finished, "operation exceeded 60 seconds of simulated time");
      await result;
    } finally {
      for (const hooks of loadedInstances) {
        if (existingInstances.has(hooks)) continue;
        hooks.teardownContextGeneratorInstance();
        loadedInstances.delete(hooks);
      }
      t.mock.timers.reset();
    }
  });
}

function virtualSweepTest(name, fn) {
  virtualSweepTests.push({ name, fn });
}

let nextOrder = 1;

class FakeElement {
  constructor({ tag = "div", text = "", attrs = {}, rect = null } = {}) {
    this.localName = tag;
    this.textContent = text;
    this.innerText = text;
    this._value = "";
    this.id = attrs.id || "";
    this.className = attrs.class || "";
    this.dataset = {};
    this.isConnected = true;
    this.style = {};
    this.attrs = { ...attrs };
    this.children = [];
    this.parentElement = null;
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollHeight = 0;
    this.clientHeight = 0;
    this.scrollCalls = [];
    this.scrollIntoViewCalls = [];
    this.clicks = 0;
    this.onClick = null;
    this.onScrollIntoView = null;
    this.order = nextOrder;
    nextOrder += 1;
    this.rect = rect || { width: 320, height: 80, top: 0, left: 0, right: 320, bottom: 80 };
  }

  getAttribute(name) {
    return this.attrs[name] ?? null;
  }

  get value() { return this._value; }

  set value(text) {
    this._value = text;
    if (this.localName === "textarea" || this.localName === "input") {
      this.innerText = text;
      this.textContent = text;
    }
    this.onValueSet?.(text);
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name);
  }

  setAttribute(name, value) {
    this.attrs[name] = String(value);
    if (name === "id") this.id = String(value);
    if (name === "class") this.className = String(value);
  }

  removeAttribute(name) {
    delete this.attrs[name];
    if (name === "id") this.id = "";
    if (name === "class") this.className = "";
  }

  matches(selector) {
    return selector
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .some((part) => this.matchesSingle(part));
  }

  matchesSingle(selector) {
    if (selector === "*") return true;
    if (/^[a-z][a-z0-9-]*$/i.test(selector)) return this.localName === selector.toLowerCase();
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) {
      return String(this.className || "").split(/\s+/).includes(selector.slice(1));
    }
    if (selector === "[data-message-author-role]") return this.hasAttribute("data-message-author-role");
    if (selector === "[role='button']") return this.getAttribute("role") === "button";
    if (selector === "[role='main']") return this.getAttribute("role") === "main";
    if (selector.includes("[contenteditable='true']")) return this.attrs.contenteditable === "true";
    const existsMatch = selector.match(/^\[([a-z0-9_-]+)\]$/i);
    if (existsMatch) return this.hasAttribute(existsMatch[1]);

    const attrMatch = selector.match(/^\[([^\]*^=]+)([*^]?=)'([^']+)'(?: i)?\]$/);
    if (attrMatch) {
      const [, attrName, operator, expected] = attrMatch;
      const actual = String(this.getAttribute(attrName) || "");
      if (!operator) return this.hasAttribute(attrName);
      if (operator === "*=") return actual.toLowerCase().includes(expected.toLowerCase());
      if (operator === "^=") return actual.toLowerCase().startsWith(expected.toLowerCase());
      return actual.toLowerCase() === expected.toLowerCase();
    }

    return false;
  }

  closest(selector) {
    let node = this;
    while (node) {
      if (node.matches(selector)) return node;
      node = node.parentElement;
    }
    return null;
  }

  contains(node) {
    return node === this || this.children.some((child) => child.contains(node));
  }

  compareDocumentPosition(other) {
    return this.order > other.order ? 2 : 4;
  }

  cloneNode() {
    return new FakeElement({
      tag: this.localName,
      text: this.textContent,
      attrs: { ...this.attrs },
      rect: { ...this.rect }
    });
  }

  querySelectorAll(selector = "*") {
    const matches = [];
    const visit = (node) => {
      node.children.forEach((child) => {
        if (child.matches(selector)) matches.push(child);
        visit(child);
      });
    };
    visit(this);
    return matches;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  getBoundingClientRect() {
    return this.rect;
  }

  scrollTo(optionsOrX, y) {
    this.scrollCalls.push(optionsOrX);
    if (typeof optionsOrX === "object") {
      this.scrollTop = optionsOrX.top ?? this.scrollTop;
      this.scrollLeft = optionsOrX.left ?? this.scrollLeft;
      return;
    }

    this.scrollLeft = optionsOrX ?? this.scrollLeft;
    this.scrollTop = y ?? this.scrollTop;
  }

  scrollIntoView(options) {
    this.scrollIntoViewCalls.push(options);
    this.onScrollIntoView?.(options, this);
  }

  click() {
    this.clicks += 1;
    this.onClick?.();
  }

  focus() {}

  dispatchEvent() { return true; }

  remove() {}

  appendChild(child) {
    if (child.parentElement) {
      child.parentElement.children = child.parentElement.children.filter((element) => element !== child);
    }
    this.children.push(child);
    child.parentElement = this;
    child.isConnected = this.isConnected;
    return child;
  }

  insertBefore(child, anchor) {
    if (!anchor) return this.appendChild(child);
    if (child === anchor) return child;
    if (anchor.parentElement !== this) throw new Error("The anchor is not a child of this node");
    if (child.parentElement) {
      child.parentElement.children = child.parentElement.children.filter((element) => element !== child);
    }
    this.children.splice(this.children.indexOf(anchor), 0, child);
    child.parentElement = this;
    child.isConnected = this.isConnected;
    return child;
  }

  get nextElementSibling() {
    return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null;
  }

  get previousElementSibling() {
    return this.parentElement?.children[this.parentElement.children.indexOf(this) - 1] || null;
  }
}

class FakeHTMLTextAreaElement {
  static [Symbol.hasInstance](element) {
    return element?.localName === "textarea";
  }
}

class FakeHTMLInputElement {
  static [Symbol.hasInstance](element) {
    return element?.localName === "input";
  }
}

function loadPlatformContent(elements = [], hostname = "chatgpt.com", {
  expectSupported = true,
  pathname = "/",
  search = "",
  visibilityState = "visible",
  innerWidth = 1280,
  innerHeight = 720,
  runtimeSendMessage = async () => ({ ok: true }),
  storageSet = null
} = {}) {
  let hooks = null;
  const sessionValues = new Map();
  const resizeObservers = [];
  const mutationObservers = [];
  const animationFrameCallbacks = [];
  const runtimeMessageListeners = [];
  const documentListeners = new Map();
  const windowListeners = new Map();
  const navigationListeners = new Set();
  const elementsById = new Map();
  class TestResizeObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      resizeObservers.push(this);
    }

    observe(element) {
      this.observed.push(element);
    }

    disconnect() {
      this.observed = [];
    }
  }
  class TestMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      mutationObservers.push(this);
    }

    observe(element, options) {
      this.observed.push({ element, options });
    }

    disconnect() {
      this.observed = [];
    }
  }
  const document = {
    body: new FakeElement({ tag: "body" }),
    readyState: "complete",
    documentElement: new FakeElement({ tag: "html" }),
    activeElement: null,
    visibilityState,
    getElementById: (id) => elementsById.get(id) || null,
    querySelectorAll: (selector = "*") => {
      const isEditorSelector = /contenteditable|textarea|prompt-textarea|grokinput|grok-input|chat-input/i.test(selector);
      return isEditorSelector ? elements.filter((element) => element.matches(selector)) : elements;
    },
    addEventListener: (type, listener) => {
      if (!documentListeners.has(type)) documentListeners.set(type, new Set());
      documentListeners.get(type).add(listener);
    },
    removeEventListener: (type, listener) => documentListeners.get(type)?.delete(listener)
  };
  const window = {
    location: { hostname, pathname, search },
    navigation: {
      addEventListener: (_type, listener) => navigationListeners.add(listener),
      removeEventListener: (_type, listener) => navigationListeners.delete(listener)
    },
    scrollX: 0,
    scrollY: 400,
    __CONTEXT_GENERATOR_TEST_HOOKS__: {
      register(value) {
        hooks = value;
      }
    },
    getComputedStyle: (element) => {
      const className = String(element?.className || "");
      const overflowY = element?.getAttribute?.("data-overflow-y")
        || (className.includes("overflow-y-auto") ? "auto" : "")
        || (className.includes("overflow-y-scroll") ? "scroll" : "")
        || "visible";
      return {
        display: element?.getAttribute?.("data-display") || "block",
        visibility: element?.getAttribute?.("data-visibility") || "visible",
        opacity: element?.getAttribute?.("data-opacity") || "1",
        translate: element?.style?.translate || "none",
        transform: element?.style?.transform || "none",
        transition: element?.style?.transition || "all 0s ease 0s",
        overflowY
      };
    },
    performance: { now: () => 0 },
    addEventListener: (type, listener) => {
      if (!windowListeners.has(type)) windowListeners.set(type, new Set());
      windowListeners.get(type).add(listener);
    },
    removeEventListener: (type, listener) => windowListeners.get(type)?.delete(listener),
    scrollTo: (optionsOrX, y) => {
      if (typeof optionsOrX === "object") {
        window.scrollX = optionsOrX.left ?? window.scrollX;
        window.scrollY = optionsOrX.top ?? window.scrollY;
        return;
      }
      window.scrollX = optionsOrX ?? window.scrollX;
      window.scrollY = y ?? window.scrollY;
    },
    innerHeight,
    innerWidth,
    requestAnimationFrame: (callback) => {
      animationFrameCallbacks.push(callback);
      return animationFrameCallbacks.length;
    },
    cancelAnimationFrame: () => {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };
  Object.defineProperty(window.location, "href", { get: () => `https://${hostname}${window.location.pathname}${window.location.search}` });
  window.sessionStorage = {
    getItem: (key) => sessionValues.get(key) ?? null,
    setItem: (key, value) => sessionValues.set(key, String(value)),
    removeItem: (key) => sessionValues.delete(key)
  };
  const chrome = {
    runtime: {
      onMessage: {
        addListener: (listener) => runtimeMessageListeners.push(listener),
        removeListener: (listener) => {
          const index = runtimeMessageListeners.indexOf(listener);
          if (index >= 0) runtimeMessageListeners.splice(index, 1);
        }
      },
      sendMessage: runtimeSendMessage,
      getURL: (assetPath) => `chrome-extension://test/${assetPath}`
    }
  };
  if (storageSet) chrome.storage = { local: { set: storageSet } };
  const sandbox = {
    TextEncoder,
    console: {
      ...console,
      debug: () => {},
      info: () => {}
    },
    document,
    window,
    getComputedStyle: window.getComputedStyle,
    chrome,
    crypto: webcrypto,
    Element: FakeElement,
    Event: class FakeEvent {
      constructor(type) { this.type = type; }
    },
    InputEvent: class FakeInputEvent {
      constructor(type) { this.type = type; }
    },
    HTMLTextAreaElement: FakeHTMLTextAreaElement,
    HTMLInputElement: FakeHTMLInputElement,
    Node: { DOCUMENT_POSITION_PRECEDING: 2 },
    URLSearchParams,
    URL,
    Date,
    MutationObserver: TestMutationObserver,
    ResizeObserver: TestResizeObserver,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval
  };

  vm.createContext(sandbox);
  COMPILED_PLATFORM_CONTENT_SCRIPT.runInContext(sandbox);
  const decorateHooks = () => {
    assert.ok(hooks, "platform-content test hooks were registered");
    loadedInstances.add(hooks);
    hooks.mutationObservers = mutationObservers;
    hooks.resizeObservers = resizeObservers;
    hooks.window = window;
    hooks.document = document;
    hooks.navigate = (pathname) => {
      navigationListeners.forEach(listener => listener({ destination: { url: `https://${hostname}${pathname}` } }));
      window.location.pathname = pathname;
    };
    hooks.popstate = (pathname) => {
      window.location.pathname = pathname;
      windowListeners.get("popstate")?.forEach(listener => listener({}));
    };
    hooks.animationFrameCallbacks = animationFrameCallbacks;
    hooks.runtimeMessageListeners = runtimeMessageListeners;
    hooks.setVisibility = (state) => {
      document.visibilityState = state;
      documentListeners.get("visibilitychange")?.forEach((listener) => listener());
    };
    hooks.dispatchDocumentEvent = (type, event) => {
      documentListeners.get(type)?.forEach(listener => listener({ type, ...event }));
    };
    hooks.registerElementId = (id, element) => elementsById.set(id, element);
    hooks.reinject = () => {
      window.__contextGeneratorPlatformLoaded = "previous-content-script-version";
      COMPILED_PLATFORM_CONTENT_SCRIPT.runInContext(sandbox);
      decorateHooks();
      return hooks;
    };
  };
  if (expectSupported) {
    decorateHooks();
  }
  return hooks;
}

test("ChatGPT startup excludes ordinary OpenAI pages", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const platformContent = manifest.content_scripts.find((entry) => entry.js.includes("platform-content.js"));
  const analysisContent = manifest.content_scripts.find((entry) => entry.js.includes("analysis-bridge.js"));
  const platformResources = manifest.web_accessible_resources.find((entry) => entry.resources.includes("bubble-icon.png"));
  const matchGroups = [manifest.host_permissions, platformContent.matches, platformResources.matches];

  for (const matches of matchGroups) {
    assert.ok(matches.includes("https://chatgpt.com/*"));
    assert.equal(matches.includes("https://*.chatgpt.com/*"), false);
    assert.equal(matches.includes("https://chat.openai.com/*"), false);
    assert.equal(matches.includes("https://openai.com/*"), false);
    assert.equal(matches.includes("https://*.openai.com/*"), false);
  }

  assert.equal(manifest.permissions.includes("activeTab"), false);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.host_permissions.includes("https://spidey889.github.io/context-generator/analysis*"), false);
  assert.ok(analysisContent.matches.includes("https://spidey889.github.io/context-generator/analysis*"));

  assert.equal(loadPlatformContent([], "openai.com", { expectSupported: false }), null);
  assert.equal(loadPlatformContent([], "www.openai.com", { expectSupported: false }), null);
  assert.equal(loadPlatformContent([], "auth.chat.openai.com", { expectSupported: false }), null);
  assert.ok(loadPlatformContent([], "chat.openai.com"));
});

test("conversation scraping rejects an empty chat", () => {
  const hooks = loadPlatformContent([]);

  assert.throws(
    () => hooks.scrapeConversationText(),
    /Send a message first, then try again\./
  );
});

test("empty chats are rejected before handoff UI or destination preparation", () => {
  const source = fs.readFileSync(SOURCE_PATH, "utf8");
  const pickerStart = source.indexOf("async function startDestinationTransfer(destinationId)");
  const pickerEnd = source.indexOf("function ensureFloatingOverlay()", pickerStart);
  const pickerSource = source.slice(pickerStart, pickerEnd);
  const pickerEmptyGuard = pickerSource.indexOf("getDetectedConversationMessageCount() === 0");

  assert.ok(pickerStart >= 0 && pickerEnd > pickerStart);
  assert.ok(pickerEmptyGuard >= 0, "picker transfer must check for zero real messages");
  assert.ok(pickerSource.indexOf("beginTransferAttempt(destinationId") < pickerEmptyGuard);
  assert.ok(pickerEmptyGuard < pickerSource.indexOf("showOverlay(destinationId)"));
  assert.ok(pickerEmptyGuard < pickerSource.indexOf("prepareDestinationTab(destinationId, trace)"));
  assert.match(pickerSource.slice(pickerEmptyGuard), /showErrorOverlay\(NO_CONVERSATION_ERROR_MESSAGE\)/);

  const flowStart = source.indexOf("async function runContextFlow(");
  const flowEnd = source.indexOf("function showContextTransferFailure(", flowStart);
  const flowSource = source.slice(flowStart, flowEnd);
  const flowEmptyGuard = flowSource.indexOf("getDetectedConversationMessageCount() === 0");

  assert.ok(flowStart >= 0 && flowEnd > flowStart);
  assert.ok(flowEmptyGuard >= 0, "toolbar transfer must check for zero real messages");
  assert.ok(flowSource.indexOf("startTransferTelemetry(transferTrace)") < flowEmptyGuard);
  assert.ok(flowEmptyGuard < flowSource.indexOf("showOverlay(destinationId)"));
  assert.ok(flowEmptyGuard < flowSource.indexOf("prepareDestinationTab(destinationId, transferTrace)"));
  assert.match(flowSource.slice(flowEmptyGuard), /NO_CONVERSATION_ERROR_MESSAGE/);
});

test("telemetry maps failures to the closed non-sensitive reason list", () => {
  const hooks = loadPlatformContent([]);

  assert.equal(hooks.getSafeTelemetryFailureReason({ code: "rate_limited" }, "summary"), "summary_rate_limited");
  assert.equal(hooks.getSafeTelemetryFailureReason({ code: "service_busy" }, "summary"), "summary_service_busy");
  assert.equal(hooks.getSafeTelemetryFailureReason({ code: "client_not_allowed" }, "summary"), "summary_access_denied");
  assert.equal(hooks.getSafeTelemetryFailureReason(new Error("private provider detail"), "capture"), "capture_failed");
  assert.equal(hooks.getSafeTelemetryFailureReason(new Error("private provider detail"), "summary"), "summary_failed");
  assert.equal(hooks.getSafeTelemetryFailureReason({ code: "user_cancelled" }, "summary"), "user_cancelled");
  assert.equal(hooks.getSafeTelemetryFailureReason(new Error("private provider detail"), "paste"), "paste_failed");
});

test("native popovers do not discard a still-visible verified composer", () => {
  for (const hostname of ["claude.ai", "chatgpt.com", "gemini.google.com", "grok.com", "chat.deepseek.com"]) {
    const composer = new FakeElement({ tag: "form" });
    const input = new FakeElement({
      attrs: { contenteditable: "true", role: "textbox" },
      rect: { left: 240, right: 920, top: 620, bottom: 672, width: 680, height: 52 }
    });
    composer.children = [input];
    input.parentElement = composer;
    const hooks = loadPlatformContent([composer, input], hostname);

    assert.equal(hooks.findPlatformInput(), input);
    composer.setAttribute("aria-hidden", "true");
    assert.equal(hooks.findPlatformInput(), input, `${hostname} should retain its visible composer`);

    input.isConnected = false;
    assert.equal(hooks.findPlatformInput(), null, `${hostname} should reject a removed composer`);
  }
});

test("native modal editors cannot replace the verified chat composer", () => {
  for (const hostname of ["claude.ai", "chatgpt.com", "gemini.google.com", "grok.com", "chat.deepseek.com"]) {
    const composer = new FakeElement({ tag: "form" });
    const input = new FakeElement({
      attrs: { contenteditable: "true", role: "textbox" },
      rect: { left: 240, right: 920, top: 620, bottom: 672, width: 680, height: 52 }
    });
    const modal = new FakeElement({ attrs: { role: "dialog" } });
    const modalInput = new FakeElement({
      tag: "textarea",
      attrs: { "data-display": "none", placeholder: "Settings notes" },
      rect: { left: 300, right: 980, top: 560, bottom: 680, width: 680, height: 120 }
    });
    composer.children = [input];
    input.parentElement = composer;
    modal.children = [modalInput];
    modalInput.parentElement = modal;
    const hooks = loadPlatformContent([composer, input, modal, modalInput], hostname);

    assert.equal(hooks.findPlatformInput(), input);
    composer.setAttribute("aria-hidden", "true");
    modalInput.setAttribute("data-display", "block");
    assert.equal(hooks.findPlatformInput(), input, `${hostname} should keep its verified composer`);

    input.isConnected = false;
    assert.equal(hooks.findPlatformInput(), null, `${hostname} should reject the modal editor`);
  }
});

test("destination picker preserves outside page focus on every supported platform", () => {
  const source = fs.readFileSync(SOURCE_PATH, "utf8");
  const sheetStart = source.indexOf("function ensureDestinationSheet()");
  const sheetEnd = source.indexOf("function ensureDestinationSheetBackdrop()", sheetStart);
  const sheetSource = source.slice(sheetStart, sheetEnd);
  const outsideClickStart = sheetSource.indexOf('addOwnedEventListener(document, "click"');
  const outsideClickEnd = sheetSource.indexOf('addOwnedEventListener(document, "keydown"', outsideClickStart);
  const outsideClickSource = sheetSource.slice(outsideClickStart, outsideClickEnd);
  const toggleStart = source.indexOf("function toggleDestinationSheet()");
  const hideEnd = source.indexOf("function releaseDestinationSheetBackdrop()", toggleStart);
  const toggleAndHideSource = source.slice(toggleStart, hideEnd);

  assert.match(sheetSource, /sheet\.setAttribute\("aria-modal", "true"\)/);
  assert.match(sheetSource, /sheet\.setAttribute\("aria-hidden", "true"\)/);
  assert.match(sheetSource, /event\.key !== "Tab"/);
  assert.match(sheetSource, /focusableTiles\[nextIndex\]\.focus/);
  assert.match(
    outsideClickSource,
    /addOwnedEventListener\(document, "click", \(\) => \{\s+if \(!isDestinationSheetOpen\(\)\) return;[\s\S]*?hideDestinationSheet\(\{ restoreFocus: false \}\);\s+\}\)/
  );
  assert.doesNotMatch(outsideClickSource, /currentPlatform|claude|chatgpt|gemini|grok|deepseek/);
  assert.match(sheetSource, /detail\.textContent = "Opening…"/);
  assert.match(sheetSource, /tile\.setAttribute\("aria-disabled", "true"\)/);
  assert.match(toggleAndHideSource, /bubble\.setAttribute\("aria-expanded", "true"\)/);
  assert.match(toggleAndHideSource, /sheet\.focus\?\.\(\{ preventScroll: true \}\)/);
  assert.match(toggleAndHideSource, /document\.activeElement === bubble/);
  assert.doesNotMatch(toggleAndHideSource, /bubble\.focus/);
  assert.match(toggleAndHideSource, /findPlatformInput\(\)\?\.focus\?\.\(\{ preventScroll: true \}\)/);
});

test("page and picker Tab navigation skip both Cap Context orbs", () => {
  const source = fs.readFileSync(SOURCE_PATH, "utf8");
  const buttonStart = source.indexOf("function createFloatingButton()");
  const buttonEnd = source.indexOf("function ensureOnboardingStyles()", buttonStart);
  const buttonSource = source.slice(buttonStart, buttonEnd);

  assert.match(buttonSource, /bubble\.tabIndex = -1/);
  const sheetStart = source.indexOf("function ensureDestinationSheet()");
  const sheetEnd = source.indexOf("function ensureDestinationSheetBackdrop()", sheetStart);
  const sheetSource = source.slice(sheetStart, sheetEnd);
  assert.match(sheetSource, /brandLink\.tabIndex = -1/);
  assert.doesNotMatch(sheetSource, /sheet\.querySelectorAll\("[^"\n]*destination-home-link/);
});

test("destination picker dismissal clears active visuals without focus and preserves handoff glow", () => {
  for (const hostname of ["chatgpt.com", "claude.ai", "gemini.google.com", "grok.com", "chat.deepseek.com"]) {
    const hooks = loadPlatformContent([], hostname);
    const bubble = new FakeElement({ tag: "button", attrs: { id: "context-generator-bubble" } });
    const input = new FakeElement({ attrs: { contenteditable: "true" } });
    let focusCalls = 0;
    bubble.focus = () => { focusCalls++; };
    hooks.registerElementId(bubble.id, bubble);
    hooks.document.activeElement = input;
    for (const preserveBackdrop of [true, false]) {
      bubble.style.filter = "brightness(1.14)";
      bubble.style.transform = "translate3d(0,0,0) scale(0.94)";
      hooks.hideDestinationSheet({ immediate: true, restoreFocus: false, preserveBackdrop });
      assert.equal(bubble.style.filter, preserveBackdrop ? "brightness(1.14)" : "none");
      assert.equal(bubble.style.transform, preserveBackdrop ? "translate3d(0,0,0) scale(0.94)" : "translate3d(0,0,0) scale(1)");
      assert.equal(bubble.getAttribute("aria-expanded"), "false");
      assert.equal(hooks.document.activeElement, input);
      assert.equal(focusCalls, 0);
    }
  }
});

function makePickerFocusFixture(hostname = "chatgpt.com") {
  const composer = new FakeElement({ tag: "form" });
  const input = new FakeElement({ attrs: { contenteditable: "true", role: "textbox" } });
  composer.appendChild(input);
  const hooks = loadPlatformContent([composer, input], hostname);
  assert.equal(hooks.findPlatformInput(), input);
  const bubble = new FakeElement({ tag: "button", attrs: { id: "context-generator-bubble" } });
  const sheet = new FakeElement({ attrs: { id: "context-generator-destination-sheet" } });
  const tile = new FakeElement({ tag: "button" });
  sheet.appendChild(tile);
  sheet.style.display = "block";
  hooks.registerElementId(bubble.id, bubble);
  hooks.registerElementId(sheet.id, sheet);
  hooks.document.activeElement = tile;
  const focusCalls = [];
  for (const node of [input, bubble]) {
    node.focus = () => { focusCalls.push(node); hooks.document.activeElement = node; };
  }
  return { hooks, input, bubble, sheet, tile, focusCalls };
}

clockTest("picker dismissal restores composer through a restarted hide timer without focusing the orb", (t) => {
  for (const hostname of ["chatgpt.com", "claude.ai", "gemini.google.com", "grok.com", "chat.deepseek.com"]) {
    const { hooks, input, sheet, focusCalls } = makePickerFocusFixture(hostname);
    hooks.hideDestinationSheet();
    t.mock.timers.tick(100);
    // A resize restarts the hide animation without requesting focus restoration.
    hooks.hideDestinationSheet({ restoreFocus: false });
    t.mock.timers.tick(99);
    assert.deepEqual(focusCalls, [], `${hostname}: focus waits for the dismissal boundary`);
    t.mock.timers.tick(1);
    assert.equal(sheet.style.display, "block", "the restarted hide animation is still running");
    assert.equal(hooks.document.activeElement, input);
    assert.deepEqual(focusCalls, [input], `${hostname}: only the native composer receives focus`);
    t.mock.timers.tick(100);
    assert.equal(sheet.style.display, "none");
    assert.deepEqual(focusCalls, [input], "the second hide must not restore focus again");
  }
});

clockTest("pending picker dismissal preserves reopened picker and newer page focus", (t) => {
  for (const race of ["reopened picker", "page control"]) {
    const { hooks, bubble, sheet, tile, focusCalls } = makePickerFocusFixture();
    hooks.hideDestinationSheet({ immediate: true });
    const expectedFocus = race === "reopened picker" ? tile : new FakeElement({ tag: "button" });
    if (race === "reopened picker") {
      bubble.setAttribute("aria-expanded", "true");
      sheet.setAttribute("aria-hidden", "false");
      sheet.style.display = "block";
    }
    hooks.document.activeElement = expectedFocus;
    t.mock.timers.tick(0);
    assert.equal(hooks.document.activeElement, expectedFocus, race);
    assert.deepEqual(focusCalls, [], `${race}: neither composer nor orb should steal focus`);
  }
});

test("reinjection tears down every resource owned by the previous content-script instance", () => {
  const input = new FakeElement({
    attrs: { contenteditable: "true", role: "textbox" },
    rect: { left: 160, right: 840, top: 150, bottom: 230, width: 680, height: 80 }
  });
  const composer = new FakeElement({
    rect: { left: 100, right: 1000, top: 100, bottom: 260, width: 900, height: 160 }
  });
  input.parentElement = composer;
  composer.children = [input];
  const previousHooks = loadPlatformContent([input, composer], "claude.ai");

  previousHooks.startFloatingButtonMonitoring();
  previousHooks.delay(10000);

  const activeCounts = previousHooks.getOwnedLifecycleResourceCounts();
  assert.ok(activeCounts.timeouts > 0);
  assert.ok(activeCounts.intervals > 0);
  assert.ok(activeCounts.animationFrames > 0);
  assert.ok(activeCounts.observers > 0);
  assert.ok(activeCounts.eventListeners > 0);
  assert.equal(previousHooks.runtimeMessageListeners.length, 1);

  const currentHooks = previousHooks.reinject();

  assert.notEqual(currentHooks, previousHooks);
  assert.deepEqual(JSON.parse(JSON.stringify(previousHooks.getOwnedLifecycleResourceCounts())), {
    timeouts: 0,
    intervals: 0,
    animationFrames: 0,
    observers: 0,
    eventListeners: 0
  });
  assert.ok(previousHooks.mutationObservers.every((observer) => observer.observed.length === 0));
  assert.ok(previousHooks.resizeObservers.every((observer) => observer.observed.length === 0));
  assert.equal(previousHooks.runtimeMessageListeners.length, 1);
  assert.equal(currentHooks.window.__contextGeneratorPlatformTeardown, currentHooks.teardownContextGeneratorInstance);
});

test("Grok empty-state prompt is not counted or captured as a real message", () => {
  const emptyPrompt = new FakeElement({
    text: "What's on your mind?",
    attrs: { "data-testid": "user-message" }
  });
  const hooks = loadPlatformContent([emptyPrompt], "grok.com");

  assert.equal(hooks.getConversationRole(emptyPrompt), "User");
  assert.equal(hooks.getDetectedConversationMessageCount(), 0);
  assert.throws(
    () => hooks.scrapeConversationText(),
    /Send a message first, then try again\./
  );
});

test("role detection uses structural evidence instead of you or me labels", () => {
  const vagueYouLabel = new FakeElement({
    text: "Account navigation",
    attrs: { "aria-label": "You" }
  });
  const vagueMeLabel = new FakeElement({
    text: "Profile menu",
    attrs: { class: "me menu-item" }
  });
  const deepSeekMarkdown = new FakeElement({
    text: "Keep the exact role from the parent message container.",
    attrs: { class: "ds-markdown" }
  });
  const deepSeekUserContainer = new FakeElement({ attrs: { "data-role": "user" } });
  deepSeekUserContainer.children = [deepSeekMarkdown];
  deepSeekMarkdown.parentElement = deepSeekUserContainer;

  const chatGptHooks = loadPlatformContent([vagueYouLabel, vagueMeLabel]);
  const deepSeekHooks = loadPlatformContent([deepSeekUserContainer, deepSeekMarkdown], "chat.deepseek.com");

  assert.equal(chatGptHooks.getConversationRole(vagueYouLabel), "Message");
  assert.equal(chatGptHooks.getConversationRole(vagueMeLabel), "Message");
  assert.equal(deepSeekHooks.getConversationRole(deepSeekMarkdown), "User");
});

test("handoff finish skips suspended frames in an already hidden source tab", { timeout: 1000 }, async () => {
  const hooks = loadPlatformContent([], "chatgpt.com", { visibilityState: "hidden" });
  hooks.document.querySelector = () => null;
  const before = hooks.getOwnedLifecycleResourceCounts();
  const trace = { startedAt: Date.now(), marks: [] };

  await hooks.completeHandoffForDestinationReveal(trace);

  assert.equal(hooks.animationFrameCallbacks.length, 0);
  assert.deepEqual(hooks.getOwnedLifecycleResourceCounts(), before);
  assert.deepEqual(Array.from(trace.marks, (mark) => mark.label), ["handoff finish start", "handoff finish done"]);
});

test("new-chat routes never bypass empty detection, while saved JSON chats may be unrendered", () => {
  const routes = [
    ["claude.ai", ["/", "/new"], ["/chat/saved"]],
    ["chatgpt.com", ["/", "/g/custom", "/g/project"], ["/c/saved", "/g/project/c/saved", "/g/custom/c/saved/"]],
    ["gemini.google.com", ["/", "/app"], ["/app/saved", "/u/1/app/saved/"]],
    ["grok.com", ["/", "/new"], ["/c/saved/"]],
    ["chat.deepseek.com", ["/", "/a/chat"], ["/a/chat/s/saved/"]]
  ];
  for (const [hostname, newPaths, savedPaths] of routes) {
    for (const pathname of [...newPaths, ...savedPaths]) {
      const hooks = loadPlatformContent([], hostname, { pathname });
      assert.equal(hooks.getDetectedConversationMessageCount(), 0);
      assert.equal(hooks.hasSavedSourceConversation(), savedPaths.includes(pathname), `${hostname}${pathname}`);
    }
  }
});

clockTest("handoff finish has a deadline when visible-source animation frames never fire", { timeout: 1000 }, async () => {
  const hooks = loadPlatformContent([]);
  hooks.document.querySelector = () => null;
  const before = hooks.getOwnedLifecycleResourceCounts();
  const started = Date.now();

  // Deliberately leave every queued frame unfired: the old wait never resolved.
  await hooks.completeHandoffForDestinationReveal();

  assert.equal(Date.now() - started, 120, "the paint fallback must retain its deadline");
  assert.equal(hooks.animationFrameCallbacks.length, 1);
  assert.deepEqual(hooks.getOwnedLifecycleResourceCounts(), before);
});

test("handoff finish resolves when the source becomes hidden between frames", { timeout: 1000 }, async () => {
  const hooks = loadPlatformContent([]);
  hooks.document.querySelector = () => null;
  const before = hooks.getOwnedLifecycleResourceCounts();
  const completion = hooks.completeHandoffForDestinationReveal();
  await new Promise(setImmediate);
  hooks.animationFrameCallbacks.shift()();

  hooks.setVisibility("hidden");
  await completion;

  assert.deepEqual(hooks.getOwnedLifecycleResourceCounts(), before);
});

test("handoff finish keeps the two-frame cue for a visible source and cleans up", { timeout: 1000 }, async () => {
  const hooks = loadPlatformContent([]);
  hooks.document.querySelector = () => null;
  const before = hooks.getOwnedLifecycleResourceCounts();
  const completion = hooks.completeHandoffForDestinationReveal();
  await new Promise(setImmediate);
  hooks.animationFrameCallbacks.shift()();
  hooks.animationFrameCallbacks.shift()();
  await completion;

  assert.deepEqual(hooks.getOwnedLifecycleResourceCounts(), before);
});

test("ChatGPT capture collapses duplicate DOM copies of the same conversation turn", () => {
  const elements = [
    new FakeElement({
      text: "One real request.",
      attrs: { "data-testid": "conversation-turn-1", "data-message-author-role": "user" }
    }),
    new FakeElement({
      text: "One real request.",
      attrs: { "data-testid": "conversation-turn-1", "data-message-author-role": "user" }
    }),
    new FakeElement({
      text: "One real response.",
      attrs: { "data-testid": "conversation-turn-2", "data-message-author-role": "assistant" }
    }),
    new FakeElement({
      text: "One real response.",
      attrs: { "data-testid": "conversation-turn-2", "data-message-author-role": "assistant" }
    })
  ];
  const hooks = loadPlatformContent(elements);

  const transcript = hooks.scrapeConversationText();

  assert.equal((transcript.match(/User: One real request\./g) || []).length, 1);
  assert.equal((transcript.match(/ChatGPT: One real response\./g) || []).length, 1);
});

test("virtual sweep reduces 18 overlapping snapshots and 315 entries to the canonical 38-turn sequence", () => {
  const hooks = loadPlatformContent([], "claude.ai");
  const canonicalTurns = Array.from({ length: 38 }, (_, index) => ({
    role: index % 2 === 0 ? "User" : "Claude",
    text: `Trace-shaped exact turn ${index + 1}.`
  }));
  const starts = [0, 4, 8, 12, 16, 20, 18, 14, 10, 6, 2, 5, 9, 13, 17, 21, 15, 11];
  const snapshots = starts.map((start, index) => {
    const length = index % 2 === 0 ? 18 : 17;
    return canonicalTurns.slice(start, Math.min(38, start + length)).map((turn) => ({ ...turn }));
  });
  const collected = [];

  assert.equal(snapshots.length, 18);
  assert.equal(snapshots.reduce((total, snapshot) => total + snapshot.length, 0), 315);

  snapshots.forEach((snapshot) => hooks.collectRenderedConversationTurns(collected, snapshot));

  assert.equal(collected.length, 38);
  assert.deepEqual(JSON.parse(JSON.stringify(collected)), canonicalTurns);
});

test("final capture safety reduces 315 role-tagged entries to 38 exact role and text identities", () => {
  const elements = Array.from({ length: 315 }, (_, index) => {
    const turnIndex = index % 38;
    return new FakeElement({
      text: `Exact diagnostic turn ${turnIndex + 1}.`,
      attrs: { "data-message-author-role": turnIndex % 2 === 0 ? "user" : "assistant" }
    });
  });
  const hooks = loadPlatformContent(elements, "claude.ai");

  const transcript = hooks.scrapeConversationText();

  assert.equal((transcript.match(/(?:User|Claude): Exact diagnostic turn/g) || []).length, 38);
});

test("conversation scraping never falls back to unrelated main-page text", () => {
  const pageRoot = new FakeElement({
    text: "Settings New chat Upgrade plan Recent conversations Account navigation",
    attrs: { role: "main" }
  });
  const userTurn = new FakeElement({
    text: "Only this user message belongs in the transcript.",
    attrs: { "data-message-author-role": "user" }
  });
  const assistantTurn = new FakeElement({
    text: "Only this assistant response belongs in the transcript.",
    attrs: { "data-message-author-role": "assistant" }
  });
  const hooks = loadPlatformContent([pageRoot, userTurn, assistantTurn]);

  const transcript = hooks.scrapeConversationText();

  assert.doesNotMatch(transcript, /Settings|Upgrade plan|Account navigation/);
  assert.match(transcript, /User: Only this user message belongs/);
  assert.match(transcript, /ChatGPT: Only this assistant response belongs/);
});

test("unverified page-like content fails instead of becoming conversation context", () => {
  const pageRoot = new FakeElement({
    text: "Settings New chat Upgrade plan Recent conversations Account navigation with enough page copy to look substantial.",
    attrs: { role: "main" }
  });
  const hooks = loadPlatformContent([pageRoot]);

  assert.throws(
    () => hooks.scrapeConversationText(),
    /user\/assistant roles could not be verified/
  );
});

test("Claude keeps a 38-turn chat at 38 turns when its DOM exposes 299 message candidates", () => {
  const elements = [];
  let fragmentNumber = 1;

  for (let turnNumber = 1; turnNumber <= 38; turnNumber += 1) {
    const isUser = turnNumber % 2 === 1;
    const wrapper = new FakeElement({
      attrs: { "data-testid": isUser ? "user-message" : "assistant-message" }
    });
    const fragmentCount = isUser ? 0 : (turnNumber === 38 ? 9 : 14);
    const fragments = Array.from({ length: fragmentCount }, () => new FakeElement({
      text: `Rendered assistant fragment ${fragmentNumber++} with unique hidden-candidate detail.`,
      attrs: { class: "font-claude-response" }
    }));

    if (isUser) {
      wrapper.textContent = `Real user turn ${turnNumber}`;
      wrapper.innerText = wrapper.textContent;
    } else {
      wrapper.children = fragments;
      wrapper.textContent = fragments.map((fragment) => fragment.textContent).join("\n");
      wrapper.innerText = wrapper.textContent;
      fragments.forEach((fragment) => {
        fragment.parentElement = wrapper;
      });
    }

    elements.push(wrapper, ...fragments);
  }

  assert.equal(elements.length, 299, "fixture must reproduce the reported DOM-candidate inflation");

  const hooks = loadPlatformContent(elements, "claude.ai");
  const turns = hooks.getConversationTurns();
  const transcript = hooks.scrapeConversationText();

  assert.equal(turns.length, 38);
  assert.equal((transcript.match(/(?:User|Claude):/g) || []).length, 38);
  assert.match(transcript, /User: Real user turn 37/);
  assert.match(transcript, /Rendered assistant fragment 261/);
});

function createVirtualizedChatElements({
  label,
  makeTurn,
  totalTurns = 78,
  windowSize = 12,
  scrollStride = windowSize,
  scrollHeight = 4800,
  stalledScrollsBeforeRender = 0,
  renderDelayMs = 0
}) {
  const elements = [];
  let delayedScrolls = 0;
  let renderedStartIndex = 0;
  const scrollableRoot = new FakeElement({
    text: `Scrollable ${label} chat root`,
    attrs: { role: "main", "data-overflow-y": "auto" }
  });
  scrollableRoot.scrollHeight = scrollHeight;
  scrollableRoot.clientHeight = 600;
  scrollableRoot.scrollTop = 0;
  elements.push(scrollableRoot);

  const renderWindow = (startIndex) => {
    const windowTurns = [];
    for (let index = startIndex + 1; index <= Math.min(totalTurns, startIndex + windowSize); index += 1) {
      const turn = makeTurn(index);
      turn.parentElement = scrollableRoot;
      windowTurns.push(turn);
    }

    scrollableRoot.children = windowTurns;
    scrollableRoot.textContent = windowTurns.map((turn) => turn.textContent).join("\n");
    scrollableRoot.innerText = scrollableRoot.textContent;
    elements.splice(1, elements.length - 1, ...windowTurns);
  };

  const originalScrollTo = scrollableRoot.scrollTo.bind(scrollableRoot);
  scrollableRoot.scrollTo = (...args) => {
    originalScrollTo(...args);
    const startIndex = Math.min(totalTurns - windowSize, Math.floor(scrollableRoot.scrollTop / 360) * scrollStride);
    if (startIndex !== renderedStartIndex && delayedScrolls < stalledScrollsBeforeRender) {
      delayedScrolls += 1;
      return;
    }
    delayedScrolls = 0;
    const applyWindow = () => {
      renderedStartIndex = startIndex;
      renderWindow(startIndex);
    };
    if (renderDelayMs > 0) {
      setTimeout(applyWindow, renderDelayMs);
    } else {
      applyWindow();
    }
  };
  renderWindow(0);

  return { elements, scrollableRoot };
}

virtualSweepTest("transfer capture keeps fuller swept text when the turn count matches the quick capture", async () => {
  const elements = [];
  const scrollableRoot = new FakeElement({
    text: "Scrollable ChatGPT chat root",
    attrs: { role: "main", "data-overflow-y": "auto" }
  });
  scrollableRoot.scrollHeight = 1800;
  scrollableRoot.clientHeight = 600;
  scrollableRoot.scrollTop = 0;
  elements.push(scrollableRoot);

  const userTurn = new FakeElement({
    text: "Explain why equal message counts can still hide a more complete capture.",
    attrs: { "data-message-author-role": "user" }
  });
  const truncatedAnswer = "The sweep answer begins with this stable rendered sentence.";
  const completeAnswer = `${truncatedAnswer} It also includes the details that were cut off during the quick first look.`;
  const assistantTurn = new FakeElement({
    text: truncatedAnswer,
    attrs: { "data-message-author-role": "assistant" }
  });
  userTurn.parentElement = scrollableRoot;
  assistantTurn.parentElement = scrollableRoot;
  scrollableRoot.children = [userTurn, assistantTurn];
  elements.push(userTurn, assistantTurn);

  const updateRootText = () => {
    scrollableRoot.textContent = scrollableRoot.children.map((turn) => turn.textContent).join("\n");
    scrollableRoot.innerText = scrollableRoot.textContent;
  };
  updateRootText();

  const originalScrollTo = scrollableRoot.scrollTo.bind(scrollableRoot);
  scrollableRoot.scrollTo = (...args) => {
    originalScrollTo(...args);
    if (scrollableRoot.scrollTop <= 0) return;
    assistantTurn.textContent = completeAnswer;
    assistantTurn.innerText = completeAnswer;
    updateRootText();
  };

  const hooks = loadPlatformContent(elements, "chatgpt.com");
  const initialTranscript = hooks.scrapeConversationText();
  assert.match(initialTranscript, new RegExp(truncatedAnswer.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(initialTranscript, /details that were cut off/);

  await hooks.prepareSourceForCapture();
  const transcript = await hooks.scrapeConversationTextWhenReady();

  assert.equal((transcript.match(/(?:User|ChatGPT):/g) || []).length, 2);
  assert.match(transcript, /details that were cut off during the quick first look/);
});

clockTest("slow/release: physical scroll movement prevents a premature stale exit on non-Claude chats", async () => {
  const { elements, scrollableRoot } = createVirtualizedChatElements({
    label: "ChatGPT",
    totalTurns: 16,
    windowSize: 8,
    scrollStride: 1,
    scrollHeight: 9000,
    stalledScrollsBeforeRender: 5,
    makeTurn: (index) => new FakeElement({
      text: `Delayed tall-message turn ${index}`,
      attrs: { "data-message-author-role": index % 2 ? "user" : "assistant" }
    })
  });
  let unchangedMoves = 0;
  let longestUnchangedRun = 0;
  const scrollTo = scrollableRoot.scrollTo.bind(scrollableRoot);
  scrollableRoot.scrollTo = (...args) => {
    const previousTop = scrollableRoot.scrollTop;
    const previousText = scrollableRoot.textContent;
    scrollTo(...args);
    unchangedMoves = scrollableRoot.scrollTop > previousTop && scrollableRoot.textContent === previousText
      ? unchangedMoves + 1 : 0;
    longestUnchangedRun = Math.max(longestUnchangedRun, unchangedMoves);
  };
  const hooks = loadPlatformContent(elements, "chatgpt.com");

  await hooks.prepareSourceForCapture();
  const transcript = await hooks.scrapeConversationTextWhenReady();

  assert.ok(longestUnchangedRun >= 5, "fixture must move through five unchanged windows before rendering");
  assert.deepEqual(
    transcript.match(/(?:User|ChatGPT): Delayed tall-message turn \d+/g),
    Array.from({ length: 16 }, (_, index) => `${index % 2 ? "ChatGPT" : "User"}: Delayed tall-message turn ${index + 1}`),
    "every turn must survive in order, without omissions or duplicates"
  );
});

test("paste selects a ready composer when a higher-scoring one is disabled", () => {
  for (const [hostname, unavailableProperty] of [
    ["chatgpt.com", "disabled"],
    ["gemini.google.com", "readOnly"]
  ]) {
    const form = new FakeElement({ tag: "form" });
    const unavailable = new FakeElement({
      tag: "textarea",
      attrs: { placeholder: "Message" },
      rect: { left: 240, right: 920, top: 620, bottom: 672, width: 680, height: 52 }
    });
    unavailable[unavailableProperty] = true;
    form.appendChild(unavailable);
    const ready = new FakeElement({
      tag: "textarea",
      rect: { left: 240, right: 920, top: 610, bottom: 660, width: 680, height: 50 }
    });
    const hooks = loadPlatformContent([form, unavailable, ready], hostname);

    assert.equal(hooks.findPlatformInput(), unavailable);
    assert.equal(hooks.findReadyPlatformInput(), ready, `${hostname} should use the writable composer`);
  }
});

test("paste selects a writable contenteditable when another editor is aria-disabled", () => {
  for (const hostname of ["chatgpt.com", "gemini.google.com"]) {
    const form = new FakeElement({ tag: "form" });
    const unavailable = new FakeElement({
      attrs: { contenteditable: "true", role: "textbox", "aria-disabled": "true" },
      rect: { left: 240, right: 920, top: 620, bottom: 672, width: 680, height: 52 }
    });
    unavailable.isContentEditable = true;
    form.appendChild(unavailable);
    const ready = new FakeElement({
      attrs: { contenteditable: "true", role: "textbox" },
      rect: { left: 240, right: 920, top: 610, bottom: 660, width: 680, height: 50 }
    });
    ready.isContentEditable = true;
    const hooks = loadPlatformContent([form, unavailable, ready], hostname);

    assert.equal(hooks.findPlatformInput(), unavailable);
    assert.equal(hooks.findReadyPlatformInput(), ready, `${hostname} should use the active editor`);
  }
});

test("paste retains a verified composer through a temporary disabled state", () => {
  const form = new FakeElement({ tag: "form" });
  const input = new FakeElement({
    tag: "textarea",
    attrs: { placeholder: "Message" },
    rect: { left: 240, right: 920, top: 620, bottom: 672, width: 680, height: 52 }
  });
  form.appendChild(input);
  const hooks = loadPlatformContent([form, input], "chatgpt.com");

  assert.equal(hooks.findPlatformInput(), input);
  form.setAttribute("aria-hidden", "true");
  input.disabled = true;
  assert.equal(hooks.findReadyPlatformInput(), null);
  input.disabled = false;
  assert.equal(hooks.findReadyPlatformInput(), input);
});

clockTest("Grok fast capture waits for a delayed virtualized window instead of skipping turns", async () => {
  const { elements } = createVirtualizedChatElements({
    label: "Grok delayed render",
    totalTurns: 40,
    windowSize: 8,
    scrollStride: 4,
    scrollHeight: 3600,
    renderDelayMs: 140,
    makeTurn: (index) => new FakeElement({
      text: `Delayed Grok turn ${index}`,
      attrs: { "data-message-author-role": index % 2 ? "user" : "assistant" }
    })
  });
  const hooks = loadPlatformContent(elements, "grok.com");

  await hooks.prepareSourceForCapture();
  const transcript = await hooks.scrapeConversationTextWhenReady();

  assert.equal((transcript.match(/(?:User|Grok): Delayed Grok turn/g) || []).length, 40);
  assert.match(transcript, /User: Delayed Grok turn 1/);
  assert.match(transcript, /Grok: Delayed Grok turn 40/);
});

// This full sweep checks role labels, distinct repeated turns and overlapping
// windows together; separate quick-capture/helper fixtures duplicate that work.
virtualSweepTest("ChatGPT sweep preserves a 40-turn chat with intentionally repeated text", async () => {
  const { elements } = createVirtualizedChatElements({
    label: "ChatGPT",
    totalTurns: 40,
    windowSize: 8,
    scrollStride: 4,
    scrollHeight: 3600,
    makeTurn: (index) => new FakeElement({
      text: index % 2 ? "Repeat this exact request." : "Repeated exact response.",
      attrs: {
        "data-testid": `conversation-turn-${index}`,
        "data-message-author-role": index % 2 ? "user" : "assistant"
      }
    })
  });
  const hooks = loadPlatformContent(elements, "chatgpt.com");

  await hooks.prepareSourceForCapture();
  const transcript = await hooks.scrapeConversationTextWhenReady();

  assert.equal((transcript.match(/User: Repeat this exact request\./g) || []).length, 20);
  assert.equal((transcript.match(/ChatGPT: Repeated exact response\./g) || []).length, 20);
});

clockTest("virtualized capture regressions", { concurrency: true }, async (t) => {
  await Promise.all(virtualSweepTests.map(({ name, fn }) => t.test(name, fn)));
});

test("collapsed conversation previews are expanded before capture", async () => {
  const assistantTurn = new FakeElement({
    text: "Short preview",
    attrs: { class: "font-claude-response" }
  });
  const showMore = new FakeElement({
    tag: "button",
    text: "Show more",
    attrs: { "aria-label": "Show more" }
  });
  showMore.parentElement = assistantTurn;
  assistantTurn.children = [showMore];
  showMore.onClick = () => {
    assistantTurn.textContent = "Full expanded assistant response with the important hidden details.";
    assistantTurn.innerText = assistantTurn.textContent;
    showMore.rect = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
  };

  const hooks = loadPlatformContent([assistantTurn, showMore], "claude.ai");

  assert.equal(await hooks.expandCollapsedConversationContent(), 1);
  const transcript = hooks.scrapeConversationText();

  assert.match(transcript, /Full expanded assistant response with the important hidden details/);
  assert.equal(showMore.clicks, 1);
});

clockTest("Gemini fallback expands text without opening response menus or clicking their actions", async () => {
  const response = new FakeElement({ tag: "model-response", text: "Verified answer" });
  const content = new FakeElement({ tag: "message-content", text: "Verified answer" });
  content.parentElement = response;
  const query = new FakeElement({ tag: "user-query", text: "Short prompt" });
  const showMore = new FakeElement({ tag: "button", text: "Show more" });
  showMore.parentElement = query;
  showMore.onClick = () => { showMore.rect.width = 0; query.innerText = query.textContent = "Full prompt"; };
  const controls = [
    new FakeElement({ tag: "button", attrs: { "aria-label": "Show more", "aria-haspopup": "menu" } }),
    new FakeElement({ tag: "button", attrs: { "aria-label": "Show more options" } }),
    new FakeElement({ tag: "button", attrs: { "aria-label": "Show more", class: "mat-mdc-menu-trigger" } }),
    new FakeElement({ tag: "button", text: "See full response details" })
  ];
  for (const control of controls) control.parentElement = content;
  const menu = new FakeElement({ attrs: { role: "menu" } });
  const action = new FakeElement({ tag: "button", text: "Show more" });
  action.parentElement = menu;
  const hooks = loadPlatformContent([query, response, content, showMore, ...controls, menu, action], "gemini.google.com");
  assert.equal(await hooks.expandCollapsedConversationContent(), 1);
  assert.equal(showMore.clicks, 1);
  assert.ok([...controls, action].every(control => control.clicks === 0));
});

clockTest("Claude and ChatGPT attach expanded pasted content to the owning user turn", async () => {
  const cases = [
    {
      hostname: "claude.ai",
      platformName: "Claude",
      targetOuterAttrs: { "data-testid": "user-message" },
      targetInnerAttrs: {},
      targetInnerTag: "p",
      precedingAttrs: { "data-testid": "user-message" },
      assistantAttrs: { class: "font-claude-response" },
      cardAttrs: { "aria-label": "Pasted Text, pasted, 41 lines" },
      cardPreview: "Collapsed Claude paste preview",
      cardIsStandalone: false,
      cardWrapsCandidate: false,
      rowTextLivesInDescendant: true,
      remountCardAfterClose: true,
      hasBadge: false
    },
    {
      hostname: "chatgpt.com",
      platformName: "ChatGPT",
      targetOuterAttrs: { "data-testid": "conversation-turn-2" },
      targetInnerAttrs: { "data-message-author-role": "user" },
      targetInnerTag: "div",
      precedingAttrs: { "data-message-author-role": "user" },
      assistantAttrs: { "data-message-author-role": "assistant" },
      cardAttrs: { "aria-label": "Pasted content" },
      cardPreview: "Collapsed preview\nPASTED",
      cardIsStandalone: false,
      cardWrapsCandidate: false,
      rowTextLivesInDescendant: false,
      remountCardAfterClose: false,
      hasBadge: true
    }
  ];

  for (const testCase of cases) {
    const virtualRowTexts = Array.from({ length: 6 }, (_, index) => (
      `${testCase.platformName}-PASTE-ROW-${index}-${String(index).repeat(300)}`
    ));
    const fullPayload = virtualRowTexts.join("\n");
    const cardPreview = testCase.cardPreview;
    const targetText = testCase.cardIsStandalone
      ? "Target user message before the paste."
      : `Target user message before the paste.\n${cardPreview}`;
    const precedingUser = new FakeElement({
      text: "Earlier user message that must remain separate.",
      attrs: testCase.precedingAttrs
    });
    const targetOuter = new FakeElement({ text: targetText, attrs: testCase.targetOuterAttrs });
    const targetInner = new FakeElement({
      tag: testCase.targetInnerTag,
      text: targetText,
      attrs: testCase.targetInnerAttrs
    });
    const pastedCard = new FakeElement({
      tag: "button",
      text: cardPreview,
      attrs: testCase.cardAttrs
    });
    const pastedBadge = testCase.hasBadge ? new FakeElement({ text: "PASTED" }) : null;
    const detailPanel = new FakeElement({
      attrs: { role: "dialog" },
      text: "Pasted content\n4.64 KB • 41 lines • Formatting may be inconsistent from source"
    });
    const detailTitle = new FakeElement({ tag: "h2", text: "Pasted content" });
    const virtualList = new FakeElement({
      attrs: { "data-overflow-y": "auto" },
      text: ""
    });
    virtualList.clientHeight = 100;
    virtualList.scrollHeight = 500;
    const virtualRows = virtualRowTexts.map((text, index) => {
      const row = new FakeElement({
        text: testCase.rowTextLivesInDescendant ? "" : text,
        attrs: {
          "data-index": String(index),
          style: `position: absolute; transform: translateY(${index * 100}px)`
        }
      });
      if (testCase.rowTextLivesInDescendant) {
        const content = new FakeElement({ tag: "pre", text });
        row.children = [content];
        content.parentElement = row;
      }
      return row;
    });
    const closeDetail = new FakeElement({
      tag: "button",
      text: "Close",
      attrs: { "aria-label": "Close pasted content" }
    });
    const assistantTurn = new FakeElement({
      text: "Assistant response after the pasted content.",
      attrs: testCase.assistantAttrs
    });
    const hiddenRect = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    const visibleRect = { width: 620, height: 520, top: 80, left: 620, right: 1240, bottom: 600 };

    if (testCase.cardIsStandalone) {
      targetOuter.children = [targetInner];
      targetInner.parentElement = targetOuter;
      targetInner.children = [];
      pastedCard.children = pastedBadge ? [pastedBadge] : [];
    } else if (testCase.cardWrapsCandidate) {
      targetOuter.children = [pastedCard];
      pastedCard.parentElement = targetOuter;
      pastedCard.children = [targetInner];
      targetInner.parentElement = pastedCard;
      targetInner.children = [];
    } else {
      targetOuter.children = [targetInner];
      targetInner.parentElement = targetOuter;
      targetInner.children = [pastedCard];
      pastedCard.parentElement = targetInner;
      pastedCard.children = pastedBadge ? [pastedBadge] : [];
    }
    if (pastedBadge) pastedBadge.parentElement = pastedCard;
    detailPanel.children = [detailTitle, virtualList, closeDetail];
    [detailTitle, virtualList, closeDetail].forEach((element) => {
      element.parentElement = detailPanel;
    });
    virtualRows.forEach((row) => {
      row.parentElement = virtualList;
      row.rect = { ...hiddenRect };
    });
    [detailPanel, detailTitle, virtualList, closeDetail].forEach((element) => {
      element.rect = { ...hiddenRect };
    });
    const renderVirtualRows = (scrollTop) => {
      const firstIndex = Math.min(
        virtualRows.length - 2,
        Math.max(0, Math.floor(Number(scrollTop || 0) / 80))
      );
      virtualRows.forEach((row) => {
        row.rect = { ...hiddenRect };
      });
      virtualList.children = virtualRows.slice(firstIndex, firstIndex + 2);
      virtualList.children.forEach((row) => {
        row.rect = { ...visibleRect };
      });
      virtualList.textContent = virtualList.children.map((row) => row.textContent).join("\n");
      virtualList.innerText = virtualList.textContent;
      detailPanel.textContent = [
        "Pasted content",
        "4.64 KB • 41 lines • Formatting may be inconsistent from source",
        virtualList.textContent,
        "Close"
      ].join("\n");
      detailPanel.innerText = detailPanel.textContent;
    };
    const virtualScrollTo = virtualList.scrollTo.bind(virtualList);
    virtualList.scrollTo = (...args) => {
      virtualScrollTo(...args);
      renderVirtualRows(virtualList.scrollTop);
    };
    pastedCard.onClick = () => {
      [detailPanel, detailTitle, virtualList, closeDetail].forEach((element) => {
        element.rect = { ...visibleRect };
      });
      renderVirtualRows(0);
    };
    const pageElements = [
      precedingUser,
      targetOuter,
      targetInner,
      pastedCard,
      detailPanel,
      detailTitle,
      closeDetail,
      assistantTurn
    ];
    closeDetail.onClick = () => {
      [detailPanel, detailTitle, virtualList, closeDetail, ...virtualRows].forEach((element) => {
        element.rect = { ...hiddenRect };
      });
      if (testCase.remountCardAfterClose) {
        const replacementOuter = new FakeElement({ text: targetText, attrs: testCase.targetOuterAttrs });
        const replacementInner = new FakeElement({
          tag: testCase.targetInnerTag,
          text: targetText,
          attrs: testCase.targetInnerAttrs
        });
        const replacementCard = new FakeElement({
          tag: "button",
          text: cardPreview,
          attrs: testCase.cardAttrs
        });
        replacementOuter.order = targetOuter.order;
        replacementInner.order = targetInner.order;
        replacementCard.order = pastedCard.order;
        replacementOuter.children = [replacementInner];
        replacementInner.parentElement = replacementOuter;
        replacementInner.children = [replacementCard];
        replacementCard.parentElement = replacementInner;
        const targetStart = pageElements.indexOf(targetOuter);
        pageElements.splice(targetStart, 3, replacementOuter, replacementInner, replacementCard);
      }
    };

    const hooks = loadPlatformContent(pageElements, testCase.hostname);

    assert.equal(await hooks.expandCollapsedConversationContent(), 1);
    const transcript = testCase.remountCardAfterClose
      ? hooks.scrapeConversationText()
      : await hooks.scrapeConversationTextWhenReady();
    const earlierIndex = transcript.indexOf("Earlier user message that must remain separate.");
    const targetIndex = transcript.indexOf("Target user message before the paste.");
    const payloadIndex = transcript.indexOf(fullPayload);
    const assistantIndex = transcript.indexOf("Assistant response after the pasted content.");

    assert.ok(earlierIndex >= 0 && earlierIndex < targetIndex);
    assert.ok(targetIndex < payloadIndex && payloadIndex < assistantIndex);
    assert.equal(transcript.split(fullPayload).length - 1, 1);
    assert.equal(transcript.includes(cardPreview), false);
    assert.ok(transcript.length > 1200);
    assert.equal(pastedCard.clicks, 1);
    assert.equal(closeDetail.clicks, 1);
    assert.equal(virtualList.scrollCalls.some((call) => Number(call?.top || 0) > 0), true);

    if (testCase.hostname === "chatgpt.com") {
      for (let transfer = 0; transfer < 2; transfer += 1) {
        await hooks.prepareSourceForCapture();
        const repeatedTranscript = hooks.scrapeConversationText();
        assert.equal(repeatedTranscript.split(fullPayload).length - 1, 1);
      }
      assert.equal(pastedCard.clicks, 3);
      assert.equal(closeDetail.clicks, 3);
    }
  }
});

test("conversation transport preserves the complete middle beyond the old 160k cap", () => {
  const longConversation = [
    "a".repeat(50000),
    "MIDDLE-DETAILS-THAT-MUST-SURVIVE",
    "b".repeat(150000),
    "TAIL-DETAILS"
  ].join("");
  const userTurn = new FakeElement({
    text: longConversation,
    attrs: { "data-message-author-role": "user" }
  });
  const hooks = loadPlatformContent([userTurn]);
  const transported = hooks.scrapeConversationText();

  assert.ok(transported.length > 200000);
  assert.match(transported, /MIDDLE-DETAILS-THAT-MUST-SURVIVE/);
  assert.match(transported, /TAIL-DETAILS$/);
});

clockTest("source capture prep waits until delayed older messages finish loading", async () => {
  const elements = [];
  const scrollableRoot = new FakeElement({ text: "Scrollable chat root" });
  scrollableRoot.scrollHeight = 2200;
  scrollableRoot.clientHeight = 500;
  scrollableRoot.scrollTop = 900;
  elements.push(scrollableRoot);

  for (let index = 21; index <= 24; index += 1) {
    elements.push(new FakeElement({
      text: `Visible message ${index}`,
      attrs: { "data-message-author-role": index % 2 ? "user" : "assistant" }
    }));
  }

  let loadedOlderMessages = false;
  const originalScrollTo = scrollableRoot.scrollTo.bind(scrollableRoot);
  scrollableRoot.scrollTo = (...args) => {
    originalScrollTo(...args);
    if (loadedOlderMessages) return;
    loadedOlderMessages = true;
    setTimeout(() => {
      for (let index = 1; index <= 20; index += 1) {
        elements.push(new FakeElement({
          text: `Older message ${index}`,
          attrs: { "data-message-author-role": index % 2 ? "user" : "assistant" }
        }));
      }
    }, 180);
  };

  const hooks = loadPlatformContent(elements);

  await hooks.prepareSourceForCapture();
  assert.equal(scrollableRoot.scrollTop, 0);
  assert.equal(scrollableRoot.scrollCalls[0].behavior, "instant");
  const transcript = hooks.scrapeConversationText();

  assert.match(transcript, /Older message 1/);
  assert.match(transcript, /Older message 20/);
  assert.match(transcript, /Visible message 24/);
  assert.equal((transcript.match(/(?:Older|Visible) message/g) || []).length, 24);
});

clockTest("source capture prep waits when message characters grow without a new turn", async () => {
  const scrollableRoot = new FakeElement({ text: "Scrollable chat root" });
  scrollableRoot.scrollHeight = 1800;
  scrollableRoot.clientHeight = 500;
  scrollableRoot.scrollTop = 800;

  const assistantTurn = new FakeElement({
    text: "Partial assistant response",
    attrs: { "data-message-author-role": "assistant" }
  });
  const elements = [scrollableRoot, assistantTurn];
  const originalScrollTo = scrollableRoot.scrollTo.bind(scrollableRoot);
  let expanded = false;
  scrollableRoot.scrollTo = (...args) => {
    originalScrollTo(...args);
    if (expanded) return;
    expanded = true;
    setTimeout(() => {
      assistantTurn.textContent = "Partial assistant response plus older loaded details that arrive after the first scroll.";
      assistantTurn.innerText = assistantTurn.textContent;
      scrollableRoot.scrollHeight = 2400;
    }, 180);
  };

  const hooks = loadPlatformContent(elements);

  await hooks.prepareSourceForCapture();
  const transcript = hooks.scrapeConversationText();

  assert.match(transcript, /older loaded details that arrive after the first scroll/);
});

test("expired destination paste leaves the existing draft untouched", async () => {
  const editor = new FakeElement({ tag: "textarea", attrs: { id: "prompt-textarea" } });
  editor.value = "My unsent draft";
  const hooks = loadPlatformContent([editor], "chatgpt.com");
  await assert.rejects(
    hooks.pasteIntoPlatform("late summary", "chatgpt", "expired-transfer", Date.now() - 1),
    error => error.code === "transfer_timeout"
  );
  assert.equal(editor.value, "My unsent draft");
});

clockTest("destination ownership rejects saved chats and navigation during focus", async () => {
  for (const [hostname, destination, otherPath] of [
    ["claude.ai", "claude", "/chat/other"], ["chatgpt.com", "chatgpt", "/c/other"],
    ["gemini.google.com", "gemini", "/app/other"], ["grok.com", "grok", "/c/other"],
    ["chat.deepseek.com", "deepseek", "/a/chat/s/other"]
  ]) {
    const editor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
    const hooks = loadPlatformContent([editor], hostname, { pathname: otherPath });
    await assert.rejects(hooks.pasteIntoPlatform("private carry", destination), /no longer a new chat/);
    assert.equal(editor.value, "");
    hooks.navigate("/");
    editor.onClick = () => { hooks.navigate(otherPath); hooks.navigate("/"); };
    await assert.rejects(hooks.pasteIntoPlatform("private carry", destination), /destination conversation changed/);
    assert.equal(editor.value, "", hostname);
  }
});

clockTest("destination recovery cancels after navigation, including away and back", async () => {
  for (const awayAndBack of [false, true]) {
    const editor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
    const hooks = loadPlatformContent([editor], "claude.ai", { pathname: "/new", visibilityState: "hidden" });
    await hooks.pasteIntoPlatform("private carry", "claude");
    editor.value = "";
    hooks.navigate("/chat/other");
    if (awayAndBack) hooks.navigate("/new");
    hooks.setVisibility("visible");
    await new Promise(resolve => setTimeout(resolve, 1200));
    assert.equal(editor.value, "");
    assert.equal(editor.clicks, 1);
    assert.equal(hooks.getOwnedLifecycleResourceCounts().intervals, 0);
  }
});

clockTest("destination retry permits initial landing redirects but cancels a route change while waiting", async () => {
  for (const changed of [false, true]) {
    const elements = [];
    const hooks = loadPlatformContent(elements, "claude.ai");
    const operation = hooks.pasteIntoPlatform("private carry", "claude");
    const observed = operation.then(() => null, error => error);
    hooks.navigate(changed ? "/chat/other" : "/new");
    const editor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
    elements.push(editor);
    const error = await observed;
    assert.equal(error?.code || null, changed ? "conversation_changed" : null);
    assert.equal(editor.value, changed ? "" : "private carry");
  }
});

clockTest("source DOM sweep rejects another chat instead of returning a mixed transcript", async () => {
  for (const awayAndBack of [false, true]) {
    const root = new FakeElement({ attrs: { role: "main", "data-overflow-y": "auto" } });
    root.scrollHeight = 1300;
    root.clientHeight = 600;
    const a = new FakeElement({ text: "Selected chat A contains a private project question.", attrs: { "data-message-author-role": "user" } });
    const b = new FakeElement({ text: "Unselected chat B contains different private account details.", attrs: { "data-message-author-role": "assistant" } });
    a.parentElement = root;
    root.children = [a];
    const elements = [root, a];
    const hooks = loadPlatformContent(elements, "chatgpt.com", { pathname: "/c/source" });
    hooks.startTransferDeadline(hooks.createTransferTrace("claude", "extension icon"));
    const scroll = root.scrollTo.bind(root);
    root.scrollTo = (...args) => {
      scroll(...args);
      if (root.scrollTop <= 0) return;
      hooks.navigate("/c/other");
      if (awayAndBack) hooks.navigate("/c/source");
      b.parentElement = root;
      root.children = [b];
      elements.splice(1, elements.length - 1, b);
    };
    await assert.rejects(hooks.scrapeConversationTextWhenReady(), error => error.code === "conversation_changed");
    hooks.teardownContextGeneratorInstance();
    assert.equal(hooks.getOwnedLifecycleResourceCounts().intervals, 0);
  }
});

clockTest("source preparation and summary dispatch reject navigation without transmitting text", async () => {
  for (const stage of ["prepare", "summary"]) {
    const messages = [];
    const turn = new FakeElement({ text: "Selected source conversation has a verified user turn.", attrs: { "data-message-author-role": "user" } });
    const hooks = loadPlatformContent([turn], "chatgpt.com", { pathname: "/c/source", runtimeSendMessage: async message => {
      messages.push(message);
      return { ok: true };
    } });
    const trace = hooks.createTransferTrace("claude", "destination tile");
    hooks.startTransferDeadline(trace);
    const change = () => { hooks.popstate("/c/other"); hooks.popstate("/c/source"); };
    if (stage === "prepare") setTimeout(change, 100);
    else change();
    await assert.rejects(stage === "prepare" ? hooks.prepareSourceForCapture() : hooks.summarizeWithBackend("verified source text", trace),
      error => error.code === "conversation_changed");
    assert.equal(messages.length, 0);
    hooks.teardownContextGeneratorInstance();
  }
});

test("opening the destination picker does not scrape or summarize", () => {
  const source = fs.readFileSync(SOURCE_PATH, "utf8");
  const pickerStart = source.indexOf("function toggleDestinationSheet()");
  const pickerEnd = source.indexOf("function warmDestinationConnections()", pickerStart);
  const pickerSource = source.slice(pickerStart, pickerEnd);
  const preconnectEnd = source.indexOf("function getUrlOrigin(", pickerEnd);
  const preconnectSource = source.slice(pickerEnd, preconnectEnd);

  assert.ok(pickerStart >= 0 && pickerEnd > pickerStart && preconnectEnd > pickerEnd);
  assert.doesNotMatch(source, /warmSummary|scheduleWarmSummary|startWarmSummary|ensureWarmSummaryForConversation|conversationFingerprint/);
  assert.doesNotMatch(pickerSource, /scrapeConversation|requestBackendSummary|summarizeWithBackend/);
  assert.match(preconnectSource, /link\.rel = "preconnect"/);
  assert.doesNotMatch(preconnectSource, /conversation|scrape|summar|fetch\(|sendMessage|notifyBackground/);
});

test("latest-run cache receipt preserves original provider metadata", () => {
  const hooks = loadPlatformContent([]);
  const trace = hooks.createTransferTrace("chatgpt", "cache test");
  trace.marks.push({
    label: "summary done",
    deltaMs: 0,
    totalMs: 0,
    detail: {
      chars: 1200,
      background: {
        source: "cache",
        cacheHit: true,
        cacheAgeMs: 1500,
        originalSource: "backend",
        originalSummaryMs: 8200,
        summaryMs: 0,
        chars: 1200,
        backend: {
          inputChars: 24000,
          openrouterMs: 1200,
          openrouterModelsTried: ["inclusionai/ling-3.1-flash"],
          servedBy: "mistral",
          provider: "mistral",
          primaryModel: "inclusionai/ling-3.1-flash",
          model: "ministral-14b-2512",
          modelsTried: ["inclusionai/ling-3.1-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "ministral-14b-2512"],
          mistralModelsTried: ["ministral-14b-2512"],
          fallback: {
            attempted: true,
            used: true,
            servedBy: "mistral",
            model: "ministral-14b-2512",
            reason: "Gemini failed validation"
          },
          usage: { promptTokens: 6000, completionTokens: 800, totalTokens: 6800, cachedTokens: 0 }
        }
      }
    }
  });

  const stats = hooks.buildLatestTransferStats(trace, 50);

  assert.equal(stats.summary.source, "cache");
  assert.equal(stats.summary.cacheHit, true);
  assert.equal(stats.summary.summaryMs, 0);
  assert.equal(stats.summary.originalSummaryMs, 8200);
  assert.equal(stats.summary.servedBy, "mistral");
  assert.equal(stats.summary.model, "ministral-14b-2512");
  assert.equal(stats.summary.openrouterMs, 1200);
  assert.deepEqual(JSON.parse(JSON.stringify(stats.summary.openrouterModelsTried)), ["inclusionai/ling-3.1-flash"]);
  assert.deepEqual(
    JSON.parse(JSON.stringify(stats.summary.modelsTried)),
    ["inclusionai/ling-3.1-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "ministral-14b-2512"]
  );
  assert.equal(stats.summary.fallback.used, true);
  assert.equal(stats.summary.fallback.servedBy, "mistral");
  assert.deepEqual(JSON.parse(JSON.stringify(stats.summary.usage)), {
    promptTokens: 6000,
    completionTokens: 800,
    totalTokens: 6800,
    cachedTokens: 0
  });
});

test("latest-run receipt preserves the exact raw scraped text", () => {
  const hooks = loadPlatformContent([]);
  const exactText = "Claude conversation:\n\nUser: Keep <tags>, & symbols, 'quotes', and line breaks.\n\nClaude: Exactly.";
  const trace = hooks.createTransferTrace("chatgpt", "test");

  hooks.markCaptureDone(trace, exactText);
  const stats = hooks.buildLatestTransferStats(trace, 25);

  assert.equal(stats.rawScrapedText, exactText);
  assert.equal(
    Date.parse(stats.rawScrapedTextExpiresAt) - Date.parse(stats.completedAt),
    24 * 60 * 60 * 1000
  );
});

test("latest-run receipt retains capture exclusions and the JSON fallback reason locally", () => {
  const hooks = loadPlatformContent([]);
  const trace = hooks.createTransferTrace("claude", "test");
  hooks.markCaptureDone(trace, "ChatGPT conversation:\n\nUser: Keep this text.");
  trace.marks.find(mark => mark.label === "capture done").detail.diagnostics = { excludedContentTypes: ["uploads", "media"] };
  trace.marks.push({ ...trace.marks[0], label: "fast capture failed; using normal capture", detail: { jsonFallbackReason: "timeout" } });
  const stats = hooks.buildLatestTransferStats(trace, 25);
  assert.deepEqual(JSON.parse(JSON.stringify(stats.capture.diagnostics)), { excludedContentTypes: ["media", "uploads"], jsonFallbackReason: "timeout" });
  assert.equal(stats.rawScrapedText, trace.rawScrapedText);
});

test("paste verification rejects missing chunks between the old word samples", () => {
  const hooks = loadPlatformContent([]);
  const words = Array.from({ length: 100 }, (_, index) => `detail${index}`);
  const actual = [...words.slice(0, 15), ...words.slice(35)].join(" ");
  // All three old samples survive despite losing twenty consecutive words.
  for (const start of [0, 45, 90]) {
    assert.ok(actual.includes(words.slice(start, start + 10).join(" ")));
  }
  assert.equal(hooks.editorContainsText(new FakeElement({ text: actual }), words.join(" ")), false);
});

test("paste verification accepts whitespace, newline and decorative punctuation changes on every platform", () => {
  const expected = "CONTEXT CARRY - READY TO PASTE\n\nKeep the migration decisions and deployment checklist.\nNext step: verify staging before release.";
  for (const hostname of ["claude.ai", "chatgpt.com", "gemini.google.com", "grok.com", "chat.deepseek.com"]) {
    const hooks = loadPlatformContent([], hostname);
    const editor = new FakeElement({ text: expected.replace(" - ", " ").replace(/\s+/g, "\t \r\n\u00a0 ") });
    assert.equal(hooks.editorContainsText(editor, expected), true, hostname);
  }
});

test("paste verification requires 95 percent of words in order, including repeated words", () => {
  const hooks = loadPlatformContent([]);
  const words = Array.from({ length: 100 }, (_, index) => `detail${index}`);
  const expected = words.join(" ");
  assert.equal(hooks.editorContainsText(new FakeElement({ text: words.slice(5).join(" ") }), expected), true);
  assert.equal(hooks.editorContainsText(new FakeElement({ text: words.slice(6).join(" ") }), expected), false);
  const reordered = [...words.slice(0, 20), ...words.slice(40, 60), ...words.slice(20, 40), ...words.slice(60)];
  assert.equal(hooks.editorContainsText(new FakeElement({ text: reordered.join(" ") }), expected), false);
  const repeated = ["context", ...words.slice(1, 99), "context"];
  assert.equal(hooks.editorContainsText(new FakeElement({ text: repeated.slice(1).join(" ") }), repeated.join(" ")), true);
  assert.equal(hooks.editorContainsText(new FakeElement({ text: "Unrelated input" }), expected), false);
});

clockTest("all destinations accept editor Markdown reformatting without replacing it", async () => {
  const expected = "# Context carry\n\n1. **Keep** the deployment plan and its rollback steps.\n2. Read [the release notes](https://example.test/release/v2) before continuing.\n\n```text\nDeploy only after staging passes and preserve the saved configuration.\n```\n\nReply only: Context loaded. Then wait for the user.";
  const rendered = "Context carry\n\nKeep the deployment plan and its rollback steps.\nRead the release notes before continuing.\n\nDeploy only after staging passes and preserve the saved configuration.\n\nReply only: Context loaded. Then wait for the user.";
  for (const [hostname, destination] of [["claude.ai", "claude"], ["chatgpt.com", "chatgpt"], ["gemini.google.com", "gemini"], ["grok.com", "grok"], ["chat.deepseek.com", "deepseek"]]) {
    const editor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
    editor.onValueSet = () => { editor.onValueSet = null; editor.value = rendered; };
    const hooks = loadPlatformContent([editor], hostname);
    await hooks.pasteIntoPlatform(expected, destination);
    await hooks.pasteIntoPlatform(expected, destination);
    assert.equal(editor.value, rendered, hostname);
    assert.equal(editor.clicks, 1, `${hostname} preserved the already reformatted paste`);
  }
});

clockTest("textarea paste uses the live value rather than stale default text", async () => {
  const summary = "CONTEXT CARRY Preserve the deployment plan.";
  const editor = new FakeElement({ tag: "textarea", text: "An old draft that the user already cleared.", attrs: { placeholder: "Message" } });
  const hooks = loadPlatformContent([editor], "gemini.google.com");
  assert.equal(editor.value, "");
  await hooks.pasteIntoPlatform(summary, "gemini");
  assert.equal(editor.value, summary, "a cleared textarea accepts the first paste");
  // Native textarea child text/defaultValue can outlive edits to its live value.
  editor._value = "";
  editor.innerText = editor.textContent = summary;
  assert.equal(hooks.editorContainsText(editor, summary), false, "default text cannot verify an empty composer");
});

clockTest("initial paste never overwrites a nonempty draft on any destination", async () => {
  const draft = "My unfinished question belongs to me.";
  for (const [hostname, destination] of [["claude.ai", "claude"], ["chatgpt.com", "chatgpt"], ["gemini.google.com", "gemini"], ["grok.com", "grok"], ["chat.deepseek.com", "deepseek"]]) {
    const editor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
    editor.value = draft;
    const hooks = loadPlatformContent([editor], hostname);
    await assert.rejects(hooks.pasteIntoPlatform("CONTEXT CARRY Keep the deployment plan.", destination), /already contains text/);
    assert.equal(editor.value, draft, hostname);
    assert.equal(editor.clicks, 0, hostname);
    editor.value = "";
    editor.onClick = () => { editor.value = draft; };
    await assert.rejects(hooks.pasteIntoPlatform("CONTEXT CARRY Keep the deployment plan.", destination), /already contains text/);
    assert.equal(editor.value, draft, `${hostname} kept the draft restored on focus`);
    assert.equal(editor.clicks, 1, hostname);
  }
});

test("duplicate transfer clicks preserve the running attempt and its telemetry", () => {
  const messages = [];
  const hooks = loadPlatformContent([], "chatgpt.com", { runtimeSendMessage: async message => {
    messages.push(message);
    return { ok: true };
  } });
  const first = hooks.beginTransferAttempt("claude", "destination tile");
  assert.ok(first);
  assert.equal(hooks.beginTransferAttempt("deepseek", "destination tile"), null);
  let response;
  hooks.runtimeMessageListeners[0]({ type: "START_CONTEXT_TRANSFER", destination: "claude" }, {}, result => { response = result; });
  assert.equal(response.ok, false);
  assert.match(response.error, /already running/);
  const telemetry = messages.filter(message => message.type === "RECORD_TRANSFER_TELEMETRY");
  assert.equal(telemetry.length, 1);
  assert.equal(telemetry[0].event.attemptId, first.id);
  assert.equal(first.completed, false);
  hooks.resetRunningFlag();
  assert.ok(hooks.beginTransferAttempt("claude", "extension icon"), "the next real attempt is admitted");
});

test("actual serving models reach progress and terminal telemetry for fallback, cache and local carries", async () => {
  for (const scenario of ["backend", "cache", "tiny", "recovery"]) {
    const messages = [];
    const hooks = loadPlatformContent([], "gemini.google.com", {
      // Reporting must not depend on the optional local Latest Run write.
      storageSet: () => { throw new Error("Storage unavailable"); },
      runtimeSendMessage: async message => {
        messages.push(message);
        if (message.type !== "SUMMARIZE_WITH_BACKEND") return { ok: true };
        if (scenario === "recovery") return { ok: false, code: "summary_failed" };
        return { ok: true, summary: "The final served summary.", timing: {
          source: scenario, backend: { model: "gemini-3.5-flash-lite", primaryModel: "inclusionai/ling-3.1-flash",
            fallback: { used: true, model: "gemini-3.5-flash-lite" } }
        } };
      }
    });
    const trace = hooks.beginTransferAttempt("claude", "test");
    try {
      await hooks.summarizeWithBackend("x".repeat(scenario === "tiny" ? 1200 : 10000), trace);
      hooks.finishTransferTrace(trace);
      const telemetry = messages.filter(message => message.type === "RECORD_TRANSFER_TELEMETRY").map(message => message.event);
      const model = ["tiny", "recovery"].includes(scenario) ? "local-direct" : "gemini-3.5-flash-lite";
      assert.equal(telemetry.find(event => event.lastStage === "summary_completed").reportedModel, model, scenario);
      assert.equal(telemetry.at(-1).status, "succeeded");
      assert.equal(telemetry.at(-1).reportedModel, model, scenario);
      assert.ok(telemetry.filter(event => !["summary_completed", "completed"].includes(event.lastStage))
        .every(event => event.reportedModel === undefined), "An attempted provider must not be reported before a result.");
      for (const event of telemetry) for (const key of ["model", "summary_proof", "summary_confirmed_at"]) assert.equal(event[key], undefined);
    } finally { hooks.resetRunningFlag(); }
  }
});

test("a synchronous local receipt failure cannot swallow terminal telemetry", () => {
  const messages = [];
  const hooks = loadPlatformContent([], "chatgpt.com", {
    storageSet: () => { throw new Error("Storage unavailable"); },
    runtimeSendMessage: async message => { messages.push(message); return { ok: true }; }
  });
  const trace = hooks.beginTransferAttempt("claude", "destination tile");
  assert.doesNotThrow(() => hooks.finishTransferTrace(trace));
  hooks.resetRunningFlag();
  const telemetry = messages.filter(message => message.type === "RECORD_TRANSFER_TELEMETRY");
  assert.deepEqual(telemetry.map(message => message.event.status), ["started", "succeeded"]);
  assert.equal(telemetry[1].event.lastStage, "completed");
  assert.ok(hooks.beginTransferAttempt("claude", "destination tile"));
});

clockTest("paste reacquires a composer replaced by click or focus before writing", async () => {
  for (const action of ["click", "focus"]) {
    const oldEditor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
    const newEditor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
    const elements = [oldEditor];
    let staleWrites = 0;
    oldEditor.onValueSet = () => { staleWrites++; };
    const remount = () => { oldEditor.isConnected = false; elements[0] = newEditor; };
    if (action === "click") oldEditor.onClick = remount;
    else oldEditor.focus = remount;
    const hooks = loadPlatformContent(elements, "claude.ai");
    await hooks.pasteIntoPlatform("CONTEXT CARRY Preserve the complete deployment plan.", "claude");
    assert.equal(staleWrites, 0, action);
    assert.equal(newEditor.value, "CONTEXT CARRY Preserve the complete deployment plan.", action);
  }
});

clockTest("paste cannot report success when final focus replaces the verified composer", async () => {
  const oldEditor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
  const newEditor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
  const elements = [oldEditor];
  let focuses = 0;
  oldEditor.focus = () => {
    if (++focuses === 2) { oldEditor.isConnected = false; elements[0] = newEditor; }
  };
  const hooks = loadPlatformContent(elements, "claude.ai");
  const summary = "CONTEXT CARRY Preserve the complete deployment plan.";
  await hooks.pasteIntoPlatform(summary, "claude");
  assert.equal(newEditor.value, summary);
});

clockTest("Claude verifies a settled paste and preserves a draft restored on remount", async () => {
  const summary = "CONTEXT CARRY Preserve the complete deployment plan.";
  const editor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
  let writes = 0;
  editor.onValueSet = value => {
    if (value !== summary) return;
    hooks.dispatchDocumentEvent("input", { target: editor, isTrusted: true });
    if (++writes === 1) setTimeout(() => { editor.value = ""; }, 20);
  };
  const hooks = loadPlatformContent([editor], "claude.ai");
  const delivered = await hooks.pasteIntoPlatform(summary, "claude");
  assert.equal(editor.value, summary);
  assert.equal(writes, 2, "an insert cleared by the native app is retried before reporting success");
  assert.equal(delivered.diagnostics.editor_last_error_code, "paste_not_retained");
  assert.equal(delivered.diagnostics.paste_populated, true);
  assert.equal(delivered.diagnostics.paste_stable, true);
  assert.ok(delivered.diagnostics.paste_attempts >= 2);

  const oldEditor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
  const draftEditor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
  draftEditor.value = "My saved draft";
  const elements = [oldEditor];
  oldEditor.onClick = () => { oldEditor.isConnected = false; elements[0] = draftEditor; };
  const remountHooks = loadPlatformContent(elements, "claude.ai");
  await assert.rejects(remountHooks.pasteIntoPlatform(summary, "claude"), error => {
    assert.equal(error.diagnostics.error_code, "editor_has_draft");
    assert.equal(error.diagnostics.error_origin, "destination");
    assert.equal(error.diagnostics.draft_present, true);
    assert.ok(error.diagnostics.editor_remounts >= 1);
    assert.doesNotMatch(JSON.stringify(error.diagnostics), /My saved draft|CONTEXT CARRY/);
    return /already contains text/.test(error.message);
  });
  assert.equal(draftEditor.value, "My saved draft");
});

test("paste verification stops using a detached editor after a remount", async () => {
  const hooks = loadPlatformContent([]);
  const detached = new FakeElement({ text: "CONTEXT CARRY READY TO PASTE" });
  detached.isConnected = false;

  assert.equal(await hooks.waitForEditorText(detached, detached.textContent, 1000), false);
});

test("direct and AI ranges use exact captured character boundaries on every platform", async () => {
  for (const hostname of ["claude.ai", "chatgpt.com", "gemini.google.com", "grok.com", "chat.deepseek.com"]) {
    let summaryRequests = 0;
    const hooks = loadPlatformContent([], hostname, {
      runtimeSendMessage: async message => {
        if (message.type === "SUMMARIZE_WITH_BACKEND") {
          summaryRequests++;
          return { ok: true, summary: "AI must never replace this tiny transcript." };
        }
        return { ok: true };
      }
    });
    for (const length of [1, 9999, 350001, 500000]) {
      const transcript = "x".repeat(length);
      const trace = hooks.createTransferTrace("claude", "test");
      let settled = false;
      const pending = hooks.summarizeWithBackend(transcript, trace).then(summary => {
        settled = true;
        return summary;
      });
      await Promise.resolve();
      assert.equal(settled, true, `${hostname}: ${length} characters must finish without a timer or worker wait`);
      const summary = await pending;
      assert.equal(summary, `The conversation below was transferred from another AI chat so you have the context. Treat it as previous chat history and use it to continue with the user here.\n\nConversation history:\n\n${transcript}\n\nNext step:\n\nReply only: "Context loaded. Let's pick up right where you left off." Then wait for the user.`);
      const stats = hooks.buildLatestTransferStats(trace, 1);
      assert.equal(stats.summary.source, "local");
      assert.equal(stats.summary.model, "local-direct");
      assert.equal(stats.summary.profile, "direct");
      assert.equal(stats.summary.fetchMs, 0);
      assert.equal(stats.summary.maxTokens, 0);
      assert.equal(stats.summary.usage.totalTokens, 0);
      assert.equal(stats.summary.modelsTried.length, 0);
      assert.equal(stats.summary.fallback.used, false);
    }
    assert.equal(summaryRequests, 0, hostname);
    for (const transcript of ["x".repeat(10000), "x".repeat(350000), `${" ".repeat(9999)}x`]) {
      assert.equal(await hooks.summarizeWithBackend(transcript), "AI must never replace this tiny transcript.");
    }
    assert.equal(summaryRequests, 3, `${hostname}: both inclusive AI boundaries and untrimmed length use the backend`);
    await assert.rejects(hooks.summarizeWithBackend("x".repeat(500001)), error => {
      assert.equal(error.code, "conversation_too_large");
      assert.match(error.message, /500,000 character limit/);
      return true;
    });
    await assert.rejects(hooks.summarizeWithBackend("tiny", { deadlineAt: Date.now() - 1 }), /Transfer timed out/);
    assert.equal(summaryRequests, 3, `${hostname}: oversized and expired transfers never reach the backend`);
  }
});

clockTest("local and remote handoffs reveal without a cosmetic one-second delay", async () => {
  for (const local of [true, false]) {
    const hooks = loadPlatformContent([]);
    const properties = new Map();
    const stage = new FakeElement();
    stage.style.setProperty = (key, value) => properties.set(key, value);
    hooks.document.querySelector = () => stage;
    const trace = hooks.createTransferTrace("claude", "test");
    trace.marks.push({ label: "summary done", detail: { background: {
      source: local ? "local" : "backend", backend: { profile: local ? "tiny" : "small" }
    } } });
    const startedAt = Date.now();
    await hooks.completeHandoffForDestinationReveal(trace);
    const elapsed = Date.now() - startedAt;
    assert.equal(properties.get("--context-generator-stage-progress-duration"), "0ms");
    assert.ok(elapsed < 250, `local=${local}: ${elapsed} ms`);
  }
});

test("direct text carry works offline and preserves code, Unicode, roles and blank lines exactly", async () => {
  let summaryRequests = 0;
  const hooks = loadPlatformContent([], "chatgpt.com", { runtimeSendMessage: async message => {
    if (message.type === "SUMMARIZE_WITH_BACKEND") summaryRequests++;
    throw new Error("Extension context invalidated");
  } });
  const conversation = "Claude conversation:\n\nUser: Keep this exactly.\r\n\r\nAssistant: 代码 🙂\n```js\n  const path = 'C:\\work';\u00a0 \n```\n\nUser: This quoted label stays here: Assistant: hey\n";
  const trace = hooks.createTransferTrace("claude", "test");
  const summary = await hooks.summarizeWithBackend(conversation, trace);
  assert.equal(summary, `The conversation below was transferred from another AI chat so you have the context. Treat it as previous chat history and use it to continue with the user here.\n\nConversation history:\n\n${conversation}\n\nNext step:\n\nReply only: "Context loaded. Let's pick up right where you left off." Then wait for the user.`);
  assert.equal(summaryRequests, 0);
  assert.equal(hooks.buildLatestTransferStats(trace, 1).summary.fallback.used, false);
});

clockTest("the countdown requests one early reveal with three seconds remaining", (t) => {
  const hooks = loadPlatformContent([]);
  hooks.window.performance.now = () => Date.now();
  const countdown = new FakeElement();
  hooks.registerElementId("context-generator-handoff-countdown", countdown);
  let calls = 0;
  hooks.startHandoffCountdown(20000, () => calls++);
  t.mock.timers.tick(16750);
  assert.equal(calls, 0);
  t.mock.timers.tick(250);
  assert.equal(calls, 1);
  t.mock.timers.tick(2750);
  assert.equal(calls, 1);
  hooks.stopHandoffCountdown();
});

test("early reveal uses the prepared tab once and never carries conversation text", async () => {
  const messages = [];
  const hooks = loadPlatformContent([], "chatgpt.com", { runtimeSendMessage: async message => {
    messages.push(message);
    return { ok: true };
  } });
  const trace = hooks.createTransferTrace("claude", "test");
  trace.destinationId = "claude";
  trace.deadlineAt = Date.now() + 10000;
  const reveal = hooks.createEarlyDestinationReveal(trace, Promise.resolve({ tabId: 41 }));
  reveal.onNearEnd();
  reveal.onNearEnd();
  await reveal.wait();
  reveal.stop();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "REVEAL_DESTINATION_PROGRESS");
  assert.equal(messages[0].tabId, 41);
  assert.equal(Object.hasOwn(messages[0], "text"), false);
  assert.equal(Object.hasOwn(messages[0], "conversation"), false);
  assert.equal(trace.earlyDestinationTabId, 41);
});

test("summary completion, cancellation and teardown cannot trigger a delayed reveal", async () => {
  for (const reason of ["summary", "completed", "cancelled", "expired", "teardown"]) {
    const messages = [];
    const hooks = loadPlatformContent([], "chatgpt.com", { runtimeSendMessage: async message => {
      messages.push(message);
      return { ok: true };
    } });
    const trace = hooks.createTransferTrace("claude", "test");
    let prepare;
    const reveal = hooks.createEarlyDestinationReveal(trace, new Promise(resolve => { prepare = resolve; }));
    reveal.onNearEnd();
    if (reason === "summary") reveal.stop();
    else if (reason === "teardown") hooks.teardownContextGeneratorInstance();
    else trace[reason] = true;
    prepare({ tabId: 41 });
    await reveal.wait();
    assert.equal(messages.length, 0, reason);
  }
});

clockTest("waiting destination cues wait for load and composer, then survive body replacement without redrawing", () => {
  const input = new FakeElement({ tag: "textarea", attrs: { id: "prompt-textarea" } });
  const hooks = loadPlatformContent([input]);
  hooks.document.createElement = () => {
    const node = new FakeElement();
    node.remove = () => { node.isConnected = false; };
    return node;
  };
  hooks.document.getElementById = id => hooks.document.documentElement.children.find(node => node.id === id && node.isConnected) || null;
  hooks.document.body = null;
  let result;
  const message = { type: "SHOW_TRANSFER_PROGRESS", phase: "polishing", destination: "chatgpt",
    transferId: "mount-test", deadlineAt: Date.now() + 10000 };
  const send = message => hooks.runtimeMessageListeners[0](message, {}, response => { result = response; });
  send(message);
  assert.equal(result.code, "destination_loading");
  assert.equal(hooks.document.getElementById("context-generator-destination-status"), null);
  hooks.document.body = new FakeElement({ tag: "body" });
  hooks.document.readyState = "interactive";
  send(message);
  assert.equal(result.code, "destination_loading");
  hooks.document.readyState = "complete";
  input.disabled = true;
  send(message);
  assert.equal(result.code, "destination_loading");
  input.disabled = false;
  send({ ...message, type: "CHECK_TRANSFER_PROGRESS_READY" });
  assert.equal(result.ok, true);
  assert.equal(hooks.document.getElementById("context-generator-destination-status"), null);
  send(message);
  assert.equal(result.ok, true);
  const cue = hooks.document.getElementById("context-generator-destination-status");
  assert.ok(cue);
  assert.equal(cue.textContent, "Polishing your summary…\nIt will be pasted here when it’s ready.");
  hooks.document.body = new FakeElement({ tag: "body" });
  const timers = hooks.getOwnedLifecycleResourceCounts().timeouts;
  send(message);
  assert.equal(result.ok, true);
  assert.equal(hooks.getOwnedLifecycleResourceCounts().timeouts, timers);
  assert.equal(hooks.document.getElementById(cue.id), cue);
  hooks.runtimeMessageListeners[0]({ type: "CANCEL_TRANSFER", transferId: "mount-test" }, {}, () => {});
  assert.equal(cue.isConnected, false);
});

clockTest("waiting destination cues expire and ignore cancellation of another attempt", async () => {
  const input = new FakeElement({ tag: "textarea", attrs: { id: "prompt-textarea" } });
  input.value = "My waiting draft";
  const hooks = loadPlatformContent([input]);
  hooks.document.createElement = () => {
    const node = new FakeElement();
    node.remove = () => { node.isConnected = false; };
    return node;
  };
  hooks.document.getElementById = id => hooks.document.documentElement.children.find(node => node.id === id && node.isConnected) || null;
  const listener = hooks.runtimeMessageListeners[0];
  const message = { type: "SHOW_TRANSFER_PROGRESS", phase: "polishing", destination: "chatgpt",
    transferId: "waiting-test", deadlineAt: Date.now() + 1000 };
  let result;
  listener(message, {}, response => { result = response; });
  assert.equal(result.ok, true);
  const cue = hooks.document.getElementById("context-generator-destination-status");
  assert.equal(cue.textContent, "Polishing your summary…\nIt will be pasted here when it’s ready.");
  assert.equal(input.value, "My waiting draft");
  listener({ type: "CANCEL_TRANSFER", transferId: "another-attempt" }, {}, () => {});
  assert.equal(cue.isConnected, true);
  await hooks.delay(1100);
  assert.equal(cue.isConnected, false);
  assert.equal(input.value, "My waiting draft");
});

clockTest("destination status follows verified insertion and cleans up without submitting", async () => {
  const input = new FakeElement({ tag: "textarea", attrs: { id: "prompt-textarea" } });
  const hooks = loadPlatformContent([input]);
  hooks.document.createElement = () => {
    const node = new FakeElement();
    node.remove = () => { node.isConnected = false; };
    return node;
  };
  hooks.document.getElementById = id => hooks.document.documentElement.children.find(node => node.id === id && node.isConnected) || null;
  hooks.window.performance.getEntriesByType = () => [{ domContentLoadedEventEnd: 42.4 }];
  const listener = hooks.runtimeMessageListeners[0];
  let respond;
  const response = new Promise(resolve => { respond = resolve; });
  assert.equal(listener({ type: "PASTE_CONTEXT", destination: "chatgpt", text: "context ready", deadlineAt: Date.now() + 10000 }, {}, respond), true);
  const cue = hooks.document.getElementById("context-generator-destination-status");
  assert.equal(cue.textContent, "Pasting your context…");
  assert.equal(cue.getAttribute("role"), "status");
  const result = await response;
  assert.equal(result.ok, true);
  assert.equal(result.timing.pageLoadMs, 42);
  assert.equal(typeof result.timing.composerWaitMs, "number");
  assert.match(cue.textContent, /Context ready/);
  assert.equal(input.value, "context ready");
  assert.match(cue.style.cssText, /pointer-events:none/);
  await hooks.delay(3010);
  assert.equal(hooks.document.getElementById("context-generator-destination-status"), null);
});

clockTest("destination status reports failure without overwriting a restored draft", async () => {
  const input = new FakeElement({ tag: "textarea", attrs: { id: "prompt-textarea" } });
  input.value = "My draft";
  const hooks = loadPlatformContent([input]);
  hooks.document.createElement = () => {
    const node = new FakeElement();
    node.remove = () => { node.isConnected = false; };
    return node;
  };
  hooks.document.getElementById = id => hooks.document.documentElement.children.find(node => node.id === id && node.isConnected) || null;
  const result = await new Promise(resolve => hooks.runtimeMessageListeners[0](
    { type: "PASTE_CONTEXT", destination: "chatgpt", text: "carry" }, {}, resolve
  ));
  assert.equal(result.ok, false);
  assert.equal(input.value, "My draft");
  assert.match(hooks.document.getElementById("context-generator-destination-status").textContent, /Couldn’t add context/);
  hooks.teardownContextGeneratorInstance();
  assert.equal(hooks.document.getElementById("context-generator-destination-status"), null);
});

test("captured context survives backend errors, empty replies, and a missing worker locally", async () => {
  const conversation = "User: const path = 'C:\\work';\r\nAssistant: Keep this exact decision.\r\n".repeat(200);
  const cases = [
    async () => ({ ok: false, code: "rate_limited", error: "private service body" }),
    async () => ({ ok: false, code: "service_busy" }),
    async () => ({ ok: false, code: "client_not_allowed" }),
    async () => ({ ok: false, code: "summary_failed" }),
    async () => ({ ok: true, summary: " \n " }),
    async () => null,
    async () => { throw new Error("Extension context invalidated"); }
  ];
  for (const reply of cases) {
    const hooks = loadPlatformContent([], "chatgpt.com", {
      runtimeSendMessage: message => message.type === "SUMMARIZE_WITH_BACKEND" ? reply() : { ok: true }
    });
    const trace = hooks.createTransferTrace("claude", "test");
    const summary = await hooks.summarizeWithBackend(conversation, trace);
    assert.ok(summary.includes(conversation.replace(/\r\n?/g, "\n").trim()
      .split("\n").map(line => `> ${line}`).join("\n")));
    assert.match(summary, /Reply only: "Context loaded/);
    const timing = trace.marks.find(mark => mark.label === "summary done").detail.background;
    assert.equal(timing.source, "local");
    assert.equal(timing.backend.servedBy, "local-direct");
    assert.equal(timing.backend.fallback.used, true);
    assert.doesNotMatch(JSON.stringify(trace), /private service body|Extension context invalidated/);
  }
});

test("local summary recovery retains the capture size boundary before contacting the backend", async () => {
  let requests = 0;
  const hooks = loadPlatformContent([], "chatgpt.com", { runtimeSendMessage: async () => {
    requests++;
    return { ok: true };
  } });
  await assert.rejects(hooks.summarizeWithBackend("x".repeat(500001)), /500,000 character limit/);
  assert.equal(requests, 0);
});

test("source failure telemetry keeps the precise destination observation and never the private message", () => {
  const sent = [];
  const hooks = loadPlatformContent([], "chatgpt.com", { runtimeSendMessage: async message => { sent.push(message); return { ok: true }; } });
  const trace = hooks.beginTransferAttempt("claude", "destination tile");
  hooks.markCaptureDone(trace, "User: café 🙂");
  const error = Object.assign(new Error("PRIVATE editor details"), { code: "paste_failed", diagnostics: {
    version: 1, error_code: "paste_focus_changed", error_origin: "destination", last_operation: "paste_focus",
    editor_seen: true, editor_connected: false, paste_populated: true, paste_events: [{ event: "paste_focus", at_ms: 650 }]
  } });
  hooks.recordTransferFailureDiagnostics(trace, error);
  trace.marks.push({ label: "failed: PRIVATE editor details" });
  hooks.finishTransferTrace(trace, "paste_failed");
  hooks.resetRunningFlag();
  const terminal = sent.filter(message => message.type === "RECORD_TRANSFER_TELEMETRY").at(-1).event;
  assert.equal(terminal.diagnostics.error_code, "paste_focus_changed");
  assert.equal(terminal.diagnostics.error_origin, "destination");
  assert.equal(terminal.diagnostics.capture_bytes, Buffer.byteLength("User: café 🙂"));
  assert.equal(terminal.diagnostics.entry_point, "picker");
  assert.equal(terminal.diagnostics.paste_populated, true);
  assert.equal(terminal.diagnostics.editor_connected, false);
  assert.doesNotMatch(JSON.stringify(terminal), /PRIVATE|café/);
});

clockTest("missing destination editor reports its wait, attempts and observed absence", async () => {
  const hooks = loadPlatformContent([], "claude.ai");
  await assert.rejects(hooks.pasteIntoPlatform("A complete carry", "claude"), error => {
    assert.equal(error.diagnostics.error_code, "editor_missing");
    assert.equal(error.diagnostics.editor_seen, false);
    assert.ok(error.diagnostics.paste_attempts > 1);
    assert.ok(error.diagnostics.paste_ms >= error.diagnostics.paste_retry_limit_ms);
    assert.equal(error.diagnostics.paste_populated, undefined, "absence is not a measured failed insertion");
    return true;
  });
});

clockTest("unconfirmed paste recovery asks to check the destination and retains the full carry", () => {
  const hooks = loadPlatformContent([], "claude.ai");
  const modal = new FakeElement();
  const title = new FakeElement();
  const desc = new FakeElement();
  const text = new FakeElement({ tag: "textarea" });
  for (const [id, element] of [["modal", modal], ["title", title], ["desc", desc], ["text", text]]) {
    hooks.registerElementId(`context-generator-fallback-${id}`, element);
  }
  const summary = "CONTEXT CARRY — READY TO PASTE\nFull private context";
  hooks.showContextTransferFailure({ code: "paste_unconfirmed" }, { stage: "paste", destinationId: "deepseek", summary });
  assert.equal(modal.style.display, "flex");
  assert.equal(title.textContent, "Check your destination tab");
  assert.match(desc.textContent, /Check that tab first/);
  assert.doesNotMatch(desc.textContent, /did not land/);
  assert.equal(text.value, summary);
  assert.equal(hooks.getSafeTelemetryFailureReason({ code: "paste_unconfirmed" }, "paste"), "paste_failed");
});

clockTest("Claude, Gemini, DeepSeek, and Grok restore a draft cleared after the first paste", async () => {
  const summary = "CONTEXT CARRY — READY TO PASTE\n\nImportant project context and next steps.";
  for (const [hostname, destination, hidden] of [
    ["claude.ai", "claude", true],
    ["gemini.google.com", "gemini", true],
    ["chat.deepseek.com", "deepseek", true],
    ["grok.com", "grok", false]
  ]) {
    const editor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
    const hooks = loadPlatformContent([editor], hostname, { visibilityState: hidden ? "hidden" : "visible" });
    await hooks.pasteIntoPlatform(summary, destination);
    assert.equal(editor.value, summary, `${hostname} received the initial paste`);
    hooks.dispatchDocumentEvent("input", { target: editor, isTrusted: false });
    hooks.dispatchDocumentEvent("keydown", { target: editor, key: "ArrowLeft", isTrusted: true });
    hooks.dispatchDocumentEvent("click", { target: new FakeElement({ tag: "button", attrs: { "aria-label": "Attach file" } }), isTrusted: true });
    editor.value = "";
    editor.innerText = "";
    editor.textContent = "";
    if (hidden) {
      assert.equal(editor.clicks, 1, `${hostname} did not delay activation to re-paste`);
      hooks.setVisibility("visible");
    }
    await new Promise((resolve) => setTimeout(resolve, 650));
    assert.equal(editor.value, summary, `${hostname} restored the cleared draft`);
    assert.equal(editor.clicks, 2, `${hostname} retried only once`);
  }
});

clockTest("paste recovery respects trusted Send, clear, Undo and edits", async () => {
  const summary = "CONTEXT CARRY Preserve the deployment plan.";
  for (const [hostname, destination, action] of [
    ["claude.ai", "claude", "enter"], ["chatgpt.com", "chatgpt", "delete"],
    ["gemini.google.com", "gemini", "click"], ["grok.com", "grok", "undo"],
    ["chat.deepseek.com", "deepseek", "edit"], ["gemini.google.com", "gemini", "submit"]
  ]) {
    const editor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
    const form = new FakeElement({ tag: "form" });
    const send = new FakeElement({ tag: "button", attrs: { "aria-label": "Send message" } });
    form.appendChild(editor);
    form.appendChild(send);
    const elements = [editor];
    const hooks = loadPlatformContent(elements, hostname);
    const modal = new FakeElement();
    hooks.registerElementId("context-generator-fallback-modal", modal);
    setTimeout(() => {
      assert.equal(editor.value, summary, `${action}: the user acts on an inserted carry`);
      let activeEditor = editor;
      if (action === "undo") {
        activeEditor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
        activeEditor.value = summary;
        editor.isConnected = false;
        elements[0] = activeEditor;
      }
      const events = {
        enter: ["keydown", { target: editor, key: "Enter" }],
        delete: ["beforeinput", { target: editor, inputType: "deleteContentBackward" }],
        click: ["click", { target: send }],
        undo: ["keydown", { target: activeEditor, key: "z", ctrlKey: true }],
        edit: ["input", { target: editor, inputType: "insertText" }],
        submit: ["submit", { target: form }]
      };
      const [type, event] = events[action];
      hooks.dispatchDocumentEvent(type, { isTrusted: true, ...event });
      editor.value = "";
      activeEditor.value = "";
      if (action === "enter") hooks.navigate("/chat/sent");
      if (action === "click") {
        elements.push(new FakeElement({ text: summary, attrs: { "data-message-author-role": "user" } }));
      }
    }, 100);
    await hooks.pasteIntoPlatform(summary, destination);
    await new Promise(resolve => setTimeout(resolve, 1250));
    assert.equal(editor.value, "", `${hostname}: ${action} stays cleared`);
    assert.equal(elements[0].value, "", `${hostname}: a replacement composer stays cleared`);
    assert.equal(editor.clicks, 1, `${hostname}: no reinsertion`);
    assert.notEqual(modal.style.display, "flex", `${hostname}: no unsolicited copy modal`);
    assert.equal(hooks.getOwnedLifecycleResourceCounts().intervals, 0);
    hooks.teardownContextGeneratorInstance();
  }
});

test("source cancellation releases its lock and prevents late summary or local-carry continuation", async () => {
  const messages = [];
  let finishSummary;
  const hooks = loadPlatformContent([], "claude.ai", { runtimeSendMessage: async message => {
    messages.push(message);
    if (message.type === "SUMMARIZE_WITH_BACKEND") return new Promise(resolve => { finishSummary = resolve; });
    return { ok: true };
  } });
  const trace = hooks.beginTransferAttempt("gemini", "test");
  const pending = hooks.summarizeWithBackend("x".repeat(10000), trace);
  hooks.runtimeMessageListeners[0]({ type: "CANCEL_TRANSFER", transferId: trace.id }, {}, () => {});
  finishSummary({ ok: true, summary: "A late response must not resume this transfer." });
  await assert.rejects(pending, error => error.code === "user_cancelled");
  const telemetry = messages.filter(message => message.type === "RECORD_TRANSFER_TELEMETRY").map(message => message.event);
  assert.equal(telemetry.at(-1).failureReason, "user_cancelled");
  assert.equal(telemetry.at(-1).status, "failed");
  assert.ok(telemetry.every(event => event.lastStage !== "summary_completed"));
  assert.ok(hooks.beginTransferAttempt("gemini", "next attempt"));
  hooks.resetRunningFlag();
});

clockTest("delayed paste recovery stops at its deadline and when same-route history appears", async () => {
  for (const scenario of ["hidden-expiry", "retry-expiry", "history"]) {
    const editor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
    const elements = [editor];
    const hooks = loadPlatformContent(elements, "gemini.google.com", { visibilityState: "hidden" });
    const modal = new FakeElement();
    hooks.registerElementId("context-generator-fallback-modal", modal);
    const deadline = Date.now() + (scenario === "retry-expiry" ? 650 : 900);
    await hooks.pasteIntoPlatform("private carry", "gemini", null, deadline);
    editor.value = "";
    if (scenario === "history") {
      elements.push(new FakeElement({ text: "A new conversation has already started.", attrs: { "data-message-author-role": "user" } }));
    }
    if (scenario === "retry-expiry") {
      editor.onValueSet = () => { editor.onValueSet = null; setTimeout(() => { editor.value = ""; }, 20); };
    }
    if (scenario !== "hidden-expiry") hooks.setVisibility("visible");
    await new Promise(resolve => setTimeout(resolve, 1300));
    assert.equal(editor.value, "", scenario);
    assert.equal(editor.clicks, scenario === "retry-expiry" ? 2 : 1, scenario);
    assert.notEqual(modal.style.display, "flex", scenario);
    assert.equal(hooks.getOwnedLifecycleResourceCounts().intervals, 0, scenario);
    assert.equal(hooks.getOwnedLifecycleResourceCounts().eventListeners, 0, scenario);
    hooks.teardownContextGeneratorInstance();
  }
});

clockTest("delayed paste recovery offers manual copy if the app clears the retry", async () => {
  const summary = "CONTEXT CARRY — READY TO PASTE\n\nImportant project context and next steps.";
  const editor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
  const hooks = loadPlatformContent([editor], "claude.ai", { visibilityState: "hidden" });
  const modal = new FakeElement();
  const copyText = new FakeElement({ tag: "textarea" });
  hooks.registerElementId("context-generator-fallback-modal", modal);
  hooks.registerElementId("context-generator-fallback-text", copyText);
  await hooks.pasteIntoPlatform(summary, "claude");
  editor.value = "";
  editor.innerText = "";
  editor.textContent = "";
  editor.onValueSet = () => {
    editor.onValueSet = null;
    setTimeout(() => { editor.value = ""; }, 20);
  };
  hooks.setVisibility("visible");
  await new Promise((resolve) => setTimeout(resolve, 1250));
  assert.equal(editor.clicks, 2, "only one recovery paste was attempted");
  assert.equal(modal.style.display, "flex");
  assert.equal(copyText.value, summary, "the full summary stays available to copy");
});

clockTest("a closed source blocks destination insertion before any editor action", async () => {
  const editor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
  const hooks = loadPlatformContent([editor], "gemini.google.com", {
    runtimeSendMessage: async message => message.type === "CHECK_TRANSFER_ACTIVE"
      ? { ok: false, code: "user_cancelled", error: "Source closed" } : { ok: true }
  });
  await assert.rejects(hooks.pasteIntoPlatform("private carry", "gemini", "cancel-test", null, 9), error => error.code === "user_cancelled");
  assert.equal(editor.value, "");
  assert.equal(editor.clicks, 0);
  assert.equal(hooks.getOwnedLifecycleResourceCounts().eventListeners, 0);
});

clockTest("transfer cancellation during editor focus cannot insert or retry text", async () => {
  const editor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
  const hooks = loadPlatformContent([editor], "gemini.google.com");
  editor.focus = () => hooks.runtimeMessageListeners[0]({ type: "CANCEL_TRANSFER", transferId: "cancel-test" }, {}, () => {});
  await assert.rejects(hooks.pasteIntoPlatform("private carry", "gemini", "cancel-test"), error => error.code === "user_cancelled");
  assert.equal(editor.value, "");
  assert.equal(editor.clicks, 1);
});

clockTest("cancelled or missing sources cannot restore a cleared paste or show a copy modal", async () => {
  for (const notify of [true, false]) {
    let sourceOpen = true;
    const editor = new FakeElement({ tag: "textarea", attrs: { placeholder: "Message" } });
    const hooks = loadPlatformContent([editor], "gemini.google.com", { visibilityState: "hidden",
      runtimeSendMessage: async message => message.type === "CHECK_TRANSFER_ACTIVE" && !sourceOpen
        ? { ok: false, code: "user_cancelled", error: "Source closed" } : { ok: true }
    });
    const modal = new FakeElement();
    hooks.registerElementId("context-generator-fallback-modal", modal);
    await hooks.pasteIntoPlatform("private carry", "gemini", "cancel-test", Date.now() + 5000, 9);
    editor.value = "";
    sourceOpen = false;
    if (notify) hooks.runtimeMessageListeners[0]({ type: "CANCEL_TRANSFER", transferId: "cancel-test" }, {}, () => {});
    hooks.setVisibility("visible");
    await new Promise(resolve => setTimeout(resolve, 1300));
    assert.equal(editor.value, "");
    assert.equal(editor.clicks, 1);
    assert.notEqual(modal.style.display, "flex");
    assert.equal(hooks.getOwnedLifecycleResourceCounts().eventListeners, 0);
    hooks.teardownContextGeneratorInstance();
  }
});

test("Firefox contenteditable paste preserves line breaks without treating text as HTML", () => {
  const hooks = loadPlatformContent([]);

  assert.equal(
    hooks.formatFirefoxContentEditableHtml("Heading\n\nUse <code> & continue"),
    "Heading<br><br>Use &lt;code&gt; &amp; continue"
  );
});

test("startup clears stale Claude placement transform reservations", () => {
  const shiftedActionRow = new FakeElement({
    attrs: {
      "data-context-generator-original-transform": "",
      "data-context-generator-original-transition": "transform 150ms ease"
    }
  });
  shiftedActionRow.style.transform = "translateX(-56px)";
  shiftedActionRow.style.transition = "none";
  shiftedActionRow.style.willChange = "transform";
  const translatedClaudeControl = new FakeElement({
    attrs: { "data-context-generator-original-translate": "2px 0px" }
  });
  translatedClaudeControl.style.translate = "-52px 0px";
  translatedClaudeControl.style.willChange = "translate";

  loadPlatformContent([shiftedActionRow, translatedClaudeControl], "claude.ai");

  assert.equal(shiftedActionRow.style.transform, "");
  assert.equal(shiftedActionRow.style.transition, "transform 150ms ease");
  assert.equal(shiftedActionRow.style.willChange, "");
  assert.equal(shiftedActionRow.hasAttribute("data-context-generator-original-transform"), false);
  assert.equal(shiftedActionRow.hasAttribute("data-context-generator-original-transition"), false);
  assert.equal(translatedClaudeControl.style.translate, "2px 0px");
  assert.equal(translatedClaudeControl.style.willChange, "");
  assert.equal(translatedClaudeControl.hasAttribute("data-context-generator-original-translate"), false);
});

function inlineChatGptFixture() {
  const body = new FakeElement({ attrs: { "data-composer-body": "" } });
  const footer = new FakeElement({ attrs: { "data-composer-footer-responsive": "" } });
  const editor = new FakeElement({ attrs: { "data-composer-input": "" } });
  const input = new FakeElement({ attrs: { contenteditable: "true", role: "textbox" } });
  const left = new FakeElement();
  const right = new FakeElement();
  const attach = new FakeElement({ tag: "button", attrs: { "data-composer-navigation-target": "add-context" } });
  const model = new FakeElement({ tag: "button", attrs: { "data-composer-navigation-target": "reasoning", "aria-haspopup": "menu" } });
  const modelWrapper = new FakeElement({ attrs: { class: "contents" } });
  const voice = new FakeElement({ tag: "button", attrs: { "aria-label": "Start Voice" } });
  body.appendChild(footer);
  footer.appendChild(left);
  footer.appendChild(editor);
  footer.appendChild(right);
  editor.appendChild(input);
  left.appendChild(attach);
  right.appendChild(modelWrapper);
  modelWrapper.appendChild(model);
  right.appendChild(voice);
  return { body, footer, editor, input, left, right, attach, model, modelWrapper, voice };
}

function gridChatGptFixture() {
  const f = inlineChatGptFixture();
  f.body.setAttribute("data-composer-grid", "");
  f.body.appendChild(f.left); f.body.appendChild(f.editor); f.body.appendChild(f.right);
  f.editor.removeAttribute("data-composer-input");
  f.attach.removeAttribute("data-composer-navigation-target");
  f.attach.setAttribute("data-testid", "composer-plus-btn");
  f.left.setAttribute("data-composer-transition-slot", "leading");
  f.right.setAttribute("data-composer-transition-slot", "trailing");
  f.model.removeAttribute("data-composer-navigation-target");
  f.model.removeAttribute("aria-haspopup");
  f.model.setAttribute("aria-pressed", "false");
  f.model.textContent = f.model.innerText = "Think";
  return f;
}

test("ChatGPT free transition grid mounts beside Think without responsive-footer markers", () => {
  const f = gridChatGptFixture();
  const hooks = loadPlatformContent(Object.values(f));
  hooks.document.createElement = () => new FakeElement();
  const bubble = new FakeElement({ tag: "button", attrs: { id: "context-generator-bubble" } });
  assert.equal(hooks.findChatGptInlineToolbar(f.input)?.footer, f.body);
  assert.equal(hooks.mountChatGptInlineButton(bubble, f.input), true);
  assert.equal(bubble.parentElement, f.right);
  assert.equal(bubble.nextElementSibling, f.modelWrapper);
  assert.equal(f.modelWrapper.contains(bubble), false, "Think's tooltip must not own the orb");
  assert.equal(bubble.style.position, "static");
  assert.equal(bubble.style.width, "36px");
  f.model.setAttribute("data-visibility", "hidden");
  assert.equal(hooks.mountChatGptInlineButton(bubble, f.input), true);
  assert.equal(bubble.nextElementSibling, f.voice, "a hidden Think control must not hide the orb");
  f.model.removeAttribute("data-visibility");
  f.model.setAttribute("aria-pressed", "true");
  assert.equal(hooks.mountChatGptInlineButton(bubble, f.input), true);
  assert.equal(bubble.nextElementSibling, f.modelWrapper);
});

test("ChatGPT free grid rejects foreign slots and refreshes remounted picker ownership", () => {
  const f = gridChatGptFixture();
  const hooks = loadPlatformContent(Object.values(f));
  hooks.document.createElement = () => new FakeElement();
  const bubble = new FakeElement({ tag: "button", attrs: { id: "context-generator-bubble" } });
  f.right.setAttribute("role", "menu");
  assert.equal(hooks.findChatGptInlineToolbar(f.input), null);
  f.right.removeAttribute("role");
  f.right.removeAttribute("data-composer-transition-slot");
  assert.equal(hooks.findChatGptInlineToolbar(f.input), null);
  f.right.setAttribute("data-composer-transition-slot", "trailing");
  assert.equal(hooks.mountChatGptInlineButton(bubble, f.input), true);
  const next = gridChatGptFixture();
  next.editor.appendChild(f.input);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), true);
  assert.equal(hooks.mountChatGptInlineButton(bubble, f.input), true);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), false);
  assert.equal(bubble.nextElementSibling, next.modelWrapper);
  assert.equal(f.body.hasAttribute("data-context-generator-chatgpt-inline"), false);
});

test("ChatGPT inline discovery follows the editor-owned footer across multiline reordering", () => {
  const f = inlineChatGptFixture();
  const hooks = loadPlatformContent(Object.values(f));
  assert.equal(hooks.findChatGptInlineToolbar(f.input).left, f.left);
  f.footer.children = [f.editor, f.left, f.right];
  assert.equal(hooks.findChatGptInlineToolbar(f.input).right, f.right);
  assert.equal(hooks.findChatGptInlineToolbar(new FakeElement()), null);
  f.body.appendChild(f.editor);
  assert.equal(hooks.findChatGptInlineToolbar(f.input), null, "a sibling footer does not own this editor");
});

test("ChatGPT inline discovery supports free controls and excludes popup or unrelated rows", () => {
  const f = inlineChatGptFixture();
  const hooks = loadPlatformContent(Object.values(f));
  f.right.children = [f.voice];
  assert.equal(hooks.findChatGptInlineToolbar(f.input).right, f.right);
  f.right.setAttribute("role", "menu");
  assert.equal(hooks.findChatGptInlineToolbar(f.input), null);
  f.right.removeAttribute("role");
  f.voice.setAttribute("data-visibility", "hidden");
  assert.equal(hooks.findChatGptInlineToolbar(f.input), null, "an empty visible control set must return before indexing its first button");
  f.voice.removeAttribute("data-visibility");
  f.attach.removeAttribute("data-composer-navigation-target");
  assert.equal(hooks.findChatGptInlineToolbar(f.input), null);
});

test("ChatGPT inline discovery skips a duplicate footer and hidden or popup attachment copies", () => {
  const f = inlineChatGptFixture();
  const duplicateFooter = new FakeElement({ attrs: { "data-composer-footer-responsive": "", "data-display": "none" } });
  f.body.insertBefore(duplicateFooter, f.footer);
  const hiddenAttach = new FakeElement({ tag: "button", attrs: { "data-composer-navigation-target": "add-context", "data-visibility": "hidden" } });
  const menu = new FakeElement({ attrs: { role: "menu" } });
  const popupAttach = new FakeElement({ tag: "button", attrs: { "data-composer-navigation-target": "add-context" } });
  f.left.insertBefore(hiddenAttach, f.attach); f.left.insertBefore(menu, f.attach); menu.appendChild(popupAttach);
  const hooks = loadPlatformContent([...Object.values(f), duplicateFooter, hiddenAttach, menu, popupAttach]);
  assert.equal(hooks.findChatGptInlineToolbar(f.input)?.footer, f.footer);
  duplicateFooter.remove();
  assert.equal(hooks.findChatGptInlineToolbar(f.input)?.left, f.left, "a hidden attachment must not mask the visible native control");
});

test("ChatGPT inline mounting reuses its native-control observer and ignores editor text", () => {
  const f = inlineChatGptFixture();
  const hooks = loadPlatformContent(Object.values(f));
  hooks.document.createElement = () => new FakeElement();
  const bubble = new FakeElement({ tag: "button" });
  assert.equal(hooks.mountChatGptInlineButton(bubble, f.input), true);
  const observer = hooks.mutationObservers.find(item => item.observed.some(target => target.element === f.body));
  assert.ok(observer, "inline must watch native attribute-only changes in its composer body");
  const observerCount = hooks.mutationObservers.length;
  assert.equal(hooks.mountChatGptInlineButton(bubble, f.input), true);
  assert.equal(hooks.mutationObservers.length, observerCount);
  observer.callback([{ type: "characterData", target: { parentElement: f.input }, addedNodes: [], removedNodes: [] }]);
  assert.equal(hooks.animationFrameCallbacks.length, 0);
  observer.callback([{ type: "attributes", attributeName: "style", target: f.modelWrapper, addedNodes: [], removedNodes: [] }]);
  assert.equal(hooks.animationFrameCallbacks.length, 1);
  hooks.releaseChatGptInlineMount();
  assert.equal(observer.observed.length, 0);
});

test("ChatGPT inline body-only remount invalidates the picker once and refreshes observer ownership", () => {
  const f = inlineChatGptFixture();
  const hooks = loadPlatformContent(Object.values(f));
  hooks.document.createElement = () => new FakeElement();
  const bubble = new FakeElement({ tag: "button" });
  assert.equal(hooks.mountChatGptInlineButton(bubble, f.input), true);
  const observer = hooks.mutationObservers.find(item => item.observed.some(target => target.element === f.body));
  const nextBody = new FakeElement({ attrs: { "data-composer-body": "" } });
  nextBody.appendChild(f.footer);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), true, "the old body must not continue owning the picker");
  assert.equal(hooks.mountChatGptInlineButton(bubble, f.input), true);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), false);
  assert.equal(observer.observed.length, 0);
  assert.ok(hooks.mutationObservers.some(item => item.observed.some(target => target.element === nextBody)));
  assert.equal(bubble.nextElementSibling, f.modelWrapper);
});

test("ChatGPT mounts before the model, follows remounts and supports free controls", () => {
  const f = inlineChatGptFixture();
  const next = inlineChatGptFixture();
  const nativeGroup = new FakeElement();
  next.right.appendChild(nativeGroup);
  nativeGroup.appendChild(next.modelWrapper);
  nativeGroup.appendChild(next.voice);
  const hooks = loadPlatformContent(Object.values(f));
  hooks.document.createElement = () => new FakeElement();
  const originalGetById = hooks.document.getElementById;
  hooks.document.getElementById = id => originalGetById(id)
    || hooks.document.documentElement.children.find(node => node.id === id);
  const bubble = new FakeElement({ tag: "button" });
  assert.equal(hooks.mountChatGptInlineButton(bubble, f.input), true);
  assert.equal(bubble.parentElement, f.right);
  assert.equal(bubble.nextElementSibling, f.modelWrapper);
  assert.equal(f.modelWrapper.contains(bubble), false, "the pill must stay outside the native model tooltip branch");
  assert.equal(bubble.style.width, "36px");
  assert.equal(bubble.style.flex, "0 0 36px");
  assert.equal(bubble.style.position, "static");
  assert.equal(hooks.mountChatGptInlineButton(bubble, next.input), true);
  assert.equal(bubble.parentElement, nativeGroup);
  assert.equal(bubble.nextElementSibling, next.modelWrapper);
  assert.equal(nativeGroup.getAttribute("data-context-generator-chatgpt-inline"), "controls");
  assert.equal(f.footer.hasAttribute("data-context-generator-chatgpt-inline"), false);
  assert.equal(f.right.hasAttribute("data-context-generator-chatgpt-inline"), false);
  assert.equal(f.modelWrapper.hasAttribute("data-context-generator-chatgpt-inline"), false);
  nativeGroup.children = nativeGroup.children.filter((node) => node !== next.modelWrapper);
  assert.equal(hooks.mountChatGptInlineButton(bubble, next.input), true);
  assert.equal(bubble.parentElement, nativeGroup);
  assert.equal(bubble.nextElementSibling, next.voice);
  assert.equal(bubble.style.flex, "0 0 36px");
  assert.equal(next.modelWrapper.hasAttribute("data-context-generator-chatgpt-inline"), false);
  hooks.releaseChatGptInlineMount();
  assert.equal(next.left.hasAttribute("data-context-generator-chatgpt-inline"), false);
  assert.equal(nativeGroup.hasAttribute("data-context-generator-chatgpt-inline"), false);
});

function inlineProviderFixture(platform) {
  const surface = new FakeElement({ attrs: { class: platform === "gemini" ? "text-input-field" : platform === "grok" ? "query-bar" : "" } });
  const input = new FakeElement({ tag: platform === "deepseek" ? "textarea" : "div", attrs: { contenteditable: "true", role: "textbox" } });
  const editor = new FakeElement({ tag: platform === "gemini" ? "rich-textarea" : "div", attrs: { "data-testid": "chat-input" } });
  const row = new FakeElement({ attrs: { class: platform === "gemini" ? "trailing-actions-wrapper" : "" } });
  const controls = platform === "gemini" ? row : new FakeElement();
  const slot = platform === "deepseek" ? controls : new FakeElement({ attrs: { "data-query-bar-mode-select": "true" } });
  const anchor = new FakeElement({ tag: platform === "deepseek" ? "div" : "button", attrs: platform === "deepseek"
    ? { role: "button", class: "ds-button ds-button--iconLabelPrimary" }
    : { id: "model-select-trigger", "data-test-id": "bard-mode-menu-button" } });
  const action = new FakeElement({ tag: platform === "deepseek" ? "div" : "button", attrs: { role: "button", class: "ds-button--circle" } });
  const attach = new FakeElement({ tag: "button", attrs: { "data-testid": "attach-button" } });
  const file = new FakeElement({ tag: "input", attrs: { type: "file" } });
  const editorContainer = platform === "grok" ? new FakeElement() : surface;
  const dock = platform === "grok" ? new FakeElement() : row;
  if (editorContainer !== surface) surface.appendChild(editorContainer);
  editorContainer.appendChild(editor);
  editor.appendChild(input);
  editorContainer.appendChild(dock);
  if (dock !== row) dock.appendChild(row);
  if (platform === "grok") row.appendChild(attach);
  if (controls !== row) row.appendChild(controls);
  if (slot !== controls) controls.appendChild(slot);
  slot.appendChild(anchor);
  if (platform === "deepseek") controls.appendChild(file);
  controls.appendChild(action);
  return { surface, input, editor, row, controls, slot, anchor, action, attach, file, editorContainer, dock };
}

for (const [platform, host] of [["gemini", "gemini.google.com"], ["grok", "grok.com"], ["deepseek", "chat.deepseek.com"]]) {
  test(`${platform} mounts beside its native controls and reuses the pill after remount`, () => {
    const f = inlineProviderFixture(platform), next = inlineProviderFixture(platform);
    const hooks = loadPlatformContent(Object.values(f), host);
    hooks.document.createElement = () => new FakeElement();
    const originalGetById = hooks.document.getElementById;
    hooks.document.getElementById = id => originalGetById(id)
      || hooks.document.documentElement.children.find(node => node.id === id);
    const bubble = new FakeElement({ tag: "button", attrs: { id: "context-generator-bubble" } });
    assert.equal(hooks.findProviderInlineToolbar(f.input).anchor, f.anchor);
    assert.equal(hooks.findProviderInlineToolbar(new FakeElement()), null);
    assert.equal(hooks.mountProviderInlineButton(bubble, f.input), true);
    assert.equal(bubble.nextElementSibling, f.anchor);
    assert.equal(bubble.style.width, "36px");
    assert.equal(bubble.style.position, "static");
    assert.equal(bubble.style.flex, "0 0 36px");
    if (platform === "grok") {
      const observer = hooks.mutationObservers.find(item => item.observed.some(target => target.element === f.surface));
      f.surface.setAttribute("class", "");
      assert.equal(hooks.mountProviderInlineButton(bubble, f.input), false);
      hooks.syncPlatformPlacementResizeMonitoring(f.input, f.editorContainer);
      assert.ok(observer.observed.some(target => target.element === f.surface),
        "fallback must still observe the outer native class that restores inline mounting");
      f.surface.setAttribute("class", "query-bar");
      observer.callback([{ type: "attributes", attributeName: "class", target: f.surface, addedNodes: [], removedNodes: [] }]);
      assert.equal(hooks.animationFrameCallbacks.length, 1);
      assert.equal(hooks.mountProviderInlineButton(bubble, f.input), true);
    }
    assert.equal(hooks.mountProviderInlineButton(bubble, next.input), true);
    assert.equal(bubble.parentElement, next.slot);
    assert.equal(bubble.nextElementSibling, next.anchor);
    assert.equal(f.controls.hasAttribute("data-context-generator-provider-inline"), false);
    hooks.releaseProviderInlineMount();
    assert.equal(next.controls.hasAttribute("data-context-generator-provider-inline"), false);
    assert.equal(next.slot.hasAttribute("data-context-generator-provider-inline"), false);
    next.controls.setAttribute("role", "menu");
    assert.equal(hooks.findProviderInlineToolbar(next.input), null);
  });
}

test("Gemini mobile inline mounting uses native trailing controls when the mode picker is hidden", () => {
  const f = inlineProviderFixture("gemini");
  f.anchor.rect = { width: 0, height: 0 };
  const hooks = loadPlatformContent(Object.values(f), "gemini.google.com");
  const toolbar = hooks.findProviderInlineToolbar(f.input);
  assert.equal(toolbar.slot, f.controls);
  assert.equal(toolbar.anchor, f.action);
});

test("Gemini inline skips a hidden duplicate trailing wrapper", () => {
  const f = inlineProviderFixture("gemini");
  const duplicate = new FakeElement({ attrs: { class: "trailing-actions-wrapper", "data-display": "none" } });
  const hiddenModel = f.anchor.cloneNode(); hiddenModel.setAttribute("data-display", "none");
  duplicate.appendChild(hiddenModel); f.surface.insertBefore(duplicate, f.row);
  const hooks = loadPlatformContent([...Object.values(f), duplicate, hiddenModel], "gemini.google.com");
  assert.ok(hooks.findProviderInlineToolbar(f.input)?.controls === f.controls);
});

test("Grok inline skips hidden attachment and model copies", () => {
  const f = inlineProviderFixture("grok");
  const attach = f.attach.cloneNode(), model = f.anchor.cloneNode();
  attach.setAttribute("data-display", "none"); model.setAttribute("data-display", "none");
  f.row.insertBefore(attach, f.attach); f.slot.insertBefore(model, f.anchor);
  const hooks = loadPlatformContent([...Object.values(f), attach, model], "grok.com");
  assert.ok(hooks.findProviderInlineToolbar(f.input)?.anchor === f.anchor);
});

test("DeepSeek inline skips duplicate file/send copies and tolerates a spacer before its file", () => {
  const f = inlineProviderFixture("deepseek"), file = f.file.cloneNode(), send = f.action.cloneNode();
  send.setAttribute("data-display", "none");
  f.controls.insertBefore(file, f.anchor); f.controls.insertBefore(send, f.action);
  const hooks = loadPlatformContent([...Object.values(f), file, send], "chat.deepseek.com");
  assert.ok(hooks.findProviderInlineToolbar(f.input)?.anchor === f.anchor);
  file.remove(); send.remove();
  f.controls.insertBefore(new FakeElement(), f.file);
  assert.ok(hooks.findProviderInlineToolbar(f.input)?.anchor === f.anchor, "a non-control spacer must not break the file/upload association");
});

test("DeepSeek inline supports a hidden upload with visible Send inside the verified file group", () => {
  const f = inlineProviderFixture("deepseek"); f.anchor.setAttribute("data-display", "none");
  const hooks = loadPlatformContent(Object.values(f), "chat.deepseek.com");
  assert.ok(hooks.findProviderInlineToolbar(f.input)?.anchor === f.action);
  const wrapper = new FakeElement(); f.controls.appendChild(wrapper); wrapper.appendChild(f.action);
  assert.ok(hooks.findProviderInlineToolbar(f.input)?.anchor === wrapper, "the synchronous parent walk must resolve a wrapped Send to its direct slot child");
  f.action.setAttribute("data-display", "none");
  assert.equal(hooks.findProviderInlineToolbar(f.input), null);
});

test("Grok inline picker invalidates an editor-container-only remount", () => {
  const f = inlineProviderFixture("grok"), hooks = loadPlatformContent(Object.values(f), "grok.com");
  hooks.document.createElement = () => new FakeElement();
  const bubble = new FakeElement({ tag: "button" });
  assert.equal(hooks.mountProviderInlineButton(bubble, f.input), true);
  const next = new FakeElement(); f.surface.appendChild(next); next.appendChild(f.editor); next.appendChild(f.dock);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), true);
  assert.equal(hooks.mountProviderInlineButton(bubble, f.input), true);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), false);
  assert.equal(f.editorContainer.hasAttribute("data-context-generator-provider-inline"), false);
  assert.equal(next.getAttribute("data-context-generator-provider-inline"), "grok-space");
});

function inlineClaudeFixture() {
  const host = new FakeElement();
  const editorBranch = new FakeElement();
  const input = new FakeElement({ attrs: { contenteditable: "true", role: "textbox" } });
  const actions = new FakeElement({ attrs: { "data-cds": "ChatComposerActions" } });
  const left = new FakeElement({ attrs: { "data-display": "flex" } });
  const right = new FakeElement({ attrs: { "data-display": "flex" } });
  const attach = new FakeElement({ tag: "button", attrs: { "data-testid": "chat-input-attach" } });
  const model = new FakeElement({ tag: "button", attrs: { "data-testid": "model-selector-dropdown" } });
  host.appendChild(editorBranch);
  editorBranch.appendChild(input);
  host.appendChild(actions);
  actions.appendChild(left);
  actions.appendChild(right);
  left.appendChild(attach);
  right.appendChild(model);
  return { host, editorBranch, input, actions, left, right, attach, model };
}

function openClaudePickerFixture() {
  const f = inlineClaudeFixture();
  const hooks = loadPlatformContent(Object.values(f), "claude.ai");
  hooks.document.createElement = () => new FakeElement();
  hooks.document.head = new FakeElement({ tag: "head" });
  const bubble = new FakeElement({ tag: "button", attrs: { id: "context-generator-bubble" } });
  const sheet = new FakeElement({ attrs: { id: "context-generator-destination-sheet" } });
  const backdrop = new FakeElement({ attrs: { id: "context-generator-destination-backdrop" } });
  sheet.style.display = "none";
  for (const node of [bubble, sheet, backdrop]) hooks.registerElementId(node.id, node);
  for (const id of ["context-generator-overlay", "context-generator-handoff-scrim"]) {
    const node = new FakeElement({ attrs: { id } });
    node.classList = { add() {}, remove() {} };
    hooks.registerElementId(id, node);
  }
  assert.equal(hooks.mountClaudeInlineButton(bubble, f.input), true);
  const paint = () => hooks.animationFrameCallbacks.splice(0).forEach(callback => callback());
  hooks.startFloatingButtonMonitoring();
  hooks.toggleDestinationSheet(); paint();
  assert.equal(sheet.getAttribute("aria-hidden"), "false");
  return { ...f, hooks, bubble, sheet, backdrop, paint };
}

clockTest("Claude picker stays open at its original position through reflow, resize, remounts and composer loss", () => {
  const f = openClaudePickerFixture(), { hooks, sheet, bubble, paint } = f;
  const position = () => ({ left: sheet.style.left, top: sheet.style.top, origin: sheet.style.transformOrigin });
  const openingPosition = position();
  bubble.getBoundingClientRect = () => ({ left: 600, right: 636, top: 180, bottom: 216, width: 36, height: 36 });
  hooks.scheduleFloatingButtonUpdate("document-childlist"); paint();
  assert.deepEqual(position(), openingPosition, "an orb reflow must not shift the picker horizontally");
  const focus = new FakeElement({ tag: "button" });
  hooks.document.activeElement = focus;
  hooks.window.innerWidth = 390;
  hooks.window.innerHeight = 240;
  hooks.scheduleFloatingButtonUpdate({ type: "resize" }); paint();
  const assertOpen = () => {
    assert.equal(sheet.getAttribute("aria-hidden"), "false");
    assert.equal(sheet.style.display, "block");
    assert.equal(bubble.getAttribute("aria-expanded"), "true");
    assert.equal(hooks.document.activeElement, focus, "layout updates must preserve the user's focus");
    assert.deepEqual(position(), openingPosition, "layout updates must never reanchor an open picker");
  };
  assertOpen();
  for (const part of ["editor", "actions", "host"]) {
    const next = new FakeElement({ attrs: part === "actions" ? { "data-cds": "ChatComposerActions" } : {} });
    if (part === "editor") { f.host.appendChild(next); next.appendChild(f.input); }
    if (part === "actions") { f.actions.removeAttribute("data-cds"); f.host.appendChild(next); next.appendChild(f.left); next.appendChild(f.right); }
    if (part === "host") { next.appendChild(f.input.parentElement); next.appendChild(f.right.parentElement); }
    hooks.scheduleFloatingButtonUpdate("document-childlist"); paint(); assertOpen();
    assert.equal(bubble.parentElement, f.right, "the retained orb must reattach to the current toolbar");
  }
  f.input.isConnected = false;
  hooks.scheduleFloatingButtonUpdate("document-childlist"); paint(); assertOpen();
  assert.equal(f.backdrop.style.clipPath, "", "no stale click-through hole may expose the page while the orb is missing");
  f.input.isConnected = true;
  hooks.scheduleFloatingButtonUpdate("document-childlist"); paint(); assertOpen();
  assert.equal(bubble.style.visibility, "visible");
  hooks.popstate("/chat/a-different-conversation"); paint();
  assert.equal(sheet.getAttribute("aria-hidden"), "true", "a real conversation change still dismisses the old picker");
});

clockTest("Claude picker layout work cannot undo explicit dismissal or move a selected transfer", () => {
  const { hooks, sheet, paint } = openClaudePickerFixture();
  const origin = { left: sheet.style.left, top: sheet.style.top };
  const trace = hooks.beginTransferAttempt("chatgpt", "destination tile");
  try {
    hooks.scheduleFloatingButtonUpdate({ type: "resize" }); paint();
    assert.equal(sheet.getAttribute("aria-hidden"), "false", "selection owns the picker until its handoff animation closes it");
    assert.deepEqual({ left: sheet.style.left, top: sheet.style.top }, origin);
  } finally { hooks.finishTransferTrace(trace); hooks.resetRunningFlag(); }
  hooks.hideDestinationSheet({ restoreFocus: false });
  hooks.scheduleFloatingButtonUpdate("document-childlist"); paint();
  assert.equal(sheet.getAttribute("aria-hidden"), "true", "a queued frame must not reopen a dismissed picker");
});

clockTest("Claude route changes dismiss a picker even while its composer is absent", () => {
  const { hooks, sheet, input, paint } = openClaudePickerFixture();
  input.isConnected = false;
  hooks.scheduleFloatingButtonUpdate("document-childlist"); paint();
  assert.equal(sheet.getAttribute("aria-hidden"), "false");
  hooks.popstate("/new"); paint();
  assert.equal(sheet.getAttribute("aria-hidden"), "true");
});

test("Claude inline discovery excludes popup controls and a different editor's toolbar", () => {
  const fixture = inlineClaudeFixture();
  const hooks = loadPlatformContent(Object.values(fixture), "claude.ai");
  const otherInput = new FakeElement({ attrs: { contenteditable: "true" } });
  assert.equal(hooks.findClaudeInlineToolbar(otherInput), null);
  fixture.left.setAttribute("role", "menu");
  assert.equal(hooks.findClaudeInlineToolbar(fixture.input), null);
  fixture.left.removeAttribute("role");
  fixture.model.setAttribute("data-visibility", "hidden");
  assert.equal(hooks.findClaudeInlineToolbar(fixture.input), null);
});

test("Claude inline discovery skips hidden and popup copies of native controls", () => {
  const f = inlineClaudeFixture();
  f.editorBranch.appendChild(new FakeElement({ attrs: { "data-display": "flex" } }));
  const hiddenModel = new FakeElement({ tag: "button", attrs: { "data-testid": "model-selector-dropdown", "data-visibility": "hidden" } });
  const menu = new FakeElement({ attrs: { role: "menu" } });
  const popupAttach = new FakeElement({ tag: "button", attrs: { "data-testid": "chat-input-attach" } });
  f.right.insertBefore(hiddenModel, f.model);
  f.left.insertBefore(menu, f.attach); menu.appendChild(popupAttach);
  const hooks = loadPlatformContent([...Object.values(f), hiddenModel, menu, popupAttach], "claude.ai");
  assert.ok(hooks.findClaudeInlineToolbar(f.input)?.left === f.left);
  f.actions.removeAttribute("data-cds");
  assert.equal(hooks.findClaudeInlineToolbar(f.input), null, "unnamed actions cannot own the inline slot");
});

test("Claude inline discovery stays within the active named composer", () => {
  const f = inlineClaudeFixture();
  const composer = new FakeElement({ attrs: { "data-cds": "ChatComposer" } });
  f.host.appendChild(composer); composer.appendChild(f.editorBranch);
  const hooks = loadPlatformContent([...Object.values(f), composer], "claude.ai");
  assert.ok(hooks.findClaudeInlineToolbar(f.input) === null, "ancestor actions outside this named composer must not be claimed");
});

test("Claude inline ownership detects editor and actions replacements before picker opening", () => {
  const f = inlineClaudeFixture();
  const hooks = loadPlatformContent(Object.values(f), "claude.ai");
  hooks.document.createElement = () => new FakeElement();
  const bubble = new FakeElement({ tag: "button" });
  assert.equal(hooks.mountClaudeInlineButton(bubble, f.input), true);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), false);
  const editor = new FakeElement();
  f.host.appendChild(editor); editor.appendChild(f.input);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), true, "same input in a replaced editor branch must invalidate the previous mount");
  assert.equal(hooks.mountClaudeInlineButton(bubble, f.input), true);
  const actions = new FakeElement({ attrs: { "data-cds": "ChatComposerActions" } });
  f.actions.removeAttribute("data-cds"); f.host.appendChild(actions);
  actions.appendChild(f.left); actions.appendChild(f.right);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), true, "same rows in a replaced actions container must invalidate the previous mount");
});

test("Claude inline mounting monitors native attribute changes without reacting to editor text", () => {
  const f = inlineClaudeFixture();
  const hooks = loadPlatformContent(Object.values(f), "claude.ai");
  hooks.document.createElement = () => new FakeElement();
  const bubble = new FakeElement({ tag: "button" });
  assert.equal(hooks.mountClaudeInlineButton(bubble, f.input), true);
  const observer = hooks.mutationObservers.find(item => item.observed.some(target => target.element === f.host));
  assert.ok(observer, "inline mounting must watch attribute-only native toolbar changes");
  const observerCount = hooks.mutationObservers.length;
  assert.equal(hooks.mountClaudeInlineButton(bubble, f.input), true);
  assert.equal(hooks.mutationObservers.length, observerCount, "stable mounting must reuse its control observer");
  assert.equal(observer.observed.length, 1, "stable mounting must keep observing the composer");
  observer.callback([{ type: "characterData", target: { parentElement: f.input }, addedNodes: [], removedNodes: [] }]);
  assert.equal(hooks.animationFrameCallbacks.length, 0);
  observer.callback([{ type: "attributes", attributeName: "style", target: f.model, addedNodes: [], removedNodes: [] }]);
  assert.equal(hooks.animationFrameCallbacks.length, 1);
  hooks.releaseClaudeInlineMount();
  assert.equal(observer.observed.length, 0);
});

test("Claude inline host-only remount refreshes retained ownership once", () => {
  const f = inlineClaudeFixture();
  const hooks = loadPlatformContent(Object.values(f), "claude.ai");
  hooks.document.createElement = () => new FakeElement();
  const bubble = new FakeElement({ tag: "button" });
  assert.equal(hooks.mountClaudeInlineButton(bubble, f.input), true);
  const oldObserver = hooks.mutationObservers.find(item => item.observed.some(target => target.element === f.host));
  const nextHost = new FakeElement();
  nextHost.appendChild(f.editorBranch); nextHost.appendChild(f.actions);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), true);
  assert.equal(hooks.mountClaudeInlineButton(bubble, f.input), true);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), false, "a remounted host must become the new picker owner");
  assert.equal(oldObserver.observed.length, 0);
  assert.ok(hooks.mutationObservers.some(item => item.observed.some(target => target.element === nextHost)));
  assert.equal(bubble.parentElement, f.right);
});

test("Claude inline mounting reuses its 36px mic-adjacent slot after remount and restores native markers", () => {
  const first = inlineClaudeFixture();
  const next = inlineClaudeFixture();
  for (const fixture of [first, next]) {
    const branch = new FakeElement();
    branch.appendChild(new FakeElement({ tag: "button", attrs: { "aria-label": "Dictate" } }));
    branch.appendChild(new FakeElement({ tag: "button", attrs: { "data-testid": "chat-input-send", "data-visibility": "hidden" } }));
    fixture.right.appendChild(branch);
    fixture.voiceBranch = branch;
  }
  const hooks = loadPlatformContent(Object.values(first), "claude.ai");
  hooks.document.createElement = () => new FakeElement();
  const originalGetById = hooks.document.getElementById;
  hooks.document.getElementById = (id) => originalGetById(id)
    || hooks.document.documentElement.children.find((node) => node.id === id);
  const bubble = new FakeElement({ tag: "button" });
  first.left.style.position = "absolute";
  assert.equal(hooks.mountClaudeInlineButton(bubble, first.input), true);
  assert.equal(bubble.parentElement, first.right);
  assert.equal(bubble.nextElementSibling, first.voiceBranch);
  assert.equal(bubble.style.position, "static");
  assert.equal(bubble.style.width, "36px");
  assert.equal(bubble.style.flex, "0 0 36px");
  const replacementBranch = new FakeElement();
  while (first.voiceBranch.children.length) replacementBranch.appendChild(first.voiceBranch.children[0]);
  first.right.appendChild(replacementBranch);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), true, "a replaced mic/Send branch must refresh picker ownership");
  assert.equal(hooks.mountClaudeInlineButton(bubble, first.input), true);
  assert.equal(bubble.nextElementSibling, replacementBranch);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), false);
  assert.equal(hooks.mountClaudeInlineButton(bubble, next.input), true);
  assert.equal(bubble.parentElement, next.right);
  assert.equal(bubble.nextElementSibling, next.voiceBranch);
  assert.equal(first.left.hasAttribute("data-context-generator-claude-inline"), false);
  assert.equal(first.left.style.position, "absolute");
  assert.equal(next.right.children.filter((node) => node === bubble).length, 1);
  hooks.releaseClaudeInlineMount();
  for (const node of [next.editorBranch, next.actions, next.left, next.right]) {
    assert.equal(node.hasAttribute("data-context-generator-claude-inline"), false);
  }
});

test("Claude keeps its inline slot through temporary control and editor discovery gaps", () => {
  const f = inlineClaudeFixture();
  const hooks = loadPlatformContent(Object.values(f), "claude.ai");
  hooks.document.createElement = () => new FakeElement();
  const bubble = new FakeElement({ tag: "button" });
  hooks.window.setTimeout = () => { throw new Error("Claude inline must not start a fallback timer"); };
  assert.equal(hooks.mountInlineOrLegacyBackup(bubble, f.input), true);
  f.model.setAttribute("data-visibility", "hidden");
  assert.equal(hooks.mountInlineOrLegacyBackup(bubble, f.input), true);
  assert.equal(hooks.mountClaudeInlineButton(bubble, null), true);
  assert.equal(bubble.parentElement, f.right);
  assert.equal(bubble.style.position, "static");
  assert.equal(bubble.style.width, "36px");
  f.model.removeAttribute("data-visibility");
  assert.equal(hooks.mountInlineOrLegacyBackup(bubble, f.input), true);
  f.input.isConnected = false;
  assert.equal(hooks.mountInlineOrLegacyBackup(bubble, f.input), false);
  assert.equal(bubble.style.visibility, "hidden", "a detached editor must lose ownership");
  hooks.releaseClaudeInlineMount();
});

function replyClaudeFixture() {
  const f = inlineClaudeFixture();
  const composer = new FakeElement({ attrs: { "data-cds": "ChatComposer", "data-form": "reply" } });
  const chin = new FakeElement({ attrs: { "data-cds": "ChatComposerChin" } });
  const row = new FakeElement({ attrs: { "data-display": "flex" } });
  const sendRow = new FakeElement({ attrs: { "data-display": "flex" } });
  const send = new FakeElement({ tag: "button", attrs: { "data-testid": "chat-input-send" } });
  composer.appendChild(f.host); composer.appendChild(chin); chin.appendChild(row);
  row.appendChild(f.left); row.appendChild(f.right);
  f.actions.appendChild(sendRow); sendRow.appendChild(send);
  return { ...f, composer, chin, row, sendRow, send };
}

test("Claude reply chin mounts without moving or unreserving Send inside the editor", () => {
  const f = replyClaudeFixture(), hooks = loadPlatformContent(Object.values(f), "claude.ai");
  hooks.document.createElement = () => new FakeElement();
  const bubble = new FakeElement({ tag: "button", attrs: { id: "context-generator-bubble" } });
  assert.equal(hooks.mountClaudeInlineButton(bubble, f.input), true);
  assert.equal(bubble.parentElement, f.right);
  assert.equal(bubble.nextElementSibling, f.model);
  assert.equal(bubble.style.position, "static");
  assert.equal(f.send.parentElement, f.sendRow);
  assert.equal(f.editorBranch.hasAttribute("data-context-generator-claude-inline"), false);
  assert.equal(f.actions.hasAttribute("data-context-generator-claude-inline"), false);
  assert.equal(f.row.getAttribute("data-context-generator-claude-inline"), "chin");
  f.model.setAttribute("data-visibility", "hidden");
  assert.equal(hooks.mountClaudeInlineButton(bubble, f.input), true, "sending gaps retain the validated chin slot");
  f.input.isConnected = false;
  assert.equal(hooks.mountClaudeInlineButton(bubble, f.input), false);
  assert.equal(bubble.style.visibility, "hidden");
});

test("Claude new chat transitions to a reply chin and back without stale picker ownership", () => {
  const f = inlineClaudeFixture(), reply = replyClaudeFixture();
  const hooks = loadPlatformContent([...Object.values(f), ...Object.values(reply)], "claude.ai");
  hooks.document.createElement = () => new FakeElement();
  const bubble = new FakeElement({ tag: "button", attrs: { id: "context-generator-bubble" } });
  assert.equal(hooks.mountClaudeInlineButton(bubble, f.input), true);
  bubble.setAttribute("aria-expanded", "true");
  bubble.style.transform = "translate3d(0,-1px,0) scale(1.08)";
  f.input.isConnected = false;
  f.input.setAttribute("data-display", "none");
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), true);
  assert.equal(bubble.getAttribute("aria-expanded"), "false", "a detached retained orb must lose its old picker state");
  assert.equal(bubble.style.transform, "translate3d(0,0,0) scale(1)");
  assert.equal(hooks.mountClaudeInlineButton(bubble, reply.input), true);
  assert.equal(hooks.invalidateInlinePicker("document-childlist"), false);
  assert.equal(f.actions.hasAttribute("data-context-generator-claude-inline"), false);
  reply.row.setAttribute("role", "menu");
  assert.equal(hooks.findClaudeInlineToolbar(reply.input), null, "popup copies cannot become a chin toolbar");
  reply.row.removeAttribute("role");
  const other = new FakeElement({ attrs: { "data-cds": "ChatComposer" } });
  other.appendChild(reply.chin);
  assert.equal(hooks.findClaudeInlineToolbar(reply.input), null, "another composer cannot supply the chin");
  f.input.isConnected = true;
  f.input.removeAttribute("data-display");
  assert.equal(hooks.mountClaudeInlineButton(bubble, f.input), true);
  assert.equal(bubble.parentElement, f.right);
  assert.equal(reply.row.hasAttribute("data-context-generator-claude-inline"), false);
});

test("Claude inline discovery validates the compact model chin against the same composer", () => {
  const fixture = inlineClaudeFixture();
  const composer = new FakeElement({ attrs: { "data-cds": "ChatComposer" } });
  const chin = new FakeElement({ attrs: { "data-cds": "ChatComposerChin" } });
  const send = new FakeElement({ tag: "button", attrs: { "data-testid": "chat-input-send" } });
  composer.appendChild(fixture.host);
  composer.appendChild(chin);
  fixture.right.children = fixture.right.children.filter((node) => node !== fixture.model);
  chin.appendChild(fixture.model);
  fixture.right.appendChild(send);
  const hooks = loadPlatformContent([...Object.values(fixture), composer, chin, send], "claude.ai");
  assert.equal(hooks.findClaudeInlineToolbar(fixture.input).right, fixture.right);
  composer.children = composer.children.filter((node) => node !== chin);
  assert.equal(hooks.findClaudeInlineToolbar(fixture.input), null);
});

for (const platform of ["claude", "chatgpt"]) {
  test(`${platform} ${platform === "claude" ? "stays inline only" : "uses its legacy backup"} and recovers after editor replacement`, () => {
    const inline = platform === "claude" ? inlineClaudeFixture() : inlineChatGptFixture();
    const form = new FakeElement({ tag: "form", rect: { left: 60, right: 760, top: 400, bottom: 560, width: 700, height: 160 } });
    const input = new FakeElement({ attrs: { contenteditable: "true", role: "textbox" }, rect: { left: 80, right: 740, top: 410, bottom: 470, width: 660, height: 60 } });
    const model = new FakeElement({ tag: "button", text: "Sonnet High", attrs: { "aria-label": "Model Sonnet", "aria-haspopup": "menu" }, rect: { left: 500, right: 590, top: 510, bottom: 542, width: 90, height: 32 } });
    const voice = new FakeElement({ tag: "button", attrs: { "aria-label": "Use voice mode" }, rect: { left: 640, right: 672, top: 510, bottom: 542, width: 32, height: 32 } });
    form.appendChild(input); form.appendChild(model); form.appendChild(voice);
    const hooks = loadPlatformContent([...Object.values(inline), form, input, model, voice], platform === "claude" ? "claude.ai" : "chatgpt.com");
    hooks.document.createElement = () => new FakeElement();
    const bubble = new FakeElement({ tag: "button", attrs: { id: "context-generator-bubble" } });
    assert.equal(hooks.mountInlineOrLegacyBackup(bubble, inline.input), true);
    assert.equal(bubble.style.position, "static", "inline remains primary");
    assert.equal(hooks.resizeObservers.some(observer => observer.observed.length), false);
    if (platform === "claude") {
      assert.equal(hooks.mountInlineOrLegacyBackup(bubble, input), false);
      assert.equal(bubble.style.position, "static", "unmatched Claude markup must never switch to fixed placement");
      assert.equal(bubble.style.visibility, "hidden", "the old composer must not own a visible pill for the new editor");
      assert.equal(hooks.resizeObservers.some(observer => observer.observed.length), false);
      assert.equal(model.hasAttribute("data-context-generator-original-translate"), false);
    } else {
      assert.equal(hooks.mountInlineOrLegacyBackup(bubble, input), true);
      assert.equal(bubble.style.position, "fixed", "unknown GPT markup uses the real legacy path");
      assert.equal(bubble.parentElement, hooks.document.body);
      assert.equal(bubble.style.width, "42px");
      assert.ok(Number.isFinite(parseFloat(bubble.style.left)));
      assert.equal(hooks.resizeObservers.some(observer => observer.observed.length), true);
      const backupObserver = hooks.mutationObservers.find(observer => observer.observed.some(target => target.element === form));
      assert.ok(backupObserver.observed[0].options.attributeFilter.includes("hidden"), "the backup must recover from native hidden changes without a resize");
    }
    assert.equal(hooks.mountInlineOrLegacyBackup(bubble, inline.input), true);
    assert.equal(bubble.style.position, "static");
    assert.equal(bubble.style.width, "36px");
    assert.equal(hooks.resizeObservers.some(observer => observer.observed.length), false);
    assert.equal(hooks.mutationObservers.some(observer => observer.observed.some(target => target.element === form)), false);
    assert.equal(model.hasAttribute("data-context-generator-original-translate"), false);
    assert.equal(voice.hasAttribute("data-context-generator-original-translate"), false);
    assert.equal(form.hasAttribute("data-context-generator-original-position"), false);
  });
}

test("Inline platforms detect SPA route changes and schedule fresh mounting", () => {
  for (const [host, initial, next] of [
    ["claude.ai", "/new", "/chat/example"], ["chatgpt.com", "/", "/c/example"],
    ["gemini.google.com", "/app", "/app/example"], ["grok.com", "/", "/c/example"],
    ["chat.deepseek.com", "/", "/a/chat/s/example"]
  ]) {
    const hooks = loadPlatformContent([], host, { pathname: initial });
    assert.equal(hooks.checkInlinePlacementPathname(), false);
    hooks.window.location.pathname = next;
    assert.equal(hooks.checkInlinePlacementPathname(), true);
    assert.equal(hooks.animationFrameCallbacks.length, 1);
  }
});

test("composer discovery rejects an unvalidated inner editor wrapper", () => {
  for (const hostname of ["chatgpt.com", "gemini.google.com", "grok.com", "chat.deepseek.com"]) {
    const input = new FakeElement({
      attrs: { contenteditable: "true", role: "textbox" },
      rect: { left: 240, right: 920, top: 620, bottom: 672, width: 680, height: 52 }
    });
    const innerWrapper = new FakeElement({
      rect: { left: 250, right: 900, top: 625, bottom: 668, width: 650, height: 43 }
    });
    input.parentElement = innerWrapper;
    innerWrapper.children = [input];

    const hooks = loadPlatformContent([innerWrapper, input], hostname);

    // This fixture has no composer selector matches. Filter like the browser so
    // the editable input cannot be returned for an unrelated "form" query.
    hooks.document.querySelectorAll = (selector) => [innerWrapper, input]
      .filter((element) => element.matches(selector));

    assert.equal(
      hooks.findComposerSurfaceElement(input),
      null,
      `${hostname} should reject the inner editor wrapper`
    );
  }
});

test("Gemini bubble anchors to the left of the Flash selector", () => {
  const flash = new FakeElement({
    tag: "button",
    text: "Flash",
    attrs: { "aria-label": "Gemini Flash model selector" },
    rect: { left: 700, right: 770, top: 166, bottom: 202, width: 70, height: 36 }
  });
  const mic = new FakeElement({
    tag: "button",
    attrs: { "aria-label": "Microphone" },
    rect: { left: 790, right: 826, top: 166, bottom: 202, width: 36, height: 36 }
  });
  const hooks = loadPlatformContent([flash, mic], "gemini.google.com");
  const anchor = hooks.findGeminiModelSelectorButton(getClaudeComposerRect());
  const placement = hooks.getGeminiBubblePlacement(getClaudeComposerRect(), anchor);

  assert.equal(anchor, flash);
  assert.equal(placement.right, 208);
  assert.equal(placement.bottom, 15);
});

test("Grok bubble keeps the Fast placement across every visible mode", () => {
  const composerRect = getClaudeComposerRect();

  for (const mode of ["Fast", "Build Beta", "Auto", "Expert", "Heavy"]) {
    const selector = new FakeElement({
      tag: "button",
      text: mode,
      attrs: { "aria-label": "Mode selector" },
      rect: { left: 700, right: 790, top: 166, bottom: 202, width: 90, height: 36 }
    });
    const mic = new FakeElement({
      tag: "button",
      attrs: { "aria-label": "Microphone" },
      rect: { left: 804, right: 840, top: 166, bottom: 202, width: 36, height: 36 }
    });
    const hooks = loadPlatformContent([selector, mic], "grok.com");
    const placement = hooks.getGrokBubblePlacement(composerRect);

    assert.equal(placement.left, 550, `${mode} should anchor before its visible selector`);
    assert.equal(placement.top, 63);
  }
});

test("DeepSeek anchors before the complete visible right-side control row", () => {
  const composerRect = getClaudeComposerRect();
  const firstControl = new FakeElement({
    tag: "button",
    rect: { left: 650, right: 720, top: 166, bottom: 202, width: 70, height: 36 }
  });
  const middleControl = new FakeElement({
    tag: "button",
    rect: { left: 748, right: 784, top: 166, bottom: 202, width: 36, height: 36 }
  });
  const lastControl = new FakeElement({
    tag: "button",
    rect: { left: 804, right: 840, top: 166, bottom: 202, width: 36, height: 36 }
  });
  const hooks = loadPlatformContent(
    [lastControl, firstControl, middleControl],
    "chat.deepseek.com"
  );

  assert.equal(hooks.getDeepSeekBubblePlacement(composerRect).left, 500);
});

function getClaudeComposerRect() {
  return { left: 100, right: 900, top: 100, bottom: 220, width: 800, height: 120 };
}

test("shared composer resize monitoring reuses targets and releases remounted nodes", () => {
  for (const hostname of ["gemini.google.com", "grok.com", "chat.deepseek.com"]) {
    const hooks = loadPlatformContent([], hostname);
    const input = new FakeElement();
    const composer = new FakeElement();
    hooks.syncPlatformPlacementResizeMonitoring(input, composer);
    const first = hooks.resizeObservers.at(-1);
    const count = hooks.resizeObservers.length;
    hooks.syncPlatformPlacementResizeMonitoring(input, composer);
    assert.equal(hooks.resizeObservers.length, count, hostname);

    const replacement = new FakeElement();
    hooks.syncPlatformPlacementResizeMonitoring(input, replacement);
    const second = hooks.resizeObservers.at(-1);
    assert.notEqual(second, first, hostname);
    assert.equal(first.observed.length, 0, hostname);
    assert.deepEqual(second.observed, [input, replacement], hostname);
    hooks.stopPlatformPlacementResizeMonitoring();
    assert.equal(second.observed.length, 0, hostname);
  }
});
