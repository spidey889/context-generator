const {
  applyCorsHeaders,
  isValidPreflightRequest,
  isTrustedExtensionRequest
} = require("./request-security");
const { validateTelemetryRequest } = require("./telemetry-validation");
const { consumeTelemetryRateLimit } = require("./telemetry-rate-limit");
const RELAY_TIMEOUT_MS = 5000;

async function handler(req, res) {
  const cors = applyCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    if (!cors.allowedOrigin || !isValidPreflightRequest(req)) {
      return res.status(403).json({ code: "origin_not_allowed", error: "Origin is not allowed" });
    }
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST, OPTIONS");
    return res.status(405).json({ code: "method_not_allowed", error: "Method not allowed" });
  }

  if (!isTrustedExtensionRequest(req)) {
    return res.status(403).json({
      code: "client_not_allowed",
      error: "Request is not from a supported Cap Context client"
    });
  }

  const validation = validateTelemetryRequest(req);
  if (!validation.ok) {
    return res.status(validation.status).json({ code: validation.code, error: validation.error });
  }

  const upstreamUrl = process.env.SUPABASE_TELEMETRY_FUNCTION_URL;
  const upstreamKey = process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY;
  const relaySecret = process.env.TELEMETRY_RELAY_SECRET;
  if (!upstreamUrl || !upstreamKey || !relaySecret || Buffer.byteLength(relaySecret, "utf8") < 32) {
    return res.status(503).json({ code: "telemetry_unavailable", error: "Telemetry service is unavailable" });
  }

  const rateLimit = await consumeTelemetryRateLimit(req, validation.payload);
  if (!rateLimit.allowed) {
    res.setHeader("Retry-After", String(rateLimit.retryAfterSeconds));
    return res.status(429).json({ code: "telemetry_rate_limited", error: "Please retry telemetry later" });
  }

  const controller = new AbortController();
  let timer;
  try {
    const response = await Promise.race([fetch(upstreamUrl, {
      signal: controller.signal,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: upstreamKey,
        "X-Cap-Context-Relay": relaySecret
      },
      body: JSON.stringify(validation.payload)
    }), new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("telemetry_timeout")); }, RELAY_TIMEOUT_MS);
    })]);
    if (!response.ok) {
      // Parse only our bounded Edge codes, never relay provider/database bodies.
      const code = await readUpstreamCode(response, controller.signal);
      const permanentCodes = new Set(["invalid_payload", "invalid_summary_proof", "attempt_identity_mismatch", "request_too_large", "unsupported_content_type"]);
      if ([400, 413, 415, 422].includes(response.status) && permanentCodes.has(code)) {
        return res.status(response.status).json({ code, error: "Telemetry request rejected" });
      }
      if (response.status === 429) {
        const retry = Number(response.headers?.get?.("retry-after"));
        res.setHeader("Retry-After", String(Number.isFinite(retry) && retry > 0 ? Math.min(3600, Math.ceil(retry)) : 60));
        return res.status(429).json({ code: "telemetry_rate_limited", error: "Please retry telemetry later" });
      }
      const configuration = [401, 403].includes(response.status) || code === "telemetry_unavailable";
      console.warn("cap_context_telemetry", { reason: configuration ? "upstream_configuration" : "upstream_unavailable" });
      return res.status(503).json({ code: configuration ? "telemetry_unavailable" : "telemetry_upstream_unavailable", error: "Telemetry service is unavailable" });
    }
    return res.status(204).end();
  } catch {
    console.warn("cap_context_telemetry", { reason: "upstream_unavailable" });
    return res.status(503).json({ code: "telemetry_upstream_unavailable", error: "Telemetry service is unavailable" });
  } finally { clearTimeout(timer); }
}

async function readUpstreamCode(response, signal) {
  const reader = response.body?.getReader?.();
  if (!reader) return undefined;
  let abort;
  try {
    const bytes = new Uint8Array(4096);
    let size = 0;
    const read = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (size + value.byteLength > bytes.length) return undefined;
        bytes.set(value, size); size += value.byteLength;
      }
      return JSON.parse(new TextDecoder().decode(bytes.subarray(0, size)))?.code;
    })();
    return await Promise.race([read, new Promise((_, reject) => {
      abort = () => reject(new Error("telemetry_timeout"));
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
    })]);
  } catch { return undefined; }
  finally { if (abort) signal.removeEventListener("abort", abort); void reader.cancel().catch(() => {}); }
}

module.exports = handler;
module.exports.handler = handler;
