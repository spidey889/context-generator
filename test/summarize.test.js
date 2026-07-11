const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const summarize = require("../api/summarize.js");

const {
  normalizeContextCarrySummary,
  stripContextCarryFooter,
  countWords,
  getSummaryProfile,
  getMistralModelSelection,
  getContextCarryTemplate
} = summarize.__test;
const SUMMARIZE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "api", "summarize.js"), "utf8");

test("normalizes summary into the required Context Carry shape", () => {
  const raw = [
    "```markdown",
    "# Context Carry - Ready to Paste",
    "WHO I AM",
    "Building a browser extension.",
    "",
    "WHAT WE WERE DOING",
    "Adding regression tests.",
    "",
    "NEXT STEP",
    "Keep coding.",
    "---",
    "PASTE THIS AT THE TOP OF YOUR NEW CHAT",
    "```"
  ].join("\n");

  const normalized = normalizeContextCarrySummary(raw);

  assert.match(normalized, /CONTEXT CARRY/);
  assert.match(normalized, /WHO I AM\nBuilding a browser extension\./);
  assert.match(normalized, /WHAT WE WERE DOING\nAdding regression tests\./);
  assert.doesNotMatch(normalized, /PASTE THIS AT THE TOP/i);
  assert.match(
    normalized,
    /Reply only: "Context loaded\. Let's pick up right where you left off\." Then wait for the user\./
  );
});

test("backend prompt profiles scale summary size to the captured chat", () => {
  assert.equal(getSummaryProfile("x".repeat(500)).id, "tiny");
  assert.equal(getSummaryProfile("x".repeat(4000)).id, "small");
  assert.equal(getSummaryProfile("x".repeat(20000)).id, "medium");
  assert.equal(getSummaryProfile("x".repeat(90000)).id, "large");
  assert.equal(getSummaryProfile("x".repeat(500)).maxTokens, 0);
  assert.equal(getSummaryProfile("x".repeat(90000)).maxTokens, 4200);
  assert.match(getContextCarryTemplate(getSummaryProfile("x".repeat(500))), /WHAT WE WERE DOING\n\[2-3 lines/);
  assert.match(getContextCarryTemplate(getSummaryProfile("x".repeat(90000))), /KEY CONTEXT\n\[350-500 words/);
  assert.match(SUMMARIZE_SOURCE, /Do not duplicate or pad short chats/);
  assert.match(SUMMARIZE_SOURCE, /Use the .* profile/);
  assert.match(SUMMARIZE_SOURCE, /serious handoff to another capable AI/);
  assert.match(SUMMARIZE_SOURCE, /OPEN QUESTIONS should include unresolved risks/);
  assert.match(SUMMARIZE_SOURCE, /Do not invent, correct, or infer project facts/);
  assert.match(SUMMARIZE_SOURCE, /Create a dense continuation handoff/);
});

test("mistral model routing always starts with medium 3.5 without changing summary profiles", () => {
  const restoreMistralModel = setTemporaryEnv("MISTRAL_MODEL", "custom-mistral-test");

  try {
    const thresholdChat = "x".repeat(20000);
    const overThresholdChat = "x".repeat(20001);
    const overThresholdProfile = getSummaryProfile(overThresholdChat);

    assert.equal(getMistralModelSelection(thresholdChat).model, "mistral-medium-2604");
    assert.equal(getMistralModelSelection(overThresholdChat).model, "mistral-medium-2604");
    assert.match(getMistralModelSelection(overThresholdChat).reason, /fixed Mistral priority chain/);
    assert.equal(overThresholdProfile.id, "medium");
    assert.equal(overThresholdProfile.maxTokens, 1900);
    assert.equal(overThresholdProfile.minWords, 0);
  } finally {
    restoreMistralModel();
  }
});

test("backend forwards a 160k conversation to Mistral and reports the same input size", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.MISTRAL_API_KEY;
  const restoreMistralModel = setTemporaryEnv("MISTRAL_MODEL", undefined);
  const conversation = "x".repeat(160000);
  let capturedRequest = null;

  process.env.MISTRAL_API_KEY = "test-key";
  global.fetch = async (url, options) => {
    capturedRequest = {
      url,
      body: JSON.parse(options.body)
    };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        usage: {
          prompt_tokens: 1200,
          completion_tokens: 320,
          total_tokens: 1520,
          prompt_tokens_details: { cached_tokens: 64 }
        },
        choices: [{
          message: {
            content: makeContextCarrySummary("payload", 1200)
          }
        }]
      })
    };
  };

  const res = createMockResponse();

  try {
    await summarize({ method: "POST", body: { conversation } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(capturedRequest.url, "https://api.mistral.ai/v1/chat/completions");
    assert.equal(capturedRequest.body.model, "mistral-medium-2604");
    assert.equal(capturedRequest.body.max_tokens, 4200);
    assert.match(capturedRequest.body.prompt_cache_key, /^capcontext-summary-v1-large-mistral-medium-2604$/);
    assert.equal(capturedRequest.body.prediction, undefined);
    assert.equal(capturedRequest.body.messages[1].content.slice(-160000), conversation);
    assert.equal(res.payload.timing.profile, "large");
    assert.equal(res.payload.timing.servedBy, "mistral");
    assert.equal(res.payload.timing.provider, "mistral");
    assert.equal(res.payload.timing.model, "mistral-medium-2604");
    assert.equal(res.payload.timing.primaryModel, "mistral-medium-2604");
    assert.equal(res.payload.timing.modelThresholdChars, null);
    assert.equal(res.payload.timing.modelOverride, false);
    assert.match(res.payload.timing.modelReason, /served as the first model/);
    assert.equal(res.payload.timing.inputChars, 160000);
    assert.equal(res.payload.timing.maxTokens, 4200);
    assert.equal(res.payload.timing.targetWords, 1200);
    assert.equal(res.payload.timing.qualityFloorMet, true);
    assert.deepEqual(res.payload.timing.usage, {
      promptTokens: 1200,
      completionTokens: 320,
      totalTokens: 1520,
      cachedTokens: 64
    });
  } finally {
    restoreMistralModel();
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.MISTRAL_API_KEY;
    } else {
      process.env.MISTRAL_API_KEY = originalApiKey;
    }
  }
});

