// Shared by Node and Deno. This authenticates summary completion, not a paste
// or a person's identity. No conversation content is included in the receipt.
const encoder = new TextEncoder();

// Keep this bounded catalog aligned with summary routing. Store workers released
// before v3 forward the proof/time but omit model; only an HMAC match may recover it.
// Retain retired entries while seven-day outboxes can still contain their receipts.
export const LEGACY_RECEIPT_MODELS = Object.freeze([
  "local-direct", "gemini-3.6-flash", "gemini-3.5-flash-lite", "ministral-14b-2512",
  "inclusionai/ling-3.1-flash", "qwen/qwen3.8-27b:free",
  "dots-studio/dots-3-note-preview:free", "google/gemma-4-26b-a4b-it:free"
]);

function confirmationMessage(payload) {
  const version = payload.model !== undefined ? 3 : payload.summary_confirmed_at === undefined ? 1 : 2;
  return JSON.stringify([
    `cap-context-summary-confirmation-v${version}`,
    payload.attempt_id,
    payload.install_id,
    payload.attempted_at,
    payload.source_platform,
    payload.destination_platform,
    payload.extension_version,
    ...(version >= 2 ? [payload.summary_confirmed_at] : []),
    ...(version === 3 ? [payload.model] : [])
  ]);
}

async function signingKey(secret) {
  if (typeof secret !== "string" || encoder.encode(secret).length < 32) return null;
  return crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function createSummaryProof(payload, secret) {
  const key = await signingKey(secret);
  if (!key) return null;
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(confirmationMessage(payload)));
  return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifySummaryProof(payload, secret) {
  if (!/^[0-9a-f]{64}$/.test(payload?.summary_proof || "")) return false;
  const key = await signingKey(secret);
  if (!key) return false;
  return verifyWithKey(payload, key);
}

async function verifyWithKey(payload, key) {
  const signature = Uint8Array.from(payload.summary_proof.match(/../g), byte => Number.parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(confirmationMessage(payload)));
}

export async function verifySummaryReceipt(payload, secret) {
  if (!/^[0-9a-f]{64}$/.test(payload?.summary_proof || "")) return null;
  const key = await signingKey(secret);
  if (!key) return null;
  if (await verifyWithKey(payload, key)) return { model: payload.model ?? null };
  // An explicitly supplied model must verify exactly. Genuine v1/v2 receipts
  // above retain NULL; missing time or a forged/tampered proof cannot infer one.
  if (payload.model !== undefined || !payload.summary_confirmed_at) return null;
  for (const model of LEGACY_RECEIPT_MODELS) {
    if (await verifyWithKey({ ...payload, model }, key)) return { model };
  }
  return null;
}
