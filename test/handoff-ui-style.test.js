const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.join(__dirname, "..", "extension", "platform-content.js"), "utf8");

function loadPureFunction(name, constants = {}) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} should exist`);
  const signatureEnd = source.indexOf(") {", start);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  let end = bodyStart;
  for (; end < source.length; end += 1) {
    if (source[end] === "{") depth += 1;
    if (source[end] === "}") depth -= 1;
    if (depth === 0) break;
  }
  const functionSource = source.slice(start, end + 1);
  const names = Object.keys(constants);
  return Function(...names, `return (${functionSource});`)(...names.map((name) => constants[name]));
}

test("handoff uses the sheet serif only for its live headline", () => {
  const overlayStart = source.indexOf("function ensureFloatingOverlay()");
  const overlayEnd = source.indexOf("function showOverlay(", overlayStart);
  const overlaySource = source.slice(overlayStart, overlayEnd);

  assert.match(source, /title\.style\.cssText = "font-family:Georgia,'Times New Roman',serif/);
  assert.match(overlaySource, /statusText\.style\.cssText = \[[\s\S]*"font-family:Georgia,'Times New Roman',serif"/);
  assert.equal((overlaySource.match(/font-family:Georgia,'Times New Roman',serif/g) || []).length, 1);
});

test("handoff connectors accept live fractional progress without gating pipeline state", () => {
  assert.match(source, /handoff-stage:not\(:last-child\)::before[\s\S]*background:rgba\(255,255,255,0\.11\)/);
  assert.match(source, /handoff-stage:not\(:last-child\)::after[\s\S]*transform:scaleX\(var\(--context-generator-stage-progress,0\)\)[\s\S]*transition:transform var\(--context-generator-stage-progress-duration,1\.35s\)/);
  assert.match(source, /reportHandoffCaptureProgress\(afterScrollState\)/);
  assert.match(source, /line follows live display progress; its motion never gates the transfer pipeline/);
});

test("capture connector progress follows real scraper distance and reserves completion for capture done", () => {
  const getCaptureProgress = loadPureFunction("getHandoffCaptureLineProgress", {
    HANDOFF_CAPTURE_LINE_MIN: 0.04,
    HANDOFF_CAPTURE_LINE_MAX: 0.94
  });

  assert.equal(getCaptureProgress({ scrollTop: 0, scrollRemaining: 1000 }), 0.04);
  assert.ok(Math.abs(getCaptureProgress({ scrollTop: 500, scrollRemaining: 500 }) - 0.49) < 0.0001);
  assert.equal(getCaptureProgress({ scrollTop: 1000, scrollRemaining: 0 }), 0.94);
});

test("summary connector creeps below completion while real events remain authoritative", () => {
  assert.match(source, /HANDOFF_ACTIVITY_LINE_START = 0\.05/);
  assert.match(source, /HANDOFF_ACTIVITY_LINE_MAX = 0\.9/);
  assert.match(source, /HANDOFF_ACTIVITY_LINE_DURATION_MS = 30000/);
  assert.match(source, /setHandoffStageLineProgress\(stageId, HANDOFF_ACTIVITY_LINE_MAX\)/);
  assert.match(source, /stage\.state === "complete"\s*\? 1/);
  assert.doesNotMatch(source.slice(
    source.indexOf("function ensureFloatingOverlay()"),
    source.indexOf("function startHandoffCountdown()")
  ), /setInterval/);
});
