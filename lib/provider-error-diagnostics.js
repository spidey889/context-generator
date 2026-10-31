// Keep imported helpers outside api/: Vercel counts each API file as a function.
const { schema } = require("../supabase/functions/_shared/provider-failure");

function safeProviderError(error) {
  const result = {};
  if (!error || typeof error !== "object") return result;
  for (const [field, value] of [["upstream_code", error.code ?? error.status], ["upstream_type", error.type ?? error.status]]) {
    if (schema[field].values.includes(String(value))) result[field] = String(value);
  }
  // Providers may echo prompts, filenames or keys. Never persist an excerpt,
  // even a capped one: translate only recognized error categories to fixed text.
  const category = `${result.upstream_code || ""} ${result.upstream_type || ""}`.toLowerCase();
  const message = typeof error.message === "string" ? error.message.slice(0, 512) : "";
  const rules = [
    [/429|rate_limit|resource_exhausted/, /^(?:rate limit|too many requests)\b/i, "Rate limit exceeded."],
    [/insufficient_quota/, /^(?:quota exceeded|quota exhausted)\b/i, "Quota exhausted."],
    [/401|unauthenticated|invalid_api_key|authentication_error/, /^(?:invalid api key|authentication failed)\b/i, "Authentication failed."],
    [/402|insufficient_credits/, /^(?:insufficient credits|insufficient balance)\b/i, "Insufficient credits."],
    [/content_filter|safety/, /^(?:content filtered|blocked by safety)\b/i, "Request blocked by safety policy."],
    [/context_length_exceeded/, /^(?:context length exceeded|maximum context length)\b/i, "Context length exceeded."],
    [/503|529|unavailable|overloaded|server_error/, /^(?:service unavailable|model overloaded)\b/i, "Provider unavailable."]
  ];
  result.upstream_message = (rules.find(([code, wording]) => code.test(category) || wording.test(message))?.[2]
    || "Provider returned an error.").slice(0, 120);
  return result;
}

function retryAfterMs(headers, now = Date.now()) {
  const value = headers?.get?.("retry-after");
  if (typeof value !== "string" || value.length > 128) return undefined;
  const ms = /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.min(86400000, Math.ceil(ms))) : undefined;
}

async function readSafeProviderError(response, budgetMs = 150) {
  let reader, timer;
  const read = async () => {
    if (!response.body?.getReader) return response.json ? await response.json() : null;
    reader = response.body.getReader();
    const chunks = []; let bytes = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 8192) return null;
      chunks.push(chunk.value);
    }
    const body = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  };
  try {
    if (budgetMs <= 0) return {};
    const payload = await Promise.race([read(), new Promise(resolve => { timer = setTimeout(() => resolve(null), budgetMs); })]);
    return safeProviderError(payload?.error || payload);
  } catch { return {}; }
  finally {
    clearTimeout(timer);
    // Do not await stalled network cleanup or retain the response content.
    try { (reader ? reader.cancel() : response.body?.cancel?.())?.catch?.(() => {}); } catch {}
    try { reader?.releaseLock(); } catch {}
  }
}
function providerRequestId(headers) {
  for (const name of ["x-request-id", "request-id", "x-goog-request-id", "x-google-request-id"]) {
    const value = headers?.get?.(name);
    if (typeof value === "string" && new RegExp(schema.upstream_request_id.pattern).exec(value)?.[0] === value) return value;
  }
}

function embeddedProviderError(payload, provider) {
  if (payload?.error) return payload.error;
  const choices = provider === "gemini" ? payload?.candidates : payload?.choices;
  const choice = Array.isArray(choices) ? choices.find(item => item && (item.index ?? 0) === 0) : null;
  if (choice?.error) return choice.error;
  if (provider === "gemini" && (payload?.promptFeedback?.blockReason
    || ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"].includes(choice?.finishReason))) return { type: "safety" };
  if (choice?.finish_reason === "content_filter") return { type: "content_filter" };
  if (choice?.finish_reason === "error") return { type: "generation_error" };
  return null;
}
function providerParseError(detail) {
  return Object.assign(new SyntaxError("Provider response could not be decoded completely"), { providerFailureDetail: detail });
}
module.exports = { safeProviderError, retryAfterMs, readSafeProviderError, providerRequestId, embeddedProviderError, providerParseError };
