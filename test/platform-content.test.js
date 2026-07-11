const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SOURCE_PATH = path.join(__dirname, "..", "extension", "platform-content.js");

let nextOrder = 1;

class FakeElement {
  constructor({ tag = "div", text = "", attrs = {}, rect = null } = {}) {
    this.localName = tag;
    this.textContent = text;
    this.innerText = text;
    this.value = "";
    this.id = attrs.id || "";
    this.className = attrs.class || "";
    this.dataset = {};
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
    if (selector.startsWith(".")) {
      return String(this.className || "").split(/\s+/).includes(selector.slice(1));
    }
    if (selector === "[data-message-author-role]") return this.hasAttribute("data-message-author-role");
    if (selector === "[role='button']") return this.getAttribute("role") === "button";
    if (selector === "[role='main']") return this.getAttribute("role") === "main";
    if (selector.includes("[contenteditable='true']")) return this.attrs.contenteditable === "true";

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

  remove() {}
}

function loadPlatformContent(elements = [], hostname = "chatgpt.com") {
  nextOrder = 1;
  let hooks = null;
  const document = {
    body: new FakeElement({ tag: "body" }),
    documentElement: new FakeElement({ tag: "html" }),
    activeElement: null,
    getElementById: () => null,
    querySelectorAll: () => elements,
    addEventListener: () => {},
    removeEventListener: () => {}
  };
  const window = {
    location: { hostname },
    scrollX: 0,
    scrollY: 400,
    __CONTEXT_GENERATOR_TEST_HOOKS__: {
      register(value) {
        hooks = value;
      }
    },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    performance: { now: () => 0 },
    addEventListener: () => {},
    removeEventListener: () => {},
    scrollTo: (optionsOrX, y) => {
      if (typeof optionsOrX === "object") {
        window.scrollX = optionsOrX.left ?? window.scrollX;
        window.scrollY = optionsOrX.top ?? window.scrollY;
        return;
      }
      window.scrollX = optionsOrX ?? window.scrollX;
      window.scrollY = y ?? window.scrollY;
    },
    innerHeight: 720,
    setTimeout,
    clearTimeout
  };
  const chrome = {
    runtime: {
      onMessage: { addListener: () => {} },
      sendMessage: async () => ({ ok: true }),
      getURL: (assetPath) => `chrome-extension://test/${assetPath}`
    }
  };
  const sandbox = {
    console,
    document,
    window,
    chrome,
    Element: FakeElement,
    Node: { DOCUMENT_POSITION_PRECEDING: 2 },
    setTimeout,
    clearTimeout
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SOURCE_PATH, "utf8"), sandbox, { filename: SOURCE_PATH });
  assert.ok(hooks, "platform-content test hooks were registered");
  return hooks;
}

test("conversation scraping rejects an empty chat", () => {
  const hooks = loadPlatformContent([]);

  assert.throws(
    () => hooks.scrapeConversationText(),
    /Chat is empty\. Send one message first/
  );
});

