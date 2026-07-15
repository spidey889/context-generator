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
  const countdownStart = overlaySource.indexOf("const countdown =");
  const countdownEnd = overlaySource.indexOf("overlay.appendChild(glow)", countdownStart);
  const countdownSource = overlaySource.slice(countdownStart, countdownEnd);

  assert.match(overlaySource, /"height:228px"/);
  assert.match(overlaySource, /"border-radius:24px"/);
  assert.match(overlaySource, /"background:#151517"/);
  assert.match(overlaySource, /background:#8D6CCF/);
  assert.match(overlaySource, /linear-gradient\(90deg,#6F579D,#9A7ADC\)/);
  assert.match(overlaySource, /HANDOFF_SCRIM_ID[\s\S]*pointer-events:none[\s\S]*background:rgba\(0,0,0,0\.09\)/);
  assert.match(overlaySource, /context-generator-handoff-stage-progress-head/);
  assert.match(overlaySource, /width:4px/);
  assert.match(overlaySource, /contextGeneratorSummaryDotHop/);
  assert.match(overlaySource, /context-generator-summary-activity-dot/);
  assert.match(overlaySource, /dot\.textContent = "\."/);
  assert.match(overlaySource, /color:#f2f0f6/);
  assert.match(overlaySource, /contextGeneratorSummaryDotHop 1800ms/);
  assert.match(overlaySource, /animation-delay:220ms/);
  assert.match(overlaySource, /animation-delay:440ms/);
  assert.doesNotMatch(overlaySource, /#F0D7FF|#DDB5F5|#FFFFEB|#050505|#7459d6|rgba\((?:126,94,228|151,125,244)/);
  assert.match(overlaySource, /"justify-content:flex-start"/);
  assert.match(overlaySource, /"font-size:29px"[\s\S]*"font-family:Georgia,'Times New Roman',serif"/);
  assert.match(countdownSource, /"margin-left:auto"/);
  assert.match(countdownSource, /brand\.appendChild\(countdown\)/);
  assert.doesNotMatch(countdownSource, /"position:absolute"|"right:28px"|"top:23px"/);
  assert.doesNotMatch(overlaySource, /"bottom:20px"/);
});

test("handoff motion is restrained and remains driven by real status changes", () => {
  assert.match(source, /@keyframes contextGeneratorHeadlineIn/);
  assert.match(source, /statusText\.textContent !== currentStatus/);
  assert.match(source, /contextGeneratorHeadlineIn 340ms cubic-bezier/);
  assert.match(source, /transition:width var\(--context-generator-stage-progress-duration,1\.35s\)/);
  assert.match(source, /startHandoffActivityProgress\(stageId\)/);
  assert.match(source, /summaryActivity\.dataset\.active = String\(stageId === "summary" && phase === "active"\)/);
  assert.doesNotMatch(source, /contextGeneratorProgressPulse/);
  assert.match(source, /prefers-reduced-motion: reduce/);
});
