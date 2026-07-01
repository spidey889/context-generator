(() => {
  const CONTENT_SCRIPT_LOAD_ID = "platform-content-2026-07-01-ambient-tile-color";
  const BUBBLE_ID = "context-generator-bubble";
  const OVERLAY_ID = "context-generator-overlay";
  const ONBOARDING_ID = "context-generator-onboarding";
  const ONBOARDING_STYLE_ID = "context-generator-onboarding-styles";
  const DESTINATION_SHEET_ID = "context-generator-destination-sheet";
  const DESTINATION_SHEET_STYLE_ID = "context-generator-destination-sheet-styles";

  if (window.__contextGeneratorPlatformLoaded === CONTENT_SCRIPT_LOAD_ID) {
    return;
  }

  cleanupContextGeneratorNodes();

  window.__contextGeneratorPlatformLoaded = CONTENT_SCRIPT_LOAD_ID;

  const BUBBLE_SIZE = 42;
  const BUBBLE_GAP = 8;
  const BUBBLE_SLOT_WIDTH = BUBBLE_SIZE + BUBBLE_GAP + 6;
  const DESTINATION_SHEET_WIDTH = 296;
  const RUNNING_AUTO_RESET_MS = 60000;
  const MAX_BACKEND_CONVERSATION_CHARS = 80000;
  const DEFAULT_MAX_COMPOSER_WIDTH = 1320;
  const DESTINATION_TITLE_TEXT = "Where to continue?";
  const DESTINATION_HELPER_TEXT = "Context goes straight into the input box";
  const ONBOARDING_STORAGE_KEY = "context-generator-onboarding-dismissed-v1";
  const ONBOARDING_TITLE_TEXT = "Tiny bridge, big memory";
  const ONBOARDING_BODY_TEXT = "Tap the bubble when this chat deserves a carry-on. I'll pack the useful bits into another AI's input, ready for your review.";
  const ONBOARDING_SHOW_DELAY_MS = 650;
  const NO_CONVERSATION_ERROR_TITLE = "Nothing to carry yet";
  const NO_CONVERSATION_ERROR_MESSAGE = "Chat is empty. Send one message first, then I'll pack the context.";
  const MIN_FALLBACK_CONVERSATION_CHARS = 120;
  const EMPTY_START_SCREEN_TEXTS = [
    "the mic is yours",
    "start chatting",
    "message chatgpt",
    "message claude",
    "message deepseek",
    "ask gemini",
    "ask grok",
    "ask anything",
    "ask me anything",
    "new chat",
    "what can i help with",
    "what can i help you with",
    "how can i help",
    "how can i help you today",
    "what are you working on",
    "where should we begin",
    "try asking",
    "suggested prompts"
  ];
  const PASTE_RETRY_TIMEOUT_MS = 14000;
  const PASTE_RETRY_INTERVAL_MS = 180;
  const PASTE_VERIFY_TIMEOUT_MS = 1000;
  const WARM_SUMMARY_TTL_MS = 30000;
  const WARM_SUMMARY_START_DELAY_MS = 0;
  const HANDOFF_STATUS_INTERVAL_MS = 1850;
  const HANDOFF_QUOTES = [
    "Good context beats a cold start.",
    "Tiny bridge, cleaner next reply.",
    "Packing the useful parts only.",
    "Your next AI gets the good bits.",
    "No stale baggage, just signal.",
    "Making the handoff feel instant."
  ];
  const HANDOFF_STATUS_STEPS = [
    "Summarizing context",
    "Compacting the useful bits",
    "Preparing {destination}",
    "Warming the destination tab",
    "Polishing the handoff",
    "Pasting context into {destination}"
  ];
  const GENERIC_CONVERSATION_SELECTORS = [
    "[data-message-author-role]",
    "[data-testid*='conversation' i]",
    "[data-testid*='message' i]",
    "[data-testid*='chat' i]",
    "[data-role*='message' i]",
    "[class*='message' i]",
    "[class*='markdown' i]",
    "article"
  ];
  const FALLBACK_CONVERSATION_ROOT_SELECTORS = [
    "main",
    "[role='main']",
    "[data-testid*='conversation' i]",
    "[data-testid*='chat' i]",
    "[data-testid*='thread' i]",
    "[class*='conversation' i]",
    "[class*='messages' i]",
    "[class*='message-list' i]",
    "[class*='thread' i]",
    "[class*='chat' i]"
  ];
  const CAP_CONTEXT_SITE_URL = "https://spidey889.github.io/context-generator";
  const EXTENSION_ASSET_BASE_URL = getRuntimeAssetBaseUrl();
  const BUBBLE_ICON_URL = getExtensionAssetUrl("bubble-icon.png");

  const PLATFORMS = {
    claude: {
      name: "Claude",
      detail: "Anthropic",
      host: "claude.ai",
      url: "https://claude.ai/",
      accent: "#d97757",
      logoSize: 24,
      logo: "logos/claude2download__1_-removebg-preview.png",
      retryPaste: true,
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
      retryPaste: true,
      maxComposerWidth: 1120,
      composerSelectors: [
        "form",
        "div[class*='composer' i]",
        "[data-testid*='composer' i]",
        "[data-type*='composer' i]"
      ],
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
      retryPaste: true,
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
      retryPaste: true,
      inputSelectors: [
        "[data-testid='grokInput'][contenteditable='true']",
        "[data-testid='grok-input'][contenteditable='true']",
        "[data-testid*='composer' i] [contenteditable='true']",
        "[data-testid*='prompt' i][contenteditable='true']",
        "[aria-label*='ask grok' i][contenteditable='true']",
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
        "textarea[aria-label*='ask grok' i]",
        "textarea[placeholder*='ask grok' i]",
        "textarea[placeholder*='ask' i]",
        "textarea[aria-label*='ask' i]",
        "textarea[placeholder]",
        "textarea"
      ],
      conversationSelectors: [
        "[data-testid*='message' i]",
        "[class*='message' i]",
        "article"
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
      retryPaste: true,
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
        "[data-testid*='chat-input' i][contenteditable='true']",
        "[data-testid*='composer' i] [contenteditable='true']",
        "div[contenteditable='true'][aria-label*='message' i]",
        "div[contenteditable='true'][aria-label*='ask' i]",
        "div[contenteditable='true'][role='textbox']",
        "[contenteditable='true'][data-placeholder]",
        "[contenteditable='true']"
      ],
      fallbackSelectors: [
        "textarea[name='search']",
        "#chat-input",
        "textarea[aria-label*='message' i]",
        "textarea[aria-label*='ask' i]",
        "textarea[placeholder*='message' i]",
        "textarea[placeholder*='ask' i]",
        "textarea[placeholder]",
        "textarea"
      ],
      conversationSelectors: [
        ".ds-markdown",
        "[class*='message' i]",
        "[class*='chat-item' i]",
        "[data-role]"
      ]
    }
  };

  const currentPlatform = getCurrentPlatform();
  if (!currentPlatform) {
    return;
  }

  let isRunning = false;
  let runningResetTimer = null;
  let reservedActionCluster = null;
  let reservedComposerSurface = null;
  let destinationSheetAnimationFrame = null;
  let floatingButtonFrame = null;
  let floatingButtonObserver = null;
  let floatingButtonMonitoringDisabled = false;
  let warmSummary = null;
  let warmSummaryStartTimer = null;
  let warmSummaryExpireTimer = null;
  let handoffStatusTimer = null;
  let handoffStatusIndex = 0;
  let onboardingTimer = null;
  let onboardingDismissedThisSession = false;

  function cleanupContextGeneratorNodes() {
    [
      BUBBLE_ID,
      OVERLAY_ID,
      ONBOARDING_ID,
      ONBOARDING_STYLE_ID,
      DESTINATION_SHEET_ID,
      DESTINATION_SHEET_STYLE_ID,
      "context-generator-styles",
      "context-generator-error-overlay",
      "context-generator-error-mark",
      "context-generator-fallback-modal"
    ].forEach((id) => document.getElementById(id)?.remove());
  }

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

  async function runContextFlow(destinationId, preparedDestinationPromise = null, warmSummaryRecord = null, scrapedConversationText = null) {
    try {
      const destination = getPlatform(destinationId);
      const conversationText = scrapedConversationText || scrapeConversationText();
      if (isHandoffOverlayVisible()) {
        setHandoffStatus("Summarizing context");
      } else {
        showOverlay(destinationId);
      }
      const summary = await getSummaryForTransfer(conversationText, warmSummaryRecord);
      setHandoffStatus(`Preparing ${destination?.name || "destination"}`);
      const preparedDestination = preparedDestinationPromise ? await preparedDestinationPromise : null;
      setHandoffStatus(`Pasting context into ${destination?.name || "destination"}`);
      await notifyBackground({
        type: "TRANSFER_TO_DESTINATION",
        destination: destinationId,
        text: summary,
        preparedTabId: preparedDestination?.tabId || null
      });
      resetRunningFlag();
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

  async function getSummaryForTransfer(conversationText, warmSummaryRecord = null) {
    const fingerprint = getConversationFingerprint(conversationText);
    const candidate = warmSummaryRecord || warmSummary;

    if (isWarmSummaryUsable(candidate, fingerprint)) {
      const summary = candidate.summary || await candidate.promise;
      if (summary && isWarmSummaryUsable(candidate, fingerprint)) {
        clearWarmSummary();
        return summary;
      }
    }

    if (candidate) clearWarmSummary();
    return summarizeWithBackend(conversationText);
  }

  function scheduleWarmSummary() {
    if (isRunning) return;
    if (warmSummaryStartTimer) clearTimeout(warmSummaryStartTimer);

    warmSummaryStartTimer = window.setTimeout(() => {
      warmSummaryStartTimer = null;
      startWarmSummary();
    }, WARM_SUMMARY_START_DELAY_MS);
  }

  function startWarmSummary() {
    if (isRunning) return;

    let conversationText;
    try {
      conversationText = scrapeConversationText();
    } catch (error) {
      logTransferDebug(`Warm summary skipped. ${error.message}`);
      return;
    }

    const fingerprint = getConversationFingerprint(conversationText);
    if (isWarmSummaryUsable(warmSummary, fingerprint)) return;

    clearWarmSummary();
    const now = Date.now();
    const record = {
      fingerprint,
      startedAt: now,
      expiresAt: now + WARM_SUMMARY_TTL_MS,
      summary: null,
      promise: null
    };

    record.promise = summarizeWithBackend(conversationText)
      .then((summary) => {
        if (warmSummary === record && Date.now() <= record.expiresAt) {
          record.summary = summary;
        }
        return summary;
      })
      .catch((error) => {
        if (warmSummary === record) {
          logTransferDebug(`Warm summary failed. ${error.message}`);
          clearWarmSummary();
        }
        return null;
      });

    warmSummary = record;
    warmSummaryExpireTimer = window.setTimeout(() => {
      if (warmSummary === record) clearWarmSummary();
    }, WARM_SUMMARY_TTL_MS);
  }

  function isWarmSummaryUsable(record, fingerprint) {
    return Boolean(record && record.fingerprint === fingerprint && Date.now() <= record.expiresAt);
  }

  function clearWarmSummary() {
    if (warmSummaryStartTimer) {
      clearTimeout(warmSummaryStartTimer);
      warmSummaryStartTimer = null;
    }

    if (warmSummaryExpireTimer) {
      clearTimeout(warmSummaryExpireTimer);
      warmSummaryExpireTimer = null;
    }

    warmSummary = null;
  }

  function getConversationFingerprint(text) {
    const cleaned = cleanText(text);
    return `${cleaned.length}:${cleaned.slice(0, 180)}:${cleaned.slice(-220)}`;
  }

  function prepareDestinationTab(destinationId) {
    return notifyBackground({
      type: "PREPARE_DESTINATION",
      destination: destinationId
    }).catch((error) => {
      logTransferDebug(`Destination pre-open failed; falling back to normal transfer. ${error.message}`);
      return null;
    });
  }

  async function notifyBackground(message) {
    let response;
    try {
      response = await chrome.runtime.sendMessage(message);
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        throw new Error("Extension was reloaded. Refresh this AI tab once, then try Cap Context again.");
      }
      throw error;
    }

    if (response && response.ok === false) {
      throw new Error(response.error || "Unknown background error");
    }
    return response;
  }

  function getRuntimeAssetBaseUrl() {
    try {
      return globalThis.chrome?.runtime?.getURL?.("") || "";
    } catch (_error) {
      return "";
    }
  }

  function getExtensionAssetUrl(path) {
    if (!EXTENSION_ASSET_BASE_URL) return "";
    return `${EXTENSION_ASSET_BASE_URL}${path}`;
  }

  function isExtensionContextInvalidated(error) {
    return /extension context invalidated/i.test(error?.message || "");
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

    const trimmedText = text.trim();

    if (destination.retryPaste) {
      await pasteWithRetry(trimmedText, destination);
      return;
    }

    const input = await waitForElement(() => findPlatformInput(destination), 15000, `${destination.name} message input`);
    if (!input) {
      showFallbackModal(trimmedText, destination.name);
      throw new Error(`${destination.name} message input element could not be found.`);
    }

    setEditorText(input, trimmedText);

    if (!editorContainsText(input, trimmedText)) {
      showFallbackModal(trimmedText, destination.name);
      throw new Error(`Paste operation failed to populate the ${destination.name} editor.`);
    }

    input.focus?.();
  }

  async function pasteWithRetry(text, destination) {
    const startedAt = Date.now();
    let sawInput = false;
    let lastError = null;

    while (Date.now() - startedAt <= PASTE_RETRY_TIMEOUT_MS) {
      const input = findReadyPlatformInput(destination);
      if (input) {
        sawInput = true;

        try {
          setEditorText(input, text);

          if (await waitForEditorText(input, text, PASTE_VERIFY_TIMEOUT_MS)) {
            input.focus?.();
            return input;
          } else {
            lastError = new Error(`Paste operation failed to populate the ${destination.name} editor.`);
          }
        } catch (error) {
          lastError = error;
        }
      }

      await delay(PASTE_RETRY_INTERVAL_MS);
    }

    showFallbackModal(text, destination.name);

    if (!sawInput) {
      throw new Error(`${destination.name} message input element could not be found.`);
    }

    throw lastError || new Error(`Paste operation failed to populate the ${destination.name} editor.`);
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

  function findReadyPlatformInput(platform = currentPlatform) {
    const input = findPlatformInput(platform);
    return isEditorReady(input) ? input : null;
  }

  function isEditorReady(element) {
    if (!element || !isVisible(element) || isDisabled(element)) return false;

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      return !element.readOnly;
    }

    return element.isContentEditable && element.getAttribute("contenteditable") !== "false";
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

  function setEditorText(element, text) {
    element.click();
    element.focus();

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const valueSetter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set;
      valueSetter?.call(element, text);
      dispatchEditorEvents(element, text);
      return;
    }

    const target = element.querySelector("p") || element;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = document.execCommand("insertText", false, text);
    let hasText = editorContainsText(element, text);

    if (!inserted || !hasText) {
      element.focus();
      document.execCommand("selectAll", false, null);
      inserted = document.execCommand("insertText", false, text);
      hasText = editorContainsText(element, text);
    }

    if (!hasText) {
      target.textContent = text;
      hasText = editorContainsText(element, text);
    }

    if (!hasText) {
      element.textContent = text;
    }

    dispatchEditorEvents(target, text);
    if (target !== element) dispatchEditorEvents(element, text);
  }

  function dispatchEditorEvents(element, text) {
    try {
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text
      }));
    } catch {
      element.dispatchEvent(new Event("beforeinput", { bubbles: true, cancelable: true }));
    }

    try {
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    } catch {
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }

    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function logTransferDebug(message) {
    console.debug("[Context Generator Transfer]", message);
  }

  function waitForEditorText(element, text, timeoutMs) {
    const startedAt = Date.now();

    return new Promise((resolve) => {
      const tick = () => {
        if (editorContainsText(element, text)) {
          resolve(true);
          return;
        }

        if (Date.now() - startedAt > timeoutMs) {
          resolve(false);
          return;
        }

        setTimeout(tick, 100);
      };

      tick();
    });
  }

  function editorContainsText(element, text) {
    const expected = normalizeVerificationText(text);
    const actual = normalizeVerificationText(getElementText(element));
    const sample = expected.slice(0, Math.min(24, expected.length));
    return Boolean(sample && actual.includes(sample));
  }

  function normalizeVerificationText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function getCleanVisibleText(element) {
    if (!element) return "";
    const clone = element.cloneNode(true);
    clone.querySelectorAll?.([
      `#${BUBBLE_ID}`,
      `#${OVERLAY_ID}`,
      `#${ONBOARDING_ID}`,
      `#${ONBOARDING_STYLE_ID}`,
      `#${DESTINATION_SHEET_ID}`,
      "#context-generator-styles",
      "#context-generator-error-overlay",
      "#context-generator-fallback-modal",
      "[data-context-generator-owned='true']"
    ].join(",")).forEach((node) => node.remove());

    return cleanText(clone.innerText || clone.textContent || "");
  }

  function scrapeConversationText() {
    const turns = getConversationTurns().filter((turn) => isUsefulConversationTurn(turn));
    const transcript = turns
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join("\n\n")
      .trim();

    if (transcript && isUsefulConversationTranscript(turns)) {
      return limitConversationText(`${currentPlatform.name} conversation:\n\n${transcript}`);
    }

    const fallbackText = hasFallbackConversationEvidence(turns) ? scrapeMainConversationText(turns) : "";
    if (isUsefulFallbackConversationText(fallbackText)) {
      return limitConversationText(`${currentPlatform.name} conversation:\n\n${fallbackText}`);
    }

    throw new Error(NO_CONVERSATION_ERROR_MESSAGE);
  }

  function getConversationTurns() {
    const selectors = [...currentPlatform.conversationSelectors, ...GENERIC_CONVERSATION_SELECTORS];
    const candidates = [];

    document.querySelectorAll([...new Set(selectors)].join(",")).forEach((element) => {
      if (!isConversationCandidateElement(element)) return;

      const text = getCleanVisibleText(element);
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

  function isUsefulConversationTranscript(turns) {
    if (!turns.length) return false;
    if (turns.some(hasExplicitConversationRole)) return true;
    if (turns.length < 2) return false;

    return !isEmptyConversationText(turns.map((turn) => turn.text).join("\n\n"));
  }

  function hasFallbackConversationEvidence(turns) {
    return turns.some(hasExplicitConversationRole);
  }

  function hasExplicitConversationRole(turn) {
    return turn?.role === "User" || turn?.role === currentPlatform.name;
  }

  function isUsefulConversationTurn(turn) {
    if (!turn?.text) return false;

    const text = cleanText(turn.text);
    if (text.length < 3) return false;
    return !isEmptyConversationText(text);
  }

  function scrapeMainConversationText(turns = getConversationTurns()) {
    const roots = FALLBACK_CONVERSATION_ROOT_SELECTORS
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element, index, all) => all.indexOf(element) === index && isVisible(element) && !isContextGeneratorNode(element));

    const rootText = roots
      .map((element) => getCleanVisibleText(element))
      .find((text) => isUsefulFallbackConversationText(text));

    if (rootText) return rootText;

    const combinedText = turns
      .map((turn) => turn.text)
      .join("\n\n");

    return isUsefulFallbackConversationText(combinedText) ? combinedText : "";
  }

  function isUsefulFallbackConversationText(text) {
    const cleaned = cleanText(text);
    if (cleaned.length < MIN_FALLBACK_CONVERSATION_CHARS) return false;
    if (isEmptyConversationText(cleaned)) return false;

    const words = cleaned.split(/\s+/).filter(Boolean);
    return words.length >= 18;
  }

  function isEmptyConversationText(text) {
    const cleaned = cleanText(text).toLowerCase();
    if (!cleaned) return true;

    return EMPTY_START_SCREEN_TEXTS.some((emptyText) => cleaned.includes(emptyText) && cleaned.length < 900);
  }

  function isConversationCandidateElement(element) {
    if (!element || isContextGeneratorNode(element) || !isVisible(element)) return false;
    if (element.matches("input, textarea, button, select, [role='button'], [contenteditable='true']")) return false;
    if (element.closest("nav, header, footer, aside, menu")) return false;
    if (isLikelyPromptSuggestionElement(element)) return false;
    return true;
  }

  function isLikelyPromptSuggestionElement(element) {
    return Boolean(element.closest?.([
      "[aria-label*='suggest' i]",
      "[data-testid*='suggest' i]",
      "[data-test-id*='suggest' i]",
      "[class*='suggest' i]",
      "[data-testid*='starter' i]",
      "[data-test-id*='starter' i]",
      "[class*='starter' i]",
      "[data-testid*='example' i]",
      "[data-test-id*='example' i]",
      "[class*='example' i]"
    ].join(",")));
  }

  function limitConversationText(text) {
    const cleaned = cleanText(text);
    if (cleaned.length <= MAX_BACKEND_CONVERSATION_CHARS) {
      return cleaned;
    }

    const headLength = 16000;
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
      hideOnboardingNudge();
      hideDestinationSheet();
      releaseBubbleSlot();
      releaseComposerSurface();
      return existingBubble;
    }

    const bubble = existingBubble || createFloatingButton();
    if (currentPlatform.id === "chatgpt") {
      releaseBubbleSlot();
      releaseComposerSurface();
      const floatingRoot = getFloatingButtonRoot();
      if (bubble.parentElement !== floatingRoot) {
        floatingRoot.appendChild(bubble);
      }
      ensureFloatingOverlay();
      updateFloatingButtonPosition();
      return bubble;
    }

    const composerSurface = findComposerSurfaceElement(input);
    if (!composerSurface) {
      bubble.style.display = "none";
      hideOnboardingNudge();
      return bubble;
    }

    reserveComposerSurface(composerSurface);

    if (currentPlatform.id !== "chatgpt" && bubble.parentElement !== composerSurface) {
      composerSurface.appendChild(bubble);
    }

    ensureFloatingOverlay();
    updateFloatingButtonPosition();
    return bubble;
  }

  function createFloatingButton() {
    const bubble = document.createElement("button");
    bubble.id = BUBBLE_ID;
    bubble.type = "button";
    bubble.title = DESTINATION_TITLE_TEXT;
    bubble.setAttribute("aria-label", DESTINATION_TITLE_TEXT);
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
    icon.src = BUBBLE_ICON_URL;
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
      dismissOnboardingNudge();
      toggleDestinationSheet();
    });

    return bubble;
  }

  function ensureOnboardingStyles() {
    if (document.getElementById(ONBOARDING_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = ONBOARDING_STYLE_ID;
    style.dataset.contextGeneratorOwned = "true";
    style.textContent = `
      @keyframes contextGeneratorOnboardingIn {
        from {
          opacity: 0;
          transform: translate3d(0, 6px, 0) scale(0.98);
        }
        to {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
      }

      @keyframes contextGeneratorGuideBob {
        from {
          transform: translate3d(0, -1px, 0) rotate(-2deg);
        }
        to {
          transform: translate3d(0, 2px, 0) rotate(2deg);
        }
      }

      @keyframes contextGeneratorGuidePoint {
        from {
          transform: translate3d(0, 0, 0) rotate(-10deg);
        }
        to {
          transform: translate3d(4px, 0, 0) rotate(-7deg);
        }
      }

      #${ONBOARDING_ID} {
        position: fixed;
        z-index: 2147483646;
        width: min(268px, calc(100vw - 28px));
        box-sizing: border-box;
        display: none;
        align-items: center;
        gap: 10px;
        padding: 10px 10px 10px 11px;
        border-radius: 16px;
        border: 1px solid rgba(255,255,255,0.13);
        background: linear-gradient(145deg, #101010 0%, #15151d 62%, #080808 100%);
        color: #ffffff;
        box-shadow: 0 18px 42px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.08);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        animation: contextGeneratorOnboardingIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      .context-generator-onboarding-guide {
        position: relative;
        width: 42px;
        height: 42px;
        flex: 0 0 auto;
        border-radius: 16px 16px 15px 9px;
        background: radial-gradient(circle at 28% 22%, rgba(255,255,255,0.9), rgba(255,255,255,0.18) 18%, transparent 28%), linear-gradient(145deg, #f7f4ee, #c9fff0 56%, #9bd8ff);
        box-shadow: 0 8px 18px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.7);
        animation: contextGeneratorGuideBob 1.25s ease-in-out infinite alternate;
      }

      .context-generator-onboarding-eye {
        position: absolute;
        top: 16px;
        width: 4px;
        height: 4px;
        border-radius: 999px;
        background: #161616;
      }

      .context-generator-onboarding-eye-left {
        left: 13px;
      }

      .context-generator-onboarding-eye-right {
        left: 25px;
      }

      .context-generator-onboarding-smile {
        position: absolute;
        left: 16px;
        top: 24px;
        width: 10px;
        height: 5px;
        border-bottom: 2px solid rgba(22,22,22,0.82);
        border-radius: 0 0 999px 999px;
      }

      .context-generator-onboarding-hand {
        position: absolute;
        top: 18px;
        right: -20px;
        width: 28px;
        height: 7px;
        border-radius: 999px;
        background: linear-gradient(90deg, #f7f4ee, #ffffff);
        box-shadow: 0 3px 8px rgba(0,0,0,0.18);
        transform-origin: 3px 50%;
        animation: contextGeneratorGuidePoint 0.82s ease-in-out infinite alternate;
      }

      .context-generator-onboarding-hand::after {
        content: "";
        position: absolute;
        right: -3px;
        top: -2px;
        width: 9px;
        height: 9px;
        border-radius: 999px;
        background: #ffffff;
      }

      #${ONBOARDING_ID}[data-context-generator-point="left"] .context-generator-onboarding-guide {
        order: 0;
      }

      #${ONBOARDING_ID}[data-context-generator-point="left"] .context-generator-onboarding-hand {
        left: -20px;
        right: auto;
        transform-origin: 25px 50%;
        animation-name: contextGeneratorGuidePointLeft;
      }

      @keyframes contextGeneratorGuidePointLeft {
        from {
          transform: translate3d(0, 0, 0) rotate(190deg);
        }
        to {
          transform: translate3d(-4px, 0, 0) rotate(187deg);
        }
      }

      #${ONBOARDING_ID}[data-context-generator-point="right"] .context-generator-onboarding-guide {
        order: 2;
      }

      .context-generator-onboarding-copy {
        min-width: 0;
        flex: 1;
      }

      .context-generator-onboarding-title {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 13px;
        font-weight: 600;
        line-height: 1.12;
        letter-spacing: 0;
        color: #ffffff;
        text-rendering: geometricPrecision;
      }

      .context-generator-onboarding-body {
        margin-top: 4px;
        font-size: 11.5px;
        font-weight: 500;
        line-height: 1.35;
        letter-spacing: 0;
        color: rgba(255,255,255,0.68);
      }

      .context-generator-onboarding-dismiss {
        flex: 0 0 auto;
        align-self: flex-start;
        width: 24px;
        height: 24px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.11);
        background: rgba(255,255,255,0.06);
        color: rgba(255,255,255,0.76);
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        line-height: 22px;
        padding: 0;
      }

      .context-generator-onboarding-dismiss:hover {
        background: rgba(255,255,255,0.1);
        color: #ffffff;
      }

      @media (prefers-reduced-motion: reduce) {
        #${ONBOARDING_ID},
        .context-generator-onboarding-guide,
        .context-generator-onboarding-hand {
          animation: none;
        }
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function createOnboardingNudge() {
    ensureOnboardingStyles();

    const nudge = document.createElement("div");
    nudge.id = ONBOARDING_ID;
    nudge.dataset.contextGeneratorOwned = "true";
    nudge.setAttribute("role", "note");
    nudge.setAttribute("aria-live", "polite");

    const guide = document.createElement("div");
    guide.className = "context-generator-onboarding-guide";
    guide.setAttribute("aria-hidden", "true");

    const leftEye = document.createElement("span");
    leftEye.className = "context-generator-onboarding-eye context-generator-onboarding-eye-left";
    const rightEye = document.createElement("span");
    rightEye.className = "context-generator-onboarding-eye context-generator-onboarding-eye-right";
    const smile = document.createElement("span");
    smile.className = "context-generator-onboarding-smile";
    const hand = document.createElement("span");
    hand.className = "context-generator-onboarding-hand";
    guide.appendChild(leftEye);
    guide.appendChild(rightEye);
    guide.appendChild(smile);
    guide.appendChild(hand);

    const copy = document.createElement("div");
    copy.className = "context-generator-onboarding-copy";
    const title = document.createElement("div");
    title.className = "context-generator-onboarding-title";
    title.textContent = ONBOARDING_TITLE_TEXT;
    const body = document.createElement("div");
    body.className = "context-generator-onboarding-body";
    body.textContent = ONBOARDING_BODY_TEXT;
    copy.appendChild(title);
    copy.appendChild(body);

    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "context-generator-onboarding-dismiss";
    dismiss.textContent = "OK";
    dismiss.setAttribute("aria-label", "Dismiss Cap Context tip");
    dismiss.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dismissOnboardingNudge();
    });

    nudge.appendChild(guide);
    nudge.appendChild(copy);
    nudge.appendChild(dismiss);
    nudge.addEventListener("click", (event) => event.stopPropagation());
    document.body.appendChild(nudge);
    return nudge;
  }

  function maybeShowOnboardingNudge(bubble) {
    if (!bubble || isOnboardingDismissed() || isRunning || isDestinationSheetOpen()) return;
    if (bubble.style.display === "none") {
      hideOnboardingNudge();
      return;
    }

    const visibleNudge = document.getElementById(ONBOARDING_ID);
    if (visibleNudge && visibleNudge.style.display !== "none") {
      positionOnboardingNudge(visibleNudge, bubble);
      return;
    }

    if (onboardingTimer) {
      const nudge = document.getElementById(ONBOARDING_ID);
      if (nudge && nudge.style.display !== "none") positionOnboardingNudge(nudge, bubble);
      return;
    }

    onboardingTimer = window.setTimeout(() => {
      onboardingTimer = null;
      if (isOnboardingDismissed() || isRunning || isDestinationSheetOpen()) return;

      const currentBubble = document.getElementById(BUBBLE_ID);
      if (!currentBubble || currentBubble.style.display === "none") return;

      const nudge = document.getElementById(ONBOARDING_ID) || createOnboardingNudge();
      positionOnboardingNudge(nudge, currentBubble);
      nudge.style.display = "flex";
    }, ONBOARDING_SHOW_DELAY_MS);
  }

  function positionOnboardingNudge(nudge, bubble) {
    const bubbleRect = bubble.getBoundingClientRect();
    if (!bubbleRect.width || !bubbleRect.height) return;

    const margin = 12;
    const gap = 14;
    const nudgeWidth = Math.min(268, window.innerWidth - margin * 2);
    const nudgeHeight = nudge.offsetHeight || 92;
    const canSitLeft = bubbleRect.left - gap - nudgeWidth >= margin;
    const left = canSitLeft
      ? bubbleRect.left - gap - nudgeWidth
      : Math.min(window.innerWidth - nudgeWidth - margin, bubbleRect.right + gap);
    const top = Math.max(
      margin,
      Math.min(
        bubbleRect.top + bubbleRect.height / 2 - nudgeHeight / 2,
        window.innerHeight - nudgeHeight - margin
      )
    );

    nudge.dataset.contextGeneratorPoint = canSitLeft ? "right" : "left";
    nudge.style.left = `${Math.round(left)}px`;
    nudge.style.top = `${Math.round(top)}px`;
  }

  function hideOnboardingNudge() {
    if (onboardingTimer) {
      clearTimeout(onboardingTimer);
      onboardingTimer = null;
    }

    const nudge = document.getElementById(ONBOARDING_ID);
    if (nudge) nudge.style.display = "none";
  }

  function dismissOnboardingNudge() {
    onboardingDismissedThisSession = true;
    hideOnboardingNudge();

    try {
      window.localStorage?.setItem(ONBOARDING_STORAGE_KEY, "true");
    } catch (_error) {
      // Some AI pages lock storage; the session flag still prevents repeat nags.
    }
  }

  function isOnboardingDismissed() {
    if (onboardingDismissedThisSession) return true;

    try {
      return window.localStorage?.getItem(ONBOARDING_STORAGE_KEY) === "true";
    } catch (_error) {
      return false;
    }
  }

  function ensureDestinationSheetStyles() {
    if (document.getElementById(DESTINATION_SHEET_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = DESTINATION_SHEET_STYLE_ID;
    style.textContent = `
      @keyframes contextGeneratorTileShine {
        0%, 30% {
          opacity: 0;
          transform: translate3d(-150%, 0, 0) skewX(-18deg);
        }
        39% {
          opacity: 0.075;
        }
        58%, 100% {
          opacity: 0;
          transform: translate3d(420%, 0, 0) skewX(-18deg);
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

      @keyframes contextGeneratorTileAuraDrift {
        from {
          transform: translate3d(-5%, 0, 0) scaleX(0.98);
          filter: blur(10px);
        }
        to {
          transform: translate3d(1.5%, 0, 0) scaleX(1.03);
          filter: blur(12px);
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
        animation: contextGeneratorTileShine 8.8s cubic-bezier(0.16, 1, 0.3, 1) infinite;
      }

      .context-generator-tile-aura {
        animation: contextGeneratorTileAuraDrift 4.8s ease-in-out infinite alternate;
      }

      .context-generator-destination-tile[data-context-generator-hover="true"] .context-generator-tile-aura {
        animation-duration: 3s;
      }

      .context-generator-destination-tile[data-context-generator-hover="true"] .context-generator-tile-shine {
        animation-duration: 5.2s;
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
        .context-generator-tile-aura,
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
      "border:1px solid rgba(255,255,255,0.12)",
      "background:linear-gradient(180deg,#080808 0%,#050505 58%,#020202 100%)",
      "box-shadow:0 16px 38px rgba(0,0,0,0.58), 0 0 0 1px rgba(0,0,0,0.72), inset 0 1px 0 rgba(255,255,255,0.07)",
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
    title.textContent = DESTINATION_TITLE_TEXT;
    title.style.cssText = "font-family:Georgia,'Times New Roman',serif;font-size:14px;font-weight:500;letter-spacing:0;color:#ffffff;line-height:1.02;text-rendering:geometricPrecision";
    const badge = document.createElement("button");
    badge.type = "button";
    badge.textContent = "Cap Context";
    badge.setAttribute("aria-label", "Open Cap Context site");
    badge.style.cssText = [
      "height:19px",
      "padding:0 7px",
      "border-radius:999px",
      "border:1px solid rgba(255,255,255,0.12)",
      "background:rgba(255,255,255,0.045)",
      "color:rgba(255,255,255,0.68)",
      "font-size:10px",
      "font-weight:500",
      "line-height:19px",
      "letter-spacing:0",
      "font-family:Georgia,'Times New Roman',serif",
      "text-rendering:geometricPrecision",
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
      button.dataset.contextGeneratorAccent = option.accent;
      button.dataset.contextGeneratorDetail = option.detail;
      button.dataset.contextGeneratorHover = "false";
      button.style.cssText = [
        "width:100%",
        "height:48px",
        `border:1px solid ${option.accent}30`,
        "border-radius:11px",
        "background:linear-gradient(180deg, #121212 0%, #0b0b0b 58%, #050505 100%)",
        "color:#ffffff",
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
        `box-shadow:inset 0 1px 0 rgba(255,255,255,0.075), inset 0 -1px 0 rgba(0,0,0,0.54), 0 0 0 1px ${option.accent}08, -5px 0 16px ${option.accent}07, 0 1px 0 rgba(255,255,255,0.02)`,
        "transition:background 0.13s ease, border-color 0.13s ease, box-shadow 0.13s ease, transform 0.13s ease"
      ].join(";");

      const aura = document.createElement("span");
      aura.className = "context-generator-tile-aura";
      aura.style.cssText = [
        "position:absolute",
        "inset:-1px",
        "z-index:0",
        "pointer-events:none",
        `background:radial-gradient(ellipse at -4% 52%, ${option.accent}34 0, ${option.accent}1f 28%, transparent 62%), linear-gradient(90deg, ${option.accent}2b 0%, ${option.accent}18 25%, ${option.accent}09 54%, ${option.accent}03 73%, transparent 90%)`,
        "opacity:0.18",
        "filter:blur(10px)",
        "transform:translate3d(-5%,0,0) scaleX(0.98)",
        "transition:opacity 0.18s ease"
      ].join(";");

      const shine = document.createElement("span");
      shine.className = "context-generator-tile-shine";
      shine.style.animationDelay = `${index * 0.18}s`;

      const logoWrap = document.createElement("div");
      logoWrap.style.cssText = "width:26px;height:26px;display:flex;align-items:center;justify-content:center;flex:0 0 auto;opacity:0.96;position:relative;z-index:2";
      const logo = document.createElement("img");
      logo.src = getExtensionAssetUrl(option.logo);
      logo.alt = "";
      logo.draggable = false;
      logo.style.cssText = `width:${option.logoSize}px;height:${option.logoSize}px;object-fit:contain;display:block;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.28))`;
      logoWrap.appendChild(logo);

      const copy = document.createElement("div");
      copy.style.cssText = "display:flex;flex-direction:column;gap:1px;min-width:0;flex:1;position:relative;z-index:2";
      const name = document.createElement("div");
      name.textContent = option.name;
      name.style.cssText = "font-size:11.5px;font-weight:740;line-height:1.18;color:#ffffff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      const detail = document.createElement("div");
      detail.className = "context-generator-tile-detail";
      detail.textContent = option.detail;
      detail.style.cssText = "font-size:9.5px;font-weight:500;line-height:1.28;color:rgba(255,255,255,0.5);white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      copy.appendChild(name);
      copy.appendChild(detail);

      const spinner = document.createElement("span");
      spinner.className = "context-generator-tile-spinner";
      spinner.setAttribute("aria-hidden", "true");

      const setButtonActive = () => {
        button.dataset.contextGeneratorHover = "true";
        button.style.background = "linear-gradient(180deg, #151515 0%, #0d0d0d 58%, #050505 100%)";
        button.style.borderColor = `${option.accent}58`;
        button.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -1px 0 rgba(0,0,0,0.58), 0 0 0 1px ${option.accent}18, -7px 0 20px ${option.accent}0e, 0 8px 18px rgba(0,0,0,0.3)`;
        aura.style.opacity = "0.28";
        button.style.transform = "translateY(-1px)";
      };
      const setButtonIdle = () => {
        button.dataset.contextGeneratorHover = "false";
        button.style.background = "linear-gradient(180deg, #121212 0%, #0b0b0b 58%, #050505 100%)";
        button.style.borderColor = `${option.accent}30`;
        button.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.075), inset 0 -1px 0 rgba(0,0,0,0.54), 0 0 0 1px ${option.accent}08, -5px 0 16px ${option.accent}07, 0 1px 0 rgba(255,255,255,0.02)`;
        aura.style.opacity = "0.18";
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
        detail.textContent = "Opening...";
        button.style.transform = "scale(0.985)";
        startDestinationTransfer(option.id);
      });

      grid.appendChild(button);
    });

    sheet.appendChild(grid);

    const footer = document.createElement("div");
    footer.textContent = DESTINATION_HELPER_TEXT;
    footer.style.cssText = [
      "margin:9px 1px 1px",
      "padding-top:7px",
      "padding-bottom:1px",
      "border-top:1px solid rgba(255,255,255,0.065)",
      "color:rgba(255,255,255,0.42)",
      "font-family:Georgia,'Times New Roman',serif",
      "font-size:9.5px",
      "font-weight:500",
      "line-height:1.35",
      "letter-spacing:0",
      "text-align:center",
      "text-rendering:geometricPrecision",
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
    hideOnboardingNudge();
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
    scheduleWarmSummary();
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
      const accent = tile.dataset.contextGeneratorAccent || "#ffffff";
      const aura = tile.querySelector(".context-generator-tile-aura");
      tile.dataset.contextGeneratorLoading = "false";
      tile.dataset.contextGeneratorHover = "false";
      tile.removeAttribute("aria-busy");
      tile.style.pointerEvents = "";
      tile.style.background = "linear-gradient(180deg, #121212 0%, #0b0b0b 58%, #050505 100%)";
      tile.style.borderColor = `${accent}30`;
      tile.style.boxShadow = `inset 0 1px 0 rgba(255,255,255,0.075), inset 0 -1px 0 rgba(0,0,0,0.54), 0 0 0 1px ${accent}08, -5px 0 16px ${accent}07, 0 1px 0 rgba(255,255,255,0.02)`;
      tile.style.transform = "translateY(0)";
      if (aura) aura.style.opacity = "0.18";
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

    let conversationText;
    try {
      conversationText = scrapeConversationText();
    } catch (error) {
      clearWarmSummary();
      showErrorOverlay(error.message);
      return;
    }

    isRunning = true;
    clearRunningResetTimer();
    runningResetTimer = setTimeout(resetRunningFlag, RUNNING_AUTO_RESET_MS);
    showOverlay(destinationId);
    const warmSummaryRecord = warmSummary;
    const preparedDestinationPromise = prepareDestinationTab(destinationId);
    runContextFlow(destinationId, preparedDestinationPromise, warmSummaryRecord, conversationText);
  }

  function ensureFloatingOverlay() {
    if (!document.getElementById(OVERLAY_ID)) {
      const overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.dataset.contextGeneratorOwned = "true";
      overlay.style.cssText = [
        "display:none",
        "position:fixed",
        "z-index:2147483647",
        "left:50%",
        "top:46%",
        "width:min(560px,calc(100vw - 32px))",
        "height:240px",
        "min-height:240px",
        "max-height:240px",
        "box-sizing:border-box",
        "padding:36px 40px 32px",
        "border-radius:30px",
        "border:1px solid rgba(226,226,226,0.135)",
        "background:linear-gradient(180deg,#171719 0%,#101012 52%,#0b0b0d 100%)",
        "color:#b9b9b9",
        "box-shadow:0 26px 76px rgba(0,0,0,0.55), 0 0 0 1px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.075), inset 0 -1px 0 rgba(255,255,255,0.025)",
        "transform:translate3d(-50%,-50%,0) scale(0.98)",
        "opacity:0",
        "flex-direction:column",
        "justify-content:center",
        "gap:30px",
        "overflow:hidden",
        "backdrop-filter:blur(20px)",
        "font-family:'Iowan Old Style','New York',Georgia,'Times New Roman',serif",
        "letter-spacing:0",
        "will-change:transform,opacity",
        "transition:opacity 0.16s cubic-bezier(0.16,1,0.3,1), transform 0.18s cubic-bezier(0.16,1,0.3,1)"
      ].join(";");

      const glow = document.createElement("div");
      glow.style.cssText = [
        "position:absolute",
        "inset:-1px",
        "pointer-events:none",
        "background:radial-gradient(circle at 50% -24%,rgba(255,255,255,0.105),transparent 34%),linear-gradient(180deg,rgba(255,255,255,0.04),transparent 42%,rgba(255,255,255,0.018) 100%)",
        "opacity:0.78"
      ].join(";");

      const topRow = document.createElement("div");
      topRow.style.cssText = "position:relative;z-index:1;display:flex;align-items:center;justify-content:center;text-align:center";

      const mark = document.createElement("div");
      mark.style.cssText = [
        "width:34px",
        "height:34px",
        "border-radius:12px",
        "display:none",
        "align-items:center",
        "justify-content:center",
        "flex:0 0 auto",
        "background:linear-gradient(180deg,rgba(255,255,255,0.11),rgba(255,255,255,0.035))",
        "border:1px solid rgba(255,255,255,0.12)",
        "box-shadow:inset 0 1px 0 rgba(255,255,255,0.08)"
      ].join(";");

      const markDot = document.createElement("div");
      markDot.style.cssText = [
        "width:13px",
        "height:13px",
        "border-radius:999px",
        "background:#ffffff",
        "box-shadow:0 0 0 5px rgba(255,255,255,0.06),0 0 18px rgba(255,255,255,0.34)"
      ].join(";");
      mark.appendChild(markDot);

      const copy = document.createElement("div");
      copy.style.cssText = "min-width:0;display:flex;flex-direction:column;align-items:center;gap:0;flex:1";

      const quote = document.createElement("div");
      quote.id = "context-generator-overlay-quote";
      quote.style.cssText = [
        "font-size:18px",
        "font-weight:500",
        "line-height:1.32",
        "white-space:nowrap",
        "overflow:hidden",
        "text-overflow:ellipsis",
        "max-width:100%",
        "color:transparent",
        "background-image:linear-gradient(100deg,#858585 0%,#bdbdbd 30%,#ededed 46%,#b1b1b1 62%,#757575 100%)",
        "background-size:220% 100%",
        "-webkit-background-clip:text",
        "background-clip:text",
        "animation:contextGeneratorQuoteShimmer 5.2s linear infinite"
      ].join(";");
      quote.textContent = HANDOFF_QUOTES[0];

      copy.appendChild(quote);
      topRow.appendChild(mark);
      topRow.appendChild(copy);

      const statusShell = document.createElement("div");
      statusShell.style.cssText = [
        "position:relative",
        "z-index:1",
        "height:64px",
        "border-radius:22px",
        "border:0",
        "background:transparent",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "padding:0 22px",
        "box-sizing:border-box",
        "overflow:hidden"
      ].join(";");

      if (!document.getElementById("context-generator-styles")) {
        const styleSheet = document.createElement("style");
        styleSheet.id = "context-generator-styles";
        styleSheet.dataset.contextGeneratorOwned = "true";
        styleSheet.textContent = `
          @keyframes contextGeneratorQuoteShimmer{
            0%{background-position:145% 50%}
            100%{background-position:-115% 50%}
          }
          @keyframes contextGeneratorStatusShimmer{
            0%{opacity:0;transform:translate3d(0,14px,0);background-position:122% 50%;filter:blur(0.2px)}
            18%{opacity:1;transform:translate3d(0,0,0);filter:blur(0)}
            56%{opacity:1;transform:translate3d(0,0,0);background-position:0% 50%}
            84%{opacity:1;transform:translate3d(0,0,0);background-position:-42% 50%}
            100%{opacity:0;transform:translate3d(0,-13px,0);background-position:-88% 50%;filter:blur(0.15px)}
          }
          @media (prefers-reduced-motion: reduce){
            #context-generator-text{animation:none!important}
            #context-generator-overlay-quote{animation:none!important}
          }
        `;
        document.head.appendChild(styleSheet);
      }

      const textSpan = document.createElement("span");
      textSpan.id = "context-generator-text";
      textSpan.textContent = "Summarizing context";
      textSpan.style.cssText = [
        "display:block",
        "width:100%",
        "min-width:0",
        "font-size:30px",
        "font-weight:500",
        "line-height:1.18",
        "text-align:center",
        "white-space:nowrap",
        "overflow:hidden",
        "text-overflow:ellipsis",
        "color:transparent",
        "background-image:linear-gradient(100deg,#8a8a8a 0%,#c6c6c6 28%,#f1f1f1 44%,#b6b6b6 60%,#747474 100%)",
        "background-size:220% 100%",
        "background-position:125% 50%",
        "-webkit-background-clip:text",
        "background-clip:text",
        "animation:contextGeneratorStatusShimmer 1.72s cubic-bezier(0.16,1,0.3,1) both"
      ].join(";");
      statusShell.appendChild(textSpan);

      overlay.appendChild(glow);
      overlay.appendChild(topRow);
      overlay.appendChild(statusShell);
      document.body.appendChild(overlay);
    }
  }

  function showOverlay(destinationId = null) {
    ensureFloatingOverlay();
    const overlay = document.getElementById(OVERLAY_ID);
    const quote = document.getElementById("context-generator-overlay-quote");
    const bubble = document.getElementById(BUBBLE_ID);
    const destination = destinationId ? getPlatform(destinationId) : null;

    if (overlay) {
      if (quote) {
        quote.textContent = getRandomHandoffQuote();
      }
      startHandoffStatusCycle(destination?.name || "destination");
      overlay.style.display = "flex";
      requestAnimationFrame(() => {
        overlay.style.opacity = "1";
        overlay.style.transform = "translate3d(-50%,-50%,0) scale(1)";
      });
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

    stopHandoffStatusCycle();
    if (overlay) {
      overlay.style.opacity = "0";
      overlay.style.transform = "translate3d(-50%,-50%,0) scale(0.98)";
      overlay.style.display = "none";
    }
    if (bubble) {
      bubble.disabled = false;
      bubble.style.opacity = "1";
      bubble.style.cursor = "pointer";
    }
  }

  function isHandoffOverlayVisible() {
    const overlay = document.getElementById(OVERLAY_ID);
    return Boolean(overlay && overlay.style.display !== "none");
  }

  function startHandoffStatusCycle(destinationName) {
    stopHandoffStatusCycle();
    const steps = HANDOFF_STATUS_STEPS.map((step) => step.replace("{destination}", destinationName));
    handoffStatusIndex = 0;
    setHandoffStatus(steps[handoffStatusIndex]);

    handoffStatusTimer = window.setInterval(() => {
      handoffStatusIndex = (handoffStatusIndex + 1) % steps.length;
      setHandoffStatus(steps[handoffStatusIndex]);
    }, HANDOFF_STATUS_INTERVAL_MS);
  }

  function setHandoffStatus(text) {
    const textSpan = document.getElementById("context-generator-text");
    if (!textSpan || !text) return;

    textSpan.style.animation = "none";
    textSpan.textContent = text;
    void textSpan.offsetWidth;
    textSpan.style.animation = "contextGeneratorStatusShimmer 1.72s cubic-bezier(0.16,1,0.3,1) both";
  }

  function stopHandoffStatusCycle() {
    if (handoffStatusTimer) {
      clearInterval(handoffStatusTimer);
      handoffStatusTimer = null;
    }
  }

  function getRandomHandoffQuote() {
    return HANDOFF_QUOTES[Math.floor(Math.random() * HANDOFF_QUOTES.length)] || HANDOFF_QUOTES[0];
  }

  function showErrorOverlay(message) {
    const isNoConversationError = message === NO_CONVERSATION_ERROR_MESSAGE;
    let errorDiv = document.getElementById("context-generator-error-overlay");
    if (!errorDiv) {
      errorDiv = document.createElement("div");
      errorDiv.id = "context-generator-error-overlay";
      errorDiv.dataset.contextGeneratorOwned = "true";
      errorDiv.style.cssText = [
        "position:fixed",
        "z-index:9999999",
        "right:20px",
        "bottom:80px",
        "width:min(340px,calc(100vw - 32px))",
        "box-sizing:border-box",
        "padding:14px",
        "border-radius:16px",
        "border:1px solid rgba(255,255,255,0.12)",
        "background:linear-gradient(145deg,#111111 0%,#171721 58%,#101015 100%)",
        "color:#ffffff",
        "box-shadow:0 18px 44px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.06)",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "display:none",
        "flex-direction:column",
        "gap:12px",
        "overflow:hidden"
      ].join(";");

      const accent = document.createElement("div");
      accent.style.cssText = [
        "position:absolute",
        "inset:-1px",
        "pointer-events:none",
        "background:radial-gradient(circle at 12% 18%,rgba(120,95,255,0.24),transparent 34%),radial-gradient(circle at 88% 96%,rgba(25,195,125,0.16),transparent 32%)",
        "opacity:0.9"
      ].join(";");

      const header = document.createElement("div");
      header.style.cssText = "position:relative;z-index:1;display:flex;align-items:center;gap:10px";

      const mark = document.createElement("div");
      mark.id = "context-generator-error-mark";
      mark.style.cssText = [
        "width:28px",
        "height:28px",
        "border-radius:999px",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "flex:0 0 auto",
        "font-size:14px",
        "font-weight:800",
        "background:rgba(255,255,255,0.08)",
        "border:1px solid rgba(255,255,255,0.14)",
        "color:#ffffff"
      ].join(";");

      const title = document.createElement("div");
      title.id = "context-generator-error-title";
      title.style.cssText = "font-size:14px;font-weight:760;line-height:1.2;letter-spacing:0;color:#ffffff";

      const textSpan = document.createElement("span");
      textSpan.id = "context-generator-error-text";
      textSpan.style.cssText = "position:relative;z-index:1;font-size:12.5px;font-weight:500;line-height:1.42;color:rgba(255,255,255,0.72)";

      const closeBtn = document.createElement("button");
      closeBtn.textContent = "Dismiss";
      closeBtn.style.cssText = [
        "position:relative",
        "z-index:1",
        "align-self:flex-end",
        "height:28px",
        "padding:0 11px",
        "border-radius:999px",
        "border:1px solid rgba(255,255,255,0.12)",
        "background:rgba(255,255,255,0.07)",
        "color:rgba(255,255,255,0.86)",
        "cursor:pointer",
        "font:inherit",
        "font-size:12px",
        "font-weight:650",
        "line-height:28px"
      ].join(";");
      closeBtn.addEventListener("click", () => {
        errorDiv.style.display = "none";
      });

      header.appendChild(mark);
      header.appendChild(title);
      errorDiv.appendChild(accent);
      errorDiv.appendChild(header);
      errorDiv.appendChild(textSpan);
      errorDiv.appendChild(closeBtn);
      document.body.appendChild(errorDiv);
    }

    const title = document.getElementById("context-generator-error-title");
    if (title) {
      title.textContent = isNoConversationError ? NO_CONVERSATION_ERROR_TITLE : "Transfer failed";
    }

    const mark = document.getElementById("context-generator-error-mark");
    if (mark) {
      mark.textContent = isNoConversationError ? "i" : "!";
    }

    const textSpan = document.getElementById("context-generator-error-text");
    if (textSpan) {
      textSpan.textContent = message;
    }

    errorDiv.style.display = "flex";
    clearTimeout(errorDiv.contextGeneratorHideTimer);
    errorDiv.contextGeneratorHideTimer = setTimeout(() => {
      errorDiv.style.display = "none";
    }, isNoConversationError ? 6500 : 8000);
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
      desc.textContent = `We couldn't paste the context into ${destinationName}. Please copy it below and paste it manually:`;
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

    if (currentPlatform.id === "chatgpt") {
      releaseBubbleSlot();
      releaseComposerSurface();
      const floatingRoot = getFloatingButtonRoot();
      if (bubble.parentElement !== floatingRoot) {
        floatingRoot.appendChild(bubble);
      }

      setBubbleFixedMode(bubble);
      const placement = getChatGptFixedBubblePlacement(input);
      bubble.style.left = `${placement.left}px`;
      bubble.style.right = "auto";
      bubble.style.top = `${placement.top}px`;
      bubble.style.display = "flex";
      maybeShowOnboardingNudge(bubble);
      return;
    }

    const composerSurface = findComposerSurfaceElement(input);
    if (!composerSurface) {
      bubble.style.display = "none";
      hideOnboardingNudge();
      return;
    }

    reserveComposerSurface(composerSurface);

    if (currentPlatform.id !== "chatgpt" && bubble.parentElement !== composerSurface) {
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
      hideOnboardingNudge();
      return;
    }

    setBubbleAbsoluteMode(bubble);

    if (currentPlatform.id === "grok") {
      const grokPlacement = getGrokBubblePlacement(composerRect);
      releaseBubbleSlot();
      bubble.style.left = `${grokPlacement.left}px`;
      bubble.style.right = "auto";
      bubble.style.top = `${grokPlacement.top}px`;
      bubble.style.display = "flex";
      maybeShowOnboardingNudge(bubble);
      return;
    }

    if (currentPlatform.id === "deepseek") {
      const deepSeekPlacement = getDeepSeekBubblePlacement(composerRect);
      if (deepSeekPlacement) {
        releaseBubbleSlot();
        bubble.style.left = `${deepSeekPlacement.left}px`;
        bubble.style.right = "auto";
        bubble.style.top = `${deepSeekPlacement.top}px`;
        bubble.style.display = "flex";
        maybeShowOnboardingNudge(bubble);
        return;
      }
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
    maybeShowOnboardingNudge(bubble);
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

  function findChatGptModelSelectorButton(composerSurface, composerRect) {
    const root = composerSurface || document;
    const rowTop = composerRect ? composerRect.bottom - Math.max(64, composerRect.height * 0.65) : window.innerHeight * 0.45;
    const rowBottom = composerRect ? composerRect.bottom + 16 : window.innerHeight - BUBBLE_GAP;
    const scopeLeft = composerRect ? composerRect.left - 12 : window.innerWidth * 0.22;
    const scopeRight = composerRect ? composerRect.right + 12 : window.innerWidth - BUBBLE_GAP;

    return Array.from(root.querySelectorAll("button, [role='button']"))
      .filter((button) => button.id !== BUBBLE_ID && !isContextGeneratorNode(button) && isVisible(button))
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const label = getElementLabel(button, true);
        const text = (button.innerText || button.textContent || "").toLowerCase();
        let score = 0;

        if (/\b(instant|medium|high)\b/.test(text)) score += 180;
        if (/\b(model|intelligence|reasoning|thinking)\b/.test(label)) score += 42;
        if (composerRect && rect.left >= composerRect.left + composerRect.width * 0.45) score += 22;
        if (!composerRect && rect.left >= window.innerWidth * 0.45) score += 12;
        if (rect.top >= rowTop && rect.bottom <= rowBottom) score += 28;
        if (rect.width >= 48 && rect.width <= 140) score += 12;
        if (/\b(send|voice|mic|microphone|attach|upload|tools|image|canvas)\b/.test(label)) score -= 120;

        return { button, rect, score };
      })
      .filter(({ rect, score }) => {
        return (
          score >= 120 &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.height <= 56 &&
          rect.left >= scopeLeft &&
          rect.right <= scopeRight &&
          rect.top >= rowTop &&
          rect.bottom <= rowBottom
        );
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.rect.left - a.rect.left;
      })[0]?.button || null;
  }

  function setBubbleAbsoluteMode(bubble) {
    setBubbleSize(bubble, BUBBLE_SIZE);
    bubble.style.position = "absolute";
    bubble.style.margin = "0";
    bubble.style.flex = "0 0 auto";
    bubble.style.alignSelf = "auto";
    bubble.style.opacity = "1";
    bubble.style.visibility = "visible";
    bubble.style.overflow = "hidden";
  }

  function setBubbleFixedMode(bubble) {
    setBubbleSize(bubble, BUBBLE_SIZE);
    bubble.style.position = "fixed";
    bubble.style.zIndex = "2147483647";
    bubble.style.margin = "0";
    bubble.style.flex = "0 0 auto";
    bubble.style.alignSelf = "auto";
    bubble.style.opacity = "1";
    bubble.style.visibility = "visible";
    bubble.style.overflow = "hidden";
  }

  function getFloatingButtonRoot() {
    return document.body || document.documentElement;
  }

  function setBubbleSize(bubble, size) {
    bubble.style.width = `${size}px`;
    bubble.style.height = `${size}px`;
    bubble.style.minWidth = `${size}px`;
    bubble.style.minHeight = `${size}px`;
    bubble.style.maxWidth = `${size}px`;
    bubble.style.maxHeight = `${size}px`;

    const icon = bubble.querySelector("img");
    if (icon) {
      const iconSize = Math.max(24, size - 4);
      icon.style.width = `${iconSize}px`;
      icon.style.height = `${iconSize}px`;
    }
  }

  function getChatGptFixedBubblePlacement(input) {
    const composerRect = getChatGptPlacementRect(input);
    const modelButton = findChatGptModelSelectorButton(document, composerRect);

    if (modelButton) {
      return getFixedBubblePlacementBesideRect(modelButton.getBoundingClientRect());
    }

    if (composerRect) {
      const rowButtons = getChatGptComposerButtonCandidates(composerRect);
      const actionButton = rowButtons[rowButtons.length - 1];

      if (actionButton) {
        return getFixedBubblePlacementBesideRect(actionButton.rect);
      }

      const fallback = getBottomRightRowBubblePlacement(composerRect, 64);
      return clampFixedBubblePlacement(composerRect.left + fallback.left, composerRect.top + fallback.top);
    }

    const inputRect = input.getBoundingClientRect();
    return clampFixedBubblePlacement(
      inputRect.right - BUBBLE_SIZE - 112,
      inputRect.top + (inputRect.height - BUBBLE_SIZE) / 2
    );
  }

  function getChatGptPlacementRect(input) {
    const composerSurface = findComposerSurfaceElement(input);
    const composerRect = composerSurface?.getBoundingClientRect();
    if (isUsableChatGptPlacementRect(composerRect)) return composerRect;

    const formRect = input.closest("form")?.getBoundingClientRect();
    if (isUsableChatGptPlacementRect(formRect)) return formRect;

    const inputRect = input.getBoundingClientRect();
    if (!inputRect || inputRect.width <= 0 || inputRect.height <= 0) return null;

    let left = Math.max(BUBBLE_GAP, inputRect.left - 64);
    const right = Math.min(window.innerWidth - BUBBLE_GAP, Math.max(inputRect.right + 180, left + 320));
    if (right - left < 280) {
      left = Math.max(BUBBLE_GAP, right - 320);
    }
    const top = Math.max(BUBBLE_GAP, inputRect.top - 18);
    const bottom = Math.min(window.innerHeight - BUBBLE_GAP, Math.max(inputRect.bottom + 70, top + 96));

    return {
      left,
      right,
      top,
      bottom,
      width: right - left,
      height: bottom - top
    };
  }

  function isUsableChatGptPlacementRect(rect) {
    return Boolean(
      rect &&
      rect.width >= 280 &&
      rect.height >= 40 &&
      rect.bottom >= BUBBLE_GAP &&
      rect.top <= window.innerHeight - BUBBLE_GAP &&
      rect.right >= BUBBLE_GAP &&
      rect.left <= window.innerWidth - BUBBLE_GAP
    );
  }

  function getFixedBubblePlacementBesideRect(targetRect) {
    return clampFixedBubblePlacement(
      targetRect.left - BUBBLE_SIZE - BUBBLE_GAP,
      targetRect.top + (targetRect.height - BUBBLE_SIZE) / 2
    );
  }

  function clampFixedBubblePlacement(left, top) {
    const minLeft = BUBBLE_GAP;
    const minTop = BUBBLE_GAP;
    const maxLeft = Math.max(minLeft, window.innerWidth - BUBBLE_SIZE - BUBBLE_GAP);
    const maxTop = Math.max(minTop, window.innerHeight - BUBBLE_SIZE - BUBBLE_GAP);

    return {
      left: Math.round(Math.min(Math.max(left, minLeft), maxLeft)),
      top: Math.round(Math.min(Math.max(top, minTop), maxTop))
    };
  }

  function getChatGptBubblePlacement(composerRect, composerSurface = null) {
    const modelButton = composerSurface ? findChatGptModelSelectorButton(composerSurface, composerRect) : null;
    if (modelButton) {
      const modelRect = modelButton.getBoundingClientRect();
      const left = modelRect.left - composerRect.left - BUBBLE_SIZE - BUBBLE_GAP;
      if (left >= BUBBLE_GAP) {
        return getBubblePlacementBesideRect(modelRect, composerRect, left);
      }
    }

    const rowButtons = getChatGptComposerButtonCandidates(composerRect);
    const actionButton = rowButtons[rowButtons.length - 1];

    if (actionButton) {
      const left = actionButton.rect.left - composerRect.left - BUBBLE_SIZE - BUBBLE_GAP;
      if (left >= BUBBLE_GAP) {
        return getBubblePlacementBesideRect(actionButton.rect, composerRect, left);
      }
    }

    return getBottomRightRowBubblePlacement(composerRect, 64);
  }

  function getChatGptComposerButtonCandidates(composerRect) {
    const rowTop = composerRect.bottom - Math.max(60, composerRect.height * 0.55);

    return Array.from(document.querySelectorAll("button, [role='button']"))
      .filter((button) => button.id !== BUBBLE_ID && !isContextGeneratorNode(button) && isVisible(button))
      .map((button) => ({ button, rect: button.getBoundingClientRect() }))
      .filter(({ rect }) => {
        return (
          rect.width > 0 &&
          rect.width <= 84 &&
          rect.height > 0 &&
          rect.height <= 72 &&
          rect.left >= composerRect.left + composerRect.width * 0.45 &&
          rect.right <= composerRect.right + 12 &&
          rect.top >= rowTop &&
          rect.bottom <= composerRect.bottom + 12
        );
      })
      .sort((a, b) => a.rect.left - b.rect.left);
  }

  function getGrokBubblePlacement(composerRect) {
    const speedButton = findGrokSpeedSelectorButton(composerRect);
    if (speedButton) {
      const speedRect = speedButton.getBoundingClientRect();
      const left = speedRect.left - composerRect.left - BUBBLE_SIZE - BUBBLE_GAP;
      if (left >= BUBBLE_GAP) {
        return getBubblePlacementBesideRect(speedRect, composerRect, left);
      }
    }

    const safeButtons = getGrokComposerButtonCandidates(composerRect).filter(({ button }) => {
      const label = getElementLabel(button, true);
      return !/\b(send|submit|voice|mic|microphone)\b/.test(label);
    });
    const anchorButton = safeButtons[safeButtons.length - 1];

    if (anchorButton) {
      const left = anchorButton.rect.left - composerRect.left - BUBBLE_SIZE - BUBBLE_GAP;
      if (left >= BUBBLE_GAP) {
        return getBubblePlacementBesideRect(anchorButton.rect, composerRect, left);
      }
    }

    return getBottomRightRowBubblePlacement(composerRect, 186);
  }

  function findGrokSpeedSelectorButton(composerRect) {
    const rowTop = composerRect.bottom - Math.max(64, composerRect.height * 0.65);

    return Array.from(document.querySelectorAll("button, [role='button'], [tabindex='0']"))
      .filter((button) => button.id !== BUBBLE_ID && !isContextGeneratorNode(button) && isVisible(button))
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const label = getElementLabel(button, true);
        const text = (button.innerText || button.textContent || "").toLowerCase();
        let score = 0;

        if (/\b(fast|auto|expert|think|thinking)\b/.test(text)) score += 180;
        if (/\b(mode|speed|model|reasoning|thinking)\b/.test(label)) score += 36;
        if (rect.left >= composerRect.left + composerRect.width * 0.55) score += 22;
        if (rect.width >= 42 && rect.width <= 150) score += 12;
        if (/\b(send|submit|voice|mic|microphone|attach|upload|image|search)\b/.test(label)) score -= 180;

        return { button, rect, score };
      })
      .filter(({ rect, score }) => {
        return (
          score >= 120 &&
          rect.width > 0 &&
          rect.height > 0 &&
          rect.height <= 56 &&
          rect.left >= composerRect.left + composerRect.width * 0.45 &&
          rect.right <= composerRect.right + 12 &&
          rect.top >= rowTop &&
          rect.bottom <= composerRect.bottom + 12
        );
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.rect.left - a.rect.left;
      })[0]?.button || null;
  }

  function getGrokComposerButtonCandidates(composerRect) {
    const rowTop = composerRect.bottom - Math.max(62, composerRect.height * 0.58);

    return Array.from(document.querySelectorAll("button, [role='button'], [tabindex='0']"))
      .filter((button) => button.id !== BUBBLE_ID && !isContextGeneratorNode(button) && isVisible(button))
      .map((button) => ({ button, rect: button.getBoundingClientRect() }))
      .filter(({ rect }) => {
        return (
          rect.width > 0 &&
          rect.width <= 88 &&
          rect.height > 0 &&
          rect.height <= 72 &&
          rect.left >= composerRect.left + composerRect.width * 0.35 &&
          rect.right <= composerRect.right + 12 &&
          rect.top >= rowTop &&
          rect.bottom <= composerRect.bottom + 12
        );
      })
      .sort((a, b) => a.rect.left - b.rect.left);
  }

  function getDeepSeekBubblePlacement(composerRect) {
    const rowButtons = getDeepSeekComposerButtonCandidates(composerRect);
    if (rowButtons.length < 2) return getDeepSeekFallbackBubblePlacement(composerRect);

    const pinButton = rowButtons[rowButtons.length - 2];
    const left = pinButton.rect.left - composerRect.left - BUBBLE_SIZE - BUBBLE_GAP;
    if (left < BUBBLE_GAP) return getDeepSeekFallbackBubblePlacement(composerRect);

    return getBubblePlacementBesideRect(pinButton.rect, composerRect, left);
  }

  function getDeepSeekFallbackBubblePlacement(composerRect) {
    return getBottomRightRowBubblePlacement(composerRect, 104);
  }

  function getBubblePlacementBesideRect(targetRect, composerRect, left) {
    const top = Math.max(
      BUBBLE_GAP,
      Math.min(
        targetRect.top + (targetRect.height - BUBBLE_SIZE) / 2 - composerRect.top,
        composerRect.height - BUBBLE_SIZE - BUBBLE_GAP
      )
    );

    return {
      left: Math.round(left),
      top: Math.round(top)
    };
  }

  function getBottomRightRowBubblePlacement(composerRect, rightOffset) {
    const left = Math.max(
      BUBBLE_GAP,
      composerRect.width - BUBBLE_SIZE - rightOffset
    );
    const top = Math.max(
      BUBBLE_GAP,
      composerRect.height - BUBBLE_SIZE - 16
    );

    return {
      left: Math.round(left),
      top: Math.round(top)
    };
  }

  function getDeepSeekComposerButtonCandidates(composerRect) {
    const rowTop = composerRect.bottom - Math.max(64, composerRect.height * 0.55);

    return Array.from(document.querySelectorAll("button, [role='button'], [tabindex='0']"))
      .filter((button) => button.id !== BUBBLE_ID && !isContextGeneratorNode(button) && isVisible(button))
      .map((button) => ({ button, rect: button.getBoundingClientRect() }))
      .filter(({ rect }) => {
        return (
          rect.width > 0 &&
          rect.width <= 80 &&
          rect.height > 0 &&
          rect.height <= 72 &&
          rect.left >= composerRect.left + composerRect.width * 0.35 &&
          rect.right <= composerRect.right + 12 &&
          rect.top >= rowTop &&
          rect.bottom <= composerRect.bottom + 12
        );
      })
      .sort((a, b) => a.rect.left - b.rect.left);
  }

  function getGrokComposerButtonCandidates(composerRect) {
    const rowTop = composerRect.bottom - Math.max(64, composerRect.height * 0.55);

    return Array.from(document.querySelectorAll("button, [role='button'], [tabindex='0']"))
      .filter((button) => {
        const label = getElementLabel(button, true);
        return (
          button.id !== BUBBLE_ID &&
          !isContextGeneratorNode(button) &&
          isVisible(button) &&
          !isDisabled(button) &&
          !/\b(stop|cancel|attach|upload|voice|mic|microphone|new|menu|profile|account|model|mode)\b/.test(label)
        );
      })
      .map((button) => ({ button, rect: button.getBoundingClientRect() }))
      .filter(({ rect }) => {
        return (
          rect.width > 0 &&
          rect.width <= 84 &&
          rect.height > 0 &&
          rect.height <= 76 &&
          rect.left >= composerRect.left + composerRect.width * 0.45 &&
          rect.right <= composerRect.right + 16 &&
          rect.top >= rowTop &&
          rect.bottom <= composerRect.bottom + 16
        );
      })
      .sort((a, b) => a.rect.left - b.rect.left);
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

    if (currentPlatform.id === "chatgpt" || currentPlatform.id === "deepseek") {
      if (rect.bottom >= inputRect.bottom + 48) score += 140;
      if (rect.height < 92) score -= 120;
    }

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
    if (floatingButtonMonitoringDisabled) return;
    if (isDestinationSheetOpen()) return;
    if (floatingButtonFrame) return;
    floatingButtonFrame = requestAnimationFrame(() => {
      floatingButtonFrame = null;
      if (floatingButtonMonitoringDisabled) return;
      if (isDestinationSheetOpen()) return;
      try {
        ensureFloatingButton();
      } catch (error) {
        if (isExtensionContextInvalidated(error)) {
          disableFloatingButtonMonitoring();
          return;
        }
        throw error;
      }
    });
  }

  function isContextGeneratorNode(node) {
    return node instanceof Element && (
      node.id === BUBBLE_ID ||
      node.id === OVERLAY_ID ||
      node.id === ONBOARDING_ID ||
      node.id === ONBOARDING_STYLE_ID ||
      node.id === "context-generator-styles" ||
      node.dataset.contextGeneratorOwned === "true" ||
      Boolean(node.closest?.(`#${BUBBLE_ID}, #${OVERLAY_ID}, #${ONBOARDING_ID}, #context-generator-styles, #${DESTINATION_SHEET_ID}`))
    );
  }

  function isOwnDomMutation(mutation) {
    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes].filter((node) => node instanceof Element);
    return isContextGeneratorNode(mutation.target) || (changedNodes.length > 0 && changedNodes.every(isContextGeneratorNode));
  }

  function startFloatingButtonMonitoring() {
    if (floatingButtonObserver) floatingButtonObserver.disconnect();
    floatingButtonObserver = new MutationObserver((mutations) => {
      if (floatingButtonMonitoringDisabled) return;
      if (mutations.every(isOwnDomMutation)) return;
      scheduleFloatingButtonUpdate();
    });
    floatingButtonObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });

    window.addEventListener("resize", scheduleFloatingButtonUpdate);
    document.addEventListener("visibilitychange", scheduleFloatingButtonUpdate);
    document.addEventListener("focusin", scheduleFloatingButtonUpdate);
    scheduleFloatingButtonUpdate();
  }

  function disableFloatingButtonMonitoring() {
    floatingButtonMonitoringDisabled = true;
    if (floatingButtonFrame) {
      cancelAnimationFrame(floatingButtonFrame);
      floatingButtonFrame = null;
    }
    if (floatingButtonObserver) {
      floatingButtonObserver.disconnect();
      floatingButtonObserver = null;
    }

    window.removeEventListener("resize", scheduleFloatingButtonUpdate);
    document.removeEventListener("visibilitychange", scheduleFloatingButtonUpdate);
    document.removeEventListener("focusin", scheduleFloatingButtonUpdate);
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

  function delay(timeoutMs) {
    return new Promise((resolve) => setTimeout(resolve, timeoutMs));
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
      element.localName,
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
