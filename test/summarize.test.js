const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const summarize = require("../api/summarize.js");

const { normalizeContextCarrySummary, stripContextCarryFooter, countWords, shouldExpandSummary } = summarize.__test;
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

test("backend prompt defaults favor a richer continuation handoff", () => {
  assert.match(SUMMARIZE_SOURCE, /CONTEXT_CARRY_TARGET_WORDS\s*=\s*1200/);
  assert.match(SUMMARIZE_SOURCE, /MISTRAL_MAX_TOKENS\s*=\s*Number\(process\.env\.MISTRAL_MAX_TOKENS \|\| 4200\)/);
  assert.match(SUMMARIZE_SOURCE, /WHO I AM\n\[80-140 words/);
  assert.match(SUMMARIZE_SOURCE, /KEY CONTEXT\n\[350-500 words/);
  assert.match(SUMMARIZE_SOURCE, /substantial multi-turn conversation should not be under 1000 words/);
  assert.match(SUMMARIZE_SOURCE, /Do not be concise when useful continuation context exists/);
  assert.match(SUMMARIZE_SOURCE, /silently check the total word count/);
  assert.match(SUMMARIZE_SOURCE, /serious handoff to another capable AI/);
  assert.match(SUMMARIZE_SOURCE, /OPEN QUESTIONS should include unresolved risks/);
  assert.match(SUMMARIZE_SOURCE, /Do not invent, correct, or infer project facts/);
  assert.match(SUMMARIZE_SOURCE, /Create a dense continuation handoff/);
});

test("backend forwards a 160k conversation to Mistral and reports the same input size", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.MISTRAL_API_KEY;
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
        choices: [{
          message: {
            content: [
              "CONTEXT CARRY - READY TO PASTE",
              "",
              "WHO I AM",
              "Testing payload size.",
              "",
              "WHAT WE WERE DOING",
              "Verifying the backend forwards the full conversation.",
              "",
              "WHERE WE LEFT OFF",
              "The request reached the mocked Mistral endpoint.",
              "",
              "DECISIONS MADE",
              "- Keep the full 160k payload.",
              "",
              "OPEN QUESTIONS",
              "None",
              "",
              "KEY CONTEXT",
              "- The exact payload length matters.",
              "",
              "NEXT STEP",
              "Continue testing."
            ].join("\n")
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
    assert.equal(capturedRequest.body.max_tokens, 4200);
    assert.equal(capturedRequest.body.messages[1].content.slice(-160000), conversation);
    assert.equal(res.payload.timing.inputChars, 160000);
    assert.equal(res.payload.timing.maxTokens, 4200);
    assert.equal(res.payload.timing.targetWords, 1200);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.MISTRAL_API_KEY;
    } else {
      process.env.MISTRAL_API_KEY = originalApiKey;
    }
  }
});

test("backend expands substantial summaries that come back below the word floor", async () => {
  const originalFetch = global.fetch;
  const originalApiKey = process.env.MISTRAL_API_KEY;
  const conversation = "substantial context ".repeat(500);
  const shortSummary = makeContextCarrySummary("short", 120);
  const expandedSummary = makeContextCarrySummary("expanded", 1120);
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
            content: requests.length === 1 ? shortSummary : expandedSummary
          }
        }]
      })
    };
  };

  const res = createMockResponse();

  try {
    await summarize({ method: "POST", body: { conversation } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(requests.length, 2);
    assert.equal(res.payload.timing.mistralPasses, 2);
    assert.equal(res.payload.timing.expansion.attempted, true);
    assert.equal(res.payload.timing.expansion.used, true);
    assert.equal(countWords(res.payload.summary) >= 1100, true);
    assert.equal(res.payload.timing.summaryWordCount, countWords(res.payload.summary));
    assert.match(res.payload.summary, /expanded/);
  } finally {
    global.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.MISTRAL_API_KEY;
    } else {
      process.env.MISTRAL_API_KEY = originalApiKey;
    }
  }
});

test("summary expansion only applies to substantial short summaries", () => {
  assert.equal(shouldExpandSummary("tiny chat", 200), false);
  assert.equal(shouldExpandSummary("substantial ".repeat(500), 1200), false);
  assert.equal(shouldExpandSummary("substantial ".repeat(500), 700), true);
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
