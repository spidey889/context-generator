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
  const DESTINATION_SHEET_WIDTH = 336;
  let reservedActionCluster = null;

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

  // Find the rightmost composer action button (send or mic/voice)
  function findComposerActionButton(input) {
    const form = input?.closest("form");
    const searchScope = form || document;
    const buttons = Array.from(searchScope.querySelectorAll("button")).filter((button) => {
      return button.id !== BUBBLE_ID && isVisible(button);
    });

    if (buttons.length === 0) return null;

    const sendButton = findSendButton(input, true, true);
    if (sendButton && buttons.includes(sendButton)) {
      return sendButton;
    }

    const inputRect = input.getBoundingClientRect();
    const composerButtons = buttons.filter((button) => {
      const rect = button.getBoundingClientRect();
      return rect.top >= inputRect.top - 80 && rect.bottom <= inputRect.bottom + 140;
    });

    const candidates = composerButtons.length > 0 ? composerButtons : buttons;
    return candidates.reduce((rightmost, button) => {
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
      if (currentClaudeInput) {
        currentClaudeInput.removeEventListener("input", scheduleFloatingButtonUpdate);
      }
      currentClaudeInput = null;
      return existingBubble;
    }

    const bubble = existingBubble || createFloatingButton();

    if (bubble.parentElement !== document.body) {
      document.body.appendChild(bubble);
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
      "position:fixed",
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

    document.body.appendChild(bubble);
    return bubble;
  }

  function ensureDestinationSheet() {
    let sheet = document.getElementById(DESTINATION_SHEET_ID);
    if (sheet) return sheet;

    sheet = document.createElement("div");
    sheet.id = DESTINATION_SHEET_ID;
    sheet.dataset.contextGeneratorOwned = "true";
    sheet.style.cssText = [
      "display:none",
      "position:fixed",
      "z-index:2147483647",
      `width:${DESTINATION_SHEET_WIDTH}px`,
      "box-sizing:border-box",
      "padding:12px",
      "border-radius:18px",
      "border:1px solid rgba(255,255,255,0.10)",
      "background:#0a0a0a",
      "box-shadow:0 22px 60px rgba(0,0,0,0.52), inset 0 1px 0 rgba(255,255,255,0.06)",
      "backdrop-filter:blur(18px)",
      "color:#f5f5f5",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "overflow:hidden"
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = "padding:0 1px 10px;display:flex;align-items:center;justify-content:space-between;gap:12px";
    const title = document.createElement("div");
    title.textContent = "Send to AI";
    title.style.cssText = "font-size:13px;font-weight:680;letter-spacing:0;color:#f5f5f5;line-height:1";
    const badge = document.createElement("div");
    badge.textContent = "Cap Context";
    badge.style.cssText = [
      "height:22px",
      "padding:0 8px",
      "border-radius:999px",
      "border:1px solid rgba(255,255,255,0.10)",
      "background:rgba(255,255,255,0.04)",
      "color:rgba(245,245,245,0.68)",
      "font-size:10px",
      "font-weight:600",
      "line-height:22px",
      "letter-spacing:0"
    ].join(";");
    header.appendChild(title);
    header.appendChild(badge);
    sheet.appendChild(header);

    const logoDataUrl = (svg) => `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
    const options = [
      {
        name: "ChatGPT",
        detail: "Transfer context",
        accent: "#19c37d",
        logo: logoDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="10" fill="#101513"/><path d="M16 6.8l7.6 4.4v8.8L16 24.4 8.4 20v-8.8L16 6.8z" fill="none" stroke="#f5f5f5" stroke-width="1.8" stroke-linejoin="round"/><path d="M16 6.8v8.8l7.6 4.4M8.4 11.2l7.6 4.4v8.8" fill="none" stroke="#f5f5f5" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`),
        action: startChatGptTransfer
      },
      {
        name: "Gemini",
        detail: "Coming soon",
        accent: "#8ab4f8",
        logo: logoDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="10" fill="#11131a"/><path d="M16 5.8c1.1 5 4.2 8.1 9.2 9.2-5 1.1-8.1 4.2-9.2 9.2-1.1-5-4.2-8.1-9.2-9.2 5-1.1 8.1-4.2 9.2-9.2z" fill="#f5f5f5"/><path d="M23.4 5.8c.4 1.8 1.6 3 3.4 3.4-1.8.4-3 1.6-3.4 3.4-.4-1.8-1.6-3-3.4-3.4 1.8-.4 3-1.6 3.4-3.4z" fill="#8ab4f8"/></svg>`)
      },
      {
        name: "Grok",
        detail: "Coming soon",
        accent: "#f5f5f5",
        logo: logoDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="10" fill="#111"/><path d="M9 22.5L22.5 9M10 9.5l12 13" fill="none" stroke="#f5f5f5" stroke-width="2.4" stroke-linecap="round"/><circle cx="23.4" cy="8.6" r="2" fill="#f5f5f5"/></svg>`)
      },
      {
        name: "DeepSeek",
        detail: "Coming soon",
        accent: "#4c8dff",
        logo: logoDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="10" fill="#0e1422"/><path d="M7.6 18.8c3.2 4.8 11.6 5.1 15.6.8 2.2-2.4 2.1-5.9-.2-8.1-2.4-2.3-6.2-2.1-8.8.4" fill="none" stroke="#f5f5f5" stroke-width="2" stroke-linecap="round"/><path d="M11.6 12.5c2.4 1.4 4.5 3.5 6.1 6.3" fill="none" stroke="#4c8dff" stroke-width="2.1" stroke-linecap="round"/><circle cx="22.4" cy="13.1" r="1.7" fill="#4c8dff"/></svg>`)
      }
    ];

    const grid = document.createElement("div");
    grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px";

    options.forEach((option) => {
      const button = document.createElement("button");
      button.type = "button";
      button.style.cssText = [
        "width:100%",
        "height:58px",
        "border:1px solid rgba(255,255,255,0.08)",
        "border-radius:14px",
        "background:rgba(255,255,255,0.035)",
        "color:#f5f5f5",
        "display:flex",
        "align-items:center",
        "gap:9px",
        "padding:0 10px",
        "box-sizing:border-box",
        `cursor:${option.action ? "pointer" : "default"}`,
        "text-align:left",
        "font:inherit",
        "transition:background 0.14s ease, border-color 0.14s ease, box-shadow 0.14s ease, transform 0.14s ease"
      ].join(";");
      if (!option.action) {
        button.setAttribute("aria-disabled", "true");
      }

      const logo = document.createElement("img");
      logo.src = option.logo;
      logo.alt = "";
      logo.draggable = false;
      logo.style.cssText = "width:28px;height:28px;border-radius:10px;display:block;flex:0 0 auto;box-shadow:0 0 0 1px rgba(255,255,255,0.08)";

      const copy = document.createElement("div");
      copy.style.cssText = "display:flex;flex-direction:column;gap:1px;min-width:0;flex:1";
      const name = document.createElement("div");
      name.textContent = option.name;
      name.style.cssText = "font-size:12px;font-weight:680;line-height:1.1;color:#f5f5f5;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      const detail = document.createElement("div");
      detail.textContent = option.detail;
      detail.style.cssText = "font-size:10px;line-height:1.15;color:rgba(245,245,245,0.52);white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      copy.appendChild(name);
      copy.appendChild(detail);

      button.appendChild(logo);
      button.appendChild(copy);
      button.addEventListener("mouseenter", () => {
        button.style.background = "rgba(255,255,255,0.07)";
        button.style.borderColor = option.action ? option.accent : "rgba(255,255,255,0.12)";
        button.style.boxShadow = option.action ? `0 0 0 1px ${option.accent}22, 0 10px 26px rgba(0,0,0,0.22)` : "none";
        if (option.action) button.style.transform = "translateY(-1px)";
      });
      button.addEventListener("mouseleave", () => {
        button.style.background = "rgba(255,255,255,0.035)";
        button.style.borderColor = "rgba(255,255,255,0.08)";
        button.style.boxShadow = "none";
        button.style.transform = "translateY(0)";
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (option.action) option.action();
      });
      grid.appendChild(button);
    });

    sheet.appendChild(grid);

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

    sheet.style.display = "block";
    showDestinationHint("");
    positionDestinationSheet();
  }

  function hideDestinationSheet() {
    const sheet = document.getElementById(DESTINATION_SHEET_ID);
    if (sheet) sheet.style.display = "none";
  }

  function positionDestinationSheet() {
    const sheet = document.getElementById(DESTINATION_SHEET_ID);
    const bubble = document.getElementById(BUBBLE_ID);
    if (!sheet || !bubble || sheet.style.display === "none") return;

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
  }

  function showDestinationHint(message) {
    const hint = document.getElementById("context-generator-destination-hint");
    if (hint) hint.textContent = message;
  }

  function startChatGptTransfer() {
    hideDestinationSheet();
    if (isRunning) return;
    isRunning = true;
    clearRunningResetTimer();
    runningResetTimer = setTimeout(resetRunningFlag, RUNNING_AUTO_RESET_MS);
    runClaudeFlow();
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

    const actionBtn = findComposerActionButton(input);
    if (!actionBtn) {
      bubble.style.display = "none";
      return;
    }

    const actionRect = actionBtn.getBoundingClientRect();
    if (actionRect.width === 0 || actionRect.height === 0) {
      bubble.style.display = "none";
      return;
    }

    reserveBubbleSlot(actionBtn, input);

    const composerRect = findComposerSurfaceRect(input, actionBtn);
    const left = composerRect.right - BUBBLE_SIZE - BUBBLE_GAP;
    const top = Math.max(
      composerRect.top + BUBBLE_GAP,
      Math.min(
        actionRect.top + (actionRect.height - BUBBLE_SIZE) / 2,
        composerRect.bottom - BUBBLE_SIZE - BUBBLE_GAP
      )
    );

    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
    bubble.style.display = "flex";
    positionDestinationSheet();
  }

  function findComposerSurfaceRect(input, actionBtn) {
    const inputRect = input.getBoundingClientRect();
    const actionRect = actionBtn.getBoundingClientRect();
    const candidates = [];
    let node = actionBtn.parentElement;

    while (node && node !== document.body) {
      if (node.contains(input)) {
        const rect = node.getBoundingClientRect();
        if (
          rect.width >= 320 &&
          rect.height >= 80 &&
          rect.left <= inputRect.left &&
          rect.right >= actionRect.right &&
          rect.top <= inputRect.top &&
          rect.bottom >= actionRect.bottom
        ) {
          candidates.push(rect);
        }
      }
      node = node.parentElement;
    }

    return candidates.sort((a, b) => (a.width * a.height) - (b.width * b.height))[0] ||
      input.closest("form")?.getBoundingClientRect() ||
      inputRect;
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
    if (floatingButtonFrame) return;
    floatingButtonFrame = requestAnimationFrame(() => {
      floatingButtonFrame = null;
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
    window.addEventListener("scroll", scheduleFloatingButtonUpdate, true);
    document.addEventListener("visibilitychange", scheduleFloatingButtonUpdate);
    document.addEventListener("focusin", scheduleFloatingButtonUpdate);
    scheduleFloatingButtonUpdate();
  }

  startFloatingButtonMonitoring();
})();
