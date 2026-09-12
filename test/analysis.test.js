const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ANALYSIS_SOURCE = fs.readFileSync(path.join(__dirname, "..", "analysis", "index.html"), "utf8");
const PLATFORM_SOURCE = fs.readFileSync(path.join(__dirname, "..", "extension", "platform-content.js"), "utf8");

test("analysis receipt shows the served model and does not report it as failed", () => {
  const { getModelFallbackLabel, formatModelDisplayName } = loadModelHelpers();
  const summary = {
    primaryModel: "gemini-3.8-flash",
    model: "gemini-3.6-flash",
    modelsTried: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"],
    fallback: { used: true, model: "gemini-3.6-flash" }
  };

  assert.match(ANALYSIS_SOURCE, /mini\("Served model"/);
  assert.doesNotMatch(ANALYSIS_SOURCE, /sideItem\("Primary model"/);
  assert.match(ANALYSIS_SOURCE, /sideItem\("Fallback log", getModelFallbackLabel\(summary\), "fallback"\)/);
  assert.equal(formatModelDisplayName("gemini-3.8-flash"), "Gemini 3.8 Flash");
  assert.equal(
    getModelFallbackLabel(summary),
    "Gemini 3.8 Flash failed -> Gemini 3.7 Flash failed -> Gemini 3.6 Flash served"
  );
  assert.doesNotMatch(getModelFallbackLabel(summary), /Gemini 3\.6 Flash failed/);
});

test("analysis receipt carries Gemini health skips from the backend", () => {
  const { getModelFallbackLabel } = loadModelHelpers();
  assert.match(PLATFORM_SOURCE, /geminiModelsSkipped: sanitizeGeminiModelsSkippedForStats/);
  assert.equal(
    getModelFallbackLabel({
      model: "gemini-3.7-flash",
      modelsTried: ["gemini-3.7-flash"],
      geminiModelsSkipped: [{ model: "gemini-3.8-flash", status: "bad_mood" }],
      fallback: { used: true, model: "gemini-3.7-flash" }
    }),
    "Skipped today: Gemini 3.8 Flash skipped (bad mood). Gemini 3.7 Flash served"
  );
});

test("analysis keeps exact raw scraped text behind a collapsed gear control", () => {
  assert.match(ANALYSIS_SOURCE, /id="rawScrapeButton"/);
  assert.match(ANALYSIS_SOURCE, /id="rawScrapePanel" hidden/);
  assert.match(ANALYSIS_SOURCE, /rawScrapedText\.textContent = rawText/);
  assert.match(ANALYSIS_SOURCE, /Stored locally for 24 hours or until the next transfer/);
  assert.doesNotMatch(ANALYSIS_SOURCE, /escapeHtml\(stats\.rawScrapedText\)/);
});

test("analysis keeps cached metrics tied to the original generation", () => {
  assert.doesNotMatch(ANALYSIS_SOURCE, /sideItem\("Summary source"/);
  assert.match(ANALYSIS_SOURCE, /out from original generation/);
  assert.match(ANALYSIS_SOURCE, /Cache hit; original/);
});

test("analysis receipt keeps only useful non-duplicate details", () => {
  assert.match(ANALYSIS_SOURCE, /sideItem\("Input check", integrity\)/);
  assert.match(ANALYSIS_SOURCE, /sideItem\("Message turns", formatTurnSummary\(capture\), "turns"\)/);
  assert.match(ANALYSIS_SOURCE, /Complete - all sent text received/);
  assert.doesNotMatch(ANALYSIS_SOURCE, /sideItem\("Route"/);
  assert.doesNotMatch(ANALYSIS_SOURCE, /sideItem\("Capture path"/);
  assert.doesNotMatch(ANALYSIS_SOURCE, /sideItem\("Expansion"/);
});

function loadModelHelpers() {
  const start = ANALYSIS_SOURCE.indexOf("function getModelFallbackLabel(summary)");
  const end = ANALYSIS_SOURCE.indexOf("function formatBackendLabel(summary)", start);
  assert.ok(start >= 0 && end > start, "model helper block should remain available");
  const context = {};
  vm.runInNewContext(
    `${ANALYSIS_SOURCE.slice(start, end)}; helpers = { getModelFallbackLabel, formatModelDisplayName };`,
    context
  );
  return context.helpers;
}
