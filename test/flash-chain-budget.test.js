const assert = require("node:assert/strict");
const test = require("node:test");
const { createSummaryWithFallback, getSummaryProfile, getGeneratedModelSelection } = require("../api/summarize.js").__test;

const openrouterFlags = ["OPENROUTER_ENABLED", "OPENROUTER_APODEX_ENABLED", "OPENROUTER_QWEN_ENABLED", "OPENROUTER_DOTS_ENABLED", "OPENROUTER_GEMMA_ENABLED", "OPENROUTER_LING_ENABLED"];
const otherModels = ["qwen/qwen3.8-27b:free", "dots-studio/dots-3-note-preview:free", "google/gemma-4-26b-a4b-it:free"];
for (const mode of ["absent", "default", "all"]) {
test(`active fallback order stays within 270 seconds with OpenRouter ${mode}`, async () => {
  const originalFlags = openrouterFlags.map(name => process.env[name]);
  openrouterFlags.forEach(name => { process.env[name] = !["OPENROUTER_QWEN_ENABLED", "OPENROUTER_DOTS_ENABLED", "OPENROUTER_GEMMA_ENABLED"].includes(name) || mode === "all" ? "true" : "false"; });
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  const originalSetTimeout = global.setTimeout;
  let now = originalNow();
  let attemptBudget;
  const requests = [];
  const budgets = [];
  Date.now = () => now;
  global.setTimeout = (callback, ms, ...args) => {
    attemptBudget = ms;
    return originalSetTimeout(callback, ms, ...args);
  };
  global.fetch = async (url, options) => {
    const model = JSON.parse(options.body).model || url.split("/models/")[1].split(":")[0];
    requests.push(model);
    budgets.push(attemptBudget);
    if (model !== "ministral-14b-2512") {
      now += attemptBudget;
      const error = new Error("request timed out");
      error.name = "AbortError";
      throw error;
    }
    return { ok: true, json: async () => ({ choices: [{ message: {
      content: "Windows build passed; Linux checks remain pending."
    } }] }) };
  };
  const conversation = "Build context. ".repeat(200);
  try {
    const result = await createSummaryWithFallback({
      conversation, profile: getSummaryProfile(conversation),
      modelSelection: getGeneratedModelSelection(conversation, true),
      geminiApiKey: "test-google", mistralApiKey: "test-mistral",
      openrouterApiKey: mode !== "absent" ? "test-openrouter" : undefined
    });
    assert.deepEqual(requests, [...(mode !== "absent" ? ["inclusionai/ling-3.1-flash", "apodex/apodex-1.1-mini:free"] : []), ...(mode === "all" ? otherModels : []), "gemini-3.6-flash", "gemini-3.5-flash-lite", "ministral-14b-2512"]);
    assert.deepEqual(budgets, mode === "all" ? [90000, ...Array(7).fill(Math.floor(180000 / 7))] : mode === "default" ? [90000, 45000, 45000, 45000, 45000] : [90000, 90000, 90000]);
    assert.ok(budgets.reduce((sum, budget) => sum + budget, 0) <= 270000);
    assert.equal(result.model, "ministral-14b-2512");
  } finally {
    global.fetch = originalFetch;
    Date.now = originalNow;
    global.setTimeout = originalSetTimeout;
    openrouterFlags.forEach((name, i) => {
      if (originalFlags[i] === undefined) delete process.env[name]; else process.env[name] = originalFlags[i];
    });
  }
});
}
