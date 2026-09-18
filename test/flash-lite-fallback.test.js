const assert = require("node:assert/strict");
const test = require("node:test");
const handler = require("../api/summarize.js");
const { createSummaryWithFallback, getSummaryProfile, getGeneratedModelSelection } = handler.__test;

for (const [label, groqKey, flashLiteWorks] of [
  ["after Groq failure", "test-groq", true],
  ["when Groq is absent", undefined, true],
  ["before local carry when Flash-Lite also fails", "test-groq", false]
]) {
  test(`Flash-Lite is the final remote fallback ${label}`, async () => {
    const originalFetch = global.fetch;
    const requests = [];
    const healthModels = [];
    const conversation = "User: Preserve the Windows build decision and pending Linux checks.\n".repeat(2000);
    const health = {
      beginAttempt: async (model) => { healthModels.push(model); return { available: true }; },
      recordFailure: async () => ({}),
      recordSuccess: async () => ({})
    };
    global.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      const model = body.model || url.split("/models/")[1].split(":")[0];
      requests.push(model);
      if (model === "gemini-3.5-flash-lite" && flashLiteWorks) {
        assert.equal(options.headers["x-goog-api-key"], "test-google");
        assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "MINIMAL");
        assert.equal(JSON.parse(body.contents[0].parts[0].text).conversation, conversation);
        return { ok: true, json: async () => ({ candidates: [{
          finishReason: "STOP", content: { parts: [
            { thought: true, text: "private reasoning" },
            { text: "Windows build passed; Linux checks remain pending." }
          ] }
        }] }) };
      }
      return { ok: false, status: 429, headers: { get: () => null },
        json: async () => ({ error: { code: "rate_limit_exceeded" } }) };
    };
    try {
      const result = await createSummaryWithFallback({
        conversation, profile: getSummaryProfile(conversation),
        modelSelection: getGeneratedModelSelection(conversation, true),
        geminiApiKey: "test-google", mistralApiKey: "test-mistral",
        groqApiKey: groqKey, geminiModelHealth: health
      });
      assert.deepEqual(requests, ["gemini-3.6-flash", "ministral-14b-2512", ...(groqKey ? ["groq/compound-mini", "groq/compound-mini"] : []),
        "gemini-3.5-flash-lite"]);
      assert.equal(result.model, flashLiteWorks ? "gemini-3.5-flash-lite" : "local-direct");
      assert.equal(healthModels.includes("gemini-3.5-flash-lite"), false);
      if (flashLiteWorks) {
        assert.match(result.summary, /Windows build passed; Linux checks remain pending/);
        assert.doesNotMatch(result.summary, /private reasoning/);
      } else {
        assert.ok(result.summary.includes(conversation.trim().split("\n").map((line) => `> ${line}`).join("\n")));
      }
    } finally { global.fetch = originalFetch; }
  });
}

test("Orca is paused by default even with its API key configured", async () => {
  const originalFetch = global.fetch;
  const names = ["ORCAROUTER_ENABLED", "ORCAROUTER_API_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY"];
  const saved = names.map((name) => process.env[name]);
  delete process.env.ORCAROUTER_ENABLED;
  delete process.env.GEMINI_API_KEY;
  process.env.ORCAROUTER_API_KEY = "retained-orca-key";
  process.env.MISTRAL_API_KEY = "test-mistral";
  const requests = [];
  global.fetch = async (url) => {
    requests.push(url);
    return { ok: true, json: async () => ({ choices: [{ message: { content: "The build passed." } }] }) };
  };
  let payload;
  const res = { setHeader() {}, status() { return this; }, json(data) { payload = data; } };
  try {
    await handler({ method: "POST", body: { conversation: "Build context. ".repeat(150) }, headers: {
      origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "content-type": "application/json",
      "x-cap-context-client": "cap-context-extension/1", "x-forwarded-for": "192.0.2.200"
    } }, res);
    assert.deepEqual(requests, ["https://api.mistral.ai/v1/chat/completions"]);
    assert.equal(payload.timing.model, "ministral-14b-2512");
  } finally {
    global.fetch = originalFetch;
    names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; });
  }
});


test("Groq remains paused with a retained key after Mistral fails", async () => {
  const originalFetch = global.fetch;
  const names = ["GROQ_ENABLED", "GROQ_API_KEY", "GEMINI_API_KEY", "MISTRAL_API_KEY", "ORCAROUTER_ENABLED"];
  const saved = names.map((name) => process.env[name]);
  delete process.env.GROQ_ENABLED;
  delete process.env.GEMINI_API_KEY;
  delete process.env.ORCAROUTER_ENABLED;
  process.env.GROQ_API_KEY = "retained-groq-key";
  process.env.MISTRAL_API_KEY = "test-mistral";
  const requests = [];
  global.fetch = async (url) => {
    requests.push(url);
    return { ok: false, status: 429, json: async () => ({ error: { code: "rate_limit_exceeded" } }) };
  };
  let payload;
  const res = { setHeader() {}, status() { return this; }, json(data) { payload = data; } };
  try {
    await handler({ method: "POST", body: { conversation: "Build context. ".repeat(150) }, headers: {
      origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "content-type": "application/json",
      "x-cap-context-client": "cap-context-extension/1", "x-forwarded-for": "192.0.2.201"
    } }, res);
    assert.deepEqual(requests, ["https://api.mistral.ai/v1/chat/completions"]);
    assert.equal(payload.timing.model, "local-direct");
  } finally {
    global.fetch = originalFetch;
    names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; });
  }
});
