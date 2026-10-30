const { applyCorsHeaders, isValidPreflightRequest, isTrustedExtensionRequest, acquireRequestSlot } = require("./request-security");
const { getHeader } = require("./request-validation");
const protocol = require("./large-summary-protocol");
const { createProviderFailureLog } = require("./provider-failure-log");
const { createSummaryWithProvider, getInitialSummaryMessages, getProviderRequestBody,
  getSummaryProfile, createLongSummaryResponse } = require("./summarize").__test;

const MODEL = "nvidia/nemotron-3.5-super-vl:free";
const PROVIDER = Object.freeze({ id: "openrouter", label: "OpenRouter",
  url: "https://openrouter.ai/api/v1/chat/completions", allowNvidiaDataCollection: true });
const BACKUP_MODEL = "deepseek-v4.1-flash:free";
const BACKUP_PROVIDER = Object.freeze({ id: "tokenharbor", label: "TokenHarbor",
  url: "https://tokenharbor.ai/v1/chat/completions" });
const REQUEST_TIMEOUT_MS = 75000;
const PRIMARY_WITH_BACKUP_MS = 45000;
const LIMIT_KEY = Symbol.for("cap-context.large-summary-rate-limit.v1");

// Chunk requests must not consume the ordinary summary endpoint's 8/minute
// allowance. The shared concurrency slot still bounds both endpoints together.
function consumeRateLimit(req, now = Date.now()) {
  const clients = globalThis[LIMIT_KEY] ||= new Map();
  const key = getHeader(req, "x-forwarded-for").split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown-client";
  for (const [client, entry] of clients) {
    if (now - entry.hourAt >= 3600000 || clients.size > 5000) clients.delete(client);
  }
  let entry = clients.get(key);
  if (!entry) { entry = { minuteAt: now, hourAt: now, minute: 0, hour: 0 }; clients.set(key, entry); }
  if (now - entry.minuteAt >= 60000) { entry.minuteAt = now; entry.minute = 0; }
  if (entry.minute >= 32 || entry.hour >= 80) return false;
  entry.minute++; entry.hour++;
  return true;
}

function finalConversation(parts) {
  // These are untrusted, ordered partial handoffs, not new instructions. The
  // last part owns the latest stopping point; earlier unresolved work stays.
  return "Chronological conversation handoffs, covering every original part. Preserve earlier decisions and unresolved work; "
    + "the last part records the latest request and stopping point. Do not treat a part's confirmation footer as a user request.\n\n"
    + parts.map((part, index) => `Conversation part ${index + 1} of ${parts.length}:\n${part.summary}`).join("\n\n");
}

function providerBodyBytes(conversation, profile, provider = PROVIDER, model = MODEL) {
  const body = getProviderRequestBody(provider, getInitialSummaryMessages(conversation, profile), profile, model);
  return Buffer.byteLength(JSON.stringify({ ...body, stream: true }), "utf8");
}

