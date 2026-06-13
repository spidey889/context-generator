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
      showOverlay();
      const text = await captureClaudeResponseWithPolling();
      resetRunningFlag();
      await notifyBackground({ type: "TRANSFER_TO_CHATGPT", text });
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

  async function captureClaudeResponseWithPolling() {
    const input = await waitForElement(findClaudeInput, 20000, "Claude chat input");

    setEditorText(input, CONTEXT_GENERATOR_PROMPT);

    const sendButton = await waitForElement(() => findSendButton(input), 10000, "Claude send button");
    sendButton.click();

    // Button-state polling
    const MAX_WAIT_MS = 30000;
    const POLL_INTERVAL_MS = 500;
    const startTime = Date.now();
    let seenStopButton = false;

    while (Date.now() - startTime < MAX_WAIT_MS) {
      await sleep(POLL_INTERVAL_MS);

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

    const text = getClaudeResponseText(true);

    if (!text) {
      throw new Error("Claude response was not available after generation completed.");
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

    return selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .find((element) => isVisible(element) && !element.closest("[aria-hidden='true']"));
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

  function showOverlay() {
    const overlay = document.getElementById("context-generator-overlay");
    const textSpan = document.getElementById("context-generator-text");
    const bubble = document.getElementById("context-generator-bubble");

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
    const overlay = document.getElementById("context-generator-overlay");
    const bubble = document.getElementById("context-generator-bubble");

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
    // Don't inject twice
    if (document.getElementById("context-generator-bubble")) {
      return;
    }

    const plusBtn = findPlusButton();
    if (!plusBtn) return;

    const toolbar = plusBtn.parentElement;
    if (!toolbar) return;

    const bubble = document.createElement("button");
    bubble.id = "context-generator-bubble";
    bubble.type = "button";
    bubble.title = "Transfer Context to ChatGPT";

    // Get plus button's computed styles for perfect matching
    const plusStyle = window.getComputedStyle(plusBtn);
    const plusRect = plusBtn.getBoundingClientRect();

    // Match the + button's style exactly
    bubble.style.display = plusStyle.display;
    bubble.style.alignItems = plusStyle.alignItems;
    bubble.style.justifyContent = plusStyle.justifyContent;
    bubble.style.alignSelf = plusStyle.alignSelf;
    bubble.style.width = "38px";
    bubble.style.height = "38px";
    bubble.style.borderRadius = plusStyle.borderRadius;
    bubble.style.backgroundColor = "transparent";
    bubble.style.border = "none";
    bubble.style.cursor = "pointer";
    bubble.style.padding = "0";
    bubble.style.margin = plusStyle.margin;
    bubble.style.marginLeft = "1px";
    bubble.style.marginTop = "3px";
    bubble.style.flexShrink = "0";
    bubble.style.transition = "transform 0.15s";

    const icon = document.createElement("img");
    icon.src = chrome.runtime.getURL("bubble-icon.png");
    icon.style.width = "38px";
    icon.style.height = "38px";
    icon.style.objectFit = "contain";
    icon.style.display = "block";
    icon.draggable = false;
    bubble.appendChild(icon);

    bubble.addEventListener("mouseenter", () => { bubble.style.transform = "scale(1.15)"; });
    bubble.addEventListener("mouseleave", () => { bubble.style.transform = "scale(1)"; });

    // Append as sibling right after the + button
    toolbar.appendChild(bubble);

    // Overlay singleton
    if (!document.getElementById("context-generator-overlay")) {
      const overlay = document.createElement("div");
      overlay.id = "context-generator-overlay";
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

    bubble.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isRunning) return;
      isRunning = true;
      clearRunningResetTimer();
      runningResetTimer = setTimeout(resetRunningFlag, RUNNING_AUTO_RESET_MS);
      runClaudeFlow();
    });
  }

  let injectionInterval = null;
  function startFloatingButtonMonitoring() {
    if (injectionInterval) clearInterval(injectionInterval);
    // Poll every 500ms — re-inject if the bubble was removed by React re-renders
    injectionInterval = setInterval(() => {
      injectFloatingButton();
    }, 500);
    injectFloatingButton();
  }

  startFloatingButtonMonitoring();
})();
