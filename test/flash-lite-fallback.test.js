const assert = require("node:assert/strict");
const test = require("node:test");
const handler = require("../api/summarize.js");
const originalOpenRouterEnabled = process.env.OPENROUTER_ENABLED;
test.before(() => { process.env.OPENROUTER_ENABLED = "false"; });
test.after(() => {
  if (originalOpenRouterEnabled === undefined) delete process.env.OPENROUTER_ENABLED;
  else process.env.OPENROUTER_ENABLED = originalOpenRouterEnabled;
});
const { createSummaryWithFallback, getSummaryProfile, getGeneratedModelSelection } = handler.__test;

for (const [label, flashLiteWorks] of [
  ["when it succeeds", true],
  ["then local carry when all remote routes fail", false]
]) {
  test(`Flash-Lite is tried before Mistral ${label}`, async () => {
    const originalFetch = global.fetch;
    const requests = [];
    const conversation = "User: Preserve the Windows build decision and pending Linux checks.\n".repeat(2000);
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
        geminiApiKey: "test-google", mistralApiKey: "test-mistral"
      });
      assert.deepEqual(requests, ["gemini-3.6-flash", "gemini-3.5-flash-lite",
        ...(!flashLiteWorks ? ["ministral-14b-2512"] : [])]);
      assert.deepEqual(result.modelsTried, [...new Set(requests)]);
      assert.deepEqual(result.mistralModelsTried, flashLiteWorks ? [] : ["ministral-14b-2512"]);
      assert.equal(result.model, flashLiteWorks ? "gemini-3.5-flash-lite" : "local-direct");
      if (flashLiteWorks) {
        assert.match(result.summary, /Windows build passed; Linux checks remain pending/);
        assert.doesNotMatch(result.summary, /private reasoning/);
      } else {
        assert.ok(result.summary.includes(conversation.trim().split("\n").map((line) => `> ${line}`).join("\n")));
      }
    } finally { global.fetch = originalFetch; }
  });
}

test("paused Mistral is bypassed and Flash-Lite serves after primary failure", async () => {
  const originalFetch = global.fetch;
  const names = ["MISTRAL_ENABLED", "MISTRAL_API_KEY", "GEMINI_API_KEY"];
  const saved = names.map((name) => process.env[name]);
  process.env.MISTRAL_ENABLED = "false";
  process.env.MISTRAL_API_KEY = "retained-mistral-key";
  process.env.GEMINI_API_KEY = "test-google";
  const requests = [];
  global.fetch = async (url) => {
    const model = url.split("/models/")[1].split(":")[0];
    requests.push(model);
    if (model === "gemini-3.6-flash") return { ok: false, status: 429, json: async () => ({ error: { code: "rate_limit_exceeded" } }) };
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "Build passed." }] }, finishReason: "STOP" }] }) };
  };
  let payload;
  const res = { setHeader() {}, status() { return this; }, json(data) { payload = data; } };
  try {
    await handler({ method: "POST", body: { conversation: "Build context. ".repeat(150) }, headers: {
      origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "content-type": "application/json",
      "x-cap-context-client": "cap-context-extension/1", "x-forwarded-for": "192.0.2.202"
    } }, res);
    assert.deepEqual(requests, ["gemini-3.6-flash", "gemini-3.5-flash-lite"]);
    assert.equal(payload.timing.model, "gemini-3.5-flash-lite");
  } finally {
    global.fetch = originalFetch;
    names.forEach((name, index) => { if (saved[index] === undefined) delete process.env[name]; else process.env[name] = saved[index]; });
  }
});
