(() => {
  const channel = "cap-context-claude-json-v2";
  const captureError = (message, captureFailureReason) => Object.assign(new Error(message), { captureFailureReason });
  function serialize(data, chat) {
    // Report structural metadata only, never message text, file names, or tool payloads.
    const unsupported = reason => captureError(`This conversation has incomplete or unsupported JSON content: ${reason} Turn JSON capture off to use DOM capture.`, "incomplete");
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
        if (value?.[field] != null && (!Number.isSafeInteger(value[field]) || value[field] < 0 || value[field] > data.chat_messages.length)) throw unsupported(`${label}.${field} indicates missing history or an invalid message count.`);
      }
    }
    if (typeof data.current_leaf_message_uuid !== "string" || !data.current_leaf_message_uuid) throw unsupported("The active branch's last-message ID is missing or invalid.");
    if (data.chat_messages.some(message => typeof message?.uuid !== "string" || !message.uuid)) throw unsupported("A message ID is missing or invalid.");
    const messages = new Map(data.chat_messages.map(message => [message.uuid, message]));
    if (messages.size !== data.chat_messages.length) throw unsupported("The response contains duplicate message IDs.");
    const branch = [];
    const seen = new Set();
    let id = data.current_leaf_message_uuid;
    while (id) {
      const message = messages.get(id);
      if (!message) throw unsupported(branch.length ? "A parent message is missing from the active branch (possibly an unrecognized root marker)." : "The active branch's last message is missing from the response.");
      if (seen.has(id)) throw unsupported("The active branch's parent links form a cycle.");
      if (!Object.hasOwn(message, "parent_message_uuid")) throw unsupported("A message in the active branch has no parent_message_uuid field.");
      seen.add(id);
      branch.push(message);
      const parent = message.parent_message_uuid;
      // Claude's root parent can be the all-zero UUID rather than null.
      if (parent === null || parent === "00000000-0000-0000-0000-000000000000" || parent === "00000000-0000-4000-8000-000000000000") break;
      if (typeof parent !== "string" || !parent) throw unsupported("The active branch has an invalid parent/root marker.");
      id = parent;
    }
    const turns = branch.reverse().flatMap(message => {
      if (!["human", "assistant"].includes(message.sender)) return [];
      assertComplete(message, "Active-branch message");
      if (message.sender === "assistant" && Object.hasOwn(message, "stop_reason") && message.stop_reason == null) throw unsupported("An assistant turn is still in progress.");
      if (message.content != null && !Array.isArray(message.content)) throw unsupported("An active-branch message has invalid structured content.");
      const blocks = Array.isArray(message.content) ? message.content : [];
      if ((Array.isArray(message.files) && message.files.length) || (Array.isArray(message.attachments) && message.attachments.some(file => file?.file_type !== "txt" || file.file_name !== ""))) excludedContentTypes.add("uploads");
      if (Array.isArray(message.sync_sources) && message.sync_sources.length) excludedContentTypes.add("other");
      // Only direct turn blocks are eligible. Never recurse into tools, artifacts,
      // files, or sync sources, even when they contain text blocks.
      const parts = blocks.flatMap(block => {
        const value = block?.type === "text" ? block.text
          : block?.type === "thinking" ? (block.thinking ?? block.text) : null;
        if (block?.type && !["text", "thinking"].includes(block.type)) {
          excludedContentTypes.add(["tool_use", "tool_result"].includes(block.type) ? "tools"
            : block.type === "artifact" ? "artifacts" : ["image", "audio", "video"].includes(block.type) ? "media" : "other");
        }
        // Live Claude hides empty thinking with truncated:true. It contributes
        // no captured text; unlike truncation of an actual text/thinking string.
        if (block?.type === "text" || (block?.type === "thinking" && typeof value === "string" && value.trim())) {
          assertComplete(block, `${block.type} block`);
          if (Object.hasOwn(block, "stop_timestamp") && block.stop_timestamp === null) throw unsupported("A captured text/thinking block is still in progress.");
          if (typeof value !== "string") throw unsupported("A text block has no complete text string.");
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
      const pastedIds = new Set();
      for (const attachment of attachments) {
        if (attachment?.file_type !== "txt" || attachment.file_name !== "") continue;
        assertComplete(attachment, "Pasted-text attachment");
        if (typeof attachment.extracted_content !== "string" || (attachment.file_size > 0 && attachment.extracted_content.length === 0)) throw unsupported("A pasted-text attachment is missing its complete extracted_content string.");
        if (attachment.file_size != null && (!Number.isSafeInteger(attachment.file_size) || attachment.file_size < 0 || new TextEncoder().encode(attachment.extracted_content).length !== attachment.file_size)) throw unsupported("A pasted-text attachment's extracted_content does not match its file_size; completeness cannot be verified.");
        const pastedText = attachment.extracted_content;
        // Text overlap is not attachment identity: two cards may intentionally
        // contain the same text, or one may be a substring of another.
        const duplicate = typeof attachment.id === "string" && pastedIds.has(attachment.id);
        if (typeof attachment.id === "string" && attachment.id) pastedIds.add(attachment.id);
        if (!pastedText.trim() || duplicate) continue;
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
            if ((start === 0 || matchText.slice(0, start).endsWith("\n\n"))
              && (end === matchText.length || matchText.slice(end).startsWith("\n\n"))
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
      return [(message.sender === "human" ? "User" : "Assistant") + ": " + parts.join("\n\n")];
    });
    if (!turns.length) throw captureError("Claude JSON capture found no usable user or assistant text after skipping tools, files, images, and artifacts. Turn JSON capture off to use DOM capture.", "incomplete");
    const text = `Claude conversation:\n\n${turns.join("\n\n")}`;
    if (text.length > 350000 || new TextEncoder().encode(text).length > 1400000) {
      throw captureError("Conversation exceeds the supported 350,000 character / 1.4 MB limit.", "size_limit");
    }
    return { text, messageTurnCount: turns.length, excludedContentTypes: [...excludedContentTypes].sort() };
  }

  function waitForHook(timeoutMs, install = false) {
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      let pollTimer;
      let settled = false;
      const finish = ready => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearTimeout(pollTimer);
        window.removeEventListener("message", receive);
        resolve(ready);
      };
      const receive = event => {
        const reply = event.data;
        if (event.source === window && event.origin === location.origin && reply?.channel === channel
          && reply.type === "pong" && reply.id === id && reply.version === 5) finish(true);
      };
      const ping = () => {
        if (settled) return;
        window.postMessage({ channel, type: "ping", id }, location.origin);
        pollTimer = setTimeout(ping, 100);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
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

  window.__capCaptureClaudeJson = async (expectedPath = location.pathname) => {
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
      if (changed) throw new Error("The Claude conversation changed during capture.");
      if (!await waitForHook(250)) {
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage || !await waitForHook(8000, true)) {
          throw captureError("Claude JSON hook is not ready. Refresh this chat and try again, or turn JSON capture off.", "unavailable");
        }
      }
      if (changed || location.pathname !== expectedPath) throw new Error("The Claude conversation changed during capture.");
      return await new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); };
        const receive = event => {
          const reply = event.data;
          if (event.source !== window || event.origin !== location.origin || reply?.channel !== channel || reply.type !== "response" || reply.id !== id) return;
          cleanup();
          try {
            if (changed || location.pathname !== expectedPath || reply.chat !== chat) throw new Error("The Claude conversation changed during capture.");
            if (reply.error) throw captureError("Claude JSON capture failed. Refresh this conversation or turn JSON capture off.", reply.error === "busy" ? "unavailable" : reply.captureFailureReason || "request_failed");
            resolve(serialize(reply.data, chat));
          } catch (error) { reject(error); }
        };
        const timer = setTimeout(() => { cleanup(); reject(captureError("Claude JSON capture timed out. Refresh or turn JSON capture off.", "timeout")); }, 17000);
        window.addEventListener("message", receive);
        window.postMessage({ channel, type: "request", id, chat }, location.origin);
      });
    } finally {
      window.navigation?.removeEventListener("navigate", navigated);
      window.removeEventListener("popstate", navigated);
    }
  };
})();
