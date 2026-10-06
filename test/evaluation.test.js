const test = require("node:test");
const assert = require("node:assert/strict");

const { setTimeout: delay } = require("node:timers/promises");
const { containsFact, evaluateCase, evaluateCaseWithRetry, runEvaluation } = require("../scripts/run-regression-eval");
const fixture = require("../evaluation/cases.json");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

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
  assert.equal(result.factRecall, passingResult.factRecall);
  assert.equal(result.latencyMs, passingResult.latencyMs);
  assert.equal(result.recovered, true);
  assert.equal(result.attemptResults[0].error, "temporary 502");
  assert.equal(result.attemptResults[0].passed, false);
  assert.equal(result.attemptResults[1].passed, true);
});

test("live evaluation retains initial quality failure, time and tokens after retry recovery", async () => {
  let elapsed = 0;
  let calls = 0;
  const result = await evaluateCaseWithRetry(timingCase, async () => {
    const first = ++calls === 1;
    const latencyMs = first ? 40000 : 10000;
    elapsed += latencyMs;
    return { validShape: true, factRecall: first ? 0.5 : 1, incorrectFacts: [],
      missingFacts: first ? ["Project Atlas"] : [], latencyMs, maxLatencyMs: 60000,
      usage: { promptTokens: 100, totalTokens: first ? 120 : 130 } };
  }, 0, () => elapsed);
  assert.equal(result.latencyMs, 10000);
  assert.equal(result.totalLatencyMs, 50000);
  assert.equal(result.totalRequestMs, 50000);
  assert.equal(result.recovered, true);
  assert.deepEqual(result.attemptResults.map(attempt => attempt.passed), [false, true]);
  assert.deepEqual(result.attemptResults[0].missingFacts, ["Project Atlas"]);
  assert.deepEqual(result.attemptResults.map(attempt => attempt.usage.totalTokens), [120, 130]);
});

test("live evaluation accounts for retries in the total budget and continues after case failures", async () => {
  let elapsed = 0;
  const cases = [{ id: "broken-endpoint" }, { id: "slow-recovery" }];
  const report = await runEvaluation({ cases, now: () => elapsed, evaluator: async testCase => {
    if (testCase.id === "broken-endpoint") {
      elapsed += 1000;
      throw new Error("Endpoint failed twice");
    }
    let attempts = 0;
    return evaluateCaseWithRetry(testCase, async () => {
      const first = ++attempts === 1;
      elapsed += first ? 60000 : 40000;
      return { validShape: true, factRecall: first ? 0.5 : 1, incorrectFacts: [], missingFacts: [],
        latencyMs: first ? 60000 : 40000, maxLatencyMs: 60000 };
    }, 0, () => elapsed);
  } });
  assert.equal(report.results.length, 2);
  assert.equal(report.results[1].recovered, true);
  assert.equal(report.totalMs, 101000);
  assert.equal(report.passed, false);
  assert.ok(report.failures.includes("Endpoint failed twice"));
  assert.ok(report.failures.some(failure => failure.includes("total latency 101000ms")));
});

test("live evaluation preserves a failed quality result when its retry has a service error", async () => {
  let calls = 0;
  const result = await evaluateCaseWithRetry(timingCase, async () => {
    if (++calls === 2) throw new Error("retry 502");
    return { validShape: true, factRecall: 0.5, incorrectFacts: [], missingFacts: ["Project Atlas"],
      latencyMs: 5, maxLatencyMs: 60 };
  }, 0);
  assert.equal(result.recovered, false);
  assert.equal(result.factRecall, 0.5);
  assert.equal(result.attemptResults[1].error, "retry 502");
});

