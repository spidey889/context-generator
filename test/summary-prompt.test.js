const assert = require("node:assert/strict");
const test = require("node:test");
const { getSummarySystemPrompt, getContextCarryTemplate } = require("../api/summary-prompt");
const {
  getSummaryProfile,
  getSummaryContentRejectionReason,
} = require("../api/summarize").__test;

test("all generated profiles preserve provider templates without fictional example facts", () => {
  for (const length of [1201, 8001, 60001, 210001]) {
    const profile = getSummaryProfile("x".repeat(length));
    for (const options of [{}, { plainHeader: true }]) {
      const prompt = getSummarySystemPrompt(profile, options);
      const template = getContextCarryTemplate(profile, options);
      assert.ok(prompt.endsWith(`Required template:\n${template}`));
      assert.doesNotMatch(prompt, /example_transcript|example_handoff|Harbor|Dana|backup is intact|disabling duplicate detection/);
      assert.doesNotMatch(template, /Harbor|Dana|80 ms|240 ms/);
      // Preserve the empty-template gate when moving its exact hints to a module.
      assert.equal(getSummaryContentRejectionReason(template, profile), "substantively empty output");
    }
  }
});
