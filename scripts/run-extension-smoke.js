const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE_SENTINEL = "SMOKE_USER_SENTINEL: preserve the deployment checklist.";
const ASSISTANT_SENTINEL = "SMOKE_ASSISTANT_SENTINEL: verify staging before release.";
const SUMMARY_TEXT = [
  "CONTEXT CARRY — READY TO PASTE",
  "",
  "WHAT WE WERE DOING",
  "Testing the installed Cap Context transfer path in an isolated Brave profile.",
  "",
  "WHERE WE LEFT OFF",
  "The controlled source conversation was captured and summarized once.",
  "",
  "KEY CONTEXT",
  "The destination must receive this exact smoke summary without pressing Send."
].join("\n");
const SMOKE_PLATFORM_QUERY = "__cap_context_smoke_platform";
const SMOKE_TIMEOUT_MS = Number(process.env.CAP_CONTEXT_SMOKE_TIMEOUT_MS || 45000);

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.events = [];
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        this.events.push(message);
        if (this.events.length > 100) this.events.shift();
        return;
      }
      if (!this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) reject(new Error("DevTools connection closed."));
      this.pending.clear();
    });
  }

  static async connect(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not connect to Brave DevTools.")), { once: true });
    });
    return new CdpSession(socket);
  }

  call(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, contextId = null) {
    const params = {
      expression,
      awaitPromise: true,
      returnByValue: true
    };
    if (contextId) params.contextId = contextId;
    const response = await this.call("Runtime.evaluate", params);
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
    }
    return response.result?.value;
  }

  close() {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close();
  }

  getRecentEvents() {
    return this.events.slice(-30);
  }
}

function findBraveExecutable() {
  const candidates = [
    process.env.BRAVE_PATH,
    process.platform === "win32" && path.join(process.env.PROGRAMFILES || "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    process.platform === "win32" && path.join(process.env["PROGRAMFILES(X86)"] || "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    process.platform === "win32" && path.join(process.env.LOCALAPPDATA || "", "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
    process.platform === "darwin" && "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    process.platform === "linux" && "/usr/bin/brave-browser",
    process.platform === "linux" && "/usr/bin/brave",
    process.platform === "linux" && "/snap/bin/brave"
  ].filter(Boolean);
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    throw new Error("Brave was not found. Set BRAVE_PATH to the Brave executable and rerun the smoke test.");
  }
  return executable;
}

function replaceOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  assert.notEqual(first, -1, `Smoke setup could not find ${label}.`);
  assert.equal(source.indexOf(needle, first + needle.length), -1, `Smoke setup found multiple ${label} matches.`);
  return source.replace(needle, replacement);
}

function addUnique(list, value) {
  if (!list.includes(value)) list.push(value);
}

async function createSmokeExtension(tempRoot, origin) {
  const extensionRoot = path.join(tempRoot, "extension");
  await fs.promises.cp(path.join(REPO_ROOT, "extension"), extensionRoot, { recursive: true });

  const manifestPath = path.join(extensionRoot, "manifest.json");
  const manifest = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
  const localMatch = "http://127.0.0.1/*";
  addUnique(manifest.host_permissions, localMatch);
  addUnique(manifest.content_scripts[0].matches, localMatch);
  addUnique(manifest.web_accessible_resources[0].matches, localMatch);
  await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const platformPath = path.join(extensionRoot, "platform-content.js");
  let platformSource = (await fs.promises.readFile(platformPath, "utf8")).replace(/\r\n/g, "\n");
  const currentPlatformNeedle = [
    "  function getCurrentPlatform() {",
    "    const hostname = window.location.hostname;"
  ].join("\n");
  const currentPlatformReplacement = [
    "  function getCurrentPlatform() {",
    `    const smokePlatformId = new URL(window.location.href).searchParams.get(${JSON.stringify(SMOKE_PLATFORM_QUERY)});`,
    "    if (smokePlatformId && PLATFORMS[smokePlatformId]) {",
    "      return { ...PLATFORMS[smokePlatformId], id: smokePlatformId };",
    "    }",
    "    const hostname = window.location.hostname;"
  ].join("\n");
  platformSource = replaceOnce(
    platformSource,
    currentPlatformNeedle,
    currentPlatformReplacement,
    "the current-platform resolver"
  );
  const platformUrls = {
    claude: "https://claude.ai/",
    chatgpt: "https://chatgpt.com/",
    gemini: "https://gemini.google.com/",
    grok: "https://grok.com/",
    deepseek: "https://chat.deepseek.com/"
  };
  for (const [platformId, productionUrl] of Object.entries(platformUrls)) {
    const fixtureUrl = `${origin}/destination?${SMOKE_PLATFORM_QUERY}=${platformId}`;
    platformSource = replaceOnce(
      platformSource,
      `      url: ${JSON.stringify(productionUrl)},`,
      `      url: ${JSON.stringify(fixtureUrl)},`,
      `${platformId} content-script URL`
    );
  }
  await fs.promises.writeFile(platformPath, platformSource);

  const backgroundPath = path.join(extensionRoot, "background.js");
  let backgroundSource = (await fs.promises.readFile(backgroundPath, "utf8")).replace(/\r\n/g, "\n");
  backgroundSource = replaceOnce(
    backgroundSource,
    'const SUMMARY_BACKEND_URL = "https://context-generator-five.vercel.app/api/summarize";',
    `const SUMMARY_BACKEND_URL = ${JSON.stringify(`${origin}/api/summarize`)};`,
    "the summary backend URL"
  );
  backgroundSource = replaceOnce(
    backgroundSource,
    '    url: "https://claude.ai/",',
    `    url: ${JSON.stringify(`${origin}/destination?${SMOKE_PLATFORM_QUERY}=claude`)},`,
    "the Claude destination URL"
  );
  await fs.promises.writeFile(backgroundPath, backgroundSource);
  return extensionRoot;
}

