const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { getBrowserChecks, childEnvironment, runCheck, runChecks } = require("../scripts/run-ci-browser-checks");
const { startFixtureServer } = require("../scripts/run-extension-smoke");

test("regular CI includes the installed emergency-control flow", () => {
  assert.equal(getBrowserChecks(false).find(check => check.id === "remote-controls")?.script,
    "scripts/run-remote-controls-smoke.js");
});

test("ordinary transfer fixtures answer notice polling without counting summary or telemetry requests", async t => {
  const fixture = await startFixtureServer();
  t.after(async () => {
    fixture.state.releasePickerLoad();
    fixture.server.closeAllConnections();
    await new Promise(resolve => fixture.server.close(resolve));
    await fixture.telemetryFixture.close();
  });
  const response = await fetch(`${fixture.origin}/api/user-notices`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Cap-Context-Client": "cap-context-extension/1" },
    body: JSON.stringify({ install_id: "11111111-1111-4111-8111-111111111111" })
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { notice: null });
  const controls = await fetch(`${fixture.origin}/extension-controls.json`);
  assert.equal(controls.status, 200);
  assert.deepEqual(await controls.json(), require("../extension/remote-controls").defaults());
  assert.equal(fixture.state.summaryRequests.length, 0);
  assert.equal(fixture.state.telemetryRequests.length, 0);
});

test("regular CI always includes the incident-shaped DeepSeek many-file transfer", () => {
  const check = getBrowserChecks().find(item => item.id === "deepseek-many-files");
  assert.ok(check, "This regression must not require extended/manual CI.");
  assert.equal(check.script, "scripts/run-deepseek-many-files-smoke.js");
  assert.ok(check.timeoutMs > 60000, "The fixture must outlive the full capture allowance.");
});

test("the real CI queue isolates local handoff motion from every other browser fixture", async () => {
  for (const extended of [false, true]) {
    const active = new Set();
    let observed = false;
    const results = await runChecks(getBrowserChecks(extended), async item => {
      active.add(item.id);
      try {
        await new Promise(setImmediate);
        if (item.id === "local-transfer") {
          observed = true;
          assert.equal(active.size, 1, "Short rendered sweeps must get an isolated CI slot.");
        } else {
          assert.equal(active.has("local-transfer"), false, "Other work cannot overlap the local handoff sampler.");
        }
        return { ...item, passed: true };
      } finally {
        active.delete(item.id);
      }
    });
    assert.equal(observed, true);
    assert.equal(results.every(result => result.passed), true);
  }
});

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
