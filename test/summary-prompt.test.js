const assert = require("node:assert/strict");
const test = require("node:test");
const { getSummarySystemPrompt, getContextCarryTemplate } = require("../api/summary-prompt");
const {
  getSummaryProfile,
  getSummaryContentRejectionReason,
  normalizeContextCarrySummary
} = require("../api/summarize").__test;

test("worked examples remain deliverable and normalize identically across provider header modes", () => {
  const profile = getSummaryProfile("x".repeat(8001));
  const examples = [{}, { plainHeader: true }].map(options => {
    const prompt = getSummarySystemPrompt(profile, options);
    const example = prompt.match(/<example_handoff>\n([\s\S]*?)\n<\/example_handoff>/)?.[1];
    assert.ok(example, "the example must contain a complete handoff");
    if (options.plainHeader) assert.doesNotMatch(example, /[╔║╚]/);
    else assert.match(example, /^╔/);
    assert.equal(getSummaryContentRejectionReason(example, profile), null);
    assert.equal((example.match(/^🧠 WHO I AM$/gm) || []).length, 1);
    assert.match(example, /WHO I AM\nNone/);
    assert.match(example, /DECISIONS MADE\n- Use 2 workers; this replaces the earlier 4-worker decision\./);
    assert.match(example, /Retry delay is undecided: 80 ms or 240 ms\./);
    assert.match(example, /Implementation has not started; nothing has been tested or deployed\./);
    assert.match(example, /Constraint: "Do not deploy this change\."/);
    assert.match(example, /Pending request: explain the two-worker design before proposing code\./);
    assert.match(example, /node scripts\/export-repro\.mjs fixtures\/duplicate\.json/);
    assert.doesNotMatch(example, /8 workers|user is Dana|until tests pass/);
    return normalizeContextCarrySummary(example);
  });
  assert.equal(examples[0], examples[1]);
});

test("all generated profiles keep the worked example separate from the final template", () => {
  for (const length of [1201, 8001, 60001, 210001]) {
    const profile = getSummaryProfile("x".repeat(length));
    for (const options of [{}, { plainHeader: true }]) {
      const prompt = getSummarySystemPrompt(profile, options);
      const template = getContextCarryTemplate(profile, options);
      assert.ok(prompt.endsWith(`Required template:\n${template}`));
      assert.ok(prompt.indexOf("</example_handoff>") < prompt.indexOf("Required template:"));
      assert.doesNotMatch(template, /Harbor|Dana|80 ms|240 ms/);
      // Preserve the empty-template gate when moving its exact hints to a module.
      assert.equal(getSummaryContentRejectionReason(template, profile), "substantively empty output");
    }
  }
});
