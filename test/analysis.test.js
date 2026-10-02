const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ANALYSIS_SOURCE = fs.readFileSync(path.join(__dirname, "..", "analysis", "index.html"), "utf8");

test("analysis receipt shows the served model and does not report it as failed", () => {
  const { getModelFallbackLabel, formatModelDisplayName } = loadModelHelpers();
  const summary = {
    primaryModel: "gemini-3.6-flash",
    model: "ministral-14b-2512",
    modelsTried: ["gemini-3.6-flash", "gemini-3.5-flash-lite", "ministral-14b-2512"],
    fallback: { used: true, model: "ministral-14b-2512" }
  };

  assert.equal(formatModelDisplayName("gemini-3.5-flash-lite"), "Gemini 3.5 Flash-Lite");
  assert.equal(
    getModelFallbackLabel(summary),
    "Tried this run\nGemini 3.6 Flash — failed\nGemini 3.5 Flash-Lite — failed\nMinistral 3 14B — served"
  );
  assert.doesNotMatch(getModelFallbackLabel(summary), /Ministral 3 14B — failed/);
});

test("analysis formats a long provider failure chain as readable lines", () => {
  const { getModelFallbackLabel } = loadModelHelpers();
  assert.equal(
    getModelFallbackLabel({
      model: "local-direct",
      modelsTried: ["gemini-3.6-flash", "gemini-3.5-flash-lite", "ministral-14b-2512", "local-direct"],
      fallback: { used: true, model: "local-direct" }
    }),
    [
      "Tried this run",
      "Gemini 3.6 Flash — failed",
      "Gemini 3.5 Flash-Lite — failed",
      "Ministral 3 14B — failed",
      "Local fallback — served"
    ].join("\n")
  );
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
