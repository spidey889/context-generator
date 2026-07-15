const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "extension", "platform-content.js"), "utf8");

function getOverlaySource() {
  const start = source.indexOf("function ensureFloatingOverlay()");
  const end = source.indexOf("function showOverlay(", start);
  return source.slice(start, end);
}

test("handoff polish creates one clear header, headline, and progress hierarchy", () => {
  const overlaySource = getOverlaySource();

  assert.match(overlaySource, /"height:228px"/);
  assert.match(overlaySource, /"border-radius:24px"/);
  assert.match(overlaySource, /"justify-content:flex-start"/);
  assert.match(overlaySource, /"font-size:29px"[\s\S]*"font-family:Georgia,'Times New Roman',serif"/);
  assert.match(overlaySource, /"right:28px"[\s\S]*"top:23px"/);
  assert.doesNotMatch(overlaySource, /"bottom:20px"/);
});

test("handoff motion is restrained and remains driven by real status changes", () => {
  assert.match(source, /@keyframes contextGeneratorHeadlineIn/);
  assert.match(source, /statusText\.textContent !== currentStatus/);
  assert.match(source, /contextGeneratorHeadlineIn 340ms cubic-bezier/);
  assert.match(source, /transition:transform 1\.35s cubic-bezier/);
  assert.doesNotMatch(source, /contextGeneratorProgressPulse/);
  assert.match(source, /prefers-reduced-motion: reduce/);
});
