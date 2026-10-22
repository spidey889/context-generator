const assert = require("node:assert/strict");
const test = require("node:test");

// Advance timers and Date together, yielding for async messages/body reads between ticks.
// VM fixtures must inject this Date as well as setTimeout so elapsed-time checks agree.
function clockTest(name, options, fn) {
  if (typeof options === "function") [fn, options] = [options, {}];
  // Coarse steps are opt-in for long aligned deadlines; retry and UI boundaries stay fine.
  const { tickMs = 10, maxElapsedMs = 60000, ...testOptions } = options;
  assert.ok(Number.isSafeInteger(tickMs) && tickMs > 0, "clock step must be a positive integer");
  assert.ok(Number.isSafeInteger(maxElapsedMs) && maxElapsedMs > 0, "clock limit must be a positive integer");
  test(name, { timeout: 5000, ...testOptions }, async t => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
    let settled = false;
    const operation = Promise.resolve().then(() => fn(t));
    operation.then(() => { settled = true; }, () => { settled = true; });
    try {
      for (let elapsed = 0; !settled && elapsed < maxElapsedMs; elapsed += tickMs) {
        await new Promise(setImmediate);
        if (!settled) t.mock.timers.tick(tickMs);
      }
      assert.ok(settled, `operation exceeded ${maxElapsedMs / 1000} seconds of simulated time`);
      await operation;
    } finally {
      t.mock.timers.reset();
    }
  });
}

module.exports = { clockTest };