test("backend keeps tiny chats local and avoids Mistral", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.MISTRAL_API_KEY;
  const conversation = "User: Firefox manifest setting?\nAssistant: Use the exact setting you can defend.";
  const requests = [];

  delete process.env.MISTRAL_API_KEY;
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: makeContextCarrySummary("short", 90)
          }
        }]
      })
    };
  };

  const res = createMockResponse();

  try {
    await summarize({ method: "POST", body: { conversation } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 0);
    assert.equal(res.payload.timing.profile, "tiny");
    assert.equal(res.payload.timing.servedBy, "local-direct");
    assert.equal(res.payload.timing.model, "local-direct");
    assert.equal(res.payload.timing.modelThresholdChars, null);
    assert.doesNotMatch(res.payload.timing.modelReason, /20000/);
    assert.equal(res.payload.timing.fallback.attempted, false);
    assert.equal(res.payload.timing.maxTokens, 0);
    assert.equal(res.payload.timing.targetWords, 120);
    assert.equal(res.payload.timing.mistralMs, 0);
    assert.equal(res.payload.timing.mistralPasses, 0);
    assert.equal(res.payload.timing.expansion.attempted, false);
    assert.deepEqual(res.payload.timing.usage, {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      cachedTokens: 0
    });
    assert.match(res.payload.summary, /> User: Firefox manifest setting\?/);
    assert.match(res.payload.summary, /> Assistant: Use the exact setting you can defend\./);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.MISTRAL_API_KEY;
    } else {
      process.env.MISTRAL_API_KEY = originalApiKey;
    }
  }
});

test("backend sends small generated chats to medium 3.5 first", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.MISTRAL_API_KEY;
  const restoreMistralModel = setTemporaryEnv("MISTRAL_MODEL", undefined);
  const conversation = "small context ".repeat(200);
  const requests = [];

  process.env.MISTRAL_API_KEY = "test-key";
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: makeContextCarrySummary("small", 180)
          }
        }]
      })
    };
  };

  const res = createMockResponse();

  try {
    await summarize({ method: "POST", body: { conversation } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, "mistral-medium-2604");
    assert.equal(requests[0].max_tokens, 1000);
    assert.equal(res.payload.timing.profile, "small");
    assert.equal(res.payload.timing.servedBy, "mistral");
    assert.equal(res.payload.timing.model, "mistral-medium-2604");
    assert.equal(res.payload.timing.fallback.attempted, false);
    assert.equal(res.payload.timing.mistralPasses, 1);
  } finally {
    restoreMistralModel();
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.MISTRAL_API_KEY;
    } else {
      process.env.MISTRAL_API_KEY = originalApiKey;
    }
  }
});

