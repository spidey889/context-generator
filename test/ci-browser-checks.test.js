const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { childEnvironment, runCheck, runChecks } = require("../scripts/run-ci-browser-checks");

test("CI browser queue bounds parallelism and still runs every case after failure", async () => {
  let active = 0;
  let maximum = 0;
  const started = [];
  const releases = [];
  const checks = ["first", "failure", "last"].map(id => ({ id, name: id }));
  const running = runChecks(checks, async item => {
    started.push(item.id);
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => { releases.push(resolve); });
    active--;
    if (item.id === "failure") throw new Error("Real fixture failed");
    return { ...item, passed: true };
  });
  assert.deepEqual(started, ["first", "failure"]);
  releases[1]();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["first", "failure", "last"]);
  releases[0]();
  releases[2]();
  const results = await running;
  assert.equal(maximum, 2);
  assert.deepEqual(results.map(result => result.passed), [true, false, true]);
  assert.equal(results[1].reason, "Real fixture failed");
});

test("CI child processes preserve nonzero exits and separate complete stdout/stderr logs", async t => {
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cap-ci-runner-"));
  t.after(() => fs.rmSync(artifactRoot, { recursive: true, force: true }));
  const checks = [0, 17].map((code, index) => ({
    id: "case-" + index, name: "Case " + index, timeoutMs: 10000,
    command: process.execPath,
    args: ["-e", "console.log(process.env.CAP_CONTEXT_JSON_SMOKE); console.error('stderr'); process.exit(" + code + ")"],
    env: { CAP_CONTEXT_JSON_SMOKE: index ? "chatgpt" : "deepseek" }
  }));
  const results = await runChecks(checks, (item, index) => runCheck(item, index, { artifactRoot }));
  assert.deepEqual(results.map(result => result.passed), [true, false]);
  assert.equal(results[1].reason, "Exit 17");
  assert.match(fs.readFileSync(results[0].logPath, "utf8"), /deepseek\r?\nstderr/);
  assert.match(fs.readFileSync(results[1].logPath, "utf8"), /chatgpt\r?\nstderr/);
  assert.notEqual(results[0].logPath, results[1].logPath);
  const isolated = childEnvironment(checks[0], "artifacts", {
    PATH: "inherited-path", BRAVE_PATH: "custom-brave",
    CAP_CONTEXT_LIVE_TELEMETRY_SMOKE: "1", CAP_CONTEXT_ESCAPE_SMOKE: "source", CAP_CONTEXT_SMOKE_TIMEOUT_MS: "1"
  });
  assert.deepEqual(isolated, {
    PATH: "inherited-path", BRAVE_PATH: "custom-brave",
    CAP_CONTEXT_JSON_SMOKE: "deepseek", CAP_CONTEXT_SMOKE_ARTIFACT_DIR: "artifacts"
  });
});

test("CI timeouts and cancellation fail the case and release its process", async t => {
  const artifactRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cap-ci-deadline-"));
  t.after(() => fs.rmSync(artifactRoot, { recursive: true, force: true }));
  const check = { id: "timeout", name: "Timeout", timeoutMs: 500,
    command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"], env: {} };
  const timedOut = await runCheck(check, 0, { artifactRoot });
  assert.equal(timedOut.passed, false);
  assert.match(timedOut.reason, /Timed out/);
  const controller = new AbortController();
  const cancelled = runCheck({ ...check, id: "cancel", timeoutMs: 10000 }, 1, { artifactRoot, signal: controller.signal });
  controller.abort();
  const result = await cancelled;
  assert.equal(result.passed, false);
  assert.equal(result.reason, "Cancelled");
});

test("native-input fixtures wait for both workers and run alone before the queue resumes", async () => {
  const started = [];
  const releases = new Map();
  const checks = ["a", "b", "native", "after"].map(id => ({ id, name: id, exclusive: id === "native" }));
  const running = runChecks(checks, async item => {
    started.push(item.id);
    await new Promise(resolve => releases.set(item.id, resolve));
    return { ...item, passed: true };
  });
  const tick = () => new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(started, ["a", "b"]);
  releases.get("a")();
  await tick();
  assert.deepEqual(started, ["a", "b"], "Native input must wait for the second worker too.");
  releases.get("b")();
  await tick();
  assert.deepEqual(started, ["a", "b", "native"]);
  releases.get("native")();
  await tick();
  assert.deepEqual(started, ["a", "b", "native", "after"]);
  releases.get("after")();
  assert.equal((await running).every(result => result.passed), true);
});
