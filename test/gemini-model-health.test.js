const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createGeminiModelHealth,
  getPacificDateKey,
  GEMINI_SUCCESS_LIMIT,
  GEMINI_FAILURE_LIMIT
} = require("../api/gemini-model-health");
const summarizeHandler = require("../api/summarize");
const {
  createSummaryWithFallback,
  readProviderErrorMetadata,
  getGeneratedModelSelection,
  getSummaryProfile
} = summarizeHandler.__test;

const HEALTH_ENV = {
  UPSTASH_REDIS_REST_URL: "https://health-test.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "test-token"
};

test("Pacific health day changes at the correct summer and winter midnights", () => {
  assert.equal(getPacificDateKey(new Date("2026-09-12T06:59:59Z")), "2026-09-11");
  assert.equal(getPacificDateKey(new Date("2026-09-12T07:00:00Z")), "2026-09-12");
  assert.equal(getPacificDateKey(new Date("2026-12-12T07:59:59Z")), "2026-12-11");
  assert.equal(getPacificDateKey(new Date("2026-12-12T08:00:00Z")), "2026-12-12");
});

test("a Gemini model becomes exhausted after 20 successes and resets on the next Pacific day", async () => {
  let currentTime = new Date("2026-09-12T12:00:00Z");
  const redis = createFakeUpstash();
  const health = createGeminiModelHealth({
    env: HEALTH_ENV,
    fetchImpl: redis.fetch,
    now: () => currentTime
  });

  for (let count = 1; count <= GEMINI_SUCCESS_LIMIT; count += 1) {
    assert.equal((await health.beginAttempt("gemini-3.8-flash")).available, true);
    const state = await health.recordSuccess("gemini-3.8-flash");
    assert.equal(state.successes, count);
    assert.equal(state.attempts, count);
    assert.equal(state.status, count === GEMINI_SUCCESS_LIMIT ? "exhausted" : "available");
  }

  assert.equal((await health.getStatus("gemini-3.8-flash")).available, false);
  currentTime = new Date("2026-09-13T12:00:00Z");
  assert.deepEqual(
    pickHealth(await health.getStatus("gemini-3.8-flash")),
    { status: "available", successes: 0, failures: 0, consecutiveFailures: 0, attempts: 0 }
  );
});

test("three failures without success set bad mood for the rest of the Pacific day", async () => {
  const redis = createFakeUpstash();
  const health = createGeminiModelHealth({
    env: HEALTH_ENV,
    fetchImpl: redis.fetch,
    now: () => new Date("2026-09-12T12:00:00Z")
  });

  await health.beginAttempt("gemini-3.8-flash");
  await health.recordFailure("gemini-3.8-flash");
  await health.beginAttempt("gemini-3.8-flash");
  await health.recordFailure("gemini-3.8-flash");
  await health.beginAttempt("gemini-3.8-flash");
  assert.equal((await health.recordSuccess("gemini-3.8-flash")).consecutiveFailures, 0);

  for (let count = 1; count <= GEMINI_FAILURE_LIMIT; count += 1) {
    await health.beginAttempt("gemini-3.8-flash");
    const state = await health.recordFailure("gemini-3.8-flash");
    assert.equal(state.status, count === GEMINI_FAILURE_LIMIT ? "bad_mood" : "available");
  }

  const lateSuccess = await health.recordSuccess("gemini-3.8-flash");
  assert.equal(lateSuccess.status, "bad_mood");
  assert.equal(lateSuccess.available, false);
  assert.equal(lateSuccess.consecutiveFailures, GEMINI_FAILURE_LIMIT);
});

test("a daily quota response marks a Gemini model exhausted immediately", async () => {
  const redis = createFakeUpstash();
  const health = createGeminiModelHealth({
    env: HEALTH_ENV,
    fetchImpl: redis.fetch,
    now: () => new Date("2026-09-12T12:00:00Z")
  });

  await health.beginAttempt("gemini-3.8-flash");
  const state = await health.recordFailure("gemini-3.8-flash", { dailyQuotaExhausted: true });
  assert.equal(state.status, "exhausted");
  assert.equal(state.failures, 1);
});

