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
    if (/input|textarea|button|select/.test(selector) && /^(input|textarea|button|select)$/.test(this.localName)) {
      return true;
    }
    if (selector.includes("[contenteditable='true']") && this.attrs.contenteditable === "true") {
      return true;
    }
    return false;
  }

  closest() {
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

  querySelectorAll() {
    return [];
  }

  getBoundingClientRect() {
    return this.rect;
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
    __CONTEXT_GENERATOR_TEST_HOOKS__: {
      register(value) {
        hooks = value;
      }
    },
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
    performance: { now: () => 0 },
    addEventListener: () => {},
    removeEventListener: () => {},
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
  assert.equal(placement.left, 692);
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
  assert.equal(placement.left, 692);
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
  assert.equal(hooks.getClaudeControlTargetOffset(modelControls[0], placement.inlineShift), -42);
  assert.equal(hooks.getClaudeControlTargetOffset(shiftedControls[0], placement.inlineShift), 44);
  assert.equal(hooks.getClaudeControlTargetOffset(shiftedControls[1], placement.inlineShift), 44);
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
  assert.equal(placement.inlineShift, 82);
  assert.equal(shiftedControls.length, 2);
  assert.equal(shiftedControls[0].element, mic);
  assert.equal(shiftedControls[1].element, voiceMode);
  assert.equal(shiftedControls.some((control) => control.element === model), false);
  assert.equal(hooks.getClaudeControlTargetOffset(shiftedControls[0], placement.inlineShift), -38);
  assert.equal(hooks.getClaudeControlTargetOffset(shiftedControls[1], placement.inlineShift), -38);
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
  assert.equal(placement.inlineShift, 82);
  assert.equal(shiftedControls.length, 1);
  assert.equal(shiftedControls[0].element, send);
  assert.equal(shiftedControls.some((control) => control.element === model), false);
  assert.equal(hooks.getClaudeControlTargetOffset(shiftedControls[0], placement.inlineShift), -38);
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
