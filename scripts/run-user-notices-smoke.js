// Real unpacked-extension UI in its own Brave profile/window. All identities,
// lookups and messages are synthetic; no hosted service or account is contacted.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { createHandler, noticeForUser } = require("../backend/user-notices");
const { CdpSession, findBraveExecutable, createSmokeExtension, readDevToolsPort, getTargets, waitFor,
  waitForProcessExit, dispatchTrustedFixtureInput } = require("./run-extension-smoke");

async function run() {
  const entries = {}, requests = [], dismissals = [];
  const installId = "11111111-1111-4111-8111-111111111111";
  const message = "Hello from Cap Context. Your transfer is ready to try again. 🙂 <b>This stays plain text.</b>";
  const handler = createHandler({ rateLimit: async () => ({ allowed: true }), log: (...args) => dismissals.push(args),
    env: { SUPABASE_TELEMETRY_FUNCTION_URL: "https://example.invalid", SUPABASE_TELEMETRY_PUBLISHABLE_KEY: "synthetic",
      TELEMETRY_RELAY_SECRET: "synthetic-private-relay-secret-0123456789abcdef" },
    fetchImpl: async (_url, options) => {
      const userNumber = JSON.parse(options.body).install_id === installId ? 49 : 50;
      return new Response(JSON.stringify({ userNumber, message: entries[userNumber] ?? null }));
    }
  });
  const server = http.createServer(async (req, res) => {
    if (req.url === "/api/user-notices") {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      req.body = Buffer.concat(chunks).toString(); requests.push(JSON.parse(req.body));
      res.status = status => { res.statusCode = status; return res; };
      res.json = body => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
      await handler(req, res); return;
    }
    if (req.method === "POST") { res.writeHead(204).end(); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<html><title>Cap Context notice test</title><body style="background:#262624;color:#eee;font:16px Arial;padding:60px"><h1>Cap Context notice test</h1><p>Isolated Brave fixture; synthetic messages only.</p><textarea placeholder="Message DeepSeek" style="margin-top:160px;width:65%;height:80px"></textarea></body></html>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cap-user-notices-"));
  let child, page, worker;
  try {
    const extension = await createSmokeExtension(temp, origin);
    const profile = path.join(temp, "profile");
    child = spawn(findBraveExecutable(), [`--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`, "--remote-debugging-port=0", "--remote-allow-origins=*", "--no-first-run",
      "--no-default-browser-check", "--disable-background-networking", "--new-window", "about:blank"], { stdio: "ignore" });
    const port = await readDevToolsPort(profile);
    const workerTarget = await waitFor(async () => (await getTargets(port)).find(t => t.type === "service_worker"), "notice worker");
    worker = await CdpSession.connect(workerTarget.webSocketDebuggerUrl); await worker.call("Runtime.enable");
    await worker.evaluate(`chrome.storage.local.set({"context-generator-install-id-v1":${JSON.stringify(installId)}})`);
    const target = await waitFor(async () => (await getTargets(port)).find(t => t.type === "page"), "notice page");
    page = await CdpSession.connect(target.webSocketDebuggerUrl); await page.call("Runtime.enable");
    await page.call("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.call("Page.navigate", { url: `${origin}/a/chat/s/notice?__cap_context_smoke_platform=deepseek` });
    let context = await waitFor(() => page.getExtensionContextId(), "notice content world");
    await waitFor(() => page.evaluate('typeof window.__capSmokeShowRecovery === "function"', context), "copy fixture entry");
    // Initial telemetry may still be reading storage when the worker first
    // starts. Seed after page bootstrap, then use its ordinary notice request.
    await worker.evaluate(`chrome.storage.local.set({"context-generator-install-id-v1":${JSON.stringify(installId)}})`);
    await page.evaluate('chrome.runtime.sendMessage({type:"CHECK_USER_NOTICES"})', context);
    await waitFor(() => requests.length > 0, "automatic first notice check");
    await page.evaluate(`Object.defineProperty(navigator, "clipboard", {configurable:true,value:{writeText:async()=>{}}});
      window.__capSmokeShowRecovery("Synthetic complete carry", false, true);
      document.getElementById("context-generator-fallback-copy").click();`, context);
    await waitFor(() => page.evaluate('document.getElementById("context-generator-error-title")?.textContent === "Copied to clipboard"', context), "real copy confirmation");
    const appearance = `(() => { const node=document.getElementById("context-generator-error-overlay"), style=getComputedStyle(node);
      return Object.fromEntries(["backgroundImage","borderRadius","backdropFilter","fontFamily","width","right","top","transition"].map(key=>[key,style[key]])); })()`;
    const baseline = await page.evaluate(appearance);
    const output = process.env.CAP_CONTEXT_NOTICE_SCREENSHOT_DIR;
    if (output) {
      await fs.mkdir(output, { recursive: true });
      const shot = await page.call("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(path.join(output, "copy-confirmation.png"), Buffer.from(shot.data, "base64"));
    }
    // Backend-only message edit. The installed extension stays byte-for-byte
    // unchanged. Expire its cache rather than waiting five real minutes.
    entries[49] = message;
    await worker.evaluate('chrome.storage.local.set({"context-generator-user-notices-v1":{checkedAt:0,seen:[]}})');
    let previousContext = context;
    await page.call("Page.reload");
    context = await waitFor(() => { const id = page.getExtensionContextId(); return id !== previousContext && id; }, "reloaded content world");
    await waitFor(() => page.evaluate(`document.getElementById("context-generator-error-text")?.textContent === ${JSON.stringify(message)}`, context), "automatic targeted notice");
    assert.deepEqual(await page.evaluate(appearance), baseline, "Reuse the actual copy confirmation's material, placement and animation.");
    assert.equal(await page.evaluate('document.querySelectorAll("#context-generator-error-overlay b").length'), 0);
    const visibleControls = 'Array.from(document.querySelectorAll("#context-generator-error-overlay button")).filter(button=>getComputedStyle(button).display!=="none" && button.getBoundingClientRect().height>0).map(button=>button.textContent)';
    assert.deepEqual(await page.evaluate(visibleControls), ["Dismiss"]);
    assert.equal(await page.evaluate('document.getElementById("context-generator-error-overlay").getAttribute("role")'), "status");
    if (output) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const shot = await page.call("Page.captureScreenshot", { format: "png" });
      await fs.writeFile(path.join(output, "user-notice.png"), Buffer.from(shot.data, "base64"));
    }
    console.log("PASS actual fallback Copy confirmation and targeted notice share glass styles, position and transition; literal message, Dismiss only.");
    await waitFor(() => page.evaluate('document.getElementById("context-generator-error-overlay")?.style.display === "none"', context), "ten-second automatic expiry");
    assert.deepEqual(dismissals, [], "Automatic expiry must not log a click.");
    await page.evaluate(`Object.defineProperty(navigator, "clipboard", {configurable:true,value:{writeText:async()=>{}}});
      window.__capSmokeShowRecovery("Synthetic complete carry after a notice", false, true);
      document.getElementById("context-generator-fallback-copy").click();`, context);
    await waitFor(() => page.evaluate('document.getElementById("context-generator-error-title")?.textContent === "Copied to clipboard"', context), "copy confirmation after a user notice");
    assert.equal(await page.evaluate('Array.from(document.querySelectorAll("#context-generator-error-overlay button")).filter(button=>getComputedStyle(button).display!=="none" && button.getBoundingClientRect().height>0).length'), 2,
      "A later copy confirmation regains Copy again and Dismiss on the same notice node.");
    await page.evaluate('document.getElementById("context-generator-error-dismiss").click()', context);
    await waitFor(() => page.evaluate('document.getElementById("context-generator-error-overlay").style.display === "none"', context), "copy confirmation dismissal");
    // Reuse the copy notice's actions container: hiding that whole row would
    // also hide Dismiss even when the button itself is styled as visible.
    entries[49] = "Dismiss this synthetic notice.";
    await worker.evaluate('chrome.storage.local.get("context-generator-user-notices-v1").then(stored => chrome.storage.local.set({"context-generator-user-notices-v1":{...stored["context-generator-user-notices-v1"],checkedAt:0}}))');
    assert.equal((await page.evaluate('chrome.runtime.sendMessage({type:"CHECK_USER_NOTICES"})', context)).shown, true);
    assert.deepEqual(await page.evaluate(visibleControls), ["Dismiss"]);
    assert.deepEqual(dismissals, [], "Dismiss on an ordinary copy confirmation is not a user-notice click.");
    await dispatchTrustedFixtureInput(page, { selector: "#context-generator-error-dismiss" });
    await waitFor(() => dismissals.length === 1, "trusted Dismiss report in backend logs");
    assert.deepEqual(dismissals, [["cap_context_user_notice_dismiss", {
      user_no: 49, notice_id: noticeForUser(49, entries[49]).id
    }]]);
    assert.equal(await page.evaluate('document.getElementById("context-generator-error-overlay").getAttribute("aria-hidden")'), "true");
    await waitFor(() => page.evaluate('document.getElementById("context-generator-error-overlay").style.display === "none"', context), "user notice dismissal");
    previousContext = context;
    await page.call("Page.reload");
    context = await waitFor(() => { const id = page.getExtensionContextId(); return id !== previousContext && id; }, "content after once-only reload");
    await waitFor(() => page.evaluate('typeof window.__capSmokeShowRecovery === "function"', context), "loaded content");
    const reply = await page.evaluate('chrome.runtime.sendMessage({type:"CHECK_USER_NOTICES"})', context);
    assert.equal(reply.shown, false);
    assert.equal(await page.evaluate('document.getElementById("context-generator-error-overlay")?.style.display === "flex"'), false);
    // A second synthetic installation maps to #50, so #49's text is displayed
    // only to its target, even though the same extension/backend are used.
    await worker.evaluate('chrome.storage.local.set({"context-generator-install-id-v1":"22222222-2222-4222-8222-222222222222","context-generator-user-notices-v1":{checkedAt:0,seen:[]}})');
    assert.equal((await page.evaluate('chrome.runtime.sendMessage({type:"CHECK_USER_NOTICES"})', context)).shown, false);
    assert.equal(await worker.evaluate('chrome.storage.local.get("context-generator-user-notices-v1").then(result=>result["context-generator-user-notices-v1"].notice)'), null);
    assert.ok(requests.every(body => body.event === "dismiss"
      ? Object.keys(body).sort().join() === "event,install_id,notice_id" : Object.keys(body).join() === "install_id"));
    assert.equal(dismissals.length, 1);
    console.log("PASS ten-second expiry, Dismiss on a reused copy notice, persisted no-repeat after dismissal/navigation, backend-only updates and different-user exclusion.");
  } catch (error) {
    console.error(JSON.stringify({ requests,
      storage: worker ? await worker.evaluate('chrome.storage.local.get(["context-generator-install-id-v1","context-generator-user-notices-v1"])').catch(() => null) : null,
      content: page ? await page.evaluate('({visibility:document.visibilityState,input:!!document.querySelector("textarea"),notice:document.getElementById("context-generator-error-text")?.textContent})').catch(() => null) : null,
      exceptions: page?.events.filter(event => event.method === "Runtime.exceptionThrown").map(event => event.params?.exceptionDetails?.text) }));
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
