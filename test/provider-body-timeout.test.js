const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createSummaryWithFallback, getSummaryProfile } = require("../api/summarize.js").__test;

for (const openrouterEnabled of [false, true]) {
// Both providers use the same body reader before status-specific retry logic.
// Gemini covers success/error bodies; OpenRouter checks its 90s/60s route budgets.
for (const status of openrouterEnabled ? [200] : [200, 429, 503]) {
  test(`${openrouterEnabled ? "OpenRouter" : "Gemini"} fallback aborts a stalled ${status} response body within its budget`, { timeout: 5000 }, async t => {
    // Exercise this route regardless of a developer's deployed env switches.
    const flags = ["OPENROUTER_ENABLED", "OPENROUTER_QWEN_ENABLED",
      "OPENROUTER_DOTS_ENABLED", "OPENROUTER_GEMMA_ENABLED", "OPENROUTER_LING_ENABLED",
      ...(openrouterEnabled ? ["MISTRAL_ENABLED"] : [])];
    const previous = flags.map(name => process.env[name]);
    flags.forEach(name => { process.env[name] = openrouterEnabled && ["OPENROUTER_ENABLED", "OPENROUTER_LING_ENABLED", "MISTRAL_ENABLED"].includes(name) ? "true" : "false"; });
    t.after(() => flags.forEach((name, i) => {
      if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i];
    }));
    const originalFetch = global.fetch;
    const originalSetTimeout = global.setTimeout;
    const requests = [];
    const stalledSignals = [];
    const budgets = [];
    const bodyDeadlineChecks = [];
    let receivedStalledHeaders = false;
    const server = http.createServer((_req, res) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.write("{"); // Headers arrive immediately, but the JSON never completes.
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const conversation = "Build passed; Linux checks remain pending. ".repeat(100);

    if (openrouterEnabled) {
      // Only the newer OpenRouter case uses a clock; keep the original Gemini cases unchanged.
      t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
      const scheduleTimeout = global.setTimeout;
      global.setTimeout = (callback, ms, ...args) => {
        if (ms >= 59000 && ms <= 90000) budgets.push(ms);
        return scheduleTimeout(callback, ms, ...args);
      };
    } else {
      // Deadline bookkeeping can subtract a few milliseconds before scheduling.
      global.setTimeout = (callback, ms, ...args) => originalSetTimeout(callback,
        (ms >= 89000 && ms <= 90000) || (ms >= 59000 && ms <= 60000) ? 500 : ms, ...args);
    }
    global.fetch = async (url, options) => {
      requests.push(url);
      if (requests.length <= (openrouterEnabled ? 2 : 1)) {
        stalledSignals.push(options.signal);
        const response = await originalFetch(`http://127.0.0.1:${server.address().port}`, options);
        receivedStalledHeaders = true;
        if (openrouterEnabled) {
          const readBody = response.json.bind(response);
          response.json = () => {
            const pendingBody = readBody();
            pendingBody.catch(() => {}); // Drain rejections even if the clock driver fails.
            const budget = requests.length === 1 ? 90000 : 60000;
            // Advance only after native fetch has received headers and started reading the real socket.
            t.mock.timers.tick(budget - 1);
            const abortedEarly = options.signal.aborted;
            t.mock.timers.tick(1);
            // Assert these observations outside the provider, which catches body-reader errors.
            bodyDeadlineChecks.push([abortedEarly, options.signal.aborted]);
            return pendingBody;
          };
        }
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
      assert.match(requests[requests.length - 1], /gemini-3\.5-flash-lite/);
      if (openrouterEnabled) {
        assert.deepEqual(budgets, [90000, 60000, 60000]);
        assert.deepEqual(bodyDeadlineChecks, [[false, true], [false, true]], "both real bodies must abort exactly at their deadlines");
        assert.deepEqual(result.openrouterModelsTried, ["inclusionai/ling-3.1-flash"]);
      }
      assert.equal(result.model, "gemini-3.5-flash-lite");
      assert.match(result.summary, /Linux checks remain pending/);
    } finally {
      global.fetch = originalFetch;
      global.setTimeout = originalSetTimeout;
      if (openrouterEnabled) t.mock.timers.reset();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}
}
