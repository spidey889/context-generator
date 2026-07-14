const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "extension", "background.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "extension", "manifest.json"), "utf8"));

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

test("latest-run raw transcript expires without deleting diagnostic metadata", () => {
  assert.ok(manifest.permissions.includes("alarms"));
  assert.match(source, /const RAW_TRANSCRIPT_RETENTION_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(source, /delete retainedStats\.rawScrapedText/);
  assert.match(source, /delete retainedStats\.rawScrapedTextExpiresAt/);
  assert.doesNotMatch(source, /chrome\.storage\.local\.remove\(LAST_TRANSFER_STATS_STORAGE_KEY\)/);
});
