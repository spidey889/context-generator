const test = require("node:test");
const assert = require("node:assert/strict");

const {
  evaluateContextCarryGrounding,
  extractDeveloperFacts,
  getEvaluationMetadata,
  getLatestUserMessage,
  isTokenLimitFinishReason
} = require("../api/context-carry-evaluator");

test("developer grounding evaluator verifies supported technical facts", () => {
  const conversation = [
    "User: Work in `api/summarize.js` and run `npm test`.",
    "Assistant: The previous commit was 66d491f and the error was ENOENT.",
    "User: Keep v1.3.0, gemini-3.5-flash, and the 30 second limit."
  ].join("\n");
  const summary = [
    "KEY CONTEXT",
    "- Work in `api/summarize.js` and run `npm test`.",
    "- Preserve v1.3.0, gemini-3.5-flash, commit 66d491f, ENOENT, and the 30 second limit."
  ].join("\n");

  const evaluation = evaluateContextCarryGrounding({ conversation, summary, finishReason: "STOP" });
  const metadata = getEvaluationMetadata(evaluation);

  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.score, 100);
  assert.equal(metadata.unsupportedCount, 0);
  assert.equal(metadata.warningCount, 0);
  assert.equal(metadata.missingLatestUserFactCount, 0);
  assert.equal(metadata.mode, "deterministic");
});

test("developer grounding evaluator blocks invented high-confidence facts", () => {
  const conversation = "User: Change `api/summarize.js`, then run `npm test`.";
  const summary = [
    "KEY CONTEXT",
    "- Change `api/invented.js`, then run `npm run deploy`.",
    "- The serving model is gemini-9.9-ultra at commit deadbee7."
  ].join("\n");

  const evaluation = evaluateContextCarryGrounding({ conversation, summary });

  assert.equal(evaluation.passed, false);
  assert.deepEqual(
    new Set(evaluation.blockingUnsupportedFacts.map((fact) => fact.kind)),
    new Set(["filePath", "command", "commitHash", "modelId"])
  );
});

test("relative developer paths remain case-sensitive", () => {
  const evaluation = evaluateContextCarryGrounding({
    conversation: "User: Change `api/Summarize.js`.",
    summary: "KEY CONTEXT\n- Change `api/summarize.js`."
  });

  assert.equal(evaluation.passed, false);
  assert.deepEqual(evaluation.blockingUnsupportedFacts.map((fact) => fact.kind), ["filePath"]);
});

test("unsupported numerical claims warn without slowing the normal fallback path", () => {
  const conversation = "User: Keep the transfer fast and preserve `api/summarize.js`.";
  const summary = "KEY CONTEXT\n- Preserve `api/summarize.js`; the transfer takes 99 seconds.";

  const evaluation = evaluateContextCarryGrounding({ conversation, summary });

  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.warningFacts.length, 1);
  assert.equal(evaluation.warningFacts[0].kind, "numberWithUnit");
  assert.ok(evaluation.score < 100);
});

test("latest user technical facts are measured as coverage warnings", () => {
  const conversation = [
    "User: Work in `api/summarize.js`.",
    "Assistant: Understood.",
    "User: The current version is v1.3.0 and the final command is `npm test`."
  ].join("\n");
  const summary = "KEY CONTEXT\n- Work remains in `api/summarize.js`.";

  const evaluation = evaluateContextCarryGrounding({ conversation, summary });

  assert.equal(getLatestUserMessage(conversation), "The current version is v1.3.0 and the final command is `npm test`.");
  assert.equal(evaluation.passed, true);
  assert.deepEqual(
    new Set(evaluation.missingLatestUserFacts.map((fact) => fact.kind)),
    new Set(["version", "command"])
  );
});

test("token-limit finish reasons fail even when the summary is structurally complete", () => {
  assert.equal(isTokenLimitFinishReason("MAX_TOKENS"), true);
  assert.equal(isTokenLimitFinishReason("length"), true);
  assert.equal(isTokenLimitFinishReason("STOP"), false);

  const evaluation = evaluateContextCarryGrounding({
    conversation: "User: Continue the implementation.",
    summary: "KEY CONTEXT\n- Continue the implementation.",
    finishReason: "MAX_TOKENS"
  });

  assert.equal(evaluation.passed, false);
  assert.equal(evaluation.cutoffDetected, true);
});

test("maximum-size evaluator scan remains a tiny local operation", () => {
  const technicalTail = " User: Keep `api/summarize.js`, `npm test`, and v1.3.0.";
  const conversation = `${"x".repeat(210000 - technicalTail.length)}${technicalTail}`;
  const summary = "KEY CONTEXT\n- Keep `api/summarize.js`, `npm test`, and v1.3.0.";
  const startedAt = performance.now();

  const evaluation = evaluateContextCarryGrounding({ conversation, summary, finishReason: "STOP" });
  const elapsedMs = performance.now() - startedAt;

  assert.equal(evaluation.passed, true);
  assert.ok(elapsedMs < 250, `expected deterministic evaluation below 250ms, got ${elapsedMs.toFixed(2)}ms`);
  const facts = extractDeveloperFacts(summary);
  assert.deepEqual([...facts.filePath.values()], ["api/summarize.js"]);
});
