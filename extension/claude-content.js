(() => {
  if (window.__contextGeneratorClaudeLoaded) {
    return;
  }

  window.__contextGeneratorClaudeLoaded = true;
  let isRunning = false;
  const RESPONSE_TIMEOUT_MS = 60000;
  const TEXT_STABLE_AFTER_GENERATING_MS = 1500;
  const TEXT_STABLE_WITHOUT_INDICATOR_MS = 5000;

  const CONTEXT_GENERATOR_PROMPT = `---
name: context-generator
description: Type /context-generator to summarize your chat into a portable context block you can paste into any AI and continue where you left off.
---
# Context Generator Skill

## Trigger
When user types \`/context-generator\`, execute the instructions below immediately.

---

## Instructions

You are a context summarizer. Your job is to compress this entire conversation into a portable context block that any AI (ChatGPT, Gemini, Claude, etc.) can read and immediately continue from — without losing anything important.

When \`/context-generator\` is triggered, output EXACTLY this structure and nothing else:

---

\`\`\`
╔══════════════════════════════════════════╗
║         CONTEXT CARRY — READY TO PASTE        ║
╚══════════════════════════════════════════╝

🧠 WHO I AM
[2-3 lines: user's name if mentioned, what they're building, their background/role]

🎯 WHAT WE WERE DOING
[2-4 lines: the main goal or task of this conversation]

📍 WHERE WE LEFT OFF
[2-3 lines: the exact point the conversation stopped — last decision made, last thing discussed]

✅ DECISIONS MADE
[Bullet list of every important decision, choice, or conclusion reached]

⚠️ OPEN QUESTIONS
[Bullet list of things still unresolved or mid-discussion — if none, write "None"]

📦 KEY CONTEXT
[Any important details the new AI must know to help properly — tools being used, constraints, preferences, style, tone, etc.]

🔁 NEXT STEP
[One clear sentence: exactly what the user needs to do or ask next]

---
💬 PASTE THIS AT THE TOP OF YOUR NEW CHAT
Then write: "Continue from where we left off."
\`\`\`

---

## Rules

- Do NOT summarize everything — only what matters to continue
- Do NOT be vague — be specific (use actual names, tools, decisions)
- Keep total output under 400 words
- No fluff, no intros, no "here is your context" — just output the block
- If conversation is too short to summarize, say: "Chat too short — no context needed yet. Use this when you're deeper into a session."`;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "START_CONTEXT_TRANSFER") {
      return false;
    }

    if (isRunning) {
      sendResponse({ ok: false, error: "Context transfer is already running." });
      return false;
    }

    isRunning = true;
    sendResponse({ ok: true });

    runClaudeFlow()
      .then((text) => notifyBackground({ type: "TRANSFER_TO_CHATGPT", text }))
      .catch((error) => notifyBackground({ type: "CONTEXT_TRANSFER_ERROR", error: error.message }))
      .finally(() => {
        isRunning = false;
      });

    return false;
  });

  async function notifyBackground(message) {
    try {
      await chrome.runtime.sendMessage(message);
    } catch (error) {
      console.error("[Context Generator Relay]", error);
    }
  }

  async function runClaudeFlow() {
    const beforeText = getClaudeResponseText();
    const input = await waitForElement(findClaudeInput, 20000, "Claude chat input");

    setEditorText(input, CONTEXT_GENERATOR_PROMPT);

    const sendButton = await waitForElement(() => findSendButton(input), 10000, "Claude send button");
    sendButton.click();

    return waitForClaudeResponse(beforeText);
  }

  async function waitForClaudeResponse(beforeText) {
    let latestText = "";
    let lastChangedAt = Date.now();
    let sawGenerating = false;
    const startedAt = Date.now();

    while (Date.now() - startedAt < RESPONSE_TIMEOUT_MS) {
      const text = getClaudeResponseText();
      const isGenerating = isClaudeGenerating();
      const isNewResponse = text && text !== beforeText && !looksLikePromptEcho(text);
      sawGenerating = sawGenerating || isGenerating;

      if (isNewResponse && text !== latestText) {
        latestText = text;
        lastChangedAt = Date.now();
      }

      if (latestText && hasClaudeFinishedGenerating(isGenerating, sawGenerating, lastChangedAt)) {
        return latestText.trim();
      }

      await sleep(500);
    }

    if (latestText && hasClaudeFinishedGenerating(isClaudeGenerating(), sawGenerating, lastChangedAt)) {
      return latestText.trim();
    }

    throw new Error("Timed out waiting for Claude to finish responding.");
  }

  function hasClaudeFinishedGenerating(isGenerating, sawGenerating, lastChangedAt) {
    const stableForMs = Date.now() - lastChangedAt;
    const requiredStableMs = sawGenerating
      ? TEXT_STABLE_AFTER_GENERATING_MS
      : TEXT_STABLE_WITHOUT_INDICATOR_MS;

    return !isGenerating && stableForMs >= requiredStableMs;
  }

  function findClaudeInput() {
    const selectors = [
      "textarea",
      "[contenteditable='true'][data-placeholder]",
      "[contenteditable='true'][aria-label*='prompt' i]",
      "[contenteditable='true'][aria-label*='message' i]",
      "[contenteditable='true']"
    ];

    return selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .find((element) => isVisible(element) && !element.closest("[aria-hidden='true']"));
  }

  function findSendButton(input) {
    const form = input?.closest("form");
    const scopedButtons = form ? Array.from(form.querySelectorAll("button")) : [];
    const pageButtons = Array.from(document.querySelectorAll("button"));
    const buttons = [...scopedButtons, ...pageButtons].filter((button, index, all) => {
      return all.indexOf(button) === index && isVisible(button) && !button.disabled;
    });

    return buttons.find((button) => {
      const label = [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.getAttribute("data-testid"),
        button.textContent
      ]
        .filter(Boolean)
        .join(" ");

      return /\bsend\b|submit/i.test(label);
    }) || scopedButtons.find((button) => isVisible(button) && !button.disabled && button.type === "submit");
  }

  function getClaudeResponseText() {
    const assistantSelectors = [
      "[data-message-author-role='assistant']",
      "[data-testid='assistant-message']",
      "[data-testid*='assistant']",
      ".font-claude-message",
      "[class*='font-claude-message']"
    ];

    const assistantText = getLastMeaningfulText(assistantSelectors);
    if (assistantText) {
      return assistantText;
    }

    const turnSelectors = [
      "main article",
      "main [data-testid*='conversation']",
      "main [data-testid*='message']",
      "main [role='article']"
    ];

    return getLastMeaningfulText(turnSelectors);
  }

  function getLastMeaningfulText(selectors) {
    const elements = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const texts = elements
      .filter(isVisible)
      .map((element) => cleanText(element.innerText || element.textContent || ""))
      .map(stripPromptEcho)
      .filter((text) => text.length > 20);

    return texts.at(-1) || "";
  }

  function looksLikePromptEcho(text) {
    return text.includes("Context Generator Skill") && text.includes("When `/context-generator` is triggered");
  }

  function stripPromptEcho(text) {
    if (!looksLikePromptEcho(text)) {
      return text;
    }

    const promptEndMarker = `Chat too short — no context needed yet. Use this when you're deeper into a session.`;
    const markerIndex = text.lastIndexOf(promptEndMarker);
    if (markerIndex === -1) {
      return "";
    }

    return cleanText(text.slice(markerIndex + promptEndMarker.length));
  }

  function isClaudeGenerating() {
    const stopSelectors = [
      "button[aria-label*='stop' i]",
      "button[title*='stop' i]",
      "button[data-testid*='stop' i]",
      "[role='button'][aria-label*='stop' i]",
      "[data-testid*='stop' i]"
    ];

    if (stopSelectors.some((selector) => Array.from(document.querySelectorAll(selector)).some(isVisible))) {
      return true;
    }

    return Array.from(document.querySelectorAll("main button, form button")).some((button) => {
      if (!isVisible(button)) {
        return false;
      }

      const label = [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.getAttribute("data-testid"),
        button.textContent
      ]
        .filter(Boolean)
        .join(" ");

      return /\bstop\b|stop generating|stop response|interrupt/i.test(label);
    });
  }

  function setEditorText(element, text) {
    element.focus();

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const valueSetter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set;
      valueSetter?.call(element, text);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    const inserted = document.execCommand("insertText", false, text);
    if (!inserted || !cleanText(element.innerText || "").includes("Context Generator Skill")) {
      element.textContent = text;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
  }

  function cleanText(text) {
    return text.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim();
  }

  function waitForElement(getElement, timeoutMs, name) {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const tick = () => {
        const element = getElement();
        if (element) {
          resolve(element);
          return;
        }

        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${name}.`));
          return;
        }

        setTimeout(tick, 250);
      };

      tick();
    });
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
