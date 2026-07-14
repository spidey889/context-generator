const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SOURCE_PATH = path.join(__dirname, "..", "extension", "platform-content.js");
const MANIFEST_PATH = path.join(__dirname, "..", "extension", "manifest.json");

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

function loadPlatformContent(elements = [], hostname = "chatgpt.com", { expectSupported = true } = {}) {
  nextOrder = 1;
  let hooks = null;
  const document = {
    body: new FakeElement({ tag: "body" }),
    documentElement: new FakeElement({ tag: "html" }),
    activeElement: null,
    getElementById: () => null,
    querySelectorAll: (selector = "*") => {
      const isEditorSelector = /contenteditable|textarea|prompt-textarea|grokinput|grok-input|chat-input/i.test(selector);
      return isEditorSelector ? elements.filter((element) => element.matches(selector)) : elements;
    },
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
    HTMLTextAreaElement: FakeHTMLTextAreaElement,
    HTMLInputElement: FakeHTMLInputElement,
    Node: { DOCUMENT_POSITION_PRECEDING: 2 },
    setTimeout,
    clearTimeout
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SOURCE_PATH, "utf8"), sandbox, { filename: SOURCE_PATH });
  if (expectSupported) {
    assert.ok(hooks, "platform-content test hooks were registered");
  }
  return hooks;
}

test("ChatGPT startup excludes ordinary OpenAI pages", () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const platformContent = manifest.content_scripts.find((entry) => entry.js.includes("platform-content.js"));
  const platformResources = manifest.web_accessible_resources.find((entry) => entry.resources.includes("bubble-icon.png"));
  const matchGroups = [manifest.host_permissions, platformContent.matches, platformResources.matches];

  for (const matches of matchGroups) {
    assert.ok(matches.includes("https://chatgpt.com/*"));
    assert.ok(matches.includes("https://*.chatgpt.com/*"));
    assert.ok(matches.includes("https://chat.openai.com/*"));
    assert.equal(matches.includes("https://openai.com/*"), false);
    assert.equal(matches.includes("https://*.openai.com/*"), false);
  }

  assert.equal(loadPlatformContent([], "openai.com", { expectSupported: false }), null);
  assert.equal(loadPlatformContent([], "www.openai.com", { expectSupported: false }), null);
  assert.equal(loadPlatformContent([], "auth.chat.openai.com", { expectSupported: false }), null);
  assert.ok(loadPlatformContent([], "chat.openai.com"));
});

