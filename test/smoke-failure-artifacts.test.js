const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { saveSmokeFailure } = require("../scripts/smoke-failure-artifacts");

test("smoke failures retain screenshots and bounded console diagnostics when another page disconnects", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cap-smoke-failure-"));
  const bytes = Buffer.from("fixture screenshot bytes");
  const error = new Error("original assertion");
  try {
    await saveSmokeFailure(directory, error, {
      source: {
        getRecentEvents: () => [{ method: "Network.requestWillBeSent" },
          ...Array.from({ length: 25 }, (_, index) => ({ method: "Runtime.exceptionThrown", index }))],
        call: async (method, params, timeoutMs) => {
          assert.equal(method, "Page.captureScreenshot");
          assert.deepEqual(params, { format: "png" });
          assert.equal(timeoutMs, 5000);
          return { data: bytes.toString("base64") };
        }
      },
      closed: { call: async () => { throw new Error("page disconnected"); } },
      absent: null
    }, "browser stderr", "chatgpt-fallback");
    const report = JSON.parse(await fs.readFile(path.join(directory, "chatgpt-fallback.json"), "utf8"));
    assert.match(report.error, /original assertion/);
    assert.equal(report.browserOutput, "browser stderr");
    assert.equal(report.pages.source.events.length, 20);
    assert.equal(report.pages.source.events[0].index, 5);
    assert.equal(report.pages.closed.screenshotError, "page disconnected");
    assert.deepEqual(await fs.readFile(path.join(directory, report.pages.source.screenshot)), bytes);
    assert.equal(error.message, "original assertion");
    await assert.doesNotReject(saveSmokeFailure(path.join(directory, report.pages.source.screenshot), error, {}));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
