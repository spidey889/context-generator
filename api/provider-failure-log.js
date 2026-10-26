const { randomUUID } = require("node:crypto");
const { validate } = require("../supabase/functions/_shared/provider-failure");

// Start writes immediately, overlap them with fallback work, then await them
// before ending the response. Detached promises can be lost in serverless runs.
function createProviderFailureLog({ attemptId, telemetry, fetchImpl = (...args) => fetch(...args), timeoutMs = 5000,
  warn = (...args) => console.warn(...args) } = {}) {
  const url = process.env.SUPABASE_TELEMETRY_FUNCTION_URL;
  const key = process.env.SUPABASE_TELEMETRY_PUBLISHABLE_KEY;
  const secret = process.env.TELEMETRY_RELAY_SECRET;
  const configured = url && key && secret && Buffer.byteLength(secret, "utf8") >= 32;
  const requestId = randomUUID(), pending = [];
  let configurationReported = false;
  let capacityReported = false;
  const report = reason => warn("cap_context_provider_failure_log", { reason, request_id: requestId });
  async function deliver(event) {
    const controller = new AbortController();
    const deadline = Date.now() + timeoutMs;
    let timer;
    const operation = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) break;
        const attemptController = new AbortController();
        let attemptTimer;
        try {
          const response = await Promise.race([fetchImpl(url, { method: "POST", redirect: "error",
            signal: AbortSignal.any([controller.signal, attemptController.signal]),
            headers: { "Content-Type": "application/json", apikey: key, "X-Cap-Context-Relay": secret },
            body: JSON.stringify({ kind: "provider_failure", event, ...(telemetry ? { context: telemetry } : {}) }) }), new Promise((_, reject) => {
            attemptTimer = setTimeout(() => { attemptController.abort(); reject(new Error("attempt_timeout")); },
              attempt === 0 ? Math.min(2000, Math.ceil(timeoutMs / 2), remainingMs) : remainingMs);
          })]);
          // Status is sufficient. Never parse/log a database body, and never
          // let a stalled error-body cancellation delay summary delivery.
          try { response.body?.cancel?.()?.catch?.(() => {}); } catch {}
          if (response.status === 204) return;
          if (!response.ok && response.status !== 429 && response.status < 500) break;
        } catch { if (controller.signal.aborted) break; }
        finally { clearTimeout(attemptTimer); }
      }
      throw new Error("delivery_failed");
    })();
    try {
      await Promise.race([operation, new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("delivery_timeout")); }, timeoutMs);
      })]);
    } catch { report("delivery_unavailable"); }
    finally { clearTimeout(timer); }
  }
  return {
    record(observation) {
      // A diagnosis belongs to a real transfer. Never invent a transfer/user
      // for older callers that supplied no transfer identity.
      if (!attemptId) {
        if (!configurationReported) { report("missing_transfer_context"); configurationReported = true; }
        return;
      }
      if (!configured) {
        if (!configurationReported) { report("not_configured"); configurationReported = true; }
        return;
      }
      if (pending.length >= 16) {
        if (!capacityReported) { report("capacity_reached"); capacityReported = true; }
        return;
      }
      const event = validate({ ...observation, id: randomUUID(), request_id: requestId,
        environment: ["production", "preview", "development"].includes(process.env.VERCEL_ENV) ? process.env.VERCEL_ENV : "development",
        ...(attemptId ? { attempt_id: attemptId } : {}), occurred_at: new Date().toISOString() });
      if (!event) { report("invalid_observation"); return; }
      pending.push(deliver(event));
    },
    async flush() { await Promise.allSettled(pending); }
  };
}

module.exports = { createProviderFailureLog };