test("backend sends medium chats to medium 3.5 without changing profile limits", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.MISTRAL_API_KEY;
  const restoreMistralModel = setTemporaryEnv("MISTRAL_MODEL", undefined);
  const conversation = "x".repeat(20001);
  const requests = [];

  process.env.MISTRAL_API_KEY = "test-key";
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: makeContextCarrySummary("medium", 520)
          }
        }]
      })
    };
  };

  const res = createMockResponse();

  try {
    await summarize({ method: "POST", body: { conversation } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, "mistral-medium-2604");
    assert.equal(requests[0].max_tokens, 1900);
    assert.equal(res.payload.timing.profile, "medium");
    assert.equal(res.payload.timing.model, "mistral-medium-2604");
    assert.equal(res.payload.timing.targetWords, 700);
    assert.equal(res.payload.timing.mistralPasses, 1);
    assert.match(res.payload.timing.modelReason, /served as the first model/);
  } finally {
    restoreMistralModel();
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.MISTRAL_API_KEY;
    } else {
      process.env.MISTRAL_API_KEY = originalApiKey;
    }
  }
});

test("backend fixed chain takes precedence over MISTRAL_MODEL", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.MISTRAL_API_KEY;
  const restoreMistralModel = setTemporaryEnv("MISTRAL_MODEL", "custom-mistral-test");
  const conversation = "override context ".repeat(2200);
  const requests = [];

  process.env.MISTRAL_API_KEY = "test-key";
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: makeContextCarrySummary("override", 520)
          }
        }]
      })
    };
  };

  const res = createMockResponse();

  try {
    await summarize({ method: "POST", body: { conversation } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].model, "mistral-medium-2604");
    assert.equal(res.payload.timing.model, "mistral-medium-2604");
    assert.equal(res.payload.timing.modelOverride, false);
    assert.equal(res.payload.timing.modelThresholdChars, null);
    assert.match(res.payload.timing.modelReason, /served as the first model/);
  } finally {
    restoreMistralModel();
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.MISTRAL_API_KEY;
    } else {
      process.env.MISTRAL_API_KEY = originalApiKey;
    }
  }
});

test("backend falls back from medium 3.5 to large and reports the serving model", async () => {
  const originalFetch = global.fetch;
  const restoreApiKey = setTemporaryEnv("MISTRAL_API_KEY", "test-mistral-key");
  const conversation = "model fallback context ".repeat(180);
  const requests = [];

  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);

    if (body.model === "mistral-medium-2604") {
      return {
        ok: false,
        status: 400,
        text: async () => "medium unavailable"
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: makeContextCarrySummary("large-fallback", 260)
          }
        }]
      })
    };
  };

  const res = createMockResponse();

  try {
    await summarize({ method: "POST", body: { conversation } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(requests.map((request) => request.model), [
      "mistral-medium-2604",
      "mistral-large-2512"
    ]);
    assert.equal(res.payload.timing.model, "mistral-large-2512");
    assert.deepEqual(res.payload.timing.mistralModelsTried, [
      "mistral-medium-2604",
      "mistral-large-2512"
    ]);
    assert.match(res.payload.timing.modelReason, /mistral-medium-2604 failed; fell back to mistral-large-2512/);
  } finally {
    restoreApiKey();
    global.fetch = originalFetch;
  }
});

