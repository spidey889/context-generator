const { createHash } = require("node:crypto");
const { applyCorsHeaders, isValidPreflightRequest, isTrustedExtensionRequest } = require("../api/request-security");
const { getHeader, parseBoundedJsonBody } = require("../api/request-validation");
const { consumeTelemetryRateLimit } = require("../api/telemetry-rate-limit");

// Preserve IDs across the JSON-to-Supabase move so seen messages stay seen.
function noticeForUser(userNumber, message) {
  if (!Number.isSafeInteger(userNumber) || userNumber < 1) return null;
  if (typeof message !== "string" || !message.trim() || message.length > 1000) return null;
  return { id: createHash("sha256").update(`${userNumber}\n${message}`).digest("hex"), message };
}

function createHandler({ fetchImpl = (...args) => fetch(...args), timeoutMs = 5000,
  rateLimit = consumeTelemetryRateLimit, env = process.env, log = console.info } = {}) {
  return async (req, res) => {
    const cors = applyCorsHeaders(req, res);
    if (req.method === "OPTIONS") return cors.allowedOrigin && isValidPreflightRequest(req)
      ? res.status(204).end() : res.status(403).json({ code: "client_not_allowed" });
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST, OPTIONS");
      return res.status(405).json({ code: "method_not_allowed" });
    }
    if (!isTrustedExtensionRequest(req)) return res.status(403).json({ code: "client_not_allowed" });
    if (getHeader(req, "content-type").split(";", 1)[0].toLowerCase() !== "application/json")
      return res.status(415).json({ code: "unsupported_content_type" });
    const parsed = parseBoundedJsonBody(req, 256, "Notice request");
    if (!parsed.ok) return res.status(parsed.status).json({ code: parsed.code });
    const input = parsed.body;
    const dismissal = input?.event === "dismiss";
    if (!input || Object.keys(input).length !== (dismissal ? 3 : 1) || typeof input.install_id !== "string"
        || (dismissal && (typeof input.notice_id !== "string" || !/^[a-f0-9]{64}$/.test(input.notice_id)))
        || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.install_id))
      return res.status(400).json({ code: "invalid_payload" });
    const upstream = env.SUPABASE_TELEMETRY_FUNCTION_URL, key = env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY;
    const secret = env.TELEMETRY_RELAY_SECRET;
    if (!upstream || !key || !secret || Buffer.byteLength(secret) < 32)
      return res.status(503).json({ code: "notices_unavailable" });
    const limit = await rateLimit(req, input);
    if (!limit.allowed) {
      res.setHeader("Retry-After", String(limit.retryAfterSeconds));
      return res.status(429).json({ code: "rate_limited" });
    }
    const controller = new AbortController();
    let timer;
    try {
      // Only Edge reads user_notices with its private database credentials.
      // The extension never supplies a user number or receives the directory.
      const result = await Promise.race([(async () => {
        const response = await fetchImpl(upstream, {
          method: "POST", redirect: "error", signal: controller.signal,
          headers: { "Content-Type": "application/json", apikey: key, "X-Cap-Context-Relay": secret },
          body: JSON.stringify({ kind: "user_notice_lookup", install_id: input.install_id, ...(!dismissal ? { include_message: true } : {}) })
        });
        if (!response.ok) throw new Error("lookup_failed");
        const body = await response.text();
        if (body.length > 7000) throw new Error("lookup_invalid");
        const { userNumber, message } = JSON.parse(body);
        if (userNumber !== null && (!Number.isSafeInteger(userNumber) || userNumber < 1)) throw new Error("lookup_invalid");
        if (dismissal) return userNumber;
        if (message === null) return null;
        const notice = noticeForUser(userNumber, message);
        if (!notice) throw new Error("lookup_invalid");
        return notice;
      })(), new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("lookup_timeout")); }, timeoutMs);
      })]);
      if (dismissal) {
        // Attribute using the private installation lookup, never a client-
        // supplied user number. Keep notice text and the installation UUID out
        // of logs; cached notices may have since been replaced in the table.
        if (result !== null) log("cap_context_user_notice_dismiss", { user_no: result, notice_id: input.notice_id });
        return res.status(204).end();
      }
      return res.status(200).json({ notice: result });
    } catch {
      return res.status(503).json({ code: "notices_unavailable" });
    } finally { clearTimeout(timer); }
  };
}

module.exports = createHandler();
module.exports.createHandler = createHandler;
module.exports.noticeForUser = noticeForUser;
