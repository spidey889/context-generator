const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ANALYSIS_SOURCE = fs.readFileSync(path.join(__dirname, "..", "analysis", "index.html"), "utf8");

test("analysis receipt shows the served model and does not report it as failed", () => {
  const { getModelFallbackLabel, formatModelDisplayName } = loadModelHelpers();
  const summary = {
    primaryModel: "gemini-3.8-flash",
    model: "gemini-3.6-flash",
    modelsTried: ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash"],
    fallback: { used: true, model: "gemini-3.6-flash" }
  };

  assert.equal(formatModelDisplayName("gemini-3.8-flash"), "Gemini 3.8 Flash");
  assert.equal(
    getModelFallbackLabel(summary),
    "Tried this run\nGemini 3.8 Flash — failed\nGemini 3.7 Flash — failed\nGemini 3.6 Flash — served"
  );
  assert.doesNotMatch(getModelFallbackLabel(summary), /Gemini 3\.6 Flash failed/);
});

test("analysis formats a long provider failure chain as readable lines", () => {
  const { getModelFallbackLabel } = loadModelHelpers();
  assert.equal(
    getModelFallbackLabel({
      model: "local-direct",
      modelsTried: ["gemini-3.6-flash", "gemini-3.5-flash", "mistral-medium-2604", "local-direct"],
      fallback: { used: true, model: "local-direct" }
    }),
    [
      "Tried this run",
      "Gemini 3.6 Flash — failed",
      "Gemini 3.5 Flash — failed",
      "Mistral Medium 3.5 — failed",
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
