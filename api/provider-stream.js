// Fold provider SSE into the existing result shape. Only completed results may
// pass summary validation; deltas are previews and reset on every retry/route.
async function readProviderStream(response, provider, { onDelta, checkDeadline }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "", dataLines = [], text = "", finishReason = null;
  let usage, error, done = false, eof = false;
  const dispatch = () => {
    if (!dataLines.length) return;
    const raw = dataLines.join("\n");
    dataLines = [];
    if (raw === "[DONE]") { done = true; return; }
    const chunk = JSON.parse(raw);
    const choice = provider === "gemini"
      ? chunk.candidates?.find(item => (item.index ?? 0) === 0)
      : chunk.choices?.find(item => (item.index ?? 0) === 0);
    error = chunk.error || choice?.error;
    if (error) { done = true; return; }
    const delta = provider === "gemini"
      ? (choice?.content?.parts || []).filter(part => part.thought !== true)
        .map(part => typeof part.text === "string" ? part.text : "").join("")
      : choice?.delta?.content;
    if (typeof delta === "string" && delta) { text += delta; onDelta(delta); }
    finishReason = (provider === "gemini" ? choice?.finishReason : choice?.finish_reason) || finishReason;
    usage = (provider === "gemini" ? chunk.usageMetadata : chunk.usage) || usage;
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
      if (chunk.done) { eof = true; buffer += decoder.decode(); consume(); break; }
      buffer += decoder.decode(chunk.value, { stream: true });
      consume();
    }
    if (!error && (!finishReason || (provider !== "gemini" && !done)
        || (eof && (buffer.trim() || dataLines.length)))) {
      throw new SyntaxError("Provider stream ended before completion");
    }
    return provider === "gemini"
      ? { candidates: [{ content: { parts: [{ text }] }, finishReason }], usageMetadata: usage, ...(error ? { error } : {}) }
      : { choices: [{ message: { content: text }, finish_reason: finishReason }], usage, ...(error ? { error } : {}) };
  } finally {
    if (!eof) { try { reader.cancel().catch(() => {}); } catch {} }
    reader.releaseLock();
  }
}

module.exports = { readProviderStream };
