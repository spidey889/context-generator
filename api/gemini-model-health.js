const GEMINI_SUCCESS_LIMIT = 20;
const GEMINI_FAILURE_LIMIT = 3;
const GEMINI_HEALTH_RETENTION_SECONDS = 8 * 24 * 60 * 60;
const GEMINI_HEALTH_STORE_TIMEOUT_MS = 1200;
const GEMINI_HEALTH_KEY_PREFIX = "cap-context:gemini-health:v1";
const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const HEALTH_STATUSES = new Set(["available", "bad_mood", "exhausted"]);

const pacificDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

// These updates run inside Redis so simultaneous Vercel invocations cannot
// lose successful or failed request counts.
const BEGIN_ATTEMPT_SCRIPT = `
-- cap-context-gemini-health-attempt-v1
local status = redis.call("HGET", KEYS[1], "status") or "available"
local successes = tonumber(redis.call("HGET", KEYS[1], "successes") or "0")
local failures = tonumber(redis.call("HGET", KEYS[1], "failures") or "0")
local consecutive_failures = tonumber(redis.call("HGET", KEYS[1], "consecutiveFailures") or "0")
local attempts = tonumber(redis.call("HGET", KEYS[1], "attempts") or "0")
local allowed = 0
if status == "available" then
  attempts = redis.call("HINCRBY", KEYS[1], "attempts", 1)
  redis.call("HSET", KEYS[1], "updatedAt", ARGV[1])
  redis.call("EXPIRE", KEYS[1], tonumber(ARGV[2]))
  allowed = 1
end
return {status, tostring(successes), tostring(failures), tostring(consecutive_failures), tostring(attempts), ARGV[1], tostring(allowed)}
`;

const RECORD_SUCCESS_SCRIPT = `
-- cap-context-gemini-health-success-v1
local previous_status = redis.call("HGET", KEYS[1], "status")
local previous_consecutive_failures = tonumber(redis.call("HGET", KEYS[1], "consecutiveFailures") or "0")
local successes = redis.call("HINCRBY", KEYS[1], "successes", 1)
local failures = tonumber(redis.call("HGET", KEYS[1], "failures") or "0")
local attempts = tonumber(redis.call("HGET", KEYS[1], "attempts") or "0")
local status = "available"
local consecutive_failures = 0
if previous_status == "bad_mood" then
  status = "bad_mood"
  consecutive_failures = previous_consecutive_failures
elseif previous_status == "exhausted" or successes >= tonumber(ARGV[1]) then
  status = "exhausted"
end
redis.call("HSET", KEYS[1],
  "consecutiveFailures", consecutive_failures,
  "status", status,
  "lastOutcome", "success",
  "updatedAt", ARGV[2])
redis.call("EXPIRE", KEYS[1], tonumber(ARGV[3]))
return {status, tostring(successes), tostring(failures), tostring(consecutive_failures), tostring(attempts), ARGV[2]}
`;

const RECORD_FAILURE_SCRIPT = `
-- cap-context-gemini-health-failure-v1
local previous_status = redis.call("HGET", KEYS[1], "status")
local successes = tonumber(redis.call("HGET", KEYS[1], "successes") or "0")
local failures = redis.call("HINCRBY", KEYS[1], "failures", 1)
local consecutive_failures = redis.call("HINCRBY", KEYS[1], "consecutiveFailures", 1)
local attempts = tonumber(redis.call("HGET", KEYS[1], "attempts") or "0")
local status = "available"
if previous_status == "exhausted" or ARGV[2] == "1" then
  status = "exhausted"
elseif previous_status == "bad_mood" or consecutive_failures >= tonumber(ARGV[1]) then
  status = "bad_mood"
end
redis.call("HSET", KEYS[1],
  "status", status,
  "lastOutcome", "failure",
  "updatedAt", ARGV[3])
redis.call("EXPIRE", KEYS[1], tonumber(ARGV[4]))
return {status, tostring(successes), tostring(failures), tostring(consecutive_failures), tostring(attempts), ARGV[3]}
`;

