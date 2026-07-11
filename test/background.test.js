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
