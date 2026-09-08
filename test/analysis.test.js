const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ANALYSIS_SOURCE = fs.readFileSync(path.join(__dirname, "..", "analysis", "index.html"), "utf8");

test("analysis receipt shows the recorded primary model and complete fallback log", () => {
  assert.match(ANALYSIS_SOURCE, /sideItem\("Primary model"/);
  assert.match(ANALYSIS_SOURCE, /getPrimaryModelLabel\(summary\)/);
  assert.match(ANALYSIS_SOURCE, /sideItem\("Fallback log", getModelFallbackLabel\(summary\)\)/);
  assert.match(ANALYSIS_SOURCE, /summary\.modelsTried/);
  assert.match(ANALYSIS_SOURCE, /mistralModelsTried/);
  assert.doesNotMatch(ANALYSIS_SOURCE, /sideItem\("Model route"/);
  assert.doesNotMatch(ANALYSIS_SOURCE, /chars \$\{comparator\}/);
});

test("analysis keeps exact raw scraped text behind a collapsed gear control", () => {
  assert.match(ANALYSIS_SOURCE, /id="rawScrapeButton"/);
  assert.match(ANALYSIS_SOURCE, /id="rawScrapePanel" hidden/);
  assert.match(ANALYSIS_SOURCE, /rawScrapedText\.textContent = rawText/);
  assert.match(ANALYSIS_SOURCE, /Stored locally for 24 hours or until the next transfer/);
  assert.doesNotMatch(ANALYSIS_SOURCE, /escapeHtml\(stats\.rawScrapedText\)/);
});

test("analysis labels cached receipt data as original generation metadata", () => {
  assert.match(ANALYSIS_SOURCE, /sideItem\("Summary source"/);
  assert.match(ANALYSIS_SOURCE, /Cache \(original generation metadata\)/);
  assert.match(ANALYSIS_SOURCE, /out from original generation/);
  assert.match(ANALYSIS_SOURCE, /Cache hit; original/);
});
