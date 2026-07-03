const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const summarize = require("../api/summarize.js");

const { normalizeContextCarrySummary, stripContextCarryFooter } = summarize.__test;
const SUMMARIZE_SOURCE = fs.readFileSync(path.join(__dirname, "..", "api", "summarize.js"), "utf8");

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

test("backend prompt defaults favor a richer continuation handoff", () => {
  assert.match(SUMMARIZE_SOURCE, /MISTRAL_MAX_TOKENS\s*=\s*Number\(process\.env\.MISTRAL_MAX_TOKENS \|\| 1200\)/);
  assert.match(SUMMARIZE_SOURCE, /Aim for 850-1000 useful words/);
  assert.match(SUMMARIZE_SOURCE, /serious handoff to another capable AI/);
  assert.match(SUMMARIZE_SOURCE, /Do not invent, correct, or infer project facts/);
  assert.match(SUMMARIZE_SOURCE, /Create a dense continuation handoff/);
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