test("backend falls back to Groq after Mistral rate limits and keeps the same prompt", async () => {
  const originalFetch = global.fetch;
  const restoreApiKey = setTemporaryEnv("MISTRAL_API_KEY", "test-mistral-key");
  const restoreGroqKey = setTemporaryEnv("GROQ_API_KEY", "test-groq-key");
  const restoreMistralModel = setTemporaryEnv("MISTRAL_MODEL", "custom-mistral-test");
  const conversation = "fallback context ".repeat(260);
  const mistralRequests = [];
  const groqRequests = [];

  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);

    if (url === "https://api.mistral.ai/v1/chat/completions") {
      mistralRequests.push(body);
      return {
        ok: false,
        status: 429,
        text: async () => "rate limited"
      };
    }

    if (url === "https://api.groq.com/openai/v1/chat/completions") {
      groqRequests.push(body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          usage: {
            prompt_tokens: 700,
            completion_tokens: 220,
            total_tokens: 920
          },
          choices: [{
            message: {
              content: makeContextCarrySummary("groq", 260)
            }
          }]
        })
      };
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  const res = createMockResponse();

  try {
    await summarize({ method: "POST", body: { conversation } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(mistralRequests.length, 2);
    assert.equal(groqRequests.length, 1);
    assert.deepEqual(mistralRequests.map((request) => request.model), [
      "mistral-medium-2604",
      "mistral-medium-2604"
    ]);
    assert.ok(mistralRequests.every((request) => request.prompt_cache_key));
    assert.equal(groqRequests[0].model, "llama-3.1-8b-instant");
    assert.equal(groqRequests[0].prompt_cache_key, undefined);
    assert.equal(groqRequests[0].prediction, undefined);
    assert.equal(groqRequests[0].max_tokens, mistralRequests[0].max_tokens);
    assert.deepEqual(groqRequests[0].messages, mistralRequests[0].messages);
    assert.equal(res.payload.timing.servedBy, "groq");
    assert.equal(res.payload.timing.provider, "groq");
    assert.equal(res.payload.timing.model, "llama-3.1-8b-instant");
    assert.equal(res.payload.timing.primaryModel, "mistral-medium-2604");
    assert.equal(res.payload.timing.modelOverride, false);
    assert.equal(res.payload.timing.fallback.attempted, true);
    assert.equal(res.payload.timing.fallback.used, true);
    assert.equal(res.payload.timing.fallback.servedBy, "groq");
    assert.equal(res.payload.timing.fallback.model, "llama-3.1-8b-instant");
    assert.match(res.payload.timing.fallback.reason, /Mistral API error 429/);
    assert.deepEqual(res.payload.timing.usage, {
      promptTokens: 700,
      completionTokens: 220,
      totalTokens: 920,
      cachedTokens: null
    });
  } finally {
    restoreMistralModel();
    restoreGroqKey();
    restoreApiKey();
    global.fetch = originalFetch;
  }
});

test("backend falls back to Groq when Mistral returns an empty summary", async () => {
  const originalFetch = global.fetch;
  const restoreApiKey = setTemporaryEnv("MISTRAL_API_KEY", "test-mistral-key");
  const restoreGroqKey = setTemporaryEnv("GROQ_API_KEY", "test-groq-key");
  const restoreMistralModel = setTemporaryEnv("MISTRAL_MODEL", undefined);
  const conversation = "empty summary fallback ".repeat(180);
  const requests = [];

  global.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });

    if (url === "https://api.mistral.ai/v1/chat/completions") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{ message: { content: "" } }]
        })
      };
    }

    if (url === "https://api.groq.com/openai/v1/chat/completions") {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [{
            message: {
              content: makeContextCarrySummary("groq-empty", 260)
            }
          }]
        })
      };
    }

    throw new Error(`Unexpected URL ${url}`);
  };

  const res = createMockResponse();

  try {
    await summarize({ method: "POST", body: { conversation } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 4);
    assert.deepEqual(requests.slice(0, 3).map((request) => request.body.model), [
      "mistral-medium-2604",
      "mistral-large-2512",
      "ministral-3b-2512"
    ]);
    assert.equal(requests[3].body.model, "llama-3.1-8b-instant");
    assert.deepEqual(requests[3].body.messages, requests[0].body.messages);
    assert.equal(res.payload.timing.servedBy, "groq");
    assert.equal(res.payload.timing.primaryModel, "mistral-medium-2604");
    assert.equal(res.payload.timing.model, "llama-3.1-8b-instant");
    assert.equal(res.payload.timing.fallback.used, true);
    assert.match(res.payload.timing.fallback.reason, /Mistral returned an empty summary/);
  } finally {
    restoreMistralModel();
    restoreGroqKey();
    restoreApiKey();
    global.fetch = originalFetch;
  }
});

