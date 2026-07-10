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
