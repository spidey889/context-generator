const test = require("node:test");
const assert = require("node:assert/strict");

const { containsFact, evaluateCaseWithRetry } = require("../scripts/run-regression-eval");

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