function sourceFixture() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Cap Context smoke source</title>
  <style>
    body{margin:0;min-height:100vh;background:#151515;color:#f7f7f7;font:16px system-ui}
    main{max-width:760px;margin:40px auto 160px;padding:20px}
    article{margin:18px 0;padding:18px;border:1px solid #444;border-radius:14px}
    form{position:fixed;left:50%;bottom:28px;width:min(720px,calc(100vw - 48px));transform:translateX(-50%);padding:16px;background:#242424;border-radius:18px}
    #prompt-textarea{min-height:48px;outline:none}
  </style>
</head>
<body>
  <main aria-label="Conversation">
    <article data-message-author-role="user">${SOURCE_SENTINEL}</article>
    <article data-message-author-role="assistant"><div class="markdown">${ASSISTANT_SENTINEL}</div></article>
  </main>
  <form data-testid="composer"><div id="prompt-textarea" data-testid="prompt-textarea" contenteditable="true" role="textbox"></div></form>
</body>
</html>`;
}

function destinationFixture() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Cap Context smoke destination</title>
  <style>
    body{margin:0;min-height:100vh;background:#f4f0e8;color:#26221e;font:16px system-ui}
    form{position:fixed;left:50%;bottom:34px;width:min(760px,calc(100vw - 48px));transform:translateX(-50%);padding:18px;background:white;border:1px solid #d8d0c4;border-radius:18px}
    textarea{display:block;width:100%;min-height:180px;box-sizing:border-box;border:0;outline:none;resize:none;font:14px/1.5 system-ui}
    button{margin-top:10px;padding:9px 16px}
  </style>
</head>
<body>
  <form data-testid="composer">
    <textarea aria-label="Message Claude"></textarea>
    <button id="send-button" type="button">Send</button>
  </form>
  <script>
    window.__capContextSmokeSendClicks = 0;
    document.getElementById("send-button").addEventListener("click", () => { window.__capContextSmokeSendClicks += 1; });
  </script>
</body>
</html>`;
}

async function startFixtureServer() {
  const state = { summaryRequests: [] };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "OPTIONS") {
      response.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Cap-Context-Client"
      });
      response.end();
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/summarize") {
      let rawBody = "";
      for await (const chunk of request) rawBody += chunk;
      state.summaryRequests.push(JSON.parse(rawBody));
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      });
      response.end(JSON.stringify({
        summary: SUMMARY_TEXT,
        timing: { inputChars: state.summaryRequests.at(-1)?.conversation?.length || 0, servedBy: "smoke-stub" }
      }));
      return;
    }
    if (url.pathname === "/source") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(sourceFixture());
      return;
    }
    if (url.pathname === "/destination") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(destinationFixture());
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    server,
    state,
    origin: `http://127.0.0.1:${address.port}`
  };
}

async function waitFor(check, description, timeoutMs = SMOKE_TIMEOUT_MS, intervalMs = 120) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const detail = lastError?.message ? ` Last error: ${lastError.message}` : "";
  throw new Error(`Timed out waiting for ${description}.${detail}`);
}

async function waitForProcessExit(child, timeoutMs) {
  if (!child || child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);
}

