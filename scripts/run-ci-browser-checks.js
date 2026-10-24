const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const ARTIFACT_ROOT = path.join(ROOT, ".test-artifacts/browser-smoke");
const check = (id, name, seconds, env = {}) => ({ id, name, timeoutMs: seconds * 1000, env });

function getBrowserChecks(extended = false) {
  const regular = [
    // Native key delivery remains serial, as in the original gate.
    { ...check("escape-source", "Escape cancels the source transfer", 120, { CAP_CONTEXT_ESCAPE_SMOKE: "source" }), exclusive: true },
    { ...check("escape-destination", "Escape cancels the destination transfer", 120, { CAP_CONTEXT_ESCAPE_SMOKE: "destination" }), exclusive: true },
    check("dom-telemetry", "DOM transfer, placement and local telemetry database", 180, { CAP_CONTEXT_TELEMETRY_SMOKE: "1" }),
    check("handoff-palette", "Handoff palette under strict CSP", 60, { CAP_CONTEXT_HANDOFF_PALETTE_SMOKE: "1", CAP_CONTEXT_HANDOFF_CSP_SMOKE: "1" }),
    check("chatgpt-paste", "ChatGPT long paste stays in the editor once", 120, { CAP_CONTEXT_CHATGPT_PASTE_SMOKE: "1" }),
    check("draft-transfer", "First draft opens both copy dialogs", 120, { CAP_CONTEXT_DRAFT_TRANSFER_SMOKE: "1", CAP_CONTEXT_TELEMETRY_SMOKE: "1" }),
    check("chatgpt-reload", "ChatGPT reload, expired-token cancellation and Gemini delivery", 180, { CAP_CONTEXT_JSON_SMOKE: "chatgpt", CAP_CONTEXT_CHATGPT_RELOAD_SMOKE: "1", CAP_CONTEXT_TOOLBAR_SMOKE: "1", CAP_CONTEXT_CHATGPT_AUTH_SMOKE: "paste401", CAP_CONTEXT_GEMINI_DESTINATION_SMOKE: "1" }),
    check("json-retry", "JSON retry after offline picker capture", 120, { CAP_CONTEXT_JSON_SMOKE: "chatgpt", CAP_CONTEXT_JSON_RETRY_SMOKE: "1" }),
    check("chatgpt-million", "Million-character Unicode capture, summary request and paste", 180, { CAP_CONTEXT_JSON_SMOKE: "chatgpt", CAP_CONTEXT_LARGE_CHAT_SMOKE: "1000000" }),
    check("deepseek-files", "DeepSeek concurrent original-file capture", 180, { CAP_CONTEXT_JSON_SMOKE: "deepseek", CAP_CONTEXT_REPLY_SNAPSHOT_SMOKE: "1" })
  ];
  if (!extended) return regular;
  return regular.concat([
    check("paste-recovery", "Paste deadlines and delayed composer recovery", 120, { CAP_CONTEXT_PASTE_RECOVERY_SMOKE: "1" }),
    check("early-handoff", "Streaming summary reveals the destination early", 120, { CAP_CONTEXT_EARLY_HANDOFF_SMOKE: "stream" }),
    check("chatgpt-paste-budget", "ChatGPT oversized paste length rejection", 180, { CAP_CONTEXT_JSON_SMOKE: "chatgpt", CAP_CONTEXT_CHATGPT_FAILURE_SMOKE: "paste-oversize" }),
    check("chatgpt-declared-paste-budget", "ChatGPT declared paste exceeds the file budget", 180, { CAP_CONTEXT_JSON_SMOKE: "chatgpt", CAP_CONTEXT_CHATGPT_FAILURE_SMOKE: "paste-declared-oversize" }),
    check("chatgpt-history-budget", "ChatGPT oversized history cancellation", 180, { CAP_CONTEXT_JSON_SMOKE: "chatgpt", CAP_CONTEXT_CHATGPT_FAILURE_SMOKE: "history-oversize" }),
    check("claude-capture", "Claude complete CRLF pasted-card capture", 180, { CAP_CONTEXT_JSON_SMOKE: "1" }),
    check("claude-fallback", "Claude partial capture fallback", 180, { CAP_CONTEXT_JSON_SMOKE: "1", CAP_CONTEXT_CLAUDE_PARTIAL_SMOKE: "1" }),
    check("claude-oversize", "Claude oversized history cancellation", 180, { CAP_CONTEXT_JSON_SMOKE: "1", CAP_CONTEXT_CLAUDE_PARTIAL_SMOKE: "oversize" }),
    check("gemini-capture", "Gemini complete bootstrap capture", 180, { CAP_CONTEXT_JSON_SMOKE: "gemini" }),
    check("gemini-fallback", "Gemini response-menu-free fallback", 180, { CAP_CONTEXT_JSON_SMOKE: "gemini", CAP_CONTEXT_NETWORK_FAILURE_SMOKE: "partial" }),
    check("deepseek-history-budget", "DeepSeek oversized history cancellation", 180, { CAP_CONTEXT_JSON_SMOKE: "deepseek", CAP_CONTEXT_NETWORK_FAILURE_SMOKE: "oversize" })
  ]);
}

function childEnvironment(check, directory, inherited = process.env) {
  // Each old workflow step had a fresh scenario environment. Never leak another
  // fixture's flags, assertion timeout override or live-telemetry opt-in into CI.
  const env = Object.fromEntries(Object.entries(inherited).filter(([name]) => !name.startsWith("CAP_CONTEXT_")));
  return { ...env, ...check.env, CAP_CONTEXT_SMOKE_ARTIFACT_DIR: directory };
}

