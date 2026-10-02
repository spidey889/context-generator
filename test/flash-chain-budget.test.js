const assert = require("node:assert/strict");
const test = require("node:test");
const { createSummaryWithFallback, getSummaryProfile, getGeneratedModelSelection } = require("../api/summarize.js").__test;

test("active fallback order keeps three 90-second slots within the 270-second allowance", async () => {
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
      geminiApiKey: "test-google", mistralApiKey: "test-mistral"
    });
    assert.deepEqual(requests, ["gemini-3.6-flash", "gemini-3.5-flash-lite", "ministral-14b-2512"]);
    assert.deepEqual(budgets, [90000, 90000, 90000]);
    assert.equal(budgets.reduce((sum, budget) => sum + budget, 0), 270000);
    assert.equal(result.model, "ministral-14b-2512");
  } finally {
    global.fetch = originalFetch;
    Date.now = originalNow;
    global.setTimeout = originalSetTimeout;
  }
});
