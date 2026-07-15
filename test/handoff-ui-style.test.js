const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "extension", "platform-content.js"), "utf8");

test("handoff uses the sheet serif only for its live headline", () => {
  const overlayStart = source.indexOf("function ensureFloatingOverlay()");
  const overlayEnd = source.indexOf("function showOverlay(", overlayStart);
  const overlaySource = source.slice(overlayStart, overlayEnd);

  assert.match(source, /title\.style\.cssText = "font-family:Georgia,'Times New Roman',serif/);
  assert.match(overlaySource, /statusText\.style\.cssText = \[[\s\S]*"font-family:Georgia,'Times New Roman',serif"/);
  assert.equal((overlaySource.match(/font-family:Georgia,'Times New Roman',serif/g) || []).length, 1);
});

test("completed handoff connectors fill gradually without gating pipeline state", () => {
  assert.match(source, /handoff-stage:not\(:last-child\)::before[\s\S]*background:rgba\(255,255,255,0\.11\)/);
  assert.match(source, /handoff-stage:not\(:last-child\)::after[\s\S]*transform:scaleX\(0\)[\s\S]*transition:transform 1\.35s/);
  assert.match(source, /handoff-stage\[data-state="complete"\]::after\{\s*transform:scaleX\(1\)/);
  assert.match(source, /duration never gates the transfer pipeline/);
});
