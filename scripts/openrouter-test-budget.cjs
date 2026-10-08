// Preloaded only by the local test wrapper; never imported by production code.
const fs = require("node:fs");
const LIMIT = 50;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const SPACING_MS = 3100;
const MODELS = new Set(["inclusionai/ling-3.1-flash", "dots-studio/dots-3-note-preview:free", "qwen/qwen3.8-27b:free"]);

function reserveRequest(ledgerPath, now = Date.now()) {
  // Count before sending, including failures. A rolling window is conservative
  // across provider reset boundaries. The lock prevents concurrent overspending.
  const lockPath = `${ledgerPath}.lock`;
  const lock = fs.openSync(lockPath, "wx");
  try {
    const ledger = fs.existsSync(ledgerPath) ? JSON.parse(fs.readFileSync(ledgerPath, "utf8")) : { requests: [] };
    if (!Array.isArray(ledger.requests) || ledger.requests.some(value => !Number.isFinite(value))) {
      throw new Error("Invalid test request ledger; refusing to reset usage");
    }
    const requests = ledger.requests.filter(value => value > now - WINDOW_MS);
    if (requests.length >= LIMIT) return { allowed: false, used: requests.length, waitMs: 0 };
    const startAt = Math.max(now, (requests.at(-1) || 0) + SPACING_MS);
    requests.push(startAt);
    const temporary = `${ledgerPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ requests }) + "\n");
    fs.renameSync(temporary, ledgerPath);
    return { allowed: true, used: requests.length, waitMs: startAt - now };
  } finally {
    fs.closeSync(lock);
    fs.unlinkSync(lockPath);
  }
}

function createGuardedFetch(fetch, { key, ledgerPath, slot, clock = Date.now }) {
  return async (input, options = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const body = typeof options.body === "string" ? JSON.parse(options.body) : null;
    const headers = new Headers(options.headers);
    if (url.href !== "https://openrouter.ai/api/v1/chat/completions" || !MODELS.has(body?.model)
        || headers.get("authorization") !== `Bearer ${key}`
        || body?.provider?.data_collection !== "deny"
        || !["prompt", "completion", "request"].every(field => body?.provider?.max_price?.[field] === 0)) {
      throw new Error("Test runner permits only the selected test key and configured free/private routes");
    }
    const budget = reserveRequest(ledgerPath, clock());
    globalThis.__capContextTestBudget = { slot, used: budget.used, limit: LIMIT, windowHours: 24, blockedLocally: !budget.allowed };
    if (!budget.allowed) {
      console.warn("Local test-key request cap reached; no provider request sent.");
      return new Response("{}", { status: 429, headers: { "content-type": "application/json" } });
    }
    if (budget.waitMs) await new Promise(resolve => setTimeout(resolve, budget.waitMs));
    return fetch(input, options);
  };
}

if (process.env.CAP_CONTEXT_TEST_KEY_SLOT && process.env.CAP_CONTEXT_TEST_LEDGER_PATH) {
  globalThis.fetch = createGuardedFetch(globalThis.fetch, {
    key: process.env.OPENROUTER_API_KEY,
    slot: process.env.CAP_CONTEXT_TEST_KEY_SLOT,
    ledgerPath: process.env.CAP_CONTEXT_TEST_LEDGER_PATH
  });
}

module.exports = { reserveRequest, createGuardedFetch };
