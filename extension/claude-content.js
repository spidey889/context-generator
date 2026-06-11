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
      await notifyBackground({ type: "CONTEXT_TRANSFER_ERROR", error: error.message });
    }
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
      await chrome.runtime.sendMessage(message);
    } catch (error) {
      console.error("[Context Generator Relay]", error);
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

    console.log("[Context Generator Relay] Starting button-state polling for Claude's response...");

    while (Date.now() - startTime < MAX_WAIT_MS) {
      await sleep(POLL_INTERVAL_MS);

      const stopVisible = isStopButtonVisible();
      
      if (stopVisible) {
        seenStopButton = true;
        console.log("[Context Generator Relay] Poll: 'Stop' button is visible. Claude is generating...");
      } else {
        // Stop button is not visible.
        if (seenStopButton) {
          console.log("[Context Generator Relay] Poll: 'Stop' button disappeared. Response complete!");
          break;
        } else {
          // If we haven't seen the stop button yet, maybe the generation hasn't started, or it finished very quickly.
          // Give it a 2-second grace period to see if the stop button appears.
          const elapsed = Date.now() - startTime;
          if (elapsed > 2000) {
            console.log("[Context Generator Relay] Poll: No 'Stop' button detected after 2s grace period. Assuming complete.");
            break;
          } else {
            console.log(`[Context Generator Relay] Poll: Waiting for 'Stop' button to appear (${elapsed}ms elapsed)...`);
          }
        }
      }
    }

    // Wait 500ms more before capturing
    await sleep(500);

    const text = getClaudeResponseText(false);
    console.log("[Context Generator Relay] Claude captured text:", text || "");

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

    const found = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .find((element) => isVisible(element) && !element.closest("[aria-hidden='true']"));

    if (found && (!window.__lastInputLogTime || Date.now() - window.__lastInputLogTime > 10000)) {
      console.log("[Context Generator Relay] Resolved Claude Input element:", found);
      window.__lastInputLogTime = Date.now();
    }
    return found;
  }

  function findSendButton(input, includeDisabled = false, silent = false) {
    const form = input?.closest("form");
    const scopedButtons = form ? Array.from(form.querySelectorAll("button")) : [];
    const pageButtons = Array.from(document.querySelectorAll("button"));
    const buttons = [...scopedButtons, ...pageButtons].filter((button, index, all) => {
      return all.indexOf(button) === index && isVisible(button) && (includeDisabled || !button.disabled);
    });

    const sendBtn = buttons.find((button) => {
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

    if (sendBtn) {
      if (!window.__lastSendLogTime || Date.now() - window.__lastSendLogTime > 10000) {
        console.log("[Context Generator Relay] Resolved Send Button element:", sendBtn);
        window.__lastSendLogTime = Date.now();
      }
    } else if (!silent) {
      if (!window.__lastAllButtonsLogTime || Date.now() - window.__lastAllButtonsLogTime > 10000) {
        window.__lastAllButtonsLogTime = Date.now();
        const allButtons = Array.from(document.querySelectorAll("button"));
        console.log(`[Context Generator Relay] Send button not resolved. Listing all ${allButtons.length} button(s) on the page:`);
        allButtons.forEach((btn, idx) => {
          console.log(`Button #${idx}:`, {
            tagName: btn.tagName,
            id: btn.id,
            className: btn.className,
            ariaLabel: btn.getAttribute("aria-label"),
            title: btn.getAttribute("title"),
            dataTestId: btn.getAttribute("data-testid"),
            textContent: (btn.textContent || "").trim().substring(0, 100),
            disabled: btn.disabled,
            type: btn.getAttribute("type"),
            isVisible: isVisible(btn),
            inForm: form ? form.contains(btn) : false
          });
        });
      }
    }
    return sendBtn;
  }

  function getClaudeResponseText(silent = false) {
    const candidates = getClaudeResponseCandidates(silent);
    if (candidates.length === 0) {
      if (!silent) console.log("[Context Generator Relay] No Claude responses found matching .font-claude-response");
      return "";
    }

    const winner = candidates[candidates.length - 1];
    const text = cleanText(winner.innerText || winner.textContent || "");
    
    if (!silent) {
      console.log("[Context Generator Relay] Extracted Claude response from element:", {
        tagName: winner.tagName,
        className: winner.className,
        textSnippet: text.slice(0, 60) + "..."
      });
    }

    return text;
  }

  function getClaudeResponseCandidates(silent = false) {
    const matches = document.querySelectorAll(".font-claude-response");
    if (!silent) console.log(`[Context Generator Relay] Found ${matches.length} element(s) matching .font-claude-response`);
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

  function findBubbleContainer(input) {
    const form = input?.closest("form");
    if (!form) return null;

    const buttons = Array.from(form.querySelectorAll("button")).filter((btn) => {
      return btn.id !== "context-generator-bubble" && isVisible(btn);
    });

    if (buttons.length > 0) {
      return buttons[0].parentNode;
    }

    const selectors = [
      "[class*='controls' i]",
      "[class*='toolbar' i]",
      "[class*='actions' i]",
      "[class*='buttons' i]"
    ];
    for (const selector of selectors) {
      try {
        const found = form.querySelector(selector);
        if (found) return found;
      } catch (e) {}
    }

    return form;
  }

  function findBubblePlacement(input) {
    const container = findBubbleContainer(input);
    if (!container) return null;

    const sendBtn = findSendButton(input, true, true);
    if (sendBtn && container.contains(sendBtn)) {
      return { container, nextSibling: sendBtn };
    }

    const buttons = Array.from(container.querySelectorAll("button")).filter((btn) => {
      return btn.id !== "context-generator-bubble" && isVisible(btn);
    });

    if (buttons.length > 0) {
      const lastBtn = buttons[buttons.length - 1];
      return { container, nextSibling: lastBtn.nextSibling };
    }

    return { container, nextSibling: null };
  }

  function injectFloatingButton(input, container, nextSibling) {
    const bubble = document.createElement("button");
    bubble.id = "context-generator-bubble";
    bubble.title = "Transfer Context to ChatGPT";
    
    // Style to integrate inside Claude's message input bar controls
    bubble.style.width = "28px";
    bubble.style.height = "28px";
    bubble.style.borderRadius = "6px";
    bubble.style.backgroundColor = "transparent";
    bubble.style.color = "currentColor";
    bubble.style.border = "none";
    bubble.style.cursor = "pointer";
    bubble.style.display = "flex";
    bubble.style.alignItems = "center";
    bubble.style.justifyContent = "center";
    bubble.style.fontSize = "16px";
    bubble.style.marginRight = "6px";
    bubble.style.padding = "0";
    bubble.style.transition = "background-color 0.2s, color 0.2s";
    bubble.style.flexShrink = "0";
    bubble.textContent = "🧠";

    bubble.addEventListener("mouseenter", () => {
      bubble.style.backgroundColor = "rgba(217, 119, 6, 0.15)";
      bubble.style.color = "#d97706";
    });
    bubble.addEventListener("mouseleave", () => {
      bubble.style.backgroundColor = "transparent";
      bubble.style.color = "currentColor";
    });

    // Insert the bubble
    container.insertBefore(bubble, nextSibling);

    // Create the overlay singleton on document.body if it doesn't exist yet
    let overlay = document.getElementById("context-generator-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "context-generator-overlay";
      overlay.style.display = "none";
      overlay.style.zIndex = "999999";
      overlay.style.padding = "8px 12px";
      overlay.style.borderRadius = "6px";
      overlay.style.backgroundColor = "#1f2937";
      overlay.style.color = "#ffffff";
      overlay.style.fontSize = "12px";
      overlay.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.2)";
      overlay.style.whiteSpace = "nowrap";
      overlay.style.alignItems = "center";
      overlay.style.gap = "6px";
      overlay.style.fontFamily = "-apple-system, BlinkMacSystemFont, sans-serif";

      const spinner = document.createElement("div");
      spinner.style.width = "12px";
      spinner.style.height = "12px";
      spinner.style.border = "2px solid rgba(255, 255, 255, 0.3)";
      spinner.style.borderTop = "2px solid #ffffff";
      spinner.style.borderRadius = "50%";
      
      if (!document.getElementById("context-generator-styles")) {
        const styleSheet = document.createElement("style");
        styleSheet.id = "context-generator-styles";
        styleSheet.textContent = `
          @keyframes contextSpinner {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `;
        document.head.appendChild(styleSheet);
      }
      spinner.style.animation = "contextSpinner 0.8s linear infinite";

      const textSpan = document.createElement("span");
      textSpan.id = "context-generator-text";
      textSpan.textContent = "Generating context... (10s)";

      overlay.appendChild(spinner);
      overlay.appendChild(textSpan);
      document.body.appendChild(overlay);
    }

    bubble.addEventListener("click", () => {
      if (isRunning) return;

      isRunning = true;
      clearRunningResetTimer();
      runningResetTimer = setTimeout(resetRunningFlag, RUNNING_AUTO_RESET_MS);

      runClaudeFlow();
    });
  }

  function injectButtonIfNeeded() {
    const existingBubble = document.getElementById("context-generator-bubble");
    const input = findClaudeInput();
    
    if (!input) {
      if (existingBubble) {
        console.log("[Context Generator Relay] Input not found, removing existing bubble.");
        existingBubble.remove();
        const overlay = document.getElementById("context-generator-overlay");
        if (overlay) overlay.remove();
      }
      return;
    }

    const placement = findBubblePlacement(input);
    if (!placement) {
      if (existingBubble) {
        console.log("[Context Generator Relay] Bubble placement not found but bubble exists, removing it.");
        existingBubble.remove();
        const overlay = document.getElementById("context-generator-overlay");
        if (overlay) overlay.remove();
      }
      return;
    }

    if (existingBubble) {
      const isCorrectSibling = (existingBubble.nextSibling === placement.nextSibling);
      if (existingBubble.parentNode === placement.container && isCorrectSibling) {
        return;
      } else {
        console.log("[Context Generator Relay] Bubble placement or parent changed. Re-injecting.");
        existingBubble.remove();
        const overlay = document.getElementById("context-generator-overlay");
        if (overlay) overlay.remove();
      }
    }

    console.log("[Context Generator Relay] Injecting bubble in container:", placement.container);
    injectFloatingButton(input, placement.container, placement.nextSibling);
  }

  let injectionInterval = null;

  function startFloatingButtonMonitoring() {
    if (injectionInterval) clearInterval(injectionInterval);
    injectionInterval = setInterval(injectButtonIfNeeded, 1000);
    injectButtonIfNeeded();
  }

  startFloatingButtonMonitoring();
})();