test("conversation scraping rejects an empty chat", () => {
  const hooks = loadPlatformContent([]);

  assert.throws(
    () => hooks.scrapeConversationText(),
    /Chat is empty\. Send one message first/
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
  assert.ok(pickerEmptyGuard < pickerSource.indexOf("showOverlay(destinationId)"));
  assert.ok(pickerEmptyGuard < pickerSource.indexOf("prepareDestinationTab(destinationId, trace)"));
  assert.match(pickerSource.slice(pickerEmptyGuard), /showErrorOverlay\(NO_CONVERSATION_ERROR_MESSAGE\)/);

  const flowStart = source.indexOf("async function runContextFlow(");
  const flowEnd = source.indexOf("function showContextTransferFailure(", flowStart);
  const flowSource = source.slice(flowStart, flowEnd);
  const flowEmptyGuard = flowSource.indexOf("getDetectedConversationMessageCount() === 0");

  assert.ok(flowStart >= 0 && flowEnd > flowStart);
  assert.ok(flowEmptyGuard >= 0, "toolbar transfer must check for zero real messages");
  assert.ok(flowEmptyGuard < flowSource.indexOf("showOverlay(destinationId)"));
  assert.ok(flowEmptyGuard < flowSource.indexOf("prepareDestinationTab(destinationId, transferTrace)"));
  assert.match(flowSource.slice(flowEmptyGuard), /NO_CONVERSATION_ERROR_MESSAGE/);
});

test("handoff status rotation preserves only real transfer stages", () => {
  const source = fs.readFileSync(SOURCE_PATH, "utf8");
  const fillerPhrases = [
    "I don't like waiting either",
    "This is for better context",
    "Keeping the thread intact",
    "Saving you the re-explain",
    "Making the next reply sharper",
    "Almost ready"
  ];

  for (const phrase of fillerPhrases) {
    assert.equal(source.includes(phrase), false, `removed filler must stay absent: ${phrase}`);
  }

  for (const stage of ["Reading source chat", "Summarizing context", "Preparing ${destination?.name || \"destination\"}", "Pasting context into ${destination?.name || \"destination\"}"]) {
    assert.equal(source.includes(stage), true, `real transfer stage must remain: ${stage}`);
  }

  const cycleStart = source.indexOf("function startHandoffStatusCycle()");
  const cycleEnd = source.indexOf("function setHandoffStatus(text)", cycleStart);
  const cycleSource = source.slice(cycleStart, cycleEnd);

  assert.ok(cycleStart >= 0 && cycleEnd > cycleStart);
  assert.match(cycleSource, /window\.setInterval/);
  assert.match(cycleSource, /HANDOFF_STATUS_INTERVAL_MS/);
  assert.match(cycleSource, /currentStatus/);
  assert.match(cycleSource, /setHandoffStatus\(currentStatus\)/);
  assert.match(source, /contextGeneratorStatusShimmer 1\.72s cubic-bezier\(0\.16,1,0\.3,1\) both/);
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

test("final capture safety removes exact duplicate role and text turns", () => {
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

  assert.equal((transcript.match(/User: Please retry that exact operation\./g) || []).length, 1);
  assert.equal(hooks.getConversationTurns().length, 3);
});

test("sequence merge keeps positional duplicates until the final capture safety pass", () => {
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

test("sequence alignment does not confuse numeric message prefixes", () => {
  const hooks = loadPlatformContent([]);
  const collected = [{ role: "User", text: "Boundary-loaded diagnostic turn 1" }];

  const added = hooks.collectRenderedConversationTurns(collected, [
    { role: "User", text: "Boundary-loaded diagnostic turn 10" }
  ]);

  assert.equal(added, 1);
  assert.equal(collected.length, 2);
});

test("virtual sweep does not append the same 38 turns when one rendered response grows between snapshots", () => {
  const hooks = loadPlatformContent([], "claude.ai");
  const collected = [];
  const baseTurns = Array.from({ length: 38 }, (_, index) => ({
    role: index % 2 === 0 ? "User" : "Claude",
    text: `${index % 2 === 0 ? "Question" : "Answer"} for real turn ${index + 1}.`
  }));

  for (let snapshot = 1; snapshot <= 7; snapshot += 1) {
    const renderedTurns = baseTurns.map((turn) => ({ ...turn }));
    renderedTurns[17].text = `Answer for real turn 18. ${"Newly rendered detail. ".repeat(snapshot)}`.trim();
    hooks.collectRenderedConversationTurns(collected, renderedTurns);
  }

  assert.equal(collected.length, 38);
  assert.match(collected[17].text, /Newly rendered detail\.(?: Newly rendered detail\.){6}$/);
});

test("virtual sweep merges sliding windows when an overlapping response becomes richer", () => {
  const hooks = loadPlatformContent([], "claude.ai");
  const collected = [];
  const turns = Array.from({ length: 13 }, (_, index) => ({
    role: index % 2 === 0 ? "User" : "Claude",
    text: `${index % 2 === 0 ? "Question" : "Answer"} for sliding turn ${index + 1}.`
  }));
  const firstWindow = turns.slice(0, 8).map((turn) => ({ ...turn }));
  const secondWindow = turns.slice(5, 13).map((turn) => ({ ...turn }));
  secondWindow[1].text += " Additional Markdown content rendered after scrolling.";

  hooks.collectRenderedConversationTurns(collected, firstWindow);
  hooks.collectRenderedConversationTurns(collected, secondWindow);

  assert.equal(collected.length, 13);
  assert.match(collected[6].text, /Additional Markdown content rendered after scrolling\.$/);
});

test("virtual sweep inserts a new turn between matching interior blocks", () => {
  const hooks = loadPlatformContent([], "claude.ai");
  const canonicalTurns = Array.from({ length: 38 }, (_, index) => ({
    role: index % 2 === 0 ? "User" : "Claude",
    text: `Exact diagnostic turn ${index + 1}.`
  }));
  const collected = canonicalTurns.filter((_, index) => index !== 18).map((turn) => ({ ...turn }));
  const interiorSnapshot = canonicalTurns.slice(10, 27).map((turn) => ({ ...turn }));

  const added = hooks.collectRenderedConversationTurns(collected, interiorSnapshot);

  assert.equal(added, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(collected)), canonicalTurns);
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

test("Claude counts one role-bearing assistant wrapper as one turn instead of its paragraph fragments", () => {
  const userTurn = new FakeElement({
    text: "Explain the investigation in detail.",
    attrs: { "data-testid": "user-message" }
  });
  const assistantWrapper = new FakeElement({
    attrs: { "data-testid": "assistant-message", class: "assistant-message" }
  });
  const paragraphs = Array.from({ length: 10 }, (_, index) => new FakeElement({
    text: `Assistant paragraph ${index + 1} with distinct investigation detail.`,
    attrs: { class: "font-claude-response" }
  }));
  assistantWrapper.children = paragraphs;
  assistantWrapper.textContent = paragraphs.map((paragraph) => paragraph.textContent).join("\n");
  assistantWrapper.innerText = assistantWrapper.textContent;
  paragraphs.forEach((paragraph) => {
    paragraph.parentElement = assistantWrapper;
  });

  const hooks = loadPlatformContent([userTurn, assistantWrapper, ...paragraphs], "claude.ai");
  const turns = hooks.getConversationTurns();
  const transcript = hooks.scrapeConversationText();

  assert.equal(turns.length, 2);
  assert.equal((transcript.match(/Claude:/g) || []).length, 1);
  assert.match(transcript, /Assistant paragraph 1/);
  assert.match(transcript, /Assistant paragraph 10/);
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

test("transfer capture sweeps virtualized chats even when the first rendered window is below the old threshold", async () => {
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
    const { elements } = createVirtualizedChatElements({
      label: platformName,
      makeTurn,
      windowSize: 4,
      scrollHeight: 8000
    });
    const hooks = loadPlatformContent(elements, hostname);

    const initialTranscript = hooks.scrapeConversationText();
    assert.equal(
      (initialTranscript.match(new RegExp(`(?:User|${platformName}): Virtualized turn`, "g")) || []).length,
      4,
      `${platformName} fixture must begin below the old eight-turn sweep threshold`
    );

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

test("transfer capture keeps fuller swept text when the turn count matches the quick capture", async () => {
  const elements = [];
  const scrollableRoot = new FakeElement({
    text: "Scrollable ChatGPT chat root",
    attrs: { role: "main" }
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

test("virtual sweep gives the rendered page time to settle between scroll advances", async () => {
  const { elements, scrollableRoot } = createVirtualizedChatElements({
    label: "ChatGPT",
    totalTurns: 16,
    windowSize: 4,
    scrollHeight: 3200,
    makeTurn: (index) => new FakeElement({
      text: `Paced virtualized turn ${index}`,
      attrs: { "data-message-author-role": index % 2 ? "user" : "assistant" }
    })
  });
  const hooks = loadPlatformContent(elements, "chatgpt.com");

  await hooks.prepareSourceForCapture();
  const positiveScrollTimes = [];
  const virtualizedScrollTo = scrollableRoot.scrollTo.bind(scrollableRoot);
  scrollableRoot.scrollTo = (...args) => {
    const requestedTop = typeof args[0] === "object" ? Number(args[0]?.top || 0) : Number(args[1] || 0);
    if (requestedTop > Number(scrollableRoot.scrollTop || 0)) positiveScrollTimes.push(Date.now());
    virtualizedScrollTo(...args);
  };

  const transcript = await hooks.scrapeConversationTextWhenReady();
  const gaps = positiveScrollTimes.slice(1).map((time, index) => time - positiveScrollTimes[index]);

  assert.equal((transcript.match(/(?:User|ChatGPT): Paced virtualized turn/g) || []).length, 16);
  assert.ok(gaps.length >= 2, "fixture should require multiple downward scroll advances");
  assert.ok(
    gaps.every((gap) => gap >= 250),
    `each scroll advance should leave a real render window; observed gaps: ${gaps.join(", ")}ms`
  );
});

test("physical scroll movement prevents a premature stale exit on non-Claude chats", async () => {
  const { elements } = createVirtualizedChatElements({
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
  const hooks = loadPlatformContent(elements, "chatgpt.com");

  await hooks.prepareSourceForCapture();
  const transcript = await hooks.scrapeConversationTextWhenReady();

  assert.equal((transcript.match(/(?:User|ChatGPT): Delayed tall-message turn/g) || []).length, 16);
  assert.match(transcript, /User: Delayed tall-message turn 1/);
  assert.match(transcript, /ChatGPT: Delayed tall-message turn 16/);
});

test("Claude sweep captures a real-scale 78-turn long chat with paced advances", async () => {
  const longText = "Long Claude message detail ".repeat(28).trim();
  const { elements, scrollableRoot } = createVirtualizedChatElements({
    label: "Claude",
    totalTurns: 78,
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
  const advanceTimes = [];
  const virtualizedScrollTo = scrollableRoot.scrollTo.bind(scrollableRoot);
  scrollableRoot.scrollTo = (...args) => {
    const beforeTop = scrollableRoot.scrollTop;
    virtualizedScrollTo(...args);
    if (scrollableRoot.scrollTop > beforeTop) advanceTimes.push(Date.now());
  };
  const captureStartedAt = Date.now();
  const transcript = await hooks.scrapeConversationTextWhenReady();
  const captureMs = Date.now() - captureStartedAt;
  const advanceGaps = advanceTimes.slice(1).map((time, index) => time - advanceTimes[index]);
  console.log("real-scale sweep metrics", {
    turns: 78,
    chars: transcript.length,
    steps: advanceTimes.length,
    captureMs,
    minStepGapMs: Math.min(...advanceGaps),
    averageStepGapMs: Math.round(advanceGaps.reduce((total, gap) => total + gap, 0) / advanceGaps.length)
  });

  assert.equal((transcript.match(/(?:User|Claude): Slow virtualized Claude turn/g) || []).length, 78);
  assert.match(transcript, /User: Slow virtualized Claude turn 1/);
  assert.match(transcript, /Claude: Slow virtualized Claude turn 78/);
  assert.ok(transcript.length > 60000, "fixture should represent a 60k-character long chat");
  assert.ok(advanceTimes.length <= 62, `adaptive overlap steps should keep this sweep at 62 advances or fewer; saw ${advanceTimes.length}`);
  assert.ok(
    advanceGaps.every((gap) => gap >= 250),
    `real-scale sweep must preserve the paced render window; observed gaps: ${advanceGaps.join(", ")}ms`
  );
});

test("Claude sweep crosses one oversized rendered message before concluding capture is complete", async () => {
  const elements = [];
  const totalTurns = 24;
  const windowSize = 12;
  const nextWindowScrollTop = 3961;
  const oversizedLines = Array.from(
    { length: 220 },
    (_, index) => `Rendered oversized-message line ${index + 1}`
  );
  let renderedSecondWindow = false;
  const scrollableRoot = new FakeElement({
    text: "Scrollable Claude chat with one oversized message",
    attrs: { role: "main" }
  });
  scrollableRoot.scrollHeight = 5200;
  scrollableRoot.clientHeight = 600;
  scrollableRoot.scrollTop = 0;
  elements.push(scrollableRoot);

  const renderWindow = (startIndex) => {
    const windowTurns = [];
    for (let index = startIndex + 1; index <= Math.min(totalTurns, startIndex + windowSize); index += 1) {
      const text = index === 6
        ? `Oversized Claude turn ${index}\n${oversizedLines.join("\n")}`
        : `Normal Claude turn ${index}`;
      const turn = new FakeElement({
        text,
        attrs: index % 2 ? { "data-testid": "user-message" } : { class: "font-claude-response" }
      });
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
    if (!renderedSecondWindow && scrollableRoot.scrollTop >= nextWindowScrollTop) {
      renderedSecondWindow = true;
      renderWindow(windowSize);
    }
  };
  renderWindow(0);

  const hooks = loadPlatformContent(elements, "claude.ai");
  await hooks.prepareSourceForCapture();
  const transcript = await hooks.scrapeConversationTextWhenReady();

  assert.equal(oversizedLines.length, 220, "fixture must include a 200+ rendered-line message");
  assert.equal((transcript.match(/(?:User|Claude): (?:Normal|Oversized) Claude turn/g) || []).length, 24);
  assert.match(transcript, /User: Normal Claude turn 1/);
  assert.match(transcript, /Claude: Normal Claude turn 24/);
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

test("short chats use the same sweep and exit when there is no more content to capture", async () => {
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
    scrollableRoot.scrollHeight = 600;
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
    scrollableRoot.children.forEach((turn) => {
      turn.scrollIntoViewCalls = [];
    });
    const transcript = await hooks.scrapeConversationTextWhenReady();

    assert.equal(
      (transcript.match(new RegExp(`(?:User|${platformName}): Short turn`, "g")) || []).length,
      4,
      `${platformName} should capture the short chat`
    );
    assert.equal(
      scrollableRoot.scrollCalls.some((call) => Number(call?.top || 0) > 0),
      false,
      `${platformName} should not scroll downward when no scroll range remains`
    );
    assert.equal(
      scrollableRoot.children.some((turn) => turn.scrollIntoViewCalls.length > 0),
      true,
      `${platformName} should still probe the rendered boundary before finishing`
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

test("latest-run receipt preserves the exact raw scraped text", () => {
  const hooks = loadPlatformContent([]);
  const exactText = "Claude conversation:\n\nUser: Keep <tags>, & symbols, 'quotes', and line breaks.\n\nClaude: Exactly.";
  const trace = hooks.createTransferTrace("chatgpt", "test");

  hooks.markCaptureDone(trace, exactText);
  const stats = hooks.buildLatestTransferStats(trace, 25);

  assert.equal(stats.rawScrapedText, exactText);
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
