const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");
const { fixtures: networkFixtures, rpcFrame } = require("../test/network-json-fixtures");
const { createTelemetrySmokeFixture } = require("./telemetry-smoke-fixture");

const REPO_ROOT = path.resolve(__dirname, "..");
const SOURCE_SENTINEL = "SMOKE_USER_SENTINEL: preserve the deployment checklist.";
const ASSISTANT_SENTINEL = "SMOKE_ASSISTANT_SENTINEL: verify staging before release.";
const CHATGPT_PASTED_TEXT = `CHATGPT_PASTE_START\n${"  Original pasted line, absent from the DOM.\n".repeat(1000)}CHATGPT_PASTE_END`;
const CHATGPT_USER_PASTE = `${SOURCE_SENTINEL}\nJSON_ONLY_SENTINEL: earliest API-only turn.\n${CHATGPT_PASTED_TEXT}`;
const CHATGPT_CANVAS_TEXT = `CHATGPT_CANVAS_START\n${"  Complete canvas line, absent from the DOM.\n".repeat(500)}CHATGPT_CANVAS_MIDDLE\n${"  Final canvas line.\n".repeat(500)}CHATGPT_CANVAS_END\n`;
const CHATGPT_EXACT_CODE = '  OWN_CODE_SENTINEL\n  print("a\u00a0b")  \nCODE_END_SENTINEL';
const CLAUDE_PASTED_TEXT = `CLAUDE_PASTE_START\n${"Full pasted-card line, absent from the DOM.\n".repeat(1000)}CLAUDE_PASTE_END`;
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
const CLAUDE_PLACEMENT_SCREENSHOT_PATH = process.env.CAP_CONTEXT_CLAUDE_PLACEMENT_SCREENSHOT || "";
const CHATGPT_PLACEMENT_SCREENSHOT_PATH = process.env.CAP_CONTEXT_CHATGPT_PLACEMENT_SCREENSHOT || "";
const PROVIDER_PLACEMENT_SCREENSHOT_DIR = process.env.CAP_CONTEXT_PROVIDER_PLACEMENT_SCREENSHOT_DIR || "";
const PICKER_SCREENSHOT_PATH = process.env.CAP_CONTEXT_PICKER_SCREENSHOT || "";
const ERROR_SCREENSHOT_PATH = process.env.CAP_CONTEXT_ERROR_SCREENSHOT || "";
const JSON_SOURCE = ["chatgpt", "gemini", "grok", "deepseek"].includes(process.env.CAP_CONTEXT_JSON_SMOKE) ? process.env.CAP_CONTEXT_JSON_SMOKE : process.env.CAP_CONTEXT_JSON_SMOKE === "1" ? "claude" : null;
const NETWORK_SOURCE = ["gemini", "grok", "deepseek"].includes(JSON_SOURCE);
const GROK_FILE_ONLY_SMOKE = JSON_SOURCE === "grok" && process.env.CAP_CONTEXT_NETWORK_FAILURE_SMOKE === "file-only";
const NETWORK_FAILURE = (NETWORK_SOURCE && process.env.CAP_CONTEXT_NETWORK_FAILURE_SMOKE === "partial") || GROK_FILE_ONLY_SMOKE;
const JSON_CAPTURE_SMOKE = Boolean(JSON_SOURCE);
const CLAUDE_RELOAD_SMOKE = JSON_SOURCE === "claude" && process.env.CAP_CONTEXT_CLAUDE_RELOAD_SMOKE === "1";
const CHATGPT_RELOAD_SMOKE = JSON_SOURCE === "chatgpt" && process.env.CAP_CONTEXT_CHATGPT_RELOAD_SMOKE === "1";
const JSON_RELOAD_SMOKE = CLAUDE_RELOAD_SMOKE || CHATGPT_RELOAD_SMOKE;
const CHATGPT_FAILURE_SMOKE = JSON_SOURCE === "chatgpt" ? process.env.CAP_CONTEXT_CHATGPT_FAILURE_SMOKE || "" : "";
const CHATGPT_PASTE_AUTH_SMOKE = JSON_SOURCE === "chatgpt" && process.env.CAP_CONTEXT_CHATGPT_AUTH_SMOKE === "paste401";
const CLAUDE_PARTIAL_SMOKE = JSON_SOURCE === "claude" && process.env.CAP_CONTEXT_CLAUDE_PARTIAL_SMOKE === "1";
const JSON_FALLBACK_SMOKE = Boolean(CHATGPT_FAILURE_SMOKE || CLAUDE_PARTIAL_SMOKE || NETWORK_FAILURE);
const TELEMETRY_DATABASE_SMOKE = process.env.CAP_CONTEXT_TELEMETRY_SMOKE === "1";

class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.events = [];
    this.executionContexts = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) {
        if (message.method === "Runtime.executionContextCreated") {
          const context = message.params?.context;
          if (context) this.executionContexts.set(context.id, context);
        }
        if (message.method === "Runtime.executionContextDestroyed") this.executionContexts.delete(message.params?.executionContextId);
        if (message.method === "Runtime.executionContextsCleared") this.executionContexts.clear();
        this.events.push(message);
        if (this.events.length > 100) this.events.shift();
        return;
      }
      if (!this.pending.has(message.id)) return;
      const { resolve, reject, timeout } = this.pending.get(message.id);
      clearTimeout(timeout);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result || {});
    });
    socket.addEventListener("close", () => {
      for (const { reject, timeout } of this.pending.values()) {
        clearTimeout(timeout);
        reject(new Error("DevTools connection closed."));
      }
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

  call(method, params = {}, timeoutMs = SMOKE_TIMEOUT_MS) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      // Polling deadlines cannot help when a DevTools command itself never responds.
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`DevTools command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression, contextId = null) {
    // Compile without executing: fail locally on malformed generated JavaScript.
    new vm.Script(expression);
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

  getExtensionContextId() {
    return [...this.executionContexts.values()].filter(context => context.origin?.startsWith("chrome-extension://")).at(-1)?.id;
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
  for (const entry of manifest.content_scripts.filter(entry => !entry.js.includes("analysis-bridge.js"))) {
    addUnique(entry.matches, localMatch);
  }
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
    'const TELEMETRY_ENDPOINT_URL = "https://context-generator-five.vercel.app/api/telemetry";',
    `const TELEMETRY_ENDPOINT_URL = ${JSON.stringify(`${origin}/api/telemetry`)};`,
    "the telemetry backend URL"
  );
  for (const [platformId, productionUrl] of Object.entries(platformUrls)) {
    backgroundSource = replaceOnce(
      backgroundSource,
      `    url: ${JSON.stringify(productionUrl)}`,
      `    url: ${JSON.stringify(`${origin}/destination?${SMOKE_PLATFORM_QUERY}=${platformId}`)}`,
      `${platformId} background destination URL`
    );
  }
  backgroundSource = replaceOnce(backgroundSource,
    "    const hostname = new URL(url).hostname;",
    `    const fixtureUrl = new URL(url);
    const fixturePlatform = fixtureUrl.searchParams.get(${JSON.stringify(SMOKE_PLATFORM_QUERY)});
    if (fixtureUrl.origin === ${JSON.stringify(origin)} && Object.hasOwn(DESTINATIONS, fixturePlatform)) return fixturePlatform;
    const hostname = fixtureUrl.hostname;`,
    "the background fixture platform resolver");
  await fs.promises.writeFile(backgroundPath, backgroundSource);
  for (const file of ["network-fetch-main.js", "network-json-capture.js"]) {
    const filePath = path.join(extensionRoot, file);
    let source = await fs.promises.readFile(filePath, "utf8");
    source = replaceOnce(source, "})[location.hostname];", `})[location.hostname] || ({gemini:"gemini",grok:"grok",deepseek:"deepseek"})[new URL(location.href).searchParams.get(${JSON.stringify(SMOKE_PLATFORM_QUERY)})];`, "the network fixture source resolver");
    if (file === "network-fetch-main.js") source = source.replaceAll("https://files.deepseeksvc.com", origin);
    await fs.promises.writeFile(filePath, source);
  }
  return extensionRoot;
}

function sourceFixture(freeGrid = false) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Cap Context smoke source</title>
  <style>
    body{margin:0;min-height:100vh;background:#151515;color:#f7f7f7;font:16px system-ui}
    main{max-width:760px;margin:40px auto 160px;padding:20px}
    article{margin:18px 0;padding:18px;border:1px solid #444;border-radius:14px}
    form{position:fixed;left:50%;bottom:28px;box-sizing:border-box;width:min(720px,calc(100vw - 48px));transform:translateX(-50%);padding:16px;background:#242424;border-radius:18px}
    #prompt-textarea{min-height:36px;max-height:200px;overflow:auto;outline:none;white-space:pre-wrap}
    [data-composer-footer-responsive]{display:grid;grid-template-columns:36px minmax(0,1fr) auto;gap:8px;align-items:center}
    .gpt-right{min-width:0}
    .gpt-contents{display:contents}
    .gpt-controls{display:flex;min-width:0;align-items:center;justify-content:flex-end;flex-shrink:0}
    .gpt-model{display:flex;flex:1;min-width:0;justify-content:flex-end}
    .gpt-model-inner{display:flex;align-items:center}
    .gpt-voice-controls{display:flex;flex-shrink:0;align-items:center;gap:8px}
    .gpt-right button{height:36px;flex-shrink:0}
    .gpt-voice-controls button{width:36px}
    #gpt-voice,#gpt-send{width:44px}
    .gpt-left button{width:36px;height:36px}
    #gpt-reasoning{width:82px;min-width:0;flex-shrink:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #gpt-send{display:none}
    [hidden]{display:none!important}.hidden{display:none}
    form.has-text #gpt-send{display:block}
    form.has-text #gpt-voice{display:none}
    @media(max-width:640px){[data-composer-input]{grid-column:1/-1;grid-row:1}.gpt-left{grid-column:1;grid-row:2}.gpt-right{grid-column:3;grid-row:2}}
    ${freeGrid ? `[data-composer-grid]{display:grid;grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"leading primary trailing";gap:8px;align-items:center}
      .gpt-left{grid-area:leading}.gpt-editor{grid-area:primary}.gpt-right{grid-area:trailing;display:flex;align-items:center;gap:6px}.gpt-model{flex:initial}
      @media(max-width:640px){[data-composer-grid]{grid-template-areas:"primary primary primary" "leading . trailing"}.gpt-model-inner{display:none}}` : ""}
  </style>
</head>
<body>
  <main aria-label="Conversation">
    <article data-message-author-role="user">${SOURCE_SENTINEL}</article>
    <article data-message-author-role="assistant"><div class="markdown">${ASSISTANT_SENTINEL}</div></article>
  </main>
  <form data-testid="composer"><div ${freeGrid ? "" : "data-composer-body"}>
    <div ${freeGrid ? "data-composer-body data-composer-grid" : 'data-composer-footer-responsive data-composer-layout="single-line"'}>
      <div class="gpt-left" ${freeGrid ? 'data-composer-transition-slot="leading"' : ""}><button type="button" ${freeGrid ? 'data-testid="composer-plus-btn"' : 'data-composer-navigation-target="add-context"'} aria-label="Add files and more">+</button></div>
      <div class="gpt-editor" ${freeGrid ? "" : "data-composer-input"}><div id="prompt-textarea" data-testid="prompt-textarea" data-composer-markdown contenteditable="true" role="textbox" aria-label="Ask ChatGPT"></div></div>
      <div class="gpt-right" ${freeGrid ? 'data-composer-transition-slot="trailing"' : ""}>${freeGrid ? "" : '<div class="gpt-contents"><div class="gpt-controls">'}<div class="gpt-model"><div class="gpt-model-inner"><button type="button" id="gpt-reasoning" ${freeGrid ? 'aria-pressed="false"' : 'data-composer-navigation-target="reasoning" aria-haspopup="menu"'}>${freeGrid ? "Think" : "High"}</button></div></div><div class="gpt-voice-controls"><button type="button" aria-label="Dictate">Mic</button><button type="button" id="gpt-voice" aria-label="Start Voice">Voice</button><button type="button" id="gpt-send" data-testid="send-button" aria-label="Send">Send</button></div>${freeGrid ? "" : "</div></div>"}</div>
    </div></div></form>
    <script nonce="smoke">document.querySelector('form').addEventListener('input',e=>e.target.closest('form').classList.toggle('has-text',!!e.target.textContent.trim()));</script>
</body>
</html>`;
}

