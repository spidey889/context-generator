const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { reserveRequest, createGuardedFetch } = require("../scripts/openrouter-test-budget.cjs");

function ledger(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cap-test-budget-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("cap-test-budget-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return path.join(directory, "usage.json");
}

test("failed requests consume the fiftieth slot and the next attempt never reaches the provider", async t => {
  const file = ledger(t), now = Date.now();
  fs.writeFileSync(file, JSON.stringify({ requests: Array(49).fill(now - 60000) }));
  let calls = 0;
  const fetch = createGuardedFetch(async () => { calls++; return new Response("{}", { status: 502 }); }, { key: "test-only", ledgerPath: file, slot: "test-a", clock: () => now });
  const options = { headers: { Authorization: "Bearer test-only" }, body: JSON.stringify({ model: "inclusionai/ling-3.1-flash", provider: { data_collection: "deny", max_price: { prompt: 0, completion: 0, request: 0 } } }) };
  assert.equal((await fetch("https://openrouter.ai/api/v1/chat/completions", options)).status, 502);
  assert.equal((await fetch("https://openrouter.ai/api/v1/chat/completions", options)).status, 429);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(fs.readFileSync(file)).requests.length, 50);
});

test("old requests expire, separate key ledgers stay independent, and reservations are spaced", t => {
  const file = ledger(t), second = ledger(t), now = Date.now();
  fs.writeFileSync(file, JSON.stringify({ requests: Array(50).fill(now - 24 * 3600000 - 1) }));
  assert.equal(reserveRequest(file, now).used, 1);
  assert.equal(reserveRequest(file, now).waitMs, 3100);
  assert.equal(reserveRequest(second, now).used, 1);
});

test("corrupt or locked ledgers fail closed instead of resetting quota", t => {
  const file = ledger(t);
  fs.writeFileSync(file, "broken JSON");
  assert.throws(() => reserveRequest(file));
  fs.writeFileSync(`${file}.lock`, "");
  assert.throws(() => reserveRequest(file), /EEXIST/);
});

test("a paid route or different credential cannot reach the provider", async t => {
  let calls = 0;
  const file = ledger(t);
  const fetch = createGuardedFetch(async () => { calls++; }, { key: "test-only", ledgerPath: file, slot: "test-a" });
  await assert.rejects(fetch("https://openrouter.ai/api/v1/chat/completions", { headers: { Authorization: "Bearer another-key" }, body: JSON.stringify({ model: "paid-model" }) }), /free\/private routes/);
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(file), false);
});
