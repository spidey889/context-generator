const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ANALYSIS_SOURCE = fs.readFileSync(path.join(__dirname, "..", "analysis", "index.html"), "utf8");

test("analysis receipt shows fixed primary model and fallback log", () => {
  assert.match(ANALYSIS_SOURCE, /sideItem\("Primary model"/);
  assert.match(ANALYSIS_SOURCE, /mistral-medium-2604/);
  assert.match(ANALYSIS_SOURCE, /sideItem\("Fallback log", getModelFallbackLabel\(summary\)\)/);
  assert.match(ANALYSIS_SOURCE, /mistralModelsTried/);
  assert.doesNotMatch(ANALYSIS_SOURCE, /sideItem\("Model route"/);
  assert.doesNotMatch(ANALYSIS_SOURCE, /chars \$\{comparator\}/);
});

test("analysis displays the Medium 3.5 name instead of its API snapshot ID", () => {
  assert.match(ANALYSIS_SOURCE, /function formatModelDisplayName/);
  assert.match(ANALYSIS_SOURCE, /model === "mistral-medium-2604"/);
  assert.match(ANALYSIS_SOURCE, /return "mistral-medium-3-5"/);
  assert.match(ANALYSIS_SOURCE, /mini\("Model", formatModelDisplayName\(summary\.model\)\)/);
  assert.match(ANALYSIS_SOURCE, /tried\.map\(formatModelDisplayName\)/);
});

test("analysis keeps exact raw scraped text behind a collapsed gear control", () => {
  assert.match(ANALYSIS_SOURCE, /id="rawScrapeButton"/);
  assert.match(ANALYSIS_SOURCE, /id="rawScrapePanel" hidden/);
  assert.match(ANALYSIS_SOURCE, /rawScrapedText\.textContent = rawText/);
  assert.match(ANALYSIS_SOURCE, /Stored locally and replaced by the next transfer/);
  assert.doesNotMatch(ANALYSIS_SOURCE, /escapeHtml\(stats\.rawScrapedText\)/);
});
