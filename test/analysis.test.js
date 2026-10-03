const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ANALYSIS_SOURCE = fs.readFileSync(path.join(__dirname, "..", "analysis", "index.html"), "utf8");

test("analysis receipt shows the served model and does not report it as failed", () => {
  const { getModelFallbackLabel, formatModelDisplayName, formatBackendLabel } = loadModelHelpers();
  const summary = {
    primaryModel: "gemini-3.6-flash",
    model: "ministral-14b-2512",
    modelsTried: ["gemini-3.6-flash", "gemini-3.5-flash-lite", "ministral-14b-2512"],
    fallback: { used: true, model: "ministral-14b-2512" }
  };

  for (const [model, label] of [
    ["apodex/apodex-1.1-mini:free", "Apodex 1.1 Mini"],
    ["qwen/qwen3.8-27b:free", "Qwen3.8 27B"],
    ["dots-studio/dots-3-note-preview:free", "Dots3-Note Preview"],
    ["google/gemma-4-26b-a4b-it:free", "Gemma 4 26B A4B"],
    ["inclusionai/ling-3.1-flash", "Space Bunny 2"],
    ["gemini-3.6-flash", "Gemini 3.6 Flash"],
    ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite"],
    ["ministral-14b-2512", "Ministral 3 14B"],
    ["local-direct", "Local fallback"]
  ]) assert.equal(formatModelDisplayName(model), label);
  assert.equal(formatModelDisplayName("unsupported-model"), "n/a");
  assert.equal(formatBackendLabel({ servedBy: "openrouter" }), "OpenRouter");
  assert.equal(getModelFallbackLabel({ model: "apodex/apodex-1.1-mini:free", modelsTried: ["apodex/apodex-1.1-mini:free"] }), "Apodex 1.1 Mini served first\nNo fallback needed");
  assert.equal(getModelFallbackLabel({ model: "inclusionai/ling-3.1-flash", modelsTried: ["inclusionai/ling-3.1-flash"] }), "Space Bunny 2 served first\nNo fallback needed");
  assert.equal(getModelFallbackLabel({ model: "apodex/apodex-1.1-mini:free", modelsTried: ["inclusionai/ling-3.1-flash", "apodex/apodex-1.1-mini:free"] }), "Tried this run\nSpace Bunny 2 — failed\nApodex 1.1 Mini — served");
  assert.equal(formatBackendLabel({ servedBy: "gemini" }), "Google Gemini");
  assert.equal(formatBackendLabel({ servedBy: "mistral" }), "Mistral");
  assert.equal(formatBackendLabel({ servedBy: "local-direct" }), "Local");
  assert.equal(formatBackendLabel({ servedBy: "unsupported-provider" }), "n/a");
  assert.equal(
    getModelFallbackLabel(summary),
    "Tried this run\nGemini 3.6 Flash — failed\nGemini 3.5 Flash-Lite — failed\nMinistral 3 14B — served"
  );
  assert.doesNotMatch(getModelFallbackLabel(summary), /Ministral 3 14B — failed/);
});

test("analysis formats a long provider failure chain as readable lines", () => {
  const { getModelFallbackLabel } = loadModelHelpers();
  assert.equal(getModelFallbackLabel({ model: "unsupported-model", modelsTried: ["unsupported-model"] }), "Not recorded - run a new transfer");
  assert.equal(getModelFallbackLabel({ model: "local-direct", servedBy: "local-direct", modelsTried: [] }), "Local fallback served\nNo provider model needed");
  assert.equal(getModelFallbackLabel({ model: "gemini-3.6-flash", modelsTried: ["gemini-3.6-flash"] }), "Gemini 3.6 Flash served first\nNo fallback needed");
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
  const end = ANALYSIS_SOURCE.indexOf("function formatTurnSummary(capture)", start);
  assert.ok(start >= 0 && end > start, "model helper block should remain available");
  const context = {};
  vm.runInNewContext(
    `${ANALYSIS_SOURCE.slice(start, end)}; helpers = { getModelFallbackLabel, formatModelDisplayName, formatBackendLabel };`,
    context
  );
  return context.helpers;
}