function claudePlacementFixture() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Cap Context Claude placement smoke</title>
  <style>
    body{margin:0;min-height:100vh;background:#151515;color:#f7f7f7;font:16px system-ui}
    #claude-page{position:fixed;inset:48px 12px 0}
    form{position:fixed;left:50%;bottom:80px;box-sizing:border-box;width:min(800px,calc(100vw - 32px));padding:12px;transform:translateX(-50%);background:#242424;border-radius:18px}
    #claude-host{position:relative}
    .editor-branch{padding-bottom:34px}
    [contenteditable]{min-height:40px;max-height:220px;overflow-y:auto;outline:none;white-space:pre-wrap}
    .left-row,.right-row{position:absolute;bottom:0;display:flex;align-items:center;gap:8px}
    .left-row{left:0}.right-row{right:0}
    button{box-sizing:border-box;flex-shrink:0;height:32px;width:32px}
    #model{width:109px}#voice{width:32px}
    #voice-switch{display:grid}.voice-state,.send-state{grid-area:1/1;display:flex}
    .mode-toggle{width:88px;height:32px;background:#343434;border-radius:6px;display:inline-flex;align-items:center;justify-content:center}
    .send-state{visibility:hidden;pointer-events:none}
    form.has-text .voice-state{visibility:hidden;pointer-events:none}
    form.has-text .send-state{visibility:visible;pointer-events:auto}
  </style>
</head>
<body>
  <div id="claude-page">
    <form id="claude-composer" data-cds="ChatComposer">
      <div id="claude-host">
        <div class="editor-branch"><div aria-label="Write your prompt to Claude" contenteditable="true" role="textbox"></div></div>
        <div data-cds="ChatComposerActions" style="display:contents">
          <div class="left-row"><button type="button" data-testid="chat-input-attach" aria-label="Add files">+</button><span class="mode-toggle">Chat / Cowork</span></div>
          <div class="right-row">
            <button id="model" type="button" data-testid="model-selector-dropdown" aria-label="Model selector">Sonnet</button>
            <div id="voice-switch">
              <div class="voice-state"><button id="dictate" type="button" aria-label="Dictate"></button><button id="voice" type="button" aria-label="Voice input"></button></div>
              <div class="send-state"><button id="send" type="button" data-testid="chat-input-send" aria-label="Send message"></button></div>
            </div>
          </div>
        </div>
      </div>
    </form>
  </div>
</body>
</html>`;
}

// Observed Reply variant: only Send belongs to the editor actions; attachment,
// mic and model live in a separate chin. Keep this distinct from the older
// model-only chin regression, which still leaves both action groups inside.
function claudeReplyFixture() {
  return claudePlacementFixture().replace(/<form id="claude-composer"[\s\S]*?<\/form>/, `<form id="claude-composer" data-cds="ChatComposer" data-form="reply">
    <div id="claude-host" style="position:relative;--cmp-trail-w:44px">
      <div class="editor-branch" style="padding-bottom:0;padding-right:var(--cmp-trail-w)"><div contenteditable="true" role="textbox" data-testid="chat-input" aria-label="Write your prompt to Claude"></div></div>
      <div data-cds="ChatComposerActions" style="display:contents"><div class="right-row"><button id="send" data-testid="chat-input-send" aria-label="Send message" disabled></button></div></div>
    </div>
    <div data-cds="ChatComposerChin"><div><div><div id="chin-row" style="display:flex;justify-content:space-between;align-items:center;padding:0 4px">
      <div style="display:flex"><div style="display:flex"><button data-testid="chat-input-attach" aria-label="Add files">+</button><div data-testid="chin-mic" style="display:flex"><button id="dictate" aria-label="Dictate">Mic</button><button id="voice" aria-label="Voice input">V</button></div></div></div>
      <span aria-hidden="true">Claude can make mistakes</span>
      <div style="display:flex;min-width:0"><div style="display:flex;min-width:0"><span style="display:inline-flex"><button id="model" data-testid="model-selector-dropdown" aria-label="Model selector">Sonnet</button></span></div><button style="width:64px">Manual</button></div>
    </div></div></div></div>
  </form>`).replace("</style>", '@media(max-width:640px){#chin-row>span{display:none}}</style>');
}

function providerPlacementFixture(platform) {
  const editor = platform === "deepseek"
    ? '<div class="editor"><textarea id="provider-editor" placeholder="Message DeepSeek"></textarea></div>'
    : `<${platform === "gemini" ? 'rich-textarea' : 'div data-testid="chat-input"'} class="editor"><div id="provider-editor" class="ql-editor ProseMirror query-bar-editor" contenteditable="true" role="textbox" aria-label="Provider prompt"></div></${platform === "gemini" ? 'rich-textarea' : 'div'}>`;
  const capsule = '<span class="other-pill" aria-label="Other extension">C</span>';
  const modes = '<span class="modes">DeepThink · Search</span>';
  const model = platform === "gemini"
    ? '<div class="model-wrapper"><button data-test-id="bard-mode-menu-button" id="provider-anchor">Flash</button></div>'
    : '<div data-query-bar-mode-select class="model-wrapper"><button id="model-select-trigger" data-anchor>Fast</button></div>';
  const actions = `<button class="voice">Mic</button>${capsule}<button class="send">Send</button>`;
  const content = platform === "gemini"
    ? `<div class="text-input-field">${editor}<div class="leading"><button>+</button></div><div class="trailing-actions-wrapper">${model}<div class="actions">${actions}</div></div></div>`
    : platform === "grok"
      ? `<div class="query-bar"><div class="native-grok-space">${editor}<div class="native-grok-dock"><div class="provider-row"><div><button data-testid="attach-button">+</button></div><div class="right-controls">${model}${actions}</div></div></div></div></div>`
      : `<div class="deepseek-composer">${editor}<div class="provider-row">${modes}<div class="right-controls">${capsule}<div role="button" id="provider-anchor" class="ds-button">+</div><input type="file" hidden><div class="send-wrapper"><div role="button" class="ds-button--circle">Send</div></div></div></div></div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${platform} inline smoke</title><style>
    *{box-sizing:border-box}body{margin:0;background:#151515;color:#eee;font:16px system-ui}
    form{position:fixed;bottom:40px;left:50%;transform:translateX(-50%);width:min(720px,calc(100vw - 32px));padding:12px;background:#242424;border-radius:20px}
    button,.ds-button,.ds-button--circle,.other-pill{height:36px;min-width:36px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
    .other-pill{background:#555;border-radius:50%;width:32px;min-width:32px;height:32px}
    .model-wrapper{flex-shrink:0}.model-wrapper button{width:96px}
    .editor{display:block;min-width:0}#provider-editor{display:block;outline:none;min-height:40px;max-height:180px;overflow:auto;white-space:pre-wrap;width:100%;resize:none;background:transparent;color:inherit;border:0;font:inherit}
    .provider-row,.right-controls,.trailing-actions-wrapper,.actions{display:flex;align-items:center;gap:4px}
    .provider-row{justify-content:space-between}.right-controls{margin-left:auto;flex-shrink:0}.modes{white-space:nowrap}
    [hidden]{display:none!important}.hidden{display:none}
    .text-input-field{display:grid;grid-template-columns:40px minmax(0,1fr) auto;align-items:center;gap:8px}.text-input-field>.editor{grid-column:2;grid-row:1}.leading{grid-column:1;grid-row:1}.trailing-actions-wrapper{grid-column:3;grid-row:1}
    .native-grok-space{position:relative;padding-bottom:56px}.native-grok-dock{position:absolute;bottom:0;width:100%;padding:10px 0}.native-grok-dock>.provider-row{width:100%}
    .deepseek-composer{display:flex;flex-direction:column;gap:10px}
    @media(max-width:640px){.text-input-field>.editor{grid-column:1/-1;grid-row:1}.leading,.trailing-actions-wrapper{grid-row:2}.trailing-actions-wrapper>.model-wrapper{display:none}}
  </style></head><body><form data-testid="composer">${content}</form></body></html>`;
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

function chatGptTreeFixture() {
  const mapping = { root: { id: "root", parent: null, message: null } };
  let parent = "root";
  // A long tree with older API-only turns; the rendered fixture has two turns.
  for (let i = 0; i < 60; i++) {
    const user = `user-${i}`, assistant = `assistant-${i}`;
    mapping[user] = { id: user, parent, message: { author: { role: "user" }, status: "finished_successfully", ...(i === 0 ? { metadata: { attachments: [{ id: "file_smoke_paste", is_big_paste: true, mime_type: "text/plain", size: Buffer.byteLength(CHATGPT_USER_PASTE) }] } } : {}), content: { content_type: "multimodal_text", parts: [i === 0 ? "" : `User history ${i}`, { content_type: "image_asset_pointer", text: "UNSUPPORTED_SENTINEL" }] } } };
    mapping[assistant] = { id: assistant, parent: user, message: { author: { role: "assistant" }, status: "finished_successfully", metadata: { is_complete: true }, content: { content_type: "text", parts: [i === 59 ? ASSISTANT_SENTINEL : `Assistant history ${i}`] } } };
    parent = assistant;
  }
  mapping.tool = { parent, message: { author: { role: "tool" }, content: { content_type: "text", parts: ["UNSUPPORTED_SENTINEL"] } } };
  mapping.recap = { parent: "tool", message: { author: { role: "assistant" }, content: { content_type: "reasoning_recap", content: "OWN_RECAP_SENTINEL" } } };
  mapping.thought = { parent: "recap", message: { author: { role: "assistant" }, content: { content_type: "thoughts", thoughts: [{ content: "OWN_THOUGHT_SENTINEL", summary: "UNSUPPORTED_SENTINEL", finished: true }] } } };
  mapping.canvas = { parent: "thought", message: { author: { role: "assistant" }, recipient: "canmore.create_textdoc", status: "finished_successfully", end_turn: false, content: { content_type: "code", text: JSON.stringify({ name: "Smoke document", type: "document", content: CHATGPT_CANVAS_TEXT }) } } };
  mapping.canvasResult = { parent: "canvas", message: { author: { role: "tool", name: "canmore.create_textdoc" }, status: "finished_successfully", content: { content_type: "text", parts: ["UNSUPPORTED_SENTINEL"] }, metadata: { command: "create_textdoc", canvas: { textdoc_id: "smoke-document", textdoc_type: "document", version: 1 } } } };
  mapping.canvasEdit = { parent: "canvasResult", message: { author: { role: "assistant" }, recipient: "canmore.update_textdoc", status: "finished_successfully", end_turn: false, content: { content_type: "text", parts: [JSON.stringify({ updates: [{ pattern: "UNSUPPORTED_SENTINEL", replacement: "OWN_CANVAS_EDIT_SENTINEL" }] })] } } };
  mapping.canvasEditResult = { parent: "canvasEdit", message: { author: { role: "tool", name: "canmore.update_textdoc" }, status: "finished_successfully", content: { content_type: "text", parts: ["UNSUPPORTED_SENTINEL"] }, metadata: { command: "update_textdoc", canvas: { textdoc_id: "smoke-document", textdoc_type: "document", version: 2, from_version: 1 } } } };
  // Explicit voice transcript objects are own text; pointer metadata is not.
  mapping.voiceUser = { parent: "canvasEditResult", message: { author: { role: "user" }, content: { content_type: "multimodal_text", parts: [{ content_type: "audio_transcription", text: "OWN_VOICE_USER_SENTINEL", direction: "in" }, { content_type: "audio_asset_pointer", text: "UNSUPPORTED_SENTINEL" }] } } };
  mapping.voiceAssistant = { parent: "voiceUser", message: { author: { role: "assistant" }, content: { content_type: "multimodal_text", parts: [{ content_type: "audio_transcription", text: "OWN_VOICE_ASSISTANT_SENTINEL", direction: "out" }] } } };
  mapping.code = { parent: "voiceAssistant", message: { author: { role: "assistant" }, status: "finished_partial", end_turn: false, content: { content_type: "code", text: CHATGPT_EXACT_CODE, language: "python" } } };
  mapping.alternate = { parent: "root", message: { author: { role: "assistant" }, content: { content_type: "text", parts: ["INACTIVE_BRANCH_SENTINEL"] } } };
  const data = { conversation_id: "smoke", current_node: "code", mapping, context_truncation_continuation: null };
  if (CHATGPT_FAILURE_SMOKE === "partial") data.has_previous_page = true;
  if (CHATGPT_FAILURE_SMOKE === "streaming") mapping.code.message.status = "in_progress";
  return data;
}

async function startFixtureServer() {
  const state = { summaryRequests: [], jsonRequests: 0, sessionRequests: 0, pasteDescriptorRequests: 0, pasteContentRequests: 0, chatgptRequestUrls: [], claudeRequestUrls: [] };
  const telemetryFixture = await createTelemetrySmokeFixture(REPO_ROOT, TELEMETRY_DATABASE_SMOKE);
  state.telemetryRequests = telemetryFixture.received;
  const network = NETWORK_SOURCE ? networkFixtures(JSON_SOURCE) : null;
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    response.setHeader("Cache-Control", "no-store");
    if (url.pathname === "/free-placement") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(url.searchParams.get(SMOKE_PLATFORM_QUERY) === "claude" ? claudeReplyFixture() : sourceFixture(true));
      return;
    }
    if (url.pathname === "/provider-placement") {
      const platform = url.searchParams.get(SMOKE_PLATFORM_QUERY);
      assert.ok(["gemini", "grok", "deepseek"].includes(platform));
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(providerPlacementFixture(platform));
      return;
    }
    if (NETWORK_SOURCE && url.pathname === "/api/v0/session") {
      response.writeHead(200, { "Content-Type": "application/json" }); response.end("{}"); return;
    }
    if (NETWORK_SOURCE && url.pathname === "/api/file") {
      state.pasteContentRequests++;
      assert.equal(request.headers.authorization, undefined);
      response.writeHead(200, { "Content-Type": "application/octet-stream" }); response.end(network.files[network.file.id]); return;
    }
    if (NETWORK_SOURCE && ["/_/BardChatUi/data/batchexecute", "/rest/app-chat/conversations/smoke/response-node", "/rest/app-chat/conversations/smoke/load-responses", "/api/v0/chat/history_messages"].includes(url.pathname)) {
      state.jsonRequests++;
      response.writeHead(200, { "Content-Type": "application/json" });
      if (JSON_SOURCE === "gemini") {
        let raw = ""; for await (const chunk of request) raw += chunk;
        const form = new URLSearchParams(raw), args = JSON.parse(JSON.parse(form.get("f.req"))[0][0][1]);
        assert.equal(form.get("at"), "CSRF_SENTINEL"); assert.equal(args[0], "c_smoke");
        const index = args[2] ? Number(args[2].split("_")[1]) : 0;
        const page = structuredClone(network.pages[index]);
        if (NETWORK_FAILURE) page.cursor = null; // Missing root must still fail.
        response.end(rpcFrame(page));
      } else if (JSON_SOURCE === "grok") {
        if (url.pathname.endsWith("response-node")) response.end(JSON.stringify(network.nodes));
        else {
          const responses = structuredClone(network.responses);
          if (GROK_FILE_ONLY_SMOKE) Object.assign(responses[0], { message: "", fileAttachments: ["smoke-file-id"] });
          response.end(JSON.stringify({ responses: NETWORK_FAILURE && !GROK_FILE_ONLY_SMOKE ? responses.slice(1) : responses }));
        }
      } else {
        assert.equal(request.headers.authorization, "Bearer AUTH_SENTINEL"); assert.equal(request.headers["x-device-id"], undefined);
        const data = structuredClone(network.data);
        if (NETWORK_FAILURE) { data.data.biz_data.cache_control = "MERGE"; data.data.biz_data.chat_messages = []; }
        response.end(JSON.stringify(data));
      }
      return;
    }
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
      const receipt = await telemetryFixture.signSummary(state.summaryRequests.at(-1)?.telemetry);
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json"
      });
      response.end(JSON.stringify({
        summary: SUMMARY_TEXT,
        ...receipt,
        timing: { inputChars: state.summaryRequests.at(-1)?.conversation?.length || 0, servedBy: "smoke-stub" }
      }));
      return;
    }
    if (request.method === "POST" && ["/api/telemetry", "/smoke/transfer-telemetry"].includes(url.pathname)) {
      let rawBody = "";
      for await (const chunk of request) rawBody += chunk;
      if (url.pathname === "/api/telemetry") await telemetryFixture.handleTelemetry(request, response, rawBody);
      else await telemetryFixture.handleEdge(request, response, rawBody);
      return;
    }
    if (url.pathname === "/api/auth/session") {
      state.sessionRequests++;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ accessToken: CHATGPT_PASTE_AUTH_SMOKE && state.pasteDescriptorRequests ? "smoke-refreshed" : "smoke-only", account: { id: "smoke-account" }, sessionToken: "SESSION_TOKEN_MUST_NOT_LEAVE_MAIN" }));
      return;
    }
    if (url.pathname === "/backend-api/files/download/file_smoke_paste") {
      state.pasteDescriptorRequests++;
      if (CHATGPT_PASTE_AUTH_SMOKE && state.pasteDescriptorRequests === 1) {
        response.writeHead(401, { "Content-Type": "application/json" }); response.end("{}"); return;
      }
      assert.equal(request.headers.authorization, CHATGPT_PASTE_AUTH_SMOKE ? "Bearer smoke-refreshed" : "Bearer smoke-only");
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "success", file_size_bytes: Buffer.byteLength(CHATGPT_USER_PASTE), download_url: `http://${request.headers.host}/backend-api/estuary/content?id=file_smoke_paste&sig=SIGNED_PASTE_SENTINEL` }));
      return;
    }
    if (url.pathname === "/backend-api/estuary/content" && url.searchParams.get("id") === "file_smoke_paste") {
      state.pasteContentRequests++;
      assert.equal(request.headers.authorization, undefined, "Signed paste content must not receive bearer headers.");
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(CHATGPT_USER_PASTE);
      return;
    }
    if (["/backend-api/conversation/smoke", "/backend-api/conversations/smoke"].includes(url.pathname)) {
      state.jsonRequests++;
      state.chatgptRequestUrls.push(url.pathname + url.search);
      assert.equal(request.headers.authorization, "Bearer smoke-only", "The full-tree read must reuse page/session auth.");
      const full = url.pathname === "/backend-api/conversation/smoke";
      if (full) {
        assert.equal(request.headers["chatgpt-account-id"], "smoke-account");
        assert.equal(url.search, "", "The full-tree URL must not carry recent-page parameters.");
      }
      response.writeHead(full && CHATGPT_FAILURE_SMOKE === "ranged" ? 206 : 200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(full ? chatGptTreeFixture() : { messages: [], page_info: { has_previous_page: true } }));
      return;
    }
    if (url.pathname === "/api/organizations/smoke/chat_conversations/smoke") {
      state.jsonRequests++;
      state.claudeRequestUrls.push(url.href);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        uuid: "smoke", current_leaf_message_uuid: "assistant",
        ...(CLAUDE_PARTIAL_SMOKE ? { truncated: true } : {}),
        chat_messages: [
          { uuid: "user", sender: "human", parent_message_uuid: null, content: [{ type: "text", text: `${SOURCE_SENTINEL}\nJSON_ONLY_SENTINEL: loaded from the API, absent from the DOM.` }], attachments: [
            { file_name: "", file_type: "txt", extracted_content: CLAUDE_PASTED_TEXT },
            { file_name: "upload.txt", file_type: "txt", extracted_content: "CLAUDE_ATTACHMENT_IGNORED_SENTINEL" },
            { file_name: "", file_type: "image/png", extracted_content: "CLAUDE_ATTACHMENT_IGNORED_SENTINEL" }
          ] },
          { uuid: "assistant", sender: "assistant", parent_message_uuid: "user", content: [{ type: "text", text: ASSISTANT_SENTINEL }] }
        ]
      }));
      return;
    }
    if (["/source", "/chat/smoke", "/c/smoke", "/app/smoke", "/a/chat/s/smoke"].includes(url.pathname)) {
      if (url.pathname !== "/source") response.setHeader("Content-Security-Policy", "script-src 'nonce-smoke'; object-src 'none'; base-uri 'none'; connect-src 'self'");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      let page = url.pathname === "/chat/smoke"
        // Claude JSON must work before native history mounts. The API still
        // returns the full ordered conversation, including the pasted card.
        ? claudePlacementFixture()
        : sourceFixture();
      // Failure scenarios need mounted DOM history to verify the fallback.
      // Successful JSON scenarios still prove capture before native turns mount.
      if (JSON_FALLBACK_SMOKE && JSON_SOURCE === "claude") {
        page = page.replace("</body>", `${sourceFixture().match(/<main[\s\S]*?<\/main>/)[0]}</body>`);
      }
      if (JSON_FALLBACK_SMOKE && NETWORK_SOURCE) {
        page = page.replace('data-message-author-role="user"', 'class="query-text message" data-message-author-role="user"')
          .replace('data-message-author-role="assistant"', 'class="response-content message" data-message-author-role="assistant"');
      }
      if (NETWORK_SOURCE) {
        const boot = JSON_SOURCE === "gemini" ? `window.WIZ_global_data={SNlM0e:"CSRF_SENTINEL"};const xhr=new XMLHttpRequest();xhr.open("POST","/_/BardChatUi/data/batchexecute?rpcids=hNvQHb");xhr.send(new URLSearchParams({at:"CSRF_SENTINEL","f.req":JSON.stringify([[["hNvQHb",JSON.stringify(["c_smoke",10,null,1,[1],[4],null,1]),null,"generic"]]])}));`
          : JSON_SOURCE === "deepseek" ? 'const xhr=new XMLHttpRequest();xhr.open("GET","/api/v0/session");xhr.setRequestHeader("Authorization","Bearer AUTH_SENTINEL");xhr.setRequestHeader("x-device-id","CACHE_DEVICE");xhr.send();' : "";
        response.end(page.replace("</body>", `<script nonce="smoke">${boot}</script></body>`)); return;
      }
      response.end(url.pathname === "/c/smoke"
        ? page.replace("</body>", '<script nonce="smoke">fetch("/backend-api/conversations/smoke?num_turns=10", {headers:{Authorization:"Bearer smoke-only","ChatGPT-Account-Id":"smoke-account"}});</script></body>')
        : url.pathname === "/chat/smoke"
        ? page.replace("</body>", '<script nonce="smoke">fetch("/api/organizations/smoke/chat_conversations/smoke?tree=True");</script></body>')
        : page);
      return;
    }
    if (url.pathname === "/new") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(claudePlacementFixture());
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
  const origin = `http://127.0.0.1:${address.port}`;
  telemetryFixture.configure(origin);
  return {
    server,
    state,
    origin,
    telemetryFixture
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

async function verifyPickerProductChanges(session, state) {
  const requestsBefore = [state.summaryRequests.length, state.jsonRequests];
  const pressTab = async (shift = false) => {
    for (const type of ["keyDown", "keyUp"]) {
      await session.call("Input.dispatchKeyEvent", {
        type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: shift ? 8 : 0
      });
    }
  };
  // Real browser navigation catches focus behavior that tabindex source checks miss.
  for (const shift of [false, true]) {
    await session.evaluate(`document.querySelector('[contenteditable="true"], textarea').focus()`);
    for (let step = 0; step < 8; step++) {
      await pressTab(shift);
      assert.equal(await session.evaluate(`document.activeElement?.id === "context-generator-bubble"`), false,
        "Tab and Shift+Tab must skip the composer orb.");
    }
  }
  await session.evaluate('document.getElementById("context-generator-bubble").click()');
  await waitFor(() => session.evaluate('getComputedStyle(document.getElementById("context-generator-destination-sheet")).opacity === "1"'), "the product picker");
  const orbPoint = await session.evaluate(`(() => {
    const rect = document.getElementById("context-generator-bubble").getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  for (const type of ["mousePressed", "mouseReleased"]) {
    await session.call("Input.dispatchMouseEvent", { type, ...orbPoint, button: "left", clickCount: 1 });
  }
  await waitFor(() => session.evaluate('document.getElementById("context-generator-destination-sheet").style.display === "none"'),
    "picker dismissal through a real orb click");
  assert.equal(await session.evaluate('document.getElementById("context-generator-destination-backdrop").style.clipPath'), "",
    "Dismissal must release the backdrop cutout.");
  await session.evaluate('document.getElementById("context-generator-bubble").click()');
  await waitFor(() => session.evaluate('getComputedStyle(document.getElementById("context-generator-destination-sheet")).opacity === "1"'),
    "the reopened product picker");
  const product = await session.evaluate(`(() => {
    const sheet = document.getElementById("context-generator-destination-sheet");
    const home = sheet.querySelector(".context-generator-destination-home-link");
    const controls = [...sheet.querySelectorAll(".context-generator-destination-tile, .context-generator-speed-toggle")]
      .filter(node => !node.disabled && node.getAttribute("aria-disabled") !== "true");
    controls[0].focus();
    const toggle = sheet.querySelector(".context-generator-speed-toggle");
    window.__smokeSpeedWasEnabled = toggle.getAttribute("aria-pressed") === "true";
    if (!window.__smokeSpeedWasEnabled) toggle.click();
    return { href: home.href, target: home.target, rel: home.rel, label: home.getAttribute("aria-label"),
      homeTabIndex: home.tabIndex, bubbleTabIndex: document.getElementById("context-generator-bubble").tabIndex,
      controlCount: controls.length,
      trailCount: sheet.querySelectorAll(".context-generator-speed-lines i").length };
  })()`);
  const orbVisibleThroughBackdrop = `(() => {
    const orb = document.getElementById("context-generator-bubble");
    const rect = orb.getBoundingClientRect();
    return document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) === orb
      && getComputedStyle(document.getElementById("context-generator-destination-backdrop")).clipPath !== "none";
  })()`;
  assert.equal(await session.evaluate(orbVisibleThroughBackdrop), true,
    "The open picker must leave the real orb above the backdrop's hit-test/blur region.");
  assert.equal(product.href, "https://context-generator-five.vercel.app/");
  assert.equal(product.target, "_blank");
  assert.match(product.rel, /noopener/);
  assert.match(product.label, /Cap Context/);
  assert.equal(product.homeTabIndex, -1);
  assert.equal(product.bubbleTabIndex, -1);
  const focusedPickerIndex = `(() => {
    const sheet = document.getElementById("context-generator-destination-sheet");
    return [...sheet.querySelectorAll(".context-generator-destination-tile, .context-generator-speed-toggle")]
      .filter(node => !node.disabled && node.getAttribute("aria-disabled") !== "true")
      .indexOf(document.activeElement);
  })()`;
  await pressTab(true);
  assert.equal(await session.evaluate(focusedPickerIndex), product.controlCount - 1);
  await pressTab();
  assert.equal(await session.evaluate(focusedPickerIndex), 0);
  for (const shift of [false, true]) {
    const reached = new Set();
    for (let step = 0; step < product.controlCount; step++) {
      await pressTab(shift);
      const index = await session.evaluate(focusedPickerIndex);
      assert.ok(index >= 0, "Picker keyboard navigation must stay on destinations and Speed, skipping both orbs.");
      reached.add(index);
    }
    assert.equal(reached.size, product.controlCount, "Every enabled picker control must remain reachable.");
  }
  assert.equal(product.trailCount, 3);
  if (PICKER_SCREENSHOT_PATH) {
    const clip = await session.evaluate(`(() => {
      const sheet = document.getElementById("context-generator-destination-sheet").getBoundingClientRect();
      const orb = document.getElementById("context-generator-bubble").getBoundingClientRect();
      const x = Math.max(0, Math.min(sheet.left, orb.left) - 18);
      const y = Math.max(0, Math.min(sheet.top, orb.top) - 18);
      return { x, y, width: Math.min(innerWidth - x, Math.max(sheet.right, orb.right) + 18 - x),
        height: Math.min(innerHeight - y, Math.max(sheet.bottom, orb.bottom) + 18 - y), scale: 1 };
    })()`);
    const screenshot = await session.call("Page.captureScreenshot", { format: "png", clip });
    await fs.promises.mkdir(path.dirname(PICKER_SCREENSHOT_PATH), { recursive: true });
    await fs.promises.writeFile(PICKER_SCREENSHOT_PATH, Buffer.from(screenshot.data, "base64"));
  }
  await waitFor(() => session.evaluate(`(() => {
    const line = document.querySelector(".context-generator-speed-lines i");
    return line.getAnimations().some(animation => animation.playState === "running" && animation.currentTime > 0);
  })()`), "the moving lightning trails");
  await session.evaluate('document.querySelector(".context-generator-speed-toggle").click()');
  assert.equal(await session.evaluate('getComputedStyle(document.querySelector(".context-generator-speed-lines")).display'), "none");
  await session.evaluate('document.querySelector(".context-generator-speed-toggle").click()');
  await session.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await session.evaluate('getComputedStyle(document.querySelector(".context-generator-speed-lines i")).animationName'), "none");
  await session.call("Emulation.setEmulatedMedia", { features: [] });
  for (const width of [390, 320]) {
    // Resize intentionally closes inline-owned pickers; reopen on the remounted pill.
    await session.call("Emulation.setDeviceMetricsOverride", { width, height: 740, deviceScaleFactor: 1, mobile: false });
    await waitFor(() => session.evaluate('getComputedStyle(document.getElementById("context-generator-destination-sheet")).display === "none"'), "picker closure on resize");
    await session.evaluate('document.getElementById("context-generator-bubble").click()');
    await waitFor(() => session.evaluate('getComputedStyle(document.getElementById("context-generator-destination-sheet")).opacity === "1"'), "the narrow picker");
    assert.equal(await session.evaluate(`(() => {
      const r = document.getElementById("context-generator-destination-sheet").getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth;
    })()`), true, `Picker must fit at ${width}px.`);
    assert.equal(await session.evaluate(orbVisibleThroughBackdrop), true, `Orb must stay clear/clickable at ${width}px.`);
  }
  await session.evaluate(`(() => {
    const toggle = document.querySelector(".context-generator-speed-toggle");
    if ((toggle.getAttribute("aria-pressed") === "true") !== window.__smokeSpeedWasEnabled) toggle.click();
    delete window.__smokeSpeedWasEnabled;
    document.getElementById("context-generator-destination-backdrop").click();
  })()`);
  await session.call("Emulation.clearDeviceMetricsOverride");
  await waitFor(() => session.evaluate(`document.activeElement?.matches('[contenteditable="true"], textarea')`),
    "native composer focus after picker dismissal");
  assert.deepEqual([state.summaryRequests.length, state.jsonRequests], requestsBefore, "Picker interaction must not read or send chat content.");
  process.stdout.write("✓ Orb stays clear/clickable through picker reopen/narrow layouts; native Tab skips both orbs, focus/motion pass.\n");
}

async function verifyEmptyChatError(session, browserSession, state, { removeTurns = false, screenshot = false } = {}) {
  const before = { summaries: state.summaryRequests.length, json: state.jsonRequests, tabs: (await browserSession.call("Target.getTargets")).targetInfos.filter(t => t.type === "page").length };
  await session.evaluate(`(() => {
    window.__emptySmokeOriginal = { url: location.href, html: document.querySelector("main")?.innerHTML };
    if (${removeTurns}) {
      document.querySelector("main").innerHTML = "";
      history.replaceState({}, "", "/?${SMOKE_PLATFORM_QUERY}=chatgpt");
    }
    window.__emptySmokeHandoffShown = false;
    window.__emptySmokeEnteredFromRight = false;
    window.__emptySmokeObserver = new MutationObserver(() => {
      if (document.getElementById("context-generator-overlay")?.style.display === "flex") window.__emptySmokeHandoffShown = true;
      const error = document.getElementById("context-generator-error-overlay");
      if (error?.style.display === "flex" && error.getAttribute("aria-hidden") === "false"
        && new DOMMatrix(getComputedStyle(error).transform).m41 > 0) window.__emptySmokeEnteredFromRight = true;
    });
    window.__emptySmokeObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
  })()`);
  // The empty-chat fixture changes routes without replacing the editor. Let
  // navigation mounting settle before opening a picker owned by the new route.
  await session.evaluate(`new Promise(resolve => {
    dispatchEvent(new PopStateEvent('popstate'));
    requestAnimationFrame(() => requestAnimationFrame(() => {
      document.getElementById('context-generator-bubble').click(); resolve();
    }));
  })`);
  await waitFor(() => session.evaluate(`getComputedStyle(document.getElementById("context-generator-destination-sheet")).opacity === "1"`), "empty-chat picker");
  await session.evaluate(`(() => {
    document.querySelector(".context-generator-destination-tile").click();
  })()`);
  await waitFor(() => session.evaluate(`(() => { const e = document.getElementById("context-generator-error-overlay"); return e?.style.display === "flex" && getComputedStyle(e).opacity === "1"; })()`), "direct empty-chat error");
  const result = await session.evaluate(`(() => {
    const error = document.getElementById("context-generator-error-overlay");
    const rect = error.getBoundingClientRect();
    return { title: document.getElementById("context-generator-error-title").textContent,
      message: document.getElementById("context-generator-error-text").textContent,
      handoffShown: window.__emptySmokeHandoffShown,
      sheetHidden: document.getElementById("context-generator-destination-sheet").style.display === "none",
      insideViewport: rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight,
      bottomRight: Math.abs(document.documentElement.clientWidth - rect.right - 20) < 1 && Math.abs(innerHeight - rect.bottom - 80) < 1,
      bounds: { right: rect.right, bottom: rect.bottom, width: document.documentElement.clientWidth, height: innerHeight },
      enteredFromRight: window.__emptySmokeEnteredFromRight,
      role: error.getAttribute("role") };
  })()`);
  assert.equal(result.title, "Chat is empty");
  assert.equal(result.message, "Send a message first, then try again.");
  assert.equal(result.handoffShown, false, "Empty chat must never flash the handoff.");
  assert.equal(result.sheetHidden && result.insideViewport && result.bottomRight && result.enteredFromRight, true, JSON.stringify(result));
  assert.equal(result.role, "alert");
  assert.equal(state.summaryRequests.length, before.summaries);
  assert.equal(state.jsonRequests, before.json);
  assert.equal((await browserSession.call("Target.getTargets")).targetInfos.filter(t => t.type === "page").length, before.tabs, "Empty chat must not open a destination.");
  if (screenshot && ERROR_SCREENSHOT_PATH) {
    const capture = await session.call("Page.captureScreenshot", { format: "png" });
    await fs.promises.mkdir(path.dirname(ERROR_SCREENSHOT_PATH), { recursive: true });
    await fs.promises.writeFile(ERROR_SCREENSHOT_PATH, Buffer.from(capture.data, "base64"));
  }
  assert.equal(await session.evaluate(`(() => {
    const error = document.getElementById("context-generator-error-overlay");
    error.querySelector("button").click();
    return new DOMMatrix(error.style.transform).m41 === 24 && error.style.opacity === "0";
  })()`), true, "Dismissal must fade towards the right.");
  await waitFor(() => session.evaluate(`document.getElementById("context-generator-error-overlay").style.display === "none"`), "completed toast dismissal");
  // Starting again cancels old error dismissal/reveal work. Reduced motion
  // must also reveal and dismiss immediately, without intermediate movement.
  await session.call("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  assert.equal(await session.evaluate(`(() => {
    document.getElementById("context-generator-bubble").click();
    const error = document.getElementById("context-generator-error-overlay");
    const previousHidden = error.style.display === "none";
    document.querySelector(".context-generator-destination-tile").click();
    const immediateError = error.style.opacity === "1" && error.style.transition === "none";
    error.querySelector("button").click();
    return previousHidden && immediateError && error.style.display === "none";
  })()`), true, "Reduced motion and repeated attempts must not flash stale errors.");
  await session.call("Emulation.setEmulatedMedia", { features: [] });
  await session.evaluate(`(() => {
    window.__emptySmokeObserver.disconnect();
    if (${removeTurns}) document.querySelector("main").innerHTML = window.__emptySmokeOriginal.html;
    history.replaceState({}, "", window.__emptySmokeOriginal.url);
  })()`);
}

async function run() {
  assert.equal(typeof WebSocket, "function", "This smoke test requires Node.js with the built-in WebSocket client.");
  const braveExecutable = findBraveExecutable();
  const { server, state, origin, telemetryFixture } = await startFixtureServer();
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cap-context-brave-smoke-"));
  const profileRoot = path.join(tempRoot, "profile");
  let braveProcess = null;
  let browserSession = null;
  let sourceSession = null;
  let claudePlacementSession = null;
  let destinationSession = null;
  let browserOutput = "";

  try {
    const extensionRoot = await createSmokeExtension(tempRoot, origin);
    const sourcePath = JSON_SOURCE === "gemini" ? "/app/smoke" : JSON_SOURCE === "deepseek" ? "/a/chat/s/smoke" : JSON_SOURCE === "grok" || JSON_SOURCE === "chatgpt" ? "/c/smoke" : JSON_SOURCE === "claude" ? "/chat/smoke" : "/source";
    const sourceUrl = `${origin}${sourcePath}?${SMOKE_PLATFORM_QUERY}=${JSON_SOURCE || "chatgpt"}`;
    braveProcess = spawn(braveExecutable, [
      `--user-data-dir=${profileRoot}`,
      ...(JSON_RELOAD_SMOKE ? [] : [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`]),
      "--remote-debugging-port=0",
      "--remote-allow-origins=*",
      ...(JSON_RELOAD_SMOKE ? ["--enable-unsafe-extension-debugging"] : []),
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
    if (JSON_RELOAD_SMOKE) await browserSession.call("Extensions.loadUnpacked", { path: extensionRoot });
    // MV3 workers may suspend before DevTools enumerates them. The injected
    // bubble and full transfer below prove both content and worker startup.
    const sourceTarget = await waitFor(async () => {
      const targets = await getTargets(devToolsPort);
      return targets.find((target) => target.type === "page" && target.url.startsWith(`${origin}${sourcePath}`));
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
    if (!JSON_CAPTURE_SMOKE) {
      await verifyEmptyChatError(sourceSession, browserSession, state, { removeTurns: true, screenshot: true });
      process.stdout.write("✓ Empty ChatGPT shows its error directly, opens no destination, and supports repeated attempts/reduced motion.\n");
    }

    if (!JSON_SOURCE || JSON_SOURCE === "chatgpt") {
      const originalDraft = await sourceSession.evaluate(`document.getElementById('prompt-textarea').textContent`);
      for (const draft of ["", Array.from({length:12},(_,i)=>'Inline draft line '+i).join('\n')]) {
        await sourceSession.evaluate(`(() => {
          const input = document.getElementById('prompt-textarea');
          input.textContent = ${JSON.stringify(draft)};
          input.dispatchEvent(new Event('input',{bubbles:true}));
        })()`);
        for (const width of [760, 390, 320]) {
          await sourceSession.call("Emulation.setDeviceMetricsOverride", { width, height: 740, deviceScaleFactor: 1, mobile: false });
          const inline = await waitFor(() => sourceSession.evaluate(`(() => {
            const b=document.getElementById('context-generator-bubble'),r=b.getBoundingClientRect();
            const native=[...document.querySelector('.gpt-right').querySelectorAll('button')]
              .filter(n=>n!==b&&getComputedStyle(n).display!=='none').map(n=>n.getBoundingClientRect());
            const model=document.getElementById('gpt-reasoning'),m=model.getBoundingClientRect();
            const style=getComputedStyle(b);
            // The shipped branch isolates the native model hover wrapper.
            return b.nextElementSibling===model.closest('.gpt-model')
              ? {width:parseFloat(style.width),position:style.position,
                 besideModel:r.right<=m.left&&Math.abs((r.top+r.bottom-m.top-m.bottom)/2)<1,
                 overlap:native.some(n=>r.left<n.right&&r.right>n.left&&r.top<n.bottom&&r.bottom>n.top),
                 send:getComputedStyle(document.getElementById('gpt-send')).display!=='none',
                 voice:getComputedStyle(document.getElementById('gpt-voice')).display!=='none',
                 inside:r.left>=0&&r.right<=innerWidth} : null;
          })()`), "ChatGPT inline mounting");
          assert.equal(inline.width, 36);
          assert.equal(inline.position, "static");
          assert.equal(inline.besideModel, true);
          assert.equal(inline.overlap, false, `ChatGPT overlaps native controls at ${width}px.`);
          assert.equal(inline.send, Boolean(draft));
          assert.equal(inline.voice, !draft);
          assert.equal(inline.inside, true);
        }
      }
      if (CHATGPT_PLACEMENT_SCREENSHOT_PATH) {
        const capture=await sourceSession.call("Page.captureScreenshot",{format:"png"});
        await fs.promises.mkdir(path.dirname(CHATGPT_PLACEMENT_SCREENSHOT_PATH),{recursive:true});
        await fs.promises.writeFile(CHATGPT_PLACEMENT_SCREENSHOT_PATH,Buffer.from(capture.data,"base64"));
      }
      await sourceSession.call("Emulation.clearDeviceMetricsOverride");
      await sourceSession.evaluate(`(() => {
        window.__gptSmokeButton=document.getElementById('context-generator-bubble');
        const footer=document.querySelector('[data-composer-footer-responsive]'),duplicate=footer.cloneNode(false);
        duplicate.id='gpt-duplicate-footer';duplicate.style.display='none';footer.before(duplicate);
        const attach=footer.querySelector('[data-composer-navigation-target="add-context"]'),hidden=attach.cloneNode(true);
        hidden.id='gpt-hidden-attach';hidden.style.display='none';attach.before(hidden);
        const menu=document.createElement('div');menu.id='gpt-decoy-menu';menu.setAttribute('role','menu');
        menu.appendChild(attach.cloneNode(true));attach.before(menu);
        return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      })()`);
      assert.equal(await sourceSession.evaluate(`getComputedStyle(window.__gptSmokeButton).position==='static'
        && window.__gptSmokeButton.nextElementSibling===document.querySelector('.gpt-model')`),true,"ChatGPT duplicate controls must not force fallback.");
      await sourceSession.evaluate(`['gpt-duplicate-footer','gpt-hidden-attach','gpt-decoy-menu'].forEach(id=>document.getElementById(id).remove())`);
      await sourceSession.evaluate(`document.querySelector('[data-composer-navigation-target="add-context"]').style.display='none'`);
      await waitFor(()=>sourceSession.evaluate(`getComputedStyle(window.__gptSmokeButton).position==='fixed'`),"ChatGPT attribute-only fallback");
      await sourceSession.evaluate(`document.querySelector('[data-composer-navigation-target="add-context"]').style.display=''`);
      await waitFor(()=>sourceSession.evaluate(`getComputedStyle(window.__gptSmokeButton).position==='static'
        && window.__gptSmokeButton.style.left==='auto' && window.__gptSmokeButton.style.top==='auto'`),"ChatGPT attribute-only inline recovery");
      await sourceSession.evaluate(`document.getElementById('gpt-reasoning').style.display='none'`);
      await waitFor(()=>sourceSession.evaluate(`window.__gptSmokeButton.nextElementSibling===document.querySelector('.gpt-voice-controls [aria-label="Dictate"]')`),"ChatGPT attribute-only model removal");
      await sourceSession.evaluate(`document.getElementById('gpt-reasoning').style.display=''`);
      await waitFor(()=>sourceSession.evaluate(`window.__gptSmokeButton.nextElementSibling===document.querySelector('.gpt-model')`),"ChatGPT attribute-only model return");
      for (const mode of ["style", "hidden", "class"]) {
        await sourceSession.evaluate(`(() => {
          const wrapper=document.getElementById('gpt-reasoning').parentElement;
          if('${mode}'==='style')wrapper.style.display='none';
          else if('${mode}'==='hidden')wrapper.hidden=true;
          else wrapper.classList.add('hidden');
        })()`);
        await waitFor(()=>sourceSession.evaluate(`window.__gptSmokeButton.nextElementSibling===document.querySelector('.gpt-voice-controls [aria-label="Dictate"]')
          && document.getElementById('gpt-reasoning').getBoundingClientRect().width===0`),`ChatGPT native model-wrapper ${mode} hiding`);
        await sourceSession.evaluate(`(() => {
          const wrapper=document.getElementById('gpt-reasoning').parentElement;
          wrapper.style.display='';wrapper.hidden=false;wrapper.classList.remove('hidden');
        })()`);
        await waitFor(()=>sourceSession.evaluate(`window.__gptSmokeButton.nextElementSibling===document.querySelector('.gpt-model')`),"ChatGPT native model-wrapper recovery");
      }
      await sourceSession.call("Emulation.setDeviceMetricsOverride", { width:390,height:740,deviceScaleFactor:1,mobile:false });
      await sourceSession.evaluate(`(() => {
        const input=document.getElementById('prompt-textarea');window.__gptAuditDraft=input.textContent;
        input.textContent='';input.dispatchEvent(new Event('input',{bubbles:true}));
        return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      })()`);
      const gptObservedRects = await sourceSession.evaluate(`[document.getElementById('prompt-textarea'),document.querySelector('form')].map(n=>{const r=n.getBoundingClientRect();return[r.width,r.height];})`);
      await sourceSession.evaluate(`window.__gptHiddenControls=document.querySelector('[data-context-generator-chatgpt-inline="controls"]');window.__gptHiddenControls.hidden=true`);
      await waitFor(()=>sourceSession.evaluate(`getComputedStyle(window.__gptSmokeButton).position==='fixed'`),"ChatGPT hidden control-group fallback");
      assert.deepEqual(await sourceSession.evaluate(`[document.getElementById('prompt-textarea'),document.querySelector('form')].map(n=>{const r=n.getBoundingClientRect();return[r.width,r.height];})`),gptObservedRects,"This hidden-group transition must exercise recovery without ResizeObserver changes.");
      await sourceSession.evaluate(`window.__gptHiddenControls.hidden=false`);
      await waitFor(()=>sourceSession.evaluate(`getComputedStyle(window.__gptSmokeButton).position==='static'
        && window.__gptSmokeButton.nextElementSibling===document.querySelector('.gpt-model')`),"ChatGPT hidden control-group recovery without resize");
      await sourceSession.call("Emulation.clearDeviceMetricsOverride");
      // Restoring the viewport/draft queues native resize and placement work.
      // Finish that reflow before opening a picker that resize intentionally closes.
      await sourceSession.evaluate(`(() => {
        const input=document.getElementById('prompt-textarea');input.textContent=window.__gptAuditDraft;
        input.dispatchEvent(new Event('input',{bubbles:true}));
        return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      })()`);
      await sourceSession.evaluate(`window.__gptSmokeButton.click()`);
      await waitFor(()=>sourceSession.evaluate(`getComputedStyle(document.getElementById('context-generator-destination-sheet')).opacity==='1'`),"ChatGPT picker before body-only remount");
      await sourceSession.evaluate(`(() => {
        const body=document.querySelector('[data-composer-body]'),next=body.cloneNode(false);
        body.replaceWith(next);while(body.firstChild)next.appendChild(body.firstChild);
      })()`);
      await waitFor(()=>sourceSession.evaluate(`document.getElementById('context-generator-destination-sheet').style.display==='none'
        && window.__gptSmokeButton.nextElementSibling===document.querySelector('.gpt-model')`),"ChatGPT body-only picker invalidation");
      assert.equal(await sourceSession.evaluate(`window.__gptSmokeButton.style.filter==='none'
        && window.__gptSmokeButton.style.transform.includes('scale(1)')`),true,"Picker invalidation must clear active pill visuals without a pointer leave.");
      await sourceSession.evaluate(`window.__gptSmokeButton.click()`);
      await waitFor(()=>sourceSession.evaluate(`getComputedStyle(document.getElementById('context-generator-destination-sheet')).opacity==='1'`),"ChatGPT picker after body-only remount");
      assert.equal(await sourceSession.evaluate(`(() => {
        document.getElementById('gpt-reasoning').setAttribute('data-state','closed');
        return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>
          resolve(document.getElementById('context-generator-destination-sheet').style.display!=='none'))));
      })()`),true,"ChatGPT body remount must refresh picker ownership.");
      await sourceSession.evaluate(`window.__gptSmokeButton.click()`);
      await waitFor(()=>sourceSession.evaluate(`document.getElementById('context-generator-destination-sheet').style.display==='none'`),"ChatGPT picker closure");
      process.stdout.write("✓ ChatGPT skips duplicate controls, tracks attribute-only fallback/model changes and refreshes picker ownership after body-only remount.\n");
      await sourceSession.evaluate(`(() => {
        window.__gptSmokeButton=document.getElementById('context-generator-bubble');
        window.__gptSmokeOldFooter=document.querySelector('[data-composer-footer-responsive]');
        const body=document.querySelector('[data-composer-body]'),next=body.cloneNode(true);
        next.querySelector('#context-generator-bubble').remove();
        body.replaceWith(next);
      })()`);
      await waitFor(() => sourceSession.evaluate(`(() => {
        const b=document.getElementById('context-generator-bubble');
        return b===window.__gptSmokeButton && b?.nextElementSibling===document.querySelector('.gpt-model')
          && !window.__gptSmokeOldFooter.hasAttribute('data-context-generator-chatgpt-inline');
      })()`), "ChatGPT button recovery after editor replacement");
      await sourceSession.evaluate(`(() => {
        const input=document.getElementById('prompt-textarea');input.textContent=${JSON.stringify(originalDraft)};
        input.dispatchEvent(new Event('input',{bubbles:true}));
      })()`);
      process.stdout.write("✓ ChatGPT's 36px inline slot survives empty/long drafts, 760/390/320px widths and editor remount without native-control overlap.\n");
    }

    for (const platform of ["gemini", "grok", "deepseek"]) {
      const url = `${origin}/provider-placement?${SMOKE_PLATFORM_QUERY}=${platform}`;
      await browserSession.call("Target.createTarget", { url });
      const target = await waitFor(async () => (await getTargets(devToolsPort))
        .find((item) => item.type === "page" && item.url === url), `${platform} placement page`);
      const session = await CdpSession.connect(target.webSocketDebuggerUrl);
      try {
        await session.call("Page.bringToFront");
        await waitFor(() => session.evaluate(`Boolean(document.querySelector('#context-generator-bubble'))`), `${platform} startup`);
        for (const draft of ["", ["Normal draft", "Second line", "Third line"].join(String.fromCharCode(10))]) {
          await session.evaluate(`(() => {const e=document.getElementById('provider-editor');
            if(e.tagName==='TEXTAREA')e.value=${JSON.stringify(draft)};else e.textContent=${JSON.stringify(draft)};
            e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
          for (const width of [760, 390, 320]) {
            await session.call("Emulation.setDeviceMetricsOverride", { width, height: 740, deviceScaleFactor: 1, mobile: false });
            const layout = await waitFor(() => session.evaluate(`(() => {
              const b=document.getElementById('context-generator-bubble'),r=b.getBoundingClientRect(),c=getComputedStyle(b);
              const anchor=document.querySelector('[data-test-id="bard-mode-menu-button"],#model-select-trigger,#provider-anchor');
              const peers=[...document.querySelector('form').querySelectorAll('button,[role="button"],.other-pill')]
                .filter(n=>n!==b&&n.getBoundingClientRect().width>0).map(n=>n.getBoundingClientRect());
              return c.position==='static'?{width:r.width,inside:r.left>=0&&r.right<=innerWidth,
                adjacent:b.nextElementSibling===anchor||${JSON.stringify(platform)}==='gemini'&&innerWidth<=640,
                overlap:peers.some(p=>r.left<p.right&&r.right>p.left&&r.top<p.bottom&&r.bottom>p.top)}:null;
            })()`), `${platform} inline layout`);
            assert.equal(layout.width, 36);
            assert.equal(layout.inside, true);
            assert.equal(layout.adjacent, true);
            assert.equal(layout.overlap, false, `${platform} control overlap at ${width}px`);
          }
        }
        if (PROVIDER_PLACEMENT_SCREENSHOT_DIR) {
          const capture = await session.call("Page.captureScreenshot", { format: "png" });
          await fs.promises.mkdir(PROVIDER_PLACEMENT_SCREENSHOT_DIR, { recursive: true });
          await fs.promises.writeFile(path.join(PROVIDER_PLACEMENT_SCREENSHOT_DIR, `${platform}-inline.png`), Buffer.from(capture.data, "base64"));
        }
        await session.call("Emulation.clearDeviceMetricsOverride");
        await session.evaluate(`(() => {
          window.__providerPill=document.getElementById('context-generator-bubble');
          window.__providerInteraction=['transform','filter','zIndex'].map(key=>window.__providerPill.style[key]);
          window.__providerAnchor=document.querySelector('[data-test-id="bard-mode-menu-button"],#model-select-trigger,#provider-anchor');
          const extras=[];
          if('${platform}'==='gemini'){
            const live=document.querySelector('.trailing-actions-wrapper'),copy=live.cloneNode(true);
            copy.querySelector('#context-generator-bubble')?.remove();
            [copy,...copy.querySelectorAll('[data-context-generator-provider-inline]')].forEach(n=>n.removeAttribute('data-context-generator-provider-inline'));
            copy.style.display='none';live.before(copy);extras.push(copy);
          }else if('${platform}'==='grok'){
            for(const live of [document.querySelector('[data-testid="attach-button"]'),window.__providerAnchor]){
              const copy=live.cloneNode(true);copy.style.display='none';live.before(copy);extras.push(copy);
            }
          }else{
            const file=document.querySelector('input[type="file"]'),copy=file.cloneNode(true),send=document.querySelector('.ds-button--circle'),hidden=send.cloneNode(true),spacer=document.createElement('span');
            hidden.style.display='none';send.before(hidden);window.__providerAnchor.before(copy);file.before(spacer);extras.push(copy,hidden,spacer);
          }
          window.__providerExtras=extras;
          return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        })()`);
        assert.equal(await session.evaluate(`getComputedStyle(window.__providerPill).position==='static'
          && window.__providerPill.nextElementSibling===window.__providerAnchor`),true,`${platform} duplicate controls must not force fallback.`);
        await session.evaluate(`window.__providerExtras.forEach(n=>n.remove())`);
        await session.evaluate(`(() => {
          window.__providerHiddenGroup=document.querySelector('[data-context-generator-provider-inline="controls"]');
          window.__providerHiddenGroup.style.display='none';
          return new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        })()`);
        assert.equal(await session.evaluate(`getComputedStyle(window.__providerHiddenGroup).display==='none'`),true,`${platform} flow CSS must preserve native hiding.`);
        await session.evaluate(`window.__providerHiddenGroup.style.display=''`);
        await waitFor(()=>session.evaluate(`getComputedStyle(window.__providerPill).position==='static'
          && window.__providerPill.getBoundingClientRect().width===36`),`${platform} native hidden-group recovery`);
        // Keep controls visible while changing only the inline identification.
        await session.evaluate(`(() => {
          if('${platform}'==='gemini')document.querySelector('.trailing-actions-wrapper').classList.remove('trailing-actions-wrapper');
          else if('${platform}'==='grok'){
            window.__providerInlineOwner=document.querySelector('.query-bar');
            window.__providerInlineOwner.classList.remove('query-bar');
          }
          else {window.__providerFile=document.querySelector('input[type="file"]');window.__providerFile.remove();}
        })()`);
        await waitFor(()=>session.evaluate(`getComputedStyle(window.__providerPill).position==='absolute'`),`${platform} legacy backup`);
        await session.evaluate(`(() => {
          if('${platform}'==='gemini')window.__providerHiddenGroup.classList.add('trailing-actions-wrapper');
          else if('${platform}'==='grok')window.__providerInlineOwner.classList.add('query-bar');
          else window.__providerAnchor.after(window.__providerFile);
        })()`);
        await waitFor(()=>session.evaluate(`getComputedStyle(window.__providerPill).position==='static'
          && window.__providerPill.style.left==='auto' && window.__providerPill.style.top==='auto'
          && window.__providerPill.style.width==='36px'`),`${platform} legacy-to-inline style cleanup`);
        assert.deepEqual(await session.evaluate(`['transform','filter','zIndex'].map(key=>window.__providerPill.style[key])`),
          await session.evaluate(`window.__providerInteraction`),`${platform} placement switching must preserve shared interaction styles.`);
        if(platform==='deepseek'){
          await session.evaluate(`window.__providerAnchor.style.display='none'`);
          await waitFor(()=>session.evaluate(`window.__providerPill.nextElementSibling===document.querySelector('.send-wrapper')
            && getComputedStyle(window.__providerPill).position==='static'`),"DeepSeek validated Send-only inline state");
          await session.evaluate(`window.__providerAnchor.style.display=''`);
          await waitFor(()=>session.evaluate(`window.__providerPill.nextElementSibling===window.__providerAnchor`),"DeepSeek upload recovery");
        }
        if(platform==='grok'){
          await session.evaluate(`window.__providerPill.click()`);
          await waitFor(()=>session.evaluate(`getComputedStyle(document.getElementById('context-generator-destination-sheet')).opacity==='1'`),"Grok picker before editor-container remount");
          await session.evaluate(`(() => {
            const old=document.querySelector('.native-grok-space'),next=old.cloneNode(false);
            next.removeAttribute('data-context-generator-provider-inline');old.replaceWith(next);
            while(old.firstChild)next.appendChild(old.firstChild);
          })()`);
          await waitFor(()=>session.evaluate(`document.getElementById('context-generator-destination-sheet').style.display==='none'
            && document.querySelector('.native-grok-space').getAttribute('data-context-generator-provider-inline')==='grok-space'`),"Grok picker invalidation and marker recovery");
        }
        await session.evaluate(`(() => {window.__providerPill=document.getElementById('context-generator-bubble');
          const form=document.querySelector('form'),next=form.cloneNode(true);next.querySelector('#context-generator-bubble').remove();form.replaceWith(next);})()`);
        await waitFor(() => session.evaluate(`document.getElementById('context-generator-bubble')===window.__providerPill
          && getComputedStyle(window.__providerPill).position==='static'`), `${platform} remount`);
        process.stdout.write(`✓ ${platform} inline placement stays beside native controls through drafts, 760/390/320px widths and remount.\n`);
      } catch (error) {
        // A placement page closes before the outer source-page diagnostics.
        // Retain its actual state so native-transition failures are actionable.
        try {
          error.message += `\n${platform} placement diagnostics: ${JSON.stringify(await session.evaluate(`(() => {
            const pill=document.getElementById('context-generator-bubble'),input=document.getElementById('provider-editor');
            return {position:pill&&getComputedStyle(pill).position,styles:pill?.getAttribute('style'),
              parent:pill?.parentElement?.className,queryBar:!!document.querySelector('.query-bar'),
              inputRect:input?.getBoundingClientRect().toJSON(),
              markers:[...document.querySelectorAll('[data-context-generator-provider-inline]')]
                .map(n=>[n.className,n.getAttribute('data-context-generator-provider-inline')])};
          })()`))}`;
        } catch { /* Keep the original assertion if the fixture disconnected. */ }
        throw error;
      } finally { session.close(); await browserSession.call("Target.closeTarget", { targetId: target.id }); }
    }

    // Grok JSON mode verifies capture independently of unrelated Claude geometry.
    if (JSON_SOURCE !== "grok") {
    const claudePlacementUrl = `${origin}/new?${SMOKE_PLATFORM_QUERY}=claude`;
    await browserSession.call("Target.createTarget", { url: claudePlacementUrl });
    const claudePlacementTarget = await waitFor(async () => {
      const targets = await getTargets(devToolsPort);
      return targets.find((target) => target.type === "page" && target.url.startsWith(claudePlacementUrl));
    }, "the Claude placement fixture");
    claudePlacementSession = await CdpSession.connect(claudePlacementTarget.webSocketDebuggerUrl);
    await claudePlacementSession.call("Runtime.enable");
    // Picker animations and remounts require unthrottled foreground frames.
    await claudePlacementSession.call("Page.bringToFront");
    await claudePlacementSession.call("Page.reload", { ignoreCache: true });
    await waitFor(() => claudePlacementSession.evaluate(`Boolean(
      document.getElementById("context-generator-bubble") &&
      getComputedStyle(document.getElementById("context-generator-bubble")).display !== "none"
    )`), "the Claude placement bubble");
    const claudeEmptyBounds = await claudePlacementSession.evaluate(`(() => {
      const composer = document.getElementById("claude-composer").getBoundingClientRect();
      const bubble = document.getElementById("context-generator-bubble").getBoundingClientRect();
      const dictate = document.getElementById("dictate").getBoundingClientRect();
      const voice = document.getElementById("voice").getBoundingClientRect();
      const inside = (rect) => rect.left >= composer.left && rect.right <= composer.right
        && rect.top >= composer.top && rect.bottom <= composer.bottom;
      const bubbleHorizontallyInside = bubble.left >= composer.left && bubble.right <= composer.right;
      const alignment = Math.abs((bubble.top + bubble.height / 2) - (voice.top + voice.height / 2));
      return { bubbleHorizontallyInside, dictateInside: inside(dictate), voiceInside: inside(voice), alignment,
        besideMic: bubble.right <= dictate.left && dictate.left - bubble.right <= 12 };
    })()`);
    assert.equal(claudeEmptyBounds.bubbleHorizontallyInside, true);
    assert.equal(claudeEmptyBounds.dictateInside, true);
    assert.equal(claudeEmptyBounds.voiceInside, true);
    assert.equal(claudeEmptyBounds.besideMic, true, "Claude's pill must sit immediately before the mic branch.");
    assert.ok(claudeEmptyBounds.alignment <= 1, `Claude's fresh-page bubble was ${claudeEmptyBounds.alignment}px from the control row.`);
    if (!JSON_CAPTURE_SMOKE) {
      await verifyEmptyChatError(claudePlacementSession, browserSession, state);
      process.stdout.write("✓ Empty Claude shows its error directly without handoff or destination work.\n");
    }
    if (CLAUDE_PLACEMENT_SCREENSHOT_PATH) {
      const screenshot = await claudePlacementSession.call("Page.captureScreenshot", { format: "png" });
      await fs.promises.mkdir(path.dirname(CLAUDE_PLACEMENT_SCREENSHOT_PATH), { recursive: true });
      await fs.promises.writeFile(CLAUDE_PLACEMENT_SCREENSHOT_PATH, Buffer.from(screenshot.data, "base64"));
      process.stdout.write(`ℹ Claude placement screenshot ${CLAUDE_PLACEMENT_SCREENSHOT_PATH}\n`);
    }
    await claudePlacementSession.evaluate(`(() => {
      history.replaceState(null, "", "/chat/smoke?${SMOKE_PLATFORM_QUERY}=claude");
      document.getElementById("claude-composer").classList.add("existing-chat");
    })()`);
    const claudeEmptyAlignment = await waitFor(() => claudePlacementSession.evaluate(`(() => {
      const bubble = document.getElementById("context-generator-bubble").getBoundingClientRect();
      const voice = document.getElementById("voice").getBoundingClientRect();
      const alignment = Math.abs((bubble.top + bubble.height / 2) - (voice.top + voice.height / 2));
      return alignment <= 1 ? { alignment } : null;
    })()`), "Claude's existing-chat placement alignment");
    assert.ok(claudeEmptyAlignment.alignment <= 1, `Claude's empty-state bubble was ${claudeEmptyAlignment.alignment}px above its control row.`);
    await claudePlacementSession.evaluate(`(() => {
      document.querySelector("[contenteditable]").textContent = "hello";
      document.getElementById("claude-composer").classList.add("has-text");
    })()`);
    const claudePlacement = await waitFor(() => claudePlacementSession.evaluate(`(() => {
      const bubble = document.getElementById("context-generator-bubble")?.getBoundingClientRect();
      const send = document.getElementById("send")?.getBoundingClientRect();
      if (!bubble || !send || getComputedStyle(document.getElementById("send")).visibility !== "visible") return null;
      const intersects = bubble.left < send.right && bubble.right > send.left && bubble.top < send.bottom && bubble.bottom > send.top;
      const sendTranslate = document.getElementById("send").style.translate;
      return !intersects && !sendTranslate
        ? { intersects, sendTranslate }
        : null;
    })()`), "Claude's typed-state placement refresh");
    assert.equal(claudePlacement.intersects, false, "The Cap Context bubble must not cover Claude's Send button.");
    assert.equal(claudePlacement.sendTranslate, "");
    for (const width of [760, 390, 320]) {
      await claudePlacementSession.call("Emulation.setDeviceMetricsOverride", { width, height: 740, deviceScaleFactor: 1, mobile: false });
      const inline = await claudePlacementSession.evaluate(`(() => {
        const b = document.getElementById("context-generator-bubble"), r = b.getBoundingClientRect();
        const m = document.getElementById("model").getBoundingClientRect();
        return { width: parseFloat(getComputedStyle(b).width), position: getComputedStyle(b).position,
          besideControls: b.nextElementSibling === document.getElementById("voice-switch"),
          overlaps: r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top,
          inside: r.left >= 0 && r.right <= innerWidth,
          nativeTranslations: document.querySelectorAll("[data-context-generator-original-translate]").length };
      })()`);
      assert.equal(inline.width, 36);
      assert.equal(inline.besideControls, true);
      assert.equal(inline.position, "static");
      assert.equal(inline.overlaps, false, `Claude inline pill overlaps model at ${width}px.`);
      assert.equal(inline.inside, true);
      assert.equal(inline.nativeTranslations, 0);
    }
    await claudePlacementSession.call("Emulation.clearDeviceMetricsOverride");
    process.stdout.write("✓ Claude's 36px inline pill stays beside the mic/Send branch at 760/390/320px without model overlap or native translation.\n");

    await claudePlacementSession.evaluate(`(() => {
      window.__claudeAuditBubble = document.getElementById("context-generator-bubble");
      const model = document.getElementById("model"), hidden = model.cloneNode(true);
      hidden.id = "hidden-model"; hidden.style.display = "none"; model.before(hidden);
      const menu = document.createElement("div"); menu.id = "decoy-menu"; menu.setAttribute("role", "menu");
      const attach = document.querySelector("[data-testid='chat-input-attach']");
      menu.appendChild(attach.cloneNode(true)); attach.before(menu);
    })()`);
    await waitFor(() => claudePlacementSession.evaluate(`(() => {
      const b = document.getElementById("context-generator-bubble");
      return b === window.__claudeAuditBubble && getComputedStyle(b).position === "static"
        && b.parentElement.getAttribute("data-context-generator-claude-inline") === "right"
        && b.nextElementSibling === document.getElementById("voice-switch");
    })()`), "Claude inline ownership with hidden/popup control copies");
    await claudePlacementSession.evaluate(`(() => {
      document.getElementById("hidden-model").remove(); document.getElementById("decoy-menu").remove();
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    })()`);
    await claudePlacementSession.evaluate(`document.getElementById("model").style.display = "none"`);
    await waitFor(() => claudePlacementSession.evaluate(`getComputedStyle(document.getElementById("context-generator-bubble")).position === "static"
      && document.getElementById("context-generator-bubble").parentElement.getAttribute("data-context-generator-claude-inline") === "right"`), "Claude inline retention during attribute-only hiding");
    await claudePlacementSession.evaluate(`document.getElementById("model").style.display = ""`);
    await waitFor(() => claudePlacementSession.evaluate(`getComputedStyle(document.getElementById("context-generator-bubble")).position === "static"
      && document.querySelectorAll("[data-context-generator-original-translate]").length === 0`), "Claude attribute-only inline recovery");
    for (const wrapper of ["editor", "actions", "host"]) {
      await claudePlacementSession.evaluate(`document.getElementById("context-generator-bubble").click()`);
      await waitFor(() => claudePlacementSession.evaluate(`getComputedStyle(document.getElementById("context-generator-destination-sheet")).opacity === "1"`), `Claude picker before ${wrapper} replacement`);
      await claudePlacementSession.evaluate(`(() => {
        const old = ${wrapper === "host" ? 'document.getElementById("claude-host")' : `document.querySelector('[data-context-generator-claude-inline="${wrapper}"]')`};
        const next = old.cloneNode(false); next.removeAttribute("data-context-generator-claude-inline");
        old.replaceWith(next); while (old.firstChild) next.appendChild(old.firstChild);
      })()`);
      await waitFor(() => claudePlacementSession.evaluate(`document.getElementById("context-generator-destination-sheet").style.display === "none"
        && document.getElementById("context-generator-bubble") === window.__claudeAuditBubble
        && getComputedStyle(window.__claudeAuditBubble).position === "static"`), "Claude picker invalidation and remount");
    }
    await claudePlacementSession.evaluate(`document.getElementById("context-generator-bubble").click()`);
    await waitFor(() => claudePlacementSession.evaluate(`getComputedStyle(document.getElementById("context-generator-destination-sheet")).opacity === "1"`), "Claude picker after host remount");
    assert.equal(await claudePlacementSession.evaluate(`(() => {
      document.getElementById("model").setAttribute("data-state", "closed");
      return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() =>
        resolve(document.getElementById("context-generator-destination-sheet").style.display !== "none"))));
    })()`), true, "A native control update after host remount must not close the picker again.");
    await claudePlacementSession.evaluate(`document.getElementById("context-generator-bubble").click()`);
    await claudePlacementSession.evaluate(`(() => {
      const chin = document.createElement("div"); chin.setAttribute("data-cds", "ChatComposerChin");
      document.getElementById("claude-composer").appendChild(chin); chin.appendChild(document.getElementById("model"));
      document.querySelector("[contenteditable]").textContent = "";
      document.getElementById("claude-composer").classList.remove("has-text");
    })()`);
    await waitFor(() => claudePlacementSession.evaluate(`getComputedStyle(document.getElementById("context-generator-bubble")).position === "static"
      && getComputedStyle(document.getElementById("send")).visibility === "hidden"`), "Claude compact empty Voice mode");
    process.stdout.write("✓ Claude inline handles hidden/popup duplicates, attribute-only inline retention/recovery, picker wrapper remounts and compact Voice mode.\n");

    for (const platform of ["chatgpt", "claude"]) {
      const fixtureUrl = `${origin}/free-placement?${SMOKE_PLATFORM_QUERY}=${platform}`;
      const { targetId } = await browserSession.call("Target.createTarget", { url: fixtureUrl });
      const target = await waitFor(async () => (await getTargets(devToolsPort)).find(t => t.id === targetId), `${platform} free-layout target`);
      const session = await CdpSession.connect(target.webSocketDebuggerUrl);
      try {
        await session.call("Runtime.enable"); await session.call("Page.bringToFront");
        const probe = `(() => {
          const b = document.getElementById("context-generator-bubble");
          if (!b || getComputedStyle(b).position !== "static" || getComputedStyle(b).visibility !== "visible") return null;
          const r = b.getBoundingClientRect(), model = document.getElementById("model") || document.getElementById("gpt-reasoning");
          const m = model.getBoundingClientRect(), send = document.getElementById("send") || document.getElementById("gpt-send"), s = send.getBoundingClientRect();
          const overlaps = rect => rect.width > 0 && r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top;
          const modelVisible = m.width > 0 && m.height > 0;
          const beforeModel = modelVisible && b.nextElementSibling?.contains(model);
          return r.width === 36 && r.left >= 0 && r.right <= innerWidth && !overlaps(m) && !overlaps(s)
            && (!modelVisible || beforeModel) && document.querySelectorAll("#context-generator-bubble").length === 1
            ? { beforeModel, width: r.width } : null;
        })()`;
        for (const width of [1100, 760, 390, 320]) {
          await session.call("Emulation.setDeviceMetricsOverride", { width, height: 740, deviceScaleFactor: 1, mobile: false });
          await waitFor(() => session.evaluate(probe), `${platform} free-layout placement at ${width}px`);
          await session.evaluate(`(() => {
            const editor = document.querySelector('[contenteditable]'); editor.textContent = "draft";
            editor.dispatchEvent(new Event("input", { bubbles:true }));
            const send = document.getElementById("send"); if (send) send.disabled = false;
          })()`);
          await waitFor(() => session.evaluate(probe), `${platform} free-layout draft placement at ${width}px`);
        }
        await session.call("Emulation.clearDeviceMetricsOverride");
        // Resize invalidates an open picker. Drain its scheduled placement frames
        // before testing a click, and require the desktop model anchor to return.
        await session.evaluate(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
        await waitFor(async () => (await session.evaluate(probe))?.beforeModel, `${platform} free-layout desktop anchor after resize`);
        await session.evaluate(`document.getElementById("context-generator-bubble").click()`);
        await waitFor(() => session.evaluate(`getComputedStyle(document.getElementById("context-generator-destination-sheet")).opacity === "1"`), `${platform} free-layout picker`);
        await session.evaluate(`(() => {
          const old = document.querySelector(${JSON.stringify(platform === "claude" ? '[data-cds="ChatComposer"]' : '[data-composer-body]')});
          const next = old.cloneNode(true); next.querySelector("#context-generator-bubble")?.remove();
          for (const node of [next, ...next.querySelectorAll("*")]) {
            node.removeAttribute("data-context-generator-claude-inline"); node.removeAttribute("data-context-generator-chatgpt-inline");
          }
          old.replaceWith(next);
        })()`);
        await waitFor(() => session.evaluate(probe), `${platform} free-layout composer replacement`);
        await waitFor(() => session.evaluate(`document.getElementById("context-generator-destination-sheet").style.display === "none"`), `${platform} replaced editor's picker dismissal`);
        if (platform === "claude") {
          assert.equal(await session.evaluate(`document.getElementById("claude-host").style.getPropertyValue("--cmp-trail-w")`), "44px", "Reply mode must preserve its native Send reservation.");
          for (const page of [claudePlacementFixture(), claudeReplyFixture()]) {
            await session.evaluate(`(() => {
              const next = new DOMParser().parseFromString(${JSON.stringify(page)}, "text/html").querySelector('[data-cds="ChatComposer"]');
              document.querySelector('[data-cds="ChatComposer"]').replaceWith(next);
            })()`);
            await waitFor(() => session.evaluate(`(() => {const b=document.getElementById("context-generator-bubble");return b && getComputedStyle(b).position==="static" && getComputedStyle(b).visibility==="visible" && b.closest('[data-cds="ChatComposer"]');})()`), "Claude expanded/reply transition");
          }
          await waitFor(() => session.evaluate(probe), "Claude reply placement after returning from expanded mode");
        }
        if (PROVIDER_PLACEMENT_SCREENSHOT_DIR) {
          const screenshot = await session.call("Page.captureScreenshot", { format:"png" });
          await fs.promises.mkdir(PROVIDER_PLACEMENT_SCREENSHOT_DIR, { recursive:true });
          await fs.promises.writeFile(path.join(PROVIDER_PLACEMENT_SCREENSHOT_DIR, `${platform}-free.png`), Buffer.from(screenshot.data, "base64"));
        }
        process.stdout.write(`✓ ${platform} free layout: desktop/760/390/320px, drafts, picker dismissal and composer replacement.\n`);
      } catch (error) {
        process.stderr.write(`Free ${platform} diagnostics: ${JSON.stringify(await session.evaluate(`(() => {
          const b=document.getElementById("context-generator-bubble"), s=document.getElementById("context-generator-destination-sheet");
          return { bubble:b?.outerHTML.slice(0,800), sheet:s?.style.cssText, opacity:s&&getComputedStyle(s).opacity, width:innerWidth };
        })()`))}\n`);
        throw error;
      } finally { session.close(); await browserSession.call("Target.closeTarget", { targetId }); }
    }

    }

    if (JSON_RELOAD_SMOKE) {
      const before = state.jsonRequests;
      const sessionBefore = state.sessionRequests;
      await sourceSession.evaluate(`window.__capSmokeOldBubble = document.getElementById("context-generator-bubble"); true`);
      const worker = await waitFor(async () => (await getTargets(devToolsPort)).find(target => target.type === "service_worker" && target.url.startsWith("chrome-extension://")), "the extension worker");
      const extensionId = new URL(worker.url).hostname;
      // Unload/reload through CDP in the disposable profile. runtime.reload()
      // alone disables command-line-loaded unpacked extensions in Brave.
      await browserSession.call("Extensions.uninstall", { id: extensionId });
      await waitFor(async () => !(await getTargets(devToolsPort)).some(target => target.id === worker.id), "the old extension worker stopping");
      await browserSession.call("Extensions.loadUnpacked", { path: extensionRoot });
      await waitFor(async () => (await getTargets(devToolsPort)).some(target => target.type === "service_worker" && target.id !== worker.id && target.url.startsWith(`chrome-extension://${extensionId}/`)), "the reloaded extension worker");
      await waitFor(() => sourceSession.evaluate(`Boolean(document.getElementById("context-generator-bubble") && document.getElementById("context-generator-bubble") !== window.__capSmokeOldBubble)`), "a fresh bubble after extension reload");
      assert.equal(state.jsonRequests, before, "Extension reload must not capture conversation bodies.");
      assert.equal(state.sessionRequests, sessionBefore, "Reload must not read a session proactively.");
      if (CHATGPT_RELOAD_SMOKE) {
        // Reproduce a late MAIN install with no previously observed headers.
        await sourceSession.evaluate(`window.__capChatGptFetchState.dispose(); delete window.__capChatGptFetchState; true`);
      }
      // No page refresh or native API read: recover routing from resource history.
      process.stdout.write("Reloaded the extension on the open source fixture without refreshing or fetching messages.\n");
    }
    if (JSON_CAPTURE_SMOKE) {
      const before = state.jsonRequests;
      await sourceSession.evaluate(`document.getElementById("context-generator-bubble").click()`);
      assert.equal(await sourceSession.evaluate(`document.getElementById("context-generator-${JSON_SOURCE}-json-toggle").getAttribute("aria-pressed")`), "true", "Fast capture must start enabled.");
      await waitFor(async () => await sourceSession.evaluate(`getComputedStyle(document.getElementById("context-generator-${JSON_SOURCE}-json-toggle")).color`) === "rgb(250, 204, 21)", "the default fast-capture enabled color");
      await sourceSession.evaluate(`document.getElementById("context-generator-${JSON_SOURCE}-json-toggle").click()`);
      assert.equal(await sourceSession.evaluate(`document.getElementById("context-generator-${JSON_SOURCE}-json-toggle").getAttribute("aria-pressed")`), "false");
      await waitFor(() => sourceSession.evaluate(`getComputedStyle(document.getElementById("context-generator-destination-sheet")).opacity === "1"`), "the settled picker before measuring the toggle");
      const idleToggle = await sourceSession.evaluate(`(() => {
        const toggle = document.getElementById("context-generator-${JSON_SOURCE}-json-toggle");
        const rect = toggle.getBoundingClientRect();
        const header = toggle.parentElement.getBoundingClientRect();
        // Transformed rect edges differed by 0.00003px at browser zoom. Allow
        // rounding noise while still rejecting any visible header overflow.
        const epsilon = 0.01;
        return { icon: Boolean(toggle.querySelector("svg[aria-hidden='true']")), header: toggle.parentElement.contains(document.querySelector(".context-generator-destination-brand")), inHeader: rect.top >= header.top - epsilon && rect.bottom <= header.bottom + epsilon && rect.left >= header.left - epsilon && rect.right <= header.right + epsilon, color: getComputedStyle(toggle).color, bounds: rect.toJSON(), headerBounds: header.toJSON() };
      })()`);
      assert.equal(idleToggle.icon, true, "Fast capture must use a decorative vector icon.");
      assert.equal(idleToggle.header, true, "The fast-capture control must sit in the brand header.");
      assert.equal(idleToggle.inHeader, true, `Host button styles must not move the fast-capture control outside the header: ${JSON.stringify(idleToggle)}`);
      await sourceSession.evaluate(`document.getElementById("context-generator-${JSON_SOURCE}-json-toggle").click()`);
      assert.equal(await sourceSession.evaluate(`document.getElementById("context-generator-${JSON_SOURCE}-json-toggle").getAttribute("aria-pressed")`), "true");
      await waitFor(async () => await sourceSession.evaluate(`getComputedStyle(document.getElementById("context-generator-${JSON_SOURCE}-json-toggle")).color`) === "rgb(250, 204, 21)", "the fast-capture enabled color");
      assert.notEqual(idleToggle.color, "rgb(250, 204, 21)", "The enabled state must be visibly distinct.");
      if (PICKER_SCREENSHOT_PATH) {
        await waitFor(async () => await sourceSession.evaluate(`getComputedStyle(document.getElementById("context-generator-destination-sheet")).opacity`) === "1", "the visible picker");
        const clip = await sourceSession.evaluate(`(() => { const r = document.getElementById("context-generator-destination-sheet").getBoundingClientRect(); return { x: r.x - 12, y: r.y - 12, width: r.width + 24, height: r.height + 24, scale: 1 }; })()`);
        const screenshot = await sourceSession.call("Page.captureScreenshot", { format: "png", clip });
        await fs.promises.writeFile(PICKER_SCREENSHOT_PATH, Buffer.from(screenshot.data, "base64"));
      }
      assert.equal(state.jsonRequests, before, "Toggling JSON capture must not fetch a conversation.");
      assert.equal(state.pasteDescriptorRequests + state.pasteContentRequests, 0, "Toggling capture must not read pasted files.");
      assert.equal(state.summaryRequests.length, 0, "Toggling JSON capture must not submit a transcript.");
      assert.equal(state.sessionRequests, 0, "Opening/toggling the picker must not read a session.");
      await sourceSession.evaluate(`document.querySelector("#context-generator-destination-backdrop").click()`);
    }

    if (JSON_SOURCE === "chatgpt") {
      // API capture must work before virtualized turns mount, on project routes,
      // without scroll sweeps or opening any pasted-content panels.
      await sourceSession.evaluate(`if (!${JSON_FALLBACK_SMOKE}) document.querySelectorAll("main article").forEach(node => node.remove()); history.pushState({}, "", "/g/project/c/smoke?${SMOKE_PLATFORM_QUERY}=chatgpt"); true`);
    }
    if (NETWORK_SOURCE && !JSON_FALLBACK_SMOKE) await sourceSession.evaluate('document.querySelectorAll("main article").forEach(node => node.remove()); true');
    // Responsive placement runs in a second tab. Restore the source tab before
    // capture so hidden-tab throttling cannot turn this into a timing test.
    await sourceSession.call("Page.bringToFront");
    await verifyPickerProductChanges(sourceSession, state);
    const jsonRequestsBeforeTransfer = state.jsonRequests;
    const clickResult = await sourceSession.evaluate(String.raw`(() => {
      const bubble = document.getElementById("context-generator-bubble");
      bubble.click();
      // The ordinary smoke exercises the user's explicit DOM opt-out.
      const speedToggle = document.querySelector(".context-generator-speed-toggle");
      if (!${JSON_CAPTURE_SMOKE} && speedToggle?.getAttribute("aria-pressed") === "true") speedToggle.click();
      const sheet = document.getElementById("context-generator-destination-sheet");
      const backdrop = document.getElementById("context-generator-destination-backdrop");
      const tiles = [...document.querySelectorAll(".context-generator-destination-tile")];
      const claudeTile = tiles.find((tile) => tile.textContent.includes(${JSON.stringify(JSON_SOURCE === "claude" ? "ChatGPT" : "Claude")}));
      if (!claudeTile) return { ok: false, destinations: tiles.map((tile) => tile.textContent.trim()) };
      // Reproduce Dark Reader's injected important rules without installing it in
      // the isolated smoke profile. The extension's visible palette must win.
      const cases = [
        [sheet, "background-image", "bgimage", "linear-gradient(red,red)"],
        [sheet, "border-color", "border", "red"],
        [sheet, "color", "color", "red"],
        [sheet, "box-shadow", "boxshadow", "0 0 20px red"],
        [claudeTile, "background-image", "bgimage", "linear-gradient(red,red)"],
        [claudeTile, "border-color", "border", "red"],
        [claudeTile, "color", "color", "red"],
        [claudeTile, "box-shadow", "boxshadow", "0 0 20px red"],
        [claudeTile.querySelector(".context-generator-tile-detail"), "color", "color", "red"],
        [sheet.querySelector(".context-generator-destination-helper"), "color", "color", "red"],
        [backdrop, "background-color", "bgcolor", "red"]
      ];
      const before = cases.map(([element, property]) => getComputedStyle(element).getPropertyValue(property));
      for (const [element, , key, value] of cases) {
        element.setAttribute("data-darkreader-inline-" + key, "");
        element.style.setProperty("--darkreader-inline-" + key, value);
      }
      const darkReaderRules = document.createElement("style");
      darkReaderRules.textContent = cases.map(([, property, key]) =>
        "[data-darkreader-inline-" + key + "]{" + property + ":var(--darkreader-inline-" + key + ") !important}"
      ).join("\n");
      document.head.appendChild(darkReaderRules);
      const palettePreserved = cases.every(([element, property], index) =>
        getComputedStyle(element).getPropertyValue(property) === before[index]
      );
      const idleBackground = getComputedStyle(claudeTile).backgroundImage;
      claudeTile.dispatchEvent(new Event("mouseenter"));
      const hoverBackground = getComputedStyle(claudeTile).backgroundImage;
      claudeTile.dispatchEvent(new Event("mouseleave"));
      claudeTile.click();
      const selectedBackground = getComputedStyle(claudeTile).backgroundImage;
      darkReaderRules.remove();
      return {
        ok: true,
        palettePreserved,
        hoverPreserved: hoverBackground !== idleBackground && !hoverBackground.includes("red"),
        selectedPreserved: selectedBackground !== idleBackground && !selectedBackground.includes("red"),
        pickerStyleIgnored: sheet.ownerDocument.getElementById("context-generator-destination-sheet-styles")?.classList.contains("darkreader")
      };
    })()`);
    assert.equal(clickResult?.ok, true, `Claude destination tile was unavailable: ${JSON.stringify(clickResult)}`);
    assert.equal(clickResult.palettePreserved, true, "Dark Reader must not recolor the picker's idle palette.");
    assert.equal(clickResult.hoverPreserved, true, "Dark Reader must not recolor the picker's hover palette.");
    assert.equal(clickResult.selectedPreserved, true, "Dark Reader must not recolor the selected destination tile.");
    assert.equal(clickResult.pickerStyleIgnored, true, "Dark Reader must leave the picker stylesheet alone.");

    if (JSON_FALLBACK_SMOKE) {
      await waitFor(() => sourceSession.evaluate(`document.getElementById("context-generator-capture-notice")?.textContent === "Fast capture failed. Using normal capture instead."`), "the safe fast-capture fallback notice");
    }
    await waitFor(() => state.summaryRequests.length === 1, "one summary backend request");
    const capturedConversation = state.summaryRequests[0]?.conversation || "";
    assert.match(capturedConversation, new RegExp(SOURCE_SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(capturedConversation, new RegExp(ASSISTANT_SENTINEL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    if (JSON_FALLBACK_SMOKE) {
      assert.doesNotMatch(capturedConversation, /JSON_ONLY_SENTINEL|AUTH_SENTINEL|CSRF_SENTINEL|SIGNED_SENTINEL/);
      assert.equal(state.jsonRequests - jsonRequestsBeforeTransfer, JSON_SOURCE === "grok" ? 2 : 1, "Fast capture must not be retried after failure.");
      process.stdout.write(`✓ ${JSON_SOURCE} failed fast capture fell back to DOM within the same transfer.\n`);
    } else if (JSON_CAPTURE_SMOKE) {
      assert.match(capturedConversation, new RegExp(`^${({claude:"Claude",chatgpt:"ChatGPT",gemini:"Gemini",grok:"Grok",deepseek:"DeepSeek"})[JSON_SOURCE]} conversation:`));
      assert.match(capturedConversation, /JSON_ONLY_SENTINEL/);
      if (JSON_SOURCE === "claude") {
        assert.deepEqual(Object.fromEntries(new URL(state.claudeRequestUrls.at(-1)).searchParams), { tree: "True", rendering_mode: "messages", render_all_tools: "true", include_inline_comparison: "true", consistency: "strong" });
        assert.ok(capturedConversation.includes(CLAUDE_PASTED_TEXT), "The complete pasted attachment must reach the backend.");
        assert.equal(capturedConversation.split("CLAUDE_PASTE_START").length - 1, 1, "The pasted text must be included once.");
        assert.ok(capturedConversation.indexOf("CLAUDE_PASTE_END") < capturedConversation.indexOf("Assistant:"), "The paste must remain in its owning user turn.");
        assert.doesNotMatch(capturedConversation, /CLAUDE_ATTACHMENT_IGNORED_SENTINEL/);
      }
      if (JSON_SOURCE === "chatgpt") {
        const expectedTurns = Array.from({ length: 60 }, (_, i) => [
          `User: ${i === 0 ? CHATGPT_USER_PASTE : `User history ${i}`}`,
          `Assistant: ${i === 59 ? ASSISTANT_SENTINEL : `Assistant history ${i}`}`
        ]).flat();
        expectedTurns.push("Assistant: OWN_RECAP_SENTINEL", "Assistant: OWN_THOUGHT_SENTINEL", `Assistant: Canvas: Smoke document\n\n${CHATGPT_CANVAS_TEXT}`, "Assistant: Canvas edit:\n\nOWN_CANVAS_EDIT_SENTINEL", "User: OWN_VOICE_USER_SENTINEL", "Assistant: OWN_VOICE_ASSISTANT_SENTINEL", `Assistant: ${CHATGPT_EXACT_CODE}`);
        assert.equal(capturedConversation, `ChatGPT conversation:\n\n${expectedTurns.join("\n\n")}`, "Every own turn must reach the backend exactly once, including all middle history.");
        assert.ok(capturedConversation.includes(CHATGPT_PASTED_TEXT), "Full pasted text must remain in its owning user turn.");
        assert.match(capturedConversation, /Assistant history 0/);
        assert.match(capturedConversation, /User history 59/);
        assert.match(capturedConversation, /OWN_RECAP_SENTINEL/);
        assert.match(capturedConversation, /OWN_THOUGHT_SENTINEL/);
        assert.match(capturedConversation, /OWN_CODE_SENTINEL/);
        assert.doesNotMatch(capturedConversation, /UNSUPPORTED_SENTINEL|INACTIVE_BRANCH_SENTINEL|smoke-only|smoke-refreshed|SESSION_TOKEN_MUST_NOT_LEAVE_MAIN|SIGNED_PASTE_SENTINEL/);
        assert.equal(state.pasteDescriptorRequests, CHATGPT_PASTE_AUTH_SMOKE ? 2 : 1);
        assert.equal(state.pasteContentRequests, 1);
        assert.equal(state.chatgptRequestUrls.at(-1), "/backend-api/conversation/smoke");
        assert.equal(state.sessionRequests, (CHATGPT_RELOAD_SMOKE ? 1 : 0) + (CHATGPT_PASTE_AUTH_SMOKE ? 1 : 0));
      }
      if (NETWORK_SOURCE) {
        assert.equal(capturedConversation, networkFixtures(JSON_SOURCE).expected, "Every original own turn/paste/document must reach the backend once and in order.");
        assert.doesNotMatch(capturedConversation, /TOOL_SENTINEL|SIGNED_SENTINEL|AUTH_SENTINEL|CSRF_SENTINEL/);
        assert.equal(state.pasteContentRequests, JSON_SOURCE === "deepseek" ? 1 : 0);
        if (JSON_SOURCE === "grok") process.stdout.write("\u2713 Grok JSON: exact 48-turn transcript, original code/whitespace and zero attachment/tool leakage.\n");
      }
      assert.equal(state.jsonRequests, jsonRequestsBeforeTransfer + (JSON_SOURCE === "gemini" ? 3 : JSON_SOURCE === "grok" ? 2 : 1), "JSON capture must load the full history only after destination selection.");
    }
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
    const summaryContext = state.summaryRequests[0].telemetry;
    await waitFor(() => state.telemetryRequests.some(payload => payload.attempt_id === summaryContext.attempt_id
      && payload.status === "succeeded" && payload.last_stage === "completed" && payload.summary_proof
      && payload.summary_confirmed_at && payload.completed_at), "the installed worker's signed terminal telemetry");
    const extensionContextId = sourceSession.getExtensionContextId();
    assert.ok(extensionContextId, "The smoke source must expose its installed extension context.");
    await waitFor(async () => {
      const stored = await sourceSession.evaluate(`chrome.storage.local.get("context-generator-telemetry-outbox-v1")`, extensionContextId);
      return Array.isArray(stored?.["context-generator-telemetry-outbox-v1"]) && stored["context-generator-telemetry-outbox-v1"].length === 0;
    }, "the installed worker's drained durable telemetry outbox");
    assert.ok(telemetryFixture.responses.every(status => status === 204), "Every local telemetry report must be accepted.");
    await telemetryFixture.verifyDatabaseOutcome(summaryContext);
    process.stdout.write(TELEMETRY_DATABASE_SMOKE
      ? "✓ Installed worker → Vercel relay → Edge handler → migrated database: verified completion, one count, drained outbox.\n"
      : "✓ Signed terminal telemetry stayed in the local fixture and the installed worker's outbox drained.\n");
    process.stdout.write("Cap Context Brave extension smoke passed.\n");
  } catch (error) {
    if (sourceSession) {
      try {
        error.message += `\nSource diagnostics: ${JSON.stringify(await sourceSession.evaluate(`({
          visibility: document.visibilityState,
          errors: [...document.querySelectorAll('[role="alert"]')].map(n => n.textContent),
          overlay: document.getElementById('context-generator-overlay')?.textContent
        })`))}\nConsole: ${JSON.stringify(sourceSession.getRecentEvents().filter(e =>
          e.method === 'Runtime.exceptionThrown' || e.method === 'Runtime.consoleAPICalled'))}`;
      } catch { /* Preserve the original error if the failed page disconnected. */ }
    }
    if (browserOutput.trim()) error.message += `\nBrave output:\n${browserOutput.trim()}`;
    throw error;
  } finally {
    destinationSession?.close();
    claudePlacementSession?.close();
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
    await telemetryFixture.close();
    const safeTempRoot = path.resolve(tempRoot);
    const safeOsTemp = path.resolve(os.tmpdir());
    if (process.env.CAP_CONTEXT_SMOKE_KEEP_TEMP === "1") {
      process.stderr.write(`Kept smoke artifacts at ${safeTempRoot}\n`);
    } else if (safeTempRoot.startsWith(`${safeOsTemp}${path.sep}`)) {
      await fs.promises.rm(safeTempRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
    }
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = { CdpSession };
