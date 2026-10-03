const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createSummaryWithFallback, getSummaryProfile } = require("../api/summarize.js").__test;

for (const openrouterEnabled of [false, true]) {
for (const status of [200, 429, 503]) {
  test(`${openrouterEnabled ? "OpenRouter" : "Gemini"} fallback aborts a stalled ${status} response body within its budget`, { timeout: 5000 }, async t => {
    // Exercise this route regardless of a developer's deployed env switches.
    const flags = ["OPENROUTER_ENABLED", "OPENROUTER_APODEX_ENABLED", "OPENROUTER_QWEN_ENABLED",
      "OPENROUTER_DOTS_ENABLED", "OPENROUTER_GEMMA_ENABLED", "OPENROUTER_LING_ENABLED"];
    const previous = flags.map(name => process.env[name]);
    flags.forEach(name => { process.env[name] = openrouterEnabled && ["OPENROUTER_ENABLED", "OPENROUTER_LING_ENABLED", "OPENROUTER_APODEX_ENABLED"].includes(name) ? "true" : "false"; });
    t.after(() => flags.forEach((name, i) => {
      if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i];
    }));
    const originalFetch = global.fetch;
    const originalSetTimeout = global.setTimeout;
    const requests = [];
    const stalledSignals = [];
    let receivedStalledHeaders = false;
    const server = http.createServer((_req, res) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.write("{"); // Headers arrive immediately, but the JSON never completes.
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const conversation = "Build passed; Linux checks remain pending. ".repeat(100);

    // Exercise the default Ling 90s and Apodex 45s body deadlines without waiting.
    // Deadline bookkeeping can subtract a few milliseconds before scheduling.
    global.setTimeout = (callback, ms, ...args) => originalSetTimeout(callback,
      (ms >= 89000 && ms <= 90000) || (ms >= 44000 && ms <= 45000) ? 500 : ms, ...args);
    global.fetch = async (url, options) => {
      requests.push(url);
      if (requests.length <= (openrouterEnabled ? 2 : 1)) {
        stalledSignals.push(options.signal);
        const response = await originalFetch(`http://127.0.0.1:${server.address().port}`, options);
        receivedStalledHeaders = true;
        return response;
      }
      return new Response(JSON.stringify({ candidates: [{
        content: { parts: [{ text: "Build passed; Linux checks remain pending." }] },
        finishReason: "STOP"
      }] }), { headers: { "Content-Type": "application/json" } });
    };
    try {
      const result = await createSummaryWithFallback({
        conversation,
        profile: getSummaryProfile(conversation),
        geminiApiKey: "test-google",
        mistralApiKey: openrouterEnabled ? "test-mistral" : undefined,
        openrouterApiKey: openrouterEnabled ? "test-openrouter" : undefined
      });
      assert.equal(receivedStalledHeaders, true, "timeout must exercise a stalled body after headers arrive");
      assert.ok(stalledSignals.every(signal => signal.aborted));
      assert.equal(requests.length, openrouterEnabled ? 3 : 2);
      assert.match(requests[requests.length - 1], openrouterEnabled ? /gemini-3\.6-flash/ : /gemini-3\.5-flash-lite/);
      if (openrouterEnabled) assert.deepEqual(result.openrouterModelsTried, ["inclusionai/ling-3.1-flash", "apodex/apodex-1.1-mini:free"]);
      assert.equal(result.model, openrouterEnabled ? "gemini-3.6-flash" : "gemini-3.5-flash-lite");
      assert.match(result.summary, /Linux checks remain pending/);
    } finally {
      global.fetch = originalFetch;
      global.setTimeout = originalSetTimeout;
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
}
