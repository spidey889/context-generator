// Uses only disposable profiles, fixture pages and a stub backend. Never loads
// real AI sites or changes the upload folder. web-ext run installs a directory;
// this check does not create a ZIP or require a Mozilla account.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
process.env.CAP_CONTEXT_JSON_SMOKE = "chatgpt";
process.env.CAP_CONTEXT_LIVE_TELEMETRY_SMOKE = "0";
process.env.CAP_CONTEXT_TELEMETRY_SMOKE = "0";
const { createSmokeExtension, startFixtureServer, expectedChatGptConversation, SUMMARY_TEXT } = require("./run-extension-smoke");
const { prepareFirefoxExtension } = require("./prepare-firefox-extension");

async function browserChecks(config) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const inTab = async (tabId, func, args = [], world = "ISOLATED") => {
    const results = await chrome.scripting.executeScript({ target: { tabId }, world, func, args });
    if (results[0]?.error) throw new Error(results[0].error.message);
    return results[0]?.result;
  };
  const until = async (probe, label) => {
    const deadline = Date.now() + 60000;
    let lastError;
    while (Date.now() < deadline) {
      // tabs.create returns before navigation commits; about:blank is outside
      // the fixture host permission until the requested page has loaded.
      try { const value = await probe(); if (value) return value; }
      catch (error) { lastError = error.message; }
      await sleep(150);
    }
    throw new Error(`Timed out: ${label}${lastError ? ` (${lastError})` : ""}`);
  };
  const passed = [];
  const note = async stage => { passed.push(stage); await fetch(config.reportUrl, { method: "POST", body: JSON.stringify({ stage }) }); };
  try {
    // Test the browser's actual optional-data API, not a user-agent heuristic.
    await chrome.permissions.remove({ data_collection: ["technicalAndInteraction"] });
    check(!await hasTelemetryConsent(), "Declined Firefox diagnostics must be respected");
    await note("native optional-data permission API");
    const source = await chrome.tabs.create({ url: config.sourceUrl, active: true });
    await until(() => inTab(source.id, () => typeof window.__capSmokePickerJsonReady === "function"), "source injection");
    await handleToolbarClick(await chrome.tabs.get(source.id));
    await until(() => inTab(source.id, () => {
      const sheet = document.getElementById("context-generator-destination-sheet");
      return sheet && getComputedStyle(sheet).display !== "none";
    }), "toolbar picker");
    const style = await inTab(source.id, () => ({ sheets: document.adoptedStyleSheets.length,
      border: getComputedStyle(document.getElementById("context-generator-destination-sheet")).borderTopWidth,
      cssConstructor: typeof CSSStyleSheet, ua: navigator.userAgent }));
    // Firefox rounds CSS borders to device pixels at Windows display scaling.
    check(style.sheets > 0 && parseFloat(style.border) > 0, `Picker must adopt its stylesheet in Firefox: ${JSON.stringify(style)}`);
    await note("toolbar, picker and constructed stylesheets");
    await Promise.race([inTab(source.id, () => window.__capSmokePickerJsonReady()), sleep(50000).then(() => { throw new Error("JSON capture did not settle"); })]);
    await inTab(source.id, () => document.querySelector('button[aria-label="Continue in Claude"]').click());
    const destination = await until(async () => (await chrome.tabs.query({})).find(tab => tab.url === config.destinationUrl), "prepared destination");
    await until(() => inTab(destination.id, expected => document.querySelector("textarea")?.value === expected, [config.summary]), "complete transfer paste");
    check(await inTab(destination.id, () => window.__capContextSmokeSendClicks, [], "MAIN") === 0, "Transfer must not click Send");
    const receipt = await until(async () => {
      const value = (await chrome.storage.local.get("context-generator-last-transfer-stats-v1"))["context-generator-last-transfer-stats-v1"];
      return value?.rawScrapedText ? value : null;
    }, "Latest Run receipt");
    check(receipt.rawScrapedText === config.conversation, "MAIN-world JSON capture must preserve the exact original text");
    await note("MAIN-world JSON capture, summary, cross-tab paste, no Send and Latest Run");
    const queue = (await chrome.storage.local.get("context-generator-telemetry-outbox-v1"))["context-generator-telemetry-outbox-v1"];
    check(!queue?.length, "Opted-out transfers must not queue diagnostics");
    await fetch(config.reportUrl, { method: "POST", body: JSON.stringify({ ok: true, passed }) });
  } catch (error) {
    await fetch(config.reportUrl, { method: "POST", body: JSON.stringify({ ok: false, passed, error: error.message }) });
  }
}

