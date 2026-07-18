import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import { validateTelemetryPayload } from "./validation.mjs";

const MAX_BODY_CHARS = 4096;

Deno.serve(async (request: Request) => {
  const headers = getCorsHeaders(request);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405, headers);
  if (!isAuthorizedPublishableKey(request.headers.get("apikey"))) {
    return jsonResponse({ error: "Unauthorized" }, 401, headers);
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") return jsonResponse({ error: "JSON required" }, 415, headers);

  try {
    const rawBody = await request.text();
    if (!rawBody || rawBody.length > MAX_BODY_CHARS) return jsonResponse({ error: "Invalid payload" }, 400, headers);

    const payload = validateTelemetryPayload(JSON.parse(rawBody));
    if (!payload) return jsonResponse({ error: "Invalid payload" }, 400, headers);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
    if (payload.status === "started") {
      const { data: existing, error: lookupError } = await supabase
        .from("transfer_events")
        .select("status")
        .eq("attempt_id", payload.attempt_id)
        .maybeSingle();
      if (lookupError) return jsonResponse({ error: "Telemetry unavailable" }, 503, headers);
      if (existing?.status === "succeeded" || existing?.status === "failed") {
        return new Response(null, { status: 204, headers });
      }
    }

    const { error } = await supabase
      .from("transfer_events")
      .upsert({ ...payload, updated_at: new Date().toISOString() }, { onConflict: "attempt_id" });

    if (error) return jsonResponse({ error: "Telemetry unavailable" }, 503, headers);
    return new Response(null, { status: 204, headers });
  } catch {
    return jsonResponse({ error: "Invalid payload" }, 400, headers);
  }
});

function isAuthorizedPublishableKey(apiKey: string | null) {
  if (!apiKey) return false;
  try {
    const configured = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    return Object.values(configured).includes(apiKey);
  } catch {
    return false;
  }
}

function getCorsHeaders(request: Request) {
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

function jsonResponse(body: object, status: number, headers: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json" }
  });
}