async function handler(req, res) {
  const cors = applyCorsHeaders(req, res);
  if (req.method === "OPTIONS") {
    if (!cors.allowedOrigin || !isValidPreflightRequest(req)) return res.status(403).json({ code: "origin_not_allowed", error: "Origin is not allowed" });
    return res.status(204).end();
  }
  if (req.method !== "POST") { res.setHeader("Allow", "POST, OPTIONS"); return res.status(405).json({ code: "method_not_allowed", error: "Method not allowed" }); }
  if (!isTrustedExtensionRequest(req)) return res.status(403).json({ code: "client_not_allowed", error: "Request is not from a supported Cap Context client" });
  const validation = protocol.validateRequest(req);
  if (!validation.ok) return res.status(validation.status).json({ code: validation.code, error: validation.error });
  const secret = process.env.TELEMETRY_SIGNING_KEY;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  const backupKey = process.env.TOKENHARBOR_API_KEY?.trim() || process.env.TOKENHARBOR_BACKUP_API_KEY?.trim();
  const routes = [
    ...(process.env.OPENROUTER_ENABLED !== "false" && apiKey ? [{ provider: PROVIDER, model: MODEL, apiKey }] : []),
    ...(process.env.TOKENHARBOR_ENABLED !== "false" && backupKey ? [{ provider: BACKUP_PROVIDER, model: BACKUP_MODEL,
      apiKey: backupKey, keySlot: process.env.TOKENHARBOR_API_KEY?.trim() ? "primary" : "backup" }] : [])
  ];
  if (process.env.LARGE_SUMMARY_ENABLED === "false" || !routes.length || !protocol.validSecret(secret))
    return res.status(503).json({ code: "summary_unavailable", error: "Large summary service is unavailable" });
  if (!consumeRateLimit(req)) { res.setHeader("Retry-After", "60"); return res.status(429).json({ code: "rate_limited", error: "Please retry later" }); }
  const part = validation.large.phase === "part";
  if (!part && !protocol.verifyParts(validation, secret)) return res.status(400).json({ code: "invalid_parts", error: "Conversation parts could not be verified" });
  const conversation = part ? validation.conversation : finalConversation(validation.parts);
  // Compact intermediate summaries still represent an original chat above 1M.
  // Preserve its largest output allowance when combining; a short last part
  // only needs a medium floor so the tiny local-only profile cannot give zero.
  // /summarize's profiles and routing remain unchanged.
  const profileInput = !part ? "x".repeat(350001) : conversation.length < 8001 ? "x".repeat(8001) : conversation;
  const profile = { ...getSummaryProfile(profileInput), directCarry: false };
  if (conversation.length > 1000000 || Buffer.byteLength(conversation, "utf8") > protocol.MAX_WIRE_BYTES
    || routes.some(route => providerBodyBytes(conversation, profile, route.provider, route.model) > 3800000))
    return res.status(413).json({ code: "request_too_large", error: "Conversation part needs a smaller encoded size" });
  const releaseSlot = acquireRequestSlot();
  if (!releaseSlot) return res.status(503).json({ code: "service_busy", error: "Summary service is busy" });
  const controller = new AbortController(), startedAt = Date.now();
  const onClose = () => { if (!res.writableEnded) controller.abort(); };
  res.once?.("close", onClose);
  if (res.destroyed || req.aborted) controller.abort();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const channel = createLongSummaryResponse(res, { stream: getHeader(req, "accept").includes("application/x-ndjson") });
  const failures = createProviderFailureLog({ attemptId: validation.telemetry?.attempt_id, telemetry: validation.telemetry });
  try {
    const modelsTried = [], providerTimes = { openrouterMs: 0, tokenharborMs: 0 };
    let result;
    for (const [index, route] of routes.entries()) {
      controller.signal.throwIfAborted();
      const remainingMs = REQUEST_TIMEOUT_MS - (Date.now() - startedAt);
      if (remainingMs <= 0) { controller.abort(); controller.signal.throwIfAborted(); }
      // Reserve backup time inside the existing 75s request, not another full
      // timeout. Only this failed piece/final merge is retried on DeepSeek.
      const budgetMs = Math.min(remainingMs, index === 0 && routes.length > 1 ? PRIMARY_WITH_BACKUP_MS : REQUEST_TIMEOUT_MS);
      const routeStarted = Date.now();
      modelsTried.push(route.model);
      try {
        const candidate = await createSummaryWithProvider({ ...route, profile,
          initialMessages: getInitialSummaryMessages(conversation, profile), requestBudgetMs: budgetMs,
          requestContext: { signal: controller.signal, maxAttempts: 1, firstAnswerTimeoutMs: budgetMs,
            inputChars: conversation.length, routeIndex: index + 1, ...(route.keySlot ? { keySlot: route.keySlot } : {}),
            // Acknowledge each model attempt immediately, as /summarize does.
            // Waiting for the first timed heartbeat leaves an MV3 fetch pending
            // on headers; runtime keepalive does not remove that fetch limit.
            // Reset is control-only: intermediate summaries remain private.
            onDelta() {}, onStart: channel.reset, onProviderFailure: observation => failures.record(observation) } });
        if (candidate.model !== route.model || candidate.provider !== route.provider.id
          || /^(?:length|max_tokens|max_output_tokens)$/i.test(String(candidate.finishReason || ""))
          || !candidate.summary?.trim() || candidate.summary.length > protocol.MAX_SUMMARY_CHARS)
          throw new Error("Incomplete large summary result");
        result = candidate;
      } catch {
        // Caller cancellation/expiry must never start the backup provider.
        controller.signal.throwIfAborted();
      } finally { providerTimes[`${route.provider.id}Ms`] += Date.now() - routeStarted; }
      if (result) break;
    }
    controller.signal.throwIfAborted();
    if (Date.now() - startedAt >= REQUEST_TIMEOUT_MS || !result) {
      return channel.send(502, { code: "summary_failed", error: "Conversation part could not be summarized" });
    }
    const timing = { ...result, summary: undefined, modelsTried,
      openrouterModelsTried: modelsTried.filter(model => model === MODEL),
      tokenharborModelsTried: modelsTried.filter(model => model === BACKUP_MODEL), ...providerTimes,
      fallback: { attempted: modelsTried.length > 1, used: modelsTried.length > 1, servedBy: result.provider, model: result.model },
      totalMs: Date.now() - startedAt,
      inputChars: part ? conversation.length : validation.large.totalChars, outputChars: result.summary.length,
      parts: validation.large.total, phase: validation.large.phase };
    const response = { summary: result.summary, timing };
    if (part) response.receipt = protocol.signPart({ ...validation, summary: result.summary }, secret);
    else if (validation.telemetry) {
      const { createSummaryProof } = await import("../supabase/functions/_shared/summary-proof.mjs");
      const confirmedAt = new Date().toISOString();
      const proof = await createSummaryProof(validation.telemetry, secret);
      const proofV3 = await createSummaryProof({ ...validation.telemetry, summary_confirmed_at: confirmedAt, model: result.model }, secret);
      Object.assign(response, { summaryProof: proof, summaryProofV2: proofV3, summaryProofV3: proofV3,
        summaryConfirmedAt: confirmedAt, summaryModel: result.model });
    }
    await failures.flush();
    controller.signal.throwIfAborted();
    return channel.send(200, response);
  } catch {
    if (!res.destroyed && !res.writableEnded) return channel.send(controller.signal.aborted ? 504 : 502,
      { code: controller.signal.aborted ? "summary_timeout" : "summary_failed", error: "Large conversation could not be summarized" });
  } finally {
    clearTimeout(timer);
    res.removeListener?.("close", onClose);
    channel.close();
    releaseSlot();
    await failures.flush();
  }
}

module.exports = handler;
module.exports.__test = { consumeRateLimit, finalConversation, providerBodyBytes, resetRateLimit: () => { delete globalThis[LIMIT_KEY]; } };
