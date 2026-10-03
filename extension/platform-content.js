(() => {
  const CONTENT_SCRIPT_LOAD_ID = "platform-content-2026-10-04-free-composer-layouts-v103";
  const INLINE_PILL_SIZE = 36;
  const ownedUiStyleSheets = new Map();
  const CLAUDE_INLINE_STYLE_ID = "context-generator-claude-inline-styles";
  const CLAUDE_INLINE_MARKER = "data-context-generator-claude-inline";
  const CHATGPT_INLINE_STYLE_ID = "context-generator-chatgpt-inline-styles";
  const CHATGPT_INLINE_MARKER = "data-context-generator-chatgpt-inline";
  const PROVIDER_INLINE_STYLE_ID = "context-generator-provider-inline-styles";
  const PROVIDER_INLINE_MARKER = "data-context-generator-provider-inline";
  const INLINE_MOUNT_PLATFORMS = new Set(["claude", "chatgpt", "gemini", "grok", "deepseek"]);
  let providerInlineMount = null;
  let chatGptInlineMount = null;
  let claudeInlineMount = null;
  let inlineBubble = null;
  let reservedClaudeInlineControls = [];
  let reservedClaudeInlineShift = 0;
  let reservedClaudeControlOffsets = new Map();
  let reservedClaudeOverflowElements = [];
  let chatGptPlacementSurface = null;
  let chatGptPlacementResizeObserver = null;
  let chatGptPlacementResizeTargets = [];
  let chatGptPlacementMutationObserver = null;
  let chatGptPlacementMutationRoot = null;
  // Start fast capture on for each page instance; a manual opt-out lasts until reload.
  let claudeJsonCaptureEnabled = true;
  let chatGptJsonCaptureEnabled = true;
  let networkJsonCaptureEnabled = true;
  const INSTANCE_TEARDOWN_KEY = "__contextGeneratorPlatformTeardown";
  const BUBBLE_ID = "context-generator-bubble";
  const OVERLAY_ID = "context-generator-overlay";
  const HANDOFF_SCRIM_ID = "context-generator-handoff-scrim";
  const OVERLAY_PALETTE_STYLE_ID = "context-generator-overlay-palette-styles";
  const ONBOARDING_ID = "context-generator-onboarding";
  const ONBOARDING_STYLE_ID = "context-generator-onboarding-styles";
  const CLAUDE_LIMIT_NUDGE_ID = "context-generator-claude-limit-nudge";
  const DESTINATION_SHEET_ID = "context-generator-destination-sheet";
  const DESTINATION_SHEET_BACKDROP_ID = "context-generator-destination-backdrop";
  const DESTINATION_SHEET_STYLE_ID = "context-generator-destination-sheet-styles";
  const LAST_TRANSFER_STATS_STORAGE_KEY = "context-generator-last-transfer-stats-v1";
  const RAW_TRANSCRIPT_RETENTION_MS = 24 * 60 * 60 * 1000;
  const TRANSFER_TELEMETRY_MESSAGE_TYPE = "RECORD_TRANSFER_TELEMETRY";
  const TRANSFER_TELEMETRY_STAGES = [
    "intent_started",
    "capture_started",
    "capture_completed",
    "summary_request_started",
    "summary_response_started",
    "summary_completed",
    "paste_started",
    "completed"
  ];

  if (window.__contextGeneratorPlatformLoaded === CONTENT_SCRIPT_LOAD_ID) {
    return;
  }

  const previousInstanceTeardown = window[INSTANCE_TEARDOWN_KEY];
  if (typeof previousInstanceTeardown === "function") {
    try {
      previousInstanceTeardown();
    } catch (error) {
      console.warn("[Context Generator] Previous content-script cleanup failed.", error);
    }
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
  const CLAUDE_EMPTY_COMPOSER_Y_NUDGE = -0.5;
  const CLAUDE_EXISTING_CHAT_COMPOSER_Y_NUDGE = -5;
  const CLAUDE_MAX_COMPOSER_HORIZONTAL_PADDING = 160;
  const CLAUDE_MODEL_LEFT_NUDGE = 48;
  const CLAUDE_SIDE_CONTROL_RIGHT_NUDGE = 52;
  const TRANSIENT_COMPOSER_PLACEMENT_GRACE_MS = 700;
  const TRANSIENT_COMPOSER_PLACEMENT_PLATFORMS = new Set(["gemini", "grok", "deepseek"]);
  const INLINE_PATHNAME_POLL_MS = 80;
  const DESTINATION_SHEET_WIDTH = 352;
  const DESTINATION_SHEET_CLOSED_TRANSFORM = "translate3d(0,12px,0) scale(0.96)";
  const DESTINATION_SHEET_EXIT_MS = 200;
  const DESTINATION_TRANSFER_PRESS_MS = 150;
  const DESTINATION_HANDOFF_OVERLAP_MS = 40;
  const HANDOFF_OVERLAY_CLOSED_TRANSFORM = "translate3d(-50%,-50%,0) translateY(10px) scale(0.985)";
  const HANDOFF_OVERLAY_EXIT_MS = 220;
  // Covers the 210-second summary ceiling plus one prepared and one fresh paste attempt.
  const RUNNING_AUTO_RESET_MS = 360000;
  const DEFAULT_MAX_COMPOSER_WIDTH = 1320;
  const DESTINATION_TITLE_TEXT = "Where to continue?";
  const DESTINATION_HELPER_TEXT = "Context goes straight into the input box";
  const ONBOARDING_STORAGE_KEY = "context-generator-onboarding-dismissed-v2";
  const ONBOARDING_TITLE_TEXT = "Transfer chat context";
  const ONBOARDING_BODY_TEXT = "From this button.";
  const CLAUDE_LIMIT_NUDGE_TEXT = "Claude's brilliant. Claude's also broke by message 20. We've got you covered. Tap to continue in another AI with context.";
  const ONBOARDING_SHOW_DELAY_MS = 650;
  const NO_CONVERSATION_ERROR_TITLE = "Chat is empty";
  const NO_CONVERSATION_ERROR_MESSAGE = "Send a message first, then try again.";
  const SUMMARY_RETRY_ERROR_TITLE = "Try again";
  const SUMMARY_RETRY_ERROR_MESSAGE = "Try again right now. We might have made a mistake. It almost never happens the second time.";
  // Keep this aligned with api/request-security.js so unsupported captures never leave the extension.
  const MAX_BACKEND_CONVERSATION_CHARS = 350000;
  const TINY_DIRECT_PROFILE_MAX_CHARS = 1200;
  // ChatGPT and Grok do not reliably hydrate or retain composer inserts while inactive.
  // Their source-side completion cue must finish before the background performs the focused paste.
  const FOCUSED_PASTE_DESTINATIONS = new Set(["chatgpt", "grok"]);
  const OVERSIZED_CONVERSATION_ERROR_MESSAGE = "Conversation exceeds the supported 350,000 character limit";
  const CONVERSATION_SCRAPE_RETRY_TIMEOUT_MS = 1800;
  const CONVERSATION_SCRAPE_RETRY_INTERVAL_MS = 140;
  const SOURCE_SCROLL_STABLE_TIMEOUT_MS = 1800;
  const SOURCE_SCROLL_LONG_STABLE_TIMEOUT_MS = 4500;
  const SOURCE_SCROLL_STABLE_INTERVAL_MS = 140;
  const SOURCE_SCROLL_STABLE_SAMPLE_COUNT = 3;
  // Grok's rendered message window updates promptly after an instant scroll. Keep its
  // capture path responsive without weakening the conservative waits used elsewhere.
  const GROK_SOURCE_SCROLL_STABLE_TIMEOUT_MS = 700;
  const GROK_SOURCE_SCROLL_STABLE_INTERVAL_MS = 40;
  const GROK_SOURCE_SCROLL_STABLE_SAMPLE_COUNT = 2;
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
  const GROK_VIRTUAL_SWEEP_STEP_RATIO = 0.7;
  const GROK_VIRTUAL_SWEEP_OVERLAP_STEP_RATIO = 0.9;
  const GROK_VIRTUAL_SWEEP_SETTLE_MS = 100;
  const GROK_VIRTUAL_SWEEP_STABLE_SAMPLE_COUNT = 2;
  const GROK_VIRTUAL_SWEEP_CHANGE_POLL_MS = 10;
  const GROK_VIRTUAL_SWEEP_SLOW_CHANGE_TIMEOUT_MS = 160;
  const GROK_VIRTUAL_SWEEP_DELAYED_RENDER_TIMEOUT_MS = 220;
  const COLLAPSED_CONVERSATION_EXPAND_RE = /\b(?:show|see|read|view)\s+(?:more|full|all)\b|\bcontinue\s+(?:reading|message|response)\b|\bexpand\b/i;
  const COLLAPSED_CONVERSATION_EXPAND_EXCLUDE_RE = /\b(?:continue generating|regenerate|send|submit|stop generating|new chat|settings|menu|voice|microphone)\b/i;
  const PASTED_CONTENT_TITLE_RE = /^\s*pasted\s+(?:content|text)\s*$/i;
  const PASTED_CONTENT_BADGE_RE = /^\s*pasted\s*$/i;
  const CLAUDE_PASTED_TEXT_BUTTON_LABEL_RE = /^\s*pasted\s+text\b/i;
  const PASTED_CONTENT_CARD_INTERACTIVE_SELECTOR = "button, [role='button'], [tabindex='0']";
  const PASTED_CONTENT_PAYLOAD_SELECTOR = [
    "pre",
    "code",
    "textarea",
    "[class*='whitespace-pre' i]",
    "[class*='font-mono' i]",
    "[data-testid*='content' i]"
  ].join(",");
  const PASTED_CONTENT_PANEL_TIMEOUT_MS = 1000;
  const PASTED_CONTENT_VIRTUAL_SETTLE_TIMEOUT_MS = 600;
  const PASTED_CONTENT_VIRTUAL_MAX_SCROLLS = 250;
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
  const PASTE_STABILITY_MS = 550;
  const HANDOFF_COUNTDOWN_ID = "context-generator-handoff-countdown";
  const HANDOFF_REASSURANCE_ID = "context-generator-handoff-reassurance";
  const HANDOFF_REASSURANCE_TEXT = "Taking a little longer—still working.";
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
  const HANDOFF_TINY_STAGE_LINE_DURATION_MS = 320;
  const HANDOFF_FINAL_LINE_DURATION_MS = 1000;
  const HANDOFF_FINAL_PAINT_WAIT_MS = 120;
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
  const CHATGPT_CONVERSATION_TURN_SELECTOR = "[data-testid^='conversation-turn']";
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
      maxComposerHeight: 720,
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
      pasteRetryTimeoutMs: CHATGPT_PASTE_RETRY_TIMEOUT_MS,
      pasteVerifyTimeoutMs: CHATGPT_PASTE_VERIFY_TIMEOUT_MS,
      pasteStabilityMs: PASTE_STABILITY_MS,
      maxComposerWidth: 1120,
      maxComposerHeight: 720,
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
      maxComposerWidth: 1080,
      maxComposerHeight: 720,
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
      // Grok expands the whole composer after large pastes; the shared 260px cap
      // would reject that real surface and anchor the bubble to an inner editor.
      maxComposerHeight: 720,
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
      maxComposerWidth: 1140,
      // DeepSeek also expands the whole composer after large pastes.
      maxComposerHeight: 720,
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
  let activeTransferTrace = null;
  let runningResetTimer = null;
  let reservedActionCluster = null;
  let reservedComposerSurface = null;
  let destinationSheetAnimationFrame = null;
  let destinationSheetHideTimer = null;
  let destinationBackdropHideTimer = null;
  let pendingHandoffOrigin = null;
  let handoffOverlayHideTimer = null;
  let handoffScrimHideTimer = null;
  let floatingButtonFrame = null;
  let floatingButtonObserver = null;
  let platformPlacementResizeObserver = null;
  let platformPlacementResizeTargets = [];
  let providerControlMutationObserver = null;
  let providerControlMutationRoot = null;
  let pastedContentCardAttempts = new WeakMap();
  // Detail panels are portaled outside the message DOM. Keep their payload tied
  // to the inner user node, then rejoin it to whichever containing turn wins.
  const capturedPastedContent = [];
  let retainedPlatformInput = null;
  let pendingPasteRecheck = null;
  let transientComposerPlacement = null;
  let transientComposerPlacementGraceTimer = null;
  let lastInlinePlacementPathname = window.location.pathname;
  let inlinePathnamePollTimer = null;
  let pendingFloatingButtonReasons = new Set();
  let floatingButtonMonitoringDisabled = false;
  let handoffCountdownTimer = null;
  let handoffCountdownHideTimer = null;
  let handoffActivityProgressFrame = null;
  let handoffCaptureProgressFrame = null;
  let onboardingTimer = null;
  let onboardingDismissedThisSession = false;
  let claudeLimitNudgeDismissedUntilLimitClears = false;
  let lastConversationCaptureMetrics = null;
  let sourceScrollTargetsCache = null;
  let chatGptConversationScrollRootCache = null;
  let instanceActive = true;
  const ownedTimeouts = new Set();
  const ownedIntervals = new Set();
  const ownedAnimationFrames = new Set();
  const ownedObservers = new Set();
  const ownedEventListeners = [];

  function setTimeout(callback, delayMs, ...args) {
    if (!instanceActive) return null;
    let timer = null;
    timer = window.setTimeout((...callbackArgs) => {
      ownedTimeouts.delete(timer);
      if (instanceActive) callback(...callbackArgs);
    }, delayMs, ...args);
    ownedTimeouts.add(timer);
    return timer;
  }

  function clearTimeout(timer) {
    if (timer == null) return;
    ownedTimeouts.delete(timer);
    window.clearTimeout(timer);
  }

  function setInterval(callback, delayMs, ...args) {
    if (!instanceActive) return null;
    const timer = window.setInterval((...callbackArgs) => {
      if (instanceActive) callback(...callbackArgs);
    }, delayMs, ...args);
    ownedIntervals.add(timer);
    return timer;
  }

  function clearInterval(timer) {
    if (timer == null) return;
    ownedIntervals.delete(timer);
    window.clearInterval(timer);
  }

  function requestAnimationFrame(callback) {
    if (!instanceActive) return null;
    let frame = null;
    frame = window.requestAnimationFrame((timestamp) => {
      ownedAnimationFrames.delete(frame);
      if (instanceActive) callback(timestamp);
    });
    ownedAnimationFrames.add(frame);
    return frame;
  }

  function cancelAnimationFrame(frame) {
    if (frame == null) return;
    ownedAnimationFrames.delete(frame);
    window.cancelAnimationFrame(frame);
  }

  function createOwnedObserver(ObserverType, callback) {
    const observer = new ObserverType(callback);
    const nativeDisconnect = observer.disconnect.bind(observer);
    observer.disconnect = () => {
      ownedObservers.delete(observer);
      nativeDisconnect();
    };
    ownedObservers.add(observer);
    return observer;
  }

  function addOwnedEventListener(target, type, listener, options) {
    const alreadyRegistered = ownedEventListeners.some((entry) => (
      entry.target === target &&
      entry.type === type &&
      entry.listener === listener &&
      entry.options === options
    ));
    if (!target?.addEventListener || alreadyRegistered) return;
    target.addEventListener(type, listener, options);
    ownedEventListeners.push({ target, type, listener, options });
  }

  function removeOwnedEventListener(target, type, listener, options) {
    target?.removeEventListener?.(type, listener, options);
    const index = ownedEventListeners.findIndex((entry) => (
      entry.target === target &&
      entry.type === type &&
      entry.listener === listener &&
      entry.options === options
    ));
    if (index >= 0) ownedEventListeners.splice(index, 1);
  }

  function clearOwnedLifecycleResources() {
    [...ownedObservers].forEach((observer) => observer.disconnect());
    [...ownedTimeouts].forEach((timer) => window.clearTimeout(timer));
    [...ownedIntervals].forEach((timer) => window.clearInterval(timer));
    [...ownedAnimationFrames].forEach((frame) => window.cancelAnimationFrame(frame));
    ownedTimeouts.clear();
    ownedIntervals.clear();
    ownedAnimationFrames.clear();
    ownedEventListeners.splice(0).forEach(({ target, type, listener, options }) => {
      target?.removeEventListener?.(type, listener, options);
    });
  }

  function teardownContextGeneratorInstance() {
    if (!instanceActive) return;
    instanceActive = false;
    if (activeTransferTrace) activeTransferTrace.expired = true;
    cancelPendingPasteRecheck();
    extensionRuntime.onMessage.removeListener?.(handleRuntimeMessage);
    disableFloatingButtonMonitoring();
    clearOwnedLifecycleResources();
    cleanupContextGeneratorNodes();
    if (window[INSTANCE_TEARDOWN_KEY] === teardownContextGeneratorInstance) {
      delete window[INSTANCE_TEARDOWN_KEY];
    }
    if (window.__contextGeneratorPlatformLoaded === CONTENT_SCRIPT_LOAD_ID) {
      delete window.__contextGeneratorPlatformLoaded;
    }
  }

  function getOwnedLifecycleResourceCounts() {
    return {
      timeouts: ownedTimeouts.size,
      intervals: ownedIntervals.size,
      animationFrames: ownedAnimationFrames.size,
      observers: ownedObservers.size,
      eventListeners: ownedEventListeners.length
    };
  }

  function cleanupContextGeneratorNodes() {
    releaseClaudeInlineMount();
    releaseChatGptInlineMount();
    releaseProviderInlineMount();
    inlineBubble?.remove();
    inlineBubble = null;
    cleanupContextGeneratorReservations();

    if (ownedUiStyleSheets.size) {
      const ownedSheets = new Set(ownedUiStyleSheets.values());
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) => !ownedSheets.has(sheet));
      ownedUiStyleSheets.clear();
    }

    [
      BUBBLE_ID,
      CLAUDE_INLINE_STYLE_ID,
      CHATGPT_INLINE_STYLE_ID,
      PROVIDER_INLINE_STYLE_ID,
      OVERLAY_ID,
      HANDOFF_SCRIM_ID,
      OVERLAY_PALETTE_STYLE_ID,
      ONBOARDING_ID,
      ONBOARDING_STYLE_ID,
      CLAUDE_LIMIT_NUDGE_ID,
      DESTINATION_SHEET_ID,
      DESTINATION_SHEET_BACKDROP_ID,
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
      if (element.hasAttribute("data-context-generator-original-transition")) {
        element.style.transition = element.getAttribute("data-context-generator-original-transition") || "";
        element.removeAttribute("data-context-generator-original-transition");
      }
    });

    document.querySelectorAll("[data-context-generator-original-translate]").forEach((element) => {
      element.style.translate = element.getAttribute("data-context-generator-original-translate") || "";
      element.style.willChange = "";
      element.removeAttribute("data-context-generator-original-translate");
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

  function handleRuntimeMessage(message, _sender, sendResponse) {
    if (message?.type === "CONTEXT_GENERATOR_PING") {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === "PASTE_CONTEXT") {
      const pasteStartedAt = getNow();
      pasteIntoPlatform(message.text, message.destination, message.transferId, message.deadlineAt)
        .then(() => {
          const pasteMs = Math.round(getNow() - pasteStartedAt);
          sendResponse({ ok: true, timing: { pasteMs } });
        })
        .catch((error) => sendResponse({ ok: false, error: error.message }));

      return true;
    }

    if (message?.type === "START_CONTEXT_TRANSFER") {
      const destination = message.destination || getDefaultDestinationId();
      const trace = createTransferTrace(destination, "extension icon");
      startTransferTelemetry(trace);
      if (isRunning) {
        markTransferTrace(trace, "failed: Context transfer is already running.");
        finishTransferTrace(trace, "unknown_failure");
        sendResponse({ ok: false, error: "Context transfer is already running." });
        return false;
      }

      isRunning = true;
      clearRunningResetTimer();
      startTransferDeadline(trace);
      sendResponse({ ok: true });
      markTransferTrace(trace, "click", { source: "extension icon" });
      runContextFlow(destination, null, null, trace);
      return false;
    }

    return false;
  }

  extensionRuntime.onMessage.addListener(handleRuntimeMessage);
  window[INSTANCE_TEARDOWN_KEY] = teardownContextGeneratorInstance;

  if (window.__CONTEXT_GENERATOR_TEST_HOOKS__?.register) {
    window.__CONTEXT_GENERATOR_TEST_HOOKS__.register({
      scrapeConversationText,
      summarizeWithBackend,
      getConversationRole,
      pasteIntoPlatform,
      editorContainsText,
      findReadyPlatformInput,
      waitForEditorText,
      formatFirefoxContentEditableHtml,
      findClaudeInlineToolbar,
      mountClaudeInlineButton,
      releaseClaudeInlineMount,
      findChatGptInlineToolbar,
      mountChatGptInlineButton,
      releaseChatGptInlineMount,
      mountInlineOrLegacyBackup,
      invalidateInlinePicker,
      hideDestinationSheet,
      findProviderInlineToolbar,
      mountProviderInlineButton,
      releaseProviderInlineMount,
      getGeminiBubblePlacement,
      findGeminiModelSelectorButton,
      getGrokBubblePlacement,
      getDeepSeekBubblePlacement,
      findPlatformInput,
      findComposerSurfaceElement,
      reserveComposerSurface,
      syncPlatformPlacementResizeMonitoring,
      stopPlatformPlacementResizeMonitoring,
      recordTransientComposerPlacement,
      retainTransientComposerPlacement,
      checkInlinePlacementPathname,
      prepareSourceForCapture,
      getSourceScrollStableTimeout,
      getSourceScrollStableInterval,
      getSourceScrollStableSampleCount,
      expandCollapsedConversationContent,
      getConversationTurns,
      getDetectedConversationMessageCount,
      hasSavedSourceConversation,
      collectRenderedConversationTurns,
      scrapeConversationTextWhenReady,
      getVirtualSweepSettleTimeout,
      getVirtualSweepStableSampleCount,
      getVirtualSweepChangePollMs,
      getVirtualSweepStepRatio,
      getVirtualSweepTerminalQuietTimeout,
      createTransferTrace,
      markCaptureDone,
      buildLatestTransferStats,
      getSafeTelemetryFailureReason,
      startFloatingButtonMonitoring,
      teardownContextGeneratorInstance,
      getOwnedLifecycleResourceCounts,
      delay,
      getHandoffProgressState,
      getHandoffProgressStatusText,
      completeHandoffForDestinationReveal
    });
  } else {
    startFloatingButtonMonitoring();
  }

  async function runContextFlow(destinationId, preparedDestinationPromise = null, scrapedConversationText = null, trace = null) {
    const transferTrace = trace || createTransferTrace(destinationId, "transfer");
    transferTrace.destinationId = destinationId;
    startTransferTelemetry(transferTrace);
    let transferStage = "capture";
    let summary = "";
    try {
      checkTransferDeadline(transferTrace);
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
        advanceTransferTelemetryStage(transferTrace, "capture_started");
        await prepareSourceForCapture();
        checkTransferDeadline(transferTrace);
        if (!destinationPrepPromise && getDetectedConversationMessageCount() > 0) {
          destinationPrepPromise = prepareDestinationTab(destinationId, transferTrace);
        }
        transferStage = "capture";
        markTransferTrace(transferTrace, "capture start");
        setHandoffProgress("capture", "active");
        conversationText = await scrapeConversationTextWhenReady();
        checkTransferDeadline(transferTrace);
        markCaptureDone(transferTrace, conversationText);
      }
      destinationPrepPromise = destinationPrepPromise || prepareDestinationTab(destinationId, transferTrace);
      if (!isHandoffOverlayVisible()) {
        showOverlay(destinationId);
      }
      transferStage = "summary";
      summary = await summarizeWithBackend(conversationText, transferTrace);
      checkTransferDeadline(transferTrace);
      stopHandoffCountdown();
      markTransferTrace(transferTrace, "summary available", { chars: summary.length });
      setHandoffProgress("summary", "done");
      transferStage = "destination";
      const preparedDestination = destinationPrepPromise ? await destinationPrepPromise : null;
      checkTransferDeadline(transferTrace);
      markTransferTrace(transferTrace, "tab open done", {
        tabId: preparedDestination?.tabId || null,
        background: preparedDestination?.timing || null
      });
      markTransferTrace(transferTrace, "paste request start");
      setHandoffProgress("paste", "active");
      transferStage = "paste";
      advanceTransferTelemetryStage(transferTrace, "paste_started");
      const requiresFocusedPaste = FOCUSED_PASTE_DESTINATIONS.has(destinationId);
      if (requiresFocusedPaste) {
        await completeHandoffForDestinationReveal(transferTrace);
        checkTransferDeadline(transferTrace);
      }
      const pasteResponse = await notifyBackground({
        type: "TRANSFER_TO_DESTINATION",
        destination: destinationId,
        text: summary,
        preparedTabId: preparedDestination?.tabId || null,
        transferId: transferTrace.id,
        deadlineAt: transferTrace.deadlineAt,
        deferFinalActivation: !requiresFocusedPaste
      });
      checkTransferDeadline(transferTrace);
      markTransferTrace(transferTrace, "paste done", pasteResponse?.timing || null);
      // Keep recovery available on the source even if final activation fails.
      showFallbackModal(summary, getPlatform(destinationId)?.name || "the destination", true);
      if (!requiresFocusedPaste) {
        await completeHandoffForDestinationReveal(transferTrace);
        checkTransferDeadline(transferTrace);
        markTransferTrace(transferTrace, "final tab activate start");
        await notifyBackground({
          type: "ACTIVATE_DESTINATION_TAB",
          destination: destinationId,
          deadlineAt: transferTrace.deadlineAt,
          tabId: pasteResponse?.timing?.tabId || null
        });
        checkTransferDeadline(transferTrace);
        markTransferTrace(transferTrace, "final tab activate done");
      }
      markTransferTrace(transferTrace, "transfer complete");
      finishTransferTrace(transferTrace);
      resetRunningFlag();
    } catch (error) {
      if (transferTrace.expired) return;
      markTransferTrace(transferTrace, `failed: ${error.message}`);
      finishTransferTrace(transferTrace, getSafeTelemetryFailureReason(error, transferStage));
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
    checkTransferDeadline(trace);
    if (conversationText.length > MAX_BACKEND_CONVERSATION_CHARS) {
      const error = new Error(OVERSIZED_CONVERSATION_ERROR_MESSAGE);
      error.code = "conversation_too_large";
      throw error;
    }

    advanceTransferTelemetryStage(trace, "summary_request_started");
    markTransferTrace(trace, "summary start", { chars: conversationText.length, inputChars: conversationText.length });
    if (conversationText.length <= TINY_DIRECT_PROFILE_MAX_CHARS) {
      // local-direct can return in the same visual beat as capture. Finish the
      // first connector before allowing the summary connector to begin.
      await completeHandoffStageLine("capture", HANDOFF_TINY_STAGE_LINE_DURATION_MS);
      checkTransferDeadline(trace);
    }
    setHandoffProgress("summary", "active", null, conversationText.length);
    startHandoffCountdown(getHandoffSummaryLineDuration(conversationText.length));
    let summary;
    let timing;
    try {
      const response = await notifyBackground({
        type: "SUMMARIZE_WITH_BACKEND",
        conversation: conversationText,
        transferId: trace?.id || null,
        deadlineAt: trace?.deadlineAt
      });
      if (!response?.summary?.trim()) {
        throw new Error("Backup summarizer returned no summary.");
      }
      summary = response.summary.trim();
      timing = response.timing || null;
    } catch {
      checkTransferDeadline(trace);
      // The verified transcript stays in the source page even when the backend
      // or MV3 worker is unavailable. Paste failure still offers manual copy.
      const quotedTranscript = conversationText.replace(/\r\n?/g, "\n").trim()
        .split("\n").map(line => `> ${line}`).join("\n");
      summary = ["CONTEXT CARRY — READY TO PASTE", "", "💬 CONVERSATION SO FAR",
        quotedTranscript, "", "🔁 NEXT STEP",
        'Reply only: "Context loaded. Let\'s pick up right where you left off." Then wait for the user.'
      ].join("\n");
      timing = {
        source: "local",
        requestChars: conversationText.length,
        chars: summary.length,
        backend: {
          servedBy: "local-direct", provider: "local-direct", model: "local-direct",
          inputChars: conversationText.length, outputChars: summary.length,
          fallback: { attempted: true, used: true, servedBy: "local-direct",
            model: "local-direct", reason: "summary_service_unavailable" }
        }
      };
    }
    checkTransferDeadline(trace);
    markTransferTrace(trace, "summary done", {
      chars: summary.length,
      background: timing
    });
    advanceTransferTelemetryStage(trace, "summary_completed");
    return summary;
  }

  function prepareDestinationTab(destinationId, trace = null) {
    markTransferTrace(trace, "tab open start", { destination: destinationId });
    return notifyBackground({
      type: "PREPARE_DESTINATION",
      destination: destinationId,
      transferId: trace?.id || null,
      deadlineAt: trace?.deadlineAt
    }).then((response) => {
      markTransferTrace(trace, "tab open response", {
        tabId: response?.tabId || null,
        background: response?.timing || null
      });
      return response;
    }).catch(() => {
      return null;
    });
  }

  function checkTransferDeadline(trace) {
    if (trace?.expired || (trace?.deadlineAt && Date.now() >= trace.deadlineAt)) {
      const error = new Error("Transfer timed out. Please try again.");
      error.code = "transfer_timeout";
      throw error;
    }
  }

  function startTransferDeadline(trace) {
    activeTransferTrace = trace;
    trace.deadlineAt = Date.now() + RUNNING_AUTO_RESET_MS;
    runningResetTimer = setTimeout(() => {
      trace.expired = true;
      markTransferTrace(trace, "failed: Transfer timed out.");
      finishTransferTrace(trace, "client_interrupted");
      resetRunningFlag();
      showErrorOverlay("Transfer timed out. Please try again.");
    }, RUNNING_AUTO_RESET_MS);
  }

  function createTransferTrace(destinationId, source) {
    const id = crypto.randomUUID();
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
    if (trace) {
      trace.rawScrapedText = conversationText;
      trace.telemetryCharacterCount = conversationText.length;
    }
    markTransferTrace(trace, "capture done", {
      chars: conversationText.length,
      ...getConversationCaptureMetrics(conversationText)
    });
    advanceTransferTelemetryStage(trace, "capture_completed");
    setHandoffProgress("capture", "done");
  }

  async function prepareSourceForCapture() {
    const transferTrace = activeTransferTrace;
    checkTransferDeadline(transferTrace);
    sourceScrollTargetsCache = null;
    chatGptConversationScrollRootCache = null;
    // Captured panel text belongs only to one transfer. Reset both collections so
    // repeated transfers or SPA chat changes cannot reuse stale card associations.
    capturedPastedContent.length = 0;
    pastedContentCardAttempts = new WeakMap();
    scrollSourceConversationToTop();
    await waitForConversationCaptureToSettle();
    checkTransferDeadline(transferTrace);
    const expandedCount = await expandCollapsedConversationContent();
    if (expandedCount > 0) {
      await waitForConversationCaptureToSettle(Math.min(1200, getSourceScrollStableTimeout()));
    }
  }

  async function waitForConversationCaptureToSettle(timeoutMs = getSourceScrollStableTimeout()) {
    const transferTrace = activeTransferTrace;
    const startedAt = Date.now();
    let lastSnapshot = getConversationReadinessSnapshot();
    let stableSamples = 0;

    while (Date.now() - startedAt < timeoutMs) {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      await delay(Math.min(getSourceScrollStableInterval(), Math.max(0, remainingMs)));
      checkTransferDeadline(transferTrace);
      scrollSourceConversationToTop();

      const expandedCount = await expandCollapsedConversationContent();
      const nextSnapshot = getConversationReadinessSnapshot();
      if (expandedCount === 0 && isConversationReadinessStable(lastSnapshot, nextSnapshot)) {
        stableSamples += 1;
        if (stableSamples >= getSourceScrollStableSampleCount()) return;
      } else {
        lastSnapshot = nextSnapshot;
        stableSamples = 0;
      }
    }
  }

  function getSourceScrollStableTimeout() {
    if (currentPlatform.id === "grok") return GROK_SOURCE_SCROLL_STABLE_TIMEOUT_MS;
    return currentPlatform.id === "claude" || currentPlatform.id === "chatgpt"
      ? SOURCE_SCROLL_LONG_STABLE_TIMEOUT_MS
      : SOURCE_SCROLL_STABLE_TIMEOUT_MS;
  }

  function getSourceScrollStableInterval() {
    return currentPlatform.id === "grok"
      ? GROK_SOURCE_SCROLL_STABLE_INTERVAL_MS
      : SOURCE_SCROLL_STABLE_INTERVAL_MS;
  }

  function getSourceScrollStableSampleCount() {
    return currentPlatform.id === "grok"
      ? GROK_SOURCE_SCROLL_STABLE_SAMPLE_COUNT
      : SOURCE_SCROLL_STABLE_SAMPLE_COUNT;
  }

  function getConversationReadinessSnapshot() {
    const messageTurns = getConversationTurns().filter((turn) => isDetectedConversationMessage(turn));
    const scrollState = getSourceScrollState();
    return {
      turns: messageTurns,
      signature: messageTurns
        .map(getConversationTurnSnapshotSignature)
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
    timeoutMs = getVirtualSweepSettleTimeout(),
    stableSampleCount = getVirtualSweepStableSampleCount()
  ) {
    const startedAt = Date.now();
    let lastSnapshot = getConversationReadinessSnapshot();
    let latestSnapshot = lastSnapshot;
    let stableSamples = 0;

    while (Date.now() - startedAt < timeoutMs) {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      await delay(Math.min(getSourceScrollStableInterval(), Math.max(0, remainingMs)));

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
    const transferTrace = activeTransferTrace;
    checkTransferDeadline(transferTrace);
    let expandedCount = await capturePastedConversationCards();

    for (let round = 0; round < maxRounds; round += 1) {
      checkTransferDeadline(transferTrace);
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

  async function capturePastedConversationCards() {
    const transferTrace = activeTransferTrace;
    checkTransferDeadline(transferTrace);
    if (currentPlatform.id !== "claude" && currentPlatform.id !== "chatgpt") return 0;

    let capturedCount = 0;
    for (const { turn, card } of getPastedConversationCards()) {
      checkTransferDeadline(transferTrace);
      const attempts = pastedContentCardAttempts.get(card) || 0;
      if (attempts >= 2 || capturedPastedContent.some((entry) => entry.card === card)) continue;
      pastedContentCardAttempts.set(card, attempts + 1);

      let panel = findVisiblePastedContentPanel(turn);
      try {
        if (!panel) {
          card.click?.();
          panel = await waitForPastedContentPanel(turn);
        }
        if (!panel) continue;

        const fullText = await getPastedContentPanelText(panel);
        if (fullText.length < 2) continue;

        const cardAriaLabel = cleanText(card.getAttribute?.("aria-label") || "");
        capturedPastedContent.push({
          turn,
          card,
          cardAriaLabel,
          cardOccurrence: getPastedContentCardOccurrence(card, cardAriaLabel),
          previewText: cleanText(getElementText(card)),
          fullText
        });
        capturedCount += 1;
      } catch (error) {
        console.debug("[Context Generator] Could not capture pasted content:", error?.message || error);
      } finally {
        if (panel && isVisible(panel)) {
          try {
            await closePastedContentPanel(panel);
          } catch (error) {
            console.debug("[Context Generator] Could not close pasted-content panel:", error?.message || error);
          }
        }
      }
    }

    return capturedCount;
  }

  function getPastedConversationCards() {
    const userSelector = currentPlatform.userRoleSelectors?.join(",");
    if (!userSelector) return [];

    const seenCards = new Set();
    const results = [];
    const userTurns = Array.from(document.querySelectorAll(userSelector))
      .filter((turn) => (
        turn.matches?.(userSelector) &&
        isVisible(turn) &&
        getConversationRole(turn) === "User" &&
        isConversationCandidateElement(turn, findPlatformInput())
      ));

    const addCard = (turn, card) => {
      if (!turn || !card || seenCards.has(card)) return;
      seenCards.add(card);
      results.push({ turn, card });
    };

    userTurns.forEach((turn) => {
      const scannedCandidates = [turn, ...Array.from(turn.querySelectorAll("*"))];
      const candidates = new Set(scannedCandidates);
      // Claude exposes the inner <p> as the message candidate while its aria label
      // lives on that candidate's closest parent button.
      scannedCandidates.forEach((candidate) => {
        const parentButton = candidate.closest?.("button");
        if (parentButton) candidates.add(parentButton);
      });
      const interactiveAncestor = turn.closest?.(PASTED_CONTENT_CARD_INTERACTIVE_SELECTOR);
      if (interactiveAncestor) candidates.add(interactiveAncestor);

      Array.from(candidates)
        .filter(isPastedContentCardMarker)
        .forEach((marker) => {
          const interactive = marker.closest?.(PASTED_CONTENT_CARD_INTERACTIVE_SELECTOR);
          const card = interactive && (
            turn.contains(interactive) ||
            interactive.contains?.(turn)
          ) ? interactive : marker;
          addCard(turn, card);
        });
    });

    if (currentPlatform.id === "claude") {
      Array.from(document.querySelectorAll("button[aria-label]"))
        .filter((element) => (
          element instanceof Element &&
          element.localName === "button" &&
          element.hasAttribute?.("aria-label")
        ))
        .filter(isPastedContentCardMarker)
        .forEach((card) => {
          addCard(findPastedContentOwningUserTurn(card, userTurns), card);
        });
    }

    return results;
  }

  function findPastedContentOwningUserTurn(card, userTurns) {
    const directlyRelatedTurn = userTurns.find((turn) => (
      turn === card ||
      turn.contains?.(card) ||
      card.contains?.(turn)
    ));
    if (directlyRelatedTurn) return directlyRelatedTurn;

    // A standalone Claude paste card is itself a user turn even without role metadata.
    return card;
  }

  function getPastedContentCardOccurrence(card, ariaLabel) {
    if (!ariaLabel) return 0;
    const matchingCards = Array.from(document.querySelectorAll("button[aria-label]"))
      .filter((candidate) => (
        candidate instanceof Element &&
        cleanText(candidate.getAttribute?.("aria-label") || "") === ariaLabel
      ));
    return Math.max(0, matchingCards.indexOf(card));
  }

  function isPastedContentCardMarker(element) {
    if (!(element instanceof Element) || !isVisible(element) || isContextGeneratorNode(element)) return false;

    const ariaLabel = cleanText(element.getAttribute?.("aria-label") || "");
    const matchesPastedTextAriaLabel = CLAUDE_PASTED_TEXT_BUTTON_LABEL_RE.test(ariaLabel);
    const closestAriaButton = element.closest?.("button[aria-label]");
    const closestAriaButtonLabel = cleanText(closestAriaButton?.getAttribute?.("aria-label") || "");
    const closestAriaButtonMatchesPastedText = CLAUDE_PASTED_TEXT_BUTTON_LABEL_RE.test(closestAriaButtonLabel);
    if (currentPlatform.id === "claude" && (
      matchesPastedTextAriaLabel ||
      closestAriaButtonMatchesPastedText
    )) {
      return true;
    }

    const metadata = cleanText([
      ariaLabel,
      element.getAttribute?.("title"),
      element.getAttribute?.("data-testid"),
      element.getAttribute?.("data-test-id")
    ].filter(Boolean).join(" ")).replace(/[-_]+/g, " ");
    if (PASTED_CONTENT_TITLE_RE.test(metadata)) return true;

    const text = cleanText(getElementText(element));
    if (PASTED_CONTENT_TITLE_RE.test(text) || PASTED_CONTENT_BADGE_RE.test(text)) return true;
    if (!element.matches?.(PASTED_CONTENT_CARD_INTERACTIVE_SELECTOR)) return false;
    return text.split("\n").slice(-3).some((line) => PASTED_CONTENT_BADGE_RE.test(cleanText(line)));
  }

  async function waitForPastedContentPanel(turn) {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= PASTED_CONTENT_PANEL_TIMEOUT_MS) {
      const panel = findVisiblePastedContentPanel(turn);
      if (panel) return panel;
      await delay(40);
    }
    return null;
  }

  function findVisiblePastedContentPanel(turn) {
    const titles = Array.from(document.querySelectorAll(
      "h1, h2, h3, h4, h5, h6, [role='heading'], [data-testid*='paste' i], [aria-label*='pasted content' i], [aria-label*='pasted text' i]"
    )).filter((element) => (
      !turn.contains(element) &&
      isVisible(element) &&
      isPastedContentPanelTitle(element)
    ));

    for (const title of titles) {
      let fallback = null;
      let node = title.parentElement;
      while (node && node !== document.body && node !== document.documentElement) {
        if (!turn.contains(node) && isVisible(node) && cleanText(getElementText(node)).length >= 40) {
          fallback ||= node;
          if (
            node.matches?.("dialog, [role='dialog'], [aria-modal='true'], aside") ||
            findPastedContentCloseControl(node)
          ) {
            return node;
          }
        }
        node = node.parentElement;
      }
      if (fallback) return fallback;
    }
    return null;
  }

  function isPastedContentPanelTitle(element) {
    const metadata = cleanText([
      element.getAttribute?.("aria-label"),
      element.getAttribute?.("title"),
      element.getAttribute?.("data-testid"),
      element.getAttribute?.("data-test-id")
    ].filter(Boolean).join(" ")).replace(/[-_]+/g, " ");
    return (
      PASTED_CONTENT_TITLE_RE.test(metadata) ||
      PASTED_CONTENT_TITLE_RE.test(cleanText(getElementText(element)))
    );
  }

  async function getPastedContentPanelText(panel) {
    const virtualizedText = await scrapeVirtualizedPastedContentPanel(panel);
    if (virtualizedText?.length >= 2) return virtualizedText;

    const payloadCandidates = Array.from(panel.querySelectorAll(PASTED_CONTENT_PAYLOAD_SELECTOR))
      .filter((element) => (
        isVisible(element) &&
        !element.matches?.("button, [role='button']") &&
        !isPastedContentPanelTitle(element)
      ))
      .map((element) => cleanText(getElementText(element)))
      .filter(Boolean)
      .sort((first, second) => second.length - first.length);

    const lines = cleanText(getElementText(panel)).split("\n");
    while (lines.length && isPastedContentPanelChromeLine(lines[0])) lines.shift();
    while (lines.length && /^(?:copy|close|dismiss)$/i.test(cleanText(lines.at(-1)))) lines.pop();
    const panelText = cleanText(lines.join("\n"));
    return [...payloadCandidates, panelText]
      .filter(Boolean)
      .sort((first, second) => second.length - first.length)[0] || "";
  }

  async function scrapeVirtualizedPastedContentPanel(panel) {
    let renderedRows = getRenderedPastedContentRows(panel);
    if (!renderedRows.length) return null;

    const scrollRoot = findPastedContentScrollRoot(panel, renderedRows[0]);
    const capturedRows = new Map();
    const collectRows = () => {
      getRenderedPastedContentRows(panel).forEach((row) => {
        const index = cleanText(row.getAttribute?.("data-index") || "");
        if (!index) return;
        const text = getPastedContentRowText(row);
        const previous = capturedRows.get(index);
        if (previous === undefined || text.length > previous.length) {
          capturedRows.set(index, text);
        }
      });
    };

    if (!scrollRoot) {
      collectRows();
      return joinPastedContentRows(capturedRows);
    }

    let signature = getPastedContentRowSignature(panel);
    setPastedContentScrollTop(scrollRoot, 0);
    await waitForPastedContentRowsToSettle(panel, signature);

    for (let scrolls = 0; scrolls < PASTED_CONTENT_VIRTUAL_MAX_SCROLLS; scrolls += 1) {
      collectRows();
      const maxScrollTop = Math.max(
        0,
        Number(scrollRoot.scrollHeight || 0) - Number(scrollRoot.clientHeight || 0)
      );
      const currentScrollTop = Number(scrollRoot.scrollTop || 0);
      if (currentScrollTop >= maxScrollTop - 1) break;

      const step = Math.max(1, Math.floor(Number(scrollRoot.clientHeight || 1) * 0.8));
      const nextScrollTop = Math.min(maxScrollTop, currentScrollTop + step);
      signature = getPastedContentRowSignature(panel);
      setPastedContentScrollTop(scrollRoot, nextScrollTop);
      await waitForPastedContentRowsToSettle(panel, signature);
    }

    collectRows();
    return joinPastedContentRows(capturedRows);
  }

  function getRenderedPastedContentRows(panel) {
    return Array.from(panel.querySelectorAll("[data-index]"))
      .filter((row) => isVisible(row) && !isContextGeneratorNode(row));
  }

  function getPastedContentRowText(row) {
    return [row, ...Array.from(row.querySelectorAll?.(PASTED_CONTENT_PAYLOAD_SELECTOR) || [])]
      .filter((element) => !element.matches?.("button, [role='button']"))
      .map((element) => cleanText(getElementText(element)))
      .filter(Boolean)
      .sort((first, second) => second.length - first.length)[0] || "";
  }

  function findPastedContentScrollRoot(panel, row) {
    let node = row?.parentElement || null;
    while (node && panel.contains(node)) {
      const overflowY = String(window.getComputedStyle(node).overflowY || "").toLowerCase();
      if (
        overflowY === "auto" ||
        overflowY === "scroll" ||
        Number(node.scrollHeight || 0) > Number(node.clientHeight || 0) + 1
      ) {
        return node;
      }
      if (node === panel) break;
      node = node.parentElement;
    }
    return null;
  }

  function setPastedContentScrollTop(scrollRoot, top) {
    if (typeof scrollRoot.scrollTo === "function") {
      scrollRoot.scrollTo({ top, left: Number(scrollRoot.scrollLeft || 0), behavior: "auto" });
      return;
    }
    scrollRoot.scrollTop = top;
  }

  async function waitForPastedContentRowsToSettle(panel, previousSignature) {
    const startedAt = Date.now();
    let lastSignature = previousSignature;
    let stableSamples = 0;
    let changed = false;

    while (Date.now() - startedAt <= PASTED_CONTENT_VIRTUAL_SETTLE_TIMEOUT_MS) {
      await delay(40);
      const signature = getPastedContentRowSignature(panel);
      if (signature !== previousSignature) changed = true;
      if (signature === lastSignature) {
        stableSamples += 1;
      } else {
        lastSignature = signature;
        stableSamples = 0;
      }
      if ((changed && stableSamples >= 2) || (!changed && stableSamples >= 3)) return;
    }
  }

  function getPastedContentRowSignature(panel) {
    return getRenderedPastedContentRows(panel)
      .map((row) => {
        const index = cleanText(row.getAttribute?.("data-index") || "");
        const text = getPastedContentRowText(row);
        return `${index}:${text.length}:${text.slice(0, 24)}:${text.slice(-24)}`;
      })
      .join("|");
  }

  function joinPastedContentRows(rows) {
    return cleanText(
      Array.from(rows.entries())
        .sort(([firstIndex], [secondIndex]) => {
          const firstNumber = Number(firstIndex);
          const secondNumber = Number(secondIndex);
          if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
            return firstNumber - secondNumber;
          }
          return firstIndex.localeCompare(secondIndex, undefined, { numeric: true });
        })
        .map(([, text]) => text)
        .join("\n")
    );
  }

  function isPastedContentPanelChromeLine(line) {
    const text = cleanText(line);
    return (
      PASTED_CONTENT_TITLE_RE.test(text) ||
      /^(?:copy|close|dismiss)$/i.test(text) ||
      /\bformatting may be inconsistent from source\b/i.test(text) ||
      /^\d+(?:\.\d+)?\s*(?:kb|mb)\b.*\blines?\b/i.test(text)
    );
  }

  function findPastedContentCloseControl(panel) {
    return Array.from(panel.querySelectorAll("button, [role='button']"))
      .find((element) => (
        isVisible(element) &&
        /\b(?:close|dismiss)\b/i.test(getElementLabel(element, true))
      )) || null;
  }

  async function closePastedContentPanel(panel) {
    const closeControl = findPastedContentCloseControl(panel);
    if (closeControl) {
      closeControl.click?.();
      await delay(60);
    }
    if (isVisible(panel)) {
      try {
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
      } catch (error) {
        console.debug("[Context Generator] Could not close pasted-content panel:", error?.message || error);
      }
      await delay(60);
    }
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
      hasChatGptScrollableOverflow(chatGptConversationScrollRootCache)
    ) {
      return chatGptConversationScrollRootCache;
    }

    const structuralTurnElements = getChatGptStructuralTurnElements();
    const authoritativeRoot = findNearestChatGptScrollableAncestor(structuralTurnElements[0]);
    chatGptConversationScrollRootCache = authoritativeRoot;
    return authoritativeRoot;
  }

  function findNearestChatGptScrollableAncestor(turnElement) {
    let node = turnElement?.parentElement || null;
    while (node instanceof Element) {
      if (hasChatGptScrollableOverflow(node)) return node;
      if (node === document.documentElement) break;
      node = node.parentElement;
    }
    return null;
  }

  function hasChatGptScrollableOverflow(element) {
    if (!(element instanceof Element) || isContextGeneratorNode(element)) return false;
    const overflowY = String(window.getComputedStyle(element).overflowY || "").toLowerCase();
    return overflowY === "auto" || overflowY === "scroll";
  }

  function getChatGptStructuralTurnElements() {
    const structuralSelector = [
      CHATGPT_CONVERSATION_TURN_SELECTOR,
      "[data-message-author-role='user']",
      "[data-message-author-role='assistant']"
    ].join(",");
    const seen = new Set();

    return Array.from(document.querySelectorAll(structuralSelector))
      .filter((element) => element.matches?.(structuralSelector) && !isContextGeneratorNode(element))
      .map((element) => element.closest?.(CHATGPT_CONVERSATION_TURN_SELECTOR) || element)
      .filter((element) => {
        if (!element || seen.has(element)) return false;
        seen.add(element);
        return true;
      });
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
  }

  function finishTransferTrace(trace, telemetryFailureReason = null) {
    if (!trace || trace.completed) return;
    trace.completed = true;
    const totalMs = Math.round(getNow() - trace.startedAt);
    persistLatestTransferStats(trace, totalMs);
    const failed = trace.marks.some((mark) => mark.label.startsWith("failed:"));
    finishTransferTelemetry(
      trace,
      failed ? "failed" : "succeeded",
      failed ? telemetryFailureReason || "unknown_failure" : null
    );
  }

  function formatTraceDetail(detail) {
    if (!detail || typeof detail !== "object") return {};
    return Object.fromEntries(Object.entries(detail).filter(([, value]) => value !== undefined && value !== null));
  }

  function startTransferTelemetry(trace) {
    if (!trace || trace.telemetryStarted) return;
    trace.telemetryStarted = true;
    trace.telemetryLastStage = "intent_started";
    sendTransferTelemetrySnapshot(trace, "started", null);
  }

  function advanceTransferTelemetryStage(trace, lastStage) {
    if (!trace?.telemetryStarted || trace.telemetryFinished) return;
    const currentIndex = TRANSFER_TELEMETRY_STAGES.indexOf(trace.telemetryLastStage);
    const nextIndex = TRANSFER_TELEMETRY_STAGES.indexOf(lastStage);
    if (nextIndex < 0 || nextIndex <= currentIndex) return;
    trace.telemetryLastStage = lastStage;
    sendTransferTelemetrySnapshot(trace, "started", null);
  }

  function sendTransferTelemetrySnapshot(trace, status, failureReason) {
    sendTransferTelemetry({
      attemptId: trace.id,
      attemptedAt: new Date(trace.startedAtEpoch).toISOString(),
      sourcePlatform: trace.sourcePlatformId,
      destinationPlatform: trace.destinationId,
      characterCount: trace.telemetryCharacterCount ?? (failureReason === "no_conversation" ? 0 : null),
      status,
      lastStage: trace.telemetryLastStage,
      failureReason: status === "failed" ? failureReason : null
    });
  }

  function finishTransferTelemetry(trace, status, failureReason) {
    if (!trace || trace.telemetryFinished) return;
    trace.telemetryFinished = true;
    if (status === "succeeded") trace.telemetryLastStage = "completed";
    sendTransferTelemetrySnapshot(trace, status, failureReason);
  }

  function sendTransferTelemetry(event) {
    try {
      const delivery = extensionRuntime.sendMessage({
        type: TRANSFER_TELEMETRY_MESSAGE_TYPE,
        event
      });
      delivery?.catch?.(() => {});
    } catch {
      // Telemetry must never interrupt or alter a transfer.
    }
  }

  function getSafeTelemetryFailureReason(error, stage = "transfer") {
    const codeReasons = {
      conversation_too_large: "conversation_too_large",
      request_too_large: "conversation_too_large",
      rate_limited: "summary_rate_limited",
      service_busy: "summary_service_busy",
      client_not_allowed: "summary_access_denied",
      destination_open_failed: "destination_open_failed",
      paste_failed: "paste_failed",
      user_cancelled: "user_cancelled"
    };
    if (codeReasons[error?.code]) return codeReasons[error.code];
    if (isNoConversationError(error)) return "no_conversation";
    if (isExtensionContextInvalidated(error) || error?.message === "Extension was reloaded. Refresh this AI tab once, then try Cap-Context again.") {
      return "extension_reloaded";
    }
    if (stage === "capture") return "capture_failed";
    if (stage === "summary") return "summary_failed";
    if (stage === "destination") return "destination_open_failed";
    if (stage === "paste") return "paste_failed";
    return "unknown_failure";
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
        cacheHit: summaryTiming?.cacheHit === true,
        cacheAgeMs: summaryTiming?.cacheAgeMs ?? null,
        originalSource: summaryTiming?.originalSource || null,
        originalSummaryMs: summaryTiming?.originalSummaryMs ?? null,
        summaryMs: summaryTiming?.summaryMs ?? null,
        fetchMs: summaryTiming?.fetchMs ?? null,
        parseMs: summaryTiming?.parseMs ?? null,
        outputChars: summaryTiming?.chars ?? backendTiming?.outputChars ?? null,
        requestChars: summaryTiming?.requestChars ?? null,
        backendInputChars: summaryTiming?.backendInputChars ?? backendTiming?.inputChars ?? null,
        backendTotalMs: backendTiming?.totalMs ?? null,
        openrouterMs: backendTiming?.openrouterMs ?? null,
        geminiMs: backendTiming?.geminiMs ?? null,
        mistralMs: backendTiming?.mistralMs ?? null,
        providerMs: backendTiming?.providerMs ?? null,
        providerPasses: backendTiming?.providerPasses ?? null,
        servedBy: backendTiming?.servedBy || backendTiming?.provider || null,
        provider: backendTiming?.provider || backendTiming?.servedBy || null,
        primaryModel: backendTiming?.primaryModel || null,
        model: backendTiming?.model || null,
        modelReason: backendTiming?.modelReason || null,
        modelsTried: sanitizeModelChainForStats(backendTiming?.modelsTried),
        mistralModelsTried: sanitizeModelChainForStats(backendTiming?.mistralModelsTried),
        openrouterModelsTried: sanitizeModelChainForStats(backendTiming?.openrouterModelsTried),
        modelInputChars: backendTiming?.modelInputChars ?? null,
        modelThresholdChars: backendTiming?.modelThresholdChars ?? null,
        modelOverride: backendTiming?.modelOverride === true,
        profile: backendTiming?.profile || null,
        maxTokens: backendTiming?.maxTokens ?? null,
        targetWords: backendTiming?.targetWords ?? null,
        minWords: backendTiming?.minWords ?? null,
        summaryWordCount: backendTiming?.summaryWordCount ?? null,
        mistralPasses: backendTiming?.mistralPasses ?? null,
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
      // Preserve the complete bounded backend chain in Latest Run. The current
      // maximum is four OpenRouter routes + Flash + Flash-Lite + Mistral.
      // Local carry is the outcome, not an additional attempted remote model.
      .slice(0, 8)
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

  async function pasteIntoPlatform(text, destinationId, transferId = null, deadlineAt = null) {
    checkTransferDeadline({ deadlineAt });
    cancelPendingPasteRecheck();
    const destination = getPlatform(destinationId) || currentPlatform;
    if (!destination) {
      throw new Error("This AI destination is not supported.");
    }

    if (!text?.trim()) {
      throw new Error(`No text was provided for ${destination.name}.`);
    }

    const trimmedText = text.trim();

    // Every supported destination uses verified retries, including editor remount recovery.
    await pasteWithRetry(trimmedText, destination, transferId, deadlineAt);
    checkTransferDeadline({ deadlineAt });
    if (destination.id !== "chatgpt") {
      schedulePostActivationPasteRecheck(trimmedText, destination, deadlineAt);
    }
  }

  async function pasteWithRetry(text, destination, transferId = null, deadlineAt = null) {
    const startedAt = Date.now();
    const retryTimeoutMs = destination.pasteRetryTimeoutMs || PASTE_RETRY_TIMEOUT_MS;
    const verifyTimeoutMs = destination.pasteVerifyTimeoutMs || PASTE_VERIFY_TIMEOUT_MS;
    const stabilityMs = destination.pasteStabilityMs || 0;
    let sawInput = false;
    let lastError = null;

    while (Date.now() - startedAt <= retryTimeoutMs) {
      checkTransferDeadline({ deadlineAt });
      const input = findReadyPlatformInput(destination);
      if (input) {
        sawInput = true;
        const alreadyPasted = editorContainsText(input, text);
        // A partial paste and a user draft can look alike. Let destination
        // recovery/manual copy handle either without replacing nonempty text.
        if (!alreadyPasted && getElementText(input).trim()) {
          throw new Error(`${destination.name} editor already contains text. Use an empty chat or copy the context manually.`);
        }
        try {
          if (!alreadyPasted) setEditorText(input, text, destination);

          if (await waitForEditorText(input, text, verifyTimeoutMs)) {
            if (stabilityMs > 0) {
              await delay(stabilityMs);
              if (!input.isConnected || !editorContainsText(input, text)) {
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

    if (!sawInput) {
      throw new Error(`${destination.name} message input element could not be found.`);
    }

    throw lastError || new Error(`Paste operation failed to populate the ${destination.name} editor.`);
  }

  function findPlatformInput(platform = currentPlatform, { readyOnly = false } = {}) {
    const selectors = [...platform.inputSelectors, ...platform.fallbackSelectors];
    const candidates = selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element, index, all) => {
        return (
          all.indexOf(element) === index &&
          isVisible(element) &&
          !element.closest("[aria-hidden='true']") &&
          !isContextGeneratorNode(element)
        );
      });

    // Settings and native modal editors share the same textarea/contenteditable
    // primitives as chat composers. Never let a newly mounted overlay replace
    // the page composer; an already verified input remains eligible below.
    const selectedInput = candidates
      .filter((element) => !isModalEditorCandidate(element) && (!readyOnly || isEditorReady(element)))
      .map((element) => ({ element, score: scoreInputCandidate(element) }))
      .sort((a, b) => b.score - a.score)[0]?.element || null;

    if (selectedInput) {
      if (platform.id === currentPlatform.id) retainedPlatformInput = selectedInput;
      return selectedInput;
    }

    // Native modal/popover systems may aria-hide the background application
    // while leaving its composer visibly mounted. Keep only the already-verified
    // input; removed or geometrically hidden composers still fail closed.
    if (platform.id === currentPlatform.id && retainedPlatformInput?.isConnected && isVisible(retainedPlatformInput)) {
      // Keep the verified reference through a temporary disabled state. A
      // native overlay may hide it from normal queries before it becomes ready.
      return !readyOnly || isEditorReady(retainedPlatformInput) ? retainedPlatformInput : null;
    }

    if (platform.id === currentPlatform.id) retainedPlatformInput = null;
    return null;
  }

  function isModalEditorCandidate(element) {
    return Boolean(element?.closest?.("dialog, [role='dialog'], [aria-modal='true']"));
  }

  function findReadyPlatformInput(platform = currentPlatform) {
    // A disabled or read-only composer can remain visible while a replacement
    // is mounting. Select among ready candidates instead of retrying the
    // highest-scoring unusable element until the paste deadline expires.
    return findPlatformInput(platform, { readyOnly: true });
  }

  function cancelPendingPasteRecheck() {
    if (!pendingPasteRecheck) return;
    clearTimeout(pendingPasteRecheck.timer);
    removeOwnedEventListener(document, "visibilitychange", pendingPasteRecheck.onVisible);
    pendingPasteRecheck = null;
  }

  function schedulePostActivationPasteRecheck(text, destination, deadlineAt = null) {
    const pending = { timer: null, onVisible: null, deadlineAt };
    pendingPasteRecheck = pending;
    pending.onVisible = () => {
      if (deadlineAt && Date.now() >= deadlineAt) {
        if (pendingPasteRecheck === pending) cancelPendingPasteRecheck();
        return;
      }
      if (document.visibilityState === "hidden") return;
      removeOwnedEventListener(document, "visibilitychange", pending.onVisible);
      // A prepared tab may paste while hidden. Start the check after its reveal.
      pending.timer = setTimeout(() => {
        if (pendingPasteRecheck === pending) {
          void recheckPastedContext(text, destination, pending);
        }
      }, PASTE_STABILITY_MS);
    };
    if (document.visibilityState === "hidden") {
      addOwnedEventListener(document, "visibilitychange", pending.onVisible);
    } else {
      pending.onVisible();
    }
  }

  async function recheckPastedContext(text, destination, pending) {
    let needsCopy = true;
    try {
      checkTransferDeadline(pending);
      const input = findReadyPlatformInput(destination);
      if (input && editorContainsText(input, text)) {
        needsCopy = false;
        return;
      }
      // Do not overwrite a draft the user may have started after tab activation.
      if (pendingPasteRecheck === pending && input && !getElementText(input).trim()) {
        setEditorText(input, text, destination);
        if (await waitForEditorText(input, text, destination.pasteVerifyTimeoutMs || PASTE_VERIFY_TIMEOUT_MS)) {
          await delay(PASTE_STABILITY_MS);
          if (input.isConnected && editorContainsText(input, text)) {
            needsCopy = false;
            return;
          }
        }
      }
    } catch (error) {
      if (error?.code === "transfer_timeout") needsCopy = false;
      console.debug("[Context Generator] Delayed paste check failed:", error?.message || error);
    } finally {
      if (pendingPasteRecheck === pending) {
        pendingPasteRecheck = null;
        if (needsCopy) showFallbackModal(text, destination.name);
      }
    }
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
    // Focusing a native composer can restore its saved draft synchronously.
    if (getElementText(element).trim()) {
      if (editorContainsText(element, text)) return;
      throw new Error(`${destination.name} editor already contains text. Use an empty chat or copy the context manually.`);
    }

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

  function waitForEditorText(element, text, timeoutMs) {
    const startedAt = Date.now();

    return new Promise((resolve) => {
      const tick = () => {
        if (!element.isConnected) {
          resolve(false);
          return;
        }
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
    const expected = normalizeVerificationText(text).split(" ").filter(Boolean);
    const actual = normalizeVerificationText(getElementText(element)).split(" ").filter(Boolean);
    if (!expected.length) return false;
    const required = Math.ceil(expected.length * 95 / 100);
    if (actual.length < required) return false;

    // Ordinary pastes, including added list markers, pass in one linear scan.
    let matched = 0;
    for (const word of actual) {
      if (word === expected[matched]) matched++;
      if (matched >= required) return true;
    }

    // Bounded Myers insertion/deletion distance finds the longest ordered word
    // match, even when a missing word occurs again later. A greedy skip would
    // reject good pastes with repeated words. Distance = N + M - 2 * matches.
    const limit = expected.length + actual.length - 2 * required;
    const offset = limit + 1;
    const frontier = new Int32Array(2 * limit + 3).fill(-1);
    frontier[offset + 1] = 0;
    for (let distance = 0; distance <= limit; distance++) {
      for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
        const index = offset + diagonal;
        let x = diagonal === -distance || (diagonal !== distance && frontier[index - 1] < frontier[index + 1])
          ? frontier[index + 1] : frontier[index - 1] + 1;
        let y = x - diagonal;
        while (x < expected.length && y < actual.length && expected[x] === actual[y]) { x++; y++; }
        frontier[index] = x;
        if (x >= expected.length && y >= actual.length) return true;
      }
    }
    return false;
  }

  function normalizeVerificationText(text) {
    // Count visible words, excluding Markdown link targets, fence labels and
    // list markers that rich editors remove when rendering the same text.
    return String(text || "").normalize("NFKC")
      .replace(/^[ \t]*(?:`{3,}|~{3,})[^\r\n]*$/gm, "")
      .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, "$1")
      .replace(/^[ \t]*\d+[.)][ \t]+/gm, "")
      .replace(/^[ \t]*(?:[-+*][ \t]+)?\[[ xX]\][ \t]+/gm, "")
      .replace(/[^\p{L}\p{N}]+/gu, " ").trim().toLowerCase();
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
      `#${DESTINATION_SHEET_BACKDROP_ID}`,
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

    const includeShortExplicitTurns = fitsTinyDirectProfile(messageTurns);
    const usefulTurns = messageTurns.filter((turn) => (
      isUsefulConversationTurn(turn, includeShortExplicitTurns)
    ));
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
    const transferTrace = activeTransferTrace;
    checkTransferDeadline(transferTrace);
    const initialMetrics = lastConversationCaptureMetrics || {};
    const collectedTurns = [];
    const sweepStartedAt = Date.now();
    let scrolls = 0;
    let staleScrolls = 0;
    let totalStaleScrolls = 0;
    let terminalQuietChecks = 0;
    let exitReason = "other";
    let useLargerOverlapStep = false;

    while (true) {
      checkTransferDeadline(transferTrace);
      const expandedCount = await expandCollapsedConversationContent();
      checkTransferDeadline(transferTrace);
      if (expandedCount > 0) {
        await waitForConversationWindowToSettle(Math.min(600, getVirtualSweepSettleTimeout()));
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
      const stepRatio = getVirtualSweepStepRatio(useLargerOverlapStep);
      const step = Math.round(getSourceViewportHeight() * stepRatio);

      checkTransferDeadline(transferTrace);
      pixelMoved = scrollSourceConversationByInstantly(step);
      if (pixelMoved) {
        // This minimum stability window is intentional. Signature changes can happen synchronously after a
        // scroll, but the real page still needs time to mount and finish rendering the new virtualized window.
        afterRenderedSnapshot = await waitForConversationWindowToSettle();
        afterWindowSignature = afterRenderedSnapshot.signature;
        // A busy Grok tab can render after the fast settle window. Wait only when the
        // window has not changed, so the normal path stays quick without skipping a
        // delayed virtualized batch on the next large scroll.
        if (currentPlatform.id === "grok" && afterWindowSignature === beforeWindowSignature) {
          afterRenderedSnapshot = await waitForRenderedConversationWindowChange(
            beforeWindowSignature,
            GROK_VIRTUAL_SWEEP_DELAYED_RENDER_TIMEOUT_MS
          );
          afterWindowSignature = afterRenderedSnapshot.signature;
          if (afterWindowSignature !== beforeWindowSignature) {
            afterRenderedSnapshot = await waitForConversationWindowToSettle();
            afterWindowSignature = afterRenderedSnapshot.signature;
          }
        }
      }

      scrolls += 1;

      if (!pixelMoved && afterWindowSignature === beforeWindowSignature) {
        checkTransferDeadline(transferTrace);
        triedBoundaryAdvance = scrollRenderedConversationBoundaryIntoView(renderedSnapshot.anchor);
        if (triedBoundaryAdvance) {
          afterRenderedSnapshot = await waitForConversationWindowToSettle();
          afterWindowSignature = afterRenderedSnapshot.signature;
        }
      }

      if (afterWindowSignature === beforeWindowSignature && !pixelMoved) {
        afterRenderedSnapshot = await waitForRenderedConversationWindowChange(
          beforeWindowSignature,
          getVirtualSweepTerminalQuietTimeout()
        );
        afterWindowSignature = afterRenderedSnapshot.signature;
        if (afterWindowSignature === beforeWindowSignature && !pixelMoved) {
          terminalQuietChecks += 1;
          exitReason = triedBoundaryAdvance ? "quiet-check-passed" : "no-scroll-movement";
          const afterScrollState = getVirtualSweepScrollLogState();
          reportHandoffCaptureProgress(afterScrollState);
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
    const includeShortExplicitTurns = fitsTinyDirectProfile([...initialMessageTurns, ...sweptTurns]);
    const initialTurns = getComparableConversationTurns(initialMessageTurns, includeShortExplicitTurns);
    const preferredTurns = chooseMoreCompleteConversationTurns(
      initialTurns,
      sweptTurns,
      includeShortExplicitTurns
    );
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

  function getComparableConversationTurns(messageTurns = [], includeShortExplicitTurns = false) {
    const usefulTurns = messageTurns
      .filter((turn) => isUsefulConversationTurn(turn, includeShortExplicitTurns))
      .map((turn) => {
        const comparable = { role: turn.role, text: cleanText(turn.text) };
        if (turn.sourceId) comparable.sourceId = turn.sourceId;
        return comparable;
      });
    return removeExactDuplicateConversationTurns(usefulTurns);
  }

  function chooseMoreCompleteConversationTurns(initialTurns, sweptTurns, includeShortExplicitTurns = false) {
    // Start with the exact turns used by the quick capture, then apply the existing sequence alignment.
    // Matched turns are only replaced when the swept text is longer, so the final choice cannot downgrade text.
    const preferredTurns = initialTurns.map((turn) => ({ ...turn }));
    collectRenderedConversationTurns(
      preferredTurns,
      getComparableConversationTurns(sweptTurns, includeShortExplicitTurns)
    );
    return preferredTurns;
  }

  function areConversationTurnListsIdentical(first, second) {
    return (
      first.length === second.length &&
      first.every((turn, index) => (
        getConversationTurnSnapshotSignature(turn) ===
        getConversationTurnSnapshotSignature(second[index])
      ))
    );
  }

  function collectRenderedConversationTurns(collectedTurns, renderedTurns = getRenderedConversationSnapshot().turns) {
    const normalizedTurns = renderedTurns.map((turn) => {
      const normalized = { role: turn.role, text: cleanText(turn.text) };
      if (turn.sourceId) normalized.sourceId = turn.sourceId;
      return normalized;
    });
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
      collectedTurns.map(getConversationTurnIdentitySignature)
    );
    return renderedTurns.filter((turn) => {
      const signature = getConversationTurnIdentitySignature(turn);
      if (existingSignatures.has(signature)) return false;
      existingSignatures.add(signature);
      return true;
    });
  }

  function areConversationTurnSnapshotsCompatible(first, second) {
    if ((first?.role || "Message") !== (second?.role || "Message")) return false;

    const firstSourceId = cleanText(first?.sourceId || "");
    const secondSourceId = cleanText(second?.sourceId || "");
    if (firstSourceId && secondSourceId) return firstSourceId === secondSourceId;

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
    if (currentPlatform.id === "grok") {
      return useLargerOverlapStep
        ? GROK_VIRTUAL_SWEEP_OVERLAP_STEP_RATIO
        : GROK_VIRTUAL_SWEEP_STEP_RATIO;
    }
    return useLargerOverlapStep ? VIRTUAL_SWEEP_OVERLAP_STEP_RATIO : VIRTUAL_SWEEP_STEP_RATIO;
  }

  function getVirtualSweepSettleTimeout() {
    return currentPlatform.id === "grok" ? GROK_VIRTUAL_SWEEP_SETTLE_MS : VIRTUAL_SWEEP_SETTLE_MS;
  }

  function getVirtualSweepStableSampleCount() {
    return currentPlatform.id === "grok"
      ? GROK_VIRTUAL_SWEEP_STABLE_SAMPLE_COUNT
      : VIRTUAL_SWEEP_STABLE_SAMPLE_COUNT;
  }

  function getVirtualSweepChangePollMs() {
    return currentPlatform.id === "grok"
      ? GROK_VIRTUAL_SWEEP_CHANGE_POLL_MS
      : VIRTUAL_SWEEP_CHANGE_POLL_MS;
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
    if (currentPlatform.id === "grok") return GROK_VIRTUAL_SWEEP_SLOW_CHANGE_TIMEOUT_MS;
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

  async function waitForRenderedConversationWindowChange(previousSignature, timeoutMs) {
    const startedAt = Date.now();
    let nextSnapshot = getRenderedConversationSnapshot();
    if (nextSnapshot.signature !== previousSignature) return nextSnapshot;

    while (Date.now() - startedAt < timeoutMs) {
      const remainingMs = timeoutMs - (Date.now() - startedAt);
      await delay(Math.min(getVirtualSweepChangePollMs(), Math.max(0, remainingMs)));
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
        .map(getConversationTurnSnapshotSignature)
        .join("\u0002")
    };
  }

  function getConversationTurnSignature(role, text) {
    return `${role || "Message"}\u0001${text || ""}`;
  }

  function getConversationTurnIdentitySignature(turn) {
    const sourceId = cleanText(turn?.sourceId || "");
    return sourceId
      ? `${turn?.role || "Message"}\u0001source:${sourceId}`
      : getConversationTurnSignature(turn?.role, cleanText(turn?.text || ""));
  }

  function getConversationTurnSnapshotSignature(turn) {
    return `${getConversationTurnIdentitySignature(turn)}\u0001${cleanText(turn?.text || "")}`;
  }

  function removeExactDuplicateConversationTurns(turns) {
    // ChatGPT exposes stable turn ids. They distinguish a real repeated message
    // from another DOM copy of the same message; platforms without stable ids
    // retain the conservative exact role+text safety pass.
    const seen = new Set();
    return turns.filter((turn) => {
      const signature = getConversationTurnIdentitySignature(turn);
      if (seen.has(signature)) return false;
      seen.add(signature);
      return true;
    });
  }

  function createConversationCapture(text, metrics = {}) {
    // Verified Claude/ChatGPT/Gemini/Grok/DeepSeek JSON strings are source data, including code, pasted
    // bytes and canvas text. DOM cleanup would rewrite NBSP/line whitespace.
    const cleaned = ["claude-json", "chatgpt-json", "gemini-json", "grok-json", "deepseek-json"].includes(metrics.method) ? text : cleanText(text);
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
    const transferTrace = activeTransferTrace;
    checkTransferDeadline(transferTrace);
    const startedAt = Date.now();
    let lastEmptyError = null;

    while (Date.now() - startedAt <= timeoutMs) {
      checkTransferDeadline(transferTrace);
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
      observer = createOwnedObserver(MutationObserver, (mutations) => {
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

      const role = getConversationRole(element);
      const text = attachCapturedPastedContent(element, role, getCleanVisibleText(element));
      if (!text || text.length < 2) return;

      const candidate = {
        element,
        role,
        text
      };
      const sourceId = getConversationTurnSourceId(element);
      if (sourceId) candidate.sourceId = sourceId;
      candidates.push(candidate);
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

    const selectedTurns = turns.map(({ element, role, text, sourceId }) => {
      const turn = { element, role, text };
      if (sourceId) turn.sourceId = sourceId;
      return turn;
    });

    return reconcileCapturedPastedContent(selectedTurns);
  }

  function reconcileCapturedPastedContent(selectedTurns) {
    if (
      (currentPlatform.id !== "claude" && currentPlatform.id !== "chatgpt") ||
      capturedPastedContent.length === 0
    ) {
      return selectedTurns;
    }

    const reconciledTurns = selectedTurns.map((turn) => ({ ...turn }));
    capturedPastedContent.forEach((entry) => {
      if (reconciledTurns.some(({ text }) => text.includes(entry.fullText))) return;

      // Claude can remount the card/message boundary after the detail panel closes.
      // Resolve the current button by its accessible label and occurrence before
      // attaching, so accepted panel text cannot remain tied to discarded DOM nodes.
      const liveCard = resolveLivePastedContentCard(entry);
      const owner = reconciledTurns.find(({ element, role }) => (
        role === "User" &&
        (
          element === liveCard ||
          element.contains?.(liveCard) ||
          liveCard?.contains?.(element) ||
          element === entry.turn ||
          element.contains?.(entry.turn) ||
          entry.turn?.contains?.(element)
        )
      ));

      if (owner) {
        let ownerText = owner.text;
        if (entry.previewText && ownerText.includes(entry.previewText)) {
          ownerText = cleanText(ownerText.replace(entry.previewText, ""));
        }
        owner.text = cleanText([ownerText, entry.fullText].filter(Boolean).join("\n\n"));
        return;
      }

      reconciledTurns.push({
        element: liveCard || entry.card,
        role: "User",
        text: entry.fullText
      });
    });

    reconciledTurns.sort((a, b) => {
      if (a.element === b.element) return 0;
      return a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
    });
    return reconciledTurns;
  }

  function resolveLivePastedContentCard(entry) {
    const ariaLabel = entry.cardAriaLabel;
    if (!ariaLabel) return entry.card;

    const matchingCards = Array.from(document.querySelectorAll("button[aria-label]"))
      .filter((candidate) => (
        candidate instanceof Element &&
        isVisible(candidate) &&
        cleanText(candidate.getAttribute?.("aria-label") || "") === ariaLabel
      ));
    if (matchingCards.includes(entry.card)) return entry.card;
    return matchingCards[entry.cardOccurrence] || matchingCards[0] || entry.card;
  }

  function attachCapturedPastedContent(element, role, originalText) {
    if (
      role !== "User" ||
      (currentPlatform.id !== "claude" && currentPlatform.id !== "chatgpt") ||
      capturedPastedContent.length === 0
    ) {
      return originalText;
    }

    let text = originalText;
    capturedPastedContent
      .filter(({ turn }) => (
        element === turn ||
        element.contains?.(turn) ||
        turn.contains?.(element)
      ))
      .forEach(({ previewText, fullText }) => {
        if (previewText && text.includes(previewText)) {
          text = cleanText(text.replace(previewText, ""));
        }
        if (!text.includes(fullText)) {
          text = cleanText([text, fullText].filter(Boolean).join("\n\n"));
        }
      });
    return text;
  }

  function getConversationTurnSourceId(element) {
    if (currentPlatform.id !== "chatgpt") return "";

    const turnBoundary = element?.closest?.(CHATGPT_CONVERSATION_TURN_SELECTOR);
    const testId = cleanText(turnBoundary?.getAttribute?.("data-testid") || "");
    if (testId) return `testid:${testId.toLowerCase()}`;

    const messageBoundary = element?.closest?.("[data-message-id]");
    const messageId = cleanText(messageBoundary?.getAttribute?.("data-message-id") || "");
    return messageId ? `message:${messageId}` : "";
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

  function fitsTinyDirectProfile(turns = []) {
    const explicitTurns = removeExactDuplicateConversationTurns(
      turns.filter((turn) => turn?.text && hasExplicitConversationRole(turn) && !isEmptyConversationText(turn.text))
    );
    const transcript = explicitTurns
      .map((turn) => `${turn.role}: ${cleanText(turn.text)}`)
      .join("\n\n")
      .trim();
    if (!transcript) return false;

    // The provider-free tiny carry should not lose genuine one- or two-character replies such as "hi".
    return `${currentPlatform.name} conversation:\n\n${transcript}`.length <= TINY_DIRECT_PROFILE_MAX_CHARS;
  }

  function isUsefulConversationTurn(turn, includeShortExplicitTurns = false) {
    if (!turn?.text) return false;

    const text = cleanText(turn.text);
    if (text.length < (includeShortExplicitTurns ? 1 : 3)) return false;
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

  function findClaudeInlineToolbar(input) {
    if (!input?.isConnected || !isVisible(input)) return null;
    const composer = input.closest("[data-cds='ChatComposer']");
    const ownsControl = (node) => !isComposerPopupControl(node, input) &&
      (!composer || node.closest("[data-cds='ChatComposer']") === composer);
    // Native transitions can retain hidden copies; select a visible owned
    // control before deciding that inline mounting is unavailable.
    const findControl = (root, selector) => root && Array.from(root.querySelectorAll(selector))
      .find((node) => node.isConnected && isVisible(node) && ownsControl(node));
    // Reply mode can leave only Send inside ChatComposerActions and move both
    // attachment/model groups into the chin. Preserve the editor's Send inset;
    // the pill belongs in that separate native toolbar, outside animated layers.
    const chin = composer && Array.from(composer.querySelectorAll("[data-cds='ChatComposerChin']"))
      .find((node) => isVisible(node) && ownsControl(node));
    const chinAttach = findControl(chin, "[data-testid='chat-input-attach']");
    const chinModel = findControl(chin, "[data-testid='model-selector-dropdown']");
    if (chinAttach && chinModel) {
      for (let row = chinAttach.parentElement; row && row !== chin; row = row.parentElement) {
        if (!row.contains(chinModel) || getComputedStyle(row).display !== "flex") continue;
        const left = Array.from(row.children).find((node) => node.contains(chinAttach));
        const right = Array.from(row.children).find((node) => node.contains(chinModel));
        const editorBranch = Array.from(composer.children).find((node) => node.contains(input));
        const rect = composer.getBoundingClientRect();
        if (!left || !right || left === right || !editorBranch ||
            getComputedStyle(left).display !== "flex" || getComputedStyle(right).display !== "flex" ||
            rect.width < 180 || rect.width > Math.min(1320, window.innerWidth)) continue;
        let anchor = chinModel;
        while (anchor.parentElement !== right) anchor = anchor.parentElement;
        return { input, host: composer, editorBranch, actions: row, left, right, anchor, chin: true };
      }
    }
    // Claude's named actions container must be a sibling of this editor's
    // branch. Never select a page-wide flex row, another composer, or a popup.
    let host = input.parentElement;
    for (let depth = 0; host && host !== document.body && depth < 10; depth++, host = host.parentElement) {
      if (composer && !composer.contains(host)) break;
      const actions = Array.from(host.children).find((node) => node.getAttribute("data-cds") === "ChatComposerActions");
      if (!actions || actions.contains(input) || isComposerPopupControl(actions, input)) continue;
      const editorBranch = Array.from(host.children).find((node) => node.contains(input));
      const attach = findControl(actions, "[data-testid='chat-input-attach']");
      // Compact existing chats move the model into the composer's separate
      // chin. Accept that variant only within this editor's named composer.
      const model = findControl(actions, "[data-testid='model-selector-dropdown']") ||
        findControl(composer, "[data-testid='model-selector-dropdown']");
      if (!editorBranch || !attach || !model) continue;
      const rows = Array.from(actions.children);
      const left = rows.find((row) => row.contains(attach) && getComputedStyle(row).display === "flex");
      // The hidden Send branch still identifies the compact row in Voice mode.
      const send = Array.from(actions.querySelectorAll("[data-testid='chat-input-send']")).find(ownsControl);
      const right = rows.find((row) => (row.contains(model) || (send && row.contains(send))) && getComputedStyle(row).display === "flex");
      const rect = host.getBoundingClientRect();
      if (!left || !right || left === right || rect.width < 180 || rect.width > Math.min(1320, window.innerWidth)) continue;
      // Mount before the persistent Send/Voice branch, beside the mic even
      // while Send is hidden. Keep the pill outside its animated layers.
      let anchor = send && right.contains(send) ? send : model;
      while (anchor.parentElement !== right) anchor = anchor.parentElement;
      return { input, host, editorBranch, actions, left, right, anchor };
    }
    return null;
  }

  function ensureClaudeInlineStyles() {
    if (document.getElementById(CLAUDE_INLINE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = CLAUDE_INLINE_STYLE_ID;
    style.className = "darkreader";
    style.dataset.contextGeneratorOwned = "true";
    // Native absolute groups can collide even if our slot is inline. Put the
    // two groups in normal flow and let CSS wrap them; no viewport coordinates,
    // control translations, or width-dependent JavaScript are needed.
    // Zero the old leading/trailing float reservations, preserving native side
    // padding. Only the expanded editor's bottom toolbar reservation needs reset.
    style.textContent = `
      [${CLAUDE_INLINE_MARKER}="editor"] {
        padding-bottom:0!important;
        --cmp-lead-w:0px!important; --cmp-trail-w:0px!important; --cmp-wrap-h:0px!important;
      }
      [${CLAUDE_INLINE_MARKER}="actions"], [${CLAUDE_INLINE_MARKER}="chin"] {
        display:flex!important; position:static!important; width:100%!important;
        flex-wrap:wrap!important; align-items:center!important;
        justify-content:space-between!important; gap:6px!important; margin-top:2px!important;
      }
      [${CLAUDE_INLINE_MARKER}="chin"] { box-sizing:border-box!important; }
      [${CLAUDE_INLINE_MARKER}="left"], [${CLAUDE_INLINE_MARKER}="right"] {
        position:static!important; inset:auto!important; max-width:100%!important;
        min-width:0!important; flex-wrap:wrap!important; height:auto!important;
      }
      [${CLAUDE_INLINE_MARKER}="right"] { margin-left:auto!important; }
    `;
    (document.head || document.documentElement).appendChild(style);
    applyOwnedUiStyleSheet(style);
  }

  function retainClaudeInlineMount(bubble, input) {
    const mount = claudeInlineMount;
    if (!mount || mount.bubble !== bubble) return false;
    // Native controls may disappear while sending/docking. Keep the validated
    // inline slot as long as this editor still owns it; never use fixed placement.
    const ownsSlot = (!input || input === mount.input) && mount.input.isConnected &&
      mount.host.isConnected && mount.host.contains(mount.input) && mount.host.contains(mount.actions) &&
      mount.actions.contains(mount.right) && bubble.parentElement === mount.right;
    setBubbleStylesIfChanged(bubble, { visibility: ownsSlot ? "visible" : "hidden" });
    return ownsSlot;
  }

  function releaseClaudeInlineMount() {
    if (!claudeInlineMount) return;
    const { editorBranch, actions, left, right } = claudeInlineMount;
    [editorBranch, actions, left, right].forEach((node) => node.removeAttribute(CLAUDE_INLINE_MARKER));
    claudeInlineMount = null;
    stopProviderControlMutationMonitoring();
  }

  function mountClaudeInlineButton(bubble, input) {
    const toolbar = findClaudeInlineToolbar(input);
    if (!toolbar) {
      if (retainClaudeInlineMount(bubble, input)) return true;
      releaseClaudeInlineMount();
      if (input?.isConnected) {
        // Keep watching a remounted composer's attribute-only toolbar reveal.
        syncProviderControlMutationMonitoring(input, input.closest("[data-cds='ChatComposer']"));
      }
      return false;
    }
    if (claudeInlineMount?.input !== input || claudeInlineMount?.host !== toolbar.host ||
        claudeInlineMount?.editorBranch !== toolbar.editorBranch ||
        claudeInlineMount?.actions !== toolbar.actions ||
        claudeInlineMount?.left !== toolbar.left || claudeInlineMount?.right !== toolbar.right ||
        claudeInlineMount?.anchor !== toolbar.anchor) {
      releaseClaudeInlineMount();
      claudeInlineMount = { ...toolbar, bubble, pathname: window.location.pathname };
    }
    claudeInlineMount.pathname = window.location.pathname;
    // Stable inline updates reuse the scoped native-control observer.
    clearLegacyInlineBackup({ keepControlObserver: true });
    ensureClaudeInlineStyles();
    [...(toolbar.chin ? [] : [[toolbar.editorBranch, "editor"]]),
      [toolbar.actions, toolbar.chin ? "chin" : "actions"], [toolbar.left, "left"], [toolbar.right, "right"]]
      .forEach(([node, value]) => {
        if (node.getAttribute(CLAUDE_INLINE_MARKER) !== value) node.setAttribute(CLAUDE_INLINE_MARKER, value);
      });
    if (bubble.parentElement !== toolbar.right || bubble.nextElementSibling !== toolbar.anchor) {
      toolbar.right.insertBefore(bubble, toolbar.anchor);
    }
    setBubbleSize(bubble, INLINE_PILL_SIZE);
    setBubbleStylesIfChanged(bubble, {
      position: "static", left: "auto", right: "auto", top: "auto", bottom: "auto",
      margin: "0 4px 0 0", flex: `0 0 ${INLINE_PILL_SIZE}px`, alignSelf: "center", display: "flex", visibility: "visible"
    });
    // Attribute-only mode/visibility changes emit no document child-list event.
    syncProviderControlMutationMonitoring(input, input.closest("[data-cds='ChatComposer']") || toolbar.host);
    return true;
  }

  function findChatGptInlineToolbar(input) {
    if (!input?.isConnected || !isVisible(input)) return null;
    const body = input.closest("[data-composer-body]");
    const editor = input.closest("[data-composer-input]");
    if (!body || isComposerPopupControl(body, input)) return null;
    // Free accounts also receive the transition-slot grid. It owns the editor
    // directly and has no responsive-footer/input markers from the other layout.
    const transitionGrid = body.hasAttribute("data-composer-grid");
    if (!transitionGrid && (!editor || !body.contains(editor))) return null;
    // ChatGPT reorders these children when it switches to multiline. Identify
    // them through the attachment navigation target and editor ownership,
    // never through a generic flex selector or a child index.
    const footer = transitionGrid ? body : editor.closest("[data-composer-footer-responsive]");
    if (!footer || !footer.contains(input) || footer.closest("[data-composer-body]") !== body) return null;
    const attach = Array.from(footer.querySelectorAll(transitionGrid
      ? "[data-testid='composer-plus-btn']" : "[data-composer-navigation-target='add-context']"))
      .find((node) => node.matches("button") && isVisible(node) && !isComposerPopupControl(node, input) &&
        node.closest(transitionGrid ? "[data-composer-grid]" : "[data-composer-footer-responsive]") === footer);
    if (!attach) return null;
    const rows = Array.from(footer.children);
    const left = rows.find((row) => row.contains(attach) && !row.contains(input) &&
      (!transitionGrid || row.getAttribute("data-composer-transition-slot") === "leading"));
    const rightRows = rows.filter((row) => row !== left && !row.contains(input) &&
      (!transitionGrid || row.getAttribute("data-composer-transition-slot") === "trailing") &&
      Array.from(row.querySelectorAll("button")).some((button) =>
        !isContextGeneratorNode(button) && isVisible(button) && !isComposerPopupControl(button, input)));
    const rect = body.getBoundingClientRect();
    if (!left || rightRows.length !== 1 || !isVisible(left) || !isVisible(rightRows[0]) ||
        rect.width < 180 || rect.width > Math.min(1320, window.innerWidth)) return null;
    const right = rightRows[0];
    const nativeButtons = Array.from(right.querySelectorAll("button")).filter((button) =>
      !isContextGeneratorNode(button) && isVisible(button) && !isComposerPopupControl(button, input));
    // rightRows already required at least one button using this same predicate.
    // Locate the common native group, including through display:contents
    // wrappers. Its model and Voice branches otherwise overflow a narrow track.
    let controls = nativeButtons[0].parentElement;
    while (controls !== right && !nativeButtons.every((button) => controls.contains(button))) {
      controls = controls.parentElement;
    }
    const model = nativeButtons.find((button) => button.getAttribute("data-composer-navigation-target") === "reasoning" ||
      /\bthink(?:ing)?\b/.test(getElementLabel(button, true)));
    // The model's native wrappers also own its Thinking effort tooltip. Keep
    // our pill outside the entire model branch so its hover/focus stays separate.
    if (model && nativeButtons.length === 1) controls = right;
    const slot = controls;
    let anchor = model || nativeButtons[0];
    while (anchor.parentElement !== slot) anchor = anchor.parentElement;
    const modelBranch = model ? anchor : null;
    return { input, body, footer, left, right, controls, slot, anchor, modelBranch };
  }

  function ensureChatGptInlineStyles() {
    if (document.getElementById(CHATGPT_INLINE_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = CHATGPT_INLINE_STYLE_ID;
    style.className = "darkreader";
    style.dataset.contextGeneratorOwned = "true";
    // Size the grid to its native controls. The model branch gets a real flex
    // box for wrapping, while our pill remains its sibling outside the tooltip.
    // Native hidden states and inline display:none must still win over our flow.
    style.textContent = `
      [${CHATGPT_INLINE_MARKER}="footer"] {
        grid-template-columns:max-content minmax(0,1fr) minmax(0,max-content)!important;
      }
      [${CHATGPT_INLINE_MARKER}="model"]:not([hidden]):not(.hidden) {
        display:inline-flex; align-items:center!important;
        width:auto!important;
        min-width:0!important; max-width:100%!important;
      }
      [${CHATGPT_INLINE_MARKER}="controls"]:not([hidden]):not(.hidden) {
        display:flex; width:100%!important; min-width:0!important;
        max-width:100%!important; flex-wrap:wrap!important; justify-content:flex-end!important;
      }
      [${CHATGPT_INLINE_MARKER}="controls"] > :not(#${BUBBLE_ID}) { flex:0 1 auto!important; }
    `;
    (document.head || document.documentElement).appendChild(style);
    applyOwnedUiStyleSheet(style);
  }

  function releaseChatGptInlineMount() {
    if (!chatGptInlineMount) return;
    chatGptInlineMount.footer.removeAttribute(CHATGPT_INLINE_MARKER);
    chatGptInlineMount.slot.removeAttribute(CHATGPT_INLINE_MARKER);
    chatGptInlineMount.controls.removeAttribute(CHATGPT_INLINE_MARKER);
    chatGptInlineMount.modelBranch?.removeAttribute(CHATGPT_INLINE_MARKER);
    chatGptInlineMount = null;
    stopProviderControlMutationMonitoring();
  }

  function mountChatGptInlineButton(bubble, input) {
    const toolbar = findChatGptInlineToolbar(input);
    if (!toolbar) {
      releaseChatGptInlineMount();
      return false;
    }
    if (chatGptInlineMount?.input !== input || chatGptInlineMount?.body !== toolbar.body ||
        chatGptInlineMount?.footer !== toolbar.footer ||
        chatGptInlineMount?.left !== toolbar.left || chatGptInlineMount?.right !== toolbar.right ||
        chatGptInlineMount?.controls !== toolbar.controls || chatGptInlineMount?.slot !== toolbar.slot ||
        chatGptInlineMount?.anchor !== toolbar.anchor || chatGptInlineMount?.modelBranch !== toolbar.modelBranch) {
      releaseChatGptInlineMount();
      chatGptInlineMount = { ...toolbar, bubble };
    }
    chatGptInlineMount.pathname = window.location.pathname;
    clearLegacyInlineBackup({ keepControlObserver: true });
    ensureChatGptInlineStyles();
    const markers = [[toolbar.footer, "footer"], [toolbar.controls, "controls"]];
    if (toolbar.modelBranch) markers.push([toolbar.modelBranch, "model"]);
    markers.forEach(([node, value]) => {
      if (node.getAttribute(CHATGPT_INLINE_MARKER) !== value) node.setAttribute(CHATGPT_INLINE_MARKER, value);
    });
    if (bubble.parentElement !== toolbar.slot || bubble.nextElementSibling !== toolbar.anchor) {
      toolbar.slot.insertBefore(bubble, toolbar.anchor);
    }
    setBubbleSize(bubble, INLINE_PILL_SIZE);
    setBubbleStylesIfChanged(bubble, {
      position: "static", left: "auto", right: "auto", top: "auto", bottom: "auto",
      margin: "0 6px 0 0", flex: `0 0 ${INLINE_PILL_SIZE}px`, alignSelf: "center", display: "flex", visibility: "visible"
    });
    syncProviderControlMutationMonitoring(input, toolbar.body);
    return true;
  }

  function findProviderInlineToolbar(input) {
    if (!input?.isConnected || !isVisible(input) || isComposerPopupControl(input, input)) return null;
    const nativeControls = (root) => Array.from(root.querySelectorAll("button, [role='button']"))
      .filter((node) => !isContextGeneratorNode(node) && isVisible(node) && !isComposerPopupControl(node, input));
    let surface, row, controls, slot, anchor, dock, editorContainer;
    if (currentPlatform.id === "gemini") {
      surface = input.closest(".text-input-field");
      controls = surface && Array.from(surface.querySelectorAll(".trailing-actions-wrapper"))
        .find((wrapper) => wrapper.closest(".text-input-field") === surface && !wrapper.contains(input) && nativeControls(wrapper).length);
      if (!controls || !input.closest("rich-textarea") || controls.contains(input)) return null;
      const buttons = nativeControls(controls);
      const model = buttons.find((button) => button.getAttribute("data-test-id") === "bard-mode-menu-button");
      // Gemini hides the model trigger on mobile. Its named trailing group is
      // still editor-owned; mount before the native mic/send branch there.
      slot = model?.parentElement || controls;
      anchor = model || buttons[0];
      row = controls;
    } else if (currentPlatform.id === "grok") {
      surface = input.closest(".query-bar");
      const editor = input.closest("[data-testid='chat-input']");
      const buttons = surface ? nativeControls(surface).filter((button) => button.closest(".query-bar") === surface) : [];
      const attach = buttons.find((button) => button.getAttribute("data-testid") === "attach-button");
      const model = buttons.find((button) => button.id === "model-select-trigger");
      if (!editor || !surface?.contains(editor) || !buttons.includes(attach) || !buttons.includes(model)) return null;
      slot = model.closest("[data-query-bar-mode-select]");
      if (!slot || slot.parentElement?.contains(input)) return null;
      controls = slot.parentElement;
      row = attach.parentElement;
      while (row && row !== surface && !row.contains(controls)) row = row.parentElement;
      if (!row || row === surface || row.contains(input)) return null;
      dock = row.parentElement;
      editorContainer = dock.parentElement;
      if (!surface.contains(editorContainer) || !editorContainer.contains(input)) return null;
      anchor = model;
    } else if (currentPlatform.id === "deepseek") {
      // DeepSeek hashes composer classes. Use the file input's associated
      // upload control and circle action, in a sibling row of this textarea.
      if (!input.matches("textarea")) return null;
      for (let node = input.parentElement; node && node !== document.body; node = node.parentElement) {
        const branches = Array.from(node.children);
        const editor = branches.find((branch) => branch.contains(input));
        for (const file of node.querySelectorAll("[type='file']")) {
          const group = file.parentElement;
          // Keep the native file/upload association, allowing intervening
          // non-control siblings and skipping retained file/Send copies.
          let upload = file.previousElementSibling;
          while (upload && (!upload.matches("[role='button']") || !upload.matches(".ds-button") || upload.matches(".ds-button--circle"))) {
            upload = upload.previousElementSibling;
          }
          const send = nativeControls(group).find((button) => button.matches(".ds-button--circle"));
          if (!upload || !send || isComposerPopupControl(upload, input)) continue;
          const toolbar = branches.find((branch) => branch !== editor && branch.contains(group));
          if (!toolbar) continue;
          surface = node; row = toolbar; controls = group; slot = group;
          anchor = isVisible(upload) ? upload : send;
          break;
        }
        if (surface) break;
      }
    } else return null;
    if (!surface || !row || !controls || !slot || !anchor) return null;
    // Each adapter supplies an ancestor slot; this native DOM walk is synchronous.
    while (anchor.parentElement !== slot) anchor = anchor.parentElement;
    const rect = surface.getBoundingClientRect();
    if (!isVisible(row) || !isVisible(slot) || isComposerPopupControl(slot, input) ||
        rect.width < 180 || rect.width > Math.min(1320, window.innerWidth)) return null;
    return { input, surface, row, controls, slot, anchor, dock, editorContainer };
  }

  function releaseProviderInlineMount() {
    providerInlineMount?.markers.forEach(([node]) => node.removeAttribute(PROVIDER_INLINE_MARKER));
    providerInlineMount = null;
  }

  function mountProviderInlineButton(bubble, input) {
    const toolbar = findProviderInlineToolbar(input);
    if (!toolbar) { releaseProviderInlineMount(); return false; }
    const keys = ["input", "surface", "row", "controls", "slot", "anchor", "dock", "editorContainer"];
    if (!providerInlineMount || keys.some((key) => providerInlineMount[key] !== toolbar[key])) {
      releaseProviderInlineMount();
      const markers = [[toolbar.controls, "controls"]];
      if (toolbar.slot !== toolbar.controls) markers.push([toolbar.slot, "slot"]);
      if (toolbar.row !== toolbar.controls) markers.push([toolbar.row, "row"]);
      if (toolbar.dock) markers.push([toolbar.dock, "grok-dock"], [toolbar.editorContainer, "grok-space"]);
      providerInlineMount = { ...toolbar, markers };
    }
    providerInlineMount.pathname = window.location.pathname;
    releaseBubbleSlot();
    releaseComposerSurface();
    clearTransientComposerPlacement();
    stopPlatformPlacementResizeMonitoring();
    syncProviderControlMutationMonitoring(input, toolbar.surface);
    if (!document.getElementById(PROVIDER_INLINE_STYLE_ID)) {
      const style = document.createElement("style");
      style.id = PROVIDER_INLINE_STYLE_ID;
      style.className = "darkreader";
      style.dataset.contextGeneratorOwned = "true";
      style.textContent = `
        [${PROVIDER_INLINE_MARKER}="slot"]:not([hidden]):not(.hidden) { display:inline-flex; align-items:center!important; min-width:0!important; max-width:100%!important; }
        /* Gemini's model wrapper can be a column; keep the pill left of Flash. */
        .text-input-field [${PROVIDER_INLINE_MARKER}="slot"]:not([hidden]):not(.hidden) { flex-direction:row!important; flex-wrap:nowrap!important; }
        [${PROVIDER_INLINE_MARKER}="controls"]:not([hidden]):not(.hidden) { display:flex; align-items:center!important; flex-wrap:wrap!important; min-width:0!important; max-width:100%!important; height:auto!important; }
        [${PROVIDER_INLINE_MARKER}="row"] { flex-wrap:wrap!important; align-items:center!important; justify-content:space-between!important; gap:6px!important; height:auto!important; }
        [${PROVIDER_INLINE_MARKER}="grok-dock"] { position:static!important; inset:auto!important; }
        [${PROVIDER_INLINE_MARKER}="grok-space"] { padding-bottom:0!important; }
      `;
      (document.head || document.documentElement).appendChild(style);
      applyOwnedUiStyleSheet(style);
    }
    providerInlineMount.markers.forEach(([node, value]) => {
      if (node.getAttribute(PROVIDER_INLINE_MARKER) !== value) node.setAttribute(PROVIDER_INLINE_MARKER, value);
    });
    if (bubble.parentElement !== toolbar.slot || bubble.nextElementSibling !== toolbar.anchor) {
      toolbar.slot.insertBefore(bubble, toolbar.anchor);
    }
    setBubbleSize(bubble, INLINE_PILL_SIZE);
    setBubbleStylesIfChanged(bubble, {
      position: "static", left: "auto", right: "auto", top: "auto", bottom: "auto",
      margin: "0 6px 0 0", flex: `0 0 ${INLINE_PILL_SIZE}px`, alignSelf: "center", display: "flex", visibility: "visible"
    });
    return true;
  }

  // Retained Claude legacy helpers from dc1ac96 are inactive; cleanup still
  // restores reservations left by an older injected instance.
  function getClaudeBubblePlacement(composerRect, input = null, composerSurface = null) {
    const controls = getClaudeComposerControlCandidates(composerRect, composerSurface);
    const anchorControl = findClaudeVoiceModeControl(controls) || findClaudeInlineFallbackControl(controls);
    const reservationControls = getClaudeMountedReservationControls(composerSurface, controls);
    const isFreshEmptyComposer = isClaudeFreshEmptyComposer(input);
    const isExistingChatComposer = window.location.pathname.startsWith("/chat/");
    const emptyComposerNudge = isExistingChatComposer
      ? CLAUDE_EXISTING_CHAT_COMPOSER_Y_NUDGE
      : isFreshEmptyComposer ? CLAUDE_EMPTY_COMPOSER_Y_NUDGE : 0;

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
      const top = getClaudeBubbleTop(
        anchorControl.rect,
        composerRect,
        emptyComposerNudge
      );

      return {
        left: Math.round(left),
        top,
        inlineShift: Math.round(inlineShift),
        anchorControl,
        controls,
        reservationControls
      };
    }

    return {
      inlineShift: 0,
      anchorControl: null,
      controls,
      reservationControls
    };
  }

  function getClaudeComposerControlCandidates(composerRect, composerSurface = null) {
    const rowTop = getClaudeComposerControlRowTop(composerRect);

    return Array.from(document.querySelectorAll("button, [role='button'], [tabindex='0']"))
      .filter((element) => (
        element.id !== BUBBLE_ID &&
        !isContextGeneratorNode(element) &&
        (!composerSurface || composerSurface.contains?.(element)) &&
        !isComposerPopupControl(element, composerSurface) &&
        isVisible(element)
      ))
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

  function getClaudeComposerControlRowTop(composerRect) {
    return composerRect.bottom - Math.max(72, composerRect.height * 0.62);
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

  function getClaudeMountedReservationControls(composerSurface, visibleControls) {
    if (!composerSurface) return visibleControls;

    const mountedControls = Array.from(composerSurface.querySelectorAll("button, [role='button'], [tabindex='0']"))
      .filter((element) => element.id !== BUBBLE_ID && !isContextGeneratorNode(element) && element.isConnected && !isComposerPopupControl(element, composerSurface))
      .map((element) => ({
        element,
        label: getElementLabel(element, true),
        rect: element.getBoundingClientRect()
      }))
      .filter((control) => {
        return (
          control.rect.width > 0 &&
          control.rect.width <= 280 &&
          control.rect.height > 0 &&
          control.rect.height <= 84 &&
          /\b(model|sonnet|opus|haiku|send|submit|mic|microphone|voice|speak|speech|talk|dictation|audio)\b/.test(control.label)
        );
      });

    return [...visibleControls, ...mountedControls].filter((control, index, all) => {
      return all.findIndex((candidate) => candidate.element === control.element) === index;
    });
  }

  function isClaudeFreshEmptyComposer(input) {
    return window.location.pathname === "/new" && isClaudeComposerEmpty(input);
  }

  function isClaudeComposerEmpty(input) {
    if (!input) return false;
    const value = /^(input|textarea)$/.test(input.localName || "")
      ? input.value
      : input.innerText || input.textContent;
    return String(value || "").trim() === "";
  }

  function getClaudeCurrentControlOffset(anchorControl) {
    if (!anchorControl) return 0;
    return reservedClaudeControlOffsets.get(anchorControl.element) || 0;
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

  function isClaudeModelControl(control) {
    return /\b(model|sonnet|opus|haiku)\b/.test(control?.label || "");
  }

  function isClaudeSideControl(control) {
    return (
      control?.rect?.width <= 84 ||
      /\b(send|submit|mic|microphone|voice|speak|speech|talk|dictation|audio)\b/.test(control?.label || "")
    );
  }

  function getClaudeBubbleTop(targetRect, composerRect, opticalNudge = 0) {
    const centeredTop = targetRect.top + (targetRect.height - BUBBLE_SIZE) / 2 - composerRect.top;
    // Claude's control row can sit flush with the bottom of a shallower inner
    // surface. Allow only the natural half-height overflow needed to keep the
    // larger Cap Context bubble centered on the native control.
    const bottomOverflow = Math.max(0, (BUBBLE_SIZE - targetRect.height) / 2);
    const maxTop = Math.max(
      BUBBLE_GAP,
      composerRect.height - BUBBLE_SIZE + bottomOverflow
    );
    // Optical alignment may intentionally cross the local surface edge. Apply
    // it after the legacy local bound; fixed-root placement is viewport-clamped.
    return Math.round((clampNumber(centeredTop, BUBBLE_GAP, maxTop) + opticalNudge) * 2) / 2;
  }

  function getClaudeFixedBubblePlacement(localPlacement, composerRect) {
    return clampFixedBubblePlacement(
      composerRect.left + localPlacement.left,
      composerRect.top + localPlacement.top
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

  function reserveClaudeInlineBubbleSlot(anchorControl, controls, input, composerRect, inlineShift = 0) {
    reserveClaudeInlineControls(
      getClaudeInlineControlsToShift(controls, anchorControl),
      getClaudeModelControlsToNudge(controls, anchorControl),
      inlineShift,
      input
    );
  }

  function reserveClaudeInlineControls(
    sideControls,
    modelControls = [],
    inlineShift = CLAUDE_INLINE_SLOT_WIDTH,
    input = null
  ) {
    const shift = Math.max(0, Math.round(inlineShift));
    const reservationOffsets = new Map();
    const controlOffsets = new Map();

    modelControls.forEach((control) => {
      if (!control.element) return;
      const offset = getClaudeControlTargetOffset(control, shift);
      reservationOffsets.set(control.element, offset);
      controlOffsets.set(control.element, offset);
    });

    const switchCluster = findClaudeControlSwitchCluster(sideControls, input);
    sideControls.forEach((control) => {
      if (!control.element) return;
      const offset = getClaudeControlTargetOffset(control, shift);
      controlOffsets.set(control.element, offset);
      if (!switchCluster) reservationOffsets.set(control.element, offset);
    });
    if (switchCluster && sideControls.length > 0) {
      reservationOffsets.set(switchCluster, getClaudeControlTargetOffset(sideControls[0], shift));
    }

    const elements = [...reservationOffsets.keys()].filter((element) => reservationOffsets.get(element) !== 0);
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
      .forEach(restoreReservedTranslate);

    reservedClaudeOverflowElements
      .filter((element) => !overflowElements.includes(element))
      .forEach(restoreReservedOverflow);

    overflowElements.forEach(reserveClaudeModelOverflow);

    elements.forEach((element) => {
      if (!element.hasAttribute("data-context-generator-original-translate")) {
        element.setAttribute("data-context-generator-original-translate", element.style.translate || "");
      }

      const offset = reservationOffsets.get(element) || 0;
      const targetTranslate = `${offset}px 0px`;
      // Keep Cap Context's offset independent from Claude's animated transform.
      // Overriding transform or transition can strand Claude's outgoing visual
      // layer when the editor and control DOM update in separate React commits.
      if (element.style.translate !== targetTranslate) {
        element.style.translate = targetTranslate;
      }
    });

    reservedClaudeInlineControls = elements;
    reservedClaudeInlineShift = shift;
    reservedClaudeControlOffsets = controlOffsets;
    reservedClaudeOverflowElements = overflowElements;
  }

  function findClaudeControlSwitchCluster(sideControls, input = null) {
    const elements = sideControls
      .map((control) => control.element)
      .filter((element, index, all) => element && element.isConnected && all.indexOf(element) === index);
    if (elements.length === 0) return null;

    let node = elements[0].parentElement;
    let depth = 0;
    while (node && node !== document.body && depth < 10) {
      if (input && node.contains?.(input)) break;
      if (elements.every((element) => node.contains?.(element))) {
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);
        if (
          style.display === "grid" &&
          rect.width > 0 && rect.width <= 280 &&
          rect.height > 0 && rect.height <= 84
        ) {
          return node;
        }
      }
      node = node.parentElement;
      depth += 1;
    }
    return null;
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

  function releaseClaudeInlineControlSlots() {
    if (!reservedClaudeInlineControls.length) return;

    reservedClaudeInlineControls.forEach(restoreReservedTranslate);
    reservedClaudeOverflowElements.forEach(restoreReservedOverflow);
    reservedClaudeInlineControls = [];
    reservedClaudeInlineShift = 0;
    reservedClaudeControlOffsets = new Map();
    reservedClaudeOverflowElements = [];
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

  function getClaudeModelControlsToNudge(controls, anchorControl) {
    const anchorCenterY = anchorControl.rect.top + anchorControl.rect.height / 2;

    return controls.filter((control) => {
      const centerY = control.rect.top + control.rect.height / 2;
      return Math.abs(centerY - anchorCenterY) <= 28 && isClaudeModelControl(control);
    });
  }

  function getChatGptFixedBubblePlacement(input) {
    const composerRect = getChatGptPlacementRect(input);
    const inputRect = input.getBoundingClientRect();
    const composerSurface = getRetainedChatGptPlacementSurface(input);
    // Search only actual buttons that share the editor's form or verified
    // composer surface. Streaming response text must never become an anchor.
    const modelButton =
      findChatGptModelSelectorButton(input, composerSurface, null, inputRect) ||
      findChatGptModelSelectorButton(input, composerSurface, composerRect, inputRect);

    if (modelButton) {
      return getFixedBubblePlacementBesideRect(modelButton.getBoundingClientRect());
    }

    if (composerRect) {
      const rowButtons = getChatGptComposerButtonCandidates(input, composerSurface, composerRect);
      // Free plans have no reasoning selector. Anchor before the whole visible
      // control row (including wider pills such as Think), not beside Voice.
      const leftmostControl = rowButtons[0];

      if (leftmostControl) {
        return getFixedBubblePlacementBesideRect(leftmostControl.rect);
      }

      const fallback = getBottomRightRowBubblePlacement(composerRect, 64);
      return clampFixedBubblePlacement(composerRect.left + fallback.left, composerRect.top + fallback.top);
    }

    return clampFixedBubblePlacement(
      inputRect.right - BUBBLE_SIZE - 112,
      inputRect.top + (inputRect.height - BUBBLE_SIZE) / 2
    );
  }

  function getChatGptPlacementRect(input) {
    const retainedSurface = getRetainedChatGptPlacementSurface(input);
    const detectedSurface = retainedSurface ? null : findComposerSurfaceElement(input);
    const composerSurface = retainedSurface || detectedSurface;
    const composerRect = composerSurface?.getBoundingClientRect();
    if (isUsableChatGptPlacementRect(composerRect)) {
      chatGptPlacementSurface = composerSurface;
      syncChatGptPlacementResizeMonitoring(input, composerSurface);
      return composerRect;
    }

    const form = input.closest("form");
    const formRect = form?.getBoundingClientRect();
    if (isUsableChatGptPlacementRect(formRect)) {
      chatGptPlacementSurface = form;
      syncChatGptPlacementResizeMonitoring(input, form);
      return formRect;
    }

    chatGptPlacementSurface = null;
    syncChatGptPlacementResizeMonitoring(input, null);

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

  function getRetainedChatGptPlacementSurface(input) {
    if (
      currentPlatform.id !== "chatgpt" ||
      !chatGptPlacementSurface ||
      !chatGptPlacementSurface.contains?.(input) ||
      isContextGeneratorNode(chatGptPlacementSurface)
    ) {
      return null;
    }

    const rect = chatGptPlacementSurface.getBoundingClientRect();
    const maxWidth = getMaxComposerSurfaceWidth();
    const maxHeight = currentPlatform.maxComposerHeight || 260;
    return (
      rect.width >= 280 &&
      rect.width <= maxWidth &&
      rect.height >= 40 &&
      rect.height <= maxHeight &&
      rect.bottom >= 0 &&
      rect.top <= window.innerHeight
    ) ? chatGptPlacementSurface : null;
  }

  function isUsableChatGptPlacementRect(rect) {
    return Boolean(
      rect &&
      rect.width >= 280 &&
      rect.width <= getMaxComposerSurfaceWidth() &&
      rect.height >= 40 &&
      rect.height <= (currentPlatform.maxComposerHeight || 260) &&
      rect.bottom >= BUBBLE_GAP &&
      rect.top <= window.innerHeight - BUBBLE_GAP &&
      rect.right >= BUBBLE_GAP &&
      rect.left <= window.innerWidth - BUBBLE_GAP
    );
  }

  function syncChatGptPlacementResizeMonitoring(input, composerSurface) {
    syncChatGptPlacementMutationMonitoring(input, composerSurface);

    if (currentPlatform.id !== "chatgpt" || typeof ResizeObserver === "undefined") {
      stopChatGptPlacementResizeMonitoring();
      return;
    }

    const nextTargets = [input, composerSurface].filter((element, index, all) => {
      return element && all.indexOf(element) === index;
    });
    const targetsUnchanged =
      nextTargets.length === chatGptPlacementResizeTargets.length &&
      nextTargets.every((element, index) => element === chatGptPlacementResizeTargets[index]);
    if (targetsUnchanged) return;

    stopChatGptPlacementResizeMonitoring();
    chatGptPlacementResizeObserver = createOwnedObserver(ResizeObserver, () => scheduleFloatingButtonUpdate());
    nextTargets.forEach((element) => chatGptPlacementResizeObserver.observe(element));
    chatGptPlacementResizeTargets = nextTargets;
  }

  function syncChatGptPlacementMutationMonitoring(input, composerSurface) {
    if (
      currentPlatform.id !== "chatgpt" ||
      typeof MutationObserver === "undefined"
    ) {
      stopChatGptPlacementMutationMonitoring();
      return;
    }

    const root = getChatGptComposerControlRoot(input, composerSurface) || input;
    if (root === chatGptPlacementMutationRoot) return;

    stopChatGptPlacementMutationMonitoring();
    chatGptPlacementMutationRoot = root;
    chatGptPlacementMutationObserver = createOwnedObserver(MutationObserver, () => scheduleFloatingButtonUpdate());
    chatGptPlacementMutationObserver.observe(root, {
      attributes: true,
      characterData: true,
      subtree: true,
      // Responsive rows can hide/return without resizing either observed box.
      attributeFilter: ["class", "style", "aria-expanded", "data-state", "hidden"]
    });
  }

  function stopChatGptPlacementMutationMonitoring() {
    chatGptPlacementMutationObserver?.disconnect();
    chatGptPlacementMutationObserver = null;
    chatGptPlacementMutationRoot = null;
  }

  function getChatGptComposerControlRoot(input, composerSurface) {
    const inputForm = input.closest("form");
    if (inputForm?.contains(input)) return inputForm;
    return composerSurface?.contains?.(input) ? composerSurface : null;
  }

  function stopChatGptPlacementResizeMonitoring() {
    chatGptPlacementResizeObserver?.disconnect();
    chatGptPlacementResizeObserver = null;
    chatGptPlacementResizeTargets = [];
  }

  function findChatGptModelSelectorButton(input, composerSurface, composerRect, inputRect = null) {
    const root = getChatGptComposerControlRoot(input, composerSurface);
    if (!root) return null;

    const hasInputScope = !composerRect && inputRect?.width > 0 && inputRect?.height > 0;
    const rowTop = composerRect
      ? composerRect.bottom - Math.max(64, composerRect.height * 0.65)
      : hasInputScope
        ? Math.max(BUBBLE_GAP, inputRect.bottom - 112)
        : window.innerHeight * 0.45;
    const rowBottom = composerRect
      ? composerRect.bottom + 16
      : hasInputScope
        ? Math.min(window.innerHeight - BUBBLE_GAP, inputRect.bottom + 112)
        : window.innerHeight - BUBBLE_GAP;
    const scopeLeft = composerRect
      ? composerRect.left - 12
      : hasInputScope
        ? Math.max(BUBBLE_GAP, inputRect.left - 96)
        : window.innerWidth * 0.22;
    const scopeRight = composerRect
      ? composerRect.right + 12
      : hasInputScope
        // The editor ends before the controls; wider mode labels still belong
        // to the same composer, even when its outer form spans the page.
        ? Math.min(window.innerWidth - BUBBLE_GAP, inputRect.left + getMaxComposerSurfaceWidth())
        : window.innerWidth - BUBBLE_GAP;

    return Array.from(root.querySelectorAll("button"))
      .filter((button) => isChatGptComposerButton(button, input))
      .map((button) => {
        const rect = button.getBoundingClientRect();
        const label = getElementLabel(button, true);
        const text = (button.innerText || button.textContent || "").toLowerCase();
        let score = 0;

        if (/\b(instant|medium|high)\b/.test(text)) score += 180;
        if (/\b(model|intelligence|reasoning|think|thinking)\b/.test(label)) score += 180;
        if (/^(true|menu|listbox|dialog)$/.test(button.getAttribute("aria-haspopup") || "")) score += 140;
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
          rect.width <= 280 &&
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

  function isChatGptComposerButton(button, input) {
    if (button.id === BUBBLE_ID || isContextGeneratorNode(button) || !isVisible(button)) return false;
    return !isComposerPopupControl(button, input);
  }

  function getFixedBubblePlacementBesideRect(targetRect) {
    return clampFixedBubblePlacement(
      targetRect.left - BUBBLE_SIZE - BUBBLE_GAP,
      targetRect.top + (targetRect.height - BUBBLE_SIZE) / 2
    );
  }

  function getChatGptComposerButtonCandidates(input, composerSurface, composerRect) {
    const root = getChatGptComposerControlRoot(input, composerSurface);
    if (!root) return [];

    const rowTop = composerRect.bottom - Math.max(60, composerRect.height * 0.55);

    return Array.from(root.querySelectorAll("button"))
      .filter((button) => isChatGptComposerButton(button, input))
      .map((button) => ({ button, rect: button.getBoundingClientRect() }))
      .filter(({ rect }) => {
        return (
          rect.width > 0 &&
          rect.width <= 180 &&
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

  function clearChatGptPlacementResizeMonitoring() {
    stopChatGptPlacementResizeMonitoring();
    stopChatGptPlacementMutationMonitoring();
    chatGptPlacementSurface = null;
  }

  function getRetainedClaudeComposerSurface(input) {
    if (
      currentPlatform.id !== "claude" ||
      !reservedComposerSurface ||
      !reservedComposerSurface.contains?.(input) ||
      isContextGeneratorNode(reservedComposerSurface)
    ) {
      return null;
    }

    const rect = reservedComposerSurface.getBoundingClientRect();
    const inputRect = input.getBoundingClientRect();
    const maxWidth = getMaxComposerSurfaceWidth();
    const maxHeight = currentPlatform.maxComposerHeight || 260;
    return (
      rect.width >= 280 &&
      rect.width <= maxWidth &&
      rect.height >= 40 &&
      rect.height <= maxHeight &&
      rect.bottom >= 0 &&
      rect.top <= window.innerHeight &&
      isClaudeComposerSurfaceHorizontallyAligned(rect, inputRect) &&
      isClaudeAnchorSurfaceCandidate(reservedComposerSurface, rect)
    ) ? reservedComposerSurface : null;
  }

  function isClaudeComposerSurfaceHorizontallyAligned(rect, inputRect) {
    if (currentPlatform.id !== "claude") return true;

    // Claude's real composer stays close to the editor horizontally, even when
    // a large paste makes it tall. Reject page-sized ancestors so their phantom
    // width cannot push the native voice controls and our orb beyond the border.
    const horizontalPadding =
      Math.max(0, inputRect.left - rect.left) +
      Math.max(0, rect.right - inputRect.right);
    return horizontalPadding <= CLAUDE_MAX_COMPOSER_HORIZONTAL_PADDING;
  }

  function isClaudeAnchorSurfaceCandidate(surface, surfaceRect) {
    if (!surface || !surfaceRect) return false;
    const controls = getClaudeComposerControlCandidates(surfaceRect, surface);
    const hasClaudeSideControl = controls.some((control) => {
      return /\b(send|submit|mic|microphone|voice|speak|speech|talk|dictation|audio)\b/.test(control.label);
    });
    return hasClaudeSideControl && Boolean(
      findClaudeVoiceModeControl(controls) || findClaudeInlineFallbackControl(controls)
    );
  }

  function reserveClaudeModelOverflow(element) {
    if (!element.hasAttribute("data-context-generator-original-overflow")) {
      element.setAttribute("data-context-generator-original-overflow", element.style.overflow || "");
    }
    if (element.style.overflow !== "visible") {
      element.style.overflow = "visible";
    }
  }

  function restoreReservedTranslate(element) {
    if (!element) return;

    element.style.translate = element.getAttribute("data-context-generator-original-translate") || "";
    element.removeAttribute("data-context-generator-original-translate");
  }

  function restoreReservedOverflow(element) {
    if (!element) return;

    const originalOverflow = element.getAttribute("data-context-generator-original-overflow") || "";
    element.style.overflow = originalOverflow;
    element.removeAttribute("data-context-generator-original-overflow");
  }

  function clearLegacyInlineBackup({ keepControlObserver = false } = {}) {
    releaseBubbleSlot();
    releaseComposerSurface();
    stopPlatformPlacementResizeMonitoring();
    if (!keepControlObserver) stopProviderControlMutationMonitoring();
    clearChatGptPlacementResizeMonitoring();
  }

  function mountLegacyInlineBackup(bubble, input) {
    if (currentPlatform.id !== "chatgpt") return false;
    // Inline validation has already failed. Clear its native markers before
    // restoring the old geometry, and reuse the same button across both modes.
    releaseChatGptInlineMount();
    releaseBubbleSlot();
    releaseComposerSurface();
    const placement = getChatGptFixedBubblePlacement(input);
    const root = getFloatingButtonRoot();
    if (bubble.parentElement !== root) root.appendChild(bubble);
    setBubbleFixedMode(bubble);
    setBubbleStylesIfChanged(bubble, {
      left: `${placement.left}px`, right: "auto", top: `${placement.top}px`, bottom: "auto", display: "flex"
    });
    return true;
  }

  function mountInlineOrLegacyBackup(bubble, input) {
    if (currentPlatform.id === "claude") return mountClaudeInlineButton(bubble, input);
    return mountChatGptInlineButton(bubble, input) || mountLegacyInlineBackup(bubble, input);
  }

  function ensureFloatingButton(recalculationReason = "direct") {
    const input = findPlatformInput();
    const existingBubble = document.getElementById(BUBBLE_ID) || inlineBubble || transientComposerPlacement?.bubble || null;
    if (!input) {
      if (currentPlatform.id === "claude" && retainClaudeInlineMount(existingBubble, null)) return existingBubble;
      const retainedBubble = retainTransientComposerPlacement(existingBubble);
      if (retainedBubble) return retainedBubble;
      if (existingBubble) existingBubble.style.display = "none";
      releaseClaudeInlineMount();
      releaseChatGptInlineMount();
      releaseProviderInlineMount();
      clearLegacyInlineBackup();
      hideOnboardingNudge();
      hideClaudeLimitNudge();
      // Composer loss must never move focus to the Cap Context trigger.
      hideDestinationSheet({ restoreFocus: false });
      releaseBubbleSlot();
      releaseComposerSurface();
      return existingBubble;
    }
    const bubble = existingBubble || createFloatingButton();
    if (currentPlatform.id === "claude") {
      // Claude stays inline through send/docking; unmatched owners hide until remount.
      inlineBubble = bubble;
      if (!mountInlineOrLegacyBackup(bubble, input)) {
        bubble.style.display = "none";
        hideOnboardingNudge();
        hideClaudeLimitNudge();
        hideDestinationSheet({ restoreFocus: false });
        return bubble;
      }
      ensureFloatingOverlay();
      maybeShowOnboardingNudge(bubble);
      return bubble;
    }
    if (currentPlatform.id === "chatgpt") {
      inlineBubble = bubble;
      if (!mountInlineOrLegacyBackup(bubble, input)) {
        bubble.style.display = "none";
        hideOnboardingNudge();
        hideDestinationSheet({ restoreFocus: false });
        return bubble;
      }
      ensureFloatingOverlay();
      maybeShowOnboardingNudge(bubble);
      return bubble;
    }
    inlineBubble = bubble;
    if (mountProviderInlineButton(bubble, input)) {
      ensureFloatingOverlay();
      maybeShowOnboardingNudge(bubble);
      return bubble;
    }
    // Unmatched provider variants retain the existing validated fallback.
    const composerSurface = findComposerSurfaceElement(input);
    if (!composerSurface) {
      const retainedBubble = retainTransientComposerPlacement(bubble);
      if (retainedBubble) return retainedBubble;
      bubble.style.display = "none";
      hideOnboardingNudge();
      return bubble;
    }
    reserveComposerSurface(composerSurface);
    if (bubble.parentElement !== composerSurface) composerSurface.appendChild(bubble);
    ensureFloatingOverlay();
    updateFloatingButtonPosition(recalculationReason);
    return bubble;
  }

  function createFloatingButton() {
    const bubble = document.createElement("button");
    bubble.id = BUBBLE_ID;
    bubble.type = "button";
    bubble.tabIndex = -1;
    bubble.title = DESTINATION_TITLE_TEXT;
    bubble.setAttribute("aria-label", DESTINATION_TITLE_TEXT);
    bubble.setAttribute("aria-expanded", "false");
    bubble.setAttribute("aria-controls", DESTINATION_SHEET_ID);
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
      "transform:translate3d(0,0,0) scale(1)",
      "transform-origin:center",
      "transition:opacity 0.2s ease,filter 0.24s ease,transform 0.26s cubic-bezier(0.16,1,0.3,1)",
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

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const updateMotion = () => {
      bubble.style.transition = reducedMotion?.matches
        ? "opacity 0.2s ease,filter 0.24s ease"
        : "opacity 0.2s ease,filter 0.24s ease,transform 0.26s cubic-bezier(0.16,1,0.3,1)";
    };
    updateMotion();
    addOwnedEventListener(reducedMotion, "change", updateMotion);
    // Picker/handoff owns the pressed scale; hovering must not overwrite it.
    const canHover = () => !bubble.disabled && !isRunning && bubble.getAttribute("aria-expanded") !== "true";
    addOwnedEventListener(bubble, "mouseenter", () => {
      if (!canHover()) return;
      bubble.style.filter = "brightness(1.1) saturate(1.08) drop-shadow(0 0 6px rgba(139,92,246,0.38)) drop-shadow(0 3px 5px rgba(0,0,0,0.18))";
      bubble.style.transform = "translate3d(0,-1px,0) scale(1.14)";
    });
    addOwnedEventListener(bubble, "mouseleave", () => {
      if (!canHover()) return;
      bubble.style.filter = "none";
      bubble.style.transform = "translate3d(0,0,0) scale(1)";
    });
    addOwnedEventListener(bubble, "pointerdown", () => {
      if (!bubble.disabled) bubble.style.transform = "translate3d(0,0,0) scale(0.95)";
    });
    addOwnedEventListener(bubble, "pointerup", () => {
      if (!canHover()) return;
      bubble.style.transform = bubble.matches(":hover")
        ? "translate3d(0,-1px,0) scale(1.14)"
        : "translate3d(0,0,0) scale(1)";
    });
    addOwnedEventListener(bubble, "pointercancel", () => {
      bubble.style.transform = "translate3d(0,0,0) scale(1)";
    });
    addOwnedEventListener(bubble, "click", (event) => {
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
    addOwnedEventListener(dismiss, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dismissOnboardingNudge();
    });

    nudge.appendChild(puppetWrap);
    nudge.appendChild(copy);
    nudge.appendChild(dismiss);
    addOwnedEventListener(nudge, "click", (event) => event.stopPropagation());
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

    onboardingTimer = setTimeout(() => {
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
    addOwnedEventListener(nudge, "click", (event) => {
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

  function applyOwnedUiStyleSheet(style) {
    // Page CSP can leave a style node present but ineffective. Adopt our scoped
    // UI rules directly, and resync when palette rules are appended later.
    if (typeof CSSStyleSheet === "undefined" || !("adoptedStyleSheets" in document)) return;
    let sheet = ownedUiStyleSheets.get(style.id);
    if (!sheet) {
      sheet = new CSSStyleSheet();
      ownedUiStyleSheets.set(style.id, sheet);
    }
    sheet.replaceSync(style.textContent);
    if (!document.adoptedStyleSheets.includes(sheet)) {
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
  }

  function ensureDestinationSheetStyles() {
    if (document.getElementById(DESTINATION_SHEET_STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = DESTINATION_SHEET_STYLE_ID;
    // Dark Reader leaves its own stylesheet class alone. Keep picker pseudo-elements
    // and selection states in the extension's palette on sites where it is active.
    style.className = "darkreader";
    style.textContent = `
      @font-face {
        font-family: "Cap Context EB Garamond";
        src: url("${chrome.runtime.getURL("fonts/EBGaramond-Regular.woff2")}") format("woff2");
        font-style: normal;
        font-weight: 400;
        font-display: swap;
      }

      /* Dark Reader can strip importance from colors as it rewrites new inline
         nodes. These ID-scoped fallbacks retain the same palette in that case. */
      #${DESTINATION_SHEET_ID} {
        border-color: rgba(236,229,246,0.17) !important;
        background: radial-gradient(ellipse 68% 48% at 88% -8%,rgba(145,112,199,0.18),transparent 72%),radial-gradient(ellipse 55% 48% at -8% 110%,rgba(82,57,128,0.15),transparent 74%),linear-gradient(180deg,#111012 0%,#0c0b0e 58%,#09080b 100%) !important;
        box-shadow: 0 34px 88px rgba(0,0,0,0.58),0 14px 34px rgba(0,0,0,0.34),0 0 54px rgba(104,76,154,0.1),0 0 0 1px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.09) !important;
        color: #f5f5f5 !important;
      }
      #${DESTINATION_SHEET_BACKDROP_ID} { background: rgba(7,6,10,0.34) !important; }
      #${DESTINATION_SHEET_ID} .context-generator-destination-brand { color: rgba(247,244,250,0.76) !important; }
      #${DESTINATION_SHEET_ID} .context-generator-destination-home-link {
        display: block;
        position: relative !important;
        inset: auto !important;
        flex: 0 0 auto;
        margin: 0;
        padding: 0;
        border: 0 !important;
        border-radius: 9px;
        background: transparent !important;
        box-shadow: none !important;
        line-height: 0;
        text-decoration: none !important;
        cursor: pointer;
      }
      #${DESTINATION_SHEET_ID} .context-generator-destination-home-link:focus-visible {
        outline: 2px solid rgba(190,162,233,0.78) !important;
        outline-offset: 3px;
      }
      #${DESTINATION_SHEET_ID} .context-generator-destination-brand-icon {
        border-color: rgba(185,158,228,0.2) !important;
        background: linear-gradient(145deg,rgba(189,158,238,0.18),rgba(102,72,155,0.1)) !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.08),0 7px 18px rgba(74,48,121,0.2) !important;
      }
      #${DESTINATION_SHEET_ID} .context-generator-destination-title { color: #ffffff !important; }
      #${DESTINATION_SHEET_ID} .context-generator-speed-toggle {
        appearance: none;
        position: relative !important;
        inset: auto !important;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        width: 32px;
        height: 32px;
        margin: 0 0 0 34px;
        padding: 0;
        border: 1px solid transparent !important;
        border-radius: 10px;
        background: transparent !important;
        color: #a9a3b2 !important;
        box-shadow: none !important;
        cursor: pointer;
        transition: background 140ms ease, border-color 140ms ease, color 140ms ease;
      }
      #${DESTINATION_SHEET_ID} .context-generator-speed-toggle:hover {
        background: rgba(255,255,255,0.07) !important;
        border-color: rgba(255,255,255,0.18) !important;
        color: #f1edf7 !important;
      }
      #${DESTINATION_SHEET_ID} .context-generator-speed-toggle[aria-pressed="true"] {
        color: #facc15 !important;
      }
      #${DESTINATION_SHEET_ID} .context-generator-speed-toggle:focus-visible {
        outline: 2px solid rgba(190,162,233,0.78) !important;
        outline-offset: 3px;
      }
      #${DESTINATION_SHEET_ID} .context-generator-speed-toggle svg {
        display: block;
        position: relative;
        z-index: 1;
        width: 16px;
        height: 16px;
        fill: none !important;
        stroke: currentColor !important;
      }
      /* Reserve room behind the bolt so trails stay inside the picker header.
         aria-pressed owns the effect; disabling speed removes its animations. */
      #${DESTINATION_SHEET_ID} .context-generator-speed-lines {
        display: none;
        position: absolute;
        right: 14px;
        top: 8px;
        width: 42px;
        height: 16px;
        overflow: visible;
        pointer-events: none;
        mask-image: linear-gradient(90deg,transparent,#000 28%);
      }
      #${DESTINATION_SHEET_ID} .context-generator-speed-toggle[aria-pressed="true"] .context-generator-speed-lines {
        display: block;
      }
      #${DESTINATION_SHEET_ID} .context-generator-speed-lines i {
        position: absolute;
        right: 1px;
        top: 2px;
        width: 18px;
        height: 1.5px;
        border-radius: 999px;
        background: linear-gradient(90deg,transparent,rgba(250,204,21,0.6) 45%,#fde68a) !important;
        box-shadow: 0 0 4px rgba(250,204,21,0.18) !important;
        transform-origin: right center;
        opacity: 0;
        animation: contextGeneratorSpeedStreak 420ms linear infinite;
      }
      #${DESTINATION_SHEET_ID} .context-generator-speed-lines i:nth-child(2) {
        /* Each origin follows the bolt's sloped left edge, rather than one plane. */
        right: 5px;
        top: 7px;
        width: 27px;
        animation-delay: -140ms;
      }
      #${DESTINATION_SHEET_ID} .context-generator-speed-lines i:nth-child(3) {
        right: 2px;
        top: 12px;
        width: 15px;
        animation-delay: -280ms;
      }
      @keyframes contextGeneratorSpeedStreak {
        0% { opacity: 0; transform: translateX(0) scaleX(0.45); }
        8% { opacity: 0.85; }
        48% { opacity: 0.7; }
        100% { opacity: 0; transform: translateX(-34px) scaleX(1.15); }
      }
      #${DESTINATION_SHEET_ID} .context-generator-destination-tile {
        border-color: rgba(255,255,255,0.1) !important;
        background: linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.022)) !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.055),inset 0 -1px 0 rgba(0,0,0,0.3),0 8px 20px rgba(0,0,0,0.08) !important;
        color: #ffffff !important;
      }
      #${DESTINATION_SHEET_ID} .context-generator-destination-logo-wrap {
        border-color: rgba(255,255,255,0.075) !important;
        background: rgba(4,4,5,0.28) !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.045) !important;
      }
      #${DESTINATION_SHEET_ID} .context-generator-destination-tile-name { color: #f8f6fa !important; }
      #${DESTINATION_SHEET_ID} .context-generator-tile-detail { color: rgba(238,234,242,0.56) !important; }
      #${DESTINATION_SHEET_ID} .context-generator-destination-helper {
        border-top-color: rgba(255,255,255,0.065) !important;
        color: rgba(240,236,244,0.58) !important;
      }

      @font-face {
        font-family: "Cap Context EB Garamond";
        src: url("${chrome.runtime.getURL("fonts/EBGaramond-Italic.woff2")}") format("woff2");
        font-style: italic;
        font-weight: 400;
        font-display: swap;
      }

      @keyframes contextGeneratorSpinnerSpin {
        to {
          transform: rotate(360deg);
        }
      }

      #${DESTINATION_SHEET_ID}[data-context-generator-phase="choosing"] .context-generator-destination-tile {
        pointer-events: none;
      }

      #${DESTINATION_SHEET_ID}[data-context-generator-phase="choosing"] .context-generator-destination-tile[data-context-generator-dismissed="true"] {
        opacity: 0.28;
        transform: translate3d(0,2px,0) scale(0.975);
        filter: saturate(0.55);
      }

      #${DESTINATION_SHEET_ID}[data-context-generator-phase="choosing"] .context-generator-destination-tile[data-context-generator-selected="true"] {
        border-color: rgba(210,190,241,0.62) !important;
        background: linear-gradient(135deg,rgba(155,123,215,0.2),rgba(255,255,255,0.055)) !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.11),0 12px 30px rgba(0,0,0,0.22),0 0 28px rgba(141,108,207,0.16) !important;
        transform: translate3d(0,0,0) scale(0.985) !important;
      }

      .context-generator-tile-aura {
        animation: none;
      }

      .context-generator-destination-tile::after {
        content: "→";
        display: flex;
        align-items: center;
        justify-content: center;
        flex: 0 0 auto;
        position: relative;
        z-index: 2;
        color: rgba(255,255,255,0.38);
        font-size: 14px;
        line-height: 1;
        transform: translate3d(0,0,0);
        transition: color 0.16s ease, transform 0.16s cubic-bezier(0.16,1,0.3,1), border-color 0.16s ease, background 0.16s ease;
      }

      .context-generator-destination-tile:hover::after,
      .context-generator-destination-tile:focus-visible::after {
        color: rgba(255,255,255,0.9);
        transform: translate3d(2px,0,0);
      }

      .context-generator-destination-tile:focus-visible {
        outline: 2px solid rgba(190,162,233,0.78) !important;
        outline-offset: 2px;
      }

      @media (max-width: 390px) {
        .context-generator-destination-grid {
          grid-template-columns: 1fr !important;
          gap: 8px !important;
        }

        .context-generator-destination-tile {
          height: 60px !important;
        }
      }

      .context-generator-destination-tile[aria-busy="true"]::after {
        display: none;
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
        #${DESTINATION_SHEET_ID} .context-generator-speed-lines i {
          animation: none;
          opacity: 0.65;
        }
        .context-generator-tile-aura {
          animation: none;
        }

        .context-generator-tile-spinner {
          animation: none;
        }

        #${DESTINATION_SHEET_ID} .context-generator-destination-tile,
        #${DESTINATION_SHEET_ID} .context-generator-speed-toggle {
          transition: none !important;
        }
      }
    `;
    style.textContent += Object.values(PLATFORMS).map((platform) => `
      #${DESTINATION_SHEET_ID} .context-generator-destination-tile[data-context-generator-accent="${platform.accent}"] .context-generator-tile-aura {
        background: radial-gradient(ellipse at 30% 50%, ${platform.accent}34 0, ${platform.accent}16 40%, transparent 72%) !important;
      }
    `).join("");
    (document.head || document.documentElement).appendChild(style);
    applyOwnedUiStyleSheet(style);
  }

  function ensureDestinationSheet() {
    ensureDestinationSheetBackdrop();
    let sheet = document.getElementById(DESTINATION_SHEET_ID);
    if (sheet) return sheet;

    ensureDestinationSheetStyles();

    sheet = document.createElement("div");
    sheet.id = DESTINATION_SHEET_ID;
    sheet.dataset.contextGeneratorOwned = "true";
    sheet.setAttribute("role", "dialog");
    sheet.setAttribute("aria-modal", "true");
    sheet.setAttribute("aria-hidden", "true");
    sheet.tabIndex = -1;
    sheet.setAttribute("aria-labelledby", "context-generator-destination-title");
    sheet.style.cssText = [
      "display:none",
      "position:fixed",
      "z-index:2147483647",
      `width:min(${DESTINATION_SHEET_WIDTH}px,calc(100vw - 20px))`,
      "box-sizing:border-box",
      "padding:12px",
      "border-radius:19px",
      "border:1px solid rgba(236,229,246,0.17) !important",
      "background:radial-gradient(ellipse 68% 48% at 88% -8%,rgba(145,112,199,0.18),transparent 72%),radial-gradient(ellipse 55% 48% at -8% 110%,rgba(82,57,128,0.15),transparent 74%),linear-gradient(180deg,#111012 0%,#0c0b0e 58%,#09080b 100%) !important",
      "box-shadow:0 34px 88px rgba(0,0,0,0.58),0 14px 34px rgba(0,0,0,0.34),0 0 54px rgba(104,76,154,0.1),0 0 0 1px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.09) !important",
      "backdrop-filter:blur(24px) saturate(1.06)",
      "color:#f5f5f5 !important",
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
      "max-height:calc(100vh - 20px)",
      "overflow-x:hidden",
      "overflow-y:auto",
      "outline:none",
      "scrollbar-width:thin",
      "opacity:0",
      `transform:${DESTINATION_SHEET_CLOSED_TRANSFORM}`,
      "transform-origin:bottom right",
      "will-change:transform,opacity",
      "transition:opacity 0.2s ease, transform 0.3s cubic-bezier(0.22,1,0.36,1)"
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = "padding:0 1px 11px;display:flex;flex-direction:column;align-items:flex-start;gap:0";
    const topLine = document.createElement("div");
    topLine.style.cssText = "width:100%;display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:11px";
    const brandLockup = document.createElement("div");
    brandLockup.className = "context-generator-destination-brand";
    brandLockup.style.cssText = "display:flex;align-items:center;gap:8px;color:rgba(247,244,250,0.76) !important;font-size:11.5px;font-weight:650;line-height:1";
    const brandLink = document.createElement("a");
    brandLink.className = "context-generator-destination-home-link";
    brandLink.href = "https://context-generator-five.vercel.app/";
    brandLink.target = "_blank";
    brandLink.rel = "noopener noreferrer";
    // Both orbs are pointer controls; the picker Tab cycle starts at destinations.
    brandLink.tabIndex = -1;
    brandLink.setAttribute("aria-label", "Open Cap Context website (opens in a new tab)");
    brandLink.title = "Visit Cap Context";
    const brandIcon = document.createElement("img");
    brandIcon.className = "context-generator-destination-brand-icon";
    brandIcon.src = BUBBLE_ICON_URL;
    brandIcon.alt = "";
    brandIcon.width = 26;
    brandIcon.height = 26;
    brandIcon.style.cssText = "display:block;width:26px;height:26px;box-sizing:border-box;padding:3px;border:1px solid rgba(185,158,228,0.2) !important;border-radius:9px;background:linear-gradient(145deg,rgba(189,158,238,0.18),rgba(102,72,155,0.1)) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,0.08),0 7px 18px rgba(74,48,121,0.2) !important;object-fit:contain";
    const brandName = document.createElement("span");
    brandName.textContent = "Cap Context";
    brandLink.appendChild(brandIcon);
    brandLockup.appendChild(brandLink);
    brandLockup.appendChild(brandName);
    const title = document.createElement("div");
    title.id = "context-generator-destination-title";
    title.className = "context-generator-destination-title";
    title.textContent = DESTINATION_TITLE_TEXT;
    title.style.cssText = "font-family:'Cap Context EB Garamond',Georgia,'Times New Roman',serif;font-size:18px;font-style:normal;font-weight:400;letter-spacing:-0.015em;color:#ffffff !important;line-height:1.05;text-rendering:geometricPrecision";
    topLine.appendChild(brandLockup);
    header.appendChild(topLine);
    header.appendChild(title);
    sheet.appendChild(header);

    const options = Object.entries(PLATFORMS)
      .filter(([id]) => id !== currentPlatform.id)
      .map(([id, platform]) => ({ ...platform, id }));

    const grid = document.createElement("div");
    grid.className = "context-generator-destination-grid";
    grid.style.cssText = "display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px";

    options.forEach((option, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "context-generator-destination-tile";
      button.dataset.contextGeneratorAccent = option.accent;
      button.dataset.contextGeneratorDetail = option.detail;
      button.setAttribute("aria-label", `Continue in ${option.name}`);
      button.style.cssText = [
        "width:100%",
        "height:60px",
        "border:1px solid rgba(255,255,255,0.1) !important",
        "border-radius:14px",
        "background:linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.022)) !important",
        "color:#ffffff !important",
        "display:flex",
        "align-items:center",
        "gap:8px",
        "padding:0 9px",
        "box-sizing:border-box",
        "cursor:pointer",
        "text-align:left",
        "font:inherit",
        "position:relative",
        "overflow:hidden",
        "isolation:isolate",
        "box-shadow:inset 0 1px 0 rgba(255,255,255,0.055),inset 0 -1px 0 rgba(0,0,0,0.3),0 8px 20px rgba(0,0,0,0.08) !important",
        "transition:opacity 0.18s ease,filter 0.18s ease,transform 0.24s cubic-bezier(0.22,1,0.36,1),border-color 0.18s ease,background 0.18s ease,box-shadow 0.18s ease"
      ].join(";");

      const aura = document.createElement("span");
      aura.className = "context-generator-tile-aura";
      aura.style.cssText = [
        "position:absolute",
        "left:-24px",
        "top:-30px",
        "bottom:-30px",
        "width:130px",
        "z-index:0",
        "pointer-events:none",
        "border-radius:999px",
        `background:radial-gradient(ellipse at 30% 50%, ${option.accent}34 0, ${option.accent}16 40%, transparent 72%) !important`,
        "opacity:0.24",
        "filter:blur(10px)",
        "transform:translate3d(0,0,0) scaleX(1)",
        "transition:opacity 0.16s ease, left 0.16s ease, right 0.16s ease, width 0.16s ease, border-radius 0.16s ease, background 0.16s ease"
      ].join(";");

      const logoWrap = document.createElement("div");
      logoWrap.className = "context-generator-destination-logo-wrap";
      logoWrap.style.cssText = "width:34px;height:34px;display:flex;align-items:center;justify-content:center;box-sizing:border-box;flex:0 0 auto;opacity:0.98;position:relative;z-index:2;border:1px solid rgba(255,255,255,0.075) !important;border-radius:10px;background:rgba(4,4,5,0.28) !important;box-shadow:inset 0 1px 0 rgba(255,255,255,0.045) !important";
      const logo = document.createElement("img");
      logo.src = getExtensionAssetUrl(option.logo);
      logo.alt = "";
      logo.draggable = false;
      logo.style.cssText = `width:${option.logoSize}px;height:${option.logoSize}px;object-fit:contain;display:block;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.28))`;
      logoWrap.appendChild(logo);

      const copy = document.createElement("div");
      copy.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;position:relative;z-index:2";
      const name = document.createElement("div");
      name.className = "context-generator-destination-tile-name";
      name.textContent = option.name;
      name.style.cssText = "font-size:12px;font-weight:720;line-height:1.15;color:#f8f6fa !important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      const detail = document.createElement("div");
      detail.className = "context-generator-tile-detail";
      detail.textContent = option.detail;
      detail.style.cssText = "font-size:10px;font-weight:520;line-height:1.25;color:rgba(238,234,242,0.56) !important;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
      copy.appendChild(name);
      copy.appendChild(detail);

      const spinner = document.createElement("span");
      spinner.className = "context-generator-tile-spinner";
      spinner.setAttribute("aria-hidden", "true");

      const setButtonActive = () => {
        if (button.dataset.contextGeneratorSelected === "true") return;
        button.style.setProperty("background", `linear-gradient(135deg,${option.accent}1f,rgba(255,255,255,0.045) 64%,rgba(255,255,255,0.02))`, "important");
        button.style.setProperty("border-color", `${option.accent}66`, "important");
        button.style.setProperty("box-shadow", `inset 0 1px 0 rgba(255,255,255,0.09),0 12px 30px rgba(0,0,0,0.16),0 0 24px ${option.accent}14`, "important");
        aura.style.opacity = "0.48";
        button.style.transform = "translateY(-2px)";
      };
      const setButtonIdle = () => {
        if (button.dataset.contextGeneratorSelected === "true") return;
        button.style.setProperty("background", "linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.022))", "important");
        button.style.setProperty("border-color", "rgba(255,255,255,0.1)", "important");
        button.style.setProperty("box-shadow", "inset 0 1px 0 rgba(255,255,255,0.055),inset 0 -1px 0 rgba(0,0,0,0.3),0 8px 20px rgba(0,0,0,0.08)", "important");
        aura.style.left = "-24px";
        aura.style.right = "auto";
        aura.style.width = "130px";
        aura.style.borderRadius = "999px";
        aura.style.setProperty("background", `radial-gradient(ellipse at 30% 50%, ${option.accent}34 0, ${option.accent}16 40%, transparent 72%)`, "important");
        aura.style.opacity = "0.24";
        button.style.transform = "translateY(0)";
      };

      button.appendChild(aura);
      button.appendChild(logoWrap);
      button.appendChild(copy);
      button.appendChild(spinner);
      addOwnedEventListener(button, "mouseenter", setButtonActive);
      addOwnedEventListener(button, "mouseleave", setButtonIdle);
      addOwnedEventListener(button, "focus", setButtonActive);
      addOwnedEventListener(button, "blur", setButtonIdle);
      addOwnedEventListener(button, "click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.dataset.contextGeneratorLoading === "true") return;
        button.dataset.contextGeneratorLoading = "true";
        button.setAttribute("aria-busy", "true");
        sheet.dataset.contextGeneratorPhase = "choosing";
        sheet.querySelectorAll(".context-generator-destination-tile").forEach((tile) => {
          if (tile === button) tile.dataset.contextGeneratorSelected = "true";
          else tile.dataset.contextGeneratorDismissed = "true";
        });
        // Inline importance beats Dark Reader's injected attribute rules. Keep the
        // selected treatment inline too, so it still wins over idle/hover colors.
        button.style.setProperty("border-color", "rgba(210,190,241,0.62)", "important");
        button.style.setProperty("background", "linear-gradient(135deg,rgba(155,123,215,0.2),rgba(255,255,255,0.055))", "important");
        button.style.setProperty("box-shadow", "inset 0 1px 0 rgba(255,255,255,0.11),0 12px 30px rgba(0,0,0,0.22),0 0 28px rgba(141,108,207,0.16)", "important");
        spinner.style.display = "block";
        sheet.setAttribute("aria-busy", "true");
        sheet.querySelectorAll(".context-generator-destination-tile").forEach((tile) => {
          tile.tabIndex = -1;
          tile.setAttribute("aria-disabled", "true");
        });
        detail.textContent = "Opening…";
        startDestinationTransfer(option.id);
      });

      grid.appendChild(button);
    });

    sheet.appendChild(grid);

    if (["claude", "chatgpt", "gemini", "grok", "deepseek"].includes(currentPlatform.id)) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.id = `context-generator-${currentPlatform.id}-json-toggle`;
      toggle.className = "context-generator-speed-toggle";
      const enabled = currentPlatform.id === "claude" ? claudeJsonCaptureEnabled
        : currentPlatform.id === "chatgpt" ? chatGptJsonCaptureEnabled : networkJsonCaptureEnabled;
      toggle.setAttribute("aria-pressed", String(enabled));
      toggle.setAttribute("aria-label", "Fast capture");
      toggle.title = `Fast capture: ${enabled ? "On" : "Off"}`;
      toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/></svg><span class="context-generator-speed-lines" aria-hidden="true"><i></i><i></i><i></i></span>';
      addOwnedEventListener(toggle, "click", () => {
        if (isRunning) return;
        let enabled;
        if (currentPlatform.id === "claude") enabled = claudeJsonCaptureEnabled = !claudeJsonCaptureEnabled;
        else if (currentPlatform.id === "chatgpt") enabled = chatGptJsonCaptureEnabled = !chatGptJsonCaptureEnabled;
        else enabled = networkJsonCaptureEnabled = !networkJsonCaptureEnabled;
        toggle.setAttribute("aria-pressed", String(enabled));
        toggle.title = `Fast capture: ${enabled ? "On" : "Off"}`;
      });
      topLine.appendChild(toggle);
    }

    const footer = document.createElement("div");
    footer.className = "context-generator-destination-helper";
    footer.textContent = DESTINATION_HELPER_TEXT;
    footer.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:flex-start",
      "gap:0",
      "margin:12px 2px 1px",
      "padding-top:9px",
      "border-top:1px solid rgba(255,255,255,0.065) !important",
      "color:rgba(240,236,244,0.58) !important",
      "font-family:Georgia,'Times New Roman',serif",
      "font-size:11.5px",
      "font-weight:540",
      "line-height:1.35",
      "letter-spacing:0",
      "text-align:left",
      "white-space:nowrap",
      "overflow:hidden",
      "text-overflow:ellipsis"
    ].join(";");
    sheet.appendChild(footer);

    addOwnedEventListener(sheet, "click", (event) => event.stopPropagation());
    addOwnedEventListener(window, "scroll", updateDestinationBackdropCutout, { capture: true, passive: true });
    addOwnedEventListener(window, "resize", updateDestinationBackdropCutout);
    document.body.appendChild(sheet);
    addOwnedEventListener(document, "click", () => {
      if (!isDestinationSheetOpen()) return;
      // The page control the user clicked now owns focus. Keyboard/backdrop
      // dismissals can return to the native composer instead of the orb.
      hideDestinationSheet({ restoreFocus: false });
    });
    addOwnedEventListener(document, "keydown", (event) => {
      if (!isDestinationSheetOpen()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        hideDestinationSheet();
        return;
      }
      if (event.key !== "Tab") return;

      const focusableTiles = [...sheet.querySelectorAll(".context-generator-destination-tile, .context-generator-speed-toggle")]
        .filter((tile) => !tile.disabled && tile.getAttribute("aria-disabled") !== "true");
      if (focusableTiles.length === 0) return;
      const focusedIndex = focusableTiles.indexOf(document.activeElement);
      const nextIndex = event.shiftKey
        ? (focusedIndex <= 0 ? focusableTiles.length - 1 : focusedIndex - 1)
        : (focusedIndex < 0 || focusedIndex === focusableTiles.length - 1 ? 0 : focusedIndex + 1);
      event.preventDefault();
      focusableTiles[nextIndex].focus?.({ preventScroll: true });
    });

    return sheet;
  }

  function ensureDestinationSheetBackdrop() {
    let backdrop = document.getElementById(DESTINATION_SHEET_BACKDROP_ID);
    if (backdrop) return backdrop;

    backdrop = document.createElement("div");
    backdrop.id = DESTINATION_SHEET_BACKDROP_ID;
    backdrop.dataset.contextGeneratorOwned = "true";
    backdrop.setAttribute("aria-hidden", "true");
    backdrop.style.cssText = [
      "display:none",
      "position:fixed",
      "z-index:2147483646",
      "inset:0",
      "pointer-events:none",
      "background:rgba(7,6,10,0.34) !important",
      "backdrop-filter:blur(7px) saturate(0.86)",
      "-webkit-backdrop-filter:blur(7px) saturate(0.86)",
      "opacity:0",
      "will-change:opacity",
      "transition:opacity 0.24s ease"
    ].join(";");
    addOwnedEventListener(backdrop, "click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      hideDestinationSheet();
    });
    document.body.appendChild(backdrop);
    return backdrop;
  }

  function toggleDestinationSheet() {
    hideErrorOverlay(undefined, { immediate: true });
    hideOnboardingNudge();
    hideClaudeLimitNudge();
    const existingSheet = document.getElementById(DESTINATION_SHEET_ID);
    if (existingSheet?.style.display === "block") {
      hideDestinationSheet();
      return;
    }

    const sheet = ensureDestinationSheet();
    const backdrop = ensureDestinationSheetBackdrop();
    clearTimeout(destinationSheetHideTimer);
    clearTimeout(destinationBackdropHideTimer);
    destinationSheetHideTimer = null;
    destinationBackdropHideTimer = null;
    if (destinationSheetAnimationFrame) cancelAnimationFrame(destinationSheetAnimationFrame);
    backdrop.style.display = "block";
    backdrop.style.pointerEvents = "auto";
    backdrop.style.opacity = "0";
    sheet.setAttribute("aria-hidden", "false");
    sheet.style.opacity = "0";
    sheet.style.transform = DESTINATION_SHEET_CLOSED_TRANSFORM;
    sheet.style.display = "block";
    delete sheet.dataset.contextGeneratorPositionLocked;
    positionDestinationSheet();
    resetDestinationTiles(sheet);
    warmDestinationConnections();
    const bubble = document.getElementById(BUBBLE_ID);
    if (bubble) {
      bubble.setAttribute("aria-expanded", "true");
      bubble.style.filter = "brightness(1.14) saturate(1.12) drop-shadow(0 0 7px rgba(153,110,235,0.58)) drop-shadow(0 3px 8px rgba(78,42,128,0.32))";
      bubble.style.transform = "translate3d(0,-1px,0) scale(1.08)";
    }
    updateDestinationBackdropCutout();
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      backdrop.style.opacity = "1";
      sheet.style.opacity = "1";
      sheet.style.transform = "translate3d(0,0,0) scale(1)";
      sheet.focus?.({ preventScroll: true });
      return;
    }
    destinationSheetAnimationFrame = requestAnimationFrame(() => {
      backdrop.style.opacity = "1";
      sheet.style.opacity = "1";
      sheet.style.transform = "translate3d(0,0,0) scale(1)";
      destinationSheetAnimationFrame = null;
      setTimeout(() => {
        if (
          isDestinationSheetOpen()
          && (document.activeElement === bubble || document.activeElement === document.body)
        ) {
          sheet.focus?.({ preventScroll: true });
        }
      }, 180);
    });
  }

  function hideDestinationSheet({ immediate = false, preserveBackdrop = false, restoreFocus = true } = {}) {
    const sheet = document.getElementById(DESTINATION_SHEET_ID);
    const backdrop = document.getElementById(DESTINATION_SHEET_BACKDROP_ID);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const shouldAnimate = !immediate && !reducedMotion;

    clearTimeout(destinationSheetHideTimer);
    destinationSheetHideTimer = null;
    if (sheet) {
      sheet.setAttribute("aria-hidden", "true");
      if (destinationSheetAnimationFrame) {
        cancelAnimationFrame(destinationSheetAnimationFrame);
        destinationSheetAnimationFrame = null;
      }
      sheet.style.opacity = "0";
      sheet.style.transform = DESTINATION_SHEET_CLOSED_TRANSFORM;
      delete sheet.dataset.contextGeneratorPositionLocked;
      if (shouldAnimate && sheet.style.display === "block") {
        destinationSheetHideTimer = setTimeout(() => {
          sheet.style.display = "none";
          destinationSheetHideTimer = null;
        }, DESTINATION_SHEET_EXIT_MS);
      } else {
        sheet.style.display = "none";
      }
    }

    if (!preserveBackdrop) {
      releaseDestinationSheetBackdrop({ immediate });
    }

    // A native composer replacement can detach the orb before the picker closes.
    // Reset the retained instance too, before inline mounting reuses that node.
    const bubble = document.getElementById(BUBBLE_ID) || inlineBubble ||
      (claudeInlineMount || chatGptInlineMount || providerInlineMount)?.bubble;
    if (bubble) {
      bubble.setAttribute("aria-expanded", "false");
      // Dismissal visuals are independent of focus. Keep the active effect only
      // during the preserved-backdrop bridge into the handoff animation.
      if (!preserveBackdrop) {
        bubble.style.filter = "none";
        bubble.style.transform = "translate3d(0,0,0) scale(1)";
      }
      if (restoreFocus && !isRunning) {
        setTimeout(() => {
          // A closing sheet stays displayed during animation; only a reopened
          // picker or changed page focus should cancel composer restoration.
          if (isRunning || bubble.getAttribute("aria-expanded") === "true") return;
          const active = document.activeElement;
          if (active !== bubble && active !== document.body && !sheet?.contains(active)) return;
          findPlatformInput()?.focus?.({ preventScroll: true });
        }, shouldAnimate ? DESTINATION_SHEET_EXIT_MS : 0);
      }
    }
  }

  function updateDestinationBackdropCutout() {
    const bubble = document.getElementById(BUBBLE_ID);
    const backdrop = document.getElementById(DESTINATION_SHEET_BACKDROP_ID);
    if (!bubble || !backdrop || bubble.getAttribute("aria-expanded") !== "true") return;
    const rect = bubble.getBoundingClientRect();
    const x = Math.round(rect.left + rect.width / 2);
    const y = Math.round(rect.top + rect.height / 2);
    // Match the solid artwork, keeping the native button/background under blur.
    const radius = Math.max(1, Math.round(Math.min(rect.width, rect.height) * 0.4));
    // Inline ancestors trap z-index. Clip the scrim around the real orb instead
    // of moving/cloning it or lifting the native composer's controls above blur.
    // Unlike a CSS mask, this hole also lets pointer clicks reach the orb.
    const clip = `path(evenodd, "M0 0 H${window.innerWidth} V${window.innerHeight} H0 Z M${x - radius} ${y} a${radius} ${radius} 0 1 0 ${radius * 2} 0 a${radius} ${radius} 0 1 0 ${-radius * 2} 0 Z")`;
    if (backdrop.style.clipPath !== clip) backdrop.style.clipPath = clip;
  }

  function releaseDestinationSheetBackdrop({ immediate = false } = {}) {
    const backdrop = document.getElementById(DESTINATION_SHEET_BACKDROP_ID);
    if (!backdrop) return;

    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    clearTimeout(destinationBackdropHideTimer);
    destinationBackdropHideTimer = null;
    backdrop.style.opacity = "0";
    backdrop.style.pointerEvents = "none";
    if (!immediate && !reducedMotion && backdrop.style.display === "block") {
      destinationBackdropHideTimer = setTimeout(() => {
        backdrop.style.display = "none";
        backdrop.style.clipPath = "";
        destinationBackdropHideTimer = null;
      }, DESTINATION_SHEET_EXIT_MS);
    } else {
      backdrop.style.display = "none";
      backdrop.style.clipPath = "";
    }
  }

  async function transitionDestinationSheetToHandoff() {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      pendingHandoffOrigin = null;
      hideDestinationSheet({ immediate: true, restoreFocus: false });
      return;
    }

    // Preserve the picker's on-screen geometry so the larger handoff surface
    // can expand from the same place instead of popping into the viewport center.
    await delay(DESTINATION_TRANSFER_PRESS_MS);
    const sheet = document.getElementById(DESTINATION_SHEET_ID);
    const sheetRect = sheet?.getBoundingClientRect?.();
    pendingHandoffOrigin = sheetRect
      ? {
          centerX: sheetRect.left + sheetRect.width / 2,
          centerY: sheetRect.top + sheetRect.height / 2,
          width: sheetRect.width,
          height: sheetRect.height
        }
      : null;
    hideDestinationSheet({ preserveBackdrop: true, restoreFocus: false });
    await delay(DESTINATION_HANDOFF_OVERLAP_MS);
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
    const sheetWidth = Math.min(DESTINATION_SHEET_WIDTH, window.innerWidth - margin * 2);
    const sheetHeight = sheet.offsetHeight || 330;
    const left = Math.max(
      margin,
      Math.min(
        bubbleRect.right - sheetWidth,
        window.innerWidth - sheetWidth - margin
      )
    );
    const preferredTop = bubbleRect.top - sheetHeight - margin;
    const top = preferredTop >= margin ? preferredTop : bubbleRect.bottom + margin;

    sheet.style.left = `${Math.round(left)}px`;
    sheet.style.top = `${Math.round(Math.min(top, window.innerHeight - sheetHeight - margin))}px`;
    sheet.style.transformOrigin = preferredTop >= margin ? "bottom right" : "top right";
    sheet.dataset.contextGeneratorPositionLocked = "true";
  }

  function resetDestinationTiles(sheet) {
    delete sheet.dataset.contextGeneratorPhase;
    sheet.removeAttribute("aria-busy");
    sheet.querySelectorAll(".context-generator-destination-tile").forEach((tile) => {
      const accent = tile.dataset.contextGeneratorAccent || "#ffffff";
      const aura = tile.querySelector(".context-generator-tile-aura");
      tile.dataset.contextGeneratorLoading = "false";
      delete tile.dataset.contextGeneratorSelected;
      delete tile.dataset.contextGeneratorDismissed;
      tile.removeAttribute("aria-busy");
      tile.removeAttribute("aria-disabled");
      tile.tabIndex = 0;
      tile.style.pointerEvents = "";
      tile.style.background = "linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.022))";
      tile.style.borderColor = "rgba(255,255,255,0.1)";
      tile.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.055),inset 0 -1px 0 rgba(0,0,0,0.3),0 8px 20px rgba(0,0,0,0.08)";
      tile.style.transform = "translateY(0)";
      if (aura) {
        aura.style.left = "-24px";
        aura.style.right = "auto";
        aura.style.width = "130px";
        aura.style.borderRadius = "999px";
        aura.style.background = `radial-gradient(ellipse at 30% 50%, ${accent}34 0, ${accent}16 40%, transparent 72%)`;
        aura.style.opacity = "0.24";
      }
      const detail = tile.querySelector(".context-generator-tile-detail");
      const spinner = tile.querySelector(".context-generator-tile-spinner");
      if (detail && tile.dataset.contextGeneratorDetail) {
        detail.textContent = tile.dataset.contextGeneratorDetail;
      }
      if (spinner) spinner.style.display = "none";
    });
  }

  function hasSavedSourceConversation() {
    // Match the JSON bridges, including ChatGPT project/custom-GPT routes.
    // A saved chat may have a complete API tree before any DOM turns mount.
    const patterns = {
      claude: /^\/chat\/([^/]+)$/,
      chatgpt: /\/c\/([^/]+)\/?$/,
      gemini: /\/app\/([^/]+)\/?$/,
      grok: /\/c\/([^/]+)\/?$/,
      deepseek: /\/a\/chat\/s\/([^/]+)\/?$/
    };
    return Boolean(patterns[currentPlatform.id]?.test(window.location.pathname));
  }

  async function startDestinationTransfer(destinationId) {
    const sourceUrl = window.location.href;
    const hasSavedConversation = hasSavedSourceConversation();
    const useClaudeJson = hasSavedConversation && currentPlatform.id === "claude" && claudeJsonCaptureEnabled;
    const claudeJsonPath = useClaudeJson ? window.location.pathname : null;
    const useChatGptJson = hasSavedConversation && currentPlatform.id === "chatgpt" && chatGptJsonCaptureEnabled;
    const chatGptJsonPath = useChatGptJson ? window.location.pathname : null;
    const useNetworkJson = hasSavedConversation && ["gemini", "grok", "deepseek"].includes(currentPlatform.id) && networkJsonCaptureEnabled;
    const geminiJsonPath = useNetworkJson && currentPlatform.id === "gemini" ? window.location.pathname : null;
    const grokJsonUrl = useNetworkJson && currentPlatform.id === "grok" ? window.location.href : null;
    const deepseekJsonPath = useNetworkJson && currentPlatform.id === "deepseek" ? window.location.pathname : null;
    const trace = createTransferTrace(destinationId, "destination tile");
    trace.destinationId = destinationId;
    startTransferTelemetry(trace);
    if (isRunning) {
      markTransferTrace(trace, "failed: Context transfer is already running.");
      finishTransferTrace(trace, "unknown_failure");
      return;
    }
    // The full JSON tree can be ready before its virtualized DOM mounts.
    // JSON validation, rather than rendered turn count, decides whether it is empty.
    if (!useClaudeJson && !useChatGptJson && !useNetworkJson && getDetectedConversationMessageCount() === 0) {
      markTransferTrace(trace, `failed: ${NO_CONVERSATION_ERROR_MESSAGE}`);
      finishTransferTrace(trace, "no_conversation");
      showErrorOverlay(NO_CONVERSATION_ERROR_MESSAGE);
      return;
    }

    markTransferTrace(trace, "destination click", { destination: destinationId });

    isRunning = true;
    clearRunningResetTimer();
    startTransferDeadline(trace);
    try {
      await transitionDestinationSheetToHandoff();
      checkTransferDeadline(trace);
      showOverlay(destinationId);
      releaseDestinationSheetBackdrop();
      let preparedDestinationPromise = null;
      if (useClaudeJson || useChatGptJson || useNetworkJson || getDetectedConversationMessageCount() > 0) {
        preparedDestinationPromise = prepareDestinationTab(destinationId, trace);
      }
      advanceTransferTelemetryStage(trace, "capture_started");
      if (!useClaudeJson && !useChatGptJson && !useNetworkJson) await prepareSourceForCapture();
      checkTransferDeadline(trace);
      if (!preparedDestinationPromise && (useClaudeJson || useChatGptJson || useNetworkJson || getDetectedConversationMessageCount() > 0)) {
        preparedDestinationPromise = prepareDestinationTab(destinationId, trace);
      }

      markTransferTrace(trace, "capture start");
      setHandoffProgress("capture", "active");
      let conversationText;
      if (useClaudeJson || useChatGptJson || useNetworkJson) {
        try {
          const captureJson = useClaudeJson ? window.__capCaptureClaudeJson : useChatGptJson ? window.__capCaptureChatGptJson : window.__capCaptureNetworkJson;
          if (typeof captureJson !== "function") throw new Error(`Refresh ${currentPlatform.name} to enable JSON capture.`);
          const capture = useClaudeJson ? await captureJson(claudeJsonPath)
            : useChatGptJson ? await captureJson(chatGptJsonPath)
            : geminiJsonPath ? await captureJson(geminiJsonPath)
            : deepseekJsonPath ? await captureJson(deepseekJsonPath) : grokJsonUrl ? await captureJson(grokJsonUrl) : await captureJson();
          checkTransferDeadline(trace);
          conversationText = createConversationCapture(capture.text, {
            method: `${currentPlatform.id}-json`, messageTurnCount: capture.messageTurnCount,
            usefulTurnCount: capture.messageTurnCount, candidateTurnCount: capture.messageTurnCount
          });
        } catch (error) {
          checkTransferDeadline(trace);
          // Recover within this attempt: reuse its destination and call the
          // summary/paste pipeline only once, after a complete DOM capture.
          // Retain the bridges' navigation/session cancellation, including an
          // away-and-back change that a final URL comparison cannot detect.
          if (/conversation changed during capture\./i.test(error?.message || "")) throw error;
          if (window.location.href !== sourceUrl) throw new Error("The conversation changed during capture. Return to the source chat and try again.");
          showFastCaptureFallbackMessage();
          markTransferTrace(trace, "fast capture failed; using normal capture");
          await prepareSourceForCapture();
          checkTransferDeadline(trace);
          conversationText = await scrapeConversationTextWhenReady();
          checkTransferDeadline(trace);
          if (window.location.href !== sourceUrl) throw new Error("The conversation changed during capture. Return to the source chat and try again.");
        }
      } else {
        conversationText = await scrapeConversationTextWhenReady();
      }
      checkTransferDeadline(trace);
      markCaptureDone(trace, conversationText);

      preparedDestinationPromise = preparedDestinationPromise || prepareDestinationTab(destinationId, trace);
      runContextFlow(destinationId, preparedDestinationPromise, conversationText, trace);
    } catch (error) {
      if (trace.expired) return;
      markTransferTrace(trace, `failed: ${error.message}`);
      finishTransferTrace(trace, getSafeTelemetryFailureReason(error, "capture"));
      resetRunningFlag();
      showErrorOverlay(error.message);
    }
  }

  function showFastCaptureFallbackMessage() {
    const group = document.getElementById("context-generator-status-group");
    if (!group) return;
    const notice = document.createElement("div");
    notice.id = "context-generator-capture-notice";
    notice.setAttribute("role", "status");
    notice.style.cssText = "font-size:12px;line-height:1.4;color:inherit";
    notice.textContent = "Fast capture failed. Using normal capture instead.";
    group.appendChild(notice);
  }

  function protectOverlayPalette(root) {
    let style = document.getElementById(OVERLAY_PALETTE_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = OVERLAY_PALETTE_STYLE_ID;
      style.className = "darkreader";
      style.dataset.contextGeneratorOwned = "true";
      document.head.appendChild(style);
    }

    // Snapshot only static colors before insertion, using the picker's ignored
    // stylesheet + scoped priority rules. Progress-state colors live in their CSS.
    const rules = [root, ...root.querySelectorAll("[style]")].map((element, index) => {
      const declarations = ["color", "background", "border-color", "box-shadow"]
        .map((property) => {
          const value = element.style.getPropertyValue(property);
          if (!value) return "";
          element.style.setProperty(property, value, "important");
          return `${property}:${value} !important;`;
        }).join("");
      if (!declarations) return "";
      if (index) element.setAttribute("data-context-generator-palette", String(index));
      const selector = index
        ? `#${root.id} [data-context-generator-palette="${index}"]`
        : `#${root.id}`;
      return `${selector}{${declarations}}`;
    });
    style.textContent += rules.join("\n");
    applyOwnedUiStyleSheet(style);
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
        "background:rgba(7,6,10,0.38)",
        "backdrop-filter:blur(4px) saturate(0.84)",
        "opacity:0",
        "transition:opacity 240ms ease"
      ].join(";");
      protectOverlayPalette(scrim);
      document.body.appendChild(scrim);
    }

    if (!document.getElementById(OVERLAY_ID)) {
      const overlay = document.createElement("div");
      overlay.id = OVERLAY_ID;
      overlay.dataset.contextGeneratorOwned = "true";
      overlay.setAttribute("role", "group");
      overlay.setAttribute("aria-label", "Context transfer status");
      overlay.setAttribute("aria-hidden", "true");
      overlay.style.cssText = [
        "display:none",
        "position:fixed",
        "z-index:2147483647",
        "left:50%",
        "top:47%",
        "width:min(580px,calc(100vw - 32px))",
        "height:286px",
        "min-height:286px",
        "max-height:286px",
        "box-sizing:border-box",
        "padding:20px 22px 22px",
        "border-radius:30px",
        "border:1px solid rgba(236,229,246,0.18)",
        "background:radial-gradient(ellipse 70% 66% at 88% -10%,rgba(146,116,204,0.18),transparent 68%),radial-gradient(ellipse 52% 72% at -8% 110%,rgba(83,58,129,0.16),transparent 72%),#111012",
        "color:#b9b7bd",
        "box-shadow:0 42px 120px rgba(0,0,0,0.58),0 14px 38px rgba(0,0,0,0.34),0 0 72px rgba(112,82,165,0.12),0 0 0 1px rgba(0,0,0,0.62),inset 0 1px 0 rgba(255,255,255,0.10),inset 0 -1px 0 rgba(255,255,255,0.025)",
        `transform:${HANDOFF_OVERLAY_CLOSED_TRANSFORM}`,
        "opacity:0",
        "flex-direction:column",
        "justify-content:space-between",
        "gap:0",
        "overflow:hidden",
        "isolation:isolate",
        "backdrop-filter:blur(28px) saturate(1.08)",
        "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",
        "letter-spacing:0",
        "will-change:transform,opacity",
        "transition:opacity 0.24s ease, transform 0.36s cubic-bezier(0.22,1,0.36,1)"
      ].join(";");

      const glow = document.createElement("div");
      glow.className = "context-generator-handoff-atmosphere";
      glow.style.cssText = [
        "position:absolute",
        "inset:0",
        "pointer-events:none",
        "border-radius:inherit",
        "background:radial-gradient(ellipse 52% 52% at 68% 8%,rgba(211,194,237,0.10),transparent 72%),linear-gradient(180deg,rgba(255,255,255,0.045),transparent 36%)",
        "box-shadow:inset 0 0 0 1px rgba(255,255,255,0.022)",
        "opacity:1"
      ].join(";");

      const brand = document.createElement("div");
      brand.id = "context-generator-overlay-brand";
      brand.style.cssText = [
        "position:relative",
        "z-index:1",
        "display:flex",
        "width:100%",
        "min-height:32px",
        "padding:0 5px",
        "box-sizing:border-box",
        "align-items:center",
        "justify-content:flex-start",
        "gap:9px",
        "color:rgba(245,243,250,0.76)",
        "font-size:12.5px",
        "font-weight:650",
        "letter-spacing:0.01em"
      ].join(";");

      const brandIcon = document.createElement("img");
      brandIcon.id = "context-generator-overlay-brand-icon";
      brandIcon.src = BUBBLE_ICON_URL;
      brandIcon.alt = "";
      brandIcon.width = 28;
      brandIcon.height = 28;
      brandIcon.style.cssText = [
        "display:block",
        "width:30px",
        "height:30px",
        "box-sizing:border-box",
        "padding:3px",
        "border:1px solid rgba(185,158,228,0.20)",
        "border-radius:10px",
        "background:linear-gradient(145deg,rgba(189,158,238,0.20),rgba(102,72,155,0.12))",
        "object-fit:contain",
        "box-shadow:inset 0 1px 0 rgba(255,255,255,0.10),0 8px 20px rgba(74,48,121,0.26)",
        "filter:drop-shadow(0 4px 10px rgba(141,108,207,0.20))"
      ].join(";");

      const brandText = document.createElement("span");
      brandText.textContent = "Cap Context";
      brand.appendChild(brandIcon);
      brand.appendChild(brandText);

      const statusGroup = document.createElement("div");
      statusGroup.id = "context-generator-status-group";
      statusGroup.style.cssText = [
        "position:relative",
        "z-index:1",
        "display:flex",
        "flex-direction:column",
        "align-items:flex-start",
        "justify-content:center",
        "gap:5px",
        "width:100%",
        "padding:2px 10px 0",
        "box-sizing:border-box"
      ].join(";");

      const statusText = document.createElement("div");
      statusText.id = "context-generator-text";
      statusText.setAttribute("aria-live", "polite");
      statusText.setAttribute("aria-atomic", "true");
      statusText.style.cssText = [
        "position:relative",
        "z-index:1",
        "display:flex",
        "min-height:42px",
        "align-items:center",
        "justify-content:flex-start",
        "font-size:34px",
        "font-family:Georgia,'Times New Roman',serif",
        "font-weight:500",
        "line-height:1.08",
        "text-align:left",
        "text-wrap:balance",
        "color:#f2f0f6",
        "letter-spacing:-0.04em",
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
      statusGroup.appendChild(statusText);

      const progress = document.createElement("div");
      progress.id = "context-generator-handoff-progress";
      progress.setAttribute("role", "list");
      progress.setAttribute("aria-label", "Transfer progress");
      progress.style.cssText = [
        "position:relative",
        "z-index:1",
        "display:grid",
        "grid-template-columns:repeat(3,minmax(0,1fr))",
        "width:100%",
        "margin:0 auto",
        "padding:16px 2px 0",
        "box-sizing:border-box",
        "border-top:1px solid rgba(255,255,255,0.09)",
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
        styleSheet.className = "darkreader";
        styleSheet.dataset.contextGeneratorOwned = "true";
        styleSheet.textContent = `
          @keyframes contextGeneratorHeadlineIn{
            from{opacity:0.62;transform:translate3d(0,4px,0)}
            to{opacity:1;transform:translate3d(0,0,0)}
          }
          @keyframes contextGeneratorHandoffContentIn{
            from{opacity:0.36;transform:translate3d(0,5px,0)}
            to{opacity:1;transform:translate3d(0,0,0)}
          }
          @keyframes contextGeneratorSummaryDotHop{
            0%,48%,100%{opacity:0.54;transform:translate3d(0,0,0)}
            18%{opacity:1;transform:translate3d(0,-3px,0)}
          }
          @keyframes contextGeneratorStageHalo{
            0%,100%{opacity:0.22;transform:scale(0.9)}
            50%{opacity:0.62;transform:scale(1.08)}
          }
          @keyframes contextGeneratorAuroraDrift{
            0%,100%{opacity:0.62;transform:translate3d(0,0,0) scale(1)}
            50%{opacity:0.88;transform:translate3d(-12px,7px,0) scale(1.06)}
          }
          #${OVERLAY_ID} .context-generator-handoff-atmosphere::before,
          #${OVERLAY_ID} .context-generator-handoff-atmosphere::after{
            content:"";
            position:absolute;
            border-radius:999px;
            pointer-events:none;
            filter:blur(18px);
            will-change:transform,opacity;
          }
          #${OVERLAY_ID} .context-generator-handoff-atmosphere::before{
            width:260px;
            height:118px;
            right:-54px;
            top:-58px;
            background:radial-gradient(ellipse,rgba(190,158,237,0.30),rgba(101,78,158,0.08) 54%,transparent 73%) !important;
            transform:rotate(-9deg);
            animation:contextGeneratorAuroraDrift 7200ms cubic-bezier(0.45,0,0.55,1) infinite;
          }
          #${OVERLAY_ID} .context-generator-handoff-atmosphere::after{
            width:190px;
            height:110px;
            left:-72px;
            bottom:-64px;
            background:radial-gradient(ellipse,rgba(104,73,164,0.25),transparent 72%) !important;
          }
          #context-generator-status-group::before{
            content:"CONTEXT TRANSFER";
            display:block;
            color:rgba(216,202,237,0.48) !important;
            font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
            font-size:9.5px;
            font-weight:720;
            line-height:1;
            letter-spacing:0.16em;
          }
          #context-generator-text .context-generator-summary-activity{
            display:none;
            flex:0 0 auto;
            position:relative;
            top:1px;
            margin-left:1px;
            align-items:baseline;
            gap:0;
            color:#f2f0f6 !important;
            font:inherit;
            line-height:inherit;
            letter-spacing:0;
            pointer-events:none;
          }
          #${OVERLAY_ID}.context-generator-handoff-entering #context-generator-overlay-brand{
            animation:contextGeneratorHandoffContentIn 300ms cubic-bezier(0.16,1,0.3,1) both;
          }
          #${OVERLAY_ID}.context-generator-handoff-entering #context-generator-status-group{
            animation:contextGeneratorHandoffContentIn 340ms cubic-bezier(0.16,1,0.3,1) 20ms both;
          }
          #${OVERLAY_ID}.context-generator-handoff-entering #context-generator-handoff-progress{
            animation:contextGeneratorHandoffContentIn 380ms cubic-bezier(0.16,1,0.3,1) 45ms both;
          }
          #context-generator-text .context-generator-summary-activity[data-active="true"]{
            display:inline-flex;
          }
          #context-generator-text .context-generator-summary-activity-dot{
            display:inline-block;
            color:inherit !important;
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
            gap:7px;
            padding:0 5px;
            color:rgba(239,237,244,0.54) !important;
            text-align:center;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage-connector{
            position:absolute;
            z-index:0;
            top:13px;
            left:calc(50% + 20px);
            right:calc(-50% + 20px);
            height:2px;
            overflow:visible;
            border-radius:999px;
            background:rgba(255,255,255,0.095) !important;
            box-shadow:inset 0 1px 0 rgba(255,255,255,0.035) !important;
          }
          /* The line follows live display progress; its motion never gates the transfer pipeline. */
          #context-generator-handoff-progress .context-generator-handoff-stage-connector-fill{
            position:absolute;
            inset:0;
            width:100%;
            border-radius:inherit;
            background:linear-gradient(90deg,#755BA8,#AE8BE4) !important;
            box-shadow:2px 0 9px rgba(159,125,216,0.36) !important;
            transform:scaleX(var(--context-generator-stage-progress-ratio,0));
            transform-origin:left center;
            transition:transform var(--context-generator-stage-progress-duration,1.35s) var(--context-generator-stage-progress-easing,linear);
            will-change:transform;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage-progress-head{
            position:absolute;
            z-index:1;
            inset:0 auto auto 0;
            width:100%;
            height:2px;
            opacity:0;
            transform:translate3d(var(--context-generator-stage-progress-position,0%),0,0);
            transition:transform var(--context-generator-stage-progress-duration,1.35s) var(--context-generator-stage-progress-easing,linear),opacity 160ms ease;
            will-change:transform;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage-progress-head::after{
            content:"";
            position:absolute;
            top:50%;
            left:0;
            width:5px;
            height:5px;
            border-radius:999px;
            background:#C1A6ED !important;
            box-shadow:0 0 0 2px rgba(141,108,207,0.15),0 0 10px rgba(187,154,234,0.78) !important;
            transform:translate(-50%,-50%);
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="active"] .context-generator-handoff-stage-progress-head{
            opacity:1;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-context-generator-stage="summary"][data-state="active"] .context-generator-handoff-stage-progress-head::after{
            animation:contextGeneratorSummaryLinePulse 1600ms ease-in-out infinite alternate;
          }
          @keyframes contextGeneratorSummaryLinePulse{
            from{opacity:1;transform:translate(-50%,-50%) scale(0.85)}
            to{opacity:1;transform:translate(-50%,-50%) scale(1.25)}
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="complete"] .context-generator-handoff-stage-progress-head{
            opacity:0;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage-marker{
            position:relative;
            z-index:1;
            display:flex;
            width:28px;
            height:28px;
            align-items:center;
            justify-content:center;
            box-sizing:border-box;
            border:1px solid rgba(255,255,255,0.16) !important;
            border-radius:999px;
            background:rgba(255,255,255,0.035) !important;
            color:rgba(245,243,249,0.44) !important;
            font-size:10px;
            font-weight:700;
            transition:background 180ms ease,border-color 180ms ease,color 180ms ease,box-shadow 180ms ease;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage-marker::after{
            content:"";
            position:absolute;
            inset:-5px;
            z-index:-1;
            border:1px solid rgba(169,139,226,0.46) !important;
            border-radius:999px;
            opacity:0;
            transform:scale(0.9);
          }
          #context-generator-handoff-progress .context-generator-handoff-stage-label{
            min-height:30px;
            font-size:11.75px;
            font-weight:600;
            line-height:1.22;
            letter-spacing:0.005em;
            transition:color 180ms ease,font-weight 180ms ease,opacity 180ms ease;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="active"]{
            color:#f4f2f7 !important;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="active"] .context-generator-handoff-stage-marker{
            border-color:rgba(210,190,241,0.78) !important;
            background:linear-gradient(145deg,#9B7BD7,#7456AD) !important;
            color:#fff !important;
            box-shadow:0 0 0 3px rgba(141,108,207,0.15),0 6px 16px rgba(63,43,98,0.34),inset 0 1px 0 rgba(255,255,255,0.22) !important;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="active"] .context-generator-handoff-stage-marker::after{
            animation:contextGeneratorStageHalo 2400ms cubic-bezier(0.45,0,0.55,1) infinite;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="active"] .context-generator-handoff-stage-label{
            color:#fff !important;
            font-weight:680;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="complete"]{
            color:rgba(200,183,229,0.72) !important;
          }
          #context-generator-handoff-progress .context-generator-handoff-stage[data-state="complete"] .context-generator-handoff-stage-marker{
            border-color:rgba(164,137,216,0.34) !important;
            background:rgba(141,108,207,0.14) !important;
            color:#C8B6E9 !important;
            box-shadow:inset 0 1px 0 rgba(255,255,255,0.055) !important;
          }
          @media (prefers-reduced-motion: reduce){
            #context-generator-text{animation:none!important}
            #${OVERLAY_ID}.context-generator-handoff-entering #context-generator-overlay-brand,
            #${OVERLAY_ID}.context-generator-handoff-entering #context-generator-status-group,
            #${OVERLAY_ID}.context-generator-handoff-entering #context-generator-handoff-progress{animation:none!important}
            #context-generator-text .context-generator-summary-activity-dot{animation:none!important;opacity:0.72}
            #context-generator-handoff-progress .context-generator-handoff-stage-progress-head::after{animation:none!important}
            #${HANDOFF_REASSURANCE_ID}{transition:none!important}
            #context-generator-handoff-progress .context-generator-handoff-stage-marker::after{animation:none!important}
            #${OVERLAY_ID} .context-generator-handoff-atmosphere::before{animation:none!important}
            #context-generator-handoff-progress .context-generator-handoff-stage-connector-fill,
            #context-generator-handoff-progress .context-generator-handoff-stage-progress-head{transition:none!important}
          }
        `;
        document.head.appendChild(styleSheet);
        applyOwnedUiStyleSheet(styleSheet);
      }

      const countdown = document.createElement("div");
      countdown.id = HANDOFF_COUNTDOWN_ID;
      countdown.setAttribute("aria-label", "Estimated time remaining");
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
        "border:1px solid rgba(255,255,255,0.12)",
        "background:rgba(255,255,255,0.06)",
        "box-shadow:inset 0 1px 0 rgba(255,255,255,0.05)",
        "color:rgba(250,249,252,0.82)",
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
      overlay.appendChild(statusGroup);
      overlay.appendChild(progress);
      protectOverlayPalette(overlay);
      document.body.appendChild(overlay);
    }
  }

  function showOverlay(destinationId = null) {
    hideErrorOverlay(undefined, { immediate: true });
    ensureFloatingOverlay();
    document.getElementById("context-generator-capture-notice")?.remove();
    const overlay = document.getElementById(OVERLAY_ID);
    const scrim = document.getElementById(HANDOFF_SCRIM_ID);
    const bubble = document.getElementById(BUBBLE_ID);

    if (overlay) {
      clearTimeout(handoffOverlayHideTimer);
      clearTimeout(handoffScrimHideTimer);
      handoffOverlayHideTimer = null;
      handoffScrimHideTimer = null;
      const destinationName = getPlatform(destinationId)?.name || "destination";
      overlay.dataset.contextGeneratorDestinationName = destinationName;
      overlay.setAttribute("aria-hidden", "false");
      overlay.setAttribute("aria-busy", "true");
      setHandoffProgress("capture", "active", destinationName);
      stopHandoffCountdown();
      overlay.classList.remove("context-generator-handoff-entering");
      overlay.style.opacity = "0";
      overlay.style.display = "flex";
      overlay.style.transform = getHandoffStartTransform(overlay);
      pendingHandoffOrigin = null;
      if (scrim) {
        scrim.style.opacity = "0";
        scrim.style.display = "block";
      }
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        overlay.style.opacity = "1";
        overlay.style.transform = "translate3d(-50%,-50%,0) translateY(0) scale(1)";
        if (scrim) scrim.style.opacity = "1";
      } else {
        void overlay.offsetWidth;
        overlay.classList.add("context-generator-handoff-entering");
        requestAnimationFrame(() => {
          if (overlay.getAttribute("aria-hidden") === "true") return;
          overlay.style.opacity = "1";
          overlay.style.transform = "translate3d(-50%,-50%,0) translateY(0) scale(1)";
          if (scrim) scrim.style.opacity = "1";
        });
      }
    }

    if (bubble) {
      bubble.disabled = true;
      bubble.setAttribute("aria-expanded", "false");
      bubble.style.opacity = "0";
      bubble.style.transform = "translate3d(0,0,0) scale(0.82)";
      bubble.style.cursor = "not-allowed";
      bubble.style.pointerEvents = "none";
    }
  }

  function getHandoffStartTransform(overlay) {
    if (!pendingHandoffOrigin) return HANDOFF_OVERLAY_CLOSED_TRANSFORM;

    const finalCenterX = window.innerWidth / 2;
    const finalCenterY = window.innerHeight * 0.47;
    const overlayWidth = overlay.offsetWidth || 580;
    const widthRatio = pendingHandoffOrigin.width / overlayWidth;
    const scale = Math.max(0.72, Math.min(0.9, widthRatio));
    const offsetX = Math.round(pendingHandoffOrigin.centerX - finalCenterX);
    const offsetY = Math.round(pendingHandoffOrigin.centerY - finalCenterY);
    return `translate3d(calc(-50% + ${offsetX}px),calc(-50% + ${offsetY}px),0) scale(${scale.toFixed(3)})`;
  }

  function hideOverlay({ immediate = false } = {}) {
    const overlay = document.getElementById(OVERLAY_ID);
    const scrim = document.getElementById(HANDOFF_SCRIM_ID);
    const bubble = document.getElementById(BUBBLE_ID);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const shouldAnimate = !immediate && !reducedMotion;

    stopHandoffCountdown();
    stopHandoffLiveProgress();
    clearTimeout(handoffOverlayHideTimer);
    clearTimeout(handoffScrimHideTimer);
    handoffOverlayHideTimer = null;
    handoffScrimHideTimer = null;
    if (overlay) {
      overlay.classList.remove("context-generator-handoff-entering");
      overlay.setAttribute("aria-hidden", "true");
      overlay.setAttribute("aria-busy", "false");
      overlay.style.opacity = "0";
      overlay.style.transform = HANDOFF_OVERLAY_CLOSED_TRANSFORM;
      if (shouldAnimate && overlay.style.display === "flex") {
        handoffOverlayHideTimer = setTimeout(() => {
          overlay.style.display = "none";
          handoffOverlayHideTimer = null;
        }, HANDOFF_OVERLAY_EXIT_MS);
      } else {
        overlay.style.display = "none";
      }
    }
    if (scrim) {
      scrim.style.opacity = "0";
      if (shouldAnimate && scrim.style.display === "block") {
        handoffScrimHideTimer = setTimeout(() => {
          scrim.style.display = "none";
          handoffScrimHideTimer = null;
        }, HANDOFF_OVERLAY_EXIT_MS);
      } else {
        scrim.style.display = "none";
      }
    }
    if (bubble) {
      bubble.disabled = false;
      bubble.style.opacity = "1";
      bubble.style.filter = "none";
      bubble.style.transform = "translate3d(0,0,0) scale(1)";
      bubble.style.cursor = "pointer";
      bubble.style.pointerEvents = "auto";
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
    stageElement.style.setProperty(
      "--context-generator-stage-progress-ratio",
      normalized.toFixed(4)
    );
    stageElement.dataset.contextGeneratorLineProgress = normalized.toFixed(4);
  }

  function reportHandoffCaptureProgress(scrollState) {
    if (!isHandoffOverlayVisible()) return;
    const lineProgress = getHandoffCaptureLineProgress(scrollState);
    if (handoffCaptureProgressFrame) cancelAnimationFrame(handoffCaptureProgressFrame);

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
      handoffCaptureProgressFrame = requestAnimationFrame(applyProgress);
    } else {
      applyProgress();
    }
  }

  function getHandoffSummaryLineDuration(inputChars) {
    // Sep 30 real runs: ~19k-70k chars took 13-20s; ~109k took 63s.
    // This is a display estimate, never a request deadline or measured percentage.
    const sizeRatio = Math.max(0, Math.min(1, (Number(inputChars || 0) - 60000) / 50000));
    return Math.round(20000 + sizeRatio * 45000);
  }

  function startHandoffActivityProgress(stageId, inputChars = 0) {
    stopHandoffActivityProgress();
    if (stageId !== "summary" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    if (!window.requestAnimationFrame) return;

    // Two frames let the 5% start paint before the long transition begins.
    handoffActivityProgressFrame = requestAnimationFrame(() => {
      handoffActivityProgressFrame = requestAnimationFrame(() => {
        handoffActivityProgressFrame = null;
        const stageElement = document.querySelector(
          `#context-generator-handoff-progress [data-context-generator-stage='${stageId}']`
        );
        if (!stageElement || stageElement.dataset.state !== "active" || !isHandoffOverlayVisible()) return;
        stageElement.style.setProperty(
          "--context-generator-stage-progress-duration",
          `${getHandoffSummaryLineDuration(inputChars)}ms`
        );
        stageElement.style.setProperty("--context-generator-stage-progress-easing", "linear");
        setHandoffStageLineProgress(stageId, HANDOFF_ACTIVITY_LINE_MAX);
      });
    });
  }

  function stopHandoffActivityProgress() {
    if (!handoffActivityProgressFrame) return;
    cancelAnimationFrame(handoffActivityProgressFrame);
    handoffActivityProgressFrame = null;
  }

  function stopHandoffLiveProgress() {
    stopHandoffActivityProgress();
    if (handoffCaptureProgressFrame) {
      cancelAnimationFrame(handoffCaptureProgressFrame);
      handoffCaptureProgressFrame = null;
    }
  }

  function setHandoffProgress(stageId, phase = "active", destinationName = null, inputChars = 0) {
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
      stageElement.style.setProperty("--context-generator-stage-progress-easing", "linear");
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
    if (phase === "active") startHandoffActivityProgress(stageId, inputChars);
  }

  async function completeHandoffStageLine(stageId, durationMs) {
    const skipMotion = document.visibilityState === "hidden"
      || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const stageElement = document.querySelector(
      `#context-generator-handoff-progress [data-context-generator-stage='${stageId}']`
    );
    if (!stageElement) return;

    const connector = stageElement.querySelector(".context-generator-handoff-stage-connector");
    const fill = stageElement.querySelector(".context-generator-handoff-stage-connector-fill");
    const connectorWidth = connector?.getBoundingClientRect?.().width || 0;
    const renderedWidth = fill?.getBoundingClientRect?.().width || 0;
    const renderedProgress = connectorWidth > 0
      ? Math.max(0, Math.min(1, renderedWidth / connectorWidth))
      : Number(stageElement.dataset.contextGeneratorLineProgress || 0);
    if (renderedProgress >= 0.999) return;

    // Retarget from the rendered position so completion never jumps or restarts.
    stageElement.style.setProperty("--context-generator-stage-progress-duration", "0ms");
    setHandoffStageLineProgress(stageId, renderedProgress);
    void stageElement.offsetWidth;
    stageElement.style.setProperty(
      "--context-generator-stage-progress-duration",
      skipMotion ? "0ms" : `${durationMs}ms`
    );
    stageElement.style.setProperty("--context-generator-stage-progress-easing", "linear");
    setHandoffStageLineProgress(stageId, 1);

    if (!skipMotion) await delay(durationMs);
  }

  async function completeHandoffForDestinationReveal(trace = null) {
    markTransferTrace(trace, "handoff finish start");
    stopHandoffActivityProgress();
    await completeHandoffStageLine("summary", HANDOFF_FINAL_LINE_DURATION_MS);

    setHandoffProgress("paste", "done");
    // Background tabs can suspend animation frames indefinitely. A painted tick
    // is cosmetic: never let it hold destination activation or receipt saving.
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (window.requestAnimationFrame && document.visibilityState !== "hidden" && !reducedMotion) {
      await new Promise((resolve) => {
        let frame = null;
        let timer = null;
        const finish = () => {
          clearTimeout(timer);
          cancelAnimationFrame(frame);
          removeOwnedEventListener(document, "visibilitychange", onVisibilityChange);
          resolve();
        };
        const onVisibilityChange = () => {
          if (document.visibilityState === "hidden") finish();
        };
        timer = setTimeout(finish, HANDOFF_FINAL_PAINT_WAIT_MS);
        addOwnedEventListener(document, "visibilitychange", onVisibilityChange);
        frame = requestAnimationFrame(() => {
          frame = requestAnimationFrame(finish);
        });
      });
    }
    markTransferTrace(trace, "handoff finish done");
  }

  function startHandoffCountdown(durationMs) {
    stopHandoffCountdown();
    const countdown = document.getElementById(HANDOFF_COUNTDOWN_ID);
    if (!countdown) return;

    const startMs = durationMs;
    const startedAt = getNow();
    countdown.setAttribute("aria-label", "Estimated time remaining");
    countdown.style.display = "inline-flex";
    countdown.style.opacity = "1";

    const updateCountdown = () => {
      const remainingMs = startMs - (getNow() - startedAt);
      if (remainingMs <= 0) {
        hideHandoffCountdown(countdown);
        return;
      }

      countdown.textContent = `~${Math.max(1, Math.ceil(remainingMs / 1000))}s`;
    };

    updateCountdown();
    handoffCountdownTimer = setInterval(updateCountdown, 250);
  }

  function hideHandoffCountdown(countdown = document.getElementById(HANDOFF_COUNTDOWN_ID)) {
    if (handoffCountdownTimer) {
      clearInterval(handoffCountdownTimer);
      handoffCountdownTimer = null;
    }
    if (!countdown) return;

    countdown.style.opacity = "0";
    handoffCountdownHideTimer = setTimeout(() => {
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
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const sheet = document.getElementById(DESTINATION_SHEET_ID);
    const handoff = document.getElementById(OVERLAY_ID);
    const sourceSurface = isDestinationSheetOpen() ? sheet : isHandoffOverlayVisible() ? handoff : null;
    const exitMs = sourceSurface === sheet ? DESTINATION_SHEET_EXIT_MS : HANDOFF_OVERLAY_EXIT_MS;
    // Finish the current surface's exit before revealing its replacement.
    // Reopening the picker cancels this reveal, so an old error cannot flash back.
    if (sourceSurface && sourceSurface === sheet) hideDestinationSheet({ restoreFocus: false });
    if (sourceSurface && sourceSurface === handoff) hideOverlay();
    const isNoConversationError = message === NO_CONVERSATION_ERROR_MESSAGE;
    const isSummaryRetryError = message === SUMMARY_RETRY_ERROR_MESSAGE;
    let errorDiv = document.getElementById("context-generator-error-overlay");
    if (!errorDiv) {
      errorDiv = document.createElement("div");
      errorDiv.id = "context-generator-error-overlay";
      errorDiv.dataset.contextGeneratorOwned = "true";
      errorDiv.setAttribute("role", "alert");
      errorDiv.setAttribute("aria-atomic", "true");
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
      addOwnedEventListener(closeBtn, "click", () => {
        hideErrorOverlay(errorDiv);
      });

      header.appendChild(mark);
      header.appendChild(title);
      errorDiv.appendChild(accent);
      errorDiv.appendChild(header);
      errorDiv.appendChild(textSpan);
      errorDiv.appendChild(closeBtn);
      protectOverlayPalette(errorDiv);
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

    hideErrorOverlay(errorDiv, { immediate: true });
    errorDiv.style.transition = reducedMotion ? "none" : "opacity 260ms ease,transform 260ms ease";
    errorDiv.style.transform = "translate3d(24px,0,0)";
    const reveal = () => {
      errorDiv.contextGeneratorEnterTimer = null;
      errorDiv.style.display = "flex";
      errorDiv.setAttribute("aria-hidden", "false");
      // Keep notifications anchored to the bottom-right, independent of transfer UI.
      errorDiv.style.right = "20px";
      errorDiv.style.bottom = "80px";
      errorDiv.style.left = "auto";
      errorDiv.style.top = "auto";
      const settle = () => {
        errorDiv.contextGeneratorAnimationFrame = null;
        errorDiv.style.opacity = "1";
        errorDiv.style.transform = "translate3d(0,0,0)";
      };
      if (reducedMotion) settle();
      else {
        void errorDiv.offsetWidth;
        errorDiv.contextGeneratorAnimationFrame = requestAnimationFrame(settle);
      }
      errorDiv.contextGeneratorHideTimer = setTimeout(() => hideErrorOverlay(errorDiv), 8000);
    };
    if (sourceSurface && !reducedMotion) errorDiv.contextGeneratorEnterTimer = setTimeout(reveal, exitMs);
    else reveal();
  }

  function hideErrorOverlay(errorDiv = document.getElementById("context-generator-error-overlay"), { immediate = false } = {}) {
    if (!errorDiv) return;
    clearTimeout(errorDiv.contextGeneratorEnterTimer);
    clearTimeout(errorDiv.contextGeneratorHideTimer);
    clearTimeout(errorDiv.contextGeneratorDisplayTimer);
    cancelAnimationFrame(errorDiv.contextGeneratorAnimationFrame);
    errorDiv.setAttribute("aria-hidden", "true");
    errorDiv.style.opacity = "0";
    errorDiv.style.transform = "translate3d(24px,0,0)";
    if (immediate || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) errorDiv.style.display = "none";
    else errorDiv.contextGeneratorDisplayTimer = setTimeout(() => {
      errorDiv.style.display = "none";
    }, 280);
  }

  function showFallbackModal(text, destinationName, isBackup = false) {
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

      addOwnedEventListener(copyBtn, "click", async () => {
        const currentText = textarea.value || "";
        let copied = false;
        try {
          if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable.");
          await navigator.clipboard.writeText(currentText);
          copied = true;
        } catch (_error) {
          textarea.focus();
          textarea.select();
          try {
            copied = document.execCommand("copy") === true;
          } catch {
            copied = false;
          }
        }

        if (!copied) {
          copyBtn.textContent = "Select text and copy manually";
          copyBtn.style.background = "linear-gradient(180deg,#ffd980,#e8ad37)";
          copyBtn.style.color = "#211500";
          return;
        }

        copyBtn.textContent = "Copied!";
        copyBtn.style.background = "linear-gradient(180deg,#69e6a2,#21b36b)";
        copyBtn.style.color = "#07150d";
        setTimeout(() => {
          if (!copyBtn.isConnected) return;
          copyBtn.textContent = "Copy Context";
          copyBtn.style.background = "linear-gradient(180deg,#f5f5f5,#d8d8d8)";
          copyBtn.style.color = "#111114";
        }, 2000);
      });

      const closeModal = () => {
        removeOwnedEventListener(document, "keydown", modal.contextGeneratorKeydownHandler);
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
      addOwnedEventListener(modal, "click", (event) => {
        if (event.target === modal) closeModal();
      });
      addOwnedEventListener(content, "click", (event) => event.stopPropagation());
      [copyBtn, dismissBtn].forEach((button) => {
        addOwnedEventListener(button, "focus", () => setFocusStyle(button, true));
        addOwnedEventListener(button, "blur", () => setFocusStyle(button, false));
      });
      addOwnedEventListener(dismissBtn, "click", closeModal);

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
      addOwnedEventListener(document, "keydown", modal.contextGeneratorKeydownHandler);
    } else {
      modal.style.display = "flex";
      if (!modal.contextGeneratorKeydownHandler) {
        modal.contextGeneratorKeydownHandler = (event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            modal.contextGeneratorClose?.();
          }
        };
        addOwnedEventListener(document, "keydown", modal.contextGeneratorKeydownHandler);
      }
    }

    modal.contextGeneratorPreviousFocus = document.activeElement;

    const title = document.getElementById("context-generator-fallback-title");
    if (title) title.textContent = isBackup ? "In case the paste didn't work" : "Context is ready to copy";

    const desc = document.getElementById("context-generator-fallback-desc");
    if (desc) {
      desc.textContent = isBackup
        ? `If anything got lost on the way to ${destinationName}, no worries—your context is right here. Copy it from here.`
        : `Auto-paste did not land in ${destinationName}. The context is safe here - copy it, paste it into the message box, then send when ready.`;
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

  function updateFloatingButtonPosition(recalculationReason = "direct") {
    if (["claude", "chatgpt"].includes(currentPlatform.id)) {
      ensureFloatingButton(recalculationReason);
      return;
    }
    const bubble = document.getElementById(BUBBLE_ID) || transientComposerPlacement?.bubble || null;
    const input = findPlatformInput();
    if (!bubble || !input) {
      if (retainTransientComposerPlacement(bubble)) return;
      stopPlatformPlacementResizeMonitoring();
      stopProviderControlMutationMonitoring();

      return;
    }

    if (mountProviderInlineButton(bubble, input)) {
      inlineBubble = bubble;
      ensureFloatingOverlay();
      maybeShowOnboardingNudge(bubble);
      return;
    }
    const composerSurface = findComposerSurfaceElement(input);
    if (!composerSurface) {
      if (retainTransientComposerPlacement(bubble)) return;
      stopProviderControlMutationMonitoring();
      bubble.style.display = "none";
      hideOnboardingNudge();
      return;
    }

    reserveComposerSurface(composerSurface);
    syncPlatformPlacementResizeMonitoring(input, composerSurface);

    const bubbleRoot = composerSurface;
    if (bubble.parentElement !== bubbleRoot) {
      bubbleRoot.appendChild(bubble);
    }

    const composerRect = composerSurface.getBoundingClientRect();
    if (
      composerRect.width < 280 ||
      composerRect.height < 20 ||
      composerRect.bottom < 0 ||
      composerRect.top > window.innerHeight
    ) {
      if (retainTransientComposerPlacement(bubble)) return;
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
      recordTransientComposerPlacement(
        bubble,
        composerRect.left + grokPlacement.left,
        composerRect.top + grokPlacement.top
      );
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
        recordTransientComposerPlacement(
          bubble,
          composerRect.left + deepSeekPlacement.left,
          composerRect.top + deepSeekPlacement.top
        );
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
      recordTransientComposerPlacement(
        bubble,
        composerRect.right - geminiPlacement.right - BUBBLE_SIZE,
        composerRect.bottom - geminiPlacement.bottom - BUBBLE_SIZE
      );
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

  function getRightmostControlEdge(controls) {
    return controls.reduce((right, control) => Math.max(right, control.rect.right), 0);
  }

  function isComposerPopupControl(element, composerRoot) {
    // Nested popup controls are not anchors or reservation targets. Allow a
    // dialog that contains the actual composer, rather than excluding its UI.
    const popup = element.closest("dialog, [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [role='menuitem'], [role='menuitemradio'], [role='menuitemcheckbox'], [role='option'], [aria-modal='true'], [popover], [data-radix-popper-content-wrapper]");
    return Boolean(popup && (!composerRoot || !popup.contains(composerRoot)));
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

  function getGrokBubblePlacement(composerRect) {
    const controlRowStart = getGrokComposerButtonCandidates(composerRect)[0];
    if (controlRowStart) {
      const left = controlRowStart.rect.left - composerRect.left - BUBBLE_SIZE - BUBBLE_GAP;
      if (left >= BUBBLE_GAP) {
        return getBubblePlacementBesideRect(controlRowStart.rect, composerRect, left);
      }
    }

    return getBottomRightRowBubblePlacement(composerRect, 186);
  }

  function getDeepSeekBubblePlacement(composerRect) {
    const rowButtons = getDeepSeekComposerButtonCandidates(composerRect);
    if (rowButtons.length < 2) return getDeepSeekFallbackBubblePlacement(composerRect);

    const controlRowStart = rowButtons[0];
    const left = controlRowStart.rect.left - composerRect.left - BUBBLE_SIZE - BUBBLE_GAP;
    if (left < BUBBLE_GAP) return getDeepSeekFallbackBubblePlacement(composerRect);

    return getBubblePlacementBesideRect(controlRowStart.rect, composerRect, left);
  }

  function getDeepSeekFallbackBubblePlacement(composerRect) {
    return getBottomRightRowBubblePlacement(composerRect, 104);
  }

  function findGeminiModelSelectorButton(composerRect) {
    if (!composerRect) return null;

    const rowTop = composerRect.bottom - Math.max(64, composerRect.height * 0.65);

    return Array.from(document.querySelectorAll("button, [role='button'], [tabindex='0']"))
      .filter((element) => element.id !== BUBBLE_ID && !isContextGeneratorNode(element) && isVisible(element))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => {
        return (
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
      .sort((a, b) => a.rect.left - b.rect.left)[0]?.element || null;
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
        return (
          button.id !== BUBBLE_ID &&
          !isContextGeneratorNode(button) &&
          isVisible(button) &&
          !isDisabled(button)
        );
      })
      .map((button) => ({ button, rect: button.getBoundingClientRect() }))
      .filter(({ rect }) => {
        return (
          rect.width > 0 &&
          rect.width <= 180 &&
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

    // These platforms can reflow the editor before the verified outer composer.
    const retainedSurface = getRetainedPlatformComposerSurface(input);
    if (retainedSurface) return retainedSurface;

    const retainedClaudeSurface = getRetainedClaudeComposerSurface(input);
    if (retainedClaudeSurface) return retainedClaudeSurface;

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
    if (
      formRect &&
      isComposerSurfaceCandidate(form, formRect, inputRect) &&
      (currentPlatform.id !== "claude" || isClaudeAnchorSurfaceCandidate(form, formRect))
    ) {
      return form;
    }

    // Every parent and ancestor has already passed through surface validation.
    // If none qualified, fail closed instead of anchoring to an editor wrapper.
    return null;
  }

  function getRetainedPlatformComposerSurface(input) {
    if (
      !TRANSIENT_COMPOSER_PLACEMENT_PLATFORMS.has(currentPlatform.id) ||
      !reservedComposerSurface ||
      !reservedComposerSurface.contains?.(input) ||
      isContextGeneratorNode(reservedComposerSurface)
    ) {
      return null;
    }

    const rect = reservedComposerSurface.getBoundingClientRect();
    const maxWidth = getMaxComposerSurfaceWidth();
    const maxHeight = currentPlatform.maxComposerHeight || 260;
    return (
      rect.width >= 280 &&
      rect.width <= maxWidth &&
      rect.height >= 40 &&
      rect.height <= maxHeight &&
      rect.bottom >= 0 &&
      rect.top <= window.innerHeight
    ) ? reservedComposerSurface : null;
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
    const maxHeight = currentPlatform.maxComposerHeight || 260;
    return (
      rect.width >= 280 &&
      rect.width <= maxWidth &&
      rect.height >= 40 &&
      rect.height <= maxHeight &&
      rect.left <= inputRect.left + 96 &&
      rect.right >= inputRect.right - 18 &&
      rect.top <= inputRect.top + 80 &&
      rect.bottom >= inputRect.bottom - 18 &&
      isClaudeComposerSurfaceHorizontallyAligned(rect, inputRect)
    );
  }

  function getMaxComposerSurfaceWidth() {
    return Math.min(currentPlatform.maxComposerWidth || DEFAULT_MAX_COMPOSER_WIDTH, window.innerWidth - 24);
  }

  function pickComposerSurfaceCandidate(candidates, input) {
    const eligibleCandidates = currentPlatform.id === "claude"
      ? candidates.filter((candidate) => isClaudeAnchorSurfaceCandidate(candidate.node, candidate.rect))
      : candidates;
    if (!eligibleCandidates.length) return null;

    return eligibleCandidates
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

  // Geometry backups share resize ownership; inline Claude/GPT clear it on mount.
  function syncPlatformPlacementResizeMonitoring(input, composerSurface) {
    if (!INLINE_MOUNT_PLATFORMS.has(currentPlatform.id)) {
      stopPlatformPlacementResizeMonitoring();
      return;
    }

    syncProviderControlMutationMonitoring(input, composerSurface);
    if (typeof ResizeObserver === "undefined") {
      stopPlatformPlacementResizeMonitoring();
      return;
    }

    const nextTargets = [input, composerSurface].filter((element, index, all) => {
      return element && all.indexOf(element) === index;
    });
    const targetsUnchanged =
      nextTargets.length === platformPlacementResizeTargets.length &&
      nextTargets.every((element, index) => element === platformPlacementResizeTargets[index]);
    if (targetsUnchanged) return;

    stopPlatformPlacementResizeMonitoring();
    platformPlacementResizeObserver = createOwnedObserver(ResizeObserver, () => scheduleFloatingButtonUpdate());
    nextTargets.forEach((element) => platformPlacementResizeObserver.observe(element));
    platformPlacementResizeTargets = nextTargets;
  }

  function stopPlatformPlacementResizeMonitoring() {
    platformPlacementResizeObserver?.disconnect();
    platformPlacementResizeObserver = null;
    platformPlacementResizeTargets = [];
  }

  function syncProviderControlMutationMonitoring(input, composerSurface) {
    if (
      !INLINE_MOUNT_PLATFORMS.has(currentPlatform.id) ||
      typeof MutationObserver === "undefined"
    ) {
      stopProviderControlMutationMonitoring();
      return;
    }

    const root = composerSurface?.contains?.(input) ? composerSurface : input;
    if (!root || root === providerControlMutationRoot) return;
    // A geometry fallback can select an inner surface after the native inline
    // class disappears. Keep watching its validated ancestor: restoring that
    // class may neither resize the inner surface nor change its children.
    if (providerControlMutationRoot?.isConnected && providerControlMutationRoot.contains(input) &&
        providerControlMutationRoot.contains(root)) return;

    stopProviderControlMutationMonitoring();
    providerControlMutationRoot = root;
    providerControlMutationObserver = createOwnedObserver(MutationObserver, (mutations) => {
      const hasRelevantControlChange = mutations.some((mutation) => {
        if (isOwnDomMutation(mutation)) return false;
        if (mutation.type !== "characterData") return true;
        // Button text can change without resizing the composer. Ignore editor
        // text mutations so ordinary typing does not schedule placement work.
        return !input.contains?.(mutation.target) && Boolean(
          mutation.target.parentElement?.closest?.("button, [role='button'], [tabindex='0']")
        );
      });
      if (!hasRelevantControlChange) return;
      scheduleFloatingButtonUpdate("provider-control-change");
    });
    providerControlMutationObserver.observe(root, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
      attributeFilter: [
        "class",
        "style",
        "aria-expanded",
        "aria-hidden",
        "aria-pressed",
        "aria-selected",
        "hidden",
        "data-state",
        "disabled"
      ]
    });
  }

  function stopProviderControlMutationMonitoring() {
    providerControlMutationObserver?.disconnect();
    providerControlMutationObserver = null;
    providerControlMutationRoot = null;
  }

  function reserveBubbleSlot(actionBtn, input) {
    const cluster = findActionCluster(actionBtn, input);
    reserveBubbleSlotForCluster(cluster);
  }

  function reserveBubbleSlotForCluster(cluster, slotWidth = BUBBLE_SLOT_WIDTH) {
    if (!cluster) return;

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

  function restoreReservedTransform(element) {
    if (!element) return;

    const originalTransform = element.getAttribute("data-context-generator-original-transform") || "";
    element.style.transform = originalTransform;
    element.style.willChange = "";
    element.removeAttribute("data-context-generator-original-transform");
    if (element.hasAttribute("data-context-generator-original-transition")) {
      element.style.transition = element.getAttribute("data-context-generator-original-transition") || "";
      element.removeAttribute("data-context-generator-original-transition");
    }
  }

  function scheduleFloatingButtonUpdate(reason = "unspecified") {
    if (floatingButtonMonitoringDisabled) return;
    if (isDestinationSheetOpen() && !invalidateInlinePicker(reason)) return;
    pendingFloatingButtonReasons.add(normalizeFloatingButtonUpdateReason(reason));
    if (floatingButtonFrame) return;
    floatingButtonFrame = requestAnimationFrame(() => {
      floatingButtonFrame = null;
      const recalculationReason = [...pendingFloatingButtonReasons].sort().join("+") || "unspecified";
      pendingFloatingButtonReasons.clear();
      if (floatingButtonMonitoringDisabled) return;
      if (isDestinationSheetOpen() && !invalidateInlinePicker(recalculationReason)) return;
      try {
        ensureFloatingButton(recalculationReason);
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

  function invalidateInlinePicker(reason) {
    if (!INLINE_MOUNT_PLATFORMS.has(currentPlatform.id)) return false;
    const input = findPlatformInput();
    const isClaude = currentPlatform.id === "claude";
    const toolbar = isClaude ? findClaudeInlineToolbar(input) : currentPlatform.id === "chatgpt"
      ? findChatGptInlineToolbar(input) : findProviderInlineToolbar(input);
    const mount = isClaude ? claudeInlineMount : currentPlatform.id === "chatgpt" ? chatGptInlineMount : providerInlineMount;
    // A fallback picker has no inline owner to invalidate on ordinary updates.
    if (!toolbar && !mount) return false;
    // A picker belongs to the editor that opened it. On replacement, route
    // change or resize close it without stealing focus; its opening position
    // is intentionally locked during the picker-to-handoff animation.
    const changed = !toolbar || !mount ||
      mount.input !== input || mount.left !== toolbar.left ||
      mount.body !== toolbar.body ||
      mount.right !== toolbar.right || mount.footer !== toolbar.footer || mount.controls !== toolbar.controls ||
      mount.slot !== toolbar.slot || mount.anchor !== toolbar.anchor || mount.modelBranch !== toolbar.modelBranch ||
      mount.surface !== toolbar.surface || mount.row !== toolbar.row || mount.dock !== toolbar.dock || mount.editorContainer !== toolbar.editorContainer ||
      (isClaude && (mount.host !== toolbar.host || mount.editorBranch !== toolbar.editorBranch || mount.actions !== toolbar.actions)) ||
      mount.pathname !== window.location.pathname ||
      normalizeFloatingButtonUpdateReason(reason).includes("resize");
    if (changed) {
      hideDestinationSheet({ restoreFocus: false });
      return true;
    }
    return false;
  }

  function recordTransientComposerPlacement(bubble, left, top) {
    if (!TRANSIENT_COMPOSER_PLACEMENT_PLATFORMS.has(currentPlatform.id) || !bubble) return;
    clearTransientComposerPlacementGraceTimer();
    transientComposerPlacement = {
      bubble,
      left: Math.round(left),
      top: Math.round(top),
      recordedAt: Date.now()
    };
  }

  function retainTransientComposerPlacement(bubble) {
    if (
      !TRANSIENT_COMPOSER_PLACEMENT_PLATFORMS.has(currentPlatform.id) ||
      !transientComposerPlacement ||
      Date.now() - transientComposerPlacement.recordedAt > TRANSIENT_COMPOSER_PLACEMENT_GRACE_MS
    ) {
      clearTransientComposerPlacement();
      return null;
    }

    const retainedBubble = bubble || transientComposerPlacement.bubble;
    if (!retainedBubble) {
      clearTransientComposerPlacement();
      return null;
    }

    const floatingRoot = getFloatingButtonRoot();
    if (retainedBubble.parentElement !== floatingRoot) floatingRoot.appendChild(retainedBubble);
    setBubbleFixedMode(retainedBubble);
    setBubbleStylesIfChanged(retainedBubble, {
      left: `${transientComposerPlacement.left}px`,
      right: "auto",
      top: `${transientComposerPlacement.top}px`,
      bottom: "auto",
      display: "flex"
    });

    if (!transientComposerPlacementGraceTimer) {
      const remainingGrace = Math.max(
        0,
        TRANSIENT_COMPOSER_PLACEMENT_GRACE_MS - (Date.now() - transientComposerPlacement.recordedAt)
      );
      transientComposerPlacementGraceTimer = setTimeout(() => {
        transientComposerPlacementGraceTimer = null;
        scheduleFloatingButtonUpdate("composer-remount-grace-expired");
      }, remainingGrace);
    }
    return retainedBubble;
  }

  function clearTransientComposerPlacementGraceTimer() {
    if (!transientComposerPlacementGraceTimer) return;
    clearTimeout(transientComposerPlacementGraceTimer);
    transientComposerPlacementGraceTimer = null;
  }

  function clearTransientComposerPlacement() {
    clearTransientComposerPlacementGraceTimer();
    transientComposerPlacement = null;
  }

  function normalizeFloatingButtonUpdateReason(reason) {
    if (typeof reason === "string" && reason) return reason;
    if (reason?.type) return reason.type;
    return "unspecified";
  }

  function isContextGeneratorNode(node) {
    return node instanceof Element && (
      node.id === BUBBLE_ID ||
      node.id === OVERLAY_ID ||
      node.id === HANDOFF_SCRIM_ID ||
      node.id === ONBOARDING_ID ||
      node.id === ONBOARDING_STYLE_ID ||
      node.id === CLAUDE_LIMIT_NUDGE_ID ||
      node.id === DESTINATION_SHEET_BACKDROP_ID ||
      node.id === "context-generator-styles" ||
      node.dataset.contextGeneratorOwned === "true" ||
      Boolean(node.closest?.(`#${BUBBLE_ID}, #${OVERLAY_ID}, #${HANDOFF_SCRIM_ID}, #${ONBOARDING_ID}, #${CLAUDE_LIMIT_NUDGE_ID}, #context-generator-styles, #${DESTINATION_SHEET_ID}, #${DESTINATION_SHEET_BACKDROP_ID}`))
    );
  }

  function isOwnDomMutation(mutation) {
    const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes].filter((node) => node instanceof Element);
    return isContextGeneratorNode(mutation.target) || (changedNodes.length > 0 && changedNodes.every(isContextGeneratorNode));
  }

  function startFloatingButtonMonitoring() {
    if (floatingButtonObserver) floatingButtonObserver.disconnect();
    floatingButtonObserver = createOwnedObserver(MutationObserver, (mutations) => {
      if (floatingButtonMonitoringDisabled) return;
      if (mutations.every(isOwnDomMutation)) return;
      scheduleFloatingButtonUpdate("document-childlist");
    });
    floatingButtonObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });

    addOwnedEventListener(window, "resize", scheduleFloatingButtonUpdate);
    addOwnedEventListener(document, "visibilitychange", scheduleFloatingButtonUpdate);
    addOwnedEventListener(document, "focusin", handleFloatingButtonFocusIn);
    startInlinePathnameMonitoring();
    scheduleFloatingButtonUpdate("monitor-start");
  }

  function startInlinePathnameMonitoring() {
    if (!INLINE_MOUNT_PLATFORMS.has(currentPlatform.id) || inlinePathnamePollTimer) return;
    lastInlinePlacementPathname = window.location.pathname;
    // Navigation API covers Chromium SPA transitions immediately. The small
    // pathname poll is the cross-browser fallback because pushState emits no
    // standard event and extension isolated worlds cannot reliably wrap it.
    addOwnedEventListener(window.navigation, "navigate", handleInlineNavigation);
    addOwnedEventListener(window, "popstate", handleInlineNavigation);
    inlinePathnamePollTimer = setInterval(checkInlinePlacementPathname, INLINE_PATHNAME_POLL_MS);
  }

  function handleInlineNavigation() {
    scheduleFloatingButtonUpdate("inline-route");
  }

  function checkInlinePlacementPathname() {
    if (!INLINE_MOUNT_PLATFORMS.has(currentPlatform.id)) return false;
    const pathname = window.location.pathname;
    if (pathname === lastInlinePlacementPathname) return false;
    lastInlinePlacementPathname = pathname;
    scheduleFloatingButtonUpdate("inline-pathname");
    return true;
  }

  function stopInlinePathnameMonitoring() {
    removeOwnedEventListener(window.navigation, "navigate", handleInlineNavigation);
    removeOwnedEventListener(window, "popstate", handleInlineNavigation);
    if (inlinePathnamePollTimer) clearInterval(inlinePathnamePollTimer);
    inlinePathnamePollTimer = null;
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
    stopPlatformPlacementResizeMonitoring();
    stopProviderControlMutationMonitoring();
    clearChatGptPlacementResizeMonitoring();
    clearTransientComposerPlacement();
    stopInlinePathnameMonitoring();


    removeOwnedEventListener(window, "resize", scheduleFloatingButtonUpdate);
    removeOwnedEventListener(document, "visibilitychange", scheduleFloatingButtonUpdate);
    removeOwnedEventListener(document, "focusin", handleFloatingButtonFocusIn);
  }

  function handleFloatingButtonFocusIn(event) {
    if (isClaudeComposerFocusTarget(event.target)) {
      dismissClaudeLimitNudge();
    }
    scheduleFloatingButtonUpdate("focusin");
  }

  function resetRunningFlag() {
    isRunning = false;
    activeTransferTrace = null;
    clearRunningResetTimer();
    hideOverlay();
  }

  function clearRunningResetTimer() {
    if (runningResetTimer) {
      clearTimeout(runningResetTimer);
      runningResetTimer = null;
    }
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
