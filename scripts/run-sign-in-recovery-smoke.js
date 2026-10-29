// Isolated Brave fixture: a native capture redirects to a login page. Clipboard
// writes and model work stay synthetic; the owner's session is never used.
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

async function run() {
  const fixture = fixtures("deepseek", "sign-in", 1), reports = [];
  fixture.data.data.biz_data.chat_messages[0].fragments = [{ type: "REQUEST", content: "Keep my entire transfer ready while I sign in." }];
  fixture.data.data.biz_data.chat_messages[1].fragments = [{ type: "RESPONSE", content: "Preserve this exact conversation and never submit it automatically." }];
  let loginVisits = 0;
  let fixtureError;
  const server = http.createServer(async (req, res) => {
    try {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST") {
      assert.equal(url.pathname, "/api/telemetry", "A tiny transfer needs no model request.");
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      reports.push(JSON.parse(Buffer.concat(chunks))); res.writeHead(204).end(); return;
    }
    if (url.pathname.includes("history_messages")) {
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(fixture.data)); return;
    }
    if (url.pathname === "/destination") {
      res.writeHead(302, { Location: "/login?__cap_context_smoke_platform=claude" }).end(); return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (url.pathname === "/login") {
      loginVisits++;
      res.end('<html><title>Sign-in recovery fixture</title><body style="background:#262624;color:white"><main><h1>Sign in to Claude</h1><input type="email" value="Untouched email"><input type="password" value="Untouched password"><button>Sign in</button></main></body></html>');
    } else {
      res.end('<html><title>Sign-in source fixture</title><body style="background:#262624;color:white"><main><textarea placeholder="Message DeepSeek"></textarea></main><script>localStorage.setItem("userToken",JSON.stringify({value:"SYNTHETIC_TOKEN"}));</script></body></html>');
    }
    } catch (error) { fixtureError = error; res.writeHead(500).end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cap-sign-in-")), profile = path.join(temp, "profile");
  let child, source, destination;
  try {
    const extension = await createSmokeExtension(temp, origin);
    const workerPath = path.join(extension, "background.js");
    let worker = await fs.readFile(workerPath, "utf8");
    // Production recognizes exact HTTPS AI/auth hosts. Only the disposable
    // fixture maps its loopback login to that same decision.
    worker = worker.replace('function isDestinationSignInUrl(url, destinationId) {',
      'function isDestinationSignInUrl(url, destinationId) { if (String(url).startsWith(' + JSON.stringify(origin + '/login') + ')) return true;');
    // Inspect this fixture's selected tab through the worker's real API;
    // native window occlusion can report hidden even for the selected tab.
    worker += '\nchrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message.type!=="__CAP_SIGN_IN_ACTIVE")return;chrome.tabs.query({active:true}).then(tabs=>reply(tabs.some(tab=>tab.id===sender.tab?.id)));return true;});\n';
    await fs.writeFile(workerPath, worker);
    const url = `${origin}/a/chat/s/sign-in?__cap_context_smoke_platform=deepseek`;
    child = spawn(findBraveExecutable(), [`--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`, "--remote-debugging-port=0", "--remote-allow-origins=*", "--no-first-run",
      "--no-default-browser-check", "--disable-background-networking", "--new-window", url], { stdio: "ignore" });
    const port = await readDevToolsPort(profile);
    const target = await waitFor(async () => (await getTargets(port)).find(t => t.type === "page" && t.url === url), "source");
    source = await CdpSession.connect(target.webSocketDebuggerUrl); await source.call("Runtime.enable");
    const context = await waitFor(() => source.getExtensionContextId(), "source content script");
    await waitFor(() => source.evaluate('typeof window.__capSmokeStartDomTransfer === "function"', context), "transfer entry");
    await source.evaluate("window.__capSmokeStartDomTransfer()", context);
    const terminal = await waitFor(() => reports.find(r => r.status === "failed"), "sign-in recovery report");
    if (fixtureError) throw fixtureError;
    assert.equal(terminal.diagnostics.destination_auth_prompt, true);
    assert.equal(terminal.diagnostics.error_code, "destination_not_new_chat");
    assert.equal(terminal.diagnostics.paste_populated, undefined);
    assert.equal(loginVisits, 1, "Do not create another destination for the same login redirect.");
    const carry = await waitFor(() => source.evaluate('document.getElementById("context-generator-fallback-modal")?.contextGeneratorCopyText', context), "ready copy box");
    assert.ok(carry.includes("User:") && carry.includes("Assistant:"));
    assert.match(await source.evaluate('document.getElementById("context-generator-fallback-desc").textContent', context), /not signed in to Claude/);
    const login = (await getTargets(port)).find(t => t.type === "page" && t.url.startsWith(origin + "/login"));
    assert.ok(login);
    destination = await CdpSession.connect(login.webSocketDebuggerUrl); await destination.call("Runtime.enable");
    await destination.call("Emulation.setFocusEmulationEnabled", { enabled: true });
    const destinationContext = await waitFor(() => destination.getExtensionContextId(), "login content script");
    assert.deepEqual(await destination.evaluate('Array.from(document.querySelectorAll("input"), input=>input.value)'), ["Untouched email", "Untouched password"]);
    assert.equal(await destination.evaluate('chrome.runtime.sendMessage({type:"__CAP_SIGN_IN_ACTIVE"})', destinationContext), true, "Bring the login tab forward.");
    await waitFor(() => destination.evaluate('document.getElementById("context-generator-error-copy-again")?.textContent === "Copy summary"', destinationContext), "compact sign-in notice");
    assert.equal(await destination.evaluate('Boolean(document.getElementById("context-generator-fallback-modal"))', destinationContext), false);
    await waitFor(() => destination.evaluate('getComputedStyle(document.getElementById("context-generator-error-overlay")).opacity === "1"', destinationContext), "settled glass notice");
    const placement = await destination.evaluate(`(() => {
      const notice=document.getElementById('context-generator-error-overlay').getBoundingClientRect();
      const button=document.getElementById('context-generator-error-copy-again').getBoundingClientRect();
      // Reserve the browser account chooser's upper-right footprint. Native
      // browser UI cannot be covered by a higher page z-index.
      const prompt={left:innerWidth-500,right:innerWidth-20,top:20,bottom:260};
      return {leftGap:notice.left,topGap:notice.top,blur:getComputedStyle(document.getElementById('context-generator-error-overlay')).backdropFilter,
        overlaps:notice.left<prompt.right && notice.right>prompt.left && notice.top<prompt.bottom && notice.bottom>prompt.top,
        copyClickable:document.elementFromPoint(button.x+button.width/2,button.y+button.height/2)?.id === 'context-generator-error-copy-again'};
    })()`);
    assert.ok(Math.abs(placement.leftGap - 20) < 1 && Math.abs(placement.topGap - 80) < 1, "Keep the sign-in notice at the upper-left; allow fractional pixels at zoom.");
    assert.match(placement.blur, /blur\(/);
    assert.equal(placement.overlaps, false, "The browser account chooser must not cover our recovery.");
    assert.equal(placement.copyClickable, true);
    assert.match(await destination.evaluate('getComputedStyle(document.getElementById("context-generator-sign-in-backdrop")).backdropFilter'), /blur\(6px\)/);
    const artifacts = path.resolve(__dirname, "../.test-artifacts"); await fs.mkdir(artifacts, { recursive: true });
    const clip = await destination.evaluate('(() => {const r=document.getElementById("context-generator-error-overlay").getBoundingClientRect();return {x:r.x-16,y:r.y-16,width:r.width+32,height:r.height+32,scale:1};})()');
    const shot = await destination.call("Page.captureScreenshot", { format: "png", clip });
    await fs.writeFile(path.join(artifacts, "sign-in-recovery.png"), Buffer.from(shot.data, "base64"));
    assert.equal(await destination.evaluate('document.getElementById("context-generator-error-overlay").contextGeneratorHideTimer', destinationContext), null);
    await destination.evaluate(`(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable:true, value:{writeText: async text=>{window.__signInCopied=text;}} });
      document.getElementById('context-generator-error-copy-again').click(); })()`, destinationContext);
    await waitFor(() => destination.evaluate('document.getElementById("context-generator-error-copy-again").textContent === "Copied!"', destinationContext), "first copy");
    assert.equal(await destination.evaluate("window.__signInCopied", destinationContext), carry);
    assert.equal(await destination.evaluate('Boolean(document.getElementById("context-generator-sign-in-backdrop"))'), false, "Remove page blur after copying so the user can sign in.");
    assert.match(await destination.evaluate('document.getElementById("context-generator-error-text").textContent', destinationContext), /Sign in to Claude, then paste/);
    assert.equal(await destination.evaluate('document.getElementById("context-generator-error-overlay").contextGeneratorHideTimer', destinationContext), null, "Copying must not start an expiry timer.");
    await destination.evaluate('document.getElementById("context-generator-error-copy-again").click()', destinationContext);
    await waitFor(() => destination.evaluate('document.getElementById("context-generator-error-copy-again").textContent === "Copied again!"', destinationContext), "Copy again");
    assert.equal(await destination.evaluate("window.__signInCopied", destinationContext), carry);
    assert.equal(await destination.evaluate('document.getElementById("context-generator-error-overlay").getAttribute("aria-hidden")', destinationContext), "false", "The notice stays open after copying again.");
    await destination.evaluate('document.getElementById("context-generator-error-dismiss").click()', destinationContext);
    assert.equal(await destination.evaluate('document.getElementById("context-generator-error-overlay").getAttribute("aria-hidden")', destinationContext), "true");
    assert.equal(await source.evaluate('document.getElementById("context-generator-fallback-modal").contextGeneratorCopyText', context), carry, "Keep the full text box after the destination notice is dismissed.");
    assert.doesNotMatch(JSON.stringify(reports), /SYNTHETIC_TOKEN|Untouched password|ready to paste/i);
    console.log("PASS sign-in redirect: login tab activated, persistent Copy summary notice, source text box retained, unchanged login fields, copying and explicit dismissal.");
  } catch (error) {
    console.error(JSON.stringify({ reports: reports.map(report => ({ status: report.status, stage: report.last_stage,
      reason: report.failure_reason, code: report.diagnostics?.error_code })), loginVisits,
      source: source ? await source.evaluate('({error:document.getElementById("context-generator-error-text")?.textContent,copyBox:Boolean(document.getElementById("context-generator-fallback-modal"))})').catch(() => null) : null }));
    throw error;
  } finally {
    if (source) { try { await source.call("Browser.close", {}, 5000); } catch {} }
    source?.close(); destination?.close(); child?.kill(); if (child) await waitForProcessExit(child, 5000);
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe smoke cleanup path.");
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
