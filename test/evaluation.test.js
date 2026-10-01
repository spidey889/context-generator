const test = require("node:test");
const assert = require("node:assert/strict");

const { setTimeout: delay } = require("node:timers/promises");
const { containsFact, evaluateCase, evaluateCaseWithRetry } = require("../scripts/run-regression-eval");

const timingCase = {
  id: "streaming-timing",
  platform: "chatgpt.com",
  turns: [{ role: "user", text: "Project Atlas" }],
  requiredFacts: ["Project Atlas"],
  forbiddenFacts: [],
  maxLatencyMs: 60
};

test("live evaluation measures summary completion rather than the first heartbeat", async () => {
  let elapsed = 0;
  const result = await evaluateCase(timingCase, {
    now: () => elapsed,
    fetchImpl: async () => {
      elapsed = 15;
      return {
        ok: true,
        json: async () => {
          elapsed = 90;
          return { summary: "Project Atlas" };
        }
      };
    }
  });

  assert.equal(result.latencyMs, 90);
  assert.ok(result.latencyMs > result.maxLatencyMs);
});

test("live evaluation bounds a response body that stalls after headers arrive", async () => {
  let requestSignal;
  await assert.rejects(evaluateCase(timingCase, {
    timeoutMs: 20,
    fetchImpl: async (_url, { signal }) => {
      requestSignal = signal;
      return {
        ok: true,
        json: () => delay(10_000, {}, { signal })
      };
    }
  }), { name: "AbortError" });
  assert.equal(requestSignal.aborted, true);
});

test("live evaluation retries malformed JSON as a service failure", async () => {
  let attempts = 0;
  const result = await evaluateCaseWithRetry(timingCase, async (testCase) => {
    attempts += 1;
    if (attempts === 2) {
      return { validShape: true, factRecall: 1, incorrectFacts: [], latencyMs: 1, maxLatencyMs: 60 };
    }
    return evaluateCase(testCase, {
      fetchImpl: async () => ({ ok: true, json: async () => { throw new SyntaxError("partial JSON"); } })
    });
  }, 0);

  assert.equal(attempts, 2);
  assert.equal(result.attempts, 2);
  assert.equal(result.factRecall, 1);
});

test("live evaluation treats typographic dashes as equivalent in numeric ranges", () => {
  const summary = "Retry jitter remains open: 250–750 ms or 500–1500 ms.";

  assert.equal(containsFact(summary, "250-750 ms"), true);
  assert.equal(containsFact(summary, "500-1500 ms"), true);
});

test("live evaluation retries one transient endpoint failure", async () => {
  let attempts = 0;
  const passingResult = {
    validShape: true,
    factRecall: 1,
    incorrectFacts: [],
    latencyMs: 10,
    maxLatencyMs: 100
  };
  const result = await evaluateCaseWithRetry({ id: "transient-case" }, async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary 502");
    return passingResult;
  }, 0);

  assert.equal(attempts, 2);
  assert.deepEqual(result, { ...passingResult, attempts: 2 });
});

test("live evaluation stops after two endpoint failures", async () => {
  let attempts = 0;
  await assert.rejects(
    evaluateCaseWithRetry({ id: "persistent-case" }, async () => {
      attempts += 1;
      throw new Error(`failure ${attempts}`);
    }, 0),
    /persistent-case: evaluation failed twice/
  );
  assert.equal(attempts, 2);
});
