// Shared by Node and Deno. This authenticates summary completion, not a paste
// or a person's identity. No conversation content is included in the receipt.
const encoder = new TextEncoder();

function confirmationMessage(payload) {
  return JSON.stringify([
    "cap-context-summary-confirmation-v1",
    payload.attempt_id,
    payload.install_id,
    payload.attempted_at,
    payload.source_platform,
    payload.destination_platform,
    payload.extension_version
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
  const signature = Uint8Array.from(payload.summary_proof.match(/../g), byte => Number.parseInt(byte, 16));
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(confirmationMessage(payload)));
}
