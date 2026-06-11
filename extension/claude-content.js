(() => {
  if (window.__contextGeneratorClaudeLoaded) {
    return;
  }

  window.__contextGeneratorClaudeLoaded = true;
  let isRunning = false;
  let runningResetTimer = null;
  const FIXED_CAPTURE_DELAY_MS = 30000;
  const RUNNING_AUTO_RESET_MS = 60000;

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
    clearRunningResetTimer();
    runningResetTimer = setTimeout(resetRunningFlag, RUNNING_AUTO_RESET_MS);
    sendResponse({ ok: true });

    runClaudeFlow();

    return false;
  });

  async function runClaudeFlow() {
    try {
      const text = await captureClaudeResponseAfterFixedDelay();
      resetRunningFlag();
      await notifyBackground({ type: "TRANSFER_TO_CHATGPT", text });
    } catch (error) {
      resetRunningFlag();
      await notifyBackground({ type: "CONTEXT_TRANSFER_ERROR", error: error.message });
    }
  }

  function resetRunningFlag() {
    isRunning = false;
    clearRunningResetTimer();
  }

  function clearRunningResetTimer() {
    if (runningResetTimer) {
      clearTimeout(runningResetTimer);
      runningResetTimer = null;
    }
  }

  async function notifyBackground(message) {
    try {
      await chrome.runtime.sendMessage(message);
    } catch (error) {
      console.error("[Context Generator Relay]", error);
    }
  }

  async function captureClaudeResponseAfterFixedDelay() {
    const input = await waitForElement(findClaudeInput, 20000, "Claude chat input");

    setEditorText(input, CONTEXT_GENERATOR_PROMPT);

    const sendButton = await waitForElement(() => findSendButton(input), 10000, "Claude send button");
    sendButton.click();

    await sleep(FIXED_CAPTURE_DELAY_MS);

    const text = getClaudeResponseText();
    console.log("[Context Generator Relay] Claude captured text after 30s:", text || "");

    if (!text) {
      throw new Error("Claude response was not available after the 30 second wait.");
    }

    return text.trim();
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
    const candidates = getClaudeResponseCandidates();
    const scoredCandidates = candidates
      .map((candidate) => {
        const text = extractClaudeResponseText(candidate.text);
        return {
          ...candidate,
          text,
          score: scoreClaudeResponseCandidate(candidate, text)
        };
      })
      .filter((candidate) => candidate.text.length > 0)
      .sort((a, b) => a.score - b.score);

    const winner = scoredCandidates.at(-1);
    if (winner) {
      const authorRole = winner.element.getAttribute("data-message-author-role")
        || winner.element.closest("[data-message-author-role]")?.getAttribute("data-message-author-role")
        || "unknown";
      
      console.log("[Context Generator Relay] Extracted Claude response from element:", {
        tagName: winner.element.tagName,
        className: winner.element.className,
        selector: winner.selector,
        role: authorRole,
        testid: winner.element.getAttribute("data-testid") || "none",
        textSnippet: winner.text.slice(0, 60) + "..."
      });
    }

    return winner?.text || "";
  }

  function getClaudeResponseCandidates() {
    const selectors = [
      "[data-message-author-role='assistant']",
      "[data-testid='assistant-message']",
      "[data-testid*='assistant']",
      ".font-claude-message",
      "[class*='font-claude-message']",
      "[data-testid*='conversation-turn']",
      "[data-testid*='message']",
      "[data-testid*='chat']",
      "main article",
      "main [role='article']",
      "main [class*='message']",
      "main [class*='Message']",
      "main [class*='prose']",
      "main"
    ];

    // Log per-selector match counts RIGHT AT THE START before any filtering
    console.log("[Context Generator Relay] getClaudeResponseCandidates() called — checking selectors:");
    selectors.forEach((selector) => {
      const matches = document.querySelectorAll(selector);
      console.log(`[Context Generator Relay]   selector "${selector}" => ${matches.length} element(s)`);
    });

    const seen = new Set();
    const rawCandidates = selectors
      .flatMap((selector) => {
        return Array.from(document.querySelectorAll(selector)).map((element) => ({ element, selector }));
      })
      .filter(({ element }) => !seen.has(element) && seen.add(element));

    console.log(`[Context Generator Relay] --- RAW CANDIDATES (${rawCandidates.length} total, before any filter) ---`);
    rawCandidates.forEach(({ element, selector }, i) => {
      const ownRole        = element.getAttribute("data-message-author-role") || "none";
      const ancestorRole   = element.closest("[data-message-author-role]")?.getAttribute("data-message-author-role") || "none";
      const childUserMsg   = !!element.querySelector("[data-message-author-role='user'], [data-testid='user-message']");
      const isInForm       = !!element.closest("form, nav, aside, header, footer, [contenteditable='true']");
      const visible        = isVisible(element);
      const textSnippet    = (element.innerText || element.textContent || "").trim().slice(0, 80);

      const exclusionReasons = [];
      if (!visible)         exclusionReasons.push("NOT_VISIBLE");
      if (isInForm)         exclusionReasons.push("INSIDE_FORM/NAV/ASIDE");
      if (ownRole === "user")         exclusionReasons.push("OWN_ROLE=user");
      if (ancestorRole === "user")    exclusionReasons.push("ANCESTOR_ROLE=user");

      console.log(`[Context Generator Relay] Candidate #${i + 1}:`, {
        selector,
        tagName: element.tagName,
        ownRole,
        ancestorRole,
        childUserMsg,
        visible,
        exclusionReasons: exclusionReasons.length ? exclusionReasons : ["NONE (passes all filters)"],
        textSnippet: textSnippet + (textSnippet.length >= 80 ? "..." : "")
      });
    });
    console.log(`[Context Generator Relay] --- END RAW CANDIDATES ---`);

    return rawCandidates
      .filter(({ element }) => isCandidateResponseElement(element))
      .filter(({ element }) => !isUserMessageElement(element))
      .map(({ element, selector }) => {
        const rect = element.getBoundingClientRect();
        return {
          selector,
          element,
          text: cleanText(element.innerText || element.textContent || ""),
          top: rect.top + window.scrollY
        };
      })
      .filter((candidate) => candidate.text.length > 0);
  }

  function isCandidateResponseElement(element) {
    if (!isVisible(element)) {
      return false;
    }

    if (element.closest("form, nav, aside, header, footer, [contenteditable='true']")) {
      return false;
    }

    return true;
  }

  function isUserMessageElement(element) {
    // Only exclude if the element ITSELF is a user message, or is a direct child of one.
    // Do NOT exclude container elements (like main, article, conversation-turn wrappers)
    // just because they happen to contain a user message somewhere inside them.
    const ownRole = element.getAttribute("data-message-author-role");
    if (ownRole === "user") return true;

    const testId = element.getAttribute("data-testid");
    if (testId === "user-message") return true;

    // If the element is a child OF a user message container, exclude it
    if (element.closest("[data-message-author-role='user']")) return true;
    if (element.closest("[data-testid='user-message']")) return true;

    return false;
  }

  function scoreClaudeResponseCandidate(candidate, text) {
    let score = candidate.top;

    if (/\bassistant\b/i.test(candidate.selector)) {
      score += 100000;
    }

    if (/font-claude-message|prose/i.test(candidate.selector)) {
      score += 75000;
    }

    if (/message|conversation-turn|article/i.test(candidate.selector)) {
      score += 50000;
    }

    if (looksLikeContextOutput(text)) {
      score += 200000;
    }

    if (looksLikePromptEcho(candidate.text)) {
      score -= 25000;
    }

    return score;
  }

  function extractClaudeResponseText(rawText) {
    const text = cleanText(rawText);
    if (!text) {
      return "";
    }

    if (!looksLikePromptEcho(text)) {
      return text;
    }

    const promptEndIndex = getPromptEndIndex(text);
    if (promptEndIndex === -1) {
      return "";
    }

    const responseTail = cleanText(text.slice(promptEndIndex));
    return extractKnownResponseBlock(responseTail);
  }

  function extractKnownResponseBlock(text) {
    if (!text) {
      return "";
    }

    const shortMessageIndex = text.lastIndexOf("Chat too short");
    if (shortMessageIndex !== -1) {
      return cleanText(text.slice(shortMessageIndex));
    }

    const markerIndex = findFirstIndex(text, [
      "CONTEXT CARRY",
      "WHO I AM",
      "WHAT WE WERE DOING",
      "WHERE WE LEFT OFF"
    ]);

    if (markerIndex === -1) {
      return looksLikePromptEcho(text) ? "" : text;
    }

    const boxStartIndex = text.lastIndexOf("╔", markerIndex);
    const startIndex = boxStartIndex !== -1 ? boxStartIndex : markerIndex;
    return cleanText(text.slice(startIndex));
  }

  function getPromptEndIndex(text) {
    const promptEndMarkers = [
      "Use this when you're deeper into a session.",
      "Use this when you’re deeper into a session."
    ];

    const markerIndex = findFirstIndex(text, promptEndMarkers);
    if (markerIndex === -1) {
      return -1;
    }

    const marker = promptEndMarkers.find((candidate) => text.includes(candidate));
    return markerIndex + marker.length;
  }

  function looksLikeContextOutput(text) {
    return text.includes("CONTEXT CARRY")
      || text.includes("WHO I AM")
      || text.includes("WHAT WE WERE DOING")
      || text.includes("Chat too short");
  }

  function findFirstIndex(text, markers) {
    return markers
      .map((marker) => text.indexOf(marker))
      .filter((index) => index !== -1)
      .sort((a, b) => a - b)[0] ?? -1;
  }

  function looksLikePromptEcho(text) {
    return text.includes("Context Generator Skill") && text.includes("When `/context-generator` is triggered");
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
