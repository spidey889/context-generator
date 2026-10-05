const fs = require("node:fs/promises");
const path = require("node:path");

// Failure diagnostics are best effort. A disconnected page or unwritable
// artifact directory must never replace the original assertion failure.
async function saveSmokeFailure(directory, error, sessions, browserOutput = "", label = "failure") {
  if (!directory) return;
  try {
    await fs.mkdir(directory, { recursive: true });
    const prefix = label.replace(/[^a-z0-9-]/gi, "-");
    const report = { error: error.stack || String(error), message: error.message,
      browserOutput: browserOutput.slice(-20000), pages: {} };
    await Promise.all(Object.entries(sessions).filter(([, session]) => session).map(async ([name, session]) => {
      const page = report.pages[name] = {};
      try {
        page.events = (session.getRecentEvents?.() || []).filter(event =>
          ["Runtime.exceptionThrown", "Runtime.consoleAPICalled", "Log.entryAdded"].includes(event.method)).slice(-20);
      } catch (error) { page.eventsError = error.message; }
      try {
        // Bound diagnostics independently of the longer smoke assertion limit.
        const capture = await session.call("Page.captureScreenshot", { format: "png" }, 5000);
        const filename = `${prefix}-${name.replace(/[^a-z0-9-]/gi, "-")}.png`;
        await fs.writeFile(path.join(directory, filename), Buffer.from(capture.data, "base64"));
        page.screenshot = filename;
      } catch (error) { page.screenshotError = error.message; }
    }));
    await fs.writeFile(path.join(directory, `${prefix}.json`), JSON.stringify(report, null, 2) + "\n");
  } catch { /* Preserve the original smoke failure even if artifact storage fails. */ }
}

module.exports = { saveSmokeFailure };
