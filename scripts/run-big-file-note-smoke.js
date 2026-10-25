// Synthetic source + installed extension + real Brave messaging/paste. No model,
// original file body, live telemetry, user profile or automatic upload is used.
process.env.CAP_CONTEXT_JSON_SMOKE = "deepseek";
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { fixtures } = require("../test/network-json-fixtures");
const { CdpSession, waitForProcessExit, findBraveExecutable, createSmokeExtension, readDevToolsPort,
  getTargets, waitFor } = require("./run-extension-smoke");
const greeting = 'Reply only: "Context loaded. Let\'s pick up right where you left off." Then wait for the user.';

async function run() {
  const fixture = fixtures("deepseek", "smoke", 1);
  fixture.file.file_name = "original-13mb.txt";
  fixture.file.file_size = 13099028;
  const reports = [], summaries = [];
  let fileReads = 0, destinations = 0;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST") {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks));
      if (url.pathname === "/api/telemetry") { reports.push(payload); res.writeHead(204); res.end(); return; }
      summaries.push(payload);
      res.setHeader("Content-Type", "application/json");
      // Deliberately omit the file notice: the client must restore it after AI.
      res.end(JSON.stringify({ summary: `Verified chat context.\n\nNext step:\n\n${greeting}` })); return;
    }
    if (url.pathname.includes("history_messages")) {
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(fixture.data)); return;
    }
    if (url.pathname.startsWith("/api/file")) { fileReads++; res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (url.pathname !== "/destination") {
      res.end(`<html><body><main><textarea placeholder="Message DeepSeek"></textarea></main><script>
        localStorage.setItem('userToken',JSON.stringify({value:'SYNTHETIC_TOKEN'}));
      </script></body></html>`); return;
    }
    destinations++;
    res.end(`<html><body style="font:16px system-ui;margin:30px"><main><h1>ChatGPT transfer fixture</h1>
      <form><textarea id="prompt-textarea" aria-label="Ask ChatGPT" style="width:90vw;height:60vh"></textarea>
      <button type="button" id="send">Send</button></form></main><script>
      window.sendClicks=0;document.getElementById('send').onclick=()=>window.sendClicks++;
      </script></body></html>`);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cap-big-file-note-")), profile = path.join(temp, "profile");
  let child, source, destination;
  try {
    const extension = await createSmokeExtension(temp, origin);
    const contentPath = path.join(extension, "platform-content.js");
    const content = await fs.readFile(contentPath, "utf8");
    await fs.writeFile(contentPath, content.replace('startDestinationTransfer("claude"); return true;', 'startDestinationTransfer("chatgpt"); return true;'));
    const url = `${origin}/a/chat/s/smoke?__cap_context_smoke_platform=deepseek`;
    child = spawn(findBraveExecutable(), [`--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`, "--remote-debugging-port=0", "--remote-allow-origins=*", "--no-first-run",
      "--no-default-browser-check", "--disable-component-update", "--disable-background-networking", "--new-window", url], { stdio: "ignore" });
    const port = await readDevToolsPort(profile);
    const target = await waitFor(async () => (await getTargets(port)).find(t => t.type === "page" && t.url === url), "source tab");
    source = await CdpSession.connect(target.webSocketDebuggerUrl); await source.call("Runtime.enable");
    const context = await waitFor(() => source.getExtensionContextId(), "source extension");
    await waitFor(() => source.evaluate('typeof window.__capSmokeStartDomTransfer === "function"', context), "transfer helper");
    await source.evaluate("window.__capSmokeStartDomTransfer()", context);
    const dest = await waitFor(async () => (await getTargets(port)).find(t => t.type === "page" && t.url.startsWith(origin + "/destination")), "destination tab");
    destination = await CdpSession.connect(dest.webSocketDebuggerUrl); await destination.call("Runtime.enable");
    await destination.call("Page.bringToFront");
    const pasted = await waitFor(() => destination.evaluate("document.getElementById('prompt-textarea').value || null"), "pasted context");
    assert.match(pasted, /Context loaded\. Let's pick up right where you left off\./);
    assert.match(pasted, /Then naturally ask the user to upload/);
    assert.match(pasted, /original-13mb.txt.*13.10 MB.*4.1 MB/);
    assert.ok(pasted.lastIndexOf("original-13mb.txt") > pasted.indexOf("Next step:"));
    assert.doesNotMatch(pasted, /Reply only:/);
    assert.equal(fileReads, 0, "The large file must never be downloaded.");
    assert.equal(summaries.length, 1);
    assert.equal(destinations, 1);
    assert.equal(await destination.evaluate("window.sendClicks"), 0);
    await waitFor(() => reports.some(r => r.status === "succeeded"), "terminal report");
    assert.doesNotMatch(JSON.stringify(reports), /original-13mb.txt|SYNTHETIC_TOKEN/);
    if (process.env.CAP_CONTEXT_NOTE_SCREENSHOT) {
      const shot = await destination.call("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(path.resolve(process.env.CAP_CONTEXT_NOTE_SCREENSHOT), Buffer.from(shot.data, "base64"));
    }
    console.log("PASS big-file note: real capture/summary/paste, preserved greeting, named upload request, zero original downloads/uploads, no Send.");
  } finally {
    if (source) { try { await source.call("Browser.close", {}, 5000); } catch {} }
    source?.close(); destination?.close(); child?.kill(); if (child) await waitForProcessExit(child, 5000);
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe smoke cleanup path.");
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
