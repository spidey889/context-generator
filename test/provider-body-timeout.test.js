const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { createSummaryWithFallback, getSummaryProfile } = require("../api/summarize.js").__test;
const { clockTest } = require("./helpers/clock");

function configureProviderRoute(t, provider) {
  const flags = { OPENROUTER_ENABLED: provider === "OpenRouter", OPENROUTER_LING_ENABLED: true,
    OPENROUTER_QWEN_ENABLED: false, OPENROUTER_DOTS_ENABLED: false, OPENROUTER_GEMMA_ENABLED: false,
    MISTRAL_ENABLED: provider === "Mistral" };
  const previous = Object.keys(flags).map(name => [name, process.env[name]]);
  for (const [name, enabled] of Object.entries(flags)) process.env[name] = String(enabled);
  t.after(() => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  return {
    geminiApiKey: provider === "Mistral" ? undefined : "TEST_ONLY_GOOGLE",
    mistralApiKey: provider === "Mistral" ? "TEST_ONLY_MISTRAL" : undefined,
    openrouterApiKey: provider === "OpenRouter" ? "TEST_ONLY_OPENROUTER" : undefined
  };
}

for (const provider of ["Gemini", "OpenRouter", "Mistral"]) {
  for (const scenario of [
    { phase: "body", elapsedMs: 89999 },
    { phase: "body", elapsedMs: 90000 },
    { phase: "body", elapsedMs: 90001 },
    { phase: "headers", elapsedMs: 90000 }
  ]) test(`${provider} checks elapsed ${scenario.phase} time at ${scenario.elapsedMs} ms before delayed abort timers run`, async t => {
    const keys = configureProviderRoute(t, provider);
    const originalFetch = global.fetch;
    t.after(() => { global.fetch = originalFetch; });
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.parse("2026-10-06T10:00:00Z") });
    const requests = [], bodyReads = [];
    global.fetch = async (url, options) => {
      const index = requests.length;
      requests.push({ url, signal: options.signal });
      const advanceElapsedTime = () => {
        // Updating Date alone leaves the abort task queued, like an overdue
        // timer when response/parser microtasks run first on a busy process.
        if (index === 0) t.mock.timers.setTime(Date.now() + scenario.elapsedMs);
      };
      if (scenario.phase === "headers") advanceElapsedTime();
      return { ok: true, status: 200, json: async () => {
        bodyReads.push(index);
        if (scenario.phase === "body") advanceElapsedTime();
        const text = "Build passed; Linux checks remain pending.";
        return url.includes("generativelanguage.googleapis.com")
          ? { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] }
          : { choices: [{ message: { content: text }, finish_reason: "stop" }] };
      } };
    };
    const conversation = "Build passed; Linux checks remain pending. ".repeat(100);
    const result = await createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation), ...keys });
    const expired = scenario.elapsedMs >= 90000;
    const firstModel = { Gemini: "gemini-3.6-flash", OpenRouter: "inclusionai/ling-3.1-flash", Mistral: "ministral-14b-2512" }[provider];
    const fallbackModel = { Gemini: "gemini-3.5-flash-lite", OpenRouter: "gemini-3.6-flash", Mistral: "local-direct" }[provider];
    assert.equal(result.model, expired ? fallbackModel : firstModel);
    assert.equal(requests[0].signal.aborted, expired);
    assert.equal(requests.length, expired && provider !== "Mistral" ? 2 : 1);
    assert.equal(bodyReads.includes(0), scenario.phase !== "headers", "Expired headers must not start a body read.");
    assert.match(result.summary, /Linux checks remain pending/);
    if (expired && provider === "Mistral") assert.ok(result.summary.includes(conversation.trim()));
  });
}

clockTest("a provider retry retains the model deadline when its body beats a delayed abort timer", async t => {
  const keys = configureProviderRoute(t, "Gemini");
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const startedAt = Date.parse("2026-10-06T10:00:00Z");
  t.mock.timers.setTime(startedAt);
  const requests = [];
  global.fetch = async (url, options) => {
    const index = requests.length;
    requests.push({ url, signal: options.signal, at: Date.now() });
    return { ok: index !== 0, status: index === 0 ? 503 : 200, json: async () => {
      if (index === 0) t.mock.timers.setTime(startedAt + 44550);
      if (index === 1) t.mock.timers.setTime(startedAt + 90000);
      return index === 0 ? { error: { message: "TEST_ONLY_UNAVAILABLE" } }
        : { candidates: [{ content: { parts: [{ text: "Build passed; Linux checks remain pending." }] }, finishReason: "STOP" }] };
    } };
  };
  const conversation = "Build passed; Linux checks remain pending. ".repeat(100);
  const result = await createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation), ...keys });
  assert.equal(result.model, "gemini-3.5-flash-lite");
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, requests[1].url);
  assert.equal(requests[1].at, startedAt + 45000, "The normal 450 ms retry delay stays intact.");
  assert.equal(requests[1].signal.aborted, true);
  assert.equal(requests[2].signal.aborted, false);
});