async function run() {
  const webExt = process.env.WEB_EXT_BIN || (process.env.PATH || "").split(path.delimiter)
    .map(entry => path.resolve(entry, "../web-ext/bin/web-ext.js")).find(file => fs.existsSync(file));
  assert.ok(webExt && fs.existsSync(webExt), "Run through npm exec --package=web-ext -- node scripts/run-firefox-smoke.js, or set WEB_EXT_BIN.");
  const fixture = await startFixtureServer();
  fixture.state.releasePickerLoad();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cap-context-firefox-smoke-"));
  let child, output = "", timer, resolveReport;
  const report = new Promise(resolve => { resolveReport = resolve; });
  const reporter = http.createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    try { const result = JSON.parse(body); if (result.stage) console.log(`PASS ${result.stage}`); else resolveReport(result); }
    catch { resolveReport({ ok: false, error: "Invalid test report" }); }
    response.writeHead(204); response.end();
  });
  try {
    await new Promise(resolve => reporter.listen(0, "127.0.0.1", resolve));
    await createSmokeExtension(tempRoot, fixture.origin);
    // Reuse production Gecko settings while retaining fixture-only URL wiring.
    const production = JSON.parse(fs.readFileSync(path.join(prepareFirefoxExtension(), "manifest.json"), "utf8"));
    const folder = path.join(tempRoot, "extension"), manifestPath = path.join(folder, "manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.background = { scripts: [...production.background.scripts, "firefox-smoke.js"] };
    manifest.browser_specific_settings = production.browser_specific_settings;
    manifest.incognito = production.incognito;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const config = { origin: fixture.origin, sourceUrl: `${fixture.origin}/c/smoke?__cap_context_smoke_platform=chatgpt`,
      destinationUrl: `${fixture.origin}/destination?__cap_context_smoke_platform=claude`,
      reportUrl: `http://127.0.0.1:${reporter.address().port}/`, summary: SUMMARY_TEXT, conversation: expectedChatGptConversation() };
    fs.writeFileSync(path.join(folder, "firefox-smoke.js"), `(${browserChecks.toString()})(${JSON.stringify(config)});`);
    child = spawn(process.execPath, [webExt, "run", "--source-dir", folder, "--no-config-discovery", "--no-reload", "--no-input",
      "--firefox", process.env.FIREFOX_PATH || "C:/Program Files/Mozilla Firefox/firefox.exe", "--start-url", "about:blank",
      "--pref=extensions.webextensions.background.idle.timeout=300000"], { windowsHide: true });
    child.stdout.on("data", chunk => { output = (output + chunk).slice(-4000); });
    child.stderr.on("data", chunk => { output = (output + chunk).slice(-4000); });
    child.on("error", error => resolveReport({ ok: false, error: error.message }));
    child.on("exit", code => { if (code) resolveReport({ ok: false, error: `web-ext exited ${code}` }); });
    const result = await Promise.race([report, new Promise(resolve => {
      timer = setTimeout(() => resolve({ ok: false, error: "Firefox smoke exceeded 180 seconds" }), 180000);
    })]);
    assert.ok(result.ok, `${JSON.stringify(result)}\n${output}`);
    assert.equal(fixture.state.summaryRequests.length, 1);
    assert.equal(fixture.state.summaryRequests[0].telemetry, undefined);
    assert.equal(fixture.state.telemetryRequests.length, 0);
    assert.ok(fixture.state.jsonRequests > 0);
    console.log(JSON.stringify({ ...result, summaryRequests: 1, telemetryRequests: 0, jsonRequests: fixture.state.jsonRequests }, null, 2));
  } finally {
    clearTimeout(timer);
    // web-ext owns the disposable Firefox instance and closes it on SIGINT.
    if (child && child.exitCode === null) { child.kill("SIGINT"); await new Promise(resolve => child.once("exit", resolve)); }
    reporter.closeAllConnections(); reporter.close();
    fixture.server.closeAllConnections(); fixture.server.close();
    await fixture.telemetryFixture.close?.();
    // Windows may keep a font or extension handle briefly after Firefox exits.
    // Cleanup must not hide the original assertion or invalidate a clean run.
    try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 }); }
    catch { console.warn(`Disposable Firefox files still held open: ${tempRoot}`); }
  }
}

if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