test("backend advances to the next model after a timed-out Mistral attempt", async () => {
  const originalFetch = global.fetch;
  const restoreApiKey = setTemporaryEnv("MISTRAL_API_KEY", "test-mistral-key");
  const conversation = "timeout fallback context ".repeat(180);
  const requests = [];

  global.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);

    if (body.model === "mistral-medium-2604") {
      const error = new Error("request timed out");
      error.name = "AbortError";
      throw error;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: makeContextCarrySummary("timeout-fallback", 260)
          }
        }]
      })
    };
  };

  const res = createMockResponse();

  try {
    await summarize({ method: "POST", body: { conversation } }, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(requests.map((request) => request.model), [
      "mistral-medium-2604",
      "mistral-large-2512"
    ]);
    assert.equal(res.payload.timing.model, "mistral-large-2512");
  } finally {
    restoreApiKey();
    global.fetch = originalFetch;
  }
});

test("backend returns the first large summary without a second expansion request", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.MISTRAL_API_KEY;
  const conversation = "substantial context ".repeat(4000);
  const shortSummary = makeContextCarrySummary("short", 120);
  const requests = [];

  process.env.MISTRAL_API_KEY = "test-key";
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        usage: { prompt_tokens: 900, completion_tokens: 180, total_tokens: 1080 },
        choices: [{
          message: {
            content: shortSummary
          }
        }]
      })
    };
  };

  const res = createMockResponse();

  try {
    await summarize({ method: "POST", body: { conversation } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].prediction, undefined);
    assert.equal(res.payload.timing.mistralPasses, 1);
    assert.equal(res.payload.timing.expansion.attempted, false);
    assert.equal(res.payload.timing.expansion.used, false);
    assert.equal(res.payload.timing.expansion.predictedOutput, false);
    assert.equal(res.payload.timing.qualityFloorMet, false);
    assert.equal(res.payload.timing.summaryWordCount, countWords(res.payload.summary));
    assert.deepEqual(res.payload.timing.usage, {
      promptTokens: 900,
      completionTokens: 180,
      totalTokens: 1080,
      cachedTokens: null
    });
    assert.equal(res.payload.timing.expansion.usage, null);
    assert.match(res.payload.summary, /short/);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.MISTRAL_API_KEY;
    } else {
      process.env.MISTRAL_API_KEY = originalApiKey;
    }
  }
});

test("puts free-form model output into KEY CONTEXT instead of returning loose text", () => {
  const normalized = normalizeContextCarrySummary("User is debugging paste reliability.");

  assert.match(normalized, /WHO I AM\nNone/);
  assert.match(normalized, /KEY CONTEXT\nUser is debugging paste reliability\./);
  assert.match(normalized, /NEXT STEP\nReply only:/);
});

test("strips old copy-paste footer lines", () => {
  const cleaned = stripContextCarryFooter([
    "WHO I AM",
    "Someone building Context Generator.",
    "---",
    "PASTE THIS AT THE TOP OF YOUR NEW CHAT",
    "Then write: Continue from where we left off."
  ].join("\n"));

  assert.equal(cleaned, "WHO I AM\nSomeone building Context Generator.");
});

function makeContextCarrySummary(word, wordCount) {
  const words = Array.from({ length: wordCount }, (_, index) => `${word}${index}`).join(" ");
  return [
    "CONTEXT CARRY - READY TO PASTE",
    "",
    "WHO I AM",
    words,
    "",
    "WHAT WE WERE DOING",
    "Details preserved.",
    "",
    "WHERE WE LEFT OFF",
    "Ready for continuation.",
    "",
    "DECISIONS MADE",
    "- Continue.",
    "",
    "OPEN QUESTIONS",
    "None",
    "",
    "KEY CONTEXT",
    "- Useful context.",
    "",
    "NEXT STEP",
    "Continue."
  ].join("\n");
}

function setTemporaryEnv(name, value) {
  const original = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }

  return () => {
    if (original === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = original;
    }
  };
}

function createMockResponse() {
  return {
    statusCode: null,
    payload: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return payload;
    },
    end() {
      return this;
    }
  };
}