test("elapsed provider headers abort the native unread socket before fallback", { timeout: 5000 }, async t => {
  const keys = configureProviderRoute(t, "Gemini");
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-06T10:00:00Z") });
  let noteClosed, rejectUnexpectedRead, closeTimer, pending, firstSignal;
  let requests = 0, bodyReads = 0;
  const closed = new Promise(resolve => { noteClosed = resolve; });
  const unexpectedRead = new Promise((_, reject) => { rejectUnexpectedRead = reject; });
  const server = http.createServer((_req, res) => {
    res.once("close", () => noteClosed(!res.writableEnded));
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write("{");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  global.fetch = async (_url, options) => {
    if (++requests === 1) {
      firstSignal = options.signal;
      const response = await originalFetch(`http://127.0.0.1:${server.address().port}`, options);
      t.mock.timers.setTime(Date.now() + 90000);
      const readBody = response.json.bind(response);
      response.json = () => {
        bodyReads++;
        rejectUnexpectedRead(new Error("Expired headers started reading the native body"));
        return readBody();
      };
      return response;
    }
    return new Response(JSON.stringify({ candidates: [{
      content: { parts: [{ text: "Build passed; Linux checks remain pending." }] }, finishReason: "STOP"
    }] }), { headers: { "Content-Type": "application/json" } });
  };
  try {
    const conversation = "Build passed; Linux checks remain pending. ".repeat(100);
    pending = createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation), ...keys });
    const result = await Promise.race([pending, unexpectedRead]);
    assert.equal(result.model, "gemini-3.5-flash-lite");
    assert.equal(firstSignal.aborted, true);
    assert.equal(bodyReads, 0);
    assert.equal(requests, 2);
    assert.equal(await Promise.race([closed, new Promise(resolve => { closeTimer = setTimeout(() => resolve(false), 1000); })]),
      true, "The expired owned response must close its unfinished native socket.");
  } finally {
    clearTimeout(closeTimer);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await pending?.catch(() => {});
  }
});

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
    let rejectDeadline, pending;
    const deadlineFailure = new Promise((_, reject) => { rejectDeadline = reject; });
    let receivedStalledHeaders = false;
    const server = http.createServer((_req, res) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.write("{"); // Headers arrive immediately, but the JSON never completes.
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const conversation = "Build passed; Linux checks remain pending. ".repeat(100);

    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
    const scheduleTimeout = global.setTimeout;
    global.setTimeout = (callback, ms, ...args) => {
      if (ms >= 59000 && ms <= 90000) budgets.push(ms);
      return scheduleTimeout(callback, ms, ...args);
    };
    global.fetch = async (url, options) => {
      requests.push(url);
      if (requests.length <= (openrouterEnabled ? 2 : 1)) {
        stalledSignals.push(options.signal);
        const response = await originalFetch(`http://127.0.0.1:${server.address().port}`, options);
        receivedStalledHeaders = true;
        const readBody = response.json.bind(response);
        response.json = () => {
          const pendingBody = readBody();
          pendingBody.catch(() => {}); // Drain rejections even if the clock driver fails.
          const budget = openrouterEnabled && requests.length === 2 ? 60000 : 90000;
          // Advance only after native fetch has received headers and started reading the real socket.
          t.mock.timers.tick(budget - 1);
          const abortedEarly = options.signal.aborted;
          t.mock.timers.tick(1);
          // Assert these observations outside the provider, which catches body-reader errors.
          bodyDeadlineChecks.push([abortedEarly, options.signal.aborted]);
          if (!options.signal.aborted) rejectDeadline(new Error("stalled body outlived its provider deadline"));
          return pendingBody;
        };
        return response;
      }
      return new Response(JSON.stringify({ candidates: [{
        content: { parts: [{ text: "Build passed; Linux checks remain pending." }] },
        finishReason: "STOP"
      }] }), { headers: { "Content-Type": "application/json" } });
    };
    try {
      pending = createSummaryWithFallback({
        conversation,
        profile: getSummaryProfile(conversation),
        geminiApiKey: "test-google",
        mistralApiKey: openrouterEnabled ? "test-mistral" : undefined,
        openrouterApiKey: openrouterEnabled ? "test-openrouter" : undefined
      });
      const result = await Promise.race([pending, deadlineFailure]);
      assert.equal(receivedStalledHeaders, true, "timeout must exercise a stalled body after headers arrive");
      assert.ok(stalledSignals.every(signal => signal.aborted));
      assert.equal(requests.length, openrouterEnabled ? 3 : 2);
      assert.match(requests[requests.length - 1], /gemini-3\.5-flash-lite/);
      assert.deepEqual(budgets, openrouterEnabled ? [90000, 60000, 60000] : [90000, 90000]);
      assert.deepEqual(bodyDeadlineChecks, openrouterEnabled ? [[false, true], [false, true]] : [[false, true]], "real bodies must abort exactly at their deadlines");
      if (openrouterEnabled) {
        assert.deepEqual(result.openrouterModelsTried, ["inclusionai/ling-3.1-flash"]);
      }
      assert.equal(result.model, "gemini-3.5-flash-lite");
      assert.match(result.summary, /Linux checks remain pending/);
    } finally {
      global.setTimeout = originalSetTimeout;
      t.mock.timers.reset();
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      // Drain a failed request while fetch is still confined to this fixture.
      await pending?.catch(() => {});
      global.fetch = originalFetch;
    }
  });
}
}
