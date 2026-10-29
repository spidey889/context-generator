// Separate orchestration for verified transcripts above the ordinary 1M path.
// Text/part receipts live only for this attempt; none enter persistent telemetry.
(function (root) {
  const encoder = new TextEncoder();
  // Super VL completed the 500k synthetic case; larger pieces leave less time
  // for completion on the free endpoint. The server retains its hard 750k cap.
  const MAX_CHARS = 4000000, MAX_BYTES = 16000000, PART_CHARS = 500000, MAX_PARTS = 16;
  const failure = code => Object.assign(new Error("Large-chat summarization could not finish. The full conversation is available to copy."),
    { code, diagnosticCode: code });
  const wireBytes = value => encoder.encode(JSON.stringify(value)).length;

  function split(conversation) {
    if (typeof conversation !== "string" || conversation.length <= 1000000 || conversation.length > MAX_CHARS
        || encoder.encode(conversation).length > MAX_BYTES) throw failure("conversation_too_large");
    const parts = [];
    for (let offset = 0; offset < conversation.length;) {
      let end = Math.min(conversation.length, offset + PART_CHARS);
      for (;;) {
        // Do not cut a surrogate pair or CRLF between requests. Every original
        // code unit appears once; never trim or silently drop a difficult part.
        if (end < conversation.length && /[\uD800-\uDBFF]/.test(conversation[end - 1])
            && /[\uDC00-\uDFFF]/.test(conversation[end])) end--;
        if (end < conversation.length && conversation[end - 1] === "\r" && conversation[end] === "\n") end--;
        const text = conversation.slice(offset, end);
        // The provider wraps a JSON transcript in another JSON request. Count
        // both layers, leaving room for the prompt, metadata and receipt rules.
        if (wireBytes({ conversation: text }) <= 2700000
            && wireBytes(JSON.stringify({ conversation: text })) <= 3500000) break;
        end = offset + Math.floor((end - offset) / 2);
        if (end <= offset) throw failure("request_too_large");
      }
      parts.push({ offset, conversation: conversation.slice(offset, end) });
      if (parts.length > MAX_PARTS) throw failure("request_too_large");
      offset = end;
    }
    return parts;
  }

  async function summarize({ conversation, transferId, post, signal, deadlineAt = Infinity, onProgress = () => {} }) {
    const parts = split(conversation);
    const controller = new AbortController();
    const cancelled = () => controller.abort(signal.reason);
    signal?.addEventListener("abort", cancelled, { once: true });
    if (signal?.aborted) cancelled();
    // Leave the existing transfer enough room for final delivery/manual recovery.
    const expiresAt = Math.min(Date.now() + 240000, deadlineAt - 65000);
    const timer = setTimeout(() => controller.abort(failure("summary_timeout")), Math.max(0, expiresAt - Date.now()));
    const partDeadline = Math.min(expiresAt - 80000, Date.now() + 160000);
    const check = () => {
      controller.signal.throwIfAborted();
      if (Date.now() >= expiresAt) throw failure("summary_timeout");
    };
    const notify = (completed, phase) => { try { onProgress({ completed, total: parts.length, phase }); } catch {} };
    const results = Array(parts.length);
    let cursor = 0, completed = 0, firstFailure;
    const worker = async () => {
      try {
        while (cursor < parts.length) {
          check();
          const index = cursor++, part = parts[index];
          if (Date.now() >= partDeadline) throw failure("summary_timeout");
          const result = await post({ conversation: part.conversation, large: { version: 1, phase: "part", transferId,
            index, total: parts.length, totalChars: conversation.length, offset: part.offset } },
          { signal: controller.signal, deadlineAt: partDeadline });
          check();
          if (typeof result?.summary !== "string" || !result.summary.trim() || result.summary.length > 60000
              || typeof result.receipt !== "string" || !result.receipt || result.receipt.length > 4000)
            throw failure("summary_invalid_response");
          results[index] = { summary: result.summary, receipt: result.receipt };
          notify(++completed, "parts");
        }
      } catch (error) {
        firstFailure ||= error;
        controller.abort(error); // Stop sibling requests before falling back.
      }
    };
    try {
      check();
      notify(0, "parts");
      await Promise.all(Array.from({ length: Math.min(3, parts.length) }, worker));
      if (firstFailure) throw firstFailure;
      check();
      notify(parts.length, "final");
      // The server verifies the complete ordered receipt chain before combining
      // the summaries. Only that final response can authenticate summary work.
      const result = await post({ large: { version: 1, phase: "final", transferId, total: parts.length,
        totalChars: conversation.length }, parts: results }, { signal: controller.signal, deadlineAt: expiresAt });
      check();
      if (typeof result?.summary !== "string" || !result.summary.trim() || result.summary.length > 60000)
        throw failure("summary_invalid_response");
      return { ...result, partCount: parts.length };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancelled);
    }
  }

  const api = { split, summarize, MAX_CHARS, MAX_BYTES };
  root.CapLargeTransfer = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
