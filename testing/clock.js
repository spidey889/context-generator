const assert = require("node:assert/strict");
const test = require("node:test");

// Advance timers and Date together, yielding for async messages/body reads between ticks.
// VM fixtures must inject this Date as well as setTimeout so elapsed-time checks agree.
function clockTest(name, options, fn) {
  if (typeof options === "function") [fn, options] = [options, {}];
  test(name, { timeout: 5000, ...options }, async t => {
    t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: Date.now() });
    let settled = false;
    const operation = Promise.resolve().then(() => fn(t));
    operation.then(() => { settled = true; }, () => { settled = true; });
    try {
      for (let elapsed = 0; !settled && elapsed < 60000; elapsed += 10) {
        await new Promise(setImmediate);
        if (!settled) t.mock.timers.tick(10);
      }
      assert.ok(settled, "operation exceeded 60 seconds of simulated time");
      await operation;
    } finally {
      t.mock.timers.reset();
    }
  });
}

module.exports = { clockTest };
