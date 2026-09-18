const assert = require("node:assert/strict");
const test = require("node:test");
const { createSummaryWithFallback, getSummaryProfile, getGeneratedModelSelection } = require("../api/summarize.js").__test;

test("three active providers receive 90 seconds each and paused Flash routes are skipped", async () => {
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
    if (model !== "gemini-3.5-flash-lite") {
      now += attemptBudget;
      const error = new Error("request timed out");
      error.name = "AbortError";
      throw error;
    }
    return { ok: true, json: async () => ({ candidates: [{ content: {
      parts: [{ text: "Windows build passed; Linux checks remain pending." }]
    }, finishReason: "STOP" }] }) };
  };
  const conversation = "Build context. ".repeat(200);
  const health = {
    beginAttempt: async () => ({ available: true }),
    recordFailure: async () => ({}), recordSuccess: async () => ({})
  };
  try {
    const result = await createSummaryWithFallback({
      conversation, profile: getSummaryProfile(conversation),
      modelSelection: getGeneratedModelSelection(conversation, true),
      geminiApiKey: "test-google", mistralApiKey: "test-mistral", geminiModelHealth: health
    });
    assert.deepEqual(requests, ["gemini-3.6-flash", "ministral-14b-2512", "gemini-3.5-flash-lite"]);
    assert.deepEqual(budgets, [90000, 90000, 90000]);
    assert.equal(result.model, "gemini-3.5-flash-lite");
  } finally {
    global.fetch = originalFetch;
    Date.now = originalNow;
    global.setTimeout = originalSetTimeout;
  }
});