test("conversation scraping preserves detected user and assistant roles", () => {
  const userTurn = new FakeElement({
    text: "Please make the fallback modal better.",
    attrs: { "data-message-author-role": "user" }
  });
  const assistantTurn = new FakeElement({
    text: "I will update the modal and add focused tests.",
    attrs: { "data-message-author-role": "assistant" }
  });
  const hooks = loadPlatformContent([userTurn, assistantTurn]);

  assert.equal(hooks.getConversationRole(userTurn), "User");
  assert.equal(hooks.getConversationRole(assistantTurn), "ChatGPT");

  const transcript = hooks.scrapeConversationText();
  assert.match(transcript, /^ChatGPT conversation:/);
  assert.match(transcript, /User: Please make the fallback modal better\./);
  assert.match(transcript, /ChatGPT: I will update the modal and add focused tests\./);
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

test("conversation scraping preserves separate turns with identical text", () => {
  const repeatedText = "Please retry that exact operation.";
  const firstUserTurn = new FakeElement({
    text: repeatedText,
    attrs: { "data-message-author-role": "user" }
  });
  const assistantTurn = new FakeElement({
    text: "I retried it and the same result occurred.",
    attrs: { "data-message-author-role": "assistant" }
  });
  const secondUserTurn = new FakeElement({
    text: repeatedText,
    attrs: { "data-message-author-role": "user" }
  });
  const hooks = loadPlatformContent([firstUserTurn, assistantTurn, secondUserTurn]);

  const transcript = hooks.scrapeConversationText();

  assert.equal((transcript.match(/User: Please retry that exact operation\./g) || []).length, 2);
  assert.equal(hooks.getConversationTurns().length, 3);
});

test("virtual window merging preserves repeated turns while removing only window overlap", () => {
  const hooks = loadPlatformContent([]);
  const collected = [];
  const firstWindow = [
    { role: "User", text: "Repeat this." },
    { role: "ChatGPT", text: "First answer." },
    { role: "User", text: "Repeat this." }
  ];
  const secondWindow = [
    { role: "ChatGPT", text: "First answer." },
    { role: "User", text: "Repeat this." },
    { role: "ChatGPT", text: "Second answer." }
  ];

  assert.equal(hooks.collectRenderedConversationTurns(collected, firstWindow), 3);
  assert.equal(hooks.collectRenderedConversationTurns(collected, secondWindow), 1);
  assert.equal(collected.length, 4);
  assert.equal(collected.filter((turn) => turn.role === "User" && turn.text === "Repeat this.").length, 2);
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

test("Claude scraping keeps child message turns instead of a broad wrapper blob", () => {
  const wrapper = new FakeElement({
    text: [
      "Please keep every turn separate.",
      "I will preserve the first assistant turn.",
      "Now add the older messages too.",
      "I will keep the second assistant turn."
    ].join("\n"),
    attrs: { class: "messages conversation-scroll" }
  });
  const turns = [
    new FakeElement({ text: "Please keep every turn separate.", attrs: { "data-testid": "user-message" } }),
    new FakeElement({ text: "I will preserve the first assistant turn.", attrs: { class: "font-claude-response" } }),
    new FakeElement({ text: "Now add the older messages too.", attrs: { "data-testid": "user-message" } }),
    new FakeElement({ text: "I will keep the second assistant turn.", attrs: { class: "font-claude-response" } })
  ];
  wrapper.children = turns;
  turns.forEach((turn) => {
    turn.parentElement = wrapper;
  });

  const hooks = loadPlatformContent([wrapper, ...turns], "claude.ai");
  const transcript = hooks.scrapeConversationText();

  assert.match(transcript, /^Claude conversation:/);
  assert.equal((transcript.match(/(?:User|Claude):/g) || []).length, 4);
  assert.match(transcript, /User: Please keep every turn separate\./);
  assert.match(transcript, /Claude: I will keep the second assistant turn\./);
});

test("Claude scraping does not stop at explicit wrapper chunks when many loaded turns exist", () => {
  const elements = [];
  let turnNumber = 1;

  for (let chunkIndex = 0; chunkIndex < 12; chunkIndex += 1) {
    const chunkTurns = [];
    const turnsInChunk = chunkIndex < 6 ? 7 : 6;
    const wrapper = new FakeElement({
      attrs: { class: "assistant-message chunk-wrapper" }
    });

    for (let localIndex = 0; localIndex < turnsInChunk; localIndex += 1) {
      const isUser = turnNumber % 2 === 1;
      const turn = new FakeElement({
        text: `Loaded turn ${turnNumber}`,
        attrs: isUser ? { "data-testid": "user-message" } : { class: "font-claude-response" }
      });
      turn.parentElement = wrapper;
      chunkTurns.push(turn);
      turnNumber += 1;
    }

    wrapper.children = chunkTurns;
    wrapper.textContent = chunkTurns.map((turn) => turn.textContent).join("\n");
    wrapper.innerText = wrapper.textContent;
    elements.push(wrapper, ...chunkTurns);
  }

  const hooks = loadPlatformContent(elements, "claude.ai");
  const transcript = hooks.scrapeConversationText();

  assert.equal((transcript.match(/(?:User|Claude): Loaded turn/g) || []).length, 78);
  assert.match(transcript, /User: Loaded turn 1/);
  assert.match(transcript, /Claude: Loaded turn 78/);
});

function createVirtualizedChatElements({
  label,
  makeTurn,
  totalTurns = 78,
  windowSize = 12,
  scrollStride = windowSize,
  scrollHeight = 4800,
  stalledScrollsBeforeRender = 0
}) {
  const elements = [];
  let delayedScrolls = 0;
  let renderedStartIndex = 0;
  const scrollableRoot = new FakeElement({
    text: `Scrollable ${label} chat root`,
    attrs: { role: "main" }
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
    renderedStartIndex = startIndex;
    renderWindow(startIndex);
  };
  renderWindow(0);

  return { elements, scrollableRoot };
}

test("transfer capture sweeps virtualized long chats across supported platforms", async () => {
  const cases = [
    {
      hostname: "claude.ai",
      platformName: "Claude",
      makeTurn: (index) => new FakeElement({
        text: `Virtualized turn ${index}`,
        attrs: index % 2 ? { "data-testid": "user-message" } : { class: "font-claude-response" }
      })
    },
    {
      hostname: "chatgpt.com",
      platformName: "ChatGPT",
      makeTurn: (index) => new FakeElement({
        text: `Virtualized turn ${index}`,
        attrs: { "data-message-author-role": index % 2 ? "user" : "assistant" }
      })
    },
    {
      hostname: "gemini.google.com",
      platformName: "Gemini",
      makeTurn: (index) => new FakeElement({
        tag: index % 2 ? "user-query" : "model-response",
        text: `Virtualized turn ${index}`
      })
    },
    {
      hostname: "grok.com",
      platformName: "Grok",
      makeTurn: (index) => new FakeElement({
        text: `Virtualized turn ${index}`,
        attrs: { "data-testid": index % 2 ? "user-message" : "assistant-message" }
      })
    },
    {
      hostname: "chat.deepseek.com",
      platformName: "DeepSeek",
      makeTurn: (index) => new FakeElement({
        text: `Virtualized turn ${index}`,
        attrs: { class: "ds-markdown", "data-role": index % 2 ? "user" : "assistant" }
      })
    }
  ];

  for (const { hostname, platformName, makeTurn } of cases) {
    const { elements } = createVirtualizedChatElements({ label: platformName, makeTurn });
    const hooks = loadPlatformContent(elements, hostname);

    await hooks.prepareSourceForCapture();
    const transcript = await hooks.scrapeConversationTextWhenReady();

    assert.equal(
      (transcript.match(new RegExp(`(?:User|${platformName}): Virtualized turn`, "g")) || []).length,
      78,
      `${platformName} should capture every virtualized turn`
    );
    assert.match(transcript, /User: Virtualized turn 1/);
    assert.match(transcript, new RegExp(`${platformName}: Virtualized turn 78`));
  }
});

test("Claude sweep captures long-message chats that need more than the old scroll limit", async () => {
  const longText = "Long Claude message detail ".repeat(16).trim();
  const { elements } = createVirtualizedChatElements({
    label: "Claude",
    totalTurns: 82,
    windowSize: 8,
    scrollStride: 1,
    scrollHeight: 31000,
    makeTurn: (index) => new FakeElement({
      text: `Slow virtualized Claude turn ${index}. ${longText}`,
      attrs: index % 2 ? { "data-testid": "user-message" } : { class: "font-claude-response" }
    })
  });
  const hooks = loadPlatformContent(elements, "claude.ai");
  const initialTranscript = hooks.scrapeConversationText();
  assert.equal((initialTranscript.match(/(?:User|Claude): Slow virtualized Claude turn/g) || []).length, 8);

  await hooks.prepareSourceForCapture();
  const transcript = await hooks.scrapeConversationTextWhenReady();

  assert.equal((transcript.match(/(?:User|Claude): Slow virtualized Claude turn/g) || []).length, 82);
  assert.match(transcript, /User: Slow virtualized Claude turn 1/);
  assert.match(transcript, /Claude: Slow virtualized Claude turn 82/);
  assert.ok(transcript.length > 28000, "fixture should represent a long-message Claude chat");
});

test("Claude sweep advances by rendered message boundary when the next virtual batch is available", async () => {
  const elements = [];
  const totalTurns = 40;
  const windowSize = 8;
  let boundaryAdvances = 0;
  const transcriptHost = new FakeElement({
    text: "Rendered Claude messages",
    attrs: { role: "main" }
  });
  elements.push(transcriptHost);

  const renderWindow = (startIndex) => {
    const windowTurns = [];
    for (let index = startIndex + 1; index <= Math.min(totalTurns, startIndex + windowSize); index += 1) {
      const turn = new FakeElement({
        text: `Boundary-loaded Claude turn ${index}`,
        attrs: index % 2 ? { "data-testid": "user-message" } : { class: "font-claude-response" }
      });
      turn.parentElement = transcriptHost;
      turn.onScrollIntoView = () => {
        if (index !== startIndex + windowSize) return;
        boundaryAdvances += 1;
        renderWindow(Math.min(totalTurns - windowSize, startIndex + windowSize));
      };
      windowTurns.push(turn);
    }

    transcriptHost.children = windowTurns;
    transcriptHost.textContent = windowTurns.map((turn) => turn.textContent).join("\n");
    transcriptHost.innerText = transcriptHost.textContent;
    elements.splice(1, elements.length - 1, ...windowTurns);
  };
  renderWindow(0);

  const hooks = loadPlatformContent(elements, "claude.ai");

  await hooks.prepareSourceForCapture();
  const transcript = await hooks.scrapeConversationTextWhenReady();

  assert.equal((transcript.match(/(?:User|Claude): Boundary-loaded Claude turn/g) || []).length, 40);
  assert.match(transcript, /User: Boundary-loaded Claude turn 1/);
  assert.match(transcript, /Claude: Boundary-loaded Claude turn 40/);
  assert.ok(boundaryAdvances > 0, "Claude sweep should use rendered boundary advances");
});

test("Claude sweep waits through slow virtualized batches before declaring stale", async () => {
  const { elements } = createVirtualizedChatElements({
    label: "Claude",
    totalTurns: 16,
    windowSize: 8,
    scrollStride: 1,
    scrollHeight: 9000,
    stalledScrollsBeforeRender: 5,
    makeTurn: (index) => new FakeElement({
      text: `Slow loading Claude batch turn ${index}`,
      attrs: index % 2 ? { "data-testid": "user-message" } : { class: "font-claude-response" }
    })
  });
  const hooks = loadPlatformContent(elements, "claude.ai");

  await hooks.prepareSourceForCapture();
  const transcript = await hooks.scrapeConversationTextWhenReady();

  assert.equal((transcript.match(/(?:User|Claude): Slow loading Claude batch turn/g) || []).length, 16);
  assert.match(transcript, /User: Slow loading Claude batch turn 1/);
  assert.match(transcript, /Claude: Slow loading Claude batch turn 16/);
});

test("ChatGPT sweep handles eight-turn virtualized windows on a large app scroll root", async () => {
  const elements = [];
  const totalTurns = 78;
  const windowSize = 8;
  const appScrollRoot = new FakeElement({
    text: "ChatGPT scroll root",
    attrs: { class: "relative flex-1 overflow-y-auto chat-scroll-area" },
    rect: { width: 980, height: 640, top: 0, left: 0, right: 980, bottom: 640 }
  });
  appScrollRoot.scrollHeight = 4800;
  appScrollRoot.clientHeight = 600;
  appScrollRoot.scrollTop = 0;
  elements.push(appScrollRoot);

  const transcriptHost = new FakeElement({
    text: "Rendered ChatGPT messages",
    attrs: { class: "conversation-turns" }
  });
  elements.push(transcriptHost);

  const makeTurn = (index) => {
    const turn = new FakeElement({
      text: `Detached virtualized GPT turn ${index}`,
      attrs: { "data-message-author-role": index % 2 ? "user" : "assistant" }
    });
    turn.parentElement = transcriptHost;
    return turn;
  };
  const renderWindow = (startIndex) => {
    const windowTurns = [];
    for (let index = startIndex + 1; index <= Math.min(totalTurns, startIndex + windowSize); index += 1) {
      windowTurns.push(makeTurn(index));
    }

    transcriptHost.children = windowTurns;
    transcriptHost.textContent = windowTurns.map((turn) => turn.textContent).join("\n");
    transcriptHost.innerText = transcriptHost.textContent;
    elements.splice(2, elements.length - 2, ...windowTurns);
  };

  const originalScrollTo = appScrollRoot.scrollTo.bind(appScrollRoot);
  appScrollRoot.scrollTo = (...args) => {
    originalScrollTo(...args);
    const startIndex = Math.min(totalTurns - windowSize, Math.floor(appScrollRoot.scrollTop / 360) * windowSize);
    renderWindow(startIndex);
  };
  renderWindow(0);

  const hooks = loadPlatformContent(elements, "chatgpt.com");
  const initialTranscript = hooks.scrapeConversationText();
  assert.equal((initialTranscript.match(/(?:User|ChatGPT): Detached virtualized GPT turn/g) || []).length, 8);

  await hooks.prepareSourceForCapture();
  const transcript = await hooks.scrapeConversationTextWhenReady();

  assert.equal((transcript.match(/(?:User|ChatGPT): Detached virtualized GPT turn/g) || []).length, 78);
  assert.match(transcript, /User: Detached virtualized GPT turn 1/);
  assert.match(transcript, /ChatGPT: Detached virtualized GPT turn 78/);
  assert.equal(appScrollRoot.scrollCalls.some((call) => Number(call?.top || 0) > 0), true);
});

test("ChatGPT sweep advances from rendered message anchors when scroll roots do not expose the next batch", async () => {
  const elements = [];
  const totalTurns = 78;
  const windowSize = 8;
  const transcriptHost = new FakeElement({
    text: "Rendered ChatGPT messages",
    attrs: { class: "conversation-turns" }
  });
  elements.push(transcriptHost);

  const renderWindow = (startIndex) => {
    const windowTurns = [];
    for (let index = startIndex + 1; index <= Math.min(totalTurns, startIndex + windowSize); index += 1) {
      const turn = new FakeElement({
        text: `Anchor-loaded GPT turn ${index}`,
        attrs: { "data-message-author-role": index % 2 ? "user" : "assistant" }
      });
      turn.parentElement = transcriptHost;
      turn.onScrollIntoView = () => {
        if (index !== startIndex + windowSize) return;
        renderWindow(Math.min(totalTurns - windowSize, startIndex + windowSize));
      };
      windowTurns.push(turn);
    }

    transcriptHost.children = windowTurns;
    transcriptHost.textContent = windowTurns.map((turn) => turn.textContent).join("\n");
    transcriptHost.innerText = transcriptHost.textContent;
    elements.splice(1, elements.length - 1, ...windowTurns);
  };
  renderWindow(0);

  const hooks = loadPlatformContent(elements, "chatgpt.com");
  const initialTranscript = hooks.scrapeConversationText();
  assert.equal((initialTranscript.match(/(?:User|ChatGPT): Anchor-loaded GPT turn/g) || []).length, 8);

  await hooks.prepareSourceForCapture();
  const transcript = await hooks.scrapeConversationTextWhenReady();

  assert.equal((transcript.match(/(?:User|ChatGPT): Anchor-loaded GPT turn/g) || []).length, 78);
  assert.match(transcript, /User: Anchor-loaded GPT turn 1/);
  assert.match(transcript, /ChatGPT: Anchor-loaded GPT turn 78/);
});

test("short chats skip the virtualized sweep on supported platforms", async () => {
  const cases = [
    { hostname: "claude.ai", platformName: "Claude" },
    { hostname: "chatgpt.com", platformName: "ChatGPT" },
    { hostname: "gemini.google.com", platformName: "Gemini" },
    { hostname: "grok.com", platformName: "Grok" },
    { hostname: "chat.deepseek.com", platformName: "DeepSeek" }
  ];

  for (const { hostname, platformName } of cases) {
    const elements = [];
    const scrollableRoot = new FakeElement({
      text: `Scrollable ${platformName} chat root`,
      attrs: { role: "main" }
    });
    scrollableRoot.scrollHeight = 2400;
    scrollableRoot.clientHeight = 600;
    scrollableRoot.scrollTop = 0;
    elements.push(scrollableRoot);

    for (let index = 1; index <= 4; index += 1) {
      const turn = new FakeElement({
        text: `Short turn ${index}`,
        attrs: { "data-message-author-role": index % 2 ? "user" : "assistant" }
      });
      turn.parentElement = scrollableRoot;
      scrollableRoot.children.push(turn);
      elements.push(turn);
    }
    scrollableRoot.textContent = scrollableRoot.children.map((turn) => turn.textContent).join("\n");
    scrollableRoot.innerText = scrollableRoot.textContent;

    const hooks = loadPlatformContent(elements, hostname);

    await hooks.prepareSourceForCapture();
    scrollableRoot.scrollCalls = [];
    const transcript = await hooks.scrapeConversationTextWhenReady();

    assert.equal(
      (transcript.match(new RegExp(`(?:User|${platformName}): Short turn`, "g")) || []).length,
      4,
      `${platformName} should capture the short chat`
    );
    assert.equal(
      scrollableRoot.scrollCalls.some((call) => Number(call?.top || 0) > 0),
      false,
      `${platformName} should not scroll downward for short chats`
    );
  }
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

test("source capture prep scrolls conversation containers to the top instantly", async () => {
  const scrollableRoot = new FakeElement({
    text: "Scrollable chat root",
    attrs: { role: "main" }
  });
  scrollableRoot.scrollHeight = 1800;
  scrollableRoot.clientHeight = 500;
  scrollableRoot.scrollTop = 740;
  const hooks = loadPlatformContent([scrollableRoot]);

  await hooks.prepareSourceForCapture();

  assert.equal(scrollableRoot.scrollTop, 0);
  assert.equal(scrollableRoot.scrollCalls[0].behavior, "instant");
});

test("source capture prep waits until delayed older messages finish loading", async () => {
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
  const transcript = hooks.scrapeConversationText();

  assert.match(transcript, /Older message 1/);
  assert.match(transcript, /Older message 20/);
  assert.match(transcript, /Visible message 24/);
  assert.equal((transcript.match(/(?:Older|Visible) message/g) || []).length, 24);
});

test("source capture prep waits when message characters grow without a new turn", async () => {
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

test("transfer safety window covers long quality summaries", () => {
  const source = fs.readFileSync(SOURCE_PATH, "utf8");

  assert.match(source, /const RUNNING_AUTO_RESET_MS = 240000/);
});

test("latest-run receipt preserves the Mistral fallback chain", () => {
  const source = fs.readFileSync(SOURCE_PATH, "utf8");

  assert.match(source, /mistralModelsTried:\s*sanitizeModelChainForStats/);
  assert.match(source, /function sanitizeModelChainForStats/);
});

test("paste verification accepts stable context anchors when box characters differ", () => {
  const hooks = loadPlatformContent([]);
  const expected = [
    "CONTEXT CARRY - READY TO PASTE",
    "",
    "WHO I AM",
    "Building Context Generator.",
    "",
    "WHAT WE WERE DOING",
    "Testing paste verification."
  ].join("\n");
  const editor = new FakeElement({
    text: "CONTEXT CARRY READY TO PASTE\n\nWHO I AM\nBuilding Context Generator."
  });

  assert.equal(hooks.editorContainsText(editor, expected), true);
});

test("paste verification rejects unrelated editor text", () => {
  const hooks = loadPlatformContent([]);
  const editor = new FakeElement({ text: "A blank new chat input" });

  assert.equal(hooks.editorContainsText(editor, "CONTEXT CARRY\n\nWHO I AM\nProject details"), false);
});

test("startup clears stale Claude placement transform reservations", () => {
  const shiftedActionRow = new FakeElement({
    attrs: { "data-context-generator-original-transform": "" }
  });
  shiftedActionRow.style.transform = "translateX(-56px)";
  shiftedActionRow.style.willChange = "transform";

  loadPlatformContent([shiftedActionRow], "claude.ai");

  assert.equal(shiftedActionRow.style.transform, "");
  assert.equal(shiftedActionRow.style.willChange, "");
  assert.equal(shiftedActionRow.hasAttribute("data-context-generator-original-transform"), false);
});

test("Claude bubble fills the inline slot to the right of voice mode", () => {
  const voiceMode = new FakeElement({
    tag: "button",
    attrs: { "aria-label": "Voice mode" },
    rect: { left: 700, right: 736, top: 166, bottom: 202, width: 36, height: 36 }
  });
  const hooks = loadPlatformContent([voiceMode], "claude.ai");
  const placement = hooks.getClaudeBubblePlacement(getClaudeComposerRect());

  assert.equal(placement.anchorControl.element, voiceMode);
  assert.equal(placement.left, 734);
  assert.equal(placement.top, 63);
  assert.equal(placement.inlineShift, 0);
});

test("Claude bubble uses the rightmost small control when voice mode is unlabeled", () => {
  const mic = new FakeElement({
    tag: "button",
    attrs: { "aria-label": "Microphone" },
    rect: { left: 656, right: 692, top: 166, bottom: 202, width: 36, height: 36 }
  });
  const unlabeledVoiceMode = new FakeElement({
    tag: "button",
    rect: { left: 700, right: 736, top: 166, bottom: 202, width: 36, height: 36 }
  });
  const hooks = loadPlatformContent([mic, unlabeledVoiceMode], "claude.ai");
  const placement = hooks.getClaudeBubblePlacement(getClaudeComposerRect());

  assert.equal(placement.anchorControl.element, unlabeledVoiceMode);
  assert.equal(placement.left, 734);
  assert.equal(placement.top, 63);
  assert.equal(placement.inlineShift, 0);
});

test("Claude normal row nudges model left and mic/voice right", () => {
  const model = new FakeElement({
    tag: "button",
    attrs: { "aria-label": "Model selector" },
    rect: { left: 520, right: 640, top: 166, bottom: 202, width: 120, height: 36 }
  });
  const mic = new FakeElement({
    tag: "button",
    attrs: { "aria-label": "Microphone" },
    rect: { left: 656, right: 692, top: 166, bottom: 202, width: 36, height: 36 }
  });
  const voiceMode = new FakeElement({
    tag: "button",
    attrs: { "aria-label": "Voice mode" },
    rect: { left: 700, right: 736, top: 166, bottom: 202, width: 36, height: 36 }
  });
  const hooks = loadPlatformContent([model, mic, voiceMode], "claude.ai");
  const placement = hooks.getClaudeBubblePlacement(getClaudeComposerRect());
  const bubbleRect = localPlacementToPageRect(placement, getClaudeComposerRect());
  const shiftedControls = hooks.getClaudeInlineControlsToShift(placement.controls, placement.anchorControl);
  const modelControls = hooks.getClaudeModelControlsToNudge(placement.controls, placement.anchorControl);

  assert.equal(placement.inlineShift, 0);
  assert.equal(hooks.getClaudeControlTargetOffset(modelControls[0], placement.inlineShift), -48);
  assert.equal(hooks.getClaudeControlTargetOffset(shiftedControls[0], placement.inlineShift), 52);
  assert.equal(hooks.getClaudeControlTargetOffset(shiftedControls[1], placement.inlineShift), 52);
  [model, mic, voiceMode].forEach((control) => {
    assert.equal(rectsIntersect(bubbleRect, control.getBoundingClientRect()), false);
  });
});

test("Claude model nudge keeps the label from clipping", () => {
  const modelClipParent = new FakeElement({
    rect: { left: 520, right: 640, top: 166, bottom: 202, width: 120, height: 36 }
  });
  modelClipParent.style.overflow = "hidden";

  const model = new FakeElement({
    tag: "button",
    text: "Sonnet 5 Medium",
    attrs: { "aria-label": "Model selector" },
    rect: { left: 520, right: 640, top: 166, bottom: 202, width: 120, height: 36 }
  });
  model.parentElement = modelClipParent;
  modelClipParent.children = [model];

  const mic = new FakeElement({
    tag: "button",
    attrs: { "aria-label": "Microphone" },
    rect: { left: 656, right: 692, top: 166, bottom: 202, width: 36, height: 36 }
  });
  const voiceMode = new FakeElement({
    tag: "button",
    attrs: { "aria-label": "Voice mode" },
    rect: { left: 700, right: 736, top: 166, bottom: 202, width: 36, height: 36 }
  });
  const hooks = loadPlatformContent([model, mic, voiceMode], "claude.ai");
  model.style.overflow = "hidden";
  const placement = hooks.getClaudeBubblePlacement(getClaudeComposerRect());

  hooks.reserveClaudeInlineBubbleSlot(placement.anchorControl, placement.controls, null, getClaudeComposerRect(), placement.inlineShift);

  assert.equal(model.style.overflow, "visible");
  assert.equal(modelClipParent.style.overflow, "visible");
  assert.equal(model.getAttribute("data-context-generator-original-overflow"), "hidden");
  assert.equal(modelClipParent.getAttribute("data-context-generator-original-overflow"), "hidden");
});

test("Claude crowded row shifts only small voice-side controls", () => {
  const model = new FakeElement({
    tag: "button",
    text: "Sonnet 5 Medium",
    attrs: { "aria-label": "Model selector" },
    rect: { left: 672, right: 792, top: 166, bottom: 202, width: 120, height: 36 }
  });
  const mic = new FakeElement({
    tag: "button",
    attrs: { "aria-label": "Microphone" },
    rect: { left: 800, right: 836, top: 166, bottom: 202, width: 36, height: 36 }
  });
  const voiceMode = new FakeElement({
    tag: "button",
    attrs: { "aria-label": "Voice mode" },
    rect: { left: 844, right: 880, top: 166, bottom: 202, width: 36, height: 36 }
  });
  const hooks = loadPlatformContent([model, mic, voiceMode], "claude.ai");
  const placement = hooks.getClaudeBubblePlacement(getClaudeComposerRect());
  const shiftedControls = hooks.getClaudeInlineControlsToShift(placement.controls, placement.anchorControl);

  assert.equal(placement.anchorControl.element, voiceMode);
  assert.equal(placement.left, 754);
  assert.equal(placement.inlineShift, 104);
  assert.equal(shiftedControls.length, 2);
  assert.equal(shiftedControls[0].element, mic);
  assert.equal(shiftedControls[1].element, voiceMode);
  assert.equal(shiftedControls.some((control) => control.element === model), false);
  assert.equal(hooks.getClaudeControlTargetOffset(shiftedControls[0], placement.inlineShift), -52);
  assert.equal(hooks.getClaudeControlTargetOffset(shiftedControls[1], placement.inlineShift), -52);
});

test("Claude typed-state send button does not shift the model selector", () => {
  const model = new FakeElement({
    tag: "button",
    text: "Sonnet 5 Medium",
    attrs: { "aria-label": "Model selector" },
    rect: { left: 672, right: 792, top: 166, bottom: 202, width: 120, height: 36 }
  });
  const send = new FakeElement({
    tag: "button",
    attrs: { "aria-label": "Send message" },
    rect: { left: 844, right: 880, top: 166, bottom: 202, width: 36, height: 36 }
  });
  const hooks = loadPlatformContent([model, send], "claude.ai");
  const placement = hooks.getClaudeBubblePlacement(getClaudeComposerRect());
  const shiftedControls = hooks.getClaudeInlineControlsToShift(placement.controls, placement.anchorControl);

  assert.equal(placement.anchorControl.element, send);
  assert.equal(placement.left, 754);
  assert.equal(placement.inlineShift, 104);
  assert.equal(shiftedControls.length, 1);
  assert.equal(shiftedControls[0].element, send);
  assert.equal(shiftedControls.some((control) => control.element === model), false);
  assert.equal(hooks.getClaudeControlTargetOffset(shiftedControls[0], placement.inlineShift), -52);
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

test("versioned evaluation set gates capture completeness and fixture latency", () => {
  const evaluation = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "evaluation", "cases.json"), "utf8")
  );

  for (const testCase of evaluation.cases) {
    const elements = testCase.turns.map((turn) => new FakeElement({
      text: turn.text,
      attrs: { "data-message-author-role": turn.role }
    }));
    const startedAt = process.hrtime.bigint();
    const transcript = loadPlatformContent(elements, testCase.platform).scrapeConversationText();
    const captureMs = Number(process.hrtime.bigint() - startedAt) / 1e6;

    for (const turn of testCase.turns) {
      assert.ok(transcript.includes(turn.text), testCase.id + " lost a captured turn");
    }
    assert.equal(
      (transcript.match(/^(?:User|Claude|ChatGPT): /gm) || []).length,
      testCase.turns.length,
      testCase.id + " changed the captured turn count"
    );
    assert.ok(captureMs <= 250, testCase.id + " capture took " + captureMs.toFixed(1) + "ms");
  }
});

function getClaudeComposerRect() {
  return { left: 100, right: 900, top: 100, bottom: 220, width: 800, height: 120 };
}

function localPlacementToPageRect(placement, composerRect) {
  return {
    left: composerRect.left + placement.left,
    right: composerRect.left + placement.left + 42,
    top: composerRect.top + placement.top,
    bottom: composerRect.top + placement.top + 42
  };
}

function rectsIntersect(first, second) {
  return (
    first.left < second.right &&
    first.right > second.left &&
    first.top < second.bottom &&
    first.bottom > second.top
  );
}
