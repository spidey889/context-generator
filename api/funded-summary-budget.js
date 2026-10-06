const { createHmac } = require("node:crypto");
const { getHeader } = require("./request-validation");
const STORE_TIMEOUT_MS = 450;
const DAY_MS = 86400000;
const RESERVE_SCRIPT = `
-- Reserve both budgets atomically before EACH funded HTTP attempt, including retries.
for i, key in ipairs(KEYS) do
  if tonumber(redis.call("GET", key) or "0") + tonumber(ARGV[1]) > tonumber(ARGV[i + 2]) then
    return 0
  end
end
for i, key in ipairs(KEYS) do
  local count = redis.call("INCRBY", key, ARGV[1])
  if count == tonumber(ARGV[1]) then redis.call("EXPIRE", key, ARGV[2]) end
end
return 1
`;

async function reserveFundedSummaryBudget(req, units, options = {}) {
  const env = options.env || process.env;
  const url = String(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  const ipLimit = Number(env.FUNDED_SUMMARY_IP_DAILY_UNITS ?? 2000000);
  const globalLimit = Number(env.FUNDED_SUMMARY_GLOBAL_DAILY_UNITS ?? 10000000);
  // No local/fail-open fallback: unavailable shared accounting must not spend money.
  if (!url.startsWith("https://") || !token || !Number.isSafeInteger(units) || units <= 0
      || ![ipLimit, globalLimit].every(value => Number.isSafeInteger(value) && value >= 0)
      || units > Math.min(ipLimit, globalLimit)) return false;
  options.signal?.throwIfAborted();
  const ip = getHeader(req, "x-vercel-forwarded-for").split(",")[0].trim()
    || getHeader(req, "x-forwarded-for").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  const digest = createHmac("sha256", token).update(ip.slice(0, 128)).digest("hex").slice(0, 32);
  const day = Math.floor((options.now ?? Date.now()) / DAY_MS);
  const keys = [`cap-context:funded-summary:v1:ip:${digest}:${day}`, `cap-context:funded-summary:v1:global:${day}`];
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const deadline = Date.now() + STORE_TIMEOUT_MS;
  const checkDeadline = () => {
    // A completed fetch/parser microtask can run before an overdue timer.
    // options.now selects the accounting day; the deadline uses elapsed runtime.
    if (Date.now() >= deadline) controller.abort();
    signal.throwIfAborted();
  };
  let timer;
  try {
    const operation = (async () => {
      checkDeadline();
      const response = await (options.fetchImpl || fetch)(url, {
        method: "POST", signal,
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(["EVAL", RESERVE_SCRIPT, 2, ...keys, units, 86460, ipLimit, globalLimit])
      });
      checkDeadline();
      if (!response.ok) return false;
      const body = await response.json();
      checkDeadline();
      return body.result === 1;
    })();
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("funded_budget_timeout")); }, Math.max(0, deadline - Date.now()));
    })]);
  } catch {
    options.signal?.throwIfAborted();
    return false;
  } finally { clearTimeout(timer); }
}

module.exports = { reserveFundedSummaryBudget };
