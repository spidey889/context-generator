// Installed Brave coverage for manual handoff, using synthetic text, a local
// summary endpoint, a disabled destination and mocked clipboard writes only.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { CdpSession, waitForProcessExit, findBraveExecutable, createSmokeExtension, readDevToolsPort,
  getTargets, waitFor } = require("./run-extension-smoke");

const SUMMARY = "CONTEXT CARRY — READY TO PASTE\n\nWHAT WE WERE DOING\nTesting a manual handoff.\n\nWHERE WE LEFT OFF\nThe complete summary is ready.\n\nKEY CONTEXT\nKeep all this text.\n\nNEXT STEP\nContinue after the user pastes it.";

async function run() {
  let destinations = 0, summaryRequests = 0;
  const telemetryRequests = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST") {
      const chunks = [];
      for await (const chunk of req) if (url.pathname === "/api/telemetry") chunks.push(chunk);
      if (url.pathname === "/api/telemetry") {
        telemetryRequests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        res.writeHead(204); res.end(); return;
      }
      summaryRequests++;
      res.setHeader("Content-Type", "application/json");
      setTimeout(() => res.end(JSON.stringify({ summary: SUMMARY })), 250);
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Security-Policy", "script-src 'nonce-handoff'; object-src 'none'; base-uri 'none'");
    if (url.pathname !== "/destination") {
      res.end('<html><title>Handoff copy fixture</title><body><h1>Handoff copy fixture</h1><textarea id="prompt-textarea" placeholder="Message"></textarea></body></html>');
      return;
    }
    destinations++;
    res.end('<html><title>Waiting destination fixture</title><body><form><textarea id="prompt-textarea" placeholder="Message" disabled></textarea><button type="button" id="send">Send</button></form><script nonce="handoff">window.sendClicks=0;document.getElementById("send").onclick=()=>window.sendClicks++;</script></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cap-handoff-copy-")), profile = path.join(temp, "profile");
  let child, source;
  const destinationSessions = [];
  try {
    const extension = await createSmokeExtension(temp, origin);
    const contentPath = path.join(extension, "platform-content.js");
    const content = await fs.readFile(contentPath, "utf8");
    const probe = `
  window.__handoffStart = (scenario) => {
    window.__handoffScenario = scenario;
    window.__handoffCopied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: text => {
      if (scenario.startsWith('clipboard-failure')) return Promise.reject(new Error('Synthetic clipboard denial'));
      window.__handoffCopied.push(text); return Promise.resolve();
    } } });
    const text = scenario.startsWith('clipboard-failure') ? 'User: Preserve this exact short conversation.' : 'Verified synthetic conversation. '.repeat(400);
    const trace = beginTransferAttempt('chatgpt', 'test');
    window.__handoffTrace = trace;
    window.__handoffExpected = text.length < MIN_BACKEND_CONVERSATION_CHARS ? createLocalContextCarry(text).summary : ${JSON.stringify(SUMMARY)};
    showOverlay('chatgpt'); markCaptureDone(trace, text);
    window.__handoffWork = runContextFlow('chatgpt', null, text, trace);
    return true;
  };
`;
    assert.ok(content.includes("  function checkInlinePlacementPathname() {"));
    let installed = content.replace("  function checkInlinePlacementPathname() {", probe + "  function checkInlinePlacementPathname() {");
    installed = installed.replace("  function startPasteHandoff(trace, text) {", `  function startPasteHandoff(trace, text) {
    if (window.__handoffScenario === 'timeout') trace.deadlineAt = Date.now() + 2500;`);
    // A lost delivery reply must still reach the source's own timeout recovery.
    installed = installed.replace("  async function notifyBackground(message) {", `  async function notifyBackground(message) {
    if (['timeout', 'clipboard-failure-after-insert'].includes(window.__handoffScenario) && message.type === 'TRANSFER_TO_DESTINATION') {
      extensionRuntime.sendMessage(message).catch(() => {}); return new Promise(() => {});
    }
    if (window.__handoffScenario === 'stop-unconfirmed' && message.type === 'CANCEL_TRANSFER' && message.preserveDestination) {
      await extensionRuntime.sendMessage(message); throw new Error('Synthetic lost cancellation reply');
    }`);
    await fs.writeFile(contentPath, installed);
    const url = `${origin}/source?__cap_context_smoke_platform=chatgpt`;
    child = spawn(findBraveExecutable(), [`--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`, "--remote-debugging-port=0", "--remote-allow-origins=*", "--no-first-run",
      "--no-default-browser-check", "--disable-component-update", "--disable-background-networking", "--new-window", url], { stdio: "ignore" });
    const port = await readDevToolsPort(profile);
    const target = await waitFor(async () => (await getTargets(port)).find(t => t.type === "page" && t.url === url), "handoff source");
    source = await CdpSession.connect(target.webSocketDebuggerUrl); await source.call("Runtime.enable");
    const context = await waitFor(() => source.getExtensionContextId(), "installed source extension");
    await waitFor(() => source.evaluate("typeof window.__handoffStart === 'function'", context), "handoff test probe");
    for (const scenario of ["copy", "clipboard-failure", "clipboard-failure-after-insert", "stop-unconfirmed", "timeout", "success"]) {
      await source.call("Page.bringToFront");
      await source.evaluate("document.getElementById('context-generator-fallback-dismiss')?.click()");
      const before = destinations;
      const summariesBefore = summaryRequests;
      const telemetryBefore = telemetryRequests.length;
      await source.evaluate(`window.__handoffStart(${JSON.stringify(scenario)})`, context);
      if (scenario === "copy") assert.equal(await source.evaluate("document.getElementById('context-generator-handoff-copy').style.display"), "none", "Copy must stay unavailable during the pending summary.");
      await waitFor(() => source.evaluate("document.getElementById('context-generator-handoff-copy')?.style.display === 'inline-flex'"), "ready handoff copy action");
      const destinationTarget = await waitFor(async () => (await getTargets(port)).find(t => t.type === "page" && t.url.startsWith(origin + "/destination") && !destinationSessions.some(s => s.id === t.id)), "prepared destination");
      const destination = await CdpSession.connect(destinationTarget.webSocketDebuggerUrl);
      destinationSessions.push({ id: destinationTarget.id, session: destination });
      await destination.call("Runtime.enable");
      const expected = await source.evaluate("window.__handoffExpected", context);
      // Let the worker finish its one activation before returning to source;
      // otherwise it can switch tabs between our observation and native click.
      if (scenario !== "timeout") await waitFor(() => destination.evaluate("Boolean(document.getElementById('context-generator-destination-status'))"), "destination paste attempt");
      if (scenario === "clipboard-failure-after-insert") {
        await destination.evaluate("document.getElementById('prompt-textarea').disabled=false");
        await waitFor(() => destination.evaluate("document.getElementById('prompt-textarea').value").then(value => value === expected), "paste before the manual-copy click");
      }
      await source.call("Page.bringToFront");
      if (scenario === "copy") {
        for (const width of [760, 320]) {
          await source.call("Emulation.setDeviceMetricsOverride", { width, height: 740, deviceScaleFactor: 1, mobile: false });
          const bounds = () => source.evaluate(`(() => { const b=document.getElementById('context-generator-handoff-copy'), r=b.getBoundingClientRect(); return {left:r.left,right:r.right,height:r.height,width:innerWidth,disabled:b.disabled,minHeight:parseFloat(getComputedStyle(b).minHeight)}; })()`);
          try {
            // The existing card scales descendants slightly; check CSS size as
            // well as the rendered target instead of assuming an unscaled 32px.
            await waitFor(async () => { const b=await bounds(); return b.left>=0 && b.right<=b.width && b.height>=30 && b.minHeight>=32 && !b.disabled; }, "copy action within the settled narrow card", 3000);
          } catch (error) {
            error.message += ` ${JSON.stringify(await bounds())}`;
            if (process.env.CAP_CONTEXT_HANDOFF_SCREENSHOT) {
              const shot = await source.call("Page.captureScreenshot", { format: "png" });
              await fs.writeFile(path.resolve(process.env.CAP_CONTEXT_HANDOFF_SCREENSHOT), Buffer.from(shot.data, "base64"));
            }
            throw error;
          }
        }
        if (process.env.CAP_CONTEXT_HANDOFF_SCREENSHOT) {
          const shot = await source.call("Page.captureScreenshot", { format: "png" });
          await fs.writeFile(path.resolve(process.env.CAP_CONTEXT_HANDOFF_SCREENSHOT), Buffer.from(shot.data, "base64"));
        }
        // Optional short inspection keeps this disposable window available to Computer Use.
        const inspectMs = Math.min(30000, Number(process.env.CAP_CONTEXT_HANDOFF_INSPECT_MS || 0));
        if (inspectMs) { console.log("Inspect the disposable Handoff copy fixture window."); await new Promise(resolve => setTimeout(resolve, inspectMs)); }
        await source.call("Emulation.clearDeviceMetricsOverride");
      }
      if (["copy", "clipboard-failure", "clipboard-failure-after-insert", "stop-unconfirmed"].includes(scenario)) {
        // Invoke the native button with a browser user gesture. Clipboard is
        // mocked; this fixture must not take OS focus away from the owner's apps.
        const clicked = await source.call("Runtime.evaluate", { expression: "document.getElementById('context-generator-handoff-copy').click()", contextId: context, userGesture: true, returnByValue: true });
        assert.equal(clicked.exceptionDetails, undefined);
        try {
          await waitFor(() => source.evaluate("window.__handoffTrace.completed", context), "manual takeover completion", 7000);
        } catch (error) {
          error.message += ` ${JSON.stringify(await source.evaluate("({cancelled:window.__handoffTrace.cancelled,manual:window.__handoffTrace.manualCopy,completed:window.__handoffTrace.completed,copies:window.__handoffCopied.length,button:document.getElementById('context-generator-handoff-copy').textContent})", context))}`;
          throw error;
        }
        if (scenario === "copy") {
          assert.deepEqual(await source.evaluate("window.__handoffCopied", context), [expected]);
          assert.equal(await source.evaluate("document.getElementById('context-generator-fallback-modal')?.style.display === 'flex'"), false, "Successful copying needs no extra copy box.");
          assert.match(await source.evaluate("document.getElementById('context-generator-destination-status').textContent"), /copied.*stopped/);
        } else {
          assert.equal(await source.evaluate("document.getElementById('context-generator-fallback-text').value"), expected, "Clipboard failure preserves the full carry in the existing box.");
          if (scenario === "stop-unconfirmed") {
            assert.deepEqual(await source.evaluate("window.__handoffCopied", context), [expected]);
            assert.match(await source.evaluate("document.getElementById('context-generator-fallback-title').textContent"), /check.*destination/i);
          }
          if (scenario === "clipboard-failure-after-insert") {
            assert.equal(await destination.evaluate("document.getElementById('prompt-textarea').value"), expected, "Manual takeover preserves an already-landed paste.");
            assert.match(await source.evaluate("document.getElementById('context-generator-fallback-title').textContent"), /check.*destination/i,
              "Cancelling future writes cannot prove the earlier paste did not land.");
          }
        }
      } else if (scenario === "timeout") {
        await waitFor(() => source.evaluate("window.__handoffTrace.expired", context), "bounded paste timeout");
        assert.equal(await source.evaluate("document.getElementById('context-generator-fallback-text').value"), expected);
        assert.match(await source.evaluate("document.getElementById('context-generator-fallback-modal').textContent"), /check.*destination/i);
      } else {
        await destination.evaluate("document.getElementById('prompt-textarea').disabled=false");
        await source.evaluate("window.__handoffWork", context);
        assert.equal(await destination.evaluate("document.getElementById('prompt-textarea').value"), expected);
        assert.equal(await source.evaluate("document.getElementById('context-generator-fallback-text').value"), expected, "Normal completion keeps its original backup box.");
      }
      assert.equal(await source.evaluate("document.getElementById('context-generator-handoff-copy').style.display"), "none");
      if (scenario !== "success") {
        await destination.evaluate("document.getElementById('prompt-textarea').disabled=false; document.getElementById('prompt-textarea').value='User takes over manually';");
        await new Promise(resolve => setTimeout(resolve, 1200));
        assert.equal(await destination.evaluate("document.getElementById('prompt-textarea').value"), "User takes over manually", "No delayed insert or recovery can overwrite manual input.");
      }
      assert.equal(await destination.evaluate("window.sendClicks"), 0);
      assert.equal(destinations, before + 1, "No second destination or retry after manual takeover.");
      if (scenario.startsWith("clipboard-failure")) assert.equal(summaryRequests, summariesBefore, "A local carry never requests a summary.");
      if (["copy", "clipboard-failure", "clipboard-failure-after-insert", "stop-unconfirmed"].includes(scenario)) {
        const expectedEvent = scenario.startsWith("clipboard-failure") ? "copy_failed" : "copy_succeeded";
        const report = await waitFor(() => telemetryRequests.slice(telemetryBefore).findLast(payload =>
          payload.diagnostics?.recovery_events?.some(entry => entry.event === expectedEvent && entry.surface === "handoff_copy")),
        "the independent manual-copy recovery report");
        const observed = report.diagnostics.recovery_events.find(entry => entry.event === expectedEvent && entry.surface === "handoff_copy");
        assert.equal(observed.side, "source");
        assert.equal(observed.method, "clipboard");
        if (scenario === "copy") assert.equal(observed.stop_confirmed, true);
        if (scenario === "stop-unconfirmed") assert.equal(observed.stop_confirmed, undefined);
        assert.doesNotMatch(JSON.stringify(report.diagnostics), /Verified synthetic conversation|Testing a manual handoff|Preserve this exact short conversation/);
      }
      console.log(`PASS handoff ${scenario}: complete text, preserved destination, no late paste, no Send.`);
    }
    assert.equal(summaryRequests, 1, "The existing summary cache is reused by later attempts.");
  } finally {
    if (source) { try { await source.call("Browser.close", {}, 5000); } catch {} }
    source?.close(); destinationSessions.forEach(({ session }) => session.close()); child?.kill();
    if (child) await waitForProcessExit(child, 5000);
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe smoke cleanup path.");
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
