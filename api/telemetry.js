const {
  applyCorsHeaders,
  isValidPreflightRequest,
  isTrustedExtensionRequest
} = require("./request-security");
const { validateTelemetryRequest } = require("./telemetry-validation");

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
  if (!upstreamUrl || !upstreamKey) {
    return res.status(503).json({ code: "telemetry_unavailable", error: "Telemetry service is unavailable" });
  }

  try {
    const response = await fetch(upstreamUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: upstreamKey
      },
      body: JSON.stringify(validation.payload)
    });
    if (!response.ok) {
      return res.status(503).json({ code: "telemetry_unavailable", error: "Telemetry service is unavailable" });
    }
    return res.status(204).end();
  } catch {
    return res.status(503).json({ code: "telemetry_unavailable", error: "Telemetry service is unavailable" });
  }
}

module.exports = handler;
module.exports.handler = handler;
