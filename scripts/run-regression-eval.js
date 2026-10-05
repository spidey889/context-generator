const fs = require("node:fs");
const path = require("node:path");

const fixturePath = path.join(__dirname, "..", "evaluation", "cases.json");
const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
const endpoint = process.env.EVAL_ENDPOINT || "https://context-generator-five.vercel.app/api/summarize";
// Match the extension's allowance, including the backend's streaming heartbeats.
const requestTimeoutMs = 320_000;

function transcriptFor(testCase) {
  const platform = testCase.platform.includes("claude") ? "Claude" : "ChatGPT";
  const padding = Array.from(
    { length: testCase.paddingRepeat || 0 },
    (_, index) => `Background note ${index + 1}: ${testCase.paddingText}`
  );
  return [
    `${platform} conversation:`,
    "",
    ...testCase.turns.flatMap((turn) => [
      `${turn.role === "user" ? "User" : platform}: ${turn.text}`,
      ""
    ]),
    ...padding
  ].join("\n").trim();
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    // Providers often typeset ASCII transcript ranges with typographic dashes.
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function containsFact(summary, fact) {
  const acceptedPhrases = Array.isArray(fact) ? fact : [fact];
  return acceptedPhrases.some((phrase) => normalize(summary).includes(normalize(phrase)));
}

function factLabel(fact) {
  return Array.isArray(fact) ? fact.join(" OR ") : fact;
}

async function evaluateCase(testCase, { fetchImpl = fetch, now = Date.now, timeoutMs = requestTimeoutMs } = {}) {
  const conversation = transcriptFor(testCase);
  const startedAt = now();
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Cap-Context-Client": "cap-context-extension/1"
    },
    body: JSON.stringify({ conversation }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  // Headers can arrive with the first heartbeat, long before the summary. The
  // deadline and latency measurement must cover the complete response body.
  const payload = await response.json();
  const latencyMs = now() - startedAt;

  if (!response.ok) {
    throw new Error(`${testCase.id}: endpoint returned ${response.status} ${payload.error || ""}`.trim());
  }

  const summary = payload.summary || "";
  const missingFacts = testCase.requiredFacts
    .filter((fact) => !containsFact(summary, fact))
    .map(factLabel);
  const incorrectFacts = testCase.forbiddenFacts.filter((fact) => containsFact(summary, fact));
  // Phrase presence alone cannot establish an assertion's meaning. Curated
  // contradictions cover critical fixture facts without another AI judge call.
  for (const rule of testCase.contradictions || []) {
    if (new RegExp(rule.pattern, "iu").test(normalize(summary))) incorrectFacts.push(rule.label);
  }
  const validShape = /CONTEXT\s+CARRY[\s\S]*WHO I AM[\s\S]*WHAT WE WERE DOING[\s\S]*WHERE WE LEFT OFF[\s\S]*DECISIONS MADE[\s\S]*OPEN QUESTIONS[\s\S]*KEY CONTEXT[\s\S]*NEXT STEP/i.test(summary);
  const factRecall = testCase.requiredFacts.length
    ? (testCase.requiredFacts.length - missingFacts.length) / testCase.requiredFacts.length
    : 1;

  return {
    id: testCase.id,
    latencyMs,
    maxLatencyMs: testCase.maxLatencyMs,
    factRecall,
    missingFacts,
    incorrectFacts,
    validShape,
    profile: payload.timing?.profile || null,
    model: payload.timing?.model || payload.timing?.primaryModel || null,
    usage: payload.timing?.usage || null
  };
}

function failureCount(result) {
  return Number(!result.validShape)
    + Number(result.factRecall < fixture.thresholds.minimumFactRecall)
    + Number(result.incorrectFacts.length > fixture.thresholds.maximumIncorrectFacts)
    + Number(result.latencyMs > result.maxLatencyMs);
}

async function evaluateCaseWithRetry(testCase, evaluator = evaluateCase, retryDelayMs = 1000, now = Date.now) {
  const startedAt = now();
  const attemptResults = [];
  const errors = [];
  let result;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const attemptStartedAt = now();
    try {
      result = await evaluator(testCase);
      attemptResults.push({ ...result, attempt, passed: failureCount(result) === 0 });
      if (failureCount(result) === 0) break;
    } catch (error) {
      errors.push(error);
      attemptResults.push({ attempt, passed: false, error: error.message, latencyMs: now() - attemptStartedAt });
      if (attempt === 1 && retryDelayMs > 0) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
  }
  const diagnostics = {
    attempts: attemptResults.length, attemptResults, totalLatencyMs: now() - startedAt,
    totalRequestMs: attemptResults.reduce((sum, attempt) => sum + attempt.latencyMs, 0),
    recovered: attemptResults.length > 1 && attemptResults.at(-1).passed
  };
  if (!result) {
    throw Object.assign(new AggregateError(errors, `${testCase.id}: evaluation failed twice`), diagnostics);
  }
  return { ...result, ...diagnostics };
}

async function runEvaluation({ cases = fixture.cases, evaluator = evaluateCaseWithRetry, now = Date.now } = {}) {
  const startedAt = now();
  const results = [];
  for (const testCase of cases) {
    try {
      results.push({ ...(await evaluator(testCase)), id: testCase.id });
    } catch (error) {
      results.push({ id: testCase.id, error: error.message, attempts: error.attempts,
        attemptResults: error.attemptResults || [], totalLatencyMs: error.totalLatencyMs || 0,
        totalRequestMs: error.totalRequestMs || 0, recovered: false });
    }
  }

  // Include failed attempts, body reads, retries and retry delays in the total.
  const totalMs = now() - startedAt;
  const failures = [];
  for (const result of results) {
    if (result.error) { failures.push(result.error); continue; }
    if (!result.validShape) failures.push(`${result.id}: invalid Context Carry structure`);
    if (result.factRecall < fixture.thresholds.minimumFactRecall) {
      failures.push(`${result.id}: missing facts: ${result.missingFacts.join(", ")}`);
    }
    if (result.incorrectFacts.length > fixture.thresholds.maximumIncorrectFacts) {
      failures.push(`${result.id}: forbidden facts present: ${result.incorrectFacts.join(", ")}`);
    }
    if (result.latencyMs > result.maxLatencyMs) {
      failures.push(`${result.id}: latency ${result.latencyMs}ms exceeded ${result.maxLatencyMs}ms`);
    }
  }
  if (totalMs > fixture.thresholds.maximumTotalMs) {
    failures.push(`total latency ${totalMs}ms exceeded ${fixture.thresholds.maximumTotalMs}ms`);
  }

  return { version: fixture.version, endpoint, results, totalMs, failures, passed: failures.length === 0 };
}

async function main() {
  const report = await runEvaluation();
  for (const result of report.results) {
    for (const attempt of result.attemptResults) {
      process.stdout.write(`${result.id} attempt=${attempt.attempt} ${attempt.passed ? "PASS" : "FAIL"}: ${JSON.stringify(attempt)}\n`);
    }
    if (result.recovered) process.stdout.write(`WARN: ${result.id} recovered on retry; its initial failure is retained.\n`);
  }
  const reportPath = process.env.EVAL_REPORT_PATH;
  if (reportPath) fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(`Evaluation set v${report.version}: ${report.results.length} cases, actual total=${report.totalMs}ms\n`);
  report.failures.forEach(failure => process.stderr.write(`FAIL: ${failure}\n`));
  if (!report.passed) process.exitCode = 1;
  else process.stdout.write("PASS: accuracy, incorrect-fact, structure, and latency gates met\n");
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { containsFact, evaluateCase, evaluateCaseWithRetry, runEvaluation, normalize };
