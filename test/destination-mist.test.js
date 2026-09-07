const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "extension", "platform-content.js"), "utf8");

test("destination picker mist connects to the bubble and respects reduced motion", () => {
  assert.match(source, /const DESTINATION_MIST_ID = "context-generator-destination-mist"/);
  assert.match(source, /positionDestinationMist\(\)/);
  assert.match(source, /bubbleRect\.left \+ bubbleRect\.width \/ 2/);
  assert.match(source, /\.context-generator-mist-wisp \{[\s\S]*will-change: transform, opacity/);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.context-generator-mist-wisp[\s\S]*animation: none !important/);
});
