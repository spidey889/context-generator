const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../../extension/platform-content.js"), "utf8");
function sliceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `Transfer fixture boundary changed: ${startMarker}`);
  return source.slice(start, end);
}
const code = new vm.Script(
  source.match(/  const OVERSIZED_CONVERSATION_ERROR_MESSAGE = .+;/)[0] + "\n"
  + source.match(/  const DOM_CAPTURE_MIN_ALLOWANCE_MS = .+;/)[0] + "\n"
  + source.match(/  const DOM_CAPTURE_MAX_ALLOWANCE_MS = .+;/)[0] + "\n"
  + sliceBetween("  function updateTransferDiagnostics(", "  function markCaptureDone(")
  + sliceBetween("  function stopSourceDestinationProgress(", "  function prepareDestinationTab(")
  + sliceBetween("  function checkTransferDeadline(", "  function createTransferTrace(")
  + sliceBetween("  function hasSavedSourceConversation()", "  function showFastCaptureFallbackMessage(")
  + "\nglobalThis.start = startDestinationTransfer;",
  { filename: "platform-transfer-flow.js" }
);

// Share browser/lifecycle plumbing between picker fixtures. Keep capture, draft,
// navigation and transfer assertions real; do not silently stub unknown helpers.
function loadTransferFlow(overrides) {
  const context = vm.createContext({
    CapTransferDiagnostics: require("../../extension/transfer-diagnostics.js"),
    getNow: () => Date.now(), isNoConversationError: error => error?.message === "No conversation",
    isExtensionContextInvalidated: error => /extension context invalidated/i.test(error?.message || ""),
    URL, AbortController, INLINE_PATHNAME_POLL_MS: 80, RUNNING_AUTO_RESET_MS: 360000, MAX_TRANSFER_CONVERSATION_CHARS: 1000000,
    DESTINATION_SHEET_EXIT_MS: 0, NO_CONVERSATION_ERROR_MESSAGE: "No conversation",
    activeTransferTrace: null, isRunning: false, runningResetTimer: null,
    pickerJsonCapture: null, pendingJsonCapture: Promise.resolve(), instanceActive: true,
    document: { getElementById: () => null },
    getConversationTurns: () => [],
    isSourceReplyInProgress: () => false,
    setTimeout: () => 1, setInterval: () => 1, clearTimeout() {}, clearInterval() {},
    notifyBackground: async () => ({ ok: true }), showDomCaptureEstimate() {},
    addOwnedEventListener: (target, type, listener) => target?.addEventListener?.(type, listener),
    removeOwnedEventListener: (target, type, listener) => target?.removeEventListener?.(type, listener),
    ...overrides
  });
  code.runInContext(context);
  return context;
}
module.exports = { loadTransferFlow };
