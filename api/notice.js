const { applyCorsHeaders, isValidPreflightRequest, isTrustedExtensionRequest } = require("./request-security");
const { parseBoundedJsonBody } = require("./request-validation");
const NOTICE_ID = "transfer-apology-20260918";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

module.exports = async (req, res) => {
  const cors = applyCorsHeaders(req, res);
  if (req.method === "OPTIONS") return res.status(cors.allowedOrigin && isValidPreflightRequest(req) ? 204 : 403).end();
  if (req.method !== "POST") return res.status(405).end();
  if (!isTrustedExtensionRequest(req)) return res.status(403).end();
  const parsed = parseBoundedJsonBody(req, 1024, "Notice request");
  const body = parsed.body;
  if (!parsed.ok || !body || !UUID.test(body.install_id || "") || body.notice_id !== NOTICE_ID || !["claim", "displayed", "ok", "timeout"].includes(body.action)) return res.status(400).end();
  // The recipient is private production configuration, never a public list of install IDs.
  if (body.install_id !== process.env.CAP_NOTICE_TARGET_INSTALL_ID) return res.status(200).json({ notice: null });
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return res.status(503).end();
  const key = `cap-context:notice:${NOTICE_ID}:${body.install_id}`;
  const now = new Date().toISOString();
  // Atomic claim prevents duplicate popups in concurrent AI tabs. No expiry: this campaign never repeats.
  const script = body.action === "claim" ? `
    if redis.call('HEXISTS', KEYS[1], 'claimed_at') == 1 then return 0 end
    redis.call('HSET', KEYS[1], 'claimed_at', ARGV[1])
    return 1
  ` : `
    if redis.call('HEXISTS', KEYS[1], 'claimed_at') == 0 then return 0 end
    if ARGV[2] == 'displayed' then
      redis.call('HSETNX', KEYS[1], 'displayed_at', ARGV[1])
    elseif redis.call('HEXISTS', KEYS[1], 'dismissal') == 0 then
      redis.call('HSET', KEYS[1], 'dismissal', ARGV[2], 'dismissed_at', ARGV[1])
    end
    return 1
  `;
  try {
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(["EVAL", script, 1, key, now, body.action]), signal: AbortSignal.timeout(5000) });
    const payload = await response.json();
    if (!response.ok || payload.error || !Object.hasOwn(payload, "result")) throw new Error("notice_store_unavailable");
    return res.status(200).json({ notice: body.action === "claim" && Number(payload.result) === 1 ? { id: NOTICE_ID, title: "Sorry your transfer failed earlier.", message: "We fixed a few things—give it another try when you can ✌️" } : null });
  } catch { return res.status(503).end(); }
};