test("Gemini daily quota metadata is recognized without retaining the provider body", async () => {
  const modern = await readProviderErrorMetadata({
    json: async () => ({ error: { code: "quota_exceeded", message: "daily limit reached" } })
  });
  const generateContent = await readProviderErrorMetadata({
    json: async () => ({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }]
      }
    })
  });

  assert.equal(modern.dailyQuota, true);
  assert.equal(generateContent.dailyQuota, true);
});

test("health storage failures fail open so summaries can keep using Gemini", async () => {
  const originalWarn = console.warn;
  console.warn = () => {};
  const health = createGeminiModelHealth({
    env: HEALTH_ENV,
    fetchImpl: async () => {
      throw new Error("store offline");
    }
  });
  const invalidHealth = createGeminiModelHealth({
    env: HEALTH_ENV,
    fetchImpl: async () => upstashResponse(null)
  });

  try {
    const state = await health.getStatus("gemini-3.8-flash");
    assert.equal(state.available, true);
    assert.equal(state.tracking, "unavailable");
    const invalidState = await invalidHealth.beginAttempt("gemini-3.8-flash");
    assert.equal(invalidState.available, true);
    assert.equal(invalidState.tracking, "unavailable");
  } finally {
    console.warn = originalWarn;
  }
});

test("summary routing skips bad-mood Gemini models without calling them", async () => {
  const originalFetch = global.fetch;
  const providerUrls = [];
  const health = createRoutingHealth({ "gemini-3.8-flash": "bad_mood" });
  global.fetch = async (url) => {
    providerUrls.push(url);
    return successfulGeminiResponse("healthy-fallback");
  };

  try {
    const conversation = "Gemini health routing context ".repeat(180);
    const result = await createSummaryWithFallback({
      conversation,
      profile: getSummaryProfile(conversation),
      modelSelection: getGeneratedModelSelection(conversation, true),
      geminiApiKey: "test-key",
      mistralApiKey: undefined,
      groqApiKey: undefined,
      geminiModelHealth: health
    });

    assert.equal(providerUrls.length, 1);
    assert.match(providerUrls[0], /gemini-3\.7-flash:generateContent$/);
    assert.equal(result.model, "gemini-3.7-flash");
    assert.deepEqual(result.geminiModelsSkipped, [
      { model: "gemini-3.8-flash", status: "bad_mood" }
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("a Gemini 429 moves to the next model without hammering the failed model", async () => {
  const originalFetch = global.fetch;
  const providerUrls = [];
  const recordedFailures = [];
  const health = createRoutingHealth({}, recordedFailures);
  global.fetch = async (url) => {
    providerUrls.push(url);
    if (url.includes("gemini-3.8-flash")) {
      return {
        ok: false,
        status: 429,
        json: async () => ({ error: { code: "rate_limit_exceeded", message: "slow down" } })
      };
    }
    return successfulGeminiResponse("rate-limit-fallback");
  };

  try {
    const conversation = "Gemini rate limit context ".repeat(180);
    const result = await createSummaryWithFallback({
      conversation,
      profile: getSummaryProfile(conversation),
      modelSelection: getGeneratedModelSelection(conversation, true),
      geminiApiKey: "test-key",
      mistralApiKey: undefined,
      groqApiKey: undefined,
      geminiModelHealth: health
    });

    assert.equal(providerUrls.filter((url) => url.includes("gemini-3.8-flash")).length, 1);
    assert.match(providerUrls[1], /gemini-3\.7-flash:generateContent$/);
    assert.deepEqual(recordedFailures, [
      { model: "gemini-3.8-flash", dailyQuotaExhausted: false }
    ]);
    assert.equal(result.model, "gemini-3.7-flash");
  } finally {
    global.fetch = originalFetch;
  }
});

function createRoutingHealth(statuses, recordedFailures = []) {
  return {
    async beginAttempt(model) {
      const status = statuses[model] || "available";
      return {
        model,
        status,
        available: status === "available",
        successes: 0,
        failures: 0,
        consecutiveFailures: 0,
        attempts: 1,
        pacificDate: "2026-09-12",
        tracking: "shared"
      };
    },
    async recordSuccess(model) {
      return {
        model,
        status: "available",
        available: true,
        successes: 1,
        failures: 0,
        consecutiveFailures: 0,
        attempts: 1,
        pacificDate: "2026-09-12",
        tracking: "shared"
      };
    },
    async recordFailure(model, options = {}) {
      recordedFailures.push({ model, dailyQuotaExhausted: options.dailyQuotaExhausted === true });
      return {
        model,
        status: "available",
        available: true,
        successes: 0,
        failures: 1,
        consecutiveFailures: 1,
        attempts: 1,
        pacificDate: "2026-09-12",
        tracking: "shared"
      };
    }
  };
}

function createFakeUpstash() {
  const values = new Map();
  return {
    async fetch(_url, options) {
      assert.equal(options.headers.Authorization, "Bearer test-token");
      const command = JSON.parse(options.body);
      if (command[0] === "HMGET") {
        const state = values.get(command[1]) || emptyHealth();
        const fields = command.slice(2);
        return upstashResponse(fields.map((field) => state[field] ?? null));
      }

      assert.equal(command[0], "EVAL");
      const script = command[1];
      const key = command[3];
      const state = { ...emptyHealth(), ...(values.get(key) || {}) };
      if (script.includes("health-attempt-v1")) {
        const allowed = state.status === "available";
        if (allowed) state.attempts += 1;
        state.updatedAt = command[4];
        values.set(key, state);
        return upstashResponse([
          state.status,
          String(state.successes),
          String(state.failures),
          String(state.consecutiveFailures),
          String(state.attempts),
          state.updatedAt,
          allowed ? "1" : "0"
        ]);
      } else if (script.includes("health-success-v1")) {
        state.successes += 1;
        if (state.status !== "bad_mood") state.consecutiveFailures = 0;
        if (state.status !== "bad_mood") {
          state.status = state.status === "exhausted" || state.successes >= Number(command[4])
            ? "exhausted"
            : "available";
        }
        state.updatedAt = command[5];
      } else if (script.includes("health-failure-v1")) {
        state.failures += 1;
        state.consecutiveFailures += 1;
        if (state.status === "exhausted" || Number(command[5]) === 1) {
          state.status = "exhausted";
        } else if (state.status === "bad_mood" || state.consecutiveFailures >= Number(command[4])) {
          state.status = "bad_mood";
        } else {
          state.status = "available";
        }
        state.updatedAt = command[6];
      } else {
        throw new Error("Unexpected health script");
      }
      values.set(key, state);
      return upstashResponse([
        state.status,
        String(state.successes),
        String(state.failures),
        String(state.consecutiveFailures),
        String(state.attempts),
        state.updatedAt
      ]);
    }
  };
}

function emptyHealth() {
  return {
    status: "available",
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    attempts: 0,
    updatedAt: null
  };
}

function upstashResponse(result) {
  return {
    ok: true,
    json: async () => ({ result })
  };
}

function pickHealth(state) {
  return {
    status: state.status,
    successes: state.successes,
    failures: state.failures,
    consecutiveFailures: state.consecutiveFailures,
    attempts: state.attempts
  };
}

function successfulGeminiResponse(word) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: makeContextCarrySummary(word, 260) }] }
      }]
    })
  };
}

function makeContextCarrySummary(word, wordCount) {
  const words = Array.from({ length: wordCount }, (_, index) => `${word}${index}`).join(" ");
  return [
    "CONTEXT CARRY - READY TO PASTE",
    "",
    "WHO I AM",
    words,
    "",
    "WHAT WE WERE DOING",
    "Detailed work remains preserved.",
    "",
    "WHERE WE LEFT OFF",
    "Ready for exact continuation.",
    "",
    "DECISIONS MADE",
    "- Continue.",
    "",
    "OPEN QUESTIONS",
    "None",
    "",
    "KEY CONTEXT",
    "- Useful concrete context remains available.",
    "",
    "NEXT STEP",
    'Reply only: "Context loaded. Let\'s pick up right where you left off." Then wait for the user.'
  ].join("\n");
}