async function readDevToolsPort(profileRoot) {
  const activePortPath = path.join(profileRoot, "DevToolsActivePort");
  return waitFor(async () => {
    if (!fs.existsSync(activePortPath)) return null;
    const [portLine] = (await fs.promises.readFile(activePortPath, "utf8")).trim().split(/\r?\n/);
    const port = Number(portLine);
    return Number.isInteger(port) && port > 0 ? port : null;
  }, "Brave DevTools startup", 15000);
}

async function getTargets(devToolsPort) {
  const response = await fetch(`http://127.0.0.1:${devToolsPort}/json/list`);
  if (!response.ok) throw new Error(`DevTools target request returned ${response.status}.`);
  return response.json();
}

async function getBrowserWebSocketUrl(devToolsPort) {
  const response = await fetch(`http://127.0.0.1:${devToolsPort}/json/version`);
  if (!response.ok) throw new Error(`DevTools version request returned ${response.status}.`);
  return (await response.json()).webSocketDebuggerUrl;
}

function appendProcessOutput(current, chunk) {
  return `${current}${chunk}`.slice(-8000);
}

async function run() {
  assert.equal(typeof WebSocket, "function", "This smoke test requires Node.js with the built-in WebSocket client.");
  const braveExecutable = findBraveExecutable();
  const { server, state, origin } = await startFixtureServer();
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cap-context-brave-smoke-"));
  const profileRoot = path.join(tempRoot, "profile");
  let braveProcess = null;
  let browserSession = null;
  let sourceSession = null;
  let destinationSession = null;
  let browserOutput = "";

  try {
    const extensionRoot = await createSmokeExtension(tempRoot, origin);
    const sourceUrl = `${origin}/source?${SMOKE_PLATFORM_QUERY}=chatgpt`;
    braveProcess = spawn(braveExecutable, [
      `--user-data-dir=${profileRoot}`,
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`,
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-default-apps",
      "--disable-component-update",
      "--new-window",
      "--window-size=1180,820",
      sourceUrl
    ], { stdio: ["ignore", "pipe", "pipe"], windowsHide: false });
    braveProcess.stdout.on("data", (chunk) => { browserOutput = appendProcessOutput(browserOutput, chunk); });
    braveProcess.stderr.on("data", (chunk) => { browserOutput = appendProcessOutput(browserOutput, chunk); });

    const devToolsPort = await readDevToolsPort(profileRoot);
    browserSession = await CdpSession.connect(await getBrowserWebSocketUrl(devToolsPort));
    await waitFor(async () => {
      const targets = await getTargets(devToolsPort);
      return targets.find((target) => target.type === "service_worker" && target.url.endsWith("/background.js"));
    }, "the installed extension service worker", 15000);
    const sourceTarget = await waitFor(async () => {
      const targets = await getTargets(devToolsPort);
      return targets.find((target) => target.type === "page" && target.url.startsWith(`${origin}/source`));
    }, "the controlled source page");
    sourceSession = await CdpSession.connect(sourceTarget.webSocketDebuggerUrl);
    await sourceSession.call("Runtime.enable");
    await sourceSession.call("Log.enable");
    await sourceSession.call("Page.bringToFront");
    await sourceSession.call("Emulation.setFocusEmulationEnabled", { enabled: true });

    // Brave can finish the first navigation before a freshly loaded unpacked extension registers.
    // One post-startup reload makes content-script injection deterministic without masking runtime failures.
    await sourceSession.call("Page.reload", { ignoreCache: true });

    try {
      await waitFor(
        () => sourceSession.evaluate(`(() => {
          const bubble = document.getElementById("context-generator-bubble");
          return Boolean(bubble && getComputedStyle(bubble).display !== "none");
        })()`),
        "the installed extension bubble"
      );
    } catch (error) {
      const targets = await getTargets(devToolsPort);
      const pageState = await sourceSession.evaluate(`({
        url: location.href,
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        contentScriptLoadId: window.__contextGeneratorPlatformLoaded || null,
        bubbleExists: Boolean(document.getElementById("context-generator-bubble"))
      })`);
      const recentEvents = sourceSession.getRecentEvents();
      const extensionContextId = recentEvents
        .filter((event) => event.method === "Runtime.executionContextCreated" && event.params?.context?.origin?.startsWith("chrome-extension://"))
        .at(-1)?.params?.context?.id;
      const extensionState = extensionContextId
        ? await sourceSession.evaluate(`({
            loadId: window.__contextGeneratorPlatformLoaded || null,
            runtimeId: chrome.runtime?.id || null,
            promptExists: Boolean(document.getElementById("prompt-textarea")),
            promptRect: (() => {
              const rect = document.getElementById("prompt-textarea")?.getBoundingClientRect();
              return rect ? { width: rect.width, height: rect.height, top: rect.top, bottom: rect.bottom } : null;
            })(),
            ownedNodes: [...document.querySelectorAll("[data-context-generator-owned]")].map((node) => ({ id: node.id, tag: node.localName }))
          })`, extensionContextId)
        : null;
      error.message += `\nTargets: ${JSON.stringify(targets.map(({ type, url }) => ({ type, url })))}\nPage: ${JSON.stringify(pageState)}\nExtension: ${JSON.stringify(extensionState)}\nEvents: ${JSON.stringify(recentEvents)}`;
      throw error;
    }
    process.stdout.write("✓ Brave loaded the unpacked extension on the controlled source page.\n");

    const clickResult = await sourceSession.evaluate(`(() => {
      const bubble = document.getElementById("context-generator-bubble");
      bubble.click();
      const tiles = [...document.querySelectorAll(".context-generator-destination-tile")];
      const claudeTile = tiles.find((tile) => tile.textContent.includes("Claude"));
      if (!claudeTile) return { ok: false, destinations: tiles.map((tile) => tile.textContent.trim()) };
      claudeTile.click();
      return { ok: true };
    })()`);
    assert.equal(clickResult?.ok, true, `Claude destination tile was unavailable: ${JSON.stringify(clickResult)}`);

    await waitFor(() => state.summaryRequests.length === 1, "one summary backend request");
    const capturedConversation = state.summaryRequests[0]?.conversation || "";
    assert.match(capturedConversation, new RegExp(SOURCE_SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(capturedConversation, new RegExp(ASSISTANT_SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    process.stdout.write("✓ Capture reached the stub backend exactly once with both conversation turns.\n");

    const destinationResult = await waitFor(async () => {
      const targets = await getTargets(devToolsPort);
      const destinationTargets = targets.filter(
        (target) => target.type === "page" && target.url.startsWith(`${origin}/destination`)
      );

      for (const target of destinationTargets) {
        const candidateSession = await CdpSession.connect(target.webSocketDebuggerUrl);
        try {
          const value = await candidateSession.evaluate('document.querySelector("textarea")?.value || ""');
          if (value === SUMMARY_TEXT) return { session: candidateSession, value };
        } catch {
          // A recovery tab can still be navigating; retry it on the next poll.
        }
        candidateSession.close();
      }

      return null;
    }, "the destination paste");
    destinationSession = destinationResult.session;
    const pastedValue = destinationResult.value;
    assert.equal(pastedValue, SUMMARY_TEXT);
    await new Promise((resolve) => setTimeout(resolve, 350));
    const sendClicks = await destinationSession.evaluate("window.__capContextSmokeSendClicks");
    assert.equal(sendClicks, 0, "The extension must never press the destination Send button.");
    assert.equal(state.summaryRequests.length, 1, "The extension must send exactly one summary request per transfer.");
    process.stdout.write("✓ The exact summary was pasted and Send remained untouched.\n");
    process.stdout.write("Cap Context Brave extension smoke passed.\n");
  } catch (error) {
    if (browserOutput.trim()) error.message += `\nBrave output:\n${browserOutput.trim()}`;
    throw error;
  } finally {
    destinationSession?.close();
    sourceSession?.close();
    if (browserSession) {
      try {
        await Promise.race([
          browserSession.call("Browser.close"),
          new Promise((resolve) => setTimeout(resolve, 1000))
        ]);
      } catch {
        // The browser often closes its DevTools socket before acknowledging Browser.close.
      }
      browserSession.close();
    }
    await waitForProcessExit(braveProcess, 2000);
    if (braveProcess && braveProcess.exitCode === null) {
      braveProcess.kill();
      await waitForProcessExit(braveProcess, 2000);
    }
    await new Promise((resolve) => server.close(resolve));
    const safeTempRoot = path.resolve(tempRoot);
    const safeOsTemp = path.resolve(os.tmpdir());
    if (process.env.CAP_CONTEXT_SMOKE_KEEP_TEMP === "1") {
      process.stderr.write(`Kept smoke artifacts at ${safeTempRoot}\n`);
    } else if (safeTempRoot.startsWith(`${safeOsTemp}${path.sep}`)) {
      await fs.promises.rm(safeTempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    }
  }
}

run().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
