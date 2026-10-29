// Installed Brave + native 4M capture + real part/receipt endpoint. Only the
// upstream model is synthetic; credentials, telemetry and profile stay local.
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
const largeHandler = require("../api/large-summary");
// Keep this mode free of worker debugging: attaching a debugger changes MV3
// lifetime and masked the zero-request preparation failure in investigation.
const slowProviderMs = process.env.CAP_CONTEXT_LARGE_SLOW_SMOKE === "1" ? 35000 : 0;
const finalSummary = 'Verified final handoff: preserve the accepted implementation, all decisions and unresolved work. '
  + 'Continue the latest request by testing the complete transfer before any release.\n\nNext step:\n\n'
  + 'Reply only: "Context loaded. Let\'s pick up right where you left off." Then wait for the user.';

async function scenario(failPart, failTransport = false) {
  const fixture = fixtures("deepseek", "smoke", 1);
  const prefix = "DeepSeek conversation:\n\nUser: ", tail = "\n\nAssistant: Keep the complete conversation and test recovery.  \r\n";
  const pattern = "  Decision: preserve source text and Unicode 世界 🕷️.\r\n";
  const size = 4000000 - prefix.length - tail.length;
  const text = (pattern.repeat(Math.ceil(size / pattern.length))).slice(0, size - 3) + " \r\n";
  const transcript = prefix + text + tail;
  assert.equal(transcript.length, 4000000);
  fixture.data.data.biz_data.chat_messages[0].fragments = [{ type: "REQUEST", content: text }];
  fixture.data.data.biz_data.chat_messages[1].fragments = [{ type: "RESPONSE", content: tail.slice("\n\nAssistant: ".length) }];
  const requests = [], reports = [];
  let providerCalls = 0;
  const env = { ...process.env }, nativeFetch = global.fetch;
  process.env.OPENROUTER_API_KEY = "synthetic-smoke-key";
  process.env.TELEMETRY_SIGNING_KEY = "synthetic-large-transfer-smoke-signing-key-only";
  process.env.OPENROUTER_ENABLED = "true";
  delete process.env.LARGE_SUMMARY_ENABLED;
  delete process.env.SUPABASE_TELEMETRY_FUNCTION_URL;
  largeHandler.__test.resetRateLimit();
  global.fetch = async (input, options) => {
    if (String(input) === "https://openrouter.ai/api/v1/chat/completions") {
      providerCalls++;
      if (slowProviderMs) await new Promise(resolve => setTimeout(resolve, slowProviderMs));
      if (failPart) return new Response("synthetic provider rejection", { status: 503 });
      return new Response(JSON.stringify({ choices: [{ message: { content: finalSummary }, finish_reason: "stop" }] }), { status: 200 });
    }
    assert.ok(String(input).startsWith("http://127.0.0.1:"), "Smoke must not contact an external service.");
    return nativeFetch(input, options);
  };
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (url.pathname === "/api/large-summary") {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        if (req.method === "POST") { req.body = JSON.parse(Buffer.concat(chunks)); requests.push(req.body); }
        // Reproduce a connection ending before the backend calls any model.
        if (failTransport) { res.destroy(); return; }
        res.status = code => { res.statusCode = code; return res; };
        res.json = body => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); return res; };
        return await largeHandler(req, res);
      }
      if (req.method === "POST") {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        assert.equal(url.pathname, "/api/telemetry", "Large transfers must never use the ordinary summary endpoint.");
        reports.push(JSON.parse(Buffer.concat(chunks))); res.writeHead(204); res.end(); return;
      }
      if (url.pathname.includes("history_messages")) {
        res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(fixture.data)); return;
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(url.pathname === "/destination"
        ? `<html><body><main><h1>ChatGPT transfer fixture</h1><form><textarea id="prompt-textarea" aria-label="Ask ChatGPT" style="width:90vw;height:60vh"></textarea><button type="button" id="send">Send</button></form></main><script>window.sendClicks=0;document.getElementById('send').onclick=()=>window.sendClicks++;</script></body></html>`
        : `<html><body><main><textarea placeholder="Message DeepSeek"></textarea></main><script>localStorage.setItem('userToken',JSON.stringify({value:'SYNTHETIC_TOKEN'}));</script></body></html>`);
    } catch (error) {
      if (req.aborted || res.destroyed) return; // Failed parts cancel sibling uploads.
      res.statusCode = 500; res.end("Synthetic fixture error"); console.error(error);
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "cap-large-transfer-")), profile = path.join(temp, "profile");
  let child, source, destination;
  try {
    const extension = await createSmokeExtension(temp, origin);
    const contentPath = path.join(extension, "platform-content.js");
    const content = await fs.readFile(contentPath, "utf8");
    await fs.writeFile(contentPath, content.replace('startDestinationTransfer("claude"); return true;', 'startDestinationTransfer("chatgpt"); return true;'));
    const url = `${origin}/a/chat/s/smoke?__cap_context_smoke_platform=deepseek`;
    // Isolated test windows can be occluded by the owner's active window.
    // Keep native-capture timers/frames running without changing production.
    child = spawn(findBraveExecutable(), [`--user-data-dir=${profile}`, `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`, "--remote-debugging-port=0", "--remote-allow-origins=*", "--no-first-run",
      "--no-default-browser-check", "--disable-component-update", "--disable-background-networking",
      "--disable-background-timer-throttling", "--disable-renderer-backgrounding", "--disable-backgrounding-occluded-windows",
      "--new-window", url], { stdio: "ignore" });
    const port = await readDevToolsPort(profile);
    const target = await waitFor(async () => (await getTargets(port)).find(t => t.type === "page" && t.url === url), "4M source tab");
    source = await CdpSession.connect(target.webSocketDebuggerUrl); await source.call("Runtime.enable");
    await source.call("Page.bringToFront");
    const context = await waitFor(() => source.getExtensionContextId(), "4M source extension");
    await waitFor(() => source.evaluate('typeof window.__capSmokeStartDomTransfer === "function"', context), "transfer helper");
    await source.evaluate("window.__capSmokeStartDomTransfer()", context);
    const terminal = await waitFor(() => reports.find(r => ["failed", "succeeded"].includes(r.status)), "4M terminal report", slowProviderMs ? 220000 : 60000);
    assert.equal(terminal.status, failPart ? "failed" : "succeeded", `Unexpected transfer outcome: ${terminal.failure_reason}`);
    assert.equal(terminal.character_count, transcript.length);
    assert.ok(requests.length >= 1);
    assert.ok(requests.every(r => r.large.totalChars === transcript.length && r.large.transferId === terminal.attempt_id));
    const finals = requests.filter(r => r.large.phase === "final");
    const dest = (await getTargets(port)).find(t => t.type === "page" && t.url.startsWith(origin + "/destination"));
    if (dest) { destination = await CdpSession.connect(dest.webSocketDebuggerUrl); await destination.call("Runtime.enable"); }
    if (failPart) {
      assert.equal(finals.length, 0);
      assert.equal(terminal.failure_reason, "summary_failed");
      assert.equal(terminal.diagnostics.summary_mode, "local_fallback");
      const failure = terminal.diagnostics.summary_response_failures?.[0];
      assert.ok(failure, "The actual source/outbox flow must retain the large-request failure.");
      assert.equal(failure.reason, failTransport ? "fetch_failed" : "service_rejected");
      assert.equal(terminal.diagnostics.summary_error_code, failTransport ? "summary_transport_failed" : "summary_failed");
      if (failTransport) {
        assert.equal(providerCalls, 0);
        assert.equal(failure.http_status, undefined);
      }
      const recovery = await source.evaluate(`document.getElementById('context-generator-fallback-modal')?.contextGeneratorCopyText`, context);
      assert.ok(recovery?.includes(transcript), "Copy recovery must preserve every source character, including CRLF and surrounding whitespace.");
      // Stub only this isolated world's clipboard to avoid touching the owner's
      // clipboard and verify that the actual Copy button bypasses textarea CRLF normalization.
      const copied = await source.evaluate(`(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true,
        value: { writeText(text) { window.__largeCopied = text; return Promise.resolve(); } } });
        document.getElementById('context-generator-fallback-copy').click(); return window.__largeCopied; })()`, context);
      assert.equal(copied, recovery);
      if (destination) assert.equal(await destination.evaluate("document.getElementById('prompt-textarea').value"), "", "Never auto-paste the full 4M fallback.");
    } else {
      assert.equal(finals.length, 1);
      const parts = requests.filter(r => r.large.phase === "part").sort((a, b) => a.large.index - b.large.index);
      assert.equal(parts.length, finals[0].large.total);
      assert.equal(parts.map(r => r.conversation).join(""), transcript, "All source text must appear once, in order.");
      let offset = 0; for (const part of parts) { assert.equal(part.large.offset, offset); offset += part.conversation.length; }
      assert.equal(providerCalls, parts.length + 1);
      assert.ok(destination, "Successful summary opens the destination.");
      assert.equal(await destination.evaluate("document.getElementById('prompt-textarea').value"), finalSummary);
    }
    if (destination) assert.equal(await destination.evaluate("window.sendClicks"), 0);
    assert.doesNotMatch(JSON.stringify(reports), /SYNTHETIC_TOKEN|Decision: preserve source text|Verified final handoff|receipt/);
    console.log(`PASS 4M ${failTransport ? "zero-provider connection failure diagnosis" : failPart ? "failed-part recovery" : "native capture and final paste"}: ${requests.length} bounded requests, ${providerCalls} synthetic provider calls, no Send or external telemetry.`);
  } catch (error) {
    console.error(JSON.stringify({ requestPhases: requests.map(r => r.large.phase), providerCalls,
      reports: reports.map(r => ({ status: r.status, stage: r.last_stage, reason: r.failure_reason, diagnostics: r.diagnostics })),
      source: source ? await source.evaluate(`({ error: document.getElementById('context-generator-error-text')?.textContent,
        fallback: Boolean(document.getElementById('context-generator-fallback-modal')) })`).catch(() => null) : null,
      browserErrors: source?.events.filter(event => event.method === "Runtime.exceptionThrown") }, null, 2));
    throw error;
  } finally {
    if (source) { try { await source.call("Browser.close", {}, 5000); } catch {} }
    source?.close(); destination?.close(); child?.kill(); if (child) await waitForProcessExit(child, 5000);
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    global.fetch = nativeFetch;
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(env, key)) delete process.env[key];
    Object.assign(process.env, env);
    if (!path.resolve(temp).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error("Unsafe smoke cleanup path.");
    await fs.rm(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
}
async function run() {
  await scenario(false);
  if (!slowProviderMs) { await scenario(true); await scenario(true, true); }
}
if (require.main === module) run().catch(error => { console.error(error); process.exitCode = 1; });
