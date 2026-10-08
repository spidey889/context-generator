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
  sliceBetween("  function updateTransferDiagnostics(", "  function markCaptureDone(")
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
    URL, INLINE_PATHNAME_POLL_MS: 80, RUNNING_AUTO_RESET_MS: 360000,
    DESTINATION_SHEET_EXIT_MS: 0, NO_CONVERSATION_ERROR_MESSAGE: "No conversation",
    activeTransferTrace: null, isRunning: false, runningResetTimer: null,
    setTimeout: () => 1, setInterval: () => 1, clearInterval() {},
    addOwnedEventListener: (target, type, listener) => target?.addEventListener?.(type, listener),
    removeOwnedEventListener: (target, type, listener) => target?.removeEventListener?.(type, listener),
    ...overrides
  });
  code.runInContext(context);
  return context;
}
module.exports = { loadTransferFlow };
