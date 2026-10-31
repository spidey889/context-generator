// Fold provider SSE into the existing result shape. Only completed results may
// pass summary validation; deltas are previews and reset on every retry/route.
const { embeddedProviderError, providerParseError } = require("./provider-error-diagnostics");
async function readProviderStream(response, provider, { onDelta, checkDeadline, onAnswerStart, onProgress }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const filterAnswer = ["openrouter", "tokenharbor"].includes(provider) ? createThinkingFilter() : delta => delta;
  let buffer = "", dataLines = [], text = "", finishReason = null;
  let usage, error, done = false, eof = false, answerStarted = false, answerChars = 0;
  const decode = (bytes, options) => {
    try { return decoder.decode(bytes, options); } catch { throw providerParseError("utf8_decode_failed"); }
  };
  const dispatch = () => {
    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    dataLines = [];
    if (raw === "[DONE]") { done = true; return; }
    let chunk;
    try { chunk = JSON.parse(raw); } catch { throw providerParseError("stream_event_json_invalid"); }
    if (!chunk || typeof chunk !== "object" || Array.isArray(chunk)) throw providerParseError("stream_event_shape_invalid");
    const choices = provider === "gemini" ? chunk.candidates : chunk.choices;
    if (choices !== undefined && (!Array.isArray(choices) || choices.some(item => !item || typeof item !== "object")))
      throw providerParseError("stream_event_shape_invalid");
    const choice = choices?.find(item => (item.index ?? 0) === 0);
    error = embeddedProviderError(chunk, provider);
    if (error) { done = true; return; }
    let delta = provider === "gemini"
      ? (choice?.content?.parts || []).filter(part => part.thought !== true)
        .map(part => typeof part.text === "string" ? part.text : "").join("")
      : choice?.delta?.content;
    if (provider === "mistral" && Array.isArray(delta)) {
      // Mistral may mix strings and typed blocks; only text blocks are answers.
      delta = delta.filter(part => part?.type === "text" && typeof part.text === "string")
        .map(part => part.text).join("");
    }
    if (typeof delta === "string" && delta) {
      text += delta;
      delta = filterAnswer(delta);
      answerChars += delta.length;
      if (!answerStarted && /\S/.test(delta)) {
        onAnswerStart?.();
        answerStarted = true;
      }
      if (delta) onDelta(delta);
    }
    finishReason = (provider === "gemini" ? choice?.finishReason : choice?.finish_reason) || finishReason;
    usage = (provider === "gemini" ? chunk.usageMetadata : chunk.usage) || usage;
    // Keep observations even when the stream stalls before its final frame.
    // Only counts leave the parser; private thinking remains inside the stream.
    const reasoning = choice?.delta?.reasoning_content ?? choice?.delta?.reasoning;
    onProgress?.({ answerChars, finishReason,
      ...(typeof reasoning === "string" ? { reasoningChars: reasoning.length } : {}),
      promptTokens: provider === "gemini" ? usage?.promptTokenCount : usage?.prompt_tokens,
      completionTokens: provider === "gemini" ? usage?.candidatesTokenCount : usage?.completion_tokens,
      reasoningTokens: provider === "gemini" ? usage?.thoughtsTokenCount : usage?.completion_tokens_details?.reasoning_tokens });
  };
  const consume = () => {
    let newline;
    // Defer a trailing CR until the next chunk so split CRLF is one newline.
    while (!done && (newline = (eof ? /\r\n|\n|\r/ : /\r\n|\n|\r(?!$)/).exec(buffer))) {
      const line = buffer.slice(0, newline.index);
      buffer = buffer.slice(newline.index + newline[0].length);
      if (!line) dispatch();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
      // SSE comments, event names and IDs carry no summary text.
    }
  };
  try {
    while (!done) {
      checkDeadline();
      const chunk = await reader.read();
      checkDeadline();
      if (chunk.done) { eof = true; buffer += decode(); consume(); break; }
      buffer += decode(chunk.value, { stream: true });
      consume();
    }
    if (!error && (!finishReason || (provider !== "gemini" && !done)
        || (eof && (buffer.trim() || dataLines.length)))) {
      throw providerParseError("stream_incomplete");
    }
    return provider === "gemini"
      ? { candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: usage, ...(error ? { error } : {}) }
      : { choices: [{ message: { content: text }, finish_reason: finishReason }], usage, ...(error ? { error } : {}) };
  } finally {
    if (!eof) { try { reader.cancel().catch(() => {}); } catch {} }
    reader.releaseLock();
  }
}

function createThinkingFilter() {
  let pending = "", thinking = false;
  return delta => {
    pending += delta;
    let answer = "";
    while (pending) {
      const tag = thinking ? "</think>" : "<think>";
      const index = pending.toLowerCase().indexOf(tag);
      if (index !== -1) {
        if (!thinking) answer += pending.slice(0, index);
        pending = pending.slice(index + tag.length);
        thinking = !thinking;
        continue;
      }
      // Keep only a possible split tag. Hidden headings must never reach the
      // worker's near-completion hint or disarm the first-answer watchdog.
      let keep = Math.min(tag.length - 1, pending.length);
      while (keep && !tag.startsWith(pending.slice(-keep).toLowerCase())) keep--;
      if (!thinking) answer += pending.slice(0, pending.length - keep);
      pending = keep ? pending.slice(-keep) : "";
      break;
    }
    return answer;
  };
}

module.exports = { readProviderStream };
