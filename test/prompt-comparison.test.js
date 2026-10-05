const test = require("node:test");
const assert = require("node:assert/strict");
const { assessSummary, comparePrompts } = require("../scripts/compare-summary-prompts");
const fixture = require("../evaluation/handoff-quality-cases.json");

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
