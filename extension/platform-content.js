(() => {
  const CONTENT_SCRIPT_LOAD_ID = "platform-content-2026-07-16-gemini-primary";
  const BUBBLE_ID = "context-generator-bubble";
  const OVERLAY_ID = "context-generator-overlay";
  const HANDOFF_SCRIM_ID = "context-generator-handoff-scrim";
  const ONBOARDING_ID = "context-generator-onboarding";
  const ONBOARDING_STYLE_ID = "context-generator-onboarding-styles";
  const CLAUDE_LIMIT_NUDGE_ID = "context-generator-claude-limit-nudge";
  const DESTINATION_SHEET_ID = "context-generator-destination-sheet";
  const DESTINATION_SHEET_STYLE_ID = "context-generator-destination-sheet-styles";
  const LAST_TRANSFER_STATS_STORAGE_KEY = "context-generator-last-transfer-stats-v1";
  const RAW_TRANSCRIPT_RETENTION_MS = 24 * 60 * 60 * 1000;

  if (window.__contextGeneratorPlatformLoaded === CONTENT_SCRIPT_LOAD_ID) {
    return;
  }

  cleanupContextGeneratorNodes();

  const extensionRuntime = getExtensionRuntime();
  if (!extensionRuntime) {
    console.warn("[Context Generator] Extension runtime is unavailable; skipping content script startup.");
    return;
  }

  window.__contextGeneratorPlatformLoaded = CONTENT_SCRIPT_LOAD_ID;

  const BUBBLE_SIZE = 42;
  const BUBBLE_GAP = 8;
  const BUBBLE_SLOT_WIDTH = BUBBLE_SIZE + BUBBLE_GAP + 6;
  const CLAUDE_INLINE_SLOT_WIDTH = BUBBLE_SIZE + 62;
  const CLAUDE_INLINE_BUBBLE_GAP = 46;
  const CLAUDE_INLINE_RIGHT_MARGIN = 4;
  const CLAUDE_MODEL_LEFT_NUDGE = 48;
  const CLAUDE_SIDE_CONTROL_RIGHT_NUDGE = 52;
  const DESTINATION_SHEET_WIDTH = 296;
  const DESTINATION_SHEET_CLOSED_TRANSFORM = "translate3d(0,8px,0) scale(0.985)";
  const HANDOFF_OVERLAY_CLOSED_TRANSFORM = "translate3d(-50%,-50%,0) translateY(10px) scale(0.985)";
  const RUNNING_AUTO_RESET_MS = 300000;
  const DEFAULT_MAX_COMPOSER_WIDTH = 1320;
  const DESTINATION_TITLE_TEXT = "Where to continue?";
  const DESTINATION_HELPER_TEXT = "Context goes straight into the input box";
  const ONBOARDING_STORAGE_KEY = "context-generator-onboarding-dismissed-v2";
  const ONBOARDING_TITLE_TEXT = "Transfer chat context";
  const ONBOARDING_BODY_TEXT = "From this button.";
  const CLAUDE_LIMIT_NUDGE_TEXT = "Claude's brilliant. Claude's also broke by message 20. We've got you covered. Tap to continue in another AI with context.";
  const ONBOARDING_SHOW_DELAY_MS = 650;
  const NO_CONVERSATION_ERROR_TITLE = "Nothing to carry yet";
  const NO_CONVERSATION_ERROR_MESSAGE = "Chat is empty. Send one message first, then I'll pack the context.";
  const SUMMARY_RETRY_ERROR_TITLE = "Try again";
  const SUMMARY_RETRY_ERROR_MESSAGE = "Try again right now. We might have made a mistake. It almost never happens the second time.";
  // Keep this aligned with api/request-security.js so unsupported captures never leave the extension.
  const MAX_BACKEND_CONVERSATION_CHARS = 210000;
  const OVERSIZED_CONVERSATION_ERROR_MESSAGE = "Conversation exceeds the supported 210,000 character limit";
  const CONVERSATION_SCRAPE_RETRY_TIMEOUT_MS = 1800;
  const CONVERSATION_SCRAPE_RETRY_INTERVAL_MS = 140;
  const SOURCE_SCROLL_STABLE_TIMEOUT_MS = 1800;
  const SOURCE_SCROLL_LONG_STABLE_TIMEOUT_MS = 4500;
  const SOURCE_SCROLL_STABLE_INTERVAL_MS = 140;
  const SOURCE_SCROLL_STABLE_SAMPLE_COUNT = 3;
  const VIRTUAL_SWEEP_MAX_SCROLLS = 480;
  const VIRTUAL_SWEEP_STALE_SCROLLS = 3;
  const CLAUDE_VIRTUAL_SWEEP_STALE_SCROLLS = 10;
  const VIRTUAL_SWEEP_STEP_RATIO = 0.6;
  const VIRTUAL_SWEEP_OVERLAP_STEP_RATIO = 0.9;
  const VIRTUAL_SWEEP_MIN_ORDERED_OVERLAP_RATIO = 0.5;
  const VIRTUAL_SWEEP_SETTLE_MS = 360;
  const VIRTUAL_SWEEP_STABLE_SAMPLE_COUNT = 2;
  const VIRTUAL_SWEEP_CHANGE_POLL_MS = 16;
  const VIRTUAL_SWEEP_SLOW_CHANGE_TIMEOUT_MS = 360;
  const CLAUDE_VIRTUAL_SWEEP_SLOW_CHANGE_TIMEOUT_MS = 1400;
  const VIRTUAL_SWEEP_DEBUG_LOGGING = true;
  const COLLAPSED_CONVERSATION_EXPAND_RE = /\b(?:show|see|read|view)\s+(?:more|full|all)\b|\bcontinue\s+(?:reading|message|response)\b|\bexpand\b/i;
  const COLLAPSED_CONVERSATION_EXPAND_EXCLUDE_RE = /\b(?:continue generating|regenerate|send|submit|stop generating|new chat|settings|menu|voice|microphone)\b/i;
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
    "what's on your mind",
    "how can i help",
    "how can i help you today",
    "what are you working on",
    "where should we begin",
    "try asking",
    "suggested prompts"
  ];
  const PASTE_RETRY_TIMEOUT_MS = 22000;
  const CHATGPT_PASTE_RETRY_TIMEOUT_MS = 32000;
  const PASTE_RETRY_INTERVAL_MS = 180;
  const PASTE_VERIFY_TIMEOUT_MS = 1000;
  const CHATGPT_PASTE_VERIFY_TIMEOUT_MS = 1500;
  const CHATGPT_PASTE_STABILITY_MS = 550;
  const HANDOFF_COUNTDOWN_ID = "context-generator-handoff-countdown";
  const HANDOFF_COUNTDOWN_FIXED_MS = 30000;
  const HANDOFF_REASSURANCE_ID = "context-generator-handoff-reassurance";
  const HANDOFF_REASSURANCE_TEXT = "Almost done, don't cancel now";
  // Stage completion still comes only from real pipeline marks. In-stage line motion is display-only:
  // capture reads the sweep's existing scroll diagnostics, while summary creeps below completion.
  const HANDOFF_STAGES = [
    { id: "capture", label: "Capturing chat" },
    { id: "summary", label: "Summarizing" },
    { id: "paste", label: "Pasting into destination" }
  ];
  const HANDOFF_CAPTURE_LINE_MIN = 0.04;
  const HANDOFF_CAPTURE_LINE_MAX = 0.94;
  const HANDOFF_ACTIVITY_LINE_START = 0.05;
  const HANDOFF_ACTIVITY_LINE_MAX = 0.9;
  const HANDOFF_ACTIVITY_LINE_DURATION_MS = 12000;
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
  const SOURCE_SCROLL_ROOT_SELECTORS = [
    "main",
    "[role='main']",
    "[class*='overflow-y-auto' i]",
    "[class*='overflow-auto' i]",
    "[class*='scroll' i]",
    "[data-testid*='conversation' i]",
    "[data-testid*='thread' i]",
    "[data-testid*='chat' i]",
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
      ],
      userRoleSelectors: ["[data-testid*='user-message' i]", "[data-message-author-role='user']"],
      assistantRoleSelectors: [
        "[data-testid*='assistant-message' i]",
        "[data-message-author-role='assistant']",
        ".font-claude-response"
      ]
    },
    chatgpt: {
      name: "ChatGPT",
      detail: "OpenAI",
      host: "chatgpt.com",
      // Legacy ChatGPT lived here; ordinary openai.com pages are not ChatGPT surfaces.
      alternateHosts: ["chat.openai.com"],
      url: "https://chatgpt.com/",
      accent: "#19c37d",
      logoSize: 21,
      logo: "logos/gptwhitedownload__1_-removebg-preview.png",
      retryPaste: true,
      pasteRetryTimeoutMs: CHATGPT_PASTE_RETRY_TIMEOUT_MS,
      pasteVerifyTimeoutMs: CHATGPT_PASTE_VERIFY_TIMEOUT_MS,
      pasteStabilityMs: CHATGPT_PASTE_STABILITY_MS,
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
      ],
      userRoleSelectors: ["[data-message-author-role='user']"],
      assistantRoleSelectors: ["[data-message-author-role='assistant']"]
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
      ],
      userRoleSelectors: ["user-query", "[class*='query-text' i]", "[data-role='user']"],
      assistantRoleSelectors: ["model-response", "[class*='response-content' i]", "[data-role='model']"]
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
      ],
      userRoleSelectors: [
        "[data-message-author-role='user']",
        "[data-role='user']",
        "[data-testid*='user-message' i]"
      ],
      assistantRoleSelectors: [
        "[data-message-author-role='assistant']",
        "[data-role='assistant']",
        "[data-testid*='assistant-message' i]"
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
      ],
      userRoleSelectors: ["[data-role='user']", "[data-message-author-role='user']"],
      assistantRoleSelectors: [
        "[data-role='assistant']",
        "[data-role='model']",
        "[data-message-author-role='assistant']"
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
  let reservedClaudeInlineControls = [];
  let reservedClaudeInlineShift = 0;
  let reservedClaudeControlOffsets = new Map();
  let reservedClaudeOverflowElements = [];
  let reservedComposerSurface = null;
  let destinationSheetAnimationFrame = null;
  let floatingButtonFrame = null;
  let floatingButtonObserver = null;
  let floatingButtonMonitoringDisabled = false;
  let handoffCountdownTimer = null;
  let handoffCountdownHideTimer = null;
  let handoffActivityProgressFrame = null;
  let handoffCaptureProgressFrame = null;
  let onboardingTimer = null;
  let onboardingDismissedThisSession = false;
  let claudeLimitNudgeDismissedUntilLimitClears = false;
  let transferTraceSequence = 0;
  let lastConversationCaptureMetrics = null;
  let sourceScrollTargetsCache = null;
  let chatGptConversationScrollRootCache = null;

  function cleanupContextGeneratorNodes() {
    cleanupContextGeneratorReservations();

    [
      BUBBLE_ID,
      OVERLAY_ID,
      HANDOFF_SCRIM_ID,
      ONBOARDING_ID,
      ONBOARDING_STYLE_ID,
      CLAUDE_LIMIT_NUDGE_ID,
      DESTINATION_SHEET_ID,
      DESTINATION_SHEET_STYLE_ID,
      "context-generator-styles",
      "context-generator-error-overlay",
      "context-generator-error-mark",
      "context-generator-fallback-modal"
    ].forEach((id) => document.getElementById(id)?.remove());
  }

  function cleanupContextGeneratorReservations() {
    document.querySelectorAll("[data-context-generator-original-transform]").forEach((element) => {
      element.style.transform = element.getAttribute("data-context-generator-original-transform") || "";
      element.style.willChange = "";
      element.removeAttribute("data-context-generator-original-transform");
    });

    document.querySelectorAll("[data-context-generator-original-overflow]").forEach((element) => {
      element.style.overflow = element.getAttribute("data-context-generator-original-overflow") || "";
      element.removeAttribute("data-context-generator-original-overflow");
    });

    document.querySelectorAll("[data-context-generator-original-position]").forEach((element) => {
      element.style.position = element.getAttribute("data-context-generator-original-position") || "";
      element.removeAttribute("data-context-generator-original-position");
    });
  }

  extensionRuntime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "CONTEXT_GENERATOR_PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "PASTE_CONTEXT") {
      const pasteStartedAt = getNow();
      logTransferPerf(message.transferId, "destination paste start", { destination: message.destination });
      pasteIntoPlatform(message.text, message.destination, message.transferId)
        .then(() => {
          const pasteMs = Math.round(getNow() - pasteStartedAt);
          logTransferPerf(message.transferId, "destination paste done", { destination: message.destination, pasteMs });
          sendResponse({ ok: true, timing: { pasteMs } });
        })
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
      const trace = createTransferTrace(destination, "extension icon");
      markTransferTrace(trace, "click", { source: "extension icon" });
      runContextFlow(destination, null, null, trace);
      return false;
    }

    return false;
  });

  if (window.__CONTEXT_GENERATOR_TEST_HOOKS__?.register) {
    window.__CONTEXT_GENERATOR_TEST_HOOKS__.register({
      scrapeConversationText,
      getConversationRole,
      editorContainsText,
      formatFirefoxContentEditableHtml,
      getClaudeBubblePlacement,
      getGeminiBubblePlacement,
      findGeminiModelSelectorButton,
      prepareSourceForCapture,
      expandCollapsedConversationContent,
      getConversationTurns,
      getDetectedConversationMessageCount,
      collectRenderedConversationTurns,
      scrapeConversationTextWhenReady,
      createTransferTrace,
      markCaptureDone,
      buildLatestTransferStats,
      getClaudeInlineControlsToShift,
      getClaudeModelControlsToNudge,
      getClaudeControlTargetOffset,
      reserveClaudeInlineBubbleSlot,
      getHandoffProgressState,
      getHandoffProgressStatusText
    });
  } else {
    startFloatingButtonMonitoring();
  }

  async function runContextFlow(destinationId, preparedDestinationPromise = null, scrapedConversationText = null, trace = null) {
    const transferTrace = trace || createTransferTrace(destinationId, "transfer");
    transferTrace.destinationId = destinationId;
    let transferStage = "capture";
    let summary = "";
    try {
      let conversationText = scrapedConversationText;
      let destinationPrepPromise = preparedDestinationPromise;
      if (!conversationText) {
        if (getDetectedConversationMessageCount() === 0) {
          throw new Error(NO_CONVERSATION_ERROR_MESSAGE);
        }
        if (!isHandoffOverlayVisible()) {
          showOverlay(destinationId);
        }
        if (!destinationPrepPromise && getDetectedConversationMessageCount() > 0) {
          destinationPrepPromise = prepareDestinationTab(destinationId, transferTrace);
        }
        await prepareSourceForCapture();
        if (!destinationPrepPromise && getDetectedConversationMessageCount() > 0) {
          destinationPrepPromise = prepareDestinationTab(destinationId, transferTrace);
        }
        transferStage = "capture";
        markTransferTrace(transferTrace, "capture start");
        setHandoffProgress("capture", "active");
        conversationText = await scrapeConversationTextWhenReady();
        markCaptureDone(transferTrace, conversationText);
      }
      destinationPrepPromise = destinationPrepPromise || prepareDestinationTab(destinationId, transferTrace);
      if (!isHandoffOverlayVisible()) {
        showOverlay(destinationId);
      }
      transferStage = "summary";
      summary = await summarizeWithBackend(conversationText, transferTrace);
      markTransferTrace(transferTrace, "summary available", { chars: summary.length });
      setHandoffProgress("summary", "done");
      transferStage = "destination";
      const preparedDestination = destinationPrepPromise ? await destinationPrepPromise : null;
      markTransferTrace(transferTrace, "tab open done", {
        tabId: preparedDestination?.tabId || null,
        background: preparedDestination?.timing || null
      });
      markTransferTrace(transferTrace, "paste request start");
      setHandoffProgress("paste", "active");
      transferStage = "paste";
      const pasteResponse = await notifyBackground({
        type: "TRANSFER_TO_DESTINATION",
        destination: destinationId,
        text: summary,
        preparedTabId: preparedDestination?.tabId || null,
        transferId: transferTrace.id
      });
      appendBackgroundMarks(transferTrace, pasteResponse?.marks);
      markTransferTrace(transferTrace, "paste done", pasteResponse?.timing || null);
      setHandoffProgress("paste", "done");
      finishTransferTrace(transferTrace);
      resetRunningFlag();
    } catch (error) {
      markTransferTrace(transferTrace, `failed: ${error.message}`);
      finishTransferTrace(transferTrace);
      resetRunningFlag();
      showContextTransferFailure(error, {
        destinationId,
        stage: transferStage,
        summary
      });
      await notifyBackground({ type: "CONTEXT_TRANSFER_ERROR", error: error.message }).catch(() => {});
    }
  }

  function showContextTransferFailure(error, details = {}) {
    const stage = details.stage || "transfer";
    const summary = details.summary?.trim?.() || "";
    const destinationName = getPlatform(details.destinationId)?.name || "the destination";

    if (stage === "summary") {
      if (["conversation_too_large", "request_too_large", "rate_limited", "service_busy", "client_not_allowed"].includes(error?.code)) {
        showErrorOverlay(error.message);
        return;
      }
      showErrorOverlay(SUMMARY_RETRY_ERROR_MESSAGE);
      return;
    }

    if (summary) {
      showFallbackModal(summary, destinationName);
      return;
    }

    showErrorOverlay(error?.message || "Transfer failed. Please try again.");
  }

  async function summarizeWithBackend(conversationText, trace = null) {
    return (await requestBackendSummary(conversationText, trace)).summary;
  }

  async function requestBackendSummary(conversationText, trace = null) {
    if (conversationText.length > MAX_BACKEND_CONVERSATION_CHARS) {
      const error = new Error(OVERSIZED_CONVERSATION_ERROR_MESSAGE);
      error.code = "conversation_too_large";
      throw error;
    }

    markTransferTrace(trace, "summary start", { chars: conversationText.length, inputChars: conversationText.length });
    setHandoffProgress("summary", "active");
    const response = await notifyBackground({
      type: "SUMMARIZE_WITH_BACKEND",
      conversation: conversationText,
      transferId: trace?.id || null
    });

    if (!response?.summary?.trim()) {
      throw new Error("Backup summarizer returned no summary.");
    }

    const summary = response.summary.trim();
    const timing = response.timing || null;
    markTransferTrace(trace, "summary done", {
      chars: summary.length,
      background: timing
    });
    return { summary, timing };
  }

  function prepareDestinationTab(destinationId, trace = null) {
    markTransferTrace(trace, "tab open start", { destination: destinationId });
    return notifyBackground({
      type: "PREPARE_DESTINATION",
      destination: destinationId,
      transferId: trace?.id || null
    }).then((response) => {
      markTransferTrace(trace, "tab open response", {
        tabId: response?.tabId || null,
        background: response?.timing || null
      });
      return response;
    }).catch((error) => {
      logTransferDebug(`Destination pre-open failed; falling back to normal transfer. ${error.message}`);
      return null;
    });
  }

  function createTransferTrace(destinationId, source) {
    transferTraceSequence += 1;
    const id = `${Date.now().toString(36)}-${transferTraceSequence}`;
    return {
      id,
      source,
      sourcePlatformId: currentPlatform.id,
      sourcePlatformName: currentPlatform.name,
      destinationId,
      startedAt: getNow(),
      startedAtEpoch: Date.now(),
      lastAt: null,
      marks: [],
      completed: false
    };
  }

  function markCaptureDone(trace, conversationText) {
    if (trace) trace.rawScrapedText = conversationText;
    markTransferTrace(trace, "capture done", {
      chars: conversationText.length,
      ...getConversationCaptureMetrics(conversationText)
    });
    setHandoffProgress("capture", "done");
  }

  async function prepareSourceForCapture() {
    sourceScrollTargetsCache = null;
    chatGptConversationScrollRootCache = null;
    scrollSourceConversationToTop();
    await waitForConversationCaptureToSettle();
    const expandedCount = await expandCollapsedConversationContent();
    if (expandedCount > 0) {
      await waitForConversationCaptureToSettle(Math.min(1200, getSourceScrollStableTimeout()));
    }
  }

  async function waitForConversationCaptureToSettle(timeoutMs = getSourceScrollStableTimeout()) {
    const startedAt = Date.now();
    let lastSnapshot = getConversationReadinessSnapshot();
    let stableSamples = 0;

    while (Date.now() - startedAt < timeoutMs) {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      await delay(Math.min(SOURCE_SCROLL_STABLE_INTERVAL_MS, Math.max(0, remainingMs)));
      scrollSourceConversationToTop();

      const expandedCount = await expandCollapsedConversationContent();
      const nextSnapshot = getConversationReadinessSnapshot();
      if (expandedCount === 0 && isConversationReadinessStable(lastSnapshot, nextSnapshot)) {
        stableSamples += 1;
        if (stableSamples >= SOURCE_SCROLL_STABLE_SAMPLE_COUNT) return;
      } else {
        lastSnapshot = nextSnapshot;
        stableSamples = 0;
      }
    }
  }

  function getSourceScrollStableTimeout() {
    return currentPlatform.id === "claude" || currentPlatform.id === "chatgpt"
      ? SOURCE_SCROLL_LONG_STABLE_TIMEOUT_MS
      : SOURCE_SCROLL_STABLE_TIMEOUT_MS;
  }

  function getConversationReadinessSnapshot() {
    const messageTurns = getConversationTurns().filter((turn) => isDetectedConversationMessage(turn));
    const scrollState = getSourceScrollState();
    return {
      turns: messageTurns,
      signature: messageTurns
        .map((turn) => getConversationTurnSignature(turn.role, cleanText(turn.text)))
        .join("\u0002"),
      count: messageTurns.length,
      chars: messageTurns.reduce((total, turn) => total + turn.text.length, 0),
      scrollHeight: scrollState.scrollHeight,
      scrollTop: scrollState.scrollTop
    };
  }

  function isConversationReadinessStable(previous, next) {
    return (
      previous.count === next.count &&
      previous.chars === next.chars &&
      previous.scrollHeight === next.scrollHeight &&
      next.scrollTop <= 2
    );
  }

  function getDetectedConversationMessageCount() {
    return getConversationTurns().filter((turn) => isDetectedConversationMessage(turn)).length;
  }

  function scrollSourceConversationToTop() {
    const chatGptRoot = getChatGptConversationScrollRoot();
    if (chatGptRoot) {
      scrollElementToTopInstantly(chatGptRoot);
      if (isDocumentScrollRoot(chatGptRoot)) scrollWindowToTopInstantly();
      return;
    }

    getSourceScrollTargets().forEach(scrollElementToTopInstantly);
    scrollWindowToTopInstantly();
  }

  function getSourceScrollState() {
    const chatGptRoot = getChatGptConversationScrollRoot();
    if (chatGptRoot) {
      return {
        scrollHeight: Number(chatGptRoot.scrollHeight || 0),
        scrollTop: Math.max(0, Number(chatGptRoot.scrollTop || 0)),
        clientHeight: Math.max(0, Number(chatGptRoot.clientHeight || 0))
      };
    }

    return getSourceScrollTargets().reduce((state, element) => {
      state.scrollHeight += Number(element.scrollHeight || 0);
      state.scrollTop += Number(element.scrollTop || 0);
      state.clientHeight += Number(element.clientHeight || 0);
      return state;
    }, {
      scrollHeight: 0,
      scrollTop: Math.max(0, Number(window.scrollY || 0)),
      clientHeight: Math.max(0, Number(window.innerHeight || 0))
    });
  }

  function getSourceScrollRemaining() {
    const chatGptRoot = getChatGptConversationScrollRoot();
    if (chatGptRoot) {
      return Math.max(
        0,
        getElementMaxScrollTop(chatGptRoot) - Math.max(0, Number(chatGptRoot.scrollTop || 0))
      );
    }

    const elementRemaining = getSourceScrollTargets().reduce((remaining, element) => {
      const maxTop = getElementMaxScrollTop(element);
      const currentTop = Math.max(0, Number(element.scrollTop || 0));
      return Math.max(remaining, maxTop - currentTop);
    }, 0);

    return Math.max(elementRemaining, getWindowScrollRemaining());
  }

  function getElementMaxScrollTop(element) {
    return Math.max(0, Number(element?.scrollHeight || 0) - Number(element?.clientHeight || 0));
  }

  function getWindowScrollRemaining() {
    const documentHeight = Math.max(
      Number(document.documentElement?.scrollHeight || 0),
      Number(document.body?.scrollHeight || 0)
    );
    const viewportHeight = Number(window.innerHeight || document.documentElement?.clientHeight || 0);
    if (!documentHeight || !viewportHeight) return 0;
    return Math.max(0, documentHeight - viewportHeight - Math.max(0, Number(window.scrollY || 0)));
  }

  function getSourceViewportHeight() {
    const chatGptRoot = getChatGptConversationScrollRoot();
    if (chatGptRoot) {
      return Math.max(360, Number(chatGptRoot.clientHeight || 0) || Number(window.innerHeight || 0) || 720);
    }

    const targetHeight = getSourceScrollTargets().reduce((height, element) => {
      return Math.max(height, Number(element.clientHeight || 0));
    }, 0);
    return Math.max(360, targetHeight || Number(window.innerHeight || 0) || 720);
  }

  function scrollSourceConversationByInstantly(deltaY) {
    const chatGptRoot = getChatGptConversationScrollRoot();
    if (chatGptRoot) {
      if (scrollElementByInstantly(chatGptRoot, deltaY)) return true;
      return isDocumentScrollRoot(chatGptRoot) && scrollWindowByInstantly(deltaY);
    }

    let moved = false;
    getSourceScrollTargets().forEach((element) => {
      if (scrollElementByInstantly(element, deltaY)) moved = true;
    });
    if (scrollWindowByInstantly(deltaY)) moved = true;
    return moved;
  }

  function scrollElementByInstantly(element, deltaY) {
    const maxTop = getElementMaxScrollTop(element);
    const currentTop = Math.max(0, Number(element.scrollTop || 0));
    if (maxTop <= 0 || currentTop >= maxTop - 1) return false;

    const nextTop = Math.min(maxTop, currentTop + Math.max(1, Number(deltaY || 0)));
    try {
      element.scrollTo?.({ top: nextTop, left: element.scrollLeft || 0, behavior: "instant" });
    } catch {
      try {
        element.scrollTo?.(element.scrollLeft || 0, nextTop);
      } catch {}
    }
    if (Math.abs(Number(element.scrollTop || 0) - nextTop) > 1) {
      try {
        element.scrollTop = nextTop;
      } catch {}
    }

    return Math.abs(Number(element.scrollTop || 0) - currentTop) > 1;
  }

  function scrollWindowByInstantly(deltaY) {
    if (getWindowScrollRemaining() <= 1) return false;
    const currentTop = Math.max(0, Number(window.scrollY || 0));
    const nextTop = currentTop + Math.max(1, Number(deltaY || 0));
    try {
      window.scrollTo?.({ top: nextTop, left: window.scrollX || 0, behavior: "instant" });
    } catch {
      try {
        window.scrollTo?.(window.scrollX || 0, nextTop);
      } catch {}
    }
    return Math.abs(Number(window.scrollY || 0) - currentTop) > 1;
  }

  async function waitForConversationWindowToSettle(
    timeoutMs = VIRTUAL_SWEEP_SETTLE_MS,
    stableSampleCount = VIRTUAL_SWEEP_STABLE_SAMPLE_COUNT
  ) {
    const startedAt = Date.now();
    let lastSnapshot = getConversationReadinessSnapshot();
    let latestSnapshot = lastSnapshot;
    let stableSamples = 0;

    while (Date.now() - startedAt < timeoutMs) {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      await delay(Math.min(SOURCE_SCROLL_STABLE_INTERVAL_MS, Math.max(0, remainingMs)));

      const nextSnapshot = getConversationReadinessSnapshot();
      latestSnapshot = nextSnapshot;
      if (isConversationWindowStable(lastSnapshot, nextSnapshot)) {
        stableSamples += 1;
        if (stableSamples >= stableSampleCount) return nextSnapshot;
      } else {
        lastSnapshot = nextSnapshot;
        stableSamples = 0;
      }
    }

    return latestSnapshot;
  }

  function isConversationWindowStable(previous, next) {
    return (
      previous.count === next.count &&
      previous.chars === next.chars &&
      previous.scrollHeight === next.scrollHeight &&
      previous.scrollTop === next.scrollTop
    );
  }

  async function expandCollapsedConversationContent(maxRounds = 3) {
    let expandedCount = 0;

    for (let round = 0; round < maxRounds; round += 1) {
      const expanders = getCollapsedConversationExpanders();
      if (!expanders.length) break;

      expanders.slice(0, 30).forEach((element) => {
        try {
          element.click?.();
          expandedCount += 1;
        } catch (error) {
          console.debug("[Context Generator] Could not expand collapsed conversation text:", error?.message || error);
        }
      });

      await delay(80);
    }

    return expandedCount;
  }

  function getCollapsedConversationExpanders() {
    return Array.from(document.querySelectorAll("button, [role='button'], summary"))
      .filter((element, index, all) => all.indexOf(element) === index && isCollapsedConversationExpander(element));
  }

  function isCollapsedConversationExpander(element) {
    if (!(element instanceof Element) || !isVisible(element) || isContextGeneratorNode(element)) return false;
    if (element.closest("nav, header, footer, aside, menu")) return false;

    const label = getElementLabel(element, true);
    if (!COLLAPSED_CONVERSATION_EXPAND_RE.test(label)) return false;
    if (COLLAPSED_CONVERSATION_EXPAND_EXCLUDE_RE.test(label)) return false;

    return Boolean(
      element.closest(getConversationReadinessSelectors()) ||
      element.closest("main, [role='main']")
    );
  }

  function getSourceScrollTargets() {
    if (
      sourceScrollTargetsCache?.length &&
      sourceScrollTargetsCache.every((element) => element?.isConnected !== false)
    ) {
      return sourceScrollTargetsCache;
    }

    const roots = [
      document.scrollingElement,
      document.documentElement,
      document.body
    ];
    const rootSelectors = [
      ...SOURCE_SCROLL_ROOT_SELECTORS,
      ...FALLBACK_CONVERSATION_ROOT_SELECTORS
    ];
    const selectors = [
      ...currentPlatform.conversationSelectors,
      ...GENERIC_CONVERSATION_SELECTORS,
      ...FALLBACK_CONVERSATION_ROOT_SELECTORS
    ];

    document.querySelectorAll([...new Set(rootSelectors)].join(",")).forEach((element) => {
      if (isLikelySourceScrollRoot(element)) roots.push(element);
    });

    document.querySelectorAll([...new Set(selectors)].join(",")).forEach((element) => {
      let node = element;
      while (node && node !== document.body && node !== document.documentElement) {
        if (isScrollableSourceElement(node)) roots.push(node);
        node = node.parentElement;
      }
    });

    sourceScrollTargetsCache = roots.filter((element, index, all) => element && all.indexOf(element) === index);
    return sourceScrollTargetsCache;
  }

  function getChatGptConversationScrollRoot() {
    if (currentPlatform.id !== "chatgpt") return null;
    if (
      chatGptConversationScrollRootCache?.isConnected !== false &&
      isScrollableSourceElement(chatGptConversationScrollRootCache)
    ) {
      return chatGptConversationScrollRootCache;
    }

    const supportedRoots = new Map();
    getConversationTurns().forEach((turn) => {
      let node = turn.element?.parentElement;
      let depth = 0;
      while (node && node !== document.body && node !== document.documentElement) {
        if (isScrollableSourceElement(node)) {
          const support = supportedRoots.get(node) || { count: 0, totalDepth: 0 };
          support.count += 1;
          support.totalDepth += depth;
          supportedRoots.set(node, support);
        }
        node = node.parentElement;
        depth += 1;
      }
    });

    const ancestorRoot = [...supportedRoots.entries()]
      .sort((left, right) => {
        const supportDifference = right[1].count - left[1].count;
        if (supportDifference) return supportDifference;
        const leftAverageDepth = left[1].totalDepth / left[1].count;
        const rightAverageDepth = right[1].totalDepth / right[1].count;
        if (leftAverageDepth !== rightAverageDepth) return leftAverageDepth - rightAverageDepth;
        return getElementMaxScrollTop(right[0]) - getElementMaxScrollTop(left[0]);
      })[0]?.[0];

    if (ancestorRoot) {
      chatGptConversationScrollRootCache = ancestorRoot;
      return ancestorRoot;
    }

    // ChatGPT can render turns in a detached virtualizer subtree. In that case, prefer an app-sized
    // scroller over broad page candidates; using the tallest candidate caused top/middle/bottom jumps.
    const viewportHeight = Math.max(
      360,
      Number(window.innerHeight || document.documentElement?.clientHeight || 0) || 720
    );
    const candidates = getSourceScrollTargets().filter(isScrollableSourceElement);
    const appSizedCandidates = candidates.filter((element) => {
      const clientHeight = Number(element.clientHeight || 0);
      return clientHeight >= 160 && clientHeight <= viewportHeight * 1.5;
    });
    const fallbackRoot = (appSizedCandidates.length ? appSizedCandidates : candidates)
      .sort((left, right) => {
        const scrollRangeDifference = getElementMaxScrollTop(right) - getElementMaxScrollTop(left);
        if (scrollRangeDifference) return scrollRangeDifference;
        return (
          Math.abs(Number(left.clientHeight || 0) - viewportHeight) -
          Math.abs(Number(right.clientHeight || 0) - viewportHeight)
        );
      })[0] || null;

    chatGptConversationScrollRootCache = fallbackRoot;
    return fallbackRoot;
  }

  function isDocumentScrollRoot(element) {
    return Boolean(
      element &&
      (element === document.scrollingElement || element === document.documentElement || element === document.body)
    );
  }

  function isLikelySourceScrollRoot(element) {
    if (!isScrollableSourceElement(element)) return false;
    if (element.closest("nav, header, footer, aside, menu")) return false;

    const rect = element.getBoundingClientRect?.();
    if (rect && (rect.height < 160 || rect.width < 260)) return false;

    const label = getElementLabel(element);
    return /\b(?:main|conversation|conversations|thread|threads|chat|chats|messages|message-list|transcript|scroll|overflow)\b/.test(label);
  }

  function isScrollableSourceElement(element) {
    if (!(element instanceof Element) || isContextGeneratorNode(element)) return false;
    const scrollHeight = Number(element.scrollHeight || 0);
    const clientHeight = Number(element.clientHeight || 0);
    return scrollHeight > clientHeight + 4;
  }

  function scrollElementToTopInstantly(element) {
    try {
      element.scrollTop = 0;
      element.scrollTo?.({ top: 0, left: element.scrollLeft || 0, behavior: "instant" });
    } catch {
      try {
        element.scrollTo?.(element.scrollLeft || 0, 0);
      } catch {}
    }
  }

  function scrollWindowToTopInstantly() {
    try {
      window.scrollTo?.({ top: 0, left: window.scrollX || 0, behavior: "instant" });
    } catch {
      try {
        window.scrollTo?.(window.scrollX || 0, 0);
      } catch {}
    }
  }

  function markTransferTrace(trace, label, detail = null) {
    if (!trace) return;
    const now = getNow();
    const previous = trace.lastAt || trace.startedAt;
    const mark = {
      label,
      at: now,
      deltaMs: Math.round(now - previous),
      totalMs: Math.round(now - trace.startedAt),
      detail
    };
    trace.lastAt = now;
    trace.marks.push(mark);
    logTransferPerf(trace.id, label, {
      totalMs: mark.totalMs,
      deltaMs: mark.deltaMs,
      ...formatTraceDetail(detail)
    });
  }

  function finishTransferTrace(trace) {
    if (!trace || trace.completed) return;
    trace.completed = true;
    const totalMs = Math.round(getNow() - trace.startedAt);
    persistLatestTransferStats(trace, totalMs);
    const rows = trace.marks.map((mark) => ({
      step: mark.label,
      deltaMs: mark.deltaMs,
      totalMs: mark.totalMs,
      detail: JSON.stringify(formatTraceDetail(mark.detail))
    }));
    console.debug(`[Context Generator Perf ${trace.id}] total ${totalMs}ms`, rows);
  }

  function formatTraceDetail(detail) {
    if (!detail || typeof detail !== "object") return {};
    return Object.fromEntries(Object.entries(detail).filter(([, value]) => value !== undefined && value !== null));
  }

  function logTransferPerf(id, label, detail = null) {
    const suffix = detail ? ` ${JSON.stringify(formatTraceDetail(detail))}` : "";
    console.debug(`[Context Generator Perf ${id || "no-trace"}] ${label}${suffix}`);
  }

  function appendBackgroundMarks(trace, marks = []) {
    if (!trace || !Array.isArray(marks)) return;
    marks.forEach((mark) => {
      logTransferPerf(trace.id, `background: ${mark.label}`, {
        totalMs: mark.totalMs,
        deltaMs: mark.deltaMs,
        ...(mark.detail || {})
      });
    });
  }

  function persistLatestTransferStats(trace, totalMs) {
    const storage = chrome?.storage?.local;
    if (!storage?.set) return;

    const stats = buildLatestTransferStats(trace, totalMs);
    const setResult = storage.set({ [LAST_TRANSFER_STATS_STORAGE_KEY]: stats });
    if (setResult?.catch) {
      setResult.catch((error) => {
        console.debug("[Context Generator] Could not save latest analysis stats:", error?.message || error);
      });
    }
  }

  function buildLatestTransferStats(trace, totalMs) {
    const summaryTiming = getSummaryTimingFromTrace(trace);
    const backendTiming = summaryTiming?.backend || null;
    const captureDetail = getMarkDetail(trace, "capture done") || {};
    const pasteDetail = getMarkDetail(trace, "paste done") || {};
    const failureMark = trace.marks.find((mark) => mark.label.startsWith("failed:"));
    const completedAtEpoch = Date.now();
    const rawScrapedText = typeof trace.rawScrapedText === "string" ? trace.rawScrapedText : null;

    return {
      version: 1,
      transferId: trace.id,
      status: failureMark ? "failed" : "completed",
      failure: failureMark?.label.replace(/^failed:\s*/, "") || null,
      source: {
        id: trace.sourcePlatformId,
        name: trace.sourcePlatformName
      },
      destination: {
        id: trace.destinationId || null,
        name: trace.destinationId ? getPlatform(trace.destinationId)?.name || trace.destinationId : null
      },
      startedAt: new Date(trace.startedAtEpoch || Date.now()).toISOString(),
      completedAt: new Date(completedAtEpoch).toISOString(),
      totalMs,
      rawScrapedText,
      rawScrapedTextExpiresAt: rawScrapedText
        ? new Date(completedAtEpoch + RAW_TRANSCRIPT_RETENTION_MS).toISOString()
        : null,
      capture: {
        method: captureDetail.method || null,
        messageTurnCount: captureDetail.messageTurnCount ?? null,
        usefulTurnCount: captureDetail.usefulTurnCount ?? null,
        rawCandidateChars: captureDetail.rawCandidateChars ?? null,
        transcriptChars: captureDetail.transcriptChars ?? null,
        cleanedChars: captureDetail.cleanedChars ?? null,
        sentChars: captureDetail.sentChars ?? captureDetail.chars ?? null,
        capped: captureDetail.capped === true,
        capChars: captureDetail.capChars ?? null
      },
      summary: {
        source: summaryTiming?.source || null,
        summaryMs: summaryTiming?.summaryMs ?? null,
        fetchMs: summaryTiming?.fetchMs ?? null,
        parseMs: summaryTiming?.parseMs ?? null,
        outputChars: summaryTiming?.chars ?? backendTiming?.outputChars ?? null,
        requestChars: summaryTiming?.requestChars ?? null,
        backendInputChars: summaryTiming?.backendInputChars ?? backendTiming?.inputChars ?? null,
        backendTotalMs: backendTiming?.totalMs ?? null,
        geminiMs: backendTiming?.geminiMs ?? null,
        mistralMs: backendTiming?.mistralMs ?? null,
        groqMs: backendTiming?.groqMs ?? null,
        providerMs: backendTiming?.providerMs ?? null,
        providerPasses: backendTiming?.providerPasses ?? null,
        servedBy: backendTiming?.servedBy || backendTiming?.provider || null,
        provider: backendTiming?.provider || backendTiming?.servedBy || null,
        primaryModel: backendTiming?.primaryModel || null,
        model: backendTiming?.model || null,
        modelReason: backendTiming?.modelReason || null,
        modelsTried: sanitizeModelChainForStats(backendTiming?.modelsTried),
        mistralModelsTried: sanitizeModelChainForStats(backendTiming?.mistralModelsTried),
        modelInputChars: backendTiming?.modelInputChars ?? null,
        modelThresholdChars: backendTiming?.modelThresholdChars ?? null,
        modelOverride: backendTiming?.modelOverride === true,
        profile: backendTiming?.profile || null,
        maxTokens: backendTiming?.maxTokens ?? null,
        targetWords: backendTiming?.targetWords ?? null,
        minWords: backendTiming?.minWords ?? null,
        summaryWordCount: backendTiming?.summaryWordCount ?? null,
        mistralPasses: backendTiming?.mistralPasses ?? null,
        evaluation: sanitizeEvaluationForStats(backendTiming?.evaluation),
        expansion: sanitizeExpansionForStats(backendTiming?.expansion),
        fallback: sanitizeFallbackForStats(backendTiming?.fallback),
        usage: normalizeUsageForStats(backendTiming?.usage)
      },
      destinationTiming: {
        totalMs: pasteDetail.totalMs ?? null,
        pasteMs: pasteDetail.paste?.pasteMs ?? pasteDetail.pasteMs ?? null,
        tabId: pasteDetail.tabId ?? null
      },
      timeline: trace.marks.map((mark) => ({
        label: mark.label,
        deltaMs: mark.deltaMs,
        totalMs: mark.totalMs,
        detail: sanitizeTraceDetail(formatTraceDetail(mark.detail))
      }))
    };
  }

  function getSummaryTimingFromTrace(trace) {
    if (!trace?.marks) return null;
    const summaryDone = [...trace.marks].reverse().find((mark) => mark.label === "summary done");
    return summaryDone?.detail?.background || null;
  }

  function getMarkDetail(trace, label) {
    return [...trace.marks].reverse().find((mark) => mark.label === label)?.detail || null;
  }

  function sanitizeExpansionForStats(expansion) {
    if (!expansion || typeof expansion !== "object") return null;
    return {
      attempted: expansion.attempted === true,
      used: expansion.used === true,
      wordCount: expansion.wordCount ?? null,
      error: expansion.error ? "Expansion failed" : null,
      usage: normalizeUsageForStats(expansion.usage)
    };
  }

  function sanitizeFallbackForStats(fallback) {
    if (!fallback || typeof fallback !== "object") return null;
    return {
      attempted: fallback.attempted === true,
      used: fallback.used === true,
      servedBy: fallback.servedBy || null,
      model: fallback.model || null,
      reason: fallback.reason || null
    };
  }

  function sanitizeModelChainForStats(models) {
    if (!Array.isArray(models)) return [];
    return models
      .filter((model) => typeof model === "string" && model.trim())
      .slice(0, 5)
      .map((model) => model.trim());
  }

  function normalizeUsageForStats(usage) {
    if (!usage || typeof usage !== "object") return null;
    return {
      promptTokens: usage.promptTokens ?? null,
      completionTokens: usage.completionTokens ?? null,
      totalTokens: usage.totalTokens ?? null,
      cachedTokens: usage.cachedTokens ?? null
    };
  }

  function sanitizeTraceDetail(detail) {
    if (!detail || typeof detail !== "object") return {};
    const sanitized = { ...detail };
    delete sanitized.backend;
    delete sanitized.background;
    return sanitized;
  }

  function getNow() {
    return window.performance?.now?.() || Date.now();
  }

  async function notifyBackground(message) {
    let response;
    try {
      response = await extensionRuntime.sendMessage(message);
    } catch (error) {
      if (isExtensionContextInvalidated(error)) {
        throw new Error("Extension was reloaded. Refresh this AI tab once, then try Cap-Context again.");
      }
      throw error;
    }

    if (response && response.ok === false) {
      const error = new Error(response.error || "Unknown background error");
      error.code = response.code || null;
      error.status = response.status || null;
      throw error;
    }
    return response;
  }

  function getRuntimeAssetBaseUrl() {
    try {
      return extensionRuntime?.getURL?.("") || "";
    } catch (_error) {
      return "";
    }
  }

  function getExtensionRuntime() {
    try {
      const runtime = globalThis.chrome?.runtime;
      if (!runtime?.onMessage?.addListener || !runtime?.sendMessage) return null;
      return runtime;
    } catch (_error) {
      return null;
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
    if (hostname === platform.host || hostname.endsWith(`.${platform.host}`)) {
      return true;
    }

    // Alternate hosts are explicit legacy surfaces, not wildcard domain families.
    return (platform.alternateHosts || []).includes(hostname);
  }

  function getPlatform(platformId) {
    const platform = PLATFORMS[platformId];
    return platform ? { ...platform, id: platformId } : null;
  }

  async function pasteIntoPlatform(text, destinationId, transferId = null) {
    const destination = getPlatform(destinationId) || currentPlatform;
    if (!destination) {
      throw new Error("This AI destination is not supported.");
    }

    if (!text?.trim()) {
      throw new Error(`No text was provided for ${destination.name}.`);
    }

    const trimmedText = text.trim();

    if (destination.retryPaste) {
      await pasteWithRetry(trimmedText, destination, transferId);
      return;
    }

    const input = await waitForElement(() => findPlatformInput(destination), 15000, `${destination.name} message input`);
    if (!input) {
      showFallbackModal(trimmedText, destination.name);
      throw new Error(`${destination.name} message input element could not be found.`);
    }

    logTransferPerf(transferId, "destination input ready", { destination: destination.name });
    setEditorText(input, trimmedText, destination);

    if (!editorContainsText(input, trimmedText)) {
      showFallbackModal(trimmedText, destination.name);
      throw new Error(`Paste operation failed to populate the ${destination.name} editor.`);
    }

    input.focus?.();
  }

  async function pasteWithRetry(text, destination, transferId = null) {
    const startedAt = Date.now();
    const retryTimeoutMs = destination.pasteRetryTimeoutMs || PASTE_RETRY_TIMEOUT_MS;
    const verifyTimeoutMs = destination.pasteVerifyTimeoutMs || PASTE_VERIFY_TIMEOUT_MS;
    const stabilityMs = destination.pasteStabilityMs || 0;
    let sawInput = false;
    let loggedInputReady = false;
    let lastError = null;

    while (Date.now() - startedAt <= retryTimeoutMs) {
      const input = findReadyPlatformInput(destination);
      if (input) {
        sawInput = true;
        if (!loggedInputReady) {
          loggedInputReady = true;
          logTransferPerf(transferId, "destination input ready", {
            destination: destination.name,
            readyMs: Date.now() - startedAt
          });
        }

        try {
          setEditorText(input, text, destination);

          if (await waitForEditorText(input, text, verifyTimeoutMs)) {
            if (stabilityMs > 0) {
              await delay(stabilityMs);
              if (!editorContainsText(input, text)) {
                lastError = new Error(`${destination.name} editor cleared the pasted context after first insert.`);
                continue;
              }
            }
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

  function setEditorText(element, text, destination = currentPlatform) {
    element.click();
    element.focus();

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const valueSetter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set;
      valueSetter?.call(element, text);
      dispatchEditorEvents(element, text);
      return;
    }

    // Firefox flattens newlines passed to insertText in contenteditable editors.
    if (isFirefoxBrowser()) {
      selectEditorContents(element);
      if (document.execCommand("insertHTML", false, formatFirefoxContentEditableHtml(text))) {
        dispatchEditorEvents(element, text);
        return;
      }
    }

    if (destination?.id === "chatgpt") {
      setChatGptEditorText(element, text);
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

  function setChatGptEditorText(element, text) {
    selectEditorContents(element);
    dispatchBeforeInputPasteEvent(element, text);

    if (!editorContainsText(element, text)) {
      selectEditorContents(element);
      dispatchClipboardPasteEvent(element, text);
    }

    if (!editorContainsText(element, text)) {
      selectEditorContents(element);
      document.execCommand("insertText", false, text);
    }

    if (!editorContainsText(element, text)) {
      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, text);
    }

    if (!editorContainsText(element, text)) {
      element.textContent = text;
    }

    dispatchEditorEvents(element, text);
  }

  function selectEditorContents(element) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function sanitizeEvaluationForStats(evaluation) {
    if (!evaluation || typeof evaluation !== "object") return null;
    return {
      version: evaluation.version || null,
      mode: evaluation.mode || null,
      passed: evaluation.passed === true,
      score: evaluation.score ?? null,
      evaluatorMs: evaluation.evaluatorMs ?? null,
      cutoffDetected: evaluation.cutoffDetected === true,
      unsupportedCount: evaluation.unsupportedCount ?? null,
      unsupportedKinds: Array.isArray(evaluation.unsupportedKinds)
        ? evaluation.unsupportedKinds.slice(0, 8)
        : [],
      warningCount: evaluation.warningCount ?? null,
      warningKinds: Array.isArray(evaluation.warningKinds)
        ? evaluation.warningKinds.slice(0, 8)
        : [],
      missingLatestUserFactCount: evaluation.missingLatestUserFactCount ?? null,
      missingLatestUserKinds: Array.isArray(evaluation.missingLatestUserKinds)
        ? evaluation.missingLatestUserKinds.slice(0, 8)
        : [],
      skipped: evaluation.skipped === true,
      reason: evaluation.reason || null
    };
  }

  function isFirefoxBrowser() {
    return /\bFirefox\//i.test(navigator.userAgent || "");
  }

  function formatFirefoxContentEditableHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\r\n?|\n/g, "<br>");
  }

  function dispatchBeforeInputPasteEvent(element, text) {
    try {
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertFromPaste",
        data: text
      }));
    } catch {
      element.dispatchEvent(new Event("beforeinput", { bubbles: true, cancelable: true }));
    }
  }

  function dispatchClipboardPasteEvent(element, text) {
    let clipboardData = null;
    try {
      clipboardData = new DataTransfer();
      clipboardData.setData("text/plain", text);
    } catch (_error) {
      return;
    }

    try {
      element.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData
      }));
    } catch (_error) {
      // Some browsers ignore synthetic clipboard payloads. execCommand fallback follows.
    }
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
    const samples = getVerificationSamples(text);
    const actual = normalizeVerificationText(getElementText(element));
    return samples.some((sample) => actual.includes(sample));
  }

  function getVerificationSamples(text) {
    const expected = normalizeVerificationText(text);
    const samples = [
      expected.slice(0, Math.min(24, expected.length)),
      expected.replace(/^[^a-z0-9]+/i, "").slice(0, 24)
    ];

    ["CONTEXT CARRY", "WHO I AM", "WHAT WE WERE DOING"].forEach((anchor) => {
      if (expected.includes(anchor)) samples.push(anchor);
    });

    return [...new Set(samples.filter((sample) => sample && sample.length >= 8))];
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
      `#${CLAUDE_LIMIT_NUDGE_ID}`,
      `#${DESTINATION_SHEET_ID}`,
      "#context-generator-styles",
      "#context-generator-error-overlay",
      "#context-generator-fallback-modal",
      "[data-context-generator-owned='true']"
    ].join(",")).forEach((node) => node.remove());

    return cleanText(clone.innerText || clone.textContent || "");
  }

  function scrapeConversationText() {
    const messageTurns = getConversationTurns();
    return createConversationCaptureFromMessageTurns(messageTurns);
  }

  async function scrapeConversationTextForTransfer() {
    const initialMessageTurns = getConversationTurns();
    const initialCapture = createConversationCaptureFromMessageTurns(initialMessageTurns);
    // Every chat enters the same capture loop. The loop itself decides when it is done from
    // real scroll movement, rendered-window changes, and bounded terminal quiet checks.
    return scrapeVirtualConversation(initialCapture, initialMessageTurns);
  }

  function createConversationCaptureFromMessageTurns(messageTurns, metrics = {}) {
    if (messageTurns.length === 0) {
      throw new Error(NO_CONVERSATION_ERROR_MESSAGE);
    }

    const usefulTurns = messageTurns.filter((turn) => isUsefulConversationTurn(turn));
    if (
      usefulTurns.length === 0 &&
      messageTurns.some(hasExplicitConversationRole) &&
      messageTurns.every((turn) => isEmptyConversationText(turn.text))
    ) {
      throw new Error(NO_CONVERSATION_ERROR_MESSAGE);
    }
    const turns = removeExactDuplicateConversationTurns(usefulTurns);
    const baseMetrics = {
      ...metrics,
      candidateTurnCount: messageTurns.length,
      messageTurnCount: usefulTurns.length,
      usefulTurnCount: turns.length,
      rawCandidateChars: messageTurns.reduce((total, turn) => total + turn.text.length, 0)
    };
    const transcript = turns
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join("\n\n")
      .trim();

    if (transcript && isUsefulConversationTranscript(turns)) {
      return createConversationCapture(`${currentPlatform.name} conversation:\n\n${transcript}`, {
        ...baseMetrics,
        method: baseMetrics.method || "structured",
        transcriptChars: transcript.length
      });
    }

    throw new Error("Chat messages were found, but their user/assistant roles could not be verified. Try again in a moment.");
  }

  async function scrapeVirtualConversation(initialCapture, initialMessageTurns) {
    const initialMetrics = lastConversationCaptureMetrics || {};
    const collectedTurns = [];
    const sweepStartedAt = Date.now();
    let scrolls = 0;
    let staleScrolls = 0;
    let totalStaleScrolls = 0;
    let terminalQuietChecks = 0;
    let exitReason = "other";
    let useLargerOverlapStep = false;

    logVirtualSweep("start", {
      initialRenderedTurnCount: initialMetrics.messageTurnCount || 0,
      ...getVirtualSweepScrollLogState()
    });

    while (true) {
      const expandedCount = await expandCollapsedConversationContent();
      if (expandedCount > 0) {
        await waitForConversationWindowToSettle(Math.min(600, VIRTUAL_SWEEP_SETTLE_MS));
      }

      const renderedSnapshot = getRenderedConversationSnapshot();
      const added = collectRenderedConversationTurns(collectedTurns, renderedSnapshot.turns);
      if (scrolls >= VIRTUAL_SWEEP_MAX_SCROLLS) {
        exitReason = "max-advances-reached";
        break;
      }

      const beforeWindowSignature = renderedSnapshot.signature;
      let afterWindowSignature = beforeWindowSignature;
      let afterRenderedSnapshot = renderedSnapshot;
      let triedBoundaryAdvance = false;
      let pixelMoved = false;
      let settleMs = 0;
      const stepNumber = scrolls + 1;
      const beforeScrollState = getVirtualSweepScrollLogState();
      const stepRatio = getVirtualSweepStepRatio(useLargerOverlapStep);
      const step = Math.round(getSourceViewportHeight() * stepRatio);

      pixelMoved = scrollSourceConversationByInstantly(step);
      if (pixelMoved) {
        const settleStartedAt = Date.now();
        // This minimum stability window is intentional. Signature changes can happen synchronously after a
        // scroll, but the real page still needs time to mount and finish rendering the new virtualized window.
        afterRenderedSnapshot = await waitForConversationWindowToSettle();
        settleMs += Date.now() - settleStartedAt;
        afterWindowSignature = afterRenderedSnapshot.signature;
      }

      scrolls += 1;

      if (!pixelMoved && afterWindowSignature === beforeWindowSignature) {
        triedBoundaryAdvance = scrollRenderedConversationBoundaryIntoView(renderedSnapshot.anchor);
        if (triedBoundaryAdvance) {
          const settleStartedAt = Date.now();
          afterRenderedSnapshot = await waitForConversationWindowToSettle();
          settleMs += Date.now() - settleStartedAt;
          afterWindowSignature = afterRenderedSnapshot.signature;
        }
      }

      if (afterWindowSignature === beforeWindowSignature && !pixelMoved) {
        const quietStartedAt = Date.now();
        afterRenderedSnapshot = await waitForRenderedConversationWindowChange(
          beforeWindowSignature,
          getVirtualSweepTerminalQuietTimeout()
        );
        afterWindowSignature = afterRenderedSnapshot.signature;
        settleMs += Date.now() - quietStartedAt;
        if (afterWindowSignature === beforeWindowSignature && !pixelMoved) {
          terminalQuietChecks += 1;
          exitReason = triedBoundaryAdvance ? "quiet-check-passed" : "no-scroll-movement";
          const afterScrollState = getVirtualSweepScrollLogState();
          reportHandoffCaptureProgress(afterScrollState);
          logVirtualSweep("step", {
            step: stepNumber,
            advancement: triedBoundaryAdvance ? "boundary" : "none",
            pixelMoved,
            windowChanged: false,
            addedTurnCount: added,
            collectedTurnCount: collectedTurns.length,
            detectedTurnCount: afterRenderedSnapshot.turns.length,
            staleScrolls,
            settleMs,
            beforeScrollTop: beforeScrollState.scrollTop,
            ...afterScrollState
          });
          break;
        }
      }

      const windowChanged = afterWindowSignature !== beforeWindowSignature;
      if (windowChanged) {
        useLargerOverlapStep = hasSafeOrderedConversationWindowOverlap(
          renderedSnapshot.turns,
          afterRenderedSnapshot.turns
        );
      } else {
        useLargerOverlapStep = false;
      }
      // Any platform can keep the same turn mounted while traversing one response taller than the viewport.
      // Successful physical movement is real progress even when the rendered turn signature is unchanged.
      if (!windowChanged && added === 0 && !pixelMoved) {
        staleScrolls += 1;
        totalStaleScrolls += 1;
        if (staleScrolls >= getVirtualSweepStaleScrollLimit()) {
          exitReason = "stale-limit-hit";
        }
      } else {
        staleScrolls = 0;
      }

      const afterScrollState = getVirtualSweepScrollLogState();
      reportHandoffCaptureProgress(afterScrollState);
      logVirtualSweep("step", {
        step: stepNumber,
        advancement: pixelMoved ? "pixel" : (triedBoundaryAdvance ? "boundary" : "none"),
        pixelMoved,
        windowChanged,
        addedTurnCount: added,
        collectedTurnCount: collectedTurns.length,
        detectedTurnCount: afterRenderedSnapshot.turns.length,
        staleScrolls,
        settleMs,
        stepPixels: step,
        stepRatio,
        nextStepRatio: getVirtualSweepStepRatio(useLargerOverlapStep),
        beforeScrollTop: beforeScrollState.scrollTop,
        ...afterScrollState
      });

      if (exitReason === "stale-limit-hit") break;
    }

    const sweptTurns = collectedTurns;
    const sweepMetrics = {
      sweepAttempted: true,
      sweepScrolls: scrolls,
      sweepTurnCount: sweptTurns.length,
      sweepMs: Date.now() - sweepStartedAt,
      sweepStaleScrolls: totalStaleScrolls,
      sweepTerminalQuietChecks: terminalQuietChecks,
      initialRenderedTurnCount: initialMetrics.messageTurnCount || null,
      initialRawCandidateChars: initialMetrics.rawCandidateChars || null
    };
    logVirtualSweep("exit", {
      reason: exitReason,
      scrolls,
      collectedTurnCount: sweptTurns.length,
      staleScrolls: totalStaleScrolls,
      terminalQuietChecks,
      elapsedMs: sweepMetrics.sweepMs,
      ...getVirtualSweepScrollLogState()
    });
    const initialTurns = getComparableConversationTurns(initialMessageTurns);
    const preferredTurns = chooseMoreCompleteConversationTurns(initialTurns, sweptTurns);
    if (areConversationTurnListsIdentical(preferredTurns, initialTurns)) {
      lastConversationCaptureMetrics = {
        ...initialMetrics,
        ...sweepMetrics
      };
      return initialCapture;
    }

    return createConversationCaptureFromMessageTurns(preferredTurns, {
      method: "sweep",
      ...sweepMetrics
    });
  }

  function getComparableConversationTurns(messageTurns = []) {
    const usefulTurns = messageTurns
      .filter((turn) => isUsefulConversationTurn(turn))
      .map((turn) => ({ role: turn.role, text: cleanText(turn.text) }));
    return removeExactDuplicateConversationTurns(usefulTurns);
  }

  function chooseMoreCompleteConversationTurns(initialTurns, sweptTurns) {
    // Start with the exact turns used by the quick capture, then apply the existing sequence alignment.
    // Matched turns are only replaced when the swept text is longer, so the final choice cannot downgrade text.
    const preferredTurns = initialTurns.map((turn) => ({ ...turn }));
    collectRenderedConversationTurns(preferredTurns, getComparableConversationTurns(sweptTurns));
    return preferredTurns;
  }

  function areConversationTurnListsIdentical(first, second) {
    return (
      first.length === second.length &&
      first.every((turn, index) => (
        getConversationTurnSignature(turn.role, turn.text) ===
        getConversationTurnSignature(second[index]?.role, second[index]?.text)
      ))
    );
  }

  function collectRenderedConversationTurns(collectedTurns, renderedTurns = getRenderedConversationSnapshot().turns) {
    const normalizedTurns = renderedTurns.map((turn) => ({
      role: turn.role,
      text: cleanText(turn.text)
    }));
    if (!normalizedTurns.length) return 0;
    if (!collectedTurns.length) {
      collectedTurns.push(...normalizedTurns);
      return normalizedTurns.length;
    }

    const matches = getConversationSequenceMatches(collectedTurns, normalizedTurns);
    if (!matches.length) {
      const newTurns = getNovelConversationTurns(collectedTurns, normalizedTurns);
      collectedTurns.push(...newTurns);
      return newTurns.length;
    }

    let inserted = 0;
    let previousRenderedIndex = -1;
    let lastMatchedCollectedIndex = -1;

    for (const match of matches) {
      const unmatched = normalizedTurns.slice(previousRenderedIndex + 1, match.renderedIndex);
      const newTurns = getNovelConversationTurns(collectedTurns, unmatched);
      const insertAt = match.collectedIndex + inserted;
      if (newTurns.length) {
        collectedTurns.splice(insertAt, 0, ...newTurns);
        inserted += newTurns.length;
      }

      const collectedTurn = collectedTurns[match.collectedIndex + inserted];
      const renderedTurn = normalizedTurns[match.renderedIndex];
      if (renderedTurn.text.length > collectedTurn.text.length) {
        collectedTurn.text = renderedTurn.text;
      }

      previousRenderedIndex = match.renderedIndex;
      lastMatchedCollectedIndex = match.collectedIndex + inserted;
    }

    const trailing = normalizedTurns.slice(previousRenderedIndex + 1);
    const trailingNewTurns = getNovelConversationTurns(collectedTurns, trailing);
    if (trailingNewTurns.length) {
      collectedTurns.splice(lastMatchedCollectedIndex + 1, 0, ...trailingNewTurns);
      inserted += trailingNewTurns.length;
    }

    return inserted;
  }

  function getConversationSequenceMatches(collectedTurns, renderedTurns) {
    // Virtualized snapshots can repeat interior blocks around a newly rendered
    // turn. LCS supplies ordered anchors across the whole accumulated sequence.
    const collectedLength = collectedTurns.length;
    const renderedLength = renderedTurns.length;
    const lengths = Array.from(
      { length: collectedLength + 1 },
      () => new Uint32Array(renderedLength + 1)
    );

    for (let collectedIndex = 1; collectedIndex <= collectedLength; collectedIndex += 1) {
      for (let renderedIndex = 1; renderedIndex <= renderedLength; renderedIndex += 1) {
        if (areConversationTurnSnapshotsCompatible(
          collectedTurns[collectedIndex - 1],
          renderedTurns[renderedIndex - 1]
        )) {
          lengths[collectedIndex][renderedIndex] = lengths[collectedIndex - 1][renderedIndex - 1] + 1;
        } else {
          lengths[collectedIndex][renderedIndex] = Math.max(
            lengths[collectedIndex - 1][renderedIndex],
            lengths[collectedIndex][renderedIndex - 1]
          );
        }
      }
    }

    const matches = [];
    let collectedIndex = collectedLength;
    let renderedIndex = renderedLength;
    while (collectedIndex > 0 && renderedIndex > 0) {
      if (
        areConversationTurnSnapshotsCompatible(
          collectedTurns[collectedIndex - 1],
          renderedTurns[renderedIndex - 1]
        ) &&
        lengths[collectedIndex][renderedIndex] === lengths[collectedIndex - 1][renderedIndex - 1] + 1
      ) {
        matches.push({
          collectedIndex: collectedIndex - 1,
          renderedIndex: renderedIndex - 1
        });
        collectedIndex -= 1;
        renderedIndex -= 1;
      } else if (lengths[collectedIndex - 1][renderedIndex] >= lengths[collectedIndex][renderedIndex - 1]) {
        collectedIndex -= 1;
      } else {
        renderedIndex -= 1;
      }
    }

    return matches.reverse();
  }

  function getNovelConversationTurns(collectedTurns, renderedTurns) {
    const existingSignatures = new Set(
      collectedTurns.map((turn) => getConversationTurnSignature(turn.role, turn.text))
    );
    return renderedTurns.filter((turn) => {
      const signature = getConversationTurnSignature(turn.role, turn.text);
      if (existingSignatures.has(signature)) return false;
      existingSignatures.add(signature);
      return true;
    });
  }

  function areConversationTurnSnapshotsCompatible(first, second) {
    if ((first?.role || "Message") !== (second?.role || "Message")) return false;

    const firstText = cleanText(first?.text || "");
    const secondText = cleanText(second?.text || "");
    if (firstText === secondText) return true;

    const shorter = firstText.length <= secondText.length ? firstText : secondText;
    const longer = firstText.length <= secondText.length ? secondText : firstText;
    return shorter.length >= 24 && containsWholeRenderedTurn(longer, shorter);
  }

  function containsWholeRenderedTurn(longer, shorter) {
    let matchIndex = longer.indexOf(shorter);
    while (matchIndex >= 0) {
      const before = matchIndex > 0 ? longer[matchIndex - 1] : "";
      const afterIndex = matchIndex + shorter.length;
      const after = afterIndex < longer.length ? longer[afterIndex] : "";
      if ((!before || !/[\p{L}\p{N}]/u.test(before)) && (!after || !/[\p{L}\p{N}]/u.test(after))) {
        return true;
      }
      matchIndex = longer.indexOf(shorter, matchIndex + 1);
    }
    return false;
  }

  function getVirtualSweepStepRatio(useLargerOverlapStep = false) {
    return useLargerOverlapStep ? VIRTUAL_SWEEP_OVERLAP_STEP_RATIO : VIRTUAL_SWEEP_STEP_RATIO;
  }

  function hasSafeOrderedConversationWindowOverlap(beforeTurns, afterTurns) {
    const comparisonLength = Math.min(beforeTurns.length, afterTurns.length);
    if (comparisonLength < 2) return false;

    const matches = getConversationSequenceMatches(beforeTurns, afterTurns);
    const hasPositionalShift = matches.some((match) => match.collectedIndex !== match.renderedIndex);
    return (
      hasPositionalShift &&
      matches.length / comparisonLength >= VIRTUAL_SWEEP_MIN_ORDERED_OVERLAP_RATIO
    );
  }

  function getVirtualSweepStaleScrollLimit() {
    return currentPlatform.id === "claude" ? CLAUDE_VIRTUAL_SWEEP_STALE_SCROLLS : VIRTUAL_SWEEP_STALE_SCROLLS;
  }

  function getVirtualSweepTerminalQuietTimeout() {
    return currentPlatform.id === "claude"
      ? CLAUDE_VIRTUAL_SWEEP_SLOW_CHANGE_TIMEOUT_MS
      : VIRTUAL_SWEEP_SLOW_CHANGE_TIMEOUT_MS;
  }

  function getVirtualSweepScrollLogState() {
    const state = getSourceScrollState();
    return {
      scrollTop: Math.round(state.scrollTop),
      scrollHeight: Math.round(state.scrollHeight),
      clientHeight: Math.round(state.clientHeight),
      scrollRemaining: Math.round(getSourceScrollRemaining())
    };
  }

  function logVirtualSweep(event, detail = {}) {
    if (!VIRTUAL_SWEEP_DEBUG_LOGGING || window.__CONTEXT_GENERATOR_TEST_HOOKS__) return;
    console.info("[Context Generator Sweep]", {
      event,
      platform: currentPlatform.id,
      ...detail
    });
  }

  async function waitForRenderedConversationWindowChange(previousSignature, timeoutMs) {
    const startedAt = Date.now();
    let nextSnapshot = getRenderedConversationSnapshot();
    if (nextSnapshot.signature !== previousSignature) return nextSnapshot;

    while (Date.now() - startedAt < timeoutMs) {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      await delay(Math.min(VIRTUAL_SWEEP_CHANGE_POLL_MS, Math.max(0, remainingMs)));
      nextSnapshot = getRenderedConversationSnapshot();
      if (nextSnapshot.signature !== previousSignature) return nextSnapshot;
    }

    return nextSnapshot;
  }

  function scrollRenderedConversationBoundaryIntoView(anchor = getRenderedConversationSnapshot().anchor) {
    if (!anchor?.scrollIntoView) return false;

    try {
      anchor.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
    } catch {
      try {
        anchor.scrollIntoView(false);
      } catch {
        return false;
      }
    }
    return true;
  }

  function getRenderedConversationSnapshot() {
    const turns = getConversationTurns()
      .filter((turn) => isDetectedConversationMessage(turn))
      .map((turn) => ({ ...turn, text: cleanText(turn.text) }));

    return {
      turns,
      anchor: turns[turns.length - 1]?.element || null,
      signature: turns
        .map((turn) => getConversationTurnSignature(turn.role, turn.text))
        .join("\u0002")
    };
  }

  function getConversationTurnSignature(role, text) {
    return `${role || "Message"}\u0001${text || ""}`;
  }

  function removeExactDuplicateConversationTurns(turns) {
    // This is deliberately independent of snapshot merging: no exact role+text
    // duplicate is allowed into the serialized backend payload.
    const seen = new Set();
    return turns.filter((turn) => {
      const signature = getConversationTurnSignature(turn.role, cleanText(turn.text));
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
  }

  function createConversationCapture(text, metrics = {}) {
    const cleaned = cleanText(text);
    lastConversationCaptureMetrics = {
      ...metrics,
      cleanedChars: cleaned.length,
      sentChars: cleaned.length,
      capped: false,
      capChars: null
    };
    return cleaned;
  }

  function getConversationCaptureMetrics(conversationText) {
    if (lastConversationCaptureMetrics?.sentChars === conversationText.length) {
      return lastConversationCaptureMetrics;
    }

    return {
      method: "unknown",
      messageTurnCount: null,
      usefulTurnCount: null,
      rawCandidateChars: null,
      transcriptChars: null,
      cleanedChars: conversationText.length,
      sentChars: conversationText.length,
      capped: false,
      capChars: null
    };
  }

  async function scrapeConversationTextWhenReady(timeoutMs = CONVERSATION_SCRAPE_RETRY_TIMEOUT_MS) {
    const startedAt = Date.now();
    let lastEmptyError = null;

    while (Date.now() - startedAt <= timeoutMs) {
      try {
        return await scrapeConversationTextForTransfer();
      } catch (error) {
        if (!isNoConversationError(error)) throw error;
        lastEmptyError = error;
      }

      const remainingMs = timeoutMs - (Date.now() - startedAt);
      if (remainingMs <= 0) break;
      await waitForConversationContentSignal(Math.min(CONVERSATION_SCRAPE_RETRY_INTERVAL_MS, remainingMs));
    }

    throw lastEmptyError || new Error(NO_CONVERSATION_ERROR_MESSAGE);
  }

  function isNoConversationError(error) {
    return error?.message === NO_CONVERSATION_ERROR_MESSAGE;
  }

  function waitForConversationContentSignal(timeoutMs) {
    const root = document.body || document.documentElement;
    if (!root || typeof MutationObserver === "undefined") return delay(timeoutMs);

    return new Promise((resolve) => {
      let observer = null;
      let timer = null;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        observer?.disconnect();
        resolve();
      };

      timer = setTimeout(finish, timeoutMs);
      observer = new MutationObserver((mutations) => {
        if (mutations.every(isOwnDomMutation)) return;
        if (mutations.some(hasConversationMutationSignal)) finish();
      });
      observer.observe(root, { childList: true, subtree: true, characterData: true });
    });
  }

  function hasConversationMutationSignal(mutation) {
    if (mutation.type === "characterData") {
      return isPotentialConversationNode(mutation.target?.parentElement);
    }

    return [mutation.target, ...mutation.addedNodes]
      .some((node) => isPotentialConversationNode(node));
  }

  function isPotentialConversationNode(node) {
    if (!(node instanceof Element) || isContextGeneratorNode(node)) return false;
    const selectors = getConversationReadinessSelectors();
    return Boolean(node.matches?.(selectors) || node.closest?.(selectors));
  }

  function getConversationReadinessSelectors() {
    return [
      ...currentPlatform.conversationSelectors,
      ...GENERIC_CONVERSATION_SELECTORS,
      ...FALLBACK_CONVERSATION_ROOT_SELECTORS
    ].join(",");
  }

  function getConversationTurns() {
    const selectors = [...currentPlatform.conversationSelectors, ...GENERIC_CONVERSATION_SELECTORS];
    const candidates = [];
    const platformInput = findPlatformInput();

    document.querySelectorAll([...new Set(selectors)].join(",")).forEach((element) => {
      if (!isConversationCandidateElement(element, platformInput)) return;

      const text = getCleanVisibleText(element);
      if (!text || text.length < 2) return;

      candidates.push({
        element,
        role: getConversationRole(element),
        text
      });
    });

    const containmentMap = buildConversationCandidateContainmentMap(candidates);
    const messageCandidates = candidates.filter((candidate) => (
      !isBroadConversationWrapperCandidate(candidate, containmentMap)
    ));

    messageCandidates.sort((a, b) => {
      if (a.element === b.element) return 0;
      return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
    });

    let turns = [];
    messageCandidates.forEach((candidate) => {
      const containingTurn = turns.find((turn) => containmentMap.contains(turn, candidate));
      if (containingTurn) {
        if (!isConversationCandidatePreferred(candidate, containingTurn, containmentMap)) {
          return;
        }
        turns = turns.filter((turn) => turn !== containingTurn);
      }

      const containedTurns = turns.filter((turn) => containmentMap.contains(candidate, turn));
      if (containedTurns.length && shouldKeepContainedConversationTurns(candidate, containedTurns, containmentMap)) {
        return;
      }

      turns = turns.filter((turn) => !containmentMap.contains(candidate, turn));
      turns.push(candidate);
    });

    return turns.map(({ element, role, text }) => ({ element, role, text }));
  }

  function buildConversationCandidateContainmentMap(candidates) {
    const candidateByElement = new Map(candidates.map((candidate) => [candidate.element, candidate]));
    const parentByCandidate = new Map();
    const childrenByCandidate = new Map(candidates.map((candidate) => [candidate, []]));

    // Walk each candidate's DOM ancestry once to find its nearest candidate parent.
    // All later containment decisions use the derived lookup tables instead of
    // rechecking every candidate pair with Element.contains().
    candidates.forEach((candidate) => {
      let parentElement = candidate.element.parentElement;
      while (parentElement && !candidateByElement.has(parentElement)) {
        parentElement = parentElement.parentElement;
      }

      const parentCandidate = candidateByElement.get(parentElement);
      if (!parentCandidate) return;
      parentByCandidate.set(candidate, parentCandidate);
      childrenByCandidate.get(parentCandidate).push(candidate);
    });

    const ancestorsByCandidate = new Map();
    const descendantsByCandidate = new Map();
    const indexCandidateTree = (candidate, ancestors) => {
      ancestorsByCandidate.set(candidate, new Set(ancestors));
      const descendants = [];
      childrenByCandidate.get(candidate).forEach((child) => {
        indexCandidateTree(child, [...ancestors, candidate]);
        descendants.push(child, ...descendantsByCandidate.get(child));
      });
      descendantsByCandidate.set(candidate, descendants);
    };

    candidates
      .filter((candidate) => !parentByCandidate.has(candidate))
      .forEach((candidate) => indexCandidateTree(candidate, []));

    return {
      contains(parent, child) {
        return parent !== child && Boolean(ancestorsByCandidate.get(child)?.has(parent));
      },
      getDescendants(candidate) {
        return descendantsByCandidate.get(candidate) || [];
      }
    };
  }

  function isBroadConversationWrapperCandidate(candidate, containmentMap) {
    const nestedCandidates = getNestedConversationCandidates(candidate, containmentMap);
    if (nestedCandidates.length < 2) return false;
    if (isSingleRoleClaudeMessageWrapper(candidate, nestedCandidates)) return false;

    const explicitNestedCandidates = nestedCandidates.filter(hasExplicitConversationRole);
    const explicitNestedCount = explicitNestedCandidates.length;
    const nestedRoles = new Set(explicitNestedCandidates.map((nested) => nested.role));
    const candidateHasExplicitRole = hasExplicitConversationRole(candidate);
    const containsMixedNestedRoles = nestedRoles.size > 1;
    const containsDifferentNestedRole = candidateHasExplicitRole && nestedRoles.size > 0 && !nestedRoles.has(candidate.role);
    const nestedChars = nestedCandidates.reduce((total, nested) => total + nested.text.length, 0);
    const nestedCoverage = candidate.text.length ? nestedChars / candidate.text.length : 0;

    if (
      explicitNestedCount >= 2 &&
      (!candidateHasExplicitRole || containsMixedNestedRoles || containsDifferentNestedRole)
    ) {
      return true;
    }

    if (candidateHasExplicitRole && explicitNestedCount >= 6 && nestedCoverage >= 0.75) {
      return true;
    }

    return isGenericConversationContainer(candidate.element) && nestedCoverage >= 0.45;
  }

  function getNestedConversationCandidates(candidate, containmentMap) {
    const seenTexts = new Set();
    return containmentMap.getDescendants(candidate).filter((other) => {
      if (!other.text || other.text.length < 3 || other.text === candidate.text) return false;
      if (seenTexts.has(other.text)) return false;
      seenTexts.add(other.text);
      return true;
    });
  }

  function isGenericConversationContainer(element) {
    const label = getElementLabel(element);
    return /\b(?:main|conversation|conversations|thread|threads|chat|chats|messages|message-list|list|feed|transcript|scroll)\b/.test(label);
  }

  function shouldKeepContainedConversationTurns(candidate, containedTurns, containmentMap) {
    if (isBroadConversationWrapperCandidate(candidate, containmentMap)) return true;
    if (!hasExplicitConversationRole(candidate) && containedTurns.some(hasExplicitConversationRole)) return true;
    if (!hasExplicitConversationRole(candidate) && containedTurns.length >= 2) return true;
    return false;
  }

  function isConversationCandidatePreferred(candidate, existing, containmentMap) {
    if (
      containmentMap.contains(existing, candidate) &&
      isSingleRoleClaudeMessageWrapper(existing, getNestedConversationCandidates(existing, containmentMap))
    ) {
      return false;
    }

    if (
      isBroadConversationWrapperCandidate(existing, containmentMap) &&
      !isBroadConversationWrapperCandidate(candidate, containmentMap)
    ) {
      return true;
    }

    const candidateScore = getConversationCandidateScore(candidate, containmentMap);
    const existingScore = getConversationCandidateScore(existing, containmentMap);
    return candidateScore > existingScore;
  }

  function getConversationCandidateScore(candidate, containmentMap) {
    let score = 0;
    if (hasExplicitConversationRole(candidate)) score += 40;
    if (!isGenericConversationContainer(candidate.element)) score += 12;
    if (isBroadConversationWrapperCandidate(candidate, containmentMap)) score -= 35;
    score -= Math.min(20, getNestedConversationCandidates(candidate, containmentMap).length * 4);
    return score;
  }

  function isSingleRoleClaudeMessageWrapper(candidate, nestedCandidates) {
    if (currentPlatform.id !== "claude" || !hasExplicitConversationRole(candidate)) return false;

    const testId = cleanText(
      candidate.element.getAttribute?.("data-testid") ||
      candidate.element.getAttribute?.("data-test-id") ||
      ""
    ).toLowerCase();
    if (!/^(?:user|assistant)[-_ ]?message$/.test(testId)) return false;

    // Claude's message boundary owns its rendered Markdown fragments. Descendants
    // inherit the same role, but they are paragraphs/code blocks, not chat turns.
    const explicitNestedCandidates = nestedCandidates.filter(hasExplicitConversationRole);
    if (!explicitNestedCandidates.length) return false;
    if (explicitNestedCandidates.some((nested) => nested.role !== candidate.role)) return false;
    return true;
  }

  function getConversationRole(element) {
    let node = element;
    let depth = 0;

    while (node && depth < 8) {
      const authorRole = cleanText(node.getAttribute?.("data-message-author-role") || "").toLowerCase();
      const dataRole = cleanText(node.getAttribute?.("data-role") || "").toLowerCase();
      if (["user", "human"].includes(authorRole) || ["user", "human"].includes(dataRole)) return "User";
      if (["assistant", "model", "bot"].includes(authorRole) || ["assistant", "model", "bot"].includes(dataRole)) {
        return currentPlatform.name;
      }

      if (matchesAnyConversationRoleSelector(node, currentPlatform.userRoleSelectors)) return "User";
      if (matchesAnyConversationRoleSelector(node, currentPlatform.assistantRoleSelectors)) return currentPlatform.name;

      const semanticLabel = [
        node.getAttribute?.("data-testid"),
        node.getAttribute?.("data-test-id"),
        node.getAttribute?.("aria-label"),
        node.localName,
        node.id,
        node.className
      ].filter(Boolean).join(" ").toLowerCase();

      if (/\b(?:user|human|query|prompt)\b/.test(semanticLabel)) return "User";
      if (/\b(?:assistant|model|response|bot|claude|chatgpt|gemini|grok|deepseek)\b/.test(semanticLabel)) {
        return currentPlatform.name;
      }

      node = node.parentElement;
      depth += 1;
    }
    return "Message";
  }

  function matchesAnyConversationRoleSelector(element, selectors = []) {
    return selectors.some((selector) => element.matches?.(selector));
  }

  function isUsefulConversationTranscript(turns) {
    if (!turns.length) return false;
    if (turns.some(hasExplicitConversationRole)) return true;
    if (turns.length < 2) return false;

    return !isEmptyConversationText(turns.map((turn) => turn.text).join("\n\n"));
  }

  function hasExplicitConversationRole(turn) {
    return turn?.role === "User" || turn?.role === currentPlatform.name;
  }

  function isUsefulConversationTurn(turn) {
    if (!turn?.text) return false;

    const text = cleanText(turn.text);
    if (text.length < 3) return false;
    return hasExplicitConversationRole(turn) && !isEmptyConversationText(text);
  }

  function isDetectedConversationMessage(turn) {
    if (!turn?.text) return false;

    const text = cleanText(turn.text);
    if (text.length < 3) return false;
    return hasExplicitConversationRole(turn) && !isEmptyConversationText(text);
  }

  function isEmptyConversationText(text) {
    const cleaned = cleanText(text).toLowerCase().replace(/\u2019/g, "'");
    if (!cleaned) return true;

    return EMPTY_START_SCREEN_TEXTS.some((emptyText) => cleaned.includes(emptyText) && cleaned.length < 900);
  }

  function isConversationCandidateElement(element, platformInput = null) {
    if (!element || isContextGeneratorNode(element) || !isVisible(element)) return false;
    if (element.matches("input, textarea, button, select, [role='button'], [contenteditable='true']")) return false;
    // Animated composer prompts can live in message-shaped wrappers or child spans.
    // Neither the active input nor any DOM that owns/belongs to it is conversation history.
    if (
      platformInput &&
      (element === platformInput || element.contains(platformInput) || platformInput.contains(element))
    ) {
      return false;
    }
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

  function ensureFloatingButton() {
    const input = findPlatformInput();
    const existingBubble = document.getElementById(BUBBLE_ID);

    if (!input) {
      if (existingBubble) existingBubble.style.display = "none";
      hideOnboardingNudge();
      hideClaudeLimitNudge();
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
      dismissClaudeLimitNudge();
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

      #${ONBOARDING_ID} {
        position: fixed;
        z-index: 2147483646;
        width: min(286px, calc(100vw - 28px));
        box-sizing: border-box;
        display: none;
        align-items: center;
        gap: 9px;
        min-height: 106px;
        padding: 10px 38px 10px 11px;
        border-radius: 18px;
        border: 1px solid rgba(255,255,255,0.13);
        background: linear-gradient(145deg, #101010 0%, #15151d 62%, #080808 100%);
        color: #ffffff;
        box-shadow: 0 18px 42px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.08);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        animation: contextGeneratorOnboardingIn 0.22s cubic-bezier(0.16, 1, 0.3, 1) both;
      }

      @keyframes contextGeneratorPuppetFloat {
        0%, 100% {
          transform: translate3d(0, 0, 0) rotate(-1deg);
        }
        50% {
          transform: translate3d(0, -3px, 0) rotate(1deg);
        }
      }

      @keyframes contextGeneratorPuppetPoint {
        0%, 100% {
          transform: rotate(-12deg) translate3d(0, 0, 0);
        }
        50% {
          transform: rotate(-5deg) translate3d(5px, -1px, 0);
        }
      }

      @keyframes contextGeneratorPuppetWave {
        0%, 100% {
          transform: rotate(28deg);
        }
        50% {
          transform: rotate(34deg);
        }
      }

      @keyframes contextGeneratorPuppetBlink {
        0%, 88%, 92%, 100% {
          transform: scaleY(1);
        }
        90% {
          transform: scaleY(0.18);
        }
      }

      .context-generator-onboarding-puppet-wrap {
        position: relative;
        width: 82px;
        height: 96px;
        flex: 0 0 auto;
        transform-origin: 50% 82%;
      }

      #${ONBOARDING_ID}[data-context-generator-point="right"] .context-generator-onboarding-puppet-wrap {
        order: 2;
        margin-left: 2px;
      }

      #${ONBOARDING_ID}[data-context-generator-point="left"] .context-generator-onboarding-puppet-wrap {
        order: 0;
        margin-right: 2px;
        transform: scaleX(-1);
      }

      .context-generator-puppet {
        position: absolute;
        left: 3px;
        top: 1px;
        width: 78px;
        height: 92px;
        filter: drop-shadow(0 8px 12px rgba(0,0,0,0.22));
        animation: contextGeneratorPuppetFloat 2.15s ease-in-out infinite;
      }

      .context-generator-puppet-shadow {
        position: absolute;
        left: 16px;
        bottom: 0;
        width: 48px;
        height: 8px;
        border-radius: 999px;
        background: rgba(0,0,0,0.24);
        filter: blur(2px);
      }

      .context-generator-puppet-body {
        position: absolute;
        left: 25px;
        top: 44px;
        width: 31px;
        height: 34px;
        border-radius: 15px 15px 13px 13px;
        background: linear-gradient(145deg, #343640 0%, #191a20 68%, #0b0c11 100%);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.28), inset -6px -10px 14px rgba(0,0,0,0.26), 0 8px 16px rgba(0,0,0,0.2);
      }

      .context-generator-puppet-body::after {
        content: "";
        position: absolute;
        left: 13px;
        top: 5px;
        width: 6px;
        height: 21px;
        border-radius: 999px;
        background: linear-gradient(180deg, #7ff5d5, #26baa1);
        box-shadow: 0 0 10px rgba(75,240,203,0.18);
      }

      .context-generator-puppet-neck {
        position: absolute;
        left: 35px;
        top: 37px;
        width: 11px;
        height: 11px;
        border-radius: 0 0 8px 8px;
        background: linear-gradient(180deg, #f7c9aa, #e7a77f);
      }

      .context-generator-puppet-head {
        position: absolute;
        left: 18px;
        top: 7px;
        width: 44px;
        height: 38px;
        border-radius: 48% 52% 44% 46%;
        background: radial-gradient(circle at 32% 24%, rgba(255,255,255,0.78), transparent 16%), linear-gradient(145deg, #ffe2c9 0%, #f3b98f 100%);
        box-shadow: inset -6px -8px 12px rgba(147,78,47,0.14), inset 1px 1px 0 rgba(255,255,255,0.44), 0 6px 12px rgba(0,0,0,0.2);
      }

      .context-generator-puppet-hair {
        position: absolute;
        left: 2px;
        top: -5px;
        width: 39px;
        height: 18px;
        border-radius: 999px 999px 12px 10px;
        background: linear-gradient(145deg, #50525d 0%, #202128 48%, #0d0e13 100%);
        box-shadow: inset 6px 4px 7px rgba(255,255,255,0.08), inset -5px -5px 8px rgba(0,0,0,0.32);
        transform: rotate(-5deg);
      }

      .context-generator-puppet-hair::after {
        content: "";
        position: absolute;
        right: -4px;
        top: 8px;
        width: 13px;
        height: 15px;
        border-radius: 999px 999px 8px 999px;
        background: linear-gradient(145deg, #25262d, #0f1015);
        transform: rotate(18deg);
      }

      .context-generator-puppet-strand {
        position: absolute;
        top: 9px;
        width: 12px;
        height: 16px;
        border-radius: 999px 999px 4px 999px;
        background: linear-gradient(145deg, #383a43, #101116);
        transform-origin: 50% 0;
      }

      .context-generator-puppet-strand-one {
        left: 6px;
        transform: rotate(16deg);
      }

      .context-generator-puppet-strand-two {
        left: 18px;
        top: 8px;
        height: 15px;
        transform: rotate(-4deg);
      }

      .context-generator-puppet-strand-three {
        left: 29px;
        top: 9px;
        height: 13px;
        transform: rotate(-22deg);
      }

      .context-generator-puppet-eye {
        position: absolute;
        top: 18px;
        width: 5px;
        height: 6px;
        border-radius: 999px;
        background: radial-gradient(circle at 35% 28%, #ffffff 0 1.2px, #17171d 1.6px);
        transform-origin: 50% 50%;
        box-shadow: 0 1px 0 rgba(255,255,255,0.16);
        animation: contextGeneratorPuppetBlink 5.2s ease-in-out infinite;
      }

      .context-generator-puppet-eye-left {
        left: 13px;
      }

      .context-generator-puppet-eye-right {
        left: 27px;
      }

      .context-generator-puppet-brow {
        position: absolute;
        top: 14px;
        width: 9px;
        height: 2px;
        border-radius: 999px;
        background: rgba(31,26,25,0.54);
      }

      .context-generator-puppet-brow-left {
        left: 11px;
        transform: rotate(-9deg);
      }

      .context-generator-puppet-brow-right {
        left: 25px;
        transform: rotate(7deg);
      }

      .context-generator-puppet-cheek {
        position: absolute;
        top: 25px;
        width: 8px;
        height: 4px;
        border-radius: 999px;
        background: rgba(255,110,128,0.22);
      }

      .context-generator-puppet-cheek-left {
        left: 7px;
      }

      .context-generator-puppet-cheek-right {
        right: 7px;
      }

      .context-generator-puppet-smile {
        position: absolute;
        left: 16px;
        top: 27px;
        width: 12px;
        height: 6px;
        border-bottom: 2px solid rgba(23,23,29,0.72);
        border-radius: 0 0 999px 999px;
      }

      .context-generator-puppet-arm {
        position: absolute;
        height: 8px;
        border-radius: 999px;
        background: linear-gradient(90deg, #f0b58b, #ffe2c7 62%, #fff3e2);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.44), 0 3px 7px rgba(0,0,0,0.16);
      }

      .context-generator-puppet-arm-back {
        left: 9px;
        top: 57px;
        width: 29px;
        transform-origin: 27px 50%;
        transform: rotate(28deg);
        animation: contextGeneratorPuppetWave 1.7s ease-in-out infinite;
      }

      .context-generator-puppet-arm-point {
        left: 48px;
        top: 49px;
        width: 41px;
        transform-origin: 4px 50%;
        animation: contextGeneratorPuppetPoint 0.95s ease-in-out infinite;
      }

      .context-generator-puppet-hand {
        position: absolute;
        right: -5px;
        top: -3px;
        width: 13px;
        height: 13px;
        border-radius: 999px;
        background: radial-gradient(circle at 35% 30%, #ffffff, #ffe1c5 74%);
        box-shadow: inset -2px -2px 4px rgba(176,92,54,0.1);
      }

      .context-generator-puppet-finger {
        position: absolute;
        right: -13px;
        top: 3px;
        width: 18px;
        height: 5px;
        border-radius: 999px;
        background: linear-gradient(90deg, #ffe1c5, #fff4e7);
        box-shadow: 4px 0 9px rgba(255,255,255,0.18);
      }

      .context-generator-puppet-rest-hand {
        position: absolute;
        left: -5px;
        top: -3px;
        width: 12px;
        height: 12px;
        border-radius: 999px;
        background: radial-gradient(circle at 35% 30%, #ffffff, #ffe1c5 74%);
        box-shadow: inset -2px -2px 4px rgba(176,92,54,0.1);
      }

      .context-generator-puppet-leg {
        position: absolute;
        top: 74px;
        width: 8px;
        height: 15px;
        border-radius: 999px;
        background: linear-gradient(180deg, #22242c, #0f1015);
      }

      .context-generator-puppet-leg-left {
        left: 30px;
        transform: rotate(6deg);
      }

      .context-generator-puppet-leg-right {
        left: 44px;
        transform: rotate(-6deg);
      }

      .context-generator-puppet-shoe {
        position: absolute;
        left: -5px;
        bottom: -3px;
        width: 17px;
        height: 7px;
        border-radius: 999px 999px 7px 7px;
        background: linear-gradient(180deg, #3d4049, #111217);
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.16);
      }

      .context-generator-onboarding-copy {
        min-width: 0;
        flex: 1;
        order: 1;
      }

      .context-generator-onboarding-title {
        font-family: Georgia, 'Times New Roman', serif;
        font-size: 12.4px;
        font-weight: 600;
        line-height: 1.12;
        letter-spacing: 0;
        color: #ffffff;
        text-rendering: geometricPrecision;
        white-space: nowrap;
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
        position: absolute;
        right: 8px;
        top: 8px;
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
        .context-generator-puppet,
        .context-generator-puppet-arm,
        .context-generator-puppet-eye {
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

    const puppetWrap = document.createElement("div");
    puppetWrap.className = "context-generator-onboarding-puppet-wrap";
    puppetWrap.setAttribute("aria-hidden", "true");

    const puppet = document.createElement("div");
    puppet.className = "context-generator-puppet";

    const shadow = document.createElement("span");
    shadow.className = "context-generator-puppet-shadow";
    const backArm = document.createElement("span");
    backArm.className = "context-generator-puppet-arm context-generator-puppet-arm-back";
    const restHand = document.createElement("span");
    restHand.className = "context-generator-puppet-rest-hand";
    backArm.appendChild(restHand);
    const bodyShape = document.createElement("span");
    bodyShape.className = "context-generator-puppet-body";
    const neck = document.createElement("span");
    neck.className = "context-generator-puppet-neck";

    const head = document.createElement("span");
    head.className = "context-generator-puppet-head";
    [
      "context-generator-puppet-hair",
      "context-generator-puppet-strand context-generator-puppet-strand-one",
      "context-generator-puppet-strand context-generator-puppet-strand-two",
      "context-generator-puppet-strand context-generator-puppet-strand-three",
      "context-generator-puppet-brow context-generator-puppet-brow-left",
      "context-generator-puppet-brow context-generator-puppet-brow-right",
      "context-generator-puppet-eye context-generator-puppet-eye-left",
      "context-generator-puppet-eye context-generator-puppet-eye-right",
      "context-generator-puppet-cheek context-generator-puppet-cheek-left",
      "context-generator-puppet-cheek context-generator-puppet-cheek-right",
      "context-generator-puppet-smile"
    ].forEach((className) => {
      const part = document.createElement("span");
      part.className = className;
      head.appendChild(part);
    });

    const pointArm = document.createElement("span");
    pointArm.className = "context-generator-puppet-arm context-generator-puppet-arm-point";
    const hand = document.createElement("span");
    hand.className = "context-generator-puppet-hand";
    const finger = document.createElement("span");
    finger.className = "context-generator-puppet-finger";
    pointArm.appendChild(hand);
    pointArm.appendChild(finger);

    const leftLeg = document.createElement("span");
    leftLeg.className = "context-generator-puppet-leg context-generator-puppet-leg-left";
    const leftShoe = document.createElement("span");
    leftShoe.className = "context-generator-puppet-shoe";
    leftLeg.appendChild(leftShoe);

    const rightLeg = document.createElement("span");
    rightLeg.className = "context-generator-puppet-leg context-generator-puppet-leg-right";
    const rightShoe = document.createElement("span");
    rightShoe.className = "context-generator-puppet-shoe";
    rightLeg.appendChild(rightShoe);

    puppet.appendChild(shadow);
    puppet.appendChild(backArm);
    puppet.appendChild(leftLeg);
    puppet.appendChild(rightLeg);
    puppet.appendChild(bodyShape);
    puppet.appendChild(neck);
    puppet.appendChild(head);
    puppet.appendChild(pointArm);
    puppetWrap.appendChild(puppet);

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
    dismiss.setAttribute("aria-label", "Dismiss Cap-Context tip");
    dismiss.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dismissOnboardingNudge();
    });

    nudge.appendChild(puppetWrap);
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
    const nudgeWidth = Math.min(286, window.innerWidth - margin * 2);
    const nudgeHeight = nudge.offsetHeight || 106;
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

  function updateClaudeLimitNudge() {
    if (currentPlatform.id !== "claude" || isRunning || isDestinationSheetOpen()) {
      hideClaudeLimitNudge();
      return;
    }

    const bubble = document.getElementById(BUBBLE_ID);
    const claudeLimitVisible = isClaudeLimitVisible();
    if (!claudeLimitVisible) {
      claudeLimitNudgeDismissedUntilLimitClears = false;
    }

    if (
      !bubble ||
      bubble.style.display === "none" ||
      !isVisible(bubble) ||
      !claudeLimitVisible ||
      claudeLimitNudgeDismissedUntilLimitClears ||
      isClaudeComposerFocusTarget(document.activeElement)
    ) {
      if (claudeLimitVisible && isClaudeComposerFocusTarget(document.activeElement)) {
        dismissClaudeLimitNudge();
      }
      hideClaudeLimitNudge();
      return;
    }

    const nudge = document.getElementById(CLAUDE_LIMIT_NUDGE_ID) || createClaudeLimitNudge();
    const wasHidden = nudge.style.display === "none" || nudge.dataset.contextGeneratorVisible !== "true";
    nudge.style.display = "flex";
    positionClaudeLimitNudge(nudge, bubble);
    if (wasHidden) {
      nudge.dataset.contextGeneratorVisible = "true";
      nudge.style.opacity = "0";
      nudge.style.transform = nudge.dataset.contextGeneratorPoint === "right" ? "translate3d(8px,0,0)" : "translate3d(-8px,0,0)";
      requestAnimationFrame(() => {
        nudge.style.opacity = "1";
        nudge.style.transform = "translate3d(0,0,0)";
      });
    }
  }

  function createClaudeLimitNudge() {
    const nudge = document.createElement("button");
    nudge.id = CLAUDE_LIMIT_NUDGE_ID;
    nudge.type = "button";
    nudge.dataset.contextGeneratorOwned = "true";
    nudge.setAttribute("aria-label", CLAUDE_LIMIT_NUDGE_TEXT);
    nudge.style.cssText = [
      "display:none",
      "position:fixed",
      "z-index:2147483647",
      "width:min(306px,calc(100vw - 24px))",
      "box-sizing:border-box",
      "padding:13px 14px",
      "border:1px solid rgba(255,255,255,0.14)",
      "border-radius:16px",
      "background:linear-gradient(145deg,#121212 0%,#181820 58%,#0d0d12 100%)",
      "box-shadow:0 18px 42px rgba(0,0,0,0.34),inset 0 1px 0 rgba(255,255,255,0.07)",
      "color:#fff",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "font-size:13px",
      "font-weight:580",
      "line-height:1.38",
      "letter-spacing:0",
      "text-align:left",
      "cursor:pointer",
      "gap:7px",
      "flex-direction:column",
      "transition:opacity 220ms ease,transform 220ms ease",
      "overflow:visible"
    ].join(";");

    const tail = document.createElement("span");
    tail.dataset.contextGeneratorLimitTail = "true";
    tail.style.cssText = [
      "position:absolute",
      "width:12px",
      "height:12px",
      "background:#15151b",
      "border-top:1px solid rgba(255,255,255,0.14)",
      "border-right:1px solid rgba(255,255,255,0.14)",
      "transform:rotate(45deg)",
      "top:calc(50% - 6px)"
    ].join(";");

    const firstLine = document.createElement("span");
    firstLine.textContent = "Claude's brilliant. Claude's also broke by message 20.";
    firstLine.style.fontWeight = "760";

    const secondLine = document.createElement("span");
    secondLine.textContent = "We've got you covered. Tap to continue in another AI with context.";
    secondLine.style.color = "rgba(255,255,255,0.74)";

    nudge.appendChild(tail);
    nudge.appendChild(firstLine);
    nudge.appendChild(secondLine);
    nudge.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dismissClaudeLimitNudge();
      if (!isDestinationSheetOpen()) toggleDestinationSheet();
    });

    document.body.appendChild(nudge);
    return nudge;
  }

  function positionClaudeLimitNudge(nudge, bubble) {
    const bubbleRect = bubble.getBoundingClientRect();
    const margin = 12;
    const gap = 12;
    const nudgeWidth = Math.min(306, window.innerWidth - margin * 2);
    const nudgeHeight = nudge.offsetHeight || 92;
    const canSitLeft = bubbleRect.left - gap - nudgeWidth >= margin;
    const left = canSitLeft
      ? bubbleRect.left - gap - nudgeWidth
      : Math.min(window.innerWidth - nudgeWidth - margin, bubbleRect.right + gap);
    const top = Math.max(margin, Math.min(bubbleRect.top + bubbleRect.height / 2 - nudgeHeight / 2, window.innerHeight - nudgeHeight - margin));
    const tail = nudge.querySelector("[data-context-generator-limit-tail='true']");

    nudge.dataset.contextGeneratorPoint = canSitLeft ? "right" : "left";
    nudge.style.left = `${Math.round(left)}px`;
    nudge.style.top = `${Math.round(top)}px`;
    if (tail) {
      tail.style.right = canSitLeft ? "-6px" : "auto";
      tail.style.left = canSitLeft ? "auto" : "-6px";
    }
  }

  function hideClaudeLimitNudge() {
    const nudge = document.getElementById(CLAUDE_LIMIT_NUDGE_ID);
    if (!nudge) return;
    nudge.dataset.contextGeneratorVisible = "false";
    nudge.style.display = "none";
  }

  function dismissClaudeLimitNudge() {
    const nudge = document.getElementById(CLAUDE_LIMIT_NUDGE_ID);
    const nudgeVisible = nudge && nudge.style.display !== "none";
    if (currentPlatform.id === "claude" && (nudgeVisible || isClaudeLimitVisible())) {
      claudeLimitNudgeDismissedUntilLimitClears = true;
    }
    hideClaudeLimitNudge();
  }

  function isClaudeLimitVisible() {
    const selectors = [
      "[role='alert']",
      "[role='status']",
      "[aria-live]",
      "[data-testid*='limit' i]",
      "[data-testid*='error' i]",
      "[class*='limit' i]",
      "[class*='error' i]",
      "[class*='toast' i]",
      "[class*='banner' i]",
      "[class*='modal' i]",
      "[class*='popover' i]"
    ].join(",");

    return Array.from(document.querySelectorAll(selectors)).some((element) => {
      if (isContextGeneratorNode(element) || !isVisible(element)) return false;
      return isClaudeLimitText(element.innerText || element.textContent || "");
    });
  }

  function isClaudeLimitText(text) {
    const normalized = cleanText(text).toLowerCase();
    if (!normalized || normalized.length > 700) return false;

    return [
      /(?:message|usage|rate|conversation).{0,36}limit/,
      /limit.{0,36}(?:reached|reset|resets|later|tomorrow|messages|usage)/,
      /(?:reached|hit).{0,36}(?:message|usage|rate)?.{0,20}limit/,
      /out of.{0,36}(?:messages|usage|prompts)/,
      /(?:try again|come back).{0,36}(?:later|tomorrow)/,
      /(?:messages|usage).{0,36}(?:reset|resets|available)/
    ].some((pattern) => pattern.test(normalized));
  }

  function isClaudeComposerFocusTarget(target) {
    if (currentPlatform.id !== "claude" || !(target instanceof Element)) return false;

    const input = findPlatformInput();
    return Boolean(
      input &&
      (target === input || input.contains(target) || target.closest?.("textarea,[contenteditable='true']") === input)
    );
  }

  function ensureDestinationSheetStyles() {
    if (document.getElementById(DESTINATION_SHEET_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = DESTINATION_SHEET_STYLE_ID;
    style.textContent = `
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

      .context-generator-tile-aura {
        animation: none;
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
        .context-generator-tile-aura {
          animation: none;
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
      `transform:${DESTINATION_SHEET_CLOSED_TRANSFORM}`,
      "transform-origin:bottom right",
      "will-change:transform,opacity",
      "transition:opacity 0.18s cubic-bezier(0.16,1,0.3,1), transform 0.22s cubic-bezier(0.16,1,0.3,1)"
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = "padding:0 1px 8px;display:flex;align-items:center;justify-content:space-between;gap:10px";
    const title = document.createElement("div");
    title.textContent = DESTINATION_TITLE_TEXT;
    title.style.cssText = "font-family:Georgia,'Times New Roman',serif;font-size:14px;font-weight:500;letter-spacing:0;color:#ffffff;line-height:1.02;text-rendering:geometricPrecision";
    const badge = document.createElement("button");
    badge.type = "button";
    badge.textContent = "Cap-Context";
    badge.setAttribute("aria-label", "Open Cap-Context site");
    badge.style.cssText = [
      "height:19px",
      "padding:0 7px",
      "border-radius:999px",
      "border:1px solid transparent",
      "background:rgba(255,255,255,0.035)",
      "box-shadow:none",
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
    const setBadgeActive = () => {
      badge.style.borderColor = "rgba(255,255,255,0.24)";
      badge.style.background = "rgba(255,255,255,0.052)";
      badge.style.boxShadow = "0 0 0 1px rgba(0,0,0,0.28), 0 0 12px rgba(255,255,255,0.11), inset 0 1px 0 rgba(255,255,255,0.16)";
      badge.style.color = "rgba(255,255,255,0.74)";
    };
    const setBadgeIdle = () => {
      badge.style.borderColor = "transparent";
      badge.style.background = "rgba(255,255,255,0.035)";
      badge.style.boxShadow = "none";
      badge.style.color = "rgba(255,255,255,0.68)";
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
      button.style.cssText = [
        "width:100%",
        "height:48px",
        "border:1px solid rgba(255,255,255,0.115)",
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
        "box-shadow:inset 0 1px 0 rgba(255,255,255,0.075), inset 0 -1px 0 rgba(0,0,0,0.54), 0 1px 0 rgba(255,255,255,0.02)",
        "transition:transform 0.13s ease"
      ].join(";");

      const aura = document.createElement("span");
      aura.className = "context-generator-tile-aura";
      aura.style.cssText = [
        "position:absolute",
        "left:9px",
        "top:10px",
        "bottom:10px",
        "width:30px",
        "z-index:0",
        "pointer-events:none",
        "border-radius:999px",
        `background:radial-gradient(ellipse at 22% 50%, ${option.accent}24 0, ${option.accent}12 36%, ${option.accent}04 61%, transparent 80%)`,
        "opacity:0.14",
        "filter:blur(6px)",
        "transform:translate3d(0,0,0) scaleX(1)",
        "transition:opacity 0.16s ease, left 0.16s ease, right 0.16s ease, width 0.16s ease, border-radius 0.16s ease, background 0.16s ease"
      ].join(";");

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
        button.style.transform = "translateY(-1px) scale(1.025)";
      };
      const setButtonIdle = () => {
        button.style.background = "linear-gradient(180deg, #121212 0%, #0b0b0b 58%, #050505 100%)";
        button.style.borderColor = "rgba(255,255,255,0.115)";
        button.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.075), inset 0 -1px 0 rgba(0,0,0,0.54), 0 1px 0 rgba(255,255,255,0.02)";
        aura.style.left = "9px";
        aura.style.right = "auto";
        aura.style.width = "30px";
        aura.style.borderRadius = "999px";
        aura.style.background = `radial-gradient(ellipse at 22% 50%, ${option.accent}24 0, ${option.accent}12 36%, ${option.accent}04 61%, transparent 80%)`;
        aura.style.opacity = "0.14";
        button.style.transform = "translateY(0)";
      };

      button.appendChild(aura);
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
    hideClaudeLimitNudge();
    const existingSheet = document.getElementById(DESTINATION_SHEET_ID);
    if (existingSheet?.style.display === "block") {
      hideDestinationSheet();
      return;
    }

    const sheet = ensureDestinationSheet();
    if (destinationSheetAnimationFrame) cancelAnimationFrame(destinationSheetAnimationFrame);
    sheet.style.opacity = "0";
    sheet.style.transform = DESTINATION_SHEET_CLOSED_TRANSFORM;
    sheet.style.display = "block";
    delete sheet.dataset.contextGeneratorPositionLocked;
    positionDestinationSheet();
    resetDestinationTiles(sheet);
    animateDestinationTiles(sheet);
    warmDestinationConnections();
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
      sheet.style.transform = DESTINATION_SHEET_CLOSED_TRANSFORM;
      sheet.style.display = "none";
      delete sheet.dataset.contextGeneratorPositionLocked;
    }
  }

  function warmDestinationConnections() {
    const head = document.head || document.documentElement;
    if (!head) return;

    Object.entries(PLATFORMS)
      .filter(([id]) => id !== currentPlatform.id)
      .forEach(([id, platform]) => {
        const origin = getUrlOrigin(platform.url);
        if (!origin) return;

        const idValue = `context-generator-preconnect-${id}`;
        if (document.getElementById(idValue)) return;

        const link = document.createElement("link");
        link.id = idValue;
        link.dataset.contextGeneratorOwned = "true";
        link.rel = "preconnect";
        link.href = origin;
        link.crossOrigin = "anonymous";
        head.appendChild(link);
      });
  }

  function getUrlOrigin(url) {
    try {
      return new URL(url).origin;
    } catch {
      return "";
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
      tile.removeAttribute("aria-busy");
      tile.style.pointerEvents = "";
      tile.style.background = "linear-gradient(180deg, #121212 0%, #0b0b0b 58%, #050505 100%)";
      tile.style.borderColor = "rgba(255,255,255,0.115)";
      tile.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.075), inset 0 -1px 0 rgba(0,0,0,0.54), 0 1px 0 rgba(255,255,255,0.02)";
      tile.style.transform = "translateY(0)";
      if (aura) {
        aura.style.left = "9px";
        aura.style.right = "auto";
        aura.style.width = "30px";
        aura.style.borderRadius = "999px";
        aura.style.background = `radial-gradient(ellipse at 22% 50%, ${accent}24 0, ${accent}12 36%, ${accent}04 61%, transparent 80%)`;
        aura.style.opacity = "0.14";
      }
      const detail = tile.querySelector(".context-generator-tile-detail");
      const spinner = tile.querySelector(".context-generator-tile-spinner");
      if (detail && tile.dataset.contextGeneratorDetail) {
        detail.textContent = tile.dataset.contextGeneratorDetail;
      }
      if (spinner) spinner.style.display = "none";
    });
  }

  async function startDestinationTransfer(destinationId) {
    hideDestinationSheet();
    if (isRunning) return;
    if (getDetectedConversationMessageCount() === 0) {
      showErrorOverlay(NO_CONVERSATION_ERROR_MESSAGE);
      return;
    }

    const trace = createTransferTrace(destinationId, "destination tile");
    trace.destinationId = destinationId;
    markTransferTrace(trace, "destination click", { destination: destinationId });

    isRunning = true;
    clearRunningResetTimer();
    runningResetTimer = setTimeout(resetRunningFlag, RUNNING_AUTO_RESET_MS);
    showOverlay(destinationId);
    let preparedDestinationPromise = null;
    if (getDetectedConversationMessageCount() > 0) {
      preparedDestinationPromise = prepareDestinationTab(destinationId, trace);
    }
    await prepareSourceForCapture();
    if (!preparedDestinationPromise && getDetectedConversationMessageCount() > 0) {
      preparedDestinationPromise = prepareDestinationTab(destinationId, trace);
    }

    let conversationText;
    try {
      markTransferTrace(trace, "capture start");
      setHandoffProgress("capture", "active");
      conversationText = await scrapeConversationTextWhenReady();
      markCaptureDone(trace, conversationText);
    } catch (error) {
      markTransferTrace(trace, `failed: ${error.message}`);
      finishTransferTrace(trace);
      resetRunningFlag();
      showErrorOverlay(error.message);
      return;
    }

    preparedDestinationPromise = preparedDestinationPromise || prepareDestinationTab(destinationId, trace);
    runContextFlow(destinationId, preparedDestinationPromise, conversationText, trace);
  }

  function ensureFloatingOverlay() {
    if (!document.getElementById(HANDOFF_SCRIM_ID)) {
      const scrim = document.createElement("div");
      scrim.id = HANDOFF_SCRIM_ID;
      scrim.dataset.contextGeneratorOwned = "true";
      scrim.setAttribute("aria-hidden", "true");
      scrim.style.cssText = [
        "display:none",
        "position:fixed",
        "z-index:2147483646",
        "inset:0",
        "pointer-events:none",
        "background:rgba(0,0,0,0.09)",
        "opacity:0",
        "transition:opacity 180ms cubic-bezier(0.16,1,0.3,1)"
      ].join(";");
      document.body.appendChild(scrim);
    }

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
        "width:min(548px,calc(100vw - 32px))",
        "height:228px",
        "min-height:228px",
        "max-height:228px",
        "box-sizing:border-box",
        "padding:22px 28px",
        "border-radius:24px",
        "border:1px solid rgba(238,235,244,0.13)",
        "background:#151517",
        "color:#b9b7bd",
        "box-shadow:0 28px 82px rgba(0,0,0,0.42),0 8px 24px rgba(0,0,0,0.25),0 0 0 1px rgba(0,0,0,0.48),inset 0 1px 0 rgba(255,255,255,0.07),inset 0 -1px 0 rgba(255,255,255,0.018)",
        `transform:${HANDOFF_OVERLAY_CLOSED_TRANSFORM}`,
        "opacity:0",
        "flex-direction:column",
        "justify-content:center",
        "gap:18px",
        "overflow:hidden",
        "backdrop-filter:blur(22px)",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "letter-spacing:0",
        "will-change:transform,opacity",
        "transition:opacity 0.18s cubic-bezier(0.16,1,0.3,1), transform 0.22s cubic-bezier(0.16,1,0.3,1)"
      ].join(";");

      const glow = document.createElement("div");
      glow.style.cssText = [
        "position:absolute",
        "inset:-1px",
        "pointer-events:none",
        "background:linear-gradient(180deg,rgba(255,255,255,0.045),transparent 36%)",
        "opacity:0.85"
      ].join(";");

      const brand = document.createElement("div");
      brand.id = "context-generator-overlay-brand";
      brand.style.cssText = [
        "position:relative",
        "z-index:1",
        "display:flex",
        "width:100%",
        "min-height:24px",
        "box-sizing:border-box",
        "align-items:center",
        "justify-content:flex-start",
        "gap:7px",
        "color:rgba(245,243,250,0.67)",
        "font-size:12.5px",
        "font-weight:620",
        "letter-spacing:0"
      ].join(";");

      const brandIcon = document.createElement("img");
      brandIcon.id = "context-generator-overlay-brand-icon";
      brandIcon.src = BUBBLE_ICON_URL;
      brandIcon.alt = "";
      brandIcon.width = 24;
      brandIcon.height = 24;
      brandIcon.style.cssText = [
        "display:block",
        "width:24px",
        "height:24px",
        "object-fit:contain",
        "filter:drop-shadow(0 3px 9px rgba(141,108,207,0.22))"
      ].join(";");

      const brandText = document.createElement("span");
      brandText.textContent = "Cap Context";
      brand.appendChild(brandIcon);
      brand.appendChild(brandText);

      const statusText = document.createElement("div");
      statusText.id = "context-generator-text";
      statusText.setAttribute("aria-live", "polite");
      statusText.setAttribute("aria-atomic", "true");
      statusText.style.cssText = [
        "position:relative",
        "z-index:1",
        "display:flex",
        "min-height:34px",
        "align-items:center",
        "justify-content:center",
        "font-size:29px",
        "font-family:Georgia,'Times New Roman',serif",
        "font-weight:500",
        "line-height:1.08",
        "text-align:center",
        "text-wrap:balance",
        "color:#f2f0f6",
        "letter-spacing:-0.035em",
        "text-rendering:geometricPrecision",
        "will-change:transform,opacity"
      ].join(";");

      const statusLabel = document.createElement("span");
      statusLabel.id = "context-generator-text-label";
      statusLabel.textContent = "Capturing chat";
      statusText.appendChild(statusLabel);

      const summaryActivity = document.createElement("span");
      summaryActivity.className = "context-generator-summary-activity";
      summaryActivity.dataset.active = "false";
      summaryActivity.setAttribute("aria-hidden", "true");
      for (let index = 0; index < 3; index += 1) {
        const dot = document.createElement("span");
        dot.className = "context-generator-summary-activity-dot";
        dot.textContent = ".";
        summaryActivity.appendChild(dot);
      }
      statusText.appendChild(summaryActivity);

      const progress = document.createElement("div");
      progress.id = "context-generator-handoff-progress";
      progress.setAttribute("role", "list");
      progress.setAttribute("aria-label", "Transfer progress");
      progress.style.cssText = [
        "position:relative",
        "z-index:1",
        "display:grid",
        "grid-template-columns:repeat(3,minmax(0,1fr))",
        "width:calc(100% - 8px)",
        "margin:0 auto",
        "align-items:start"
      ].join(";");

      HANDOFF_STAGES.forEach((stage, index) => {
        const stageElement = document.createElement("div");
        stageElement.className = "context-generator-handoff-stage";
        stageElement.dataset.contextGeneratorStage = stage.id;
        stageElement.dataset.state = "upcoming";
        stageElement.setAttribute("role", "listitem");

        if (index < HANDOFF_STAGES.length - 1) {
          const connector = document.createElement("span");
          connector.className = "context-generator-handoff-stage-connector";
          connector.setAttribute("aria-hidden", "true");

          const connectorFill = document.createElement("span");
          connectorFill.className = "context-generator-handoff-stage-connector-fill";

          const progressHead = document.createElement("span");
          progressHead.className = "context-generator-handoff-stage-progress-head";

          connector.appendChild(connectorFill);
          connector.appendChild(progressHead);
          stageElement.appendChild(connector);
        }

        const marker = document.createElement("span");
        marker.className = "context-generator-handoff-stage-marker";
        marker.textContent = String(index + 1);

        const label = document.createElement("span");
        label.className = "context-generator-handoff-stage-label";
        label.textContent = stage.label;

        stageElement.appendChild(marker);
        stageElement.appendChild(label);
        progress.appendChild(stageElement);
      });

      if (!document.getElementById("context-generator-styles")) {
        const styleSheet = document.createElement("style");
        styleSheet.id = "context-generator-styles";
        styleSheet.dataset.contextGeneratorOwned = "true";
        styleSheet.textContent = `
          @keyframes contextGeneratorHeadlineIn{
            from{opacity:0.18;transform:translate3d(0,6px,0)}
            to{opacity:1;transform:translate3d(0,0,0)}
          }
          @keyframes contextGeneratorSummaryDotHop{
            0%,48%,100%{opacity:0.54;transform:translate3d(0,0,0)}
            18%{opacity:1;transform:translate3d(0,-3px,0)}
          }
          #context-generator-text .context-generator-summary-activity{
            display:none;
            flex:0 0 auto;
            position:relative;
            top:1px;
            margin-left:1px;
            align-items:baseline;
            gap:0;
            color:#f2f0f6;
            font:inherit;
            line-height:inherit;
            letter-spacing:0;
            pointer-events:none;
          }
          #context-generator-text .context-generator-summary-activity[data-active="true"]{
            display:inline-flex;
          }
          #context-generator-text .context-generator-summary-activity-dot{
            display:inline-block;
            color:inherit;
            opacity:0.54;
            transform:translate3d(0,0,0);
            animation:contextGeneratorSummaryDotHop 1800ms cubic-bezier(0.45,0,0.55,1) infinite;
            will-change:transform,opacity;
          }
          #context-generator-text .context-generator-summary-activity-dot:nth-child(2){animation-delay:220ms}
          #context-generator-text .context-generator-summary-activity-dot:nth-child(3){animation-delay:440ms}
          #context-generator-handoff-progress .context-generator-handoff-stage{
            position:relative;
            min-width:0;
            display:flex;
            flex-direction:column;
            align-items:center;
            gap:8px;
            padding:0 5px;
            color:rgba(239,237,244,0.46);
            text-align:center;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage-connector{
            position:absolute;
            z-index:0;
            top:11px;
            left:calc(50% + 17px);
            right:calc(-50% + 17px);
            height:2px;
            overflow:visible;
            border-radius:999px;
            background:rgba(255,255,255,0.11);
          }
          /* The line follows live display progress; its motion never gates the transfer pipeline. */
          #context-generator-handoff-progress .context-generator-handoff-stage-connector-fill{
            position:absolute;
            inset:0 auto 0 0;
            width:var(--context-generator-stage-progress-position,0%);
            border-radius:inherit;
            background:linear-gradient(90deg,#6F579D,#9A7ADC);
            box-shadow:2px 0 7px rgba(141,108,207,0.3);
            transition:width var(--context-generator-stage-progress-duration,1.35s) var(--context-generator-stage-progress-easing,cubic-bezier(0.22,0.72,0.22,1));
          }
          #context-generator-handoff-progress .context-generator-handoff-stage-progress-head{
            position:absolute;
            z-index:1;
            top:50%;
            left:var(--context-generator-stage-progress-position,0%);
            width:4px;
            height:4px;
            border-radius:999px;
            background:#A98BE2;
            box-shadow:0 0 0 2px rgba(141,108,207,0.14),0 0 8px rgba(169,139,226,0.72);
            opacity:0;
            transform:translate(-50%,-50%);
            transition:left var(--context-generator-stage-progress-duration,1.35s) var(--context-generator-stage-progress-easing,cubic-bezier(0.22,0.72,0.22,1)),opacity 160ms ease;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="active"] .context-generator-handoff-stage-progress-head{
            opacity:1;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="complete"] .context-generator-handoff-stage-progress-head{
            opacity:0;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage-marker{
            position:relative;
            z-index:1;
            display:flex;
            width:24px;
            height:24px;
            align-items:center;
            justify-content:center;
            box-sizing:border-box;
            border:1px solid rgba(255,255,255,0.15);
            border-radius:999px;
            background:rgba(255,255,255,0.025);
            color:rgba(245,243,249,0.44);
            font-size:10.5px;
            font-weight:700;
            transition:background 180ms ease,border-color 180ms ease,color 180ms ease,box-shadow 180ms ease;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage-label{
            min-height:30px;
            font-size:12px;
            font-weight:580;
            line-height:1.22;
            transition:color 180ms ease,font-weight 180ms ease;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="active"]{
            color:#f4f2f7;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="active"] .context-generator-handoff-stage-marker{
            border-color:rgba(190,165,232,0.72);
            background:#8D6CCF;
            color:#fff;
            box-shadow:0 0 0 3px rgba(141,108,207,0.16),0 5px 14px rgba(72,51,111,0.28),inset 0 1px 0 rgba(255,255,255,0.16);
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="active"] .context-generator-handoff-stage-label{
            color:#fff;
            font-weight:680;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="complete"]{
            color:rgba(200,183,229,0.72);
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="complete"] .context-generator-handoff-stage-marker{
            border-color:rgba(164,137,216,0.34);
            background:rgba(141,108,207,0.14);
            color:#C8B6E9;
          }
          @media (prefers-reduced-motion: reduce){
            #context-generator-text{animation:none!important}
            #context-generator-text .context-generator-summary-activity-dot{animation:none!important;opacity:0.72}
            #${HANDOFF_REASSURANCE_ID}{transition:none!important}
            #context-generator-handoff-progress .context-generator-handoff-stage-connector-fill,
            #context-generator-handoff-progress .context-generator-handoff-stage-progress-head{transition:none!important}
          }
        `;
        document.head.appendChild(styleSheet);
      }

      const countdown = document.createElement("div");
      countdown.id = HANDOFF_COUNTDOWN_ID;
      countdown.setAttribute("aria-label", "Estimated seconds remaining");
      countdown.style.cssText = [
        "display:none",
        "margin-left:auto",
        "flex:0 0 auto",
        "align-items:center",
        "justify-content:center",
        "min-width:32px",
        "height:22px",
        "padding:0 8px",
        "box-sizing:border-box",
        "border-radius:999px",
        "border:1px solid rgba(255,255,255,0.075)",
        "background:rgba(255,255,255,0.032)",
        "box-shadow:inset 0 1px 0 rgba(255,255,255,0.035)",
        "color:rgba(242,240,246,0.46)",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "font-size:10.5px",
        "font-weight:620",
        "line-height:1",
        "letter-spacing:0",
        "font-variant-numeric:tabular-nums",
        "opacity:0",
        "transition:opacity 160ms ease"
      ].join(";");
      brand.appendChild(countdown);

      const reassurance = document.createElement("span");
      reassurance.id = HANDOFF_REASSURANCE_ID;
      reassurance.textContent = HANDOFF_REASSURANCE_TEXT;
      reassurance.setAttribute("aria-live", "polite");
      reassurance.setAttribute("aria-hidden", "true");
      reassurance.style.cssText = [
        "display:none",
        "margin-left:auto",
        "flex:0 0 auto",
        "align-items:center",
        "white-space:nowrap",
        "color:rgba(250,248,252,0.94)",
        "font-family:Georgia,'Times New Roman',serif",
        "font-size:14px",
        "font-weight:500",
        "line-height:1",
        "letter-spacing:0",
        "opacity:0",
        "visibility:hidden",
        "transform:translate3d(0,2px,0)",
        "transition:opacity 160ms ease,transform 160ms ease"
      ].join(";");
      brand.appendChild(reassurance);

      overlay.appendChild(glow);
      overlay.appendChild(brand);
      overlay.appendChild(statusText);
      overlay.appendChild(progress);
      document.body.appendChild(overlay);
    }
  }

  function showOverlay(destinationId = null) {
    ensureFloatingOverlay();
    const overlay = document.getElementById(OVERLAY_ID);
    const scrim = document.getElementById(HANDOFF_SCRIM_ID);
    const bubble = document.getElementById(BUBBLE_ID);

    if (overlay) {
      const destinationName = getPlatform(destinationId)?.name || "destination";
      overlay.dataset.contextGeneratorDestinationName = destinationName;
      setHandoffProgress("capture", "active", destinationName);
      startHandoffCountdown();
      overlay.style.display = "flex";
      if (scrim) scrim.style.display = "block";
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        overlay.style.opacity = "1";
        overlay.style.transform = "translate3d(-50%,-50%,0) translateY(0) scale(1)";
        if (scrim) scrim.style.opacity = "1";
      } else {
        requestAnimationFrame(() => {
          overlay.style.opacity = "1";
          overlay.style.transform = "translate3d(-50%,-50%,0) translateY(0) scale(1)";
          if (scrim) scrim.style.opacity = "1";
        });
      }
    }

    if (bubble) {
      bubble.disabled = true;
      bubble.style.opacity = "0.5";
      bubble.style.cursor = "not-allowed";
    }
  }

  function hideOverlay() {
    const overlay = document.getElementById(OVERLAY_ID);
    const scrim = document.getElementById(HANDOFF_SCRIM_ID);
    const bubble = document.getElementById(BUBBLE_ID);

    stopHandoffCountdown();
    stopHandoffLiveProgress();
    if (overlay) {
      overlay.style.opacity = "0";
      overlay.style.transform = HANDOFF_OVERLAY_CLOSED_TRANSFORM;
      overlay.style.display = "none";
    }
    if (scrim) {
      scrim.style.opacity = "0";
      scrim.style.display = "none";
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

  function getHandoffProgressState(stageId, phase = "active", destinationName = "destination") {
    const requestedIndex = HANDOFF_STAGES.findIndex((stage) => stage.id === stageId);
    const currentIndex = requestedIndex >= 0 ? requestedIndex : 0;
    const currentIsDone = phase === "done";

    return HANDOFF_STAGES.map((stage, index) => {
      let state = "upcoming";
      if (index < currentIndex || (index === currentIndex && currentIsDone)) {
        state = "complete";
      } else if (index === currentIndex) {
        state = "active";
      }

      return {
        id: stage.id,
        label: stage.id === "paste" ? `Pasting into ${destinationName || "destination"}` : stage.label,
        state
      };
    });
  }

  function getHandoffProgressStatusText(stageId, phase = "active", destinationName = "destination") {
    const safeDestinationName = destinationName || "destination";
    if (phase === "done") {
      if (stageId === "capture") return "Chat captured";
      if (stageId === "summary") return "Summary ready";
      if (stageId === "paste") return `Pasted into ${safeDestinationName}`;
    }

    if (stageId === "summary") return "Summarizing";
    if (stageId === "paste") return `Pasting into ${safeDestinationName}`;
    return "Capturing chat";
  }

  function getHandoffCaptureLineProgress(scrollState = {}) {
    const traveled = Math.max(0, Number(scrollState.scrollTop || 0));
    const remaining = Math.max(0, Number(scrollState.scrollRemaining || 0));
    const total = traveled + remaining;
    const realRatio = total > 0 ? traveled / total : 0;
    return Math.min(
      HANDOFF_CAPTURE_LINE_MAX,
      HANDOFF_CAPTURE_LINE_MIN + (HANDOFF_CAPTURE_LINE_MAX - HANDOFF_CAPTURE_LINE_MIN) * realRatio
    );
  }

  function setHandoffStageLineProgress(stageId, value) {
    if (stageId === "paste") return;
    const progress = document.getElementById("context-generator-handoff-progress");
    const stageElement = progress?.querySelector(`[data-context-generator-stage='${stageId}']`);
    if (!stageElement) return;

    const normalized = Math.max(0, Math.min(1, Number(value || 0)));
    stageElement.style.setProperty(
      "--context-generator-stage-progress-position",
      `${(normalized * 100).toFixed(2)}%`
    );
    stageElement.dataset.contextGeneratorLineProgress = normalized.toFixed(4);
  }

  function reportHandoffCaptureProgress(scrollState) {
    if (!isHandoffOverlayVisible()) return;
    const lineProgress = getHandoffCaptureLineProgress(scrollState);
    if (handoffCaptureProgressFrame) window.cancelAnimationFrame?.(handoffCaptureProgressFrame);

    const applyProgress = () => {
      handoffCaptureProgressFrame = null;
      const captureStage = document.querySelector(
        "#context-generator-handoff-progress [data-context-generator-stage='capture']"
      );
      if (captureStage?.dataset.state === "active") {
        setHandoffStageLineProgress("capture", lineProgress);
      }
    };

    if (window.requestAnimationFrame) {
      handoffCaptureProgressFrame = window.requestAnimationFrame(applyProgress);
    } else {
      applyProgress();
    }
  }

  function startHandoffActivityProgress(stageId) {
    stopHandoffActivityProgress();
    if (stageId !== "summary" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.requestAnimationFrame) return;

    // Two frames let the 5% start paint before the long transition begins.
    handoffActivityProgressFrame = window.requestAnimationFrame(() => {
      handoffActivityProgressFrame = window.requestAnimationFrame(() => {
        handoffActivityProgressFrame = null;
        const stageElement = document.querySelector(
          `#context-generator-handoff-progress [data-context-generator-stage='${stageId}']`
        );
        if (!stageElement || stageElement.dataset.state !== "active" || !isHandoffOverlayVisible()) return;
        stageElement.style.setProperty(
          "--context-generator-stage-progress-duration",
          `${HANDOFF_ACTIVITY_LINE_DURATION_MS}ms`
        );
        stageElement.style.setProperty("--context-generator-stage-progress-easing", "linear");
        setHandoffStageLineProgress(stageId, HANDOFF_ACTIVITY_LINE_MAX);
      });
    });
  }

  function stopHandoffActivityProgress() {
    if (!handoffActivityProgressFrame) return;
    window.cancelAnimationFrame?.(handoffActivityProgressFrame);
    handoffActivityProgressFrame = null;
  }

  function stopHandoffLiveProgress() {
    stopHandoffActivityProgress();
    if (handoffCaptureProgressFrame) {
      window.cancelAnimationFrame?.(handoffCaptureProgressFrame);
      handoffCaptureProgressFrame = null;
    }
  }

  function setHandoffProgress(stageId, phase = "active", destinationName = null) {
    const overlay = document.getElementById(OVERLAY_ID);
    const progress = document.getElementById("context-generator-handoff-progress");
    const statusText = document.getElementById("context-generator-text");
    const statusLabel = document.getElementById("context-generator-text-label");
    const summaryActivity = statusText?.querySelector(".context-generator-summary-activity");
    if (!progress || !statusText || !statusLabel || !summaryActivity) return;

    const resolvedDestinationName = destinationName
      || overlay?.dataset.contextGeneratorDestinationName
      || "destination";
    stopHandoffActivityProgress();
    const stages = getHandoffProgressState(stageId, phase, resolvedDestinationName);
    const stageElements = progress.querySelectorAll(".context-generator-handoff-stage");

    stages.forEach((stage, index) => {
      const stageElement = stageElements[index];
      if (!stageElement) return;
      const marker = stageElement.querySelector(".context-generator-handoff-stage-marker");
      const label = stageElement.querySelector(".context-generator-handoff-stage-label");

      stageElement.dataset.state = stage.state;
      stageElement.style.setProperty("--context-generator-stage-progress-duration", "1.35s");
      stageElement.style.setProperty(
        "--context-generator-stage-progress-easing",
        "cubic-bezier(0.22,0.72,0.22,1)"
      );
      setHandoffStageLineProgress(
        stage.id,
        stage.state === "complete"
          ? 1
          : (stage.state === "active" && stage.id === "capture"
            ? HANDOFF_CAPTURE_LINE_MIN
            : (stage.state === "active" && stage.id === "summary" ? HANDOFF_ACTIVITY_LINE_START : 0))
      );
      stageElement.setAttribute("aria-label", `${stage.label}, ${stage.state}`);
      if (stage.state === "active") {
        stageElement.setAttribute("aria-current", "step");
      } else {
        stageElement.removeAttribute("aria-current");
      }
      if (marker) marker.textContent = stage.state === "complete" ? "✓" : String(index + 1);
      if (label) label.textContent = stage.label;
    });

    const currentStatus = getHandoffProgressStatusText(stageId, phase, resolvedDestinationName);
    const shouldAnimateHeadline = statusLabel.textContent !== currentStatus
      && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    statusText.style.animation = "none";
    statusLabel.textContent = currentStatus;
    summaryActivity.dataset.active = String(stageId === "summary" && phase === "active");
    if (shouldAnimateHeadline) {
      void statusText.offsetWidth;
      statusText.style.animation = "contextGeneratorHeadlineIn 340ms cubic-bezier(0.16,1,0.3,1) both";
    }
    progress.setAttribute("aria-label", `Transfer progress: ${currentStatus}`);
    if (phase === "active") startHandoffActivityProgress(stageId);
  }

  function startHandoffCountdown() {
    stopHandoffCountdown();
    const countdown = document.getElementById(HANDOFF_COUNTDOWN_ID);
    if (!countdown) return;

    const startMs = HANDOFF_COUNTDOWN_FIXED_MS;
    const startedAt = getNow();
    countdown.setAttribute("aria-label", "Estimated seconds remaining");
    countdown.style.display = "inline-flex";
    countdown.style.opacity = "1";

    const updateCountdown = () => {
      const remainingMs = startMs - (getNow() - startedAt);
      if (remainingMs <= 0) {
        hideHandoffCountdown(countdown);
        return;
      }

      countdown.textContent = `${Math.max(1, Math.ceil(remainingMs / 1000))}s`;
    };

    updateCountdown();
    handoffCountdownTimer = window.setInterval(updateCountdown, 250);
  }

  function hideHandoffCountdown(countdown = document.getElementById(HANDOFF_COUNTDOWN_ID)) {
    if (handoffCountdownTimer) {
      clearInterval(handoffCountdownTimer);
      handoffCountdownTimer = null;
    }
    if (!countdown) return;

    countdown.style.opacity = "0";
    handoffCountdownHideTimer = window.setTimeout(() => {
      countdown.style.display = "none";
      showHandoffReassurance();
      handoffCountdownHideTimer = null;
    }, 170);
  }

  function showHandoffReassurance() {
    const reassurance = document.getElementById(HANDOFF_REASSURANCE_ID);
    if (!reassurance || !isHandoffOverlayVisible()) return;

    reassurance.setAttribute("aria-hidden", "false");
    reassurance.style.display = "inline-flex";
    reassurance.style.visibility = "visible";
    reassurance.style.opacity = "1";
    reassurance.style.transform = "translate3d(0,0,0)";
  }

  function hideHandoffReassurance() {
    const reassurance = document.getElementById(HANDOFF_REASSURANCE_ID);
    if (!reassurance) return;

    reassurance.setAttribute("aria-hidden", "true");
    reassurance.style.opacity = "0";
    reassurance.style.visibility = "hidden";
    reassurance.style.display = "none";
    reassurance.style.transform = "translate3d(0,2px,0)";
  }

  function stopHandoffCountdown() {
    if (handoffCountdownTimer) {
      clearInterval(handoffCountdownTimer);
      handoffCountdownTimer = null;
    }
    if (handoffCountdownHideTimer) {
      clearTimeout(handoffCountdownHideTimer);
      handoffCountdownHideTimer = null;
    }

    const countdown = document.getElementById(HANDOFF_COUNTDOWN_ID);
    if (countdown) {
      countdown.style.opacity = "0";
      countdown.style.display = "none";
    }
    hideHandoffReassurance();
  }

  function showErrorOverlay(message) {
    const isNoConversationError = message === NO_CONVERSATION_ERROR_MESSAGE;
    const isSummaryRetryError = message === SUMMARY_RETRY_ERROR_MESSAGE;
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
        "opacity:0",
        "transform:translate3d(24px,0,0)",
        "transition:opacity 260ms ease,transform 260ms ease",
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
        hideErrorOverlay(errorDiv);
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
      title.textContent = isNoConversationError
        ? NO_CONVERSATION_ERROR_TITLE
        : isSummaryRetryError
          ? SUMMARY_RETRY_ERROR_TITLE
          : "Transfer failed";
    }

    const mark = document.getElementById("context-generator-error-mark");
    if (mark) {
      mark.textContent = isNoConversationError || isSummaryRetryError ? "i" : "!";
    }

    const textSpan = document.getElementById("context-generator-error-text");
    if (textSpan) {
      textSpan.textContent = message;
    }

    clearTimeout(errorDiv.contextGeneratorHideTimer);
    clearTimeout(errorDiv.contextGeneratorDisplayTimer);
    errorDiv.style.display = "flex";
    errorDiv.style.opacity = "0";
    errorDiv.style.transform = "translate3d(24px,0,0)";
    requestAnimationFrame(() => {
      errorDiv.style.opacity = "1";
      errorDiv.style.transform = "translate3d(0,0,0)";
    });
    errorDiv.contextGeneratorHideTimer = setTimeout(() => {
      hideErrorOverlay(errorDiv);
    }, 8000);
  }

  function hideErrorOverlay(errorDiv = document.getElementById("context-generator-error-overlay")) {
    if (!errorDiv) return;
    clearTimeout(errorDiv.contextGeneratorDisplayTimer);
    errorDiv.style.opacity = "0";
    errorDiv.style.transform = "translate3d(24px,0,0)";
    errorDiv.contextGeneratorDisplayTimer = setTimeout(() => {
      errorDiv.style.display = "none";
    }, 280);
  }

  function showFallbackModal(text, destinationName) {
    let modal = document.getElementById("context-generator-fallback-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "context-generator-fallback-modal";
      modal.dataset.contextGeneratorOwned = "true";
      modal.setAttribute("role", "dialog");
      modal.setAttribute("aria-modal", "true");
      modal.setAttribute("aria-labelledby", "context-generator-fallback-title");
      modal.setAttribute("aria-describedby", "context-generator-fallback-desc");
      modal.style.cssText = [
        "position:fixed",
        "z-index:2147483647",
        "inset:0",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "box-sizing:border-box",
        "padding:18px",
        "background:rgba(0,0,0,0.68)",
        "backdrop-filter:blur(12px)",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
      ].join(";");

      const content = document.createElement("div");
      content.style.cssText = [
        "position:relative",
        "width:min(560px,100%)",
        "box-sizing:border-box",
        "display:flex",
        "flex-direction:column",
        "gap:16px",
        "padding:26px",
        "border-radius:26px",
        "border:1px solid rgba(255,255,255,0.14)",
        "background:linear-gradient(180deg,#171719 0%,#101012 58%,#09090b 100%)",
        "color:#f5f5f5",
        "box-shadow:0 28px 84px rgba(0,0,0,0.58),0 0 0 1px rgba(0,0,0,0.72),inset 0 1px 0 rgba(255,255,255,0.08)",
        "overflow:hidden"
      ].join(";");

      const accent = document.createElement("div");
      accent.style.cssText = [
        "position:absolute",
        "inset:-1px",
        "pointer-events:none",
        "background:radial-gradient(circle at 50% -18%,rgba(255,255,255,0.12),transparent 36%),linear-gradient(180deg,rgba(255,255,255,0.045),transparent 48%)"
      ].join(";");

      const header = document.createElement("div");
      header.style.cssText = "position:relative;z-index:1;display:flex;align-items:flex-start;justify-content:space-between;gap:16px";

      const copyWrap = document.createElement("div");
      copyWrap.style.cssText = "display:flex;flex-direction:column;gap:7px;min-width:0";

      const title = document.createElement("div");
      title.id = "context-generator-fallback-title";
      title.style.cssText = [
        "font-family:Georgia,'Times New Roman',serif",
        "font-size:22px",
        "font-weight:500",
        "line-height:1.1",
        "letter-spacing:0",
        "color:#ffffff"
      ].join(";");
      title.textContent = "Context is ready to copy";

      const desc = document.createElement("div");
      desc.id = "context-generator-fallback-desc";
      desc.style.cssText = [
        "font-size:13px",
        "line-height:1.5",
        "color:rgba(255,255,255,0.64)",
        "max-width:430px"
      ].join(";");

      const dismissBtn = document.createElement("button");
      dismissBtn.id = "context-generator-fallback-dismiss";
      dismissBtn.type = "button";
      dismissBtn.textContent = "Close";
      dismissBtn.style.cssText = [
        "height:32px",
        "padding:0 12px",
        "border-radius:999px",
        "border:1px solid rgba(255,255,255,0.14)",
        "background:rgba(255,255,255,0.045)",
        "color:rgba(255,255,255,0.72)",
        "font-size:12px",
        "font-weight:650",
        "cursor:pointer"
      ].join(";");

      const textarea = document.createElement("textarea");
      textarea.id = "context-generator-fallback-text";
      textarea.readOnly = true;
      textarea.setAttribute("aria-label", "Generated context to copy");
      textarea.style.cssText = [
        "position:relative",
        "z-index:1",
        "height:min(230px,38vh)",
        "min-height:150px",
        "box-sizing:border-box",
        "resize:vertical",
        "padding:14px",
        "border-radius:14px",
        "border:1px solid rgba(255,255,255,0.13)",
        "background:rgba(0,0,0,0.34)",
        "box-shadow:inset 0 1px 0 rgba(255,255,255,0.04)",
        "color:#f0f0f0",
        "font-family:'SFMono-Regular',Consolas,'Liberation Mono',monospace",
        "font-size:12px",
        "line-height:1.5",
        "outline:none"
      ].join(";");

      const buttonContainer = document.createElement("div");
      buttonContainer.style.cssText = "position:relative;z-index:1;display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap";

      const copyBtn = document.createElement("button");
      copyBtn.id = "context-generator-fallback-copy";
      copyBtn.type = "button";
      copyBtn.textContent = "Copy Context";
      copyBtn.style.cssText = [
        "height:38px",
        "padding:0 16px",
        "border-radius:999px",
        "border:1px solid rgba(255,255,255,0.18)",
        "background:linear-gradient(180deg,#f5f5f5,#d8d8d8)",
        "box-shadow:0 10px 24px rgba(0,0,0,0.24),inset 0 1px 0 rgba(255,255,255,0.7)",
        "color:#111114",
        "font-size:13px",
        "font-weight:750",
        "cursor:pointer"
      ].join(";");

      const setFocusStyle = (button, active) => {
        button.style.outline = active ? "2px solid rgba(255,255,255,0.42)" : "none";
        button.style.outlineOffset = active ? "3px" : "0";
      };

      copyBtn.addEventListener("click", async () => {
        const currentText = textarea.value || "";
        try {
          if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
          await navigator.clipboard.writeText(currentText);
          copyBtn.textContent = "Copied!";
          copyBtn.style.background = "linear-gradient(180deg,#69e6a2,#21b36b)";
          copyBtn.style.color = "#07150d";
          setTimeout(() => {
            if (!copyBtn.isConnected) return;
            copyBtn.textContent = "Copy Context";
            copyBtn.style.background = "linear-gradient(180deg,#f5f5f5,#d8d8d8)";
            copyBtn.style.color = "#111114";
          }, 2000);
        } catch (err) {
          textarea.select();
          document.execCommand("copy");
          copyBtn.textContent = "Copied!";
          copyBtn.style.background = "linear-gradient(180deg,#69e6a2,#21b36b)";
          copyBtn.style.color = "#07150d";
        }
      });

      const closeModal = () => {
        document.removeEventListener("keydown", modal.contextGeneratorKeydownHandler);
        const previousFocus = modal.contextGeneratorPreviousFocus;
        modal.remove();
        setTimeout(() => previousFocus?.focus?.({ preventScroll: true }), 0);
      };

      modal.contextGeneratorKeydownHandler = (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          closeModal();
          return;
        }

        if (event.key !== "Tab") return;

        const focusable = Array.from(modal.querySelectorAll("button, textarea"))
          .filter((node) => !node.disabled && node.offsetParent !== null);
        if (!focusable.length) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      };

      modal.contextGeneratorClose = closeModal;
      modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal();
      });
      content.addEventListener("click", (event) => event.stopPropagation());
      [copyBtn, dismissBtn].forEach((button) => {
        button.addEventListener("focus", () => setFocusStyle(button, true));
        button.addEventListener("blur", () => setFocusStyle(button, false));
      });
      dismissBtn.addEventListener("click", closeModal);

      copyWrap.appendChild(title);
      copyWrap.appendChild(desc);
      header.appendChild(copyWrap);
      header.appendChild(dismissBtn);

      content.appendChild(accent);
      content.appendChild(header);
      content.appendChild(textarea);
      content.appendChild(buttonContainer);
      buttonContainer.appendChild(copyBtn);
      modal.appendChild(content);
      document.body.appendChild(modal);
      document.addEventListener("keydown", modal.contextGeneratorKeydownHandler);
    } else {
      modal.style.display = "flex";
      if (!modal.contextGeneratorKeydownHandler) {
        modal.contextGeneratorKeydownHandler = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            modal.contextGeneratorClose?.();
          }
        };
        document.addEventListener("keydown", modal.contextGeneratorKeydownHandler);
      }
    }

    modal.contextGeneratorPreviousFocus = document.activeElement;

    const desc = document.getElementById("context-generator-fallback-desc");
    if (desc) {
      desc.textContent = `Auto-paste did not land in ${destinationName}. The context is safe here - copy it, paste it into the message box, then send when ready.`;
    }

    const textarea = document.getElementById("context-generator-fallback-text");
    if (textarea) {
      textarea.value = text;
      textarea.scrollTop = 0;
    }

    setTimeout(() => {
      document.getElementById("context-generator-fallback-copy")?.focus?.({ preventScroll: true });
    }, 0);
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

    if (currentPlatform.id === "gemini") {
      const geminiAnchor =
        findGeminiModelSelectorButton(composerRect) ||
        findComposerActionButton(input, composerRect);
      const geminiPlacement = getGeminiBubblePlacement(
        composerRect,
        geminiAnchor
      );
      releaseBubbleSlot();
      bubble.style.left = "auto";
      bubble.style.right = `${geminiPlacement.right}px`;
      bubble.style.top = "auto";
      bubble.style.bottom = `${geminiPlacement.bottom}px`;
      bubble.style.display = "flex";
      maybeShowOnboardingNudge(bubble);
      return;
    }

    if (currentPlatform.id === "claude") {
      const claudePlacement = getClaudeBubblePlacement(composerRect, input);
      if (claudePlacement.anchorControl) {
        reserveClaudeInlineBubbleSlot(claudePlacement.anchorControl, claudePlacement.controls, input, composerRect, claudePlacement.inlineShift);
      } else {
        releaseBubbleSlot();
      }
      setBubbleStylesIfChanged(bubble, {
        left: `${claudePlacement.left}px`,
        right: "auto",
        top: `${claudePlacement.top}px`,
        bottom: "auto",
        display: "flex"
      });
      maybeShowOnboardingNudge(bubble);
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

  function getClaudeBubblePlacement(composerRect, input = null) {
    const controls = getClaudeComposerControlCandidates(composerRect);
    const anchorControl = findClaudeVoiceModeControl(controls) || findClaudeInlineFallbackControl(controls);

    if (anchorControl) {
      const currentOffset = getClaudeCurrentControlOffset(anchorControl);
      const baseAnchorRight = anchorControl.rect.right - currentOffset;
      const anchorNudge = getClaudeControlTargetOffset(anchorControl, 0);
      const maxLeft = Math.max(
        BUBBLE_GAP,
        composerRect.width - BUBBLE_SIZE - CLAUDE_INLINE_RIGHT_MARGIN
      );
      const preferredLeft = baseAnchorRight + anchorNudge - composerRect.left + CLAUDE_INLINE_BUBBLE_GAP;
      const inlineShift = Math.min(
        CLAUDE_INLINE_SLOT_WIDTH,
        Math.max(0, preferredLeft - maxLeft)
      );
      const left = clampNumber(
        baseAnchorRight + getClaudeControlTargetOffset(anchorControl, inlineShift) - composerRect.left + CLAUDE_INLINE_BUBBLE_GAP,
        BUBBLE_GAP,
        maxLeft
      );
      const top = getBubblePlacementBesideRect(anchorControl.rect, composerRect, left).top;

      return {
        left: Math.round(left),
        top,
        inlineShift: Math.round(inlineShift),
        anchorControl,
        controls
      };
    }

    return {
      ...getBottomRightRowBubblePlacement(composerRect, 16),
      inlineShift: 0,
      anchorControl: null,
      controls
    };
  }

  function getClaudeComposerControlCandidates(composerRect) {
    const rowTop = getClaudeComposerControlRowTop(composerRect);

    return Array.from(document.querySelectorAll("button, [role='button'], [tabindex='0']"))
      .filter((element) => element.id !== BUBBLE_ID && !isContextGeneratorNode(element) && isVisible(element))
      .map((element) => ({
        element,
        label: getElementLabel(element, true),
        rect: element.getBoundingClientRect()
      }))
      .filter(({ rect }) => {
        return (
          rect.width > 0 &&
          rect.width <= 280 &&
          rect.height > 0 &&
          rect.height <= 84 &&
          rect.left >= composerRect.left - 12 &&
          rect.right <= composerRect.right + 16 &&
          rect.top >= rowTop &&
          rect.bottom <= composerRect.bottom + 16
        );
      })
      .sort((a, b) => a.rect.left - b.rect.left);
  }

  function findClaudeVoiceModeControl(controls) {
    return controls
      .map((control) => {
        let score = 0;
        if (/\bvoice\s*mode\b/.test(control.label)) score += 260;
        if (/\b(voice|speak|speech|talk|dictation|audio)\b/.test(control.label)) score += 160;
        if (control.rect.width <= 64 && control.rect.right >= getRightmostControlEdge(controls) - 4) score += 90;
        if (/\b(send|submit|attach|upload|file|project|sidebar|side bar|menu|navigation|toggle|model)\b/.test(control.label)) {
          score -= 260;
        }
        if (/\b(mic|microphone)\b/.test(control.label) && !/\bvoice\b/.test(control.label)) {
          score -= 80;
        }

        return { ...control, score };
      })
      .filter(({ score }) => score >= 160)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.rect.right - a.rect.right;
      })[0] || null;
  }

  function findClaudeInlineFallbackControl(controls) {
    return controls
      .filter((control) => {
        return (
          control.rect.width <= 72 &&
          !/\b(attach|upload|file|project|sidebar|side bar|menu|navigation|toggle|model)\b/.test(control.label)
        );
      })
      .sort((a, b) => b.rect.right - a.rect.right)[0] || null;
  }

  function getRightmostControlEdge(controls) {
    return controls.reduce((right, control) => Math.max(right, control.rect.right), 0);
  }

  function getClaudeCurrentControlOffset(anchorControl) {
    if (!anchorControl) return 0;
    return reservedClaudeControlOffsets.get(anchorControl.element) || 0;
  }

  function getClaudeComposerControlRowTop(composerRect) {
    return composerRect.bottom - Math.max(72, composerRect.height * 0.62);
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

  function findGeminiModelSelectorButton(composerRect) {
    if (!composerRect) return null;

    const rowTop = composerRect.bottom - Math.max(64, composerRect.height * 0.65);

    return Array.from(document.querySelectorAll("button, [role='button'], [tabindex='0'], [aria-label], [title], span"))
      .filter((element) => element.id !== BUBBLE_ID && !isContextGeneratorNode(element) && isVisible(element))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        const label = getElementLabel(element, true);
        const text = (element.innerText || element.textContent || "").toLowerCase();
        let score = 0;

        if (/\bflash\b/.test(text)) score += 220;
        if (/\bflash\b/.test(label)) score += 220;
        if (/\b(model|gemini|pro|thinking)\b/.test(label)) score += 36;
        if (rect.left >= composerRect.left + composerRect.width * 0.45) score += 16;
        if (rect.width >= 24 && rect.width <= 180) score += 10;
        if (/\b(send|submit|voice|mic|microphone|attach|upload|image|gallery|add)\b/.test(label)) score -= 260;

        return { element, rect, score };
      })
      .filter(({ rect, score }) => {
        return (
          score >= 180 &&
          rect.width > 0 &&
          rect.width <= 180 &&
          rect.height > 0 &&
          rect.height <= 72 &&
          rect.left >= composerRect.left + composerRect.width * 0.35 &&
          rect.right <= composerRect.right + 12 &&
          rect.top >= rowTop &&
          rect.bottom <= composerRect.bottom + 12
        );
      })
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.rect.left - b.rect.left;
      })[0]?.element || null;
  }

  function getGeminiBubblePlacement(composerRect, actionBtn) {
    const maxRight = Math.max(BUBBLE_GAP, composerRect.width - BUBBLE_SIZE - BUBBLE_GAP);
    const maxBottom = Math.max(BUBBLE_GAP, composerRect.height - BUBBLE_SIZE - BUBBLE_GAP);
    const fallback = {
      right: Math.round(Math.min(maxRight, BUBBLE_SLOT_WIDTH)),
      bottom: Math.round(Math.min(maxBottom, 16))
    };

    if (!actionBtn) return fallback;

    const actionRect = actionBtn.getBoundingClientRect();
    if (actionRect.width <= 0 || actionRect.height <= 0) return fallback;

    const right = Math.max(
      BUBBLE_GAP,
      Math.min(maxRight, composerRect.right - actionRect.left + BUBBLE_GAP)
    );
    const bottom = Math.max(
      BUBBLE_GAP,
      Math.min(
        maxBottom,
        composerRect.bottom - actionRect.bottom + (actionRect.height - BUBBLE_SIZE) / 2
      )
    );

    return {
      right: Math.round(right),
      bottom: Math.round(bottom)
    };
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

  function setBubbleStylesIfChanged(bubble, styles) {
    Object.entries(styles).forEach(([property, value]) => {
      if (bubble.style[property] !== value) {
        bubble.style[property] = value;
      }
    });
  }

  function clampNumber(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(Math.max(value, min), max);
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
    reserveBubbleSlotForCluster(cluster);
  }

  function reserveBubbleSlotForCluster(cluster, slotWidth = BUBBLE_SLOT_WIDTH) {
    if (!cluster) return;

    releaseClaudeInlineControlSlots();
    if (reservedActionCluster && reservedActionCluster !== cluster) {
      releaseActionClusterSlot();
    }

    if (!cluster.hasAttribute("data-context-generator-original-transform")) {
      cluster.setAttribute("data-context-generator-original-transform", cluster.style.transform || "");
    }

    const originalTransform = cluster.getAttribute("data-context-generator-original-transform") || "";
    const targetTransform = `${originalTransform} translateX(-${slotWidth}px)`.trim();
    if (cluster.style.transform !== targetTransform) {
      cluster.style.transform = targetTransform;
    }
    if (cluster.style.willChange !== "transform") {
      cluster.style.willChange = "transform";
    }
    reservedActionCluster = cluster;
  }

  function reserveClaudeInlineBubbleSlot(anchorControl, controls, input, composerRect, inlineShift = 0) {
    reserveClaudeInlineControls(
      getClaudeInlineControlsToShift(controls, anchorControl),
      getClaudeModelControlsToNudge(controls, anchorControl),
      inlineShift
    );
  }

  function reserveClaudeInlineControls(sideControls, modelControls = [], inlineShift = CLAUDE_INLINE_SLOT_WIDTH) {
    const shift = Math.max(0, Math.round(inlineShift));
    const offsetEntries = new Map();

    modelControls.forEach((control) => {
      if (!control.element) return;
      offsetEntries.set(control.element, getClaudeControlTargetOffset(control, shift));
    });

    sideControls.forEach((control) => {
      if (!control.element) return;
      offsetEntries.set(control.element, getClaudeControlTargetOffset(control, shift));
    });

    const elements = [...offsetEntries.keys()].filter((element) => offsetEntries.get(element) !== 0);
    const overflowElements = getClaudeModelOverflowElements(modelControls);

    if (elements.length === 0) {
      releaseClaudeInlineControlSlots();
      return;
    }

    if (reservedActionCluster) {
      releaseActionClusterSlot();
    }

    reservedClaudeInlineControls
      .filter((element) => !elements.includes(element))
      .forEach(restoreReservedTransform);

    reservedClaudeOverflowElements
      .filter((element) => !overflowElements.includes(element))
      .forEach(restoreReservedOverflow);

    overflowElements.forEach(reserveClaudeModelOverflow);

    elements.forEach((element) => {
      if (!element.hasAttribute("data-context-generator-original-transform")) {
        element.setAttribute("data-context-generator-original-transform", element.style.transform || "");
      }

      const originalTransform = element.getAttribute("data-context-generator-original-transform") || "";
      const offset = offsetEntries.get(element) || 0;
      const targetTransform = `${originalTransform} translateX(${offset}px)`.trim();
      if (element.style.transform !== targetTransform) {
        element.style.transform = targetTransform;
      }
      if (element.style.willChange !== "transform") {
        element.style.willChange = "transform";
      }
    });

    reservedClaudeInlineControls = elements;
    reservedClaudeInlineShift = shift;
    reservedClaudeControlOffsets = offsetEntries;
    reservedClaudeOverflowElements = overflowElements;
  }

  function getClaudeModelOverflowElements(modelControls) {
    const elements = [];

    modelControls.forEach((control) => {
      let node = control.element;
      let depth = 0;

      while (node && node !== document.body && depth < 4) {
        if (!elements.includes(node)) elements.push(node);
        node = node.parentElement;
        depth += 1;
      }
    });

    return elements;
  }

  function reserveClaudeModelOverflow(element) {
    if (!element.hasAttribute("data-context-generator-original-overflow")) {
      element.setAttribute("data-context-generator-original-overflow", element.style.overflow || "");
    }
    if (element.style.overflow !== "visible") {
      element.style.overflow = "visible";
    }
  }

  function getClaudeControlTargetOffset(control, inlineShift = 0) {
    if (isClaudeModelControl(control)) {
      return -CLAUDE_MODEL_LEFT_NUDGE;
    }
    if (isClaudeSideControl(control)) {
      return CLAUDE_SIDE_CONTROL_RIGHT_NUDGE - Math.max(0, Math.round(inlineShift));
    }
    return 0;
  }

  function getClaudeModelControlsToNudge(controls, anchorControl) {
    const anchorCenterY = anchorControl.rect.top + anchorControl.rect.height / 2;

    return controls.filter((control) => {
      const centerY = control.rect.top + control.rect.height / 2;
      return Math.abs(centerY - anchorCenterY) <= 28 && isClaudeModelControl(control);
    });
  }

  function isClaudeModelControl(control) {
    return /\b(model|sonnet|opus|haiku)\b/.test(control?.label || "");
  }

  function isClaudeSideControl(control) {
    return (
      control?.rect?.width <= 84 ||
      /\b(send|submit|mic|microphone|voice|speak|speech|talk|dictation|audio)\b/.test(control?.label || "")
    );
  }

  function getClaudeInlineControlsToShift(controls, anchorControl) {
    const anchorCenterY = anchorControl.rect.top + anchorControl.rect.height / 2;
    const minLeft = anchorControl.rect.left - 160;

    return controls.filter((control) => {
      const centerY = control.rect.top + control.rect.height / 2;
      if (Math.abs(centerY - anchorCenterY) > 28) return false;
      if (control.rect.right < minLeft) return false;
      if (/\b(attach|upload|file|project|sidebar|side bar|menu|navigation|toggle|model|sonnet|opus|haiku)\b/.test(control.label)) {
        return false;
      }
      return control === anchorControl || isClaudeSideControl(control);
    });
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
    releaseActionClusterSlot();
    releaseClaudeInlineControlSlots();
  }

  function releaseActionClusterSlot() {
    if (!reservedActionCluster) return;

    restoreReservedTransform(reservedActionCluster);
    reservedActionCluster = null;
  }

  function releaseClaudeInlineControlSlots() {
    if (!reservedClaudeInlineControls.length) return;

    reservedClaudeInlineControls.forEach(restoreReservedTransform);
    reservedClaudeOverflowElements.forEach(restoreReservedOverflow);
    reservedClaudeInlineControls = [];
    reservedClaudeInlineShift = 0;
    reservedClaudeControlOffsets = new Map();
    reservedClaudeOverflowElements = [];
  }

  function restoreReservedTransform(element) {
    if (!element) return;

    const originalTransform = element.getAttribute("data-context-generator-original-transform") || "";
    element.style.transform = originalTransform;
    element.style.willChange = "";
    element.removeAttribute("data-context-generator-original-transform");
  }

  function restoreReservedOverflow(element) {
    if (!element) return;

    const originalOverflow = element.getAttribute("data-context-generator-original-overflow") || "";
    element.style.overflow = originalOverflow;
    element.removeAttribute("data-context-generator-original-overflow");
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
        updateClaudeLimitNudge();
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
      node.id === HANDOFF_SCRIM_ID ||
      node.id === ONBOARDING_ID ||
      node.id === ONBOARDING_STYLE_ID ||
      node.id === CLAUDE_LIMIT_NUDGE_ID ||
      node.id === "context-generator-styles" ||
      node.dataset.contextGeneratorOwned === "true" ||
      Boolean(node.closest?.(`#${BUBBLE_ID}, #${OVERLAY_ID}, #${HANDOFF_SCRIM_ID}, #${ONBOARDING_ID}, #${CLAUDE_LIMIT_NUDGE_ID}, #context-generator-styles, #${DESTINATION_SHEET_ID}`))
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
    document.addEventListener("focusin", handleFloatingButtonFocusIn);
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
    document.removeEventListener("focusin", handleFloatingButtonFocusIn);
  }

  function handleFloatingButtonFocusIn(event) {
    if (isClaudeComposerFocusTarget(event.target)) {
      dismissClaudeLimitNudge();
    }
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
