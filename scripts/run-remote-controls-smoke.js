// Installed worker/content scripts in a private Brave profile. Only the poll
// interval is shortened in its disposable copy; all settings are synthetic.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { defaults, STORAGE_KEY, ALARM } = require("../extension/remote-controls");
const { CdpSession, findBraveExecutable, createSmokeExtension, readDevToolsPort, getTargets, waitFor,
  waitForProcessExit, providerPlacementFixture } = require("./run-extension-smoke");

async function run() {
  let config = defaults(), unavailable = false, checks = 0;
  const sourceText = "Remember the emergency test decision: keep the exact synthetic context available for manual copying.";
  const server = http.createServer((req, res) => {
    if (req.url === "/extension-controls.json") {
      checks++;
      res.writeHead(unavailable ? 503 : 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(config)); return;
    }
    if (req.url === "/api/user-notices") { req.resume(); res.writeHead(200, { "Content-Type": "application/json" }).end('{"notice":null}'); return; }
    if (req.method === "POST") { req.resume(); res.writeHead(204).end(); return; }
    const source = req.url.startsWith("/a/chat/s/");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (source) {
      res.end(providerPlacementFixture("deepseek").replace("deepseek inline smoke", "Cap Context emergency controls test")
        .replace("<body>", `<body><main style="padding:40px"><h1>Emergency controls test</h1><p>Isolated Brave fixture; synthetic context only.</p>
          <div data-message-author-role="user">${sourceText}</div><div data-message-author-role="assistant">The agreed decision is preserved in full.</div></main>`));
      return;
    }
    res.end(`<html><title>Cap Context emergency controls test</title><body style="background:#262624;color:#eee;font:16px Arial;padding:60px">
      <h1>Emergency controls test</h1><p>Isolated Brave fixture; synthetic context only.</p>
      ${source ? `<div data-message-author-role="user">${sourceText}</div><div data-message-author-role="assistant">The agreed decision is preserved in full.</div>` : ""}
      <textarea placeholder="${source ? "Message DeepSeek" : "Reply to Claude"}" style="margin-top:160px;width:65%;height:80px"></textarea></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cap-emergency-controls-"));
  let child, page, worker;
  try {
    const extension = await createSmokeExtension(temp, origin);
    const controlsPath = path.join(extension, "remote-controls.js");
    const controlsSource = await fs.readFile(controlsPath, "utf8");
    assert.ok(controlsSource.includes("const INTERVAL_MS = 60000;"));
    await fs.writeFile(controlsPath, controlsSource.replace("const INTERVAL_MS = 60000;", "const INTERVAL_MS = 50;"));
    const profile = path.join(temp, "profile");
    child = spawn(findBraveExecutable(), [`--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`, "--remote-debugging-port=0", "--remote-allow-origins=*", "--no-first-run",
      "--no-default-browser-check", "--disable-background-networking", "--new-window", "about:blank"], { stdio: "ignore" });
    const port = await readDevToolsPort(profile);
    const workerTarget = await waitFor(async () => (await getTargets(port)).find(t => t.type === "service_worker"), "controls worker");
    worker = await CdpSession.connect(workerTarget.webSocketDebuggerUrl); await worker.call("Runtime.enable");
    const target = await waitFor(async () => (await getTargets(port)).find(t => t.type === "page"), "controls page");
    page = await CdpSession.connect(target.webSocketDebuggerUrl); await page.call("Runtime.enable");
    await page.call("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.call("Page.navigate", { url: `${origin}/a/chat/s/emergency?__cap_context_smoke_platform=deepseek` });
    const context = await waitFor(() => page.getExtensionContextId(), "controls content world");
    const orbVisible = () => page.evaluate('!!document.getElementById("context-generator-bubble")?.getBoundingClientRect().width', context);
    await waitFor(orbVisible, "initial orb");
    const readStored = () => worker.evaluate(`chrome.storage.local.get(${JSON.stringify(STORAGE_KEY)}).then(s=>s[${JSON.stringify(STORAGE_KEY)}])`);
    async function update(next) {
      config = next;
      const previous = checks;
      const before = await readStored();
      await worker.evaluate(`chrome.alarms.create(${JSON.stringify(ALARM)}, {when: Date.now()+150})`);
      await waitFor(async () => checks > previous && (await readStored())?.checkedAt !== before?.checkedAt, "alarm refresh and durable settings");
    }
    await update({ version: 1, disabled: { inlineOrb: ["deepseek"] } });
    await waitFor(async () => !await orbVisible(), "orb removed in the existing page");
    assert.equal(await page.evaluate('!!document.querySelector("textarea")'), true);
    await update(defaults());
    await waitFor(orbVisible, "orb restored without reload");
    console.log("PASS remote alarm updates remove and restore the orb in an already open chat.");

    await update({ version: 1, disabled: { transfers: ["deepseek"] } });
    await waitFor(async () => !await orbVisible(), "transfer stop hides orb");
    const response = await page.evaluate('chrome.runtime.sendMessage({type:"PREPARE_DESTINATION", destination:"claude"})', context);
    assert.equal(response.code, "feature_disabled");
    assert.equal((await getTargets(port)).filter(t => t.type === "page").length, 1, "No destination opens while stopped.");
    unavailable = true;
    await update(defaults());
    assert.deepEqual((await readStored()).config.disabled.transfers, ["deepseek"]);
    assert.equal(await orbVisible(), false);
    unavailable = false;
    await update({ version: 99, disabled: {} });
    assert.deepEqual((await readStored()).config.disabled.transfers, ["deepseek"]);
    console.log("PASS transfer shutdown blocks tab creation; outage and invalid data preserve the stop.");

    await update({ version: 1, disabled: { automaticPaste: ["*"], jsonCapture: ["deepseek"] } });
    await waitFor(orbVisible, "orb after transfer restart");
    await page.evaluate('window.__capSmokeStartDomTransfer()', context);
    await waitFor(() => page.evaluate(`document.getElementById("context-generator-fallback-text")?.value.includes(${JSON.stringify(sourceText)})`, context), "complete manual-copy context");
    assert.match(await page.evaluate('document.getElementById("context-generator-fallback-desc")?.textContent', context), /temporarily paused/);
    const destination = await waitFor(async () => (await getTargets(port)).find(t => t.type === "page" && t.url.includes("/destination")), "prepared destination");
    const destinationPage = await CdpSession.connect(destination.webSocketDebuggerUrl);
    try { assert.equal(await destinationPage.evaluate('document.querySelector("textarea")?.value || ""'), ""); }
    finally { destinationPage.close(); }
    const state = await page.evaluate('window.__capSmokeDomState()', context);
    assert.equal(state, null, "Manual recovery releases the running transfer.");
    console.log("PASS actual capture-to-copy flow preserves the full context and leaves the destination empty when automatic paste is stopped.");
    const holdMs = Math.min(30000, Math.max(0, Number(process.env.CAP_CONTEXT_CONTROL_INSPECT_MS) || 0));
    if (holdMs) { console.log("UI_READY for inspection of the isolated manual-copy page."); await new Promise(resolve => setTimeout(resolve, holdMs)); }
    assert.ok(checks >= 6);
  } catch (error) {
    console.error({ checks, exceptions: page?.events.filter(event => event.method === "Runtime.exceptionThrown")
      .map(event => event.params?.exceptionDetails?.exception?.description || event.params?.exceptionDetails?.text) });
    throw error;
  } finally {
    if (page) { try { await page.call("Browser.close", {}, 5000); } catch {} }
    page?.close(); worker?.close(); child?.kill(); if (child) await waitForProcessExit(child, 5000);
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe smoke cleanup path.");
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
