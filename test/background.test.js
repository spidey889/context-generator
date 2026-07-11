const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "extension", "background.js"), "utf8");

test("extension sends each summary job to the backend only once", () => {
  assert.match(source, /const SUMMARY_BACKEND_TIMEOUT_MS = 150000/);
  assert.doesNotMatch(source, /SUMMARY_BACKEND_ATTEMPTS|SUMMARY_BACKEND_RETRY_BUDGET_MS/);
  assert.equal((source.match(/fetch\(SUMMARY_BACKEND_URL/g) || []).length, 1);
});

test("destination preconnect and warmup never include conversation content", () => {
  const prepareStart = source.indexOf("async function prepareDestination(");
  const prepareEnd = source.indexOf("async function createDestinationTab(", prepareStart);
  const warmupStart = source.indexOf("async function warmDestinationTab(");
  const warmupEnd = source.indexOf("async function pingTab(", warmupStart);
  const warmupSource = `${source.slice(prepareStart, prepareEnd)}\n${source.slice(warmupStart, warmupEnd)}`;

  assert.ok(prepareStart >= 0 && prepareEnd > prepareStart && warmupEnd > warmupStart);
  assert.match(warmupSource, /pingTab\(tabId\)/);
  assert.match(source, /sendMessage\(tabId, \{ type: "CONTEXT_GENERATOR_PING" \}\)/);
  assert.doesNotMatch(warmupSource, /SUMMARIZE_WITH_BACKEND|conversationText|summary|PASTE_CONTEXT/);
});

test("backend errors expose only bounded user-safe messages", () => {
  assert.match(source, /conversation_too_large/);
  assert.match(source, /rate_limited/);
  assert.match(source, /payload\.error\.length <= 240/);
  assert.doesNotMatch(source, /response\.text\(\)/);
});
