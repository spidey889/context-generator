import { validateTelemetryPayload } from "./validation.mjs";
import { verifySummaryReceipt } from "../_shared/summary-proof.mjs";

const MAX_BODY_BYTES = 4096;

export function createTelemetryHandler({ createClient, getEnv, log = console.warn, rpcTimeoutMs = 4000, bodyTimeoutMs = 1000 }) {
  const report = reason => log("cap_context_telemetry", { reason });
  return async request => {
    const headers = getCorsHeaders(request);
    const failure = (status, code) => jsonResponse({ code, error: status < 500 ? "Telemetry request rejected" : "Telemetry service is unavailable" }, status, headers);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return failure(405, "method_not_allowed");

    const relaySecret = getEnv("TELEMETRY_RELAY_SECRET");
    if (!relaySecret || new TextEncoder().encode(relaySecret).length < 32) {
      report("relay_not_configured");
      return failure(503, "telemetry_unavailable");
    }
    // A Supabase publishable key is public. Only the private backend relay may
    // invoke this service-role writer; existing extensions already use Vercel.
    if (!constantTimeEqual(request.headers.get("x-cap-context-relay"), relaySecret)) return failure(401, "relay_not_authorized");
    const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/json") return failure(415, "unsupported_content_type");

    let rawBody;
    try { rawBody = await readBoundedBody(request, bodyTimeoutMs); }
    catch (error) { return failure(error.status || 400, error.code || "invalid_payload"); }
    let input;
    try { input = JSON.parse(rawBody); } catch { return failure(400, "invalid_payload"); }
    const payload = validateTelemetryPayload(input);
    if (!payload) return failure(400, "invalid_payload");

    const signingSecret = getEnv("TELEMETRY_SIGNING_KEY");
    if (payload.summary_proof !== undefined && (!signingSecret || new TextEncoder().encode(signingSecret).length < 32)) {
      report("signing_not_configured");
      return failure(503, "telemetry_unavailable");
    }
    const receipt = await verifySummaryReceipt(payload, signingSecret);
    const summaryVerified = receipt !== null;
    if (payload.summary_proof !== undefined && !summaryVerified) {
      report("summary_proof_invalid");
      return failure(422, "invalid_summary_proof");
    }
    if (!getEnv("SUPABASE_URL") || !getEnv("SUPABASE_SERVICE_ROLE_KEY")) {
      report("database_not_configured");
      return failure(503, "telemetry_unavailable");
    }

    try {
      const supabase = createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(rpcTimeoutMs) }) }
      });
      const { error } = await deadline(supabase.rpc("record_transfer_event", {
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
        p_summary_verified: summaryVerified,
        p_completed_at: payload.completed_at || null,
        // V1 receipts verify lifetime work, but do not authenticate occurrence time.
        p_summary_confirmed_at: summaryVerified ? payload.summary_confirmed_at || null : null,
        // Includes model recovered from the v3 proof forwarded by an older worker.
        p_model: receipt?.model || null,
        // This never grants summary verification. The database distinguishes
        // observed model reports from authenticated v3 attribution.
        p_reported_model: payload.reported_model || null
      }), rpcTimeoutMs);
      if (error) {
        if (error.code === "22023") return failure(422, "attempt_identity_mismatch");
        if (["23514", "23502", "22P02", "22007", "22008"].includes(error.code)) return failure(422, "invalid_payload");
        const configuration = ["42501", "PGRST202", "PGRST301", "PGRST302"].includes(error.code);
        report(configuration ? "database_configuration" : "database_unavailable");
        return failure(503, configuration ? "telemetry_unavailable" : "telemetry_upstream_unavailable");
      }
      return new Response(null, { status: 204, headers });
    } catch {
      report("database_unavailable");
      return failure(503, "telemetry_upstream_unavailable");
    }
  };
}

async function readBoundedBody(request, timeoutMs) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) throw { status: 413, code: "request_too_large" };
  const reader = request.body?.getReader();
  if (!reader) throw { status: 400, code: "invalid_payload" };
  const chunks = [];
  let size = 0;
  try {
    await deadline((async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) throw { status: 413, code: "request_too_large" };
        chunks.push(value);
      }
    })(), timeoutMs, { status: 408, code: "request_timeout" });
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } finally {
    // Do not wait for a malicious stream's cancellation hook.
    void reader.cancel().catch(() => {});
  }
}

async function deadline(operation, timeoutMs, error = new Error("telemetry_timeout")) {
  let timer;
  try { return await Promise.race([operation, new Promise((_, reject) => { timer = setTimeout(() => reject(error), timeoutMs); })]); }
  finally { clearTimeout(timer); }
}

function constantTimeEqual(value, expected) {
  if (typeof value !== "string" || value.length !== expected.length || value.length > 256) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

function getCorsHeaders(request) {
  const origin = request.headers.get("origin") || "";
  return {
    ...(/^(?:chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin) ? { "Access-Control-Allow-Origin": origin } : {}),
    "Access-Control-Allow-Headers": "apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    Vary: "Origin"
  };
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });
}