async function runCheck(check, index, { artifactRoot = ARTIFACT_ROOT, signal } = {}) {
  const directory = path.join(artifactRoot, check.id);
  fs.mkdirSync(directory, { recursive: true });
  const logPath = path.join(directory, "run.log");
  if (signal?.aborted) return { ...check, passed: false, reason: "Cancelled", durationMs: 0, logPath };
  const started = performance.now();
  const log = fs.openSync(logPath, "w");
  let child;
  try {
    // Separate X servers preserve native focus/visibility assertions. Profiles,
    // HTTP/CDP ports and SQL databases are already private to each smoke process.
    child = spawn(check.command || "xvfb-run", check.args || [
      "--auto-servernum", "--server-num=" + (100 + index),
      process.execPath, path.join(ROOT, "scripts/run-extension-smoke.js")
    ], { cwd: ROOT, env: childEnvironment(check, directory), detached: process.platform !== "win32", stdio: ["ignore", log, log], windowsHide: true });
  } finally {
    fs.closeSync(log);
  }
  return new Promise(resolve => {
    let reason = "";
    let forceTimer;
    const kill = signalName => {
      try {
        // Kill the entire Linux process group, including Xvfb and Brave, so a
        // timeout/cancellation cannot leave a browser running beside later cases.
        if (process.platform === "win32") child.kill(signalName);
        else process.kill(-child.pid, signalName);
      } catch (error) { if (error.code !== "ESRCH") reason ||= error.message; }
    };
    const stop = message => {
      if (reason) return;
      reason = message;
      kill("SIGTERM");
      forceTimer = setTimeout(() => kill("SIGKILL"), 5000);
    };
    const abort = () => stop("Cancelled");
    const timer = setTimeout(() => stop("Timed out after " + check.timeoutMs / 1000 + " seconds"), check.timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    child.on("error", error => { reason ||= error.message; });
    child.on("close", (code, terminationSignal) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      // The wrapper can close before Brave. Finish stopping the group before
      // releasing this slot, rather than leaving orphaned browsers behind.
      if (forceTimer) {
        kill("SIGKILL");
        clearTimeout(forceTimer);
      }
      resolve({ id: check.id, name: check.name, passed: code === 0 && !reason,
        reason: reason || (code === 0 ? "" : "Exit " + code + (terminationSignal ? " (" + terminationSignal + ")" : "")),
        durationMs: Math.round(performance.now() - started), logPath });
    });
  });
}

async function runChecks(checks, execute, { concurrency = 2, signal, onResult = () => {} } = {}) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Concurrency must be a positive integer.");
  let next = 0;
  const results = new Array(checks.length);
  const executeOne = async index => {
    const item = checks[index];
    try {
      results[index] = signal?.aborted
        ? { id: item.id, name: item.name, passed: false, reason: "Cancelled", durationMs: 0 }
        : await execute(item, index);
    } catch (error) {
      results[index] = { id: item.id, name: item.name, passed: false, reason: error.message, durationMs: 0 };
    }
    // A failed fixture stays red, but never hides the other fixture results.
    onResult(results[index]);
  };
  while (next < checks.length) {
    if (checks[next].exclusive) {
      await executeOne(next++);
      continue;
    }
    // Drain the current parallel batch before a native-input fixture starts;
    // limiting just its own worker would still let another browser overlap it.
    let end = next;
    while (end < checks.length && !checks[end].exclusive) end++;
    await Promise.all(Array.from({ length: Math.min(concurrency, end - next) }, async () => {
      while (next < end) await executeOne(next++);
    }));
  }
  return results;
}

function report(result) {
  console.log("::group::" + (result.passed ? "PASS " : "FAIL ") + result.name + " (" + (result.durationMs / 1000).toFixed(1) + "s)");
  if (result.logPath && fs.existsSync(result.logPath)) process.stdout.write(fs.readFileSync(result.logPath));
  console.log("\n::endgroup::");
  if (!result.passed) console.error("::error::" + result.name + ": " + result.reason);
}

async function main() {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.on("SIGINT", cancel);
  process.on("SIGTERM", cancel);
  const started = performance.now();
  let results;
  try {
    results = await runChecks(getBrowserChecks(process.env.CI_EXTENDED_BROWSER_CHECKS === "true"),
      (item, index) => runCheck(item, index, { signal: controller.signal }),
      { signal: controller.signal, onResult: report });
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
  fs.mkdirSync(ARTIFACT_ROOT, { recursive: true });
  fs.writeFileSync(path.join(ARTIFACT_ROOT, "results.json"), JSON.stringify(results, null, 2) + "\n");
  const summary = [
    "### Brave fixtures (two isolated displays)",
    "",
    "| Check | Result | Seconds |",
    "| --- | --- | ---: |",
    ...results.map(result => "| " + result.name + " | " + (result.passed ? "Passed" : result.reason) + " | " + (result.durationMs / 1000).toFixed(1) + " |"),
    "",
    "Browser wall time: " + ((performance.now() - started) / 1000).toFixed(1) + " seconds.",
    ""
  ].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(summary);
  process.exitCode = results.every(result => result.passed) ? 0 : 1;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { getBrowserChecks, childEnvironment, runCheck, runChecks };
