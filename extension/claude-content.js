(() => {
  console.log("[Context Generator Relay] Content script loaded on claude.ai");
  if (window.__contextGeneratorClaudeLoaded) {
    console.log("[Context Generator Relay] Content script already loaded previously. Skipping re-initialization.");
    return;
  }

  window.__contextGeneratorClaudeLoaded = true;
  let isRunning = false;
  let runningResetTimer = null;
  const RUNNING_AUTO_RESET_MS = 60000;
  let currentClaudeInput = null;
  const BUBBLE_ID = "context-generator-bubble";
  const OVERLAY_ID = "context-generator-overlay";
  const DESTINATION_SHEET_ID = "context-generator-destination-sheet";
  const BUBBLE_SIZE = 42;
  const BUBBLE_GAP = 8;
  const BUBBLE_SLOT_WIDTH = BUBBLE_SIZE + BUBBLE_GAP + 6;
  const DESTINATION_SHEET_WIDTH = 296;
  const DESTINATION_SHEET_STYLE_ID = "context-generator-destination-sheet-styles";
  const CAP_CONTEXT_SITE_URL = "https://spidey889.github.io/context-generator";
  const MAX_BACKEND_CONVERSATION_CHARS = 180000;
  let reservedActionCluster = null;
  let reservedComposerSurface = null;
  let destinationSheetAnimationFrame = null;

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

    runClaudeFlow("chatgpt");

    return false;
  });

  async function runClaudeFlow(destination = "chatgpt") {
    try {
      showOverlay();
      const text = await captureClaudeResponseWithPolling();
      resetRunningFlag();
      if (destination === "chatgpt") {
        await notifyBackground({ type: "TRANSFER_TO_CHATGPT", text });
      } else {
        await notifyBackground({ type: "TRANSFER_TO_DESTINATION", destination, text });
      }
    } catch (error) {
      resetRunningFlag();
      showErrorOverlay(error.message);
      await notifyBackground({ type: "CONTEXT_TRANSFER_ERROR", error: error.message }).catch(() => {});
    }
  }

  function showErrorOverlay(message) {
    let errorDiv = document.getElementById("context-generator-error-overlay");
    if (!errorDiv) {
      errorDiv = document.createElement("div");
      errorDiv.id = "context-generator-error-overlay";
      errorDiv.style.position = "fixed";
      errorDiv.style.zIndex = "9999999";
      errorDiv.style.bottom = "80px";
      errorDiv.style.right = "20px";
      errorDiv.style.padding = "16px";
      errorDiv.style.borderRadius = "8px";
      errorDiv.style.backgroundColor = "#ef4444";
      errorDiv.style.color = "#ffffff";
      errorDiv.style.boxShadow = "0 4px 16px rgba(0, 0, 0, 0.3)";
      errorDiv.style.fontFamily = "-apple-system, BlinkMacSystemFont, sans-serif";
      errorDiv.style.fontSize = "14px";
      errorDiv.style.maxWidth = "300px";
      errorDiv.style.display = "flex";
      errorDiv.style.flexDirection = "column";
      errorDiv.style.gap = "10px";

      const header = document.createElement("div");
      header.style.fontWeight = "bold";
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.gap = "6px";
      header.innerHTML = "⚠️ <span>Transfer Failed</span>";

      const textSpan = document.createElement("span");
      textSpan.id = "context-generator-error-text";

      const closeBtn = document.createElement("button");
      closeBtn.textContent = "Dismiss";
      closeBtn.style.padding = "6px 12px";
      closeBtn.style.borderRadius = "4px";
      closeBtn.style.border = "1px solid rgba(255, 255, 255, 0.4)";
      closeBtn.style.backgroundColor = "transparent";
      closeBtn.style.color = "#ffffff";
      closeBtn.style.cursor = "pointer";
      closeBtn.style.alignSelf = "flex-end";
      closeBtn.style.fontSize = "12px";
      closeBtn.style.transition = "background-color 0.2s";
      
      closeBtn.addEventListener("mouseenter", () => {
        closeBtn.style.backgroundColor = "rgba(255, 255, 255, 0.1)";
      });
      closeBtn.addEventListener("mouseleave", () => {
        closeBtn.style.backgroundColor = "transparent";
      });
      closeBtn.addEventListener("click", () => {
        errorDiv.style.display = "none";
      });

      errorDiv.appendChild(header);
      errorDiv.appendChild(textSpan);
      errorDiv.appendChild(closeBtn);
      document.body.appendChild(errorDiv);
    }

    const textSpan = document.getElementById("context-generator-error-text");
    if (textSpan) {
      textSpan.textContent = message;
    }
    errorDiv.style.display = "flex";
  }

  function resetRunningFlag() {
    isRunning = false;
    clearRunningResetTimer();
    hideOverlay();
  }

  function clearRunningResetTimer() {
    if (runningResetTimer) {
      clearTimeout(runningResetTimer);
      runningResetTimer = null;
    }
  }

  async function notifyBackground(message) {
    try {
      const response = await chrome.runtime.sendMessage(message);
      if (response && response.ok === false) {
        throw new Error(response.error || "Unknown background error");
      }
      return response;
    } catch (error) {
      console.error("[Context Generator Relay]", error);
      throw error;
    }
  }

  async function summarizeWithBackendFallback(conversationText) {
    showBackendFallbackStatus();
    const response = await notifyBackground({
      type: "SUMMARIZE_WITH_BACKEND",
      conversation: conversationText || scrapeClaudeConversationText()
    });

    if (!response?.summary?.trim()) {
      throw new Error("Backup summarizer returned no summary.");
    }

    return response.summary.trim();
  }

  function scrapeClaudeConversationText() {
    const turns = getClaudeConversationTurns();
    const hasUserTurn = turns.some((turn) => turn.role === "User");
    const transcript = turns
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join("\n\n")
      .trim();

    if (transcript && hasUserTurn) {
      return limitBackendConversationText(transcript);
    }

    return limitBackendConversationText(scrapeMainConversationText());
  }

  function getClaudeConversationTurns() {
    const selectors = [
      "[data-testid*='user-message' i]",
      "[data-testid*='assistant-message' i]",
      "[data-message-author-role]",
      ".font-claude-response"
    ];
    const candidates = [];

    document.querySelectorAll(selectors.join(",")).forEach((element) => {
      if (isContextGeneratorNode(element)) return;

      const text = cleanText(element.innerText || element.textContent || "");
      if (!text || text === CONTEXT_GENERATOR_PROMPT) return;

      candidates.push({
        element,
        role: getClaudeConversationRole(element),
        text
      });
    });

    candidates.sort((a, b) => {
      if (a.element === b.element) return 0;
      return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
    });

    let turns = [];
    candidates.forEach((candidate) => {
      if (turns.some((turn) => turn.text === candidate.text || turn.element.contains(candidate.element))) {
        return;
      }

      turns = turns.filter((turn) => !candidate.element.contains(turn.element));
      turns.push(candidate);
    });

    return turns.map(({ role, text }) => ({ role, text }));
  }

  function getClaudeConversationRole(element) {
    const label = [
      element.getAttribute("data-message-author-role"),
      element.getAttribute("data-testid"),
      element.getAttribute("aria-label"),
      element.className
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (label.includes("user") || label.includes("human")) return "User";
    if (label.includes("assistant") || label.includes("claude") || element.matches(".font-claude-response")) return "Claude";
    return "Message";
  }

  function scrapeMainConversationText() {
    const roots = [
      document.querySelector("main"),
      document.querySelector("[data-testid*='conversation' i]"),
      document.body
    ].filter(Boolean);
    const root = roots.find((element) => cleanText(element.innerText || element.textContent || "").length > 200) || document.body;

    return cleanText(root.innerText || root.textContent || "");
  }

  function limitBackendConversationText(text) {
    const cleaned = cleanText(text);
    if (cleaned.length <= MAX_BACKEND_CONVERSATION_CHARS) {
      return cleaned;
    }

    const headLength = 40000;
    const tailLength = MAX_BACKEND_CONVERSATION_CHARS - headLength;
    return [
      cleaned.slice(0, headLength),
      "[...middle of conversation omitted to fit the backup summarizer...]",
      cleaned.slice(-tailLength)
    ].join("\n\n");
  }

  function hasClaudeContextLimitIndicator() {
    return Boolean(getClaudeContextLimitMessage());
  }

  function getClaudeContextLimitMessage() {
    const selectors = [
      "[role='alert']",
      "[aria-live]",
      "[data-testid*='error' i]",
      "[class*='error' i]",
      "[class*='danger' i]"
    ];

    for (const element of document.querySelectorAll(selectors.join(","))) {
      const text = cleanText(element.innerText || element.textContent || "");
      if (text && isClaudeContextLimitText(text)) {
        return text;
      }
    }

    let node = findClaudeInput()?.closest("form") || findClaudeInput()?.parentElement;
    for (let depth = 0; node && depth < 5; depth += 1) {
      const text = cleanText(node.innerText || node.textContent || "");
      if (text && isClaudeContextLimitText(text)) {
        return text;
      }
      node = node.parentElement;
    }

    return "";
  }

  function isClaudeContextLimitText(text) {
    const normalized = cleanText(text).toLowerCase();
    if (!normalized) return false;

    return [
      /context (window|limit|length)/,
      /(conversation|chat|message|prompt|input).{0,60}(too long|exceeds|exceeded|maximum|limit)/,
      /(too long|exceeds|exceeded|maximum).{0,60}(conversation|chat|message|prompt|input|context|tokens)/,
      /reduce.{0,60}(message|prompt|conversation|context)/,
      /shorten.{0,60}(message|prompt|conversation|context)/,
      /maximum.{0,30}(tokens|context|length)/,
      /too many.{0,30}(tokens|words|characters)/
    ].some((pattern) => pattern.test(normalized));
  }

  async function captureClaudeResponseWithPolling() {
    const conversationText = scrapeClaudeConversationText();
    const input = await waitForElement(findClaudeInput, 20000, "Claude chat input");
    const previousResponseCount = getClaudeResponseCandidates(true).length;
    const previousResponseText = getClaudeResponseText(true);

    setEditorText(input, CONTEXT_GENERATOR_PROMPT);

    let sendButton;
    try {
      sendButton = await waitForElement(() => findSendButton(input), 10000, "Claude send button");
    } catch (error) {
      if (hasClaudeContextLimitIndicator() || conversationText) {
        return summarizeWithBackendFallback(conversationText);
      }
      throw error;
    }

    if (hasClaudeContextLimitIndicator()) {
      return summarizeWithBackendFallback(conversationText);
    }

    sendButton.click();

    // Button-state polling
    const MAX_WAIT_MS = 30000;
    const POLL_INTERVAL_MS = 500;
    const startTime = Date.now();
    let seenStopButton = false;

    while (Date.now() - startTime < MAX_WAIT_MS) {
      await sleep(POLL_INTERVAL_MS);

      if (hasClaudeContextLimitIndicator()) {
        return summarizeWithBackendFallback(conversationText);
      }

      const stopVisible = isStopButtonVisible();
      
      if (stopVisible) {
        seenStopButton = true;
      } else {
        // Stop button is not visible.
        if (seenStopButton) {
          break;
        } else {
          // Give it a 2-second grace period to see if the stop button appears.
          const elapsed = Date.now() - startTime;
          if (elapsed > 2000) {
            break;
          }
        }
      }
    }

    // Wait 500ms more before capturing
    await sleep(500);

    const text = getClaudeResponseTextAfter(previousResponseCount, previousResponseText, true);

    if (!text || isClaudeContextLimitText(text) || hasClaudeContextLimitIndicator()) {
      return summarizeWithBackendFallback(conversationText);
    }

    return text.trim();
  }

  function isStopButtonVisible() {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.some((button) => {
      if (!isVisible(button)) return false;
      // Extract and normalize all label components to check for "stop"
      const label = [
        button.getAttribute("aria-label"),
        button.getAttribute("title"),
        button.getAttribute("data-testid"),
        button.textContent || ""
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      
      return label.includes("stop");
    });
  }

  function findClaudeInput() {
    const selectors = [
      "textarea",
      "[contenteditable='true'][data-placeholder]",
      "[contenteditable='true'][aria-label*='prompt' i]",
      "[contenteditable='true'][aria-label*='message' i]",
      "[contenteditable='true']"
    ];

    const candidates = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element, index, all) => {
        return all.indexOf(element) === index && isVisible(element) && !element.closest("[aria-hidden='true']");
      });

    return candidates
      .map((element) => ({ element, score: scoreClaudeInputCandidate(element) }))
      .sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  function scoreClaudeInputCandidate(element) {
    const rect = element.getBoundingClientRect();
    const label = [
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("data-placeholder"),
      element.getAttribute("role"),
      element.id,
      element.className
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    let score = 0;
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) score += 24;
    if (element.closest("form")) score += 48;
    if (/\b(message|prompt|chat|write|ask)\b/.test(label)) score += 72;
    if (rect.width >= 280) score += 24;
    if (rect.height >= 20 && rect.height <= 240) score += 18;
    if (rect.bottom >= window.innerHeight * 0.45) score += 56;
    if (rect.bottom >= window.innerHeight * 0.7) score += 32;
    if (rect.top < 120 && rect.bottom < window.innerHeight * 0.45) score -= 90;

    return score;
  }

  function findSendButton(input, includeDisabled = false, silent = false) {
    const form = input?.closest("form");
    const scopedButtons = form ? Array.from(form.querySelectorAll("button")) : [];
    const pageButtons = Array.from(document.querySelectorAll("button"));
    const buttons = [...scopedButtons, ...pageButtons].filter((button, index, all) => {
      return all.indexOf(button) === index && isVisible(button) && (includeDisabled || !button.disabled);
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
    }) || scopedButtons.find((button) => isVisible(button) && (includeDisabled || !button.disabled) && button.type === "submit");
  }

  function getClaudeResponseText(silent = false) {
    const candidates = getClaudeResponseCandidates(silent);
    if (candidates.length === 0) {
      return "";
    }

    const winner = candidates[candidates.length - 1];
    return cleanText(winner.innerText || winner.textContent || "");
  }

  function getClaudeResponseTextAfter(previousResponseCount, previousResponseText, silent = false) {
    const candidates = getClaudeResponseCandidates(silent);
    const newCandidates = candidates.slice(previousResponseCount);
    const winner = newCandidates[newCandidates.length - 1] || candidates[candidates.length - 1];
    const text = winner ? cleanText(winner.innerText || winner.textContent || "") : "";

    if (newCandidates.length === 0 && text === previousResponseText) {
      return "";
    }

    return text;
  }

  function getClaudeResponseCandidates(silent = false) {
    const matches = document.querySelectorAll(".font-claude-response");
    return Array.from(matches);
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

  let countdownInterval = null;

  function showBackendFallbackStatus() {
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }

    const textSpan = document.getElementById("context-generator-text");
    if (textSpan) {
      textSpan.textContent = "Summarizing with Mistral...";
    }
  }

  function showOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    const textSpan = document.getElementById("context-generator-text");
    const bubble = document.getElementById(BUBBLE_ID);

    if (overlay && textSpan && bubble) {
      const rect = bubble.getBoundingClientRect();
      overlay.style.position = "fixed";
      // Position the overlay right above the bubble button dynamically
      overlay.style.top = `${rect.top - 45}px`;
      overlay.style.left = `${rect.left - 80}px`;
      overlay.style.display = "flex";
      
      let countdown = 10;
      textSpan.textContent = `Generating context... (${countdown}s)`;

      if (countdownInterval) clearInterval(countdownInterval);
      countdownInterval = setInterval(() => {
        countdown--;
        if (countdown >= 0) {
          textSpan.textContent = `Generating context... (${countdown}s)`;
        } else {
          clearInterval(countdownInterval);
        }
      }, 1000);
    }

    if (bubble) {
      bubble.disabled = true;
      bubble.style.opacity = "0.5";
      bubble.style.cursor = "not-allowed";
    }
  }

  function hideOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    const bubble = document.getElementById(BUBBLE_ID);

    if (overlay) {
      overlay.style.display = "none";
    }
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    if (bubble) {
      bubble.disabled = false;
      bubble.style.opacity = "1";
      bubble.style.cursor = "pointer";
    }
  }

  function findComposerActionButton(input, composerRect) {
    if (!input || !composerRect) return null;

    const buttons = Array.from(document.querySelectorAll("button")).filter((button) => {
      return button.id !== BUBBLE_ID && isVisible(button);
    });

    if (buttons.length === 0) return null;

    const composerButtons = buttons.filter((button) => {
      const rect = button.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      return (
        centerX >= composerRect.left + composerRect.width * 0.45 &&
        rect.left >= composerRect.left - 12 &&
        rect.right <= composerRect.right + 12 &&
        rect.top >= composerRect.top - 12 &&
        rect.bottom <= composerRect.bottom + 12
      );
    });

    if (composerButtons.length === 0) return null;

    return composerButtons.reduce((rightmost, button) => {
      const rightmostRect = rightmost.getBoundingClientRect();
      const buttonRect = button.getBoundingClientRect();
      if (buttonRect.right !== rightmostRect.right) {
        return buttonRect.right > rightmostRect.right ? button : rightmost;
      }
      return buttonRect.left > rightmostRect.left ? button : rightmost;
    });
  }

  // Find the '+' (attachment) button at the bottom-left of the input box
  function findPlusButton() {
    const input = findClaudeInput();
    if (!input) return null;

    const form = input.closest("form");
    const searchScope = form || document;
    const buttons = Array.from(searchScope.querySelectorAll("button")).filter(isVisible);

    // Priority 1: aria-label / title / testid match
    const byLabel = buttons.find((btn) => {
      const label = [
        btn.getAttribute("aria-label") || "",
        btn.getAttribute("title") || "",
        btn.getAttribute("data-testid") || ""
      ].join(" ").toLowerCase();
      return label.includes("attach") || label.includes("upload") || label.includes("add");
    });
    if (byLabel) return byLabel;

    // Priority 2: plain '+' text
    const byText = buttons.find((btn) => btn.textContent?.trim() === "+");
    if (byText) return byText;

    // Priority 3: leftmost SVG button in the form's bottom toolbar
    const inputRect = input.getBoundingClientRect();
    const leftButtons = buttons.filter((btn) => {
      const r = btn.getBoundingClientRect();
      return r.left < inputRect.left + 80 && r.top > inputRect.bottom - 80;
    });
    if (leftButtons.length > 0) {
      // Return the leftmost one
      return leftButtons.reduce((a, b) =>
        a.getBoundingClientRect().left <= b.getBoundingClientRect().left ? a : b
      );
    }

    return null;
  }

  function injectFloatingButton() {
    return ensureFloatingButton();
  }

  function ensureFloatingButton() {
    const input = findClaudeInput();
    const existingBubble = document.getElementById(BUBBLE_ID);

    if (!input) {
      if (existingBubble) existingBubble.style.display = "none";
      hideDestinationSheet();
      releaseBubbleSlot();
      releaseComposerSurface();
      if (currentClaudeInput) {
        currentClaudeInput.removeEventListener("input", scheduleFloatingButtonUpdate);
      }
      currentClaudeInput = null;
      return existingBubble;
    }

    const bubble = existingBubble || createFloatingButton();

    const composerSurface = findComposerSurfaceElement(input);
    if (!composerSurface) {
      bubble.style.display = "none";
      return bubble;
    }

    reserveComposerSurface(composerSurface);

    if (bubble.parentElement !== composerSurface) {
      composerSurface.appendChild(bubble);
    }

    if (currentClaudeInput !== input) {
      if (currentClaudeInput) {
        currentClaudeInput.removeEventListener("input", scheduleFloatingButtonUpdate);
      }
      currentClaudeInput = input;
      input.addEventListener("input", scheduleFloatingButtonUpdate);
    }

    ensureFloatingOverlay();
    updateFloatingButtonPosition();
    return bubble;
  }

  function createFloatingButton() {
    const bubble = document.createElement("button");
    bubble.id = BUBBLE_ID;
    bubble.type = "button";
    bubble.title = "Choose AI destination";
    bubble.setAttribute("aria-label", "Choose AI destination");
    bubble.dataset.contextGeneratorOwned = "true";
    bubble.style.cssText = [
      "display:none",
      "position:absolute",
      "z-index:2147483647",
      `width:${BUBBLE_SIZE}px`,
      `height:${BUBBLE_SIZE}px`,
      `min-width:${BUBBLE_SIZE}px`,
      `min-height:${BUBBLE_SIZE}px`,
      `max-width:${BUBBLE_SIZE}px`,
      `max-height:${BUBBLE_SIZE}px`,
      "border-radius:9999px",
      "background:transparent",
      "border:0",
      "box-shadow:none",
      "box-sizing:border-box",
      "cursor:pointer",
      "padding:0",
      "margin:0",
      "line-height:0",
      "align-items:center",
      "justify-content:center",
      "overflow:hidden",
      "contain:layout style paint",
      "transition:filter 0.15s ease",
      "pointer-events:auto"
    ].join(";");

    const icon = document.createElement("img");
    icon.src = chrome.runtime.getURL("bubble-icon.png");
    icon.alt = "";
    icon.style.width = "38px";
    icon.style.height = "38px";
    icon.style.objectFit = "contain";
    icon.style.display = "block";
    icon.style.pointerEvents = "none";
    icon.draggable = false;
    bubble.appendChild(icon);

    bubble.addEventListener("mouseenter", () => {
      bubble.style.filter = "brightness(1.12) drop-shadow(0 2px 6px rgba(0,0,0,0.25))";
    });
    bubble.addEventListener("mouseleave", () => {
      bubble.style.filter = "none";
    });

    bubble.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isRunning) return;
      toggleDestinationSheet();
    });

    return bubble;
  }

  function ensureDestinationSheetStyles() {
    if (document.getElementById(DESTINATION_SHEET_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = DESTINATION_SHEET_STYLE_ID;
    style.textContent = `
      @keyframes contextGeneratorTileShine {
        0%, 16% {
          opacity: 0;
          transform: translate3d(-150%, 0, 0) skewX(-18deg);
        }
        24% {
          opacity: 0.22;
        }
        40%, 100% {
          opacity: 0;
          transform: translate3d(380%, 0, 0) skewX(-18deg);
        }
      }

      @keyframes contextGeneratorTileIn {
        from {
          opacity: 0;
          transform: translate3d(0, 3px, 0) scale(0.992);
          filter: brightness(0.96);
        }
        to {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
          filter: brightness(1);
        }
      }

      @keyframes contextGeneratorSpinnerSpin {
        to {
          transform: rotate(360deg);
        }
      }

      .context-generator-destination-tile.context-generator-tile-enter {
        animation: contextGeneratorTileIn 0.18s cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      .context-generator-tile-shine {
        position: absolute;
        top: -2px;
        bottom: -2px;
        left: -52px;
        width: 46px;
        z-index: 1;
        pointer-events: none;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.07), rgba(255,255,255,0.14), transparent);
        filter: blur(0.25px);
        opacity: 0;
        transform: translate3d(-150%, 0, 0) skewX(-18deg);
        animation: contextGeneratorTileShine 7.2s cubic-bezier(0.16, 1, 0.3, 1) infinite;
      }

      .context-generator-tile-spinner {
        display: none;
        width: 12px;
        height: 12px;
        border-radius: 999px;
        border: 1.5px solid rgba(245,245,245,0.18);
        border-top-color: rgba(245,245,245,0.78);
        flex: 0 0 auto;
        position: relative;
        z-index: 2;
        animation: contextGeneratorSpinnerSpin 0.7s linear infinite;
      }

      @media (prefers-reduced-motion: reduce) {
        .context-generator-destination-tile.context-generator-tile-enter,
        .context-generator-tile-shine {
          animation: none;
        }

        .context-generator-tile-shine {
          opacity: 0;
        }

        .context-generator-tile-spinner {
          animation: none;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function animateDestinationTiles(sheet) {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    const tiles = sheet.querySelectorAll(".context-generator-destination-tile");
    tiles.forEach((tile, index) => {
      tile.classList.remove("context-generator-tile-enter");
      tile.style.animationDelay = `${index * 0.045}s`;
      void tile.offsetWidth;
      tile.classList.add("context-generator-tile-enter");
    });

    window.setTimeout(() => {
      tiles.forEach((tile) => {
        tile.classList.remove("context-generator-tile-enter");
        tile.style.animationDelay = "";
      });
    }, 320);
  }

  function resetDestinationTiles(sheet) {
    sheet.querySelectorAll(".context-generator-destination-tile").forEach((tile) => {
      tile.dataset.contextGeneratorLoading = "false";
      tile.removeAttribute("aria-busy");
      tile.style.pointerEvents = "";
      tile.style.transform = "translateY(0)";
      const detail = tile.querySelector(".context-generator-tile-detail");
      const spinner = tile.querySelector(".context-generator-tile-spinner");
      if (detail && tile.dataset.contextGeneratorDetail) {
        detail.textContent = tile.dataset.contextGeneratorDetail;
      }
      if (spinner) spinner.style.display = "none";
    });
  }

  function ensureDestinationSheet() {
    let sheet = document.getElementById(DESTINATION_SHEET_ID);
    if (sheet) return sheet;

    ensureDestinationSheetStyles();

    sheet = document.createElement("div");
    sheet.id = DESTINATION_SHEET_ID;
    sheet.dataset.contextGeneratorOwned = "true";
    sheet.style.cssText = [
      "display:none",
      "position:fixed",
      "z-index:2147483647",
      `width:${DESTINATION_SHEET_WIDTH}px`,
      "box-sizing:border-box",
      "padding:9px",
      "border-radius:15px",
      "border:1px solid rgba(255,255,255,0.085)",
      "background:#0a0a0a",
      "box-shadow:0 14px 34px rgba(0,0,0,0.44), inset 0 1px 0 rgba(255,255,255,0.05)",
      "backdrop-filter:blur(16px)",
      "color:#f5f5f5",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "overflow:hidden",
      "opacity:0",
      "transform:translate3d(0,2px,0) scale(0.996)",
      "transform-origin:bottom right",
      "will-change:transform,opacity",
      "transition:opacity 0.14s cubic-bezier(0.16,1,0.3,1), transform 0.16s cubic-bezier(0.16,1,0.3,1)"
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = "padding:0 1px 8px;display:flex;align-items:center;justify-content:space-between;gap:10px";
    const title = document.createElement("div");
    title.textContent = "Where to continue?";
    title.style.cssText = "font-size:11.5px;font-weight:720;letter-spacing:0;color:#f5f5f5;line-height:1.12";
    const badge = document.createElement("button");
    badge.type = "button";
    badge.textContent = "Cap Context";
    badge.setAttribute("aria-label", "Open Cap Context site");
    badge.style.cssText = [
      "height:19px",
      "padding:0 7px",
      "border-radius:999px",
      "border:1px solid rgba(255,255,255,0.085)",
      "background:rgba(255,255,255,0.035)",
      "color:rgba(245,245,245,0.62)",
      "font-size:9.5px",
      "font-weight:650",
      "line-height:19px",
      "letter-spacing:0",
      "font-family:inherit",
      "cursor:pointer",
      "outline:0",
      "transition:border-color 0.14s ease, background 0.14s ease, box-shadow 0.14s ease, color 0.14s ease"
    ].join(";");
    const setBadgeActive = () => {
      badge.style.borderColor = "rgba(245,245,245,0.34)";
      badge.style.background = "rgba(255,255,255,0.065)";
      badge.style.boxShadow = "0 0 0 1px rgba(245,245,245,0.08)";
      badge.style.color = "rgba(245,245,245,0.84)";
    };
    const setBadgeIdle = () => {
      badge.style.borderColor = "rgba(255,255,255,0.085)";
      badge.style.background = "rgba(255,255,255,0.035)";
      badge.style.boxShadow = "none";
      badge.style.color = "rgba(245,245,245,0.62)";
    };
    badge.addEventListener("mouseenter", setBadgeActive);
    badge.addEventListener("mouseleave", setBadgeIdle);
    badge.addEventListener("focus", setBadgeActive);
    badge.addEventListener("blur", setBadgeIdle);
    badge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(CAP_CONTEXT_SITE_URL);
    });
    header.appendChild(title);
    header.appendChild(badge);
    sheet.appendChild(header);

    const options = [
      {
        name: "ChatGPT",
        detail: "OpenAI",
        accent: "#19c37d",
        logoSize: 21,
        logo: chrome.runtime.getURL("logos/gptwhitedownload__1_-removebg-preview.png"),
        action: startChatGptTransfer
      },
      {
        name: "Gemini",
        detail: "Google",
        accent: "#8ab4f8",
        logoSize: 22,
        logo: chrome.runtime.getURL("logos/gemini-download__1_-removebg-preview.png"),
        action: () => startDestinationTransfer("gemini")
      },
      {
        name: "Grok",
        detail: "xAI",
        accent: "#f5f5f5",
        logoSize: 24,
        logo: chrome.runtime.getURL("logos/grokwhitedownload__1_-removebg-preview.png"),
        action: () => startDestinationTransfer("grok")
      },
      {
        name: "DeepSeek",
        detail: "DeepSeek",
        accent: "#4c8dff",
        logoSize: 22,
        logo: chrome.runtime.getURL("logos/deepseek-download__1_-removebg-preview.png"),
        action: () => startDestinationTransfer("deepseek")
      }
    ];

    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px";

    options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "context-generator-destination-tile";
      button.dataset.contextGeneratorDetail = option.detail;
      button.style.cssText = [
        "width:100%",
        "height:48px",
        "border:1px solid rgba(255,255,255,0.08)",
        "border-radius:11px",
        "background:linear-gradient(180deg, #131313 0%, #0f0f0f 58%, #0c0c0c 100%)",
        "color:#f5f5f5",
        "display:flex",
        "align-items:center",
        "gap:7px",
        "padding:0 8px",
        "box-sizing:border-box",
        `cursor:${option.action ? "pointer" : "default"}`,
        "text-align:left",
        "font:inherit",
        "outline:0",
        "position:relative",
        "overflow:hidden",
        "isolation:isolate",
        "box-shadow:inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.42), 0 1px 0 rgba(255,255,255,0.018)",
        "transition:background 0.13s ease, border-color 0.13s ease, box-shadow 0.13s ease, transform 0.13s ease"
      ].join(";");
      if (!option.action) {
        button.setAttribute("aria-disabled", "true");
      }

      const logoWrap = document.createElement("div");
      logoWrap.style.cssText = [
        "width:26px",
        "height:26px",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "flex:0 0 auto",
        "opacity:0.96",
        "position:relative",
        "z-index:2"
      ].join(";");

      const logo = document.createElement("img");
      logo.src = option.logo;
      logo.alt = "";
      logo.draggable = false;
      logo.style.cssText = `width:${option.logoSize}px;height:${option.logoSize}px;object-fit:contain;display:block;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.28))`;
      logoWrap.appendChild(logo);

      const copy = document.createElement("div");
      copy.style.cssText = "display:flex;flex-direction:column;gap:1px;min-width:0;flex:1;position:relative;z-index:2";
      const name = document.createElement("div");
      name.textContent = option.name;
      name.style.cssText = "font-size:11.5px;font-weight:720;line-height:1.18;color:#f5f5f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      const detail = document.createElement("div");
      detail.className = "context-generator-tile-detail";
      detail.textContent = option.detail;
      detail.style.cssText = "font-size:9.5px;font-weight:500;line-height:1.28;color:rgba(245,245,245,0.43);white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      copy.appendChild(name);
      copy.appendChild(detail);

      const setButtonActive = () => {
        button.style.background = "linear-gradient(180deg, #171717 0%, #111111 58%, #0c0c0c 100%)";
        button.style.borderColor = option.action ? `${option.accent}52` : "rgba(255,255,255,0.14)";
        button.style.boxShadow = option.action
          ? `inset 0 1px 0 rgba(255,255,255,0.085), inset 0 -1px 0 rgba(0,0,0,0.46), 0 0 0 1px ${option.accent}1f, 0 8px 18px rgba(0,0,0,0.24)`
          : "inset 0 1px 0 rgba(255,255,255,0.085), inset 0 -1px 0 rgba(0,0,0,0.46), 0 8px 18px rgba(0,0,0,0.20)";
        aura.style.opacity = "0.56";
        if (option.action) button.style.transform = "translateY(-1px)";
      };
      const setButtonIdle = () => {
        button.style.background = "linear-gradient(180deg, #131313 0%, #0f0f0f 58%, #0c0c0c 100%)";
        button.style.borderColor = "rgba(255,255,255,0.08)";
        button.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.42), 0 1px 0 rgba(255,255,255,0.018)";
        aura.style.opacity = "0.28";
        button.style.transform = "translateY(0)";
      };

      const aura = document.createElement("span");
      aura.style.cssText = [
        "position:absolute",
        "inset:-1px",
        "z-index:0",
        "pointer-events:none",
        `background:radial-gradient(circle at 18% 50%, ${option.accent}1a 0, transparent 42%), linear-gradient(135deg, rgba(255,255,255,0.045), transparent 45%)`,
        "opacity:0.28",
        "transition:opacity 0.14s ease"
      ].join(";");

      const shine = document.createElement("span");
      shine.className = "context-generator-tile-shine";
      shine.style.animationDelay = `${index * 0.18}s`;

      const spinner = document.createElement("span");
      spinner.className = "context-generator-tile-spinner";
      spinner.setAttribute("aria-hidden", "true");

      button.appendChild(aura);
      button.appendChild(shine);
      button.appendChild(logoWrap);
      button.appendChild(copy);
      button.appendChild(spinner);
      button.addEventListener("mouseenter", setButtonActive);
      button.addEventListener("mouseleave", setButtonIdle);
      button.addEventListener("focus", setButtonActive);
      button.addEventListener("blur", setButtonIdle);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!option.action || button.dataset.contextGeneratorLoading === "true") return;
        button.dataset.contextGeneratorLoading = "true";
        button.setAttribute("aria-busy", "true");
        button.style.pointerEvents = "none";
        spinner.style.display = "block";
        detail.textContent = "Preparing...";
        button.style.transform = "scale(0.985)";
        window.setTimeout(() => option.action(), 120);
      });
      grid.appendChild(button);
    });

    sheet.appendChild(grid);

    const footer = document.createElement("div");
    footer.textContent = "Context goes straight into the input box";
    footer.style.cssText = [
      "margin:9px 1px 1px",
      "padding-top:7px",
      "padding-bottom:1px",
      "border-top:1px solid rgba(255,255,255,0.045)",
      "color:rgba(245,245,245,0.34)",
      "font-size:9.5px",
      "font-weight:500",
      "line-height:1.35",
      "letter-spacing:0",
      "text-align:center",
      "white-space:nowrap",
      "overflow:hidden",
      "text-overflow:ellipsis"
    ].join(";");
    sheet.appendChild(footer);

    sheet.addEventListener("click", (event) => event.stopPropagation());
    document.body.appendChild(sheet);
    document.addEventListener("click", hideDestinationSheet);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") hideDestinationSheet();
    });

    return sheet;
  }

  function toggleDestinationSheet() {
    const sheet = ensureDestinationSheet();
    if (sheet.style.display === "block") {
      hideDestinationSheet();
      return;
    }

    if (destinationSheetAnimationFrame) cancelAnimationFrame(destinationSheetAnimationFrame);
    sheet.style.opacity = "0";
    sheet.style.transform = "translate3d(0,2px,0) scale(0.996)";
    sheet.style.display = "block";
    delete sheet.dataset.contextGeneratorPositionLocked;
    showDestinationHint("");
    positionDestinationSheet();
    resetDestinationTiles(sheet);
    animateDestinationTiles(sheet);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      sheet.style.opacity = "1";
      sheet.style.transform = "translate3d(0,0,0) scale(1)";
      return;
    }
    destinationSheetAnimationFrame = requestAnimationFrame(() => {
      sheet.style.opacity = "1";
      sheet.style.transform = "translate3d(0,0,0) scale(1)";
      destinationSheetAnimationFrame = null;
    });
  }

  function hideDestinationSheet() {
    const sheet = document.getElementById(DESTINATION_SHEET_ID);
    if (sheet) {
      if (destinationSheetAnimationFrame) {
        cancelAnimationFrame(destinationSheetAnimationFrame);
        destinationSheetAnimationFrame = null;
      }
      sheet.style.opacity = "0";
      sheet.style.transform = "translate3d(0,2px,0) scale(0.996)";
      sheet.style.display = "none";
      delete sheet.dataset.contextGeneratorPositionLocked;
    }
  }

  function isDestinationSheetOpen() {
    const sheet = document.getElementById(DESTINATION_SHEET_ID);
    return Boolean(sheet && sheet.style.display === "block");
  }

  function positionDestinationSheet() {
    const sheet = document.getElementById(DESTINATION_SHEET_ID);
    const bubble = document.getElementById(BUBBLE_ID);
    if (!sheet || !bubble || sheet.style.display === "none") return;
    if (sheet.dataset.contextGeneratorPositionLocked === "true") return;

    const bubbleRect = bubble.getBoundingClientRect();
    const margin = 10;
    const sheetHeight = sheet.offsetHeight || 164;
    const left = Math.max(
      margin,
      Math.min(
        bubbleRect.right - DESTINATION_SHEET_WIDTH,
        window.innerWidth - DESTINATION_SHEET_WIDTH - margin
      )
    );
    const preferredTop = bubbleRect.top - sheetHeight - margin;
    const top = preferredTop >= margin ? preferredTop : bubbleRect.bottom + margin;

    sheet.style.left = `${Math.round(left)}px`;
    sheet.style.top = `${Math.round(Math.min(top, window.innerHeight - sheetHeight - margin))}px`;
    sheet.style.transformOrigin = preferredTop >= margin ? "bottom right" : "top right";
    sheet.dataset.contextGeneratorPositionLocked = "true";
  }

  function showDestinationHint(message) {
    const hint = document.getElementById("context-generator-destination-hint");
    if (hint) hint.textContent = message;
  }

  function startChatGptTransfer() {
    startDestinationTransfer("chatgpt");
  }

  function startDestinationTransfer(destination) {
    hideDestinationSheet();
    if (isRunning) return;
    isRunning = true;
    clearRunningResetTimer();
    runningResetTimer = setTimeout(resetRunningFlag, RUNNING_AUTO_RESET_MS);
    runClaudeFlow(destination);
  }

  function ensureFloatingOverlay() {
    if (!document.getElementById(OVERLAY_ID)) {
      const overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.dataset.contextGeneratorOwned = "true";
      overlay.style.cssText = [
        "display:none", "position:fixed", "z-index:999999",
        "padding:8px 12px", "border-radius:6px",
        "background:#1f2937", "color:#fff", "font-size:12px",
        "box-shadow:0 4px 12px rgba(0,0,0,0.2)", "white-space:nowrap",
        "align-items:center", "gap:6px",
        "font-family:-apple-system,BlinkMacSystemFont,sans-serif"
      ].join(";");

      if (!document.getElementById("context-generator-styles")) {
        const styleSheet = document.createElement("style");
        styleSheet.id = "context-generator-styles";
        styleSheet.dataset.contextGeneratorOwned = "true";
        styleSheet.textContent = `@keyframes contextSpinner{0%{transform:rotate(0deg)}100%{transform:rotate(360deg)}}`;
        document.head.appendChild(styleSheet);
      }

      const spinner = document.createElement("div");
      spinner.style.cssText = "width:12px;height:12px;border:2px solid rgba(255,255,255,0.3);border-top:2px solid #fff;border-radius:50%;animation:contextSpinner 0.8s linear infinite";
      const textSpan = document.createElement("span");
      textSpan.id = "context-generator-text";
      textSpan.textContent = "Generating context... (10s)";
      overlay.appendChild(spinner);
      overlay.appendChild(textSpan);
      document.body.appendChild(overlay);
    }
  }

  function updateFloatingButtonPosition() {
    const bubble = document.getElementById(BUBBLE_ID);
    const input = findClaudeInput();
    if (!bubble || !input) return;

    const composerSurface = findComposerSurfaceElement(input);
    if (!composerSurface) {
      bubble.style.display = "none";
      return;
    }

    reserveComposerSurface(composerSurface);

    if (bubble.parentElement !== composerSurface) {
      composerSurface.appendChild(bubble);
    }

    const composerRect = composerSurface.getBoundingClientRect();
    if (
      composerRect.width < 280 ||
      composerRect.height < 20 ||
      composerRect.bottom < 0 ||
      composerRect.top > window.innerHeight
    ) {
      bubble.style.display = "none";
      return;
    }

    const actionBtn = findComposerActionButton(input, composerRect);
    let anchorTop = composerRect.bottom - BUBBLE_SIZE - BUBBLE_GAP;

    if (actionBtn) {
      const actionRect = actionBtn.getBoundingClientRect();
      if (actionRect.width > 0 && actionRect.height > 0) {
        reserveBubbleSlot(actionBtn, input);
        anchorTop = actionRect.top + (actionRect.height - BUBBLE_SIZE) / 2;
      }
    } else {
      releaseBubbleSlot();
    }

    const right = BUBBLE_GAP;
    const top = Math.max(
      BUBBLE_GAP,
      Math.min(
        anchorTop - composerRect.top,
        composerRect.height - BUBBLE_SIZE - BUBBLE_GAP
      )
    );

    const nextTop = Math.round(top);

    bubble.style.left = "auto";
    bubble.style.right = `${right}px`;
    bubble.style.top = `${nextTop}px`;
    bubble.style.display = "flex";
  }

  function findComposerSurfaceElement(input) {
    const inputRect = input.getBoundingClientRect();
    const candidates = [];
    let node = input.parentElement;

    while (node && node !== document.body) {
      const rect = node.getBoundingClientRect();
      if (
        rect.width >= 320 &&
        rect.height >= 64 &&
        rect.height <= 360 &&
        rect.left <= inputRect.left + 12 &&
        rect.right >= inputRect.right - 12 &&
        rect.top <= inputRect.top + 12 &&
        rect.bottom >= inputRect.bottom - 12
      ) {
        candidates.push({ node, rect });
      }
      node = node.parentElement;
    }

    const bestCandidate = candidates.sort((a, b) => (a.rect.width * a.rect.height) - (b.rect.width * b.rect.height))[0];
    if (bestCandidate) return bestCandidate.node;

    const form = input.closest("form");
    const formRect = form?.getBoundingClientRect();
    if (formRect && formRect.width >= 320 && formRect.height >= 64 && formRect.height <= 360) {
      return form;
    }

    return input.parentElement;
  }

  function reserveComposerSurface(surface) {
    if (!surface) return;

    if (reservedComposerSurface && reservedComposerSurface !== surface) {
      releaseComposerSurface();
    }

    if (!surface.hasAttribute("data-context-generator-original-position")) {
      surface.setAttribute("data-context-generator-original-position", surface.style.position || "");
    }

    if (getComputedStyle(surface).position === "static") {
      surface.style.position = "relative";
    }

    reservedComposerSurface = surface;
  }

  function releaseComposerSurface() {
    if (!reservedComposerSurface) return;

    const originalPosition = reservedComposerSurface.getAttribute("data-context-generator-original-position") || "";
    reservedComposerSurface.style.position = originalPosition;
    reservedComposerSurface.removeAttribute("data-context-generator-original-position");
    reservedComposerSurface = null;
  }

  function reserveBubbleSlot(actionBtn, input) {
    const cluster = findActionCluster(actionBtn, input);
    if (!cluster) return;

    if (reservedActionCluster && reservedActionCluster !== cluster) {
      releaseBubbleSlot();
    }

    if (!cluster.hasAttribute("data-context-generator-original-transform")) {
      cluster.setAttribute("data-context-generator-original-transform", cluster.style.transform || "");
    }

    const originalTransform = cluster.getAttribute("data-context-generator-original-transform") || "";
    cluster.style.transform = `${originalTransform} translateX(-${BUBBLE_SLOT_WIDTH}px)`.trim();
    cluster.style.willChange = "transform";
    reservedActionCluster = cluster;
  }

  function findActionCluster(actionBtn, input) {
    let node = actionBtn.parentElement;
    let cluster = null;

    while (node && node !== document.body) {
      if (node.contains(input)) break;
      cluster = node;
      node = node.parentElement;
    }

    return cluster || actionBtn.parentElement;
  }

  function releaseBubbleSlot() {
    if (!reservedActionCluster) return;

    const originalTransform = reservedActionCluster.getAttribute("data-context-generator-original-transform") || "";
    reservedActionCluster.style.transform = originalTransform;
    reservedActionCluster.style.willChange = "";
    reservedActionCluster.removeAttribute("data-context-generator-original-transform");
    reservedActionCluster = null;
  }

  let floatingButtonFrame = null;
  let floatingButtonObserver = null;

  function scheduleFloatingButtonUpdate() {
    if (isDestinationSheetOpen()) return;
    if (floatingButtonFrame) return;
    floatingButtonFrame = requestAnimationFrame(() => {
      floatingButtonFrame = null;
      if (isDestinationSheetOpen()) return;
      ensureFloatingButton();
    });
  }

  function isContextGeneratorNode(node) {
    return node instanceof Element && (
      node.id === BUBBLE_ID ||
      node.id === OVERLAY_ID ||
      node.id === "context-generator-styles" ||
      node.dataset.contextGeneratorOwned === "true" ||
      Boolean(node.closest?.(`#${BUBBLE_ID}, #${OVERLAY_ID}, #context-generator-styles`))
    );
  }

  function isOwnDomMutation(mutation) {
    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes].filter((node) => node instanceof Element);
    return isContextGeneratorNode(mutation.target) || (changedNodes.length > 0 && changedNodes.every(isContextGeneratorNode));
  }

  function startFloatingButtonMonitoring() {
    if (floatingButtonObserver) floatingButtonObserver.disconnect();
    floatingButtonObserver = new MutationObserver((mutations) => {
      if (mutations.every(isOwnDomMutation)) return;
      scheduleFloatingButtonUpdate();
    });
    floatingButtonObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });

    window.addEventListener("resize", scheduleFloatingButtonUpdate);
    document.addEventListener("visibilitychange", scheduleFloatingButtonUpdate);
    document.addEventListener("focusin", scheduleFloatingButtonUpdate);
    scheduleFloatingButtonUpdate();
  }

  startFloatingButtonMonitoring();
})();
