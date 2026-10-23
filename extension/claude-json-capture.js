(() => {
  const channel = "cap-context-claude-json-v2";
  const changedError = message => Object.assign(new Error(message), { diagnosticCode: "conversation_changed", diagnostics: { version: 1, capture_detail: "conversation_changed", failure_site: "capture_history" } });
  const captureError = (message, captureFailureReason, detail = "incomplete_history", stage = "serialize", status) => Object.assign(new Error(message), {
    captureFailureReason, diagnosticCode: captureFailureReason === "size_limit" ? "conversation_too_large"
      : detail === "conversation_changed" ? "conversation_changed" : captureFailureReason === "unavailable" ? "capture_json_unavailable" : "capture_json_failed",
    diagnostics: { version: 1, capture_detail: captureFailureReason === "size_limit" ? "size_limit" : detail, capture_request_stage: stage, failure_site: `capture_${stage}`,
      ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { capture_http_status: status } : {}) }
  });
  function serialize(data, chat, metrics, measureOnly = false) {
    metrics?.set({ files_supported: 0, files_ignored: 0, files_declared_bytes: 0, files_downloaded_bytes: 0 });
    // Report structural metadata only, never message text, file names, or tool payloads.
    const unsupported = (reason, detail = "incomplete_history") => captureError(`This conversation has incomplete or unsupported JSON content: ${reason} Turn JSON capture off to use DOM capture.`, "incomplete", detail);
    const excludedContentTypes = new Set();
    const assertComplete = (value, label) => {
      if (value == null) return;
      if (typeof value !== "object" || Array.isArray(value)) throw unsupported(`${label} completeness metadata is invalid.`);
      // Inspect structural metadata only; never search tool payloads or text.
      for (const field of ["truncated", "is_truncated", "partial", "is_partial", "incomplete", "is_incomplete", "has_more", "has_more_messages", "has_previous_page", "has_next_page", "has_missing_messages", "missing_message_count", "cut_off"]) {
        if (value[field] != null && value[field] !== false && value[field] !== 0) throw unsupported(`${label}.${field} indicates incomplete content.`);
      }
      for (const field of ["complete", "is_complete"]) {
        if (value[field] != null && value[field] !== true) throw unsupported(`${label}.${field} does not confirm complete content.`);
      }
      for (const field of ["next_cursor", "previous_cursor", "next_page", "previous_page"]) {
        if (value[field] != null && value[field] !== "" && value[field] !== false) throw unsupported(`${label}.${field} indicates another history page.`);
      }
      for (const field of ["missing_messages", "missing_message_ids", "missing_message_uuids"]) {
        if (value[field] != null && value[field] !== false && value[field] !== 0 && !(Array.isArray(value[field]) && value[field].length === 0)) throw unsupported(`${label}.${field} indicates missing history.`);
      }
    };
    if (data?.uuid !== chat) throw unsupported("The response belongs to a different conversation.");
    if (!Array.isArray(data.chat_messages)) throw unsupported("The chat_messages array is missing or invalid.");
    for (const [value, label] of [[data, "conversation"], [data.page_info, "page_info"], [data.pagination, "pagination"]]) {
      assertComplete(value, label);
      for (const field of ["total_messages", "total_message_count"]) {
        if (value?.[field] != null && (!Number.isSafeInteger(value[field]) || value[field] < 0 || value[field] > data.chat_messages.length)) throw unsupported(`${label}.${field} indicates missing history or an invalid message count.`, "count_mismatch");
      }
    }
    if (typeof data.current_leaf_message_uuid !== "string" || !data.current_leaf_message_uuid) throw unsupported("The active branch's last-message ID is missing or invalid.", "invalid_branch");
    // The native leaf selects the displayed answer, not array order. Broken
    // unused replies cannot invalidate that path; ambiguous IDs on it still fail.
    const messages = new Map();
    const duplicateIds = new Set();
    for (const message of data.chat_messages) {
      if (typeof message?.uuid !== "string" || !message.uuid) continue;
      if (messages.has(message.uuid)) duplicateIds.add(message.uuid);
      else messages.set(message.uuid, message);
    }
    const branch = [];
    const seen = new Set();
    let id = data.current_leaf_message_uuid;
    while (id) {
      if (duplicateIds.has(id)) { metrics?.fail("duplicate_id", "serialize"); throw unsupported("The active branch contains duplicate message IDs.", "invalid_branch"); }
      const message = messages.get(id);
      if (!message) throw unsupported(branch.length ? "A parent message is missing from the active branch (possibly an unrecognized root marker)." : "The active branch's last message is missing from the response.");
      if (seen.has(id)) throw unsupported("The active branch's parent links form a cycle.", "branch_cycle");
      if (!Object.hasOwn(message, "parent_message_uuid")) throw unsupported("A message in the active branch has no parent_message_uuid field.", "parent_missing");
      seen.add(id);
      branch.push(message);
      const parent = message.parent_message_uuid;
      // Claude's root parent can be the all-zero UUID rather than null.
      if (parent === null || parent === "00000000-0000-0000-0000-000000000000" || parent === "00000000-0000-4000-8000-000000000000") break;
      if (typeof parent !== "string" || !parent) throw unsupported("The active branch has an invalid parent/root marker.", "invalid_branch");
      id = parent;
    }
    const turns = branch.reverse().flatMap(message => {
      if (!["human", "assistant"].includes(message.sender)) return [];
      const fileMetadata = Array.isArray(message.attachments) && message.attachments.length ? message.attachments
        : Array.isArray(message.files) ? message.files : [];
      for (const file of fileMetadata) {
        if (file?.file_type === "txt" && file.file_name === "") continue;
        metrics?.ignored(file?.file_type === "pdf" || (typeof file?.file_name === "string" && /\.pdf$/i.test(file.file_name)) ? "pdf" : "other",
          typeof file?.file_type === "string" && /^image\//i.test(file.file_type) || typeof file?.file_name === "string" && /\.(png|jpe?g|gif|webp|svg)$/i.test(file.file_name));
      }
      assertComplete(message, "Active-branch message");
      // Generation can continue after this read. Capture the strings available
      // now; missing history and truncated payloads remain separate errors.
      if (message.content != null && !Array.isArray(message.content)) throw unsupported("An active-branch message has invalid structured content.", "invalid_branch");
      const blocks = Array.isArray(message.content) ? message.content : [];
      if ((Array.isArray(message.files) && message.files.length) || (Array.isArray(message.attachments) && message.attachments.some(file => file?.file_type !== "txt" || file.file_name !== ""))) excludedContentTypes.add("uploads");
      if (Array.isArray(message.sync_sources) && message.sync_sources.length) excludedContentTypes.add("other");
      // Only direct turn blocks are eligible. Never recurse into tools, artifacts,
      // files, or sync sources, even when they contain text blocks.
      const parts = blocks.flatMap(block => {
        const value = block?.type === "text" ? block.text
          : block?.type === "thinking" ? (block.thinking ?? block.text) : null;
        if (["text", "thinking"].includes(block?.type) && value == null && message.sender === "assistant"
          && ((Object.hasOwn(message, "stop_reason") && message.stop_reason == null)
            || (Object.hasOwn(block, "stop_timestamp") && block.stop_timestamp == null))) return [];
        if (block?.type && !["text", "thinking"].includes(block.type)) {
          excludedContentTypes.add(["tool_use", "tool_result"].includes(block.type) ? "tools"
            : block.type === "artifact" ? "artifacts" : ["image", "audio", "video"].includes(block.type) ? "media" : "other");
        }
        // Live Claude hides empty thinking with truncated:true. It contributes
        // no captured text; unlike truncation of an actual text/thinking string.
        if (block?.type === "text" || (block?.type === "thinking" && typeof value === "string" && value.trim())) {
          assertComplete(block, `${block.type} block`);
          if (typeof value !== "string") throw unsupported("A text block has no complete text string.", "text_invalid");
        }
        // Trim only to test emptiness; indentation and line endings are source data.
        return typeof value === "string" && value.trim() ? [value] : [];
      });
      // Legacy turn text is an alternative only when structured content is absent.
      if (message.content == null || blocks.length === 0) {
        if (typeof message.text === "string" && message.text.trim()) parts.push(message.text);
      }
      // Claude's pasted cards are unnamed txt attachments, unlike named uploads.
      // Their complete text belongs to the owning user turn, not a separate turn.
      const attachments = message.sender === "human" && Array.isArray(message.attachments) ? message.attachments : [];
      const inlineParts = [...parts];
      const inlineCopies = new Map();
      const pastedBodiesById = new Map();
      for (const attachment of attachments) {
        if (attachment?.file_type !== "txt" || attachment.file_name !== "") continue;
        if (measureOnly && (typeof attachment.extracted_content !== "string" || (attachment.file_size > 0 && !attachment.extracted_content.length))) continue;
        if (!measureOnly) assertComplete(attachment, "Pasted-text attachment");
        if (typeof attachment.extracted_content !== "string" || (attachment.file_size > 0 && attachment.extracted_content.length === 0)) throw unsupported("A pasted-text attachment is missing its complete extracted_content string.", "attachment_failed");
        if (!measureOnly && attachment.file_size != null && (!Number.isSafeInteger(attachment.file_size) || attachment.file_size < 0 || new TextEncoder().encode(attachment.extracted_content).length !== attachment.file_size)) throw unsupported("A pasted-text attachment's extracted_content does not match its file_size; completeness cannot be verified.", "attachment_failed");
        const pastedText = attachment.extracted_content;
        // A repeated ID alone cannot prove a duplicate. Keep differing bodies;
        // only exact repeats of the same ID and original text share one card.
        const id = typeof attachment.id === "string" && attachment.id ? attachment.id : null;
        const seenBodies = id ? pastedBodiesById.get(id) : null;
        if (!pastedText.trim() || seenBodies?.has(pastedText)) continue;
        metrics?.add("files_supported");
        if (Number.isSafeInteger(attachment.file_size)) metrics?.add("files_declared_bytes", attachment.file_size);
        if (id) {
          if (seenBodies) seenBodies.add(pastedText);
          else pastedBodiesById.set(id, new Set([pastedText]));
        }
        const normalizedPaste = pastedText.trim();
        let inlineCopy = null;
        for (const [index, part] of inlineParts.entries()) {
          // Match the same complete paragraph as before without trimming the
          // serialized block. Translate matches back to its original offsets.
          const matchText = part.trim();
          const offset = part.indexOf(matchText);
          for (let start = matchText.indexOf(normalizedPaste); start >= 0; start = matchText.indexOf(normalizedPaste, start + 1)) {
            const end = start + normalizedPaste.length;
            const originalStart = start === 0 ? 0 : offset + start;
            const originalEnd = end === matchText.length ? part.length : offset + end;
            // Recognize LF/CRLF blank lines without rewriting source offsets.
            if ((start === 0 || /(?:\r?\n){2}$/.test(matchText.slice(0, start)))
              && (end === matchText.length || /^(?:\r?\n){2}/.test(matchText.slice(end)))
              && !(inlineCopies.get(index) || []).some(copy => originalStart < copy.end && originalEnd > copy.start)) {
              inlineCopy = { index, start: originalStart, end: originalEnd, text: pastedText };
              break;
            }
          }
          if (inlineCopy) break;
        }
        if (!inlineCopy) parts.push(pastedText);
        else {
          if (!inlineCopies.has(inlineCopy.index)) inlineCopies.set(inlineCopy.index, []);
          inlineCopies.get(inlineCopy.index).push(inlineCopy);
        }
      }
      // Restore original card whitespace without shifting offsets of another
      // inline card. Each original range can represent only one attachment.
      for (const [index, copies] of inlineCopies) {
        for (const copy of copies.sort((a, b) => b.start - a.start)) {
          parts[index] = parts[index].slice(0, copy.start) + copy.text + parts[index].slice(copy.end);
        }
      }
      // File labels belong to the owning user turn, not diagnostics or file bodies.
      // Quote names so embedded newlines cannot masquerade as transcript roles.
      if (message.sender === "human") {
        for (const file of [...attachments, ...(Array.isArray(message.files) ? message.files : [])]) {
          if (typeof file?.file_name === "string" && file.file_name.trim()) parts.push(`Attachment: ${JSON.stringify(file.file_name)}`);
        }
      }
      if (!parts.length) return [];
      return [{ role: message.sender === "human" ? "user" : "assistant", text: parts.join("\n\n") }];
    });
    if (!turns.length) throw captureError("Claude JSON capture found no usable user or assistant text after skipping tools, files, images, and artifacts. Turn JSON capture off to use DOM capture.", "incomplete");
    const text = `Claude conversation:\n\n${turns.map(turn => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`).join("\n\n")}`;
    metrics?.set({ selected_turns: turns.length });
    if (metrics ? !metrics.transcript(text) : text.length > 1000000 || new TextEncoder().encode(text).length > 4000000) {
      throw captureError("Conversation exceeds the supported 1,000,000 character / 4 MB limit.", "size_limit", "size_limit");
    }
    return { text, messages: turns, messageTurnCount: turns.length, excludedContentTypes: [...excludedContentTypes].sort() };
  }

  function waitForHook(timeoutMs, install = false, signal) {
    return new Promise(resolve => {
      if (signal?.aborted) return resolve(false);
      const id = crypto.randomUUID();
      let pollTimer;
      let settled = false;
      const finish = ready => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(pollTimer);
        window.removeEventListener("message", receive); signal?.removeEventListener("abort", onAbort);
        resolve(ready);
      };
      const onAbort = () => finish(false);
      const receive = event => {
        const reply = event.data;
        if (event.source === window && event.origin === location.origin && reply?.channel === channel
          && reply.type === "pong" && reply.id === id && reply.version === 15) finish(true);
      };
      const ping = () => {
        if (settled) return;
        window.postMessage({ channel, type: "ping", id }, location.origin);
        pollTimer = setTimeout(ping, 100);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });
      window.addEventListener("message", receive);
      ping();
      if (install) {
        // A cold worker can lag behind a working hook. A correlated versioned
        // pong proves readiness independently of the installation callback.
        Promise.resolve().then(() => chrome.runtime.sendMessage({ type: "ENSURE_CLAUDE_JSON_HOOK" }))
          .then(reply => { if (!reply?.ok) finish(false); }, () => finish(false));
      }
    });
  }

  window.__capCaptureClaudeJson = async (expectedPath = location.pathname, metrics, measureOnly = false, signal) => {
    const hookStarted = Date.now();
    const chat = expectedPath.match(/^\/chat\/([^/]+)$/)?.[1];
    if (!chat) throw new Error("Open a saved Claude conversation to use JSON capture.");
    let changed = location.pathname !== expectedPath;
    const navigated = event => {
      const destination = event?.destination ? new URL(event.destination.url) : location;
      if (destination.origin !== location.origin || destination.pathname !== expectedPath) changed = true;
    };
    // Cover setup and response delivery too, including navigation away and back.
    window.navigation?.addEventListener("navigate", navigated);
    window.addEventListener("popstate", navigated);
    try {
      if (changed) throw changedError("The Claude conversation changed during capture.");
      if (!await waitForHook(250, false, signal)) {
        if (signal?.aborted) throw new Error("Size check cancelled.");
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage || !await waitForHook(8000, true, signal)) {
          throw captureError("Claude JSON hook is not ready. Refresh this chat and try again, or turn JSON capture off.", "unavailable", "hook_unavailable", "hook");
        }
      }
      if (signal?.aborted) throw new Error("Size check cancelled.");
      metrics.set({ hook_ms: Date.now() - hookStarted, adapter_version: 13 });
      if (changed || location.pathname !== expectedPath) throw changedError("The Claude conversation changed during capture.");
      return await new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        // Await the native cancellation reply before releasing the shared read
        // queue; rejecting immediately could race a still-active old download.
        const onAbort = () => window.postMessage({ channel, type: "cancel_measurement", id }, location.origin);
        const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); signal?.removeEventListener("abort", onAbort); };
        const receive = event => {
          const reply = event.data;
          if (event.source !== window || event.origin !== location.origin || reply?.channel !== channel || reply.type !== "response" || reply.id !== id) return;
          cleanup();
          if (signal?.aborted) return reject(new Error("Size check cancelled."));
          metrics.adopt(reply.jsonCapture);
          try {
            if (changed || location.pathname !== expectedPath || reply.chat !== chat) throw changedError("The Claude conversation changed during capture.");
            if (reply.error) throw captureError("Claude JSON capture failed. Refresh this conversation or turn JSON capture off.", reply.error === "busy" ? "unavailable" : reply.captureFailureReason || "request_failed",
              reply.error === "busy" ? "busy" : reply.captureDetail || "network_error", "history", reply.status);
            resolve(metrics.timed("serialize_ms", () => serialize(reply.data, chat, metrics, measureOnly)));
          } catch (error) { reject(error); }
        };
        const timer = setTimeout(() => { cleanup(); reject(captureError("Claude JSON capture timed out. Refresh or turn JSON capture off.", "timeout", "timeout", "history")); }, 17000);
        signal?.addEventListener("abort", onAbort, { once: true });
        window.addEventListener("message", receive);
        window.postMessage({ channel, type: "request", id, chat, ...(measureOnly ? { measureOnly: true } : {}) }, location.origin);
        if (signal?.aborted) onAbort();
      });
    } finally {
      window.navigation?.removeEventListener("navigate", navigated);
      window.removeEventListener("popstate", navigated);
    }
  };

  // Only an accepted source attempt is persisted by platform-content. Unused
  // picker snapshots stay in memory and never create telemetry reports.
  const readCapture = window.__capCaptureClaudeJson;
  window.__capMeasureClaudeJson = async (expectedPath, signal) => {
    const metrics = globalThis.CapJsonCaptureMetrics.create({ deadline_ms: 17000 });
    metrics.transcript = () => true;
    const capture = await readCapture(expectedPath, metrics, true, signal);
    return { characterCount: capture.text.length };
  };
  window.__capCaptureClaudeJson = async expectedPath => {
    const metrics = globalThis.CapJsonCaptureMetrics.create({ deadline_ms: 17000 });
    try {
      const capture = await readCapture(expectedPath, metrics);
      metrics.set({ selected_turns: capture.messageTurnCount });
      if (capture.captureWarning) metrics.set({ outcome: "partial", failure_check: "text_invalid", failure_stage: "serialize" });
      return { ...capture, jsonCapture: metrics.finish() };
    } catch (error) { error.jsonCapture = metrics.finish(error); throw error; }
  };
})();
