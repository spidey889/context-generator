const test = require("node:test");
const assert = require("node:assert/strict");
const { assessSummary, comparePrompts, withLongHistory } = require("../scripts/compare-summary-prompts");
const fixture = require("../evaluation/handoff-quality-cases.json");
const { getSummaryProfile } = require("../api/summarize").__test;

test("long-history cases preserve source turns and their order across two distracting blocks", () => {
  for (const [caseId, target, profile] of [
    ["continue-latest-draft", 90000, "large"],
    ["corrected-export-design", 280000, "extra-large"]
  ]) {
    const base = fixture.cases.find(item => item.id === caseId);
    const expanded = withLongHistory(base, target);
    assert.ok(expanded.conversation.length >= target);
    assert.ok(expanded.conversation.length < 350000);
    assert.equal(getSummaryProfile(expanded.conversation).id, profile);
    assert.deepEqual(expanded.criticalFacts, base.criticalFacts);
    let position = 0;
    for (const turn of base.conversation.split("\n\n")) {
      const next = expanded.conversation.indexOf(turn, position);
      assert.ok(next >= position, "complete original turns must survive in chronological order");
      position = next + turn.length;
    }
    const correction = caseId === "continue-latest-draft" ? "Here is my replacement draft" : "Replace the earlier six-upload choice";
    const correctionAt = expanded.conversation.indexOf(correction);
    assert.ok(correctionAt > expanded.conversation.length * 0.35);
    assert.ok(correctionAt < expanded.conversation.length * 0.65);
    assert.equal(expanded.conversation, withLongHistory(base, target).conversation);
  }
});

test("long-history construction rejects oversized or destructive fixture targets", () => {
  for (const target of [0, 350001, 90000.5]) {
    assert.throws(() => withLongHistory(fixture.cases[0], target), /transcript limit/);
  }
});

test("handoff checks detect lost current draft text even when surrounding event facts survive", () => {
  const draft = fixture.cases.find(item => item.id === "continue-latest-draft");
  const factsOnly = draft.requiredFacts.map(fact => Array.isArray(fact) ? fact[0] : fact).join("; ");
  const assessment = assessSummary(factsOnly, draft);
  assert.deepEqual(assessment.missingFacts, []);
  assert.ok(assessment.missingCriticalFacts.includes(draft.criticalFacts[0]));
  const withWorkProduct = `${factsOnly}\n${draft.criticalFacts.map(fact => Array.isArray(fact) ? fact[0] : fact).join("\n")}`;
  assert.deepEqual(assessSummary(withWorkProduct, draft).missingCriticalFacts, []);
});

test("prompt comparisons retain failed generations and every repeat without choosing a best result", async () => {
  const cases = [fixture.cases[0]];
  let calls = 0;
  const snapshots = [];
  const results = await comparePrompts({ cases, variants: [{ name: "baseline" }, { name: "candidate" }], repeats: 2,
    generate: async variant => {
      calls++;
      if (calls === 2) throw new Error("PRIVATE_KEY_OR_UPSTREAM_ERROR");
      return { summary: "Project Cedar", generated: calls !== 3, model: calls === 3 ? "local-direct" : "test-model" };
    },
    onResult: (_result, rows) => snapshots.push(rows.length)
  });
  assert.equal(calls, 4);
  assert.deepEqual(results.map(row => row.variant), ["baseline", "candidate", "candidate", "baseline"]);
  assert.deepEqual(results.map(row => row.repeat), [1, 1, 2, 2]);
  assert.equal(results[1].error, "generation_failed");
  assert.equal(results[2].generated, false);
  assert.equal(results[2].assessment, null, "exact local carry cannot pass model-quality checks");
  assert.deepEqual(snapshots, [1, 2, 3, 4]);
  assert.doesNotMatch(JSON.stringify(results), /PRIVATE_KEY_OR_UPSTREAM_ERROR/);
});
