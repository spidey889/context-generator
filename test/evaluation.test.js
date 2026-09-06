const test = require("node:test");
const assert = require("node:assert/strict");

const { containsFact } = require("../scripts/run-regression-eval");

test("live evaluation treats typographic dashes as equivalent in numeric ranges", () => {
  const summary = "Retry jitter remains open: 250–750 ms or 500–1500 ms.";

  assert.equal(containsFact(summary, "250-750 ms"), true);
  assert.equal(containsFact(summary, "500-1500 ms"), true);
});
