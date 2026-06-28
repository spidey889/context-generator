(() => {
  if (window.__contextGeneratorPlatformLoaded) {
    return;
  }

  window.__contextGeneratorPlatformLoaded = true;

  const BUBBLE_ID = "context-generator-bubble";
  const OVERLAY_ID = "context-generator-overlay";
  const DESTINATION_SHEET_ID = "context-generator-destination-sheet";
  const DESTINATION_SHEET_STYLE_ID = "context-generator-destination-sheet-styles";
  const BUBBLE_SIZE = 42;
  const BUBBLE_GAP = 8;
  const BUBBLE_SLOT_WIDTH = BUBBLE_SIZE + BUBBLE_GAP + 6;
  const DESTINATION_SHEET_WIDTH = 296;
  const RUNNING_AUTO_RESET_MS = 60000;
  const MAX_BACKEND_CONVERSATION_CHARS = 180000;
  const DEFAULT_MAX_COMPOSER_WIDTH = 1320;
  const CAP_CONTEXT_SITE_URL = "https://spidey889.github.io/context-generator";

  const PLATFORMS = {
    claude: {
      name: "Claude",
      detail: "Anthropic",
      host: "claude.ai",
      url: "https://claude.ai/",
      accent: "#d97757",
      logoSize: 24,
      logo: "logos/claude2download__1_-removebg-preview.png",
      inputSelectors: [
        "textarea",
        "[contenteditable='true'][data-placeholder]",
        "[contenteditable='true'][aria-label*='prompt' i]",
        "[contenteditable='true'][aria-label*='message' i]",
        "[contenteditable='true']"
      ],
      fallbackSelectors: ["textarea", "[contenteditable='true']"],
      conversationSelectors: [
        "[data-testid*='user-message' i]",
        "[data-testid*='assistant-message' i]",
        "[data-message-author-role]",
        ".font-claude-response"
      ]
    },
    chatgpt: {
      name: "ChatGPT",
      detail: "OpenAI",
      host: "chatgpt.com",
      alternateHosts: ["openai.com"],
      url: "https://chatgpt.com/",
      accent: "#19c37d",
      logoSize: 21,
      logo: "logos/gptwhitedownload__1_-removebg-preview.png",
      inputSelectors: [
        "#prompt-textarea[contenteditable='true']",
        "[data-testid='prompt-textarea'][contenteditable='true']",
        ".ProseMirror[contenteditable='true']",
        "div[contenteditable='true'][role='textbox']",
        "[contenteditable='true'][data-placeholder]",
        "[contenteditable='true'][aria-label*='message' i]",
        "[contenteditable='true']"
      ],
      fallbackSelectors: [
        "#prompt-textarea",
        "[data-testid='prompt-textarea']",
        "textarea[placeholder]",
        "textarea"
      ],
      conversationSelectors: [
        "[data-message-author-role]",
        "[data-testid^='conversation-turn']",
        "article",
        ".markdown"
      ],
      sendSelectors: [
        "[data-testid='send-button']",
        "button[aria-label*='send' i]",
        "button[data-testid*='send' i]"
      ]
    },
    gemini: {
      name: "Gemini",
      detail: "Google",
      host: "gemini.google.com",
      url: "https://gemini.google.com/",
      accent: "#8ab4f8",
      logoSize: 22,
      logo: "logos/gemini-download__1_-removebg-preview.png",
      maxComposerWidth: 1080,
      composerSelectors: [
        "div[class*='input-area-container' i]",
        "div[class*='input-area' i]",
        "div[class*='prompt-input' i]",
        "div[class*='text-input' i]",
        "prompt-input",
        "rich-textarea",
        "form"
      ],
      inputSelectors: [
        ".ql-editor[contenteditable='true']",
        "rich-textarea [contenteditable='true']",
        "div[contenteditable='true'][aria-label*='prompt' i]",
        "div[contenteditable='true'][role='textbox']",
        "[contenteditable='true'][data-placeholder]",
        "[contenteditable='true']"
      ],
      fallbackSelectors: [
        "rich-textarea textarea",
        "textarea[aria-label*='prompt' i]",
        "textarea[placeholder]",
        "textarea"
      ],
      conversationSelectors: [
        "user-query",
        "model-response",
        "message-content",
        "[data-test-id*='conversation' i]",
        "[class*='query-text' i]",
        "[class*='response-content' i]"
      ],
      sendSelectors: [
        "button[aria-label*='send' i]",
        "button[data-test-id*='send' i]"
      ]
    },
    grok: {
      name: "Grok",
      detail: "xAI",
      host: "grok.com",
      url: "https://grok.com/",
      accent: "#f5f5f5",
      logoSize: 24,
      logo: "logos/grokwhitedownload__1_-removebg-preview.png",
      inputSelectors: [
        "[data-testid='grokInput'][contenteditable='true']",
        "[data-testid='grok-input'][contenteditable='true']",
        "div[contenteditable='true'][aria-label*='ask' i]",
        "div[contenteditable='true'][role='textbox']",
        "[contenteditable='true'][data-placeholder]",
        "[contenteditable='true']"
      ],
      fallbackSelectors: [
        "[data-testid='grokInput'] textarea",
        "[data-testid='grok-input'] textarea",
        "textarea[data-testid='grokInput']",
        "textarea[data-testid='grok-input']",
        "textarea[placeholder*='ask' i]",
        "textarea[aria-label*='ask' i]",
        "textarea[placeholder]",
        "textarea"
      ],
      conversationSelectors: [
        "[data-testid*='message' i]",
        "[class*='message' i]",
        "article"
      ],
      sendSelectors: [
        "button[aria-label*='send' i]",
        "button[aria-label*='submit' i]",
        "button[data-testid*='send' i]",
        "button[data-testid*='submit' i]"
      ]
    },
    deepseek: {
      name: "DeepSeek",
      detail: "DeepSeek",
      host: "chat.deepseek.com",
      url: "https://chat.deepseek.com/",
      accent: "#4c8dff",
      logoSize: 22,
      logo: "logos/deepseek-download__1_-removebg-preview.png",
      maxComposerWidth: 1140,
      composerSelectors: [
        "div[class*='input-container' i]",
        "div[class*='chat-input' i]",
        "div[class*='input-box' i]",
        "div[class*='composer' i]",
        "div[class*='textarea' i]",
        "form"
      ],
      inputSelectors: [
        "#chat-input[contenteditable='true']",
        "div[contenteditable='true'][aria-label*='message' i]",
        "div[contenteditable='true'][role='textbox']",
        "[contenteditable='true'][data-placeholder]",
        "[contenteditable='true']"
      ],
      fallbackSelectors: [
        "textarea[name='search']",
        "#chat-input",
        "textarea[placeholder*='message' i]",
        "textarea[placeholder]",
        "textarea"
      ],
      conversationSelectors: [
        ".ds-markdown",
        "[class*='message' i]",
        "[class*='chat-item' i]",
        "[data-role]"
      ],
      sendSelectors: [
        "button[aria-label*='send' i]",
        "button[class*='send' i]",
        "button[type='submit']"
      ]
    }
  };

  const currentPlatform = getCurrentPlatform();
  if (!currentPlatform) {
    return;
  }

  let isRunning = false;
  let runningResetTimer = null;
  let currentInput = null;
  let reservedActionCluster = null;
  let reservedComposerSurface = null;
  let destinationSheetAnimationFrame = null;
  let floatingButtonFrame = null;
  let floatingButtonObserver = null;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "PASTE_CONTEXT") {
      pasteIntoPlatform(message.text, message.destination)
        .then(() => sendResponse({ ok: true }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    }

    if (message?.type === "START_CONTEXT_TRANSFER") {
      if (isRunning) {
        sendResponse({ ok: false, error: "Context transfer is already running." });
        return false;
      }

      const destination = message.destination || getDefaultDestinationId();
      isRunning = true;
      clearRunningResetTimer();
      runningResetTimer = setTimeout(resetRunningFlag, RUNNING_AUTO_RESET_MS);
      sendResponse({ ok: true });
      runContextFlow(destination);
      return false;
    }

    return false;
  });

  startFloatingButtonMonitoring();

  async function runContextFlow(destinationId) {
    try {
      const conversationText = scrapeConversationText();
      showOverlay();
      const summary = await summarizeWithBackend(conversationText);
      resetRunningFlag();
      await notifyBackground({ type: "TRANSFER_TO_DESTINATION", destination: destinationId, text: summary });
    } catch (error) {
      resetRunningFlag();
      showErrorOverlay(error.message);
      await notifyBackground({ type: "CONTEXT_TRANSFER_ERROR", error: error.message }).catch(() => {});
    }
  }

  async function summarizeWithBackend(conversationText) {
    const response = await notifyBackground({
      type: "SUMMARIZE_WITH_BACKEND",
      conversation: conversationText
    });

    if (!response?.summary?.trim()) {
      throw new Error("Backup summarizer returned no summary.");
    }

    return response.summary.trim();
  }

  async function notifyBackground(message) {
    const response = await chrome.runtime.sendMessage(message);
    if (response && response.ok === false) {
      throw new Error(response.error || "Unknown background error");
    }
    return response;
  }

  function getDefaultDestinationId() {
    return currentPlatform.id === "chatgpt" ? "claude" : "chatgpt";
  }

  function getCurrentPlatform() {
    const hostname = window.location.hostname;
    return Object.entries(PLATFORMS)
      .map(([id, platform]) => ({ ...platform, id }))
      .find((platform) => hostMatches(hostname, platform));
  }

  function hostMatches(hostname, platform) {
    const hosts = [platform.host, ...(platform.alternateHosts || [])];
    return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  }

  function getPlatform(platformId) {
    const platform = PLATFORMS[platformId];
    return platform ? { ...platform, id: platformId } : null;
  }

  async function pasteIntoPlatform(text, destinationId) {
    const destination = getPlatform(destinationId) || currentPlatform;
    if (!destination) {
      throw new Error("This AI destination is not supported.");
    }

    if (!text?.trim()) {
      throw new Error(`No text was provided for ${destination.name}.`);
    }

    const input = await waitForElement(() => findPlatformInput(destination), 15000, `${destination.name} message input`);
    if (!input) {
      showFallbackModal(text.trim(), destination.name);
      throw new Error(`${destination.name} message input element could not be found.`);
    }

    setEditorText(input, text.trim());

    const sampleText = text.trim().slice(0, 20);
    if (!getElementText(input).includes(sampleText)) {
      showFallbackModal(text.trim(), destination.name);
      throw new Error(`Paste operation failed to populate the ${destination.name} editor.`);
    }

    const sendButton = await waitForElement(() => findSendButton(input, destination), 10000, `${destination.name} send button`);
    sendButton.click();
  }

  function findPlatformInput(platform = currentPlatform) {
    const selectors = [...platform.inputSelectors, ...platform.fallbackSelectors];
    const candidates = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element, index, all) => {
        return all.indexOf(element) === index && isVisible(element) && !element.closest("[aria-hidden='true']");
      });

    return candidates
      .map((element) => ({ element, score: scoreInputCandidate(element) }))
      .sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  function scoreInputCandidate(element) {
    const rect = element.getBoundingClientRect();
    const label = getElementLabel(element);

    let score = 0;
    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) score += 24;
    if (element.isContentEditable) score += 20;
    if (element.closest("form")) score += 48;
    if (/\b(message|prompt|chat|write|ask|input)\b/.test(label)) score += 72;
    if (rect.width >= 240) score += 24;
    if (rect.height >= 18 && rect.height <= 280) score += 18;
    if (rect.bottom >= window.innerHeight * 0.45) score += 56;
    if (rect.bottom >= window.innerHeight * 0.7) score += 32;
    if (rect.top < 120 && rect.bottom < window.innerHeight * 0.45) score -= 90;

    return score;
  }

  function findSendButton(input, platform = currentPlatform) {
    const scopedRoot = input?.closest("form") || findComposerSurfaceElement(input);
    const scopedButtons = scopedRoot ? Array.from(scopedRoot.querySelectorAll("button")) : [];
    const selectorButtons = (platform.sendSelectors || [])
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const pageButtons = Array.from(document.querySelectorAll("button"));
    const buttons = [...selectorButtons, ...scopedButtons, ...pageButtons].filter((button, index, all) => {
      return all.indexOf(button) === index && button.id !== BUBBLE_ID && isVisible(button) && !isDisabled(button);
    });

    return buttons.find((button) => {
      const label = getElementLabel(button, true);
      if (/\b(stop|cancel|attach|upload|voice|mic|microphone|new|menu)\b/.test(label)) return false;
      return /\b(send|submit)\b/.test(label) || button.type === "submit";
    }) || scopedButtons.find((button) => {
      return button.id !== BUBBLE_ID && isVisible(button) && !isDisabled(button) && button.type === "submit";
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

    const target = element.querySelector("p") || element;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = document.execCommand("insertText", false, text);
    let hasText = getElementText(element).includes(text.slice(0, 20));

    if (!inserted || !hasText) {
      element.focus();
      document.execCommand("selectAll", false, null);
      inserted = document.execCommand("insertText", false, text);
      hasText = getElementText(element).includes(text.slice(0, 20));
    }

    if (!hasText) {
      element.textContent = text;
    }

    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function scrapeConversationText() {
    const turns = getConversationTurns();
    const transcript = turns
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join("\n\n")
      .trim();

    if (transcript && turns.length >= 2) {
      return limitConversationText(`${currentPlatform.name} conversation:\n\n${transcript}`);
    }

    return limitConversationText(`${currentPlatform.name} conversation:\n\n${scrapeMainConversationText()}`);
  }

  function getConversationTurns() {
    const selectors = [...currentPlatform.conversationSelectors, "[data-message-author-role]"];
    const candidates = [];

    document.querySelectorAll(selectors.join(",")).forEach((element) => {
      if (isContextGeneratorNode(element) || !isVisible(element)) return;

      const text = cleanText(element.innerText || element.textContent || "");
      if (!text || text.length < 2) return;

      candidates.push({
        element,
        role: getConversationRole(element),
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

  function getConversationRole(element) {
    const label = getElementLabel(element);
    if (/\b(user|human|you|me|query)\b/.test(label)) return "User";
    if (/\b(assistant|model|response|claude|chatgpt|gemini|grok|deepseek|bot)\b/.test(label)) {
      return currentPlatform.name;
    }
    return "Message";
  }

  function scrapeMainConversationText() {
    const roots = [
      document.querySelector("main"),
      document.querySelector("[data-testid*='conversation' i]"),
      document.querySelector("[class*='conversation' i]"),
      document.querySelector("[class*='chat' i]"),
      document.body
    ].filter(Boolean);
    const root = roots.find((element) => cleanText(element.innerText || element.textContent || "").length > 200) || document.body;

    return cleanText(root.innerText || root.textContent || "");
  }

  function limitConversationText(text) {
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

  function ensureFloatingButton() {
    const input = findPlatformInput();
    const existingBubble = document.getElementById(BUBBLE_ID);

    if (!input) {
      if (existingBubble) existingBubble.style.display = "none";
      hideDestinationSheet();
      releaseBubbleSlot();
      releaseComposerSurface();
      if (currentInput) {
        currentInput.removeEventListener("input", scheduleFloatingButtonUpdate);
      }
      currentInput = null;
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

    if (currentInput !== input) {
      if (currentInput) {
        currentInput.removeEventListener("input", scheduleFloatingButtonUpdate);
      }
      currentInput = input;
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
    bubble.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
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
    title.textContent = `Send ${currentPlatform.name} context to`;
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
    badge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.location.assign(CAP_CONTEXT_SITE_URL);
    });
    header.appendChild(title);
    header.appendChild(badge);
    sheet.appendChild(header);

    const options = Object.entries(PLATFORMS)
      .filter(([id]) => id !== currentPlatform.id)
      .map(([id, platform]) => ({ ...platform, id }));

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
        "cursor:pointer",
        "text-align:left",
        "font:inherit",
        "outline:0",
        "position:relative",
        "overflow:hidden",
        "isolation:isolate",
        "box-shadow:inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.42), 0 1px 0 rgba(255,255,255,0.018)",
        "transition:background 0.13s ease, border-color 0.13s ease, box-shadow 0.13s ease, transform 0.13s ease"
      ].join(";");

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

      const logoWrap = document.createElement("div");
      logoWrap.style.cssText = "width:26px;height:26px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;opacity:0.96;position:relative;z-index:2";
      const logo = document.createElement("img");
      logo.src = chrome.runtime.getURL(option.logo);
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

      const spinner = document.createElement("span");
      spinner.className = "context-generator-tile-spinner";
      spinner.setAttribute("aria-hidden", "true");

      const setButtonActive = () => {
        button.style.background = "linear-gradient(180deg, #171717 0%, #111111 58%, #0c0c0c 100%)";
        button.style.borderColor = `${option.accent}52`;
        button.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.085), inset 0 -1px 0 rgba(0,0,0,0.46), 0 0 0 1px ${option.accent}1f, 0 8px 18px rgba(0,0,0,0.24)`;
        aura.style.opacity = "0.56";
        button.style.transform = "translateY(-1px)";
      };
      const setButtonIdle = () => {
        button.style.background = "linear-gradient(180deg, #131313 0%, #0f0f0f 58%, #0c0c0c 100%)";
        button.style.borderColor = "rgba(255,255,255,0.08)";
        button.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -1px 0 rgba(0,0,0,0.42), 0 1px 0 rgba(255,255,255,0.018)";
        aura.style.opacity = "0.28";
        button.style.transform = "translateY(0)";
      };

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
        if (button.dataset.contextGeneratorLoading === "true") return;
        button.dataset.contextGeneratorLoading = "true";
        button.setAttribute("aria-busy", "true");
        button.style.pointerEvents = "none";
        spinner.style.display = "block";
        detail.textContent = "Mistral...";
        button.style.transform = "scale(0.985)";
        window.setTimeout(() => startDestinationTransfer(option.id), 120);
      });

      grid.appendChild(button);
    });

    sheet.appendChild(grid);

    const footer = document.createElement("div");
    footer.textContent = "Summary opens, pastes, and sends automatically";
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

  function startDestinationTransfer(destinationId) {
    hideDestinationSheet();
    if (isRunning) return;
    isRunning = true;
    clearRunningResetTimer();
    runningResetTimer = setTimeout(resetRunningFlag, RUNNING_AUTO_RESET_MS);
    runContextFlow(destinationId);
  }

  function ensureFloatingOverlay() {
    if (!document.getElementById(OVERLAY_ID)) {
      const overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.dataset.contextGeneratorOwned = "true";
      overlay.style.cssText = [
        "display:none",
        "position:fixed",
        "z-index:999999",
        "padding:8px 12px",
        "border-radius:6px",
        "background:#1f2937",
        "color:#fff",
        "font-size:12px",
        "box-shadow:0 4px 12px rgba(0,0,0,0.2)",
        "white-space:nowrap",
        "align-items:center",
        "gap:6px",
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
      textSpan.textContent = "Summarizing with Mistral...";
      overlay.appendChild(spinner);
      overlay.appendChild(textSpan);
      document.body.appendChild(overlay);
    }
  }

  function showOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    const textSpan = document.getElementById("context-generator-text");
    const bubble = document.getElementById(BUBBLE_ID);

    if (overlay && textSpan && bubble) {
      const rect = bubble.getBoundingClientRect();
      overlay.style.position = "fixed";
      overlay.style.top = `${rect.top - 45}px`;
      overlay.style.left = `${rect.left - 80}px`;
      overlay.style.display = "flex";
      textSpan.textContent = "Summarizing with Mistral...";
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
    if (bubble) {
      bubble.disabled = false;
      bubble.style.opacity = "1";
      bubble.style.cursor = "pointer";
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
      header.textContent = "Transfer Failed";

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

  function showFallbackModal(text, destinationName) {
    let modal = document.getElementById("context-generator-fallback-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "context-generator-fallback-modal";
      modal.style.position = "fixed";
      modal.style.zIndex = "99999999";
      modal.style.top = "0";
      modal.style.left = "0";
      modal.style.width = "100%";
      modal.style.height = "100%";
      modal.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
      modal.style.display = "flex";
      modal.style.alignItems = "center";
      modal.style.justifyContent = "center";
      modal.style.fontFamily = "-apple-system, BlinkMacSystemFont, sans-serif";

      const content = document.createElement("div");
      content.style.backgroundColor = "#2f2f2f";
      content.style.color = "#ffffff";
      content.style.padding = "24px";
      content.style.borderRadius = "12px";
      content.style.maxWidth = "500px";
      content.style.width = "90%";
      content.style.boxShadow = "0 8px 32px rgba(0, 0, 0, 0.4)";
      content.style.display = "flex";
      content.style.flexDirection = "column";
      content.style.gap = "16px";

      const title = document.createElement("div");
      title.style.fontSize = "18px";
      title.style.fontWeight = "bold";
      title.textContent = "Auto-paste failed";

      const desc = document.createElement("div");
      desc.id = "context-generator-fallback-desc";
      desc.style.fontSize = "14px";
      desc.style.color = "#c5c5c5";

      const textarea = document.createElement("textarea");
      textarea.id = "context-generator-fallback-text";
      textarea.readOnly = true;
      textarea.style.height = "150px";
      textarea.style.backgroundColor = "#1e1e1e";
      textarea.style.color = "#d4d4d4";
      textarea.style.border = "1px solid #4f4f4f";
      textarea.style.borderRadius = "6px";
      textarea.style.padding = "10px";
      textarea.style.fontFamily = "monospace";
      textarea.style.fontSize = "12px";
      textarea.style.resize = "none";

      const buttonContainer = document.createElement("div");
      buttonContainer.style.display = "flex";
      buttonContainer.style.justifyContent = "flex-end";
      buttonContainer.style.gap = "10px";

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy Context";
      copyBtn.style.padding = "8px 16px";
      copyBtn.style.borderRadius = "6px";
      copyBtn.style.border = "none";
      copyBtn.style.backgroundColor = "#d97706";
      copyBtn.style.color = "#ffffff";
      copyBtn.style.cursor = "pointer";
      copyBtn.style.fontWeight = "bold";

      const dismissBtn = document.createElement("button");
      dismissBtn.textContent = "Dismiss";
      dismissBtn.style.padding = "8px 16px";
      dismissBtn.style.borderRadius = "6px";
      dismissBtn.style.border = "1px solid #5f5f5f";
      dismissBtn.style.backgroundColor = "transparent";
      dismissBtn.style.color = "#ffffff";
      dismissBtn.style.cursor = "pointer";

      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = "Copied!";
          copyBtn.style.backgroundColor = "#10b981";
          setTimeout(() => {
            copyBtn.textContent = "Copy Context";
            copyBtn.style.backgroundColor = "#d97706";
          }, 2000);
        } catch (err) {
          textarea.select();
          document.execCommand("copy");
          copyBtn.textContent = "Copied!";
          copyBtn.style.backgroundColor = "#10b981";
        }
      });

      dismissBtn.addEventListener("click", () => {
        modal.remove();
      });

      buttonContainer.appendChild(dismissBtn);
      buttonContainer.appendChild(copyBtn);
      content.appendChild(title);
      content.appendChild(desc);
      content.appendChild(textarea);
      content.appendChild(buttonContainer);
      modal.appendChild(content);
      document.body.appendChild(modal);
    }

    const desc = document.getElementById("context-generator-fallback-desc");
    if (desc) {
      desc.textContent = `We couldn't automatically paste and send the context in ${destinationName}. Please copy it below and paste it manually:`;
    }

    const textarea = document.getElementById("context-generator-fallback-text");
    if (textarea) {
      textarea.value = text;
    }
  }

  function updateFloatingButtonPosition() {
    const bubble = document.getElementById(BUBBLE_ID);
    const input = findPlatformInput();
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

    bubble.style.left = "auto";
    bubble.style.right = `${right}px`;
    bubble.style.top = `${Math.round(top)}px`;
    bubble.style.display = "flex";
  }

  function findComposerActionButton(input, composerRect) {
    if (!input || !composerRect) return null;

    const buttons = Array.from(document.querySelectorAll("button")).filter((button) => {
      return button.id !== BUBBLE_ID && isVisible(button);
    });

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

  function findComposerSurfaceElement(input) {
    const inputRect = input?.getBoundingClientRect();
    if (!inputRect) return null;

    const candidates = getPlatformComposerCandidates(input, inputRect);
    let node = input.parentElement;

    while (node && node !== document.body) {
      const rect = node.getBoundingClientRect();
      if (isComposerSurfaceCandidate(node, rect, inputRect)) {
        candidates.push({ node, rect });
      }
      node = node.parentElement;
    }

    const bestCandidate = pickComposerSurfaceCandidate(candidates, input);
    if (bestCandidate) return bestCandidate;

    const form = input.closest("form");
    const formRect = form?.getBoundingClientRect();
    if (formRect && isComposerSurfaceCandidate(form, formRect, inputRect)) {
      return form;
    }

    return input.parentElement;
  }

  function getPlatformComposerCandidates(input, inputRect) {
    const selectors = currentPlatform.composerSelectors || [];
    const candidates = [];

    selectors.forEach((selector) => {
      const closest = input.closest(selector);
      if (closest) {
        const rect = closest.getBoundingClientRect();
        if (isComposerSurfaceCandidate(closest, rect, inputRect)) {
          candidates.push({ node: closest, rect, preferred: true });
        }
      }

      document.querySelectorAll(selector).forEach((element) => {
        if (!element.contains(input)) return;
        const rect = element.getBoundingClientRect();
        if (isComposerSurfaceCandidate(element, rect, inputRect)) {
          candidates.push({ node: element, rect, preferred: true });
        }
      });
    });

    return candidates.filter((candidate, index, all) => {
      return all.findIndex((other) => other.node === candidate.node) === index;
    });
  }

  function isComposerSurfaceCandidate(element, rect, inputRect) {
    if (!element || !rect || !inputRect || isContextGeneratorNode(element)) return false;

    const maxWidth = getMaxComposerSurfaceWidth();
    return (
      rect.width >= 280 &&
      rect.width <= maxWidth &&
      rect.height >= 40 &&
      rect.height <= 260 &&
      rect.left <= inputRect.left + 96 &&
      rect.right >= inputRect.right - 18 &&
      rect.top <= inputRect.top + 80 &&
      rect.bottom >= inputRect.bottom - 18
    );
  }

  function getMaxComposerSurfaceWidth() {
    return Math.min(currentPlatform.maxComposerWidth || DEFAULT_MAX_COMPOSER_WIDTH, window.innerWidth - 24);
  }

  function pickComposerSurfaceCandidate(candidates, input) {
    if (!candidates.length) return null;

    return candidates
      .map((candidate) => ({
        ...candidate,
        score: scoreComposerSurfaceCandidate(candidate, input)
      }))
      .sort((a, b) => b.score - a.score)[0].node;
  }

  function scoreComposerSurfaceCandidate(candidate, input) {
    const inputRect = input.getBoundingClientRect();
    const rect = candidate.rect;
    const buttonCount = Array.from(candidate.node.querySelectorAll("button"))
      .filter((button) => button.id !== BUBBLE_ID && isVisible(button)).length;

    let score = candidate.preferred ? 40 : 0;
    score += Math.min(buttonCount, 4) * 34;
    if (rect.width >= inputRect.width + 120) score += 28;
    if (rect.width <= inputRect.width + 44) score -= 34;
    if (rect.height <= 180) score += 18;
    score -= (rect.width * rect.height) / 22000;

    return score;
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

    return cluster || actionBtn;
  }

  function releaseBubbleSlot() {
    if (!reservedActionCluster) return;

    const originalTransform = reservedActionCluster.getAttribute("data-context-generator-original-transform") || "";
    reservedActionCluster.style.transform = originalTransform;
    reservedActionCluster.style.willChange = "";
    reservedActionCluster.removeAttribute("data-context-generator-original-transform");
    reservedActionCluster = null;
  }

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
      Boolean(node.closest?.(`#${BUBBLE_ID}, #${OVERLAY_ID}, #context-generator-styles, #${DESTINATION_SHEET_ID}`))
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

  function getElementLabel(element, includeText = false) {
    const parts = [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.getAttribute("data-test-id"),
      element.getAttribute("data-message-author-role"),
      element.getAttribute("data-role"),
      element.getAttribute("placeholder"),
      element.getAttribute("data-placeholder"),
      element.getAttribute("role"),
      element.id,
      element.className
    ];

    if (includeText) {
      parts.push(element.textContent || "");
    }

    return parts
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
  }

  function getElementText(element) {
    return element.value || element.innerText || element.textContent || "";
  }

  function cleanText(text) {
    return text.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim();
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function isDisabled(element) {
    return (
      element.disabled ||
      element.getAttribute("aria-disabled") === "true" ||
      element.getAttribute("disabled") !== null ||
      element.dataset.disabled === "true"
    );
  }
})();