function createGeminiModelHealth(options = {}) {
  const env = options.env || process.env;
  const now = options.now || (() => new Date());
  const fetchImpl = options.fetchImpl || ((...args) => fetch(...args));
  const explicitlyDisabled = String(env.GEMINI_MODEL_HEALTH_ENABLED || "").toLowerCase() === "false";
  const redisUrl = String(env.UPSTASH_REDIS_REST_URL || "").replace(/\/+$/, "");
  const redisToken = String(env.UPSTASH_REDIS_REST_TOKEN || "");
  const configured = !explicitlyDisabled && redisUrl.startsWith("https://") && Boolean(redisToken);
  let warned = false;

  const availableState = (model, tracking = configured ? "shared" : "disabled") => ({
    model,
    status: "available",
    available: true,
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    attempts: 0,
    updatedAt: null,
    pacificDate: getPacificDateKey(now()),
    tracking
  });

  if (!configured) {
    return {
      enabled: false,
      async getStatus(model) {
        return availableState(model);
      },
      async beginAttempt(model) {
        return availableState(model);
      },
      async recordSuccess(model) {
        return availableState(model);
      },
      async recordFailure(model) {
        return availableState(model);
      }
    };
  }

  const command = createUpstashCommand({
    url: redisUrl,
    token: redisToken,
    fetchImpl,
    timeoutMs: options.timeoutMs || GEMINI_HEALTH_STORE_TIMEOUT_MS
  });

  const runFailOpen = async (operation, model, callback) => {
    try {
      return await callback();
    } catch (error) {
      if (!warned) {
        warned = true;
        console.warn("[Context Generator] Gemini health store unavailable; using normal provider order.", {
          operation,
          message: error?.name || "store_error"
        });
      }
      return availableState(model, "unavailable");
    }
  };

  return {
    enabled: true,
    async getStatus(model) {
      return runFailOpen("read", model, async () => {
        const clock = now();
        const pacificDate = getPacificDateKey(clock);
        const result = await command([
          "HMGET",
          getHealthKey(pacificDate, model),
          "status",
          "successes",
          "failures",
          "consecutiveFailures",
          "attempts",
          "updatedAt"
        ]);
        return parseHealthState(model, pacificDate, result, "shared");
      });
    },
    async beginAttempt(model) {
      return runFailOpen("attempt", model, async () => {
        const clock = now();
        const pacificDate = getPacificDateKey(clock);
        const result = await command([
          "EVAL",
          BEGIN_ATTEMPT_SCRIPT,
          1,
          getHealthKey(pacificDate, model),
          clock.toISOString(),
          GEMINI_HEALTH_RETENTION_SECONDS
        ]);
        if (!Array.isArray(result) || !["0", "1"].includes(String(result[6]))) {
          throw new Error("Gemini health store returned an invalid attempt decision");
        }
        const state = parseHealthState(model, pacificDate, result, "shared");
        return { ...state, available: String(result?.[6]) === "1" };
      });
    },
    async recordSuccess(model) {
      return runFailOpen("success", model, async () => {
        const clock = now();
        const pacificDate = getPacificDateKey(clock);
        const result = await command([
          "EVAL",
          RECORD_SUCCESS_SCRIPT,
          1,
          getHealthKey(pacificDate, model),
          GEMINI_SUCCESS_LIMIT,
          clock.toISOString(),
          GEMINI_HEALTH_RETENTION_SECONDS
        ]);
        return parseHealthState(model, pacificDate, result, "shared");
      });
    },
    async recordFailure(model, options = {}) {
      return runFailOpen("failure", model, async () => {
        const clock = now();
        const pacificDate = getPacificDateKey(clock);
        const result = await command([
          "EVAL",
          RECORD_FAILURE_SCRIPT,
          1,
          getHealthKey(pacificDate, model),
          GEMINI_FAILURE_LIMIT,
          options.dailyQuotaExhausted ? 1 : 0,
          clock.toISOString(),
          GEMINI_HEALTH_RETENTION_SECONDS
        ]);
        return parseHealthState(model, pacificDate, result, "shared");
      });
    }
  };
}

function createUpstashCommand({ url, token, fetchImpl, timeoutMs }) {
  return async (parts) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(parts),
        signal: controller.signal
      });
      if (!response?.ok) throw new Error("Gemini health store rejected the request");
      const payload = await response.json();
      if (!payload || payload.error || !("result" in payload)) {
        throw new Error("Gemini health store returned an invalid response");
      }
      return payload.result;
    } finally {
      clearTimeout(timeout);
    }
  };
}

function getPacificDateKey(date = new Date()) {
  const parts = Object.fromEntries(
    pacificDateFormatter.formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function getHealthKey(pacificDate, model) {
  const safeModel = String(model || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${GEMINI_HEALTH_KEY_PREFIX}:${pacificDate}:${safeModel}`;
}

function parseHealthState(model, pacificDate, result, tracking) {
  const values = Array.isArray(result) ? result : [];
  const status = HEALTH_STATUSES.has(values[0]) ? values[0] : "available";
  return {
    model,
    status,
    available: status === "available",
    successes: toNonNegativeInteger(values[1]),
    failures: toNonNegativeInteger(values[2]),
    consecutiveFailures: toNonNegativeInteger(values[3]),
    attempts: toNonNegativeInteger(values[4]),
    updatedAt: typeof values[5] === "string" && values[5] ? values[5] : null,
    pacificDate,
    tracking
  };
}

function toNonNegativeInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

module.exports = {
  createGeminiModelHealth,
  getPacificDateKey,
  GEMINI_SUCCESS_LIMIT,
  GEMINI_FAILURE_LIMIT,
  __test: {
    BEGIN_ATTEMPT_SCRIPT,
    RECORD_SUCCESS_SCRIPT,
    RECORD_FAILURE_SCRIPT,
    getHealthKey,
    parseHealthState
  }
};
