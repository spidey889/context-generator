const { createHash, createHmac, timingSafeEqual } = require("node:crypto");
const { validateTelemetryPayload } = require("./telemetry-validation");
const { getHeader, invalid, parseBoundedJsonBody } = require("./request-validation");

const MAX_WIRE_BYTES = 3000000;
const MAX_PART_CHARS = 750000;
const MAX_SUMMARY_CHARS = 60000;
const RECEIPT_TTL_MS = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ownKeys = (value, required, optional = []) => value && typeof value === "object" && !Array.isArray(value)
  && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const hash = value => createHash("sha256").update(value).digest("hex");

function identityHash(telemetry) {
  return hash(JSON.stringify(telemetry ? [telemetry.attempt_id, telemetry.install_id, telemetry.attempted_at,
    telemetry.source_platform, telemetry.destination_platform, telemetry.extension_version, telemetry.character_count] : null));
}

function validateRequest(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(getHeader(req, "content-type"))) {
    return invalid(415, "unsupported_content_type", "Content-Type must be application/json");
  }
  if (Number(getHeader(req, "content-length")) > MAX_WIRE_BYTES) return invalid(413, "request_too_large", "Request payload is too large");
  const parsed = parseBoundedJsonBody(req, MAX_WIRE_BYTES, "Large summary request");
  if (!parsed.ok) return parsed;
  const body = parsed.body, large = body?.large;
  const part = large?.phase === "part";
  if (!ownKeys(body, part ? ["conversation", "large"] : ["large", "parts"], ["telemetry"])
    || !ownKeys(large, part ? ["version", "phase", "transferId", "index", "total", "totalChars", "offset"]
      : ["version", "phase", "transferId", "total", "totalChars"])
    || large.version !== 1 || !["part", "final"].includes(large.phase) || !UUID.test(large.transferId)
    || !integer(large.total, 2, 16) || !integer(large.totalChars, 1000001, 4000000)) {
    return invalid(400, "invalid_schema", "Invalid large summary request");
  }
  let telemetry;
  if (Object.hasOwn(body, "telemetry")) {
    telemetry = validateTelemetryPayload(body.telemetry);
    if (!telemetry || telemetry.status !== "started" || telemetry.attempt_id !== large.transferId
      || telemetry.character_count !== large.totalChars || telemetry.summary_proof !== undefined
      || telemetry.summary_confirmed_at !== undefined || telemetry.model !== undefined) {
      return invalid(400, "invalid_schema", "Invalid summary telemetry context");
    }
  }
  if (part) {
    if (typeof body.conversation !== "string" || !body.conversation.trim()
      || body.conversation.length > MAX_PART_CHARS || Buffer.byteLength(body.conversation, "utf8") > MAX_WIRE_BYTES
      || !integer(large.index, 0, large.total - 1) || !integer(large.offset, 0, large.totalChars - 1)
      || large.offset + body.conversation.length > large.totalChars) {
      return invalid(413, "conversation_too_large", "Invalid or oversized conversation part");
    }
  } else if (!Array.isArray(body.parts) || body.parts.length !== large.total
    || body.parts.some(item => !ownKeys(item, ["summary", "receipt"])
      || typeof item.summary !== "string" || !item.summary.trim() || item.summary.length > MAX_SUMMARY_CHARS
      || typeof item.receipt !== "string" || item.receipt.length > 2048)) {
    return invalid(400, "invalid_schema", "Invalid summary parts");
  }
  return { ok: true, ...body, ...(telemetry ? { telemetry } : {}) };
}

function validSecret(secret) { return typeof secret === "string" && Buffer.byteLength(secret, "utf8") >= 32; }

function signPart({ large, conversation, summary, telemetry }, secret, now = Date.now()) {
  if (!validSecret(secret)) return null;
  const payload = Buffer.from(JSON.stringify({ v: 1, flow: large.transferId, index: large.index, total: large.total,
    totalChars: large.totalChars, offset: large.offset, chars: conversation.length, summary: hash(summary),
    identity: identityHash(telemetry), expires: now + RECEIPT_TTL_MS }), "utf8").toString("base64url");
  const signature = createHmac("sha256", secret).update(`cap-context-large-part-v1.${payload}`).digest("hex");
  return `${payload}.${signature}`;
}

function verifyParts({ large, parts, telemetry }, secret, now = Date.now()) {
  if (!validSecret(secret)) return false;
  let offset = 0;
  const identity = identityHash(telemetry);
  for (const [index, part] of parts.entries()) {
    const match = /^([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/.exec(part.receipt);
    if (!match) return false;
    const expected = createHmac("sha256", secret).update(`cap-context-large-part-v1.${match[1]}`).digest();
    if (!timingSafeEqual(expected, Buffer.from(match[2], "hex"))) return false;
    let payload;
    try { payload = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")); } catch { return false; }
    if (payload.v !== 1 || payload.flow !== large.transferId || payload.index !== index || payload.total !== large.total
      || payload.totalChars !== large.totalChars || payload.offset !== offset || !integer(payload.chars, 1, MAX_PART_CHARS)
      || payload.summary !== hash(part.summary) || payload.identity !== identity
      || !integer(payload.expires, now + 1, now + RECEIPT_TTL_MS)) return false;
    offset += payload.chars;
  }
  return offset === large.totalChars;
}

module.exports = { MAX_WIRE_BYTES, MAX_PART_CHARS, MAX_SUMMARY_CHARS, RECEIPT_TTL_MS,
  validateRequest, signPart, verifyParts, identityHash, validSecret };