test("live evaluation rejects critical contradictions even when every required phrase is present", async () => {
  const cases = [
    ["small-product-handoff", "The production branch is not master.", "production branch denies master"],
    ["small-product-handoff", "The server limit is not 210,000 characters.", "server limit denies 210000 characters"],
    ["medium-incident-handoff", "The incident did not begin at 14:35 UTC.", "incident start time denied"],
    ["medium-incident-handoff", "Customer data is not intact.", "customer data integrity denied"],
    ["medium-incident-handoff", "The region is not eu-west-1.", "incident region denied"],
    ["medium-incident-handoff", "Implementation has already started.", "implementation incorrectly reported started"]
  ];
  for (const [id, contradiction, expected] of cases) {
    const testCase = fixture.cases.find(testCase => testCase.id === id);
    const facts = testCase.requiredFacts.map(fact => Array.isArray(fact) ? fact[0] : fact).join("; ");
    const good = `CONTEXT CARRY\nWHO I AM\nWHAT WE WERE DOING\nWHERE WE LEFT OFF\nDECISIONS MADE\nOPEN QUESTIONS\nKEY CONTEXT\n${facts}\nNEXT STEP`;
    const read = text => evaluateCase(testCase, { fetchImpl: async () => ({ ok: true,
      json: async () => ({ summary: text, timing: { usage: { totalTokens: 12 } } }) }) });
    const passing = await read(good);
    assert.deepEqual(passing.incorrectFacts, []);
    assert.equal(passing.factRecall, 1);
    const failing = await read(`${good}\n${contradiction}`);
    assert.equal(failing.factRecall, 1);
    assert.ok(failing.incorrectFacts.includes(expected), contradiction);
    assert.equal(failing.usage.totalTokens, 12);
  }
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

test("evaluation CLI saves both failed attempts and still evaluates the other case without AI calls", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cap-eval-report-"));
  const reportPath = path.join(directory, "report.json");
  const clockPath = path.join(directory, "retry-clock.cjs");
  const delaysPath = path.join(directory, "retry-delays.json");
  let requests = 0;
  const server = http.createServer(async (request, response) => {
    for await (const _chunk of request) { /* Drain the local request. */ }
    requests++;
    response.setHeader("Content-Type", "application/json");
    if (requests <= 2) {
      response.writeHead(502);
      response.end(JSON.stringify({ error: "fixture unavailable" }));
      return;
    }
    const facts = fixture.cases[1].requiredFacts.map(fact => Array.isArray(fact) ? fact[0] : fact).join("; ");
    response.end(JSON.stringify({ summary: `CONTEXT CARRY\nWHO I AM\nWHAT WE WERE DOING\nWHERE WE LEFT OFF\nDECISIONS MADE\nOPEN QUESTIONS\nKEY CONTEXT\n${facts}\nNEXT STEP`,
      timing: { usage: { totalTokens: 123 }, model: "local-fixture" } }));
  });
  try {
    // Advance only the CLI retry clock; native HTTP timers keep real scheduling.
    // Record its requested delay so skipping the backoff cannot pass this test.
    await fs.writeFile(clockPath, `
      const { writeFileSync } = require("node:fs");
      const schedule = global.setTimeout;
      const now = Date.now;
      const delays = [];
      let elapsed = 0;
      Date.now = () => now() + elapsed;
      global.setTimeout = (callback, ms, ...args) => {
        if (ms !== 1000) return schedule(callback, ms, ...args);
        delays.push(ms);
        writeFileSync(${JSON.stringify(delaysPath)}, JSON.stringify(delays));
        return schedule(() => { elapsed += ms; callback(...args); }, 0);
      };
    `);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}/summarize`;
    const child = spawn(process.execPath, ["--require", clockPath, path.join(__dirname, "../scripts/run-regression-eval.js")], {
      env: { ...process.env, EVAL_ENDPOINT: endpoint, EVAL_REPORT_PATH: reportPath }, stdio: "pipe"
    });
    let output = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { output += chunk; });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    assert.equal(exitCode, 1, output);
    assert.equal(requests, 3, "An endpoint failure must not skip the remaining case.");
    assert.deepEqual(JSON.parse(await fs.readFile(delaysPath, "utf8")), [1000]);
    const report = JSON.parse(await fs.readFile(reportPath, "utf8"));
    assert.equal(report.passed, false);
    assert.equal(report.results.length, 2);
    assert.equal(report.results[0].attempts, 2);
    assert.ok(report.results[0].attemptResults.every(attempt => attempt.error.includes("502")));
    assert.ok(report.results[0].totalLatencyMs - report.results[0].totalRequestMs >= 1000,
      "The failed case must count the requested backoff separately from HTTP time.");
    assert.equal(report.results[1].usage.totalTokens, 123);
    assert.equal(report.results[1].attemptResults[0].passed, true);
    assert.ok(report.totalMs >= 1000, "The report must count the retry delay.");
    assert.equal(JSON.stringify(report).includes("Background note"), false, "Artifacts must not include transcripts.");
    assert.match(output, /actual total=/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
