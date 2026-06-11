(() => {
  if (window.__contextGeneratorClaudeLoaded) {
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

    // Smart polling for completion
    const MAX_WAIT_MS = 30000;
    const POLL_INTERVAL_MS = 1000;
    const startTime = Date.now();
    let previousText = null;
    let identicalCount = 0;

    console.log("[Context Generator Relay] Starting smart polling for Claude's response...");

    while (Date.now() - startTime < MAX_WAIT_MS) {
      await sleep(POLL_INTERVAL_MS);
      
      const text = getClaudeResponseText(true);
      
      if (!text) {
        console.log(`[Context Generator Relay] Poll: No text found yet.`);
        previousText = null;
        identicalCount = 0;
        continue;
      }

      if (text === previousText) {
        identicalCount++;
        console.log(`[Context Generator Relay] Poll: Text stabilized (unchanged for ${identicalCount}s).`);
        if (identicalCount >= 2) {
          console.log("[Context Generator Relay] Claude finished streaming. Capturing text.");
          getClaudeResponseText(false); // Log final extraction
          return text.trim();
        }
      } else {
        console.log(`[Context Generator Relay] Poll: Text changed (streaming).`);
        identicalCount = 0;
        previousText = text;
      }
    }

    console.log("[Context Generator Relay] Smart polling timed out after 30s. Capturing whatever we have.");
    const text = getClaudeResponseText(false);
    if (!text) {
      throw new Error("Claude response was not available after the 30 second maximum wait.");
    }

    return text.trim();
  }
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
})();
