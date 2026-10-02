const { createHmac } = require("node:crypto");
const { getHeader } = require("./request-validation");
const STATE_KEY = Symbol.for("cap-context.telemetry-rate-limit.v1");
const STORE_TIMEOUT_MS = 450;
const MAX_LOCAL_KEYS = 5000;
const LIMIT_SCRIPT = `
-- cap-context-telemetry-limits-v1: check every budget before consuming any.
for i, key in ipairs(KEYS) do
  if tonumber(redis.call("GET", key) or "0") >= tonumber(ARGV[(i - 1) * 3 + 1]) then
    return {0, tonumber(ARGV[(i - 1) * 3 + 3])}
  end
end
for i, key in ipairs(KEYS) do
  local count = redis.call("INCR", key)
  if count == 1 then redis.call("EXPIRE", key, tonumber(ARGV[(i - 1) * 3 + 2])) end
end
return {1, 0}
`;

async function consumeTelemetryRateLimit(req, payload, options = {}) {
  const env = options.env || process.env;
  const now = options.now ?? Date.now();
  const fetchImpl = options.fetchImpl || fetch;
  const url = String(env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "";
  const salt = env.TELEMETRY_RELAY_SECRET || token || "cap-context-local-limits";
  const digest = value => createHmac("sha256", salt).update(value).digest("hex").slice(0, 32);
  // Vercel sets its forwarded header. Fall back for local/development servers.
  // IPs are never placed in telemetry, logs or Redis: only short-lived keyed hashes.
  const ip = getHeader(req, "x-vercel-forwarded-for").split(",")[0].trim()
    || getHeader(req, "x-forwarded-for").split(",")[0].trim() || req.socket?.remoteAddress || "unknown";
  const budgets = [
    budget(`install:${digest(payload.install_id)}`, 60, 180, now),
    budget(`install:${digest(payload.install_id)}`, 3600, 2000, now),
    budget(`ip:${digest(ip.slice(0, 128))}`, 60, 3000, now),
    budget(`ip:${digest(ip.slice(0, 128))}`, 3600, 30000, now),
    budget("global", 60, 20000, now),
    budget("global", 3600, 60000, now),
    budget("global", 86400, 200000, now)
  ];
  if (url.startsWith("https://") && token) {
    const controller = new AbortController();
    let timer;
    try {
      const operation = (async () => {
        const response = await fetchImpl(url, {
          method: "POST", signal: controller.signal,
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(["EVAL", LIMIT_SCRIPT, budgets.length, ...budgets.map(item => item.key),
            ...budgets.flatMap(item => [item.limit, item.ttl, item.retryAfterSeconds])])
        });
        if (!response.ok) throw new Error("rate_store_unavailable");
        const body = await response.json();
        if (!Array.isArray(body.result) || ![0, 1].includes(Number(body.result[0]))) throw new Error("rate_store_unavailable");
        return { allowed: Number(body.result[0]) === 1, retryAfterSeconds: Math.max(1, Math.min(86400, Number(body.result[1]) || 1)), tracking: "shared" };
      })();
      return await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("rate_store_timeout")); }, options.timeoutMs || STORE_TIMEOUT_MS);
      })]);
    } catch {
      const state = localState();
      if (now - state.warnedAt >= 60000 || !state.warnedAt) {
        state.warnedAt = now;
        (options.log || console.warn)("cap_context_telemetry", { reason: "rate_store_unavailable" });
      }
    } finally { clearTimeout(timer); }
  }
  return consumeLocal(budgets, now);
}

function budget(identity, seconds, limit, now) {
  const window = Math.floor(now / (seconds * 1000));
  return {
    key: `cap-context:telemetry-limit:v1:${identity}:${seconds}:${window}`,
    limit, ttl: seconds + 2,
    retryAfterSeconds: Math.max(1, Math.ceil(((window + 1) * seconds * 1000 - now) / 1000))
  };
}

function localState() {
  if (!globalThis[STATE_KEY]) globalThis[STATE_KEY] = { counts: new Map(), warnedAt: 0 };
  return globalThis[STATE_KEY];
}

function consumeLocal(budgets, now) {
  const { counts } = localState();
  for (const [key, entry] of counts) if (entry.expiresAt <= now) counts.delete(key);
  for (const item of budgets) {
    if ((counts.get(item.key)?.count || 0) >= item.limit) return { allowed: false, retryAfterSeconds: item.retryAfterSeconds, tracking: "local" };
  }
  for (const item of budgets) {
    const old = counts.get(item.key);
    counts.set(item.key, { count: (old?.count || 0) + 1, expiresAt: old?.expiresAt || now + item.ttl * 1000 });
  }
  // Global budgets survive install/IP churn while the fallback map stays bounded.
  while (counts.size > MAX_LOCAL_KEYS) {
    const key = [...counts.keys()].find(key => !key.includes(":global:"));
    if (!key) break;
    counts.delete(key);
  }
  return { allowed: true, tracking: "local" };
}

function resetTelemetryRateLimitForTests() { delete globalThis[STATE_KEY]; }
module.exports = { consumeTelemetryRateLimit, resetTelemetryRateLimitForTests, STORE_TIMEOUT_MS };
