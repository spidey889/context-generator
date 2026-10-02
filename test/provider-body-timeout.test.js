const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createSummaryWithFallback, getSummaryProfile } = require("../api/summarize.js").__test;

for (const openrouterEnabled of [false, true]) {
for (const status of [200, 429, 503]) {
  test(`${openrouterEnabled ? "OpenRouter" : "Gemini"} fallback aborts a stalled ${status} response body within its budget`, { timeout: 5000 }, async () => {
    const originalFetch = global.fetch;
    const originalSetTimeout = global.setTimeout;
    const requests = [];
    let stalledSignal;
    let receivedStalledHeaders = false;
    const server = http.createServer((_req, res) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.write("{"); // Headers arrive immediately, but the JSON never completes.
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const conversation = "Build passed; Linux checks remain pending. ".repeat(100);

    // Exercise the real 90-second timer without making the test wait 90 seconds.
    // Deadline bookkeeping can subtract a few milliseconds before scheduling.
    global.setTimeout = (callback, ms, ...args) => originalSetTimeout(callback, ms >= 89000 && ms <= 90000 ? 500 : ms, ...args);
    global.fetch = async (url, options) => {
      requests.push(url);
      if (requests.length === 1) {
        stalledSignal = options.signal;
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
        openrouterApiKey: openrouterEnabled ? "test-openrouter" : undefined
      });
      assert.equal(receivedStalledHeaders, true, "timeout must exercise a stalled body after headers arrive");
      assert.equal(stalledSignal.aborted, true);
      assert.equal(requests.length, 2);
      assert.match(requests[1], openrouterEnabled ? /gemini-3\.6-flash/ : /gemini-3\.5-flash-lite/);
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
