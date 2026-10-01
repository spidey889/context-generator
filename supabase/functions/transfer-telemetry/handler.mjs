import { validateTelemetryPayload } from "./validation.mjs";
import { verifySummaryProof } from "../_shared/summary-proof.mjs";

const MAX_BODY_CHARS = 4096;

export function createTelemetryHandler({ createClient, getEnv }) {
  return async (request) => {
    const headers = getCorsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, headers);
    if (!isAuthorizedPublishableKey(request.headers.get("apikey"), getEnv)) {
      return jsonResponse({ error: "Unauthorized" }, 401, headers);
    }
  
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") return jsonResponse({ error: "JSON required" }, 415, headers);
  
    try {
      const rawBody = await request.text();
      if (!rawBody || rawBody.length > MAX_BODY_CHARS) return jsonResponse({ error: "Invalid payload" }, 400, headers);
  
      const payload = validateTelemetryPayload(JSON.parse(rawBody));
      if (!payload) return jsonResponse({ error: "Invalid payload" }, 400, headers);
      // Client outcomes remain diagnostics. Only this server-side decision can
      // mark a summary as verified, including when callers bypass Vercel.
      const summaryVerified = await verifySummaryProof(payload, getEnv("TELEMETRY_SIGNING_KEY"));
  
      const supabase = createClient(
        getEnv("SUPABASE_URL") || "",
        getEnv("SUPABASE_SERVICE_ROLE_KEY") || "",
        { auth: { persistSession: false, autoRefreshToken: false } }
      );
      const { error } = await supabase
        .rpc("record_transfer_event", {
          p_attempt_id: payload.attempt_id,
          p_install_id: payload.install_id,
          p_attempted_at: payload.attempted_at,
          p_source_platform: payload.source_platform,
          p_destination_platform: payload.destination_platform,
          p_character_count: payload.character_count,
          p_status: payload.status,
          p_last_stage: payload.last_stage,
          p_failure_reason: payload.failure_reason,
          p_extension_version: payload.extension_version,
          p_summary_verified: summaryVerified
        });
  
      if (error) return jsonResponse({ error: "Telemetry unavailable" }, 503, headers);
      return new Response(null, { status: 204, headers });
    } catch {
      return jsonResponse({ error: "Invalid payload" }, 400, headers);
    }
  };
}

function isAuthorizedPublishableKey(apiKey, getEnv) {
  if (!apiKey) return false;
  try {
    const configured = JSON.parse(getEnv("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    return Object.values(configured).includes(apiKey);
  } catch {
    return false;
  }
}

function getCorsHeaders(request) {
  const origin = request.headers.get("origin") || "*";
  const allowedOrigin = /^(?:chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" }
  });
}
