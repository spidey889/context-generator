const assert = require("node:assert/strict");
const test = require("node:test");

const summarize = require("../api/summarize.js");

const { normalizeContextCarrySummary, stripContextCarryFooter } = summarize.__test;

test("normalizes summary into the required Context Carry shape", () => {
  const raw = [
    "```markdown",
    "# Context Carry - Ready to Paste",
    "WHO I AM",
    "Building a browser extension.",
    "",
    "WHAT WE WERE DOING",
    "Adding regression tests.",
    "",
    "NEXT STEP",
    "Keep coding.",
    "---",
    "PASTE THIS AT THE TOP OF YOUR NEW CHAT",
    "```"
  ].join("\n");

  const normalized = normalizeContextCarrySummary(raw);

  assert.match(normalized, /CONTEXT CARRY/);
  assert.match(normalized, /WHO I AM\nBuilding a browser extension\./);
  assert.match(normalized, /WHAT WE WERE DOING\nAdding regression tests\./);
  assert.doesNotMatch(normalized, /PASTE THIS AT THE TOP/i);
  assert.match(
    normalized,
    /Reply only: "Context loaded\. Let's pick up right where you left off\." Then wait for the user\./
  );
});

test("puts free-form model output into KEY CONTEXT instead of returning loose text", () => {
  const normalized = normalizeContextCarrySummary("User is debugging paste reliability.");

  assert.match(normalized, /WHO I AM\nNone/);
  assert.match(normalized, /KEY CONTEXT\nUser is debugging paste reliability\./);
  assert.match(normalized, /NEXT STEP\nReply only:/);
});

test("strips old copy-paste footer lines", () => {
  const cleaned = stripContextCarryFooter([
    "WHO I AM",
    "Someone building Context Generator.",
    "---",
    "PASTE THIS AT THE TOP OF YOUR NEW CHAT",
    "Then write: Continue from where we left off."
  ].join("\n"));

  assert.equal(cleaned, "WHO I AM\nSomeone building Context Generator.");
});
