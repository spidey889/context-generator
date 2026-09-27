(() => {
  const channel = "cap-context-claude-json-v2";
  function serialize(data, chat) {
    // Report structural metadata only, never message text, file names, or tool payloads.
    const unsupported = reason => new Error(`This conversation has incomplete or unsupported JSON content: ${reason} Turn JSON capture off to use DOM capture.`);
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
      // Only direct turn blocks are eligible. Never recurse into tools, artifacts,
      // files, or sync sources, even when they contain text blocks.
      const parts = blocks.flatMap(block => {
        const value = block?.type === "text" ? block.text
          : block?.type === "thinking" ? (block.thinking ?? block.text) : null;
        // Live Claude hides empty thinking with truncated:true. It contributes
        // no captured text; unlike truncation of an actual text/thinking string.
        if (block?.type === "text" || (block?.type === "thinking" && typeof value === "string" && value.trim())) {
          assertComplete(block, `${block.type} block`);
          if (Object.hasOwn(block, "stop_timestamp") && block.stop_timestamp === null) throw unsupported("A captured text/thinking block is still in progress.");
          if (typeof value !== "string") throw unsupported("A text block has no complete text string.");
        }
        return typeof value === "string" && value.trim() ? [value.trim()] : [];
      });
      // Legacy turn text is an alternative only when structured content is absent.
      if (message.content == null || blocks.length === 0) {
        if (typeof message.text === "string" && message.text.trim()) parts.push(message.text.trim());
      }
      // Claude's pasted cards are unnamed txt attachments, unlike named uploads.
      // Their complete text belongs to the owning user turn, not a separate turn.
      const attachments = message.sender === "human" && Array.isArray(message.attachments) ? message.attachments : [];
      for (const attachment of attachments) {
        if (attachment?.file_type !== "txt" || attachment.file_name !== "") continue;
        assertComplete(attachment, "Pasted-text attachment");
        if (typeof attachment.extracted_content !== "string" || (attachment.file_size > 0 && attachment.extracted_content.length === 0)) throw unsupported("A pasted-text attachment is missing its complete extracted_content string.");
        if (attachment.file_size != null && (!Number.isSafeInteger(attachment.file_size) || attachment.file_size < 0 || new TextEncoder().encode(attachment.extracted_content).length !== attachment.file_size)) throw unsupported("A pasted-text attachment's extracted_content does not match its file_size; completeness cannot be verified.");
        const pastedText = attachment.extracted_content.trim();
        if (pastedText && !parts.some(part => part.includes(pastedText))) parts.push(pastedText);
      }
      if (!parts.length) return [];
      return [(message.sender === "human" ? "User" : "Assistant") + ": " + parts.join("\n\n")];
    });
    if (!turns.length) throw new Error("Claude JSON capture found no usable user or assistant text after skipping tools, files, images, and artifacts. Turn JSON capture off to use DOM capture.");
    const text = `Claude conversation:\n\n${turns.join("\n\n")}`;
    if (text.length > 350000 || new TextEncoder().encode(text).length > 1400000) {
      throw new Error("Conversation exceeds the supported 350,000 character / 1.4 MB limit.");
    }
    return { text, messageTurnCount: turns.length };
  }

  window.__capCaptureClaudeJson = async () => {
    // Reinstall MAIN before requesting: a worker/extension reload or another page
    // wrapper must not leave a live isolated bridge talking to a missing hook.
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      let readinessTimer;
      try {
        const ready = await Promise.race([
          chrome.runtime.sendMessage({ type: "ENSURE_CLAUDE_JSON_HOOK" }),
          new Promise((_, reject) => { readinessTimer = setTimeout(() => reject(new Error("Claude JSON hook installation timed out. Refresh or turn JSON capture off.")), 3000); })
        ]);
        if (!ready?.ok) throw new Error("Claude JSON hook could not be installed. Refresh or turn JSON capture off.");
      } finally { clearTimeout(readinessTimer); }
    }
    return new Promise((resolve, reject) => {
      const chat = location.pathname.match(/^\/chat\/([^/]+)$/)?.[1];
      if (!chat) return reject(new Error("Open a saved Claude conversation to use JSON capture."));
      const id = crypto.randomUUID();
      const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); };
      const receive = event => {
        const reply = event.data;
        if (event.source !== window || event.origin !== location.origin || reply?.channel !== channel || reply.type !== "response" || reply.id !== id) return;
        cleanup();
        try {
          if (location.pathname !== `/chat/${chat}` || reply.chat !== chat) throw new Error("The Claude conversation changed during capture.");
          if (reply.error) throw new Error("Claude JSON capture failed. Refresh this conversation or turn JSON capture off.");
          resolve(serialize(reply.data, chat));
        } catch (error) { reject(error); }
      };
      const timer = setTimeout(() => { cleanup(); reject(new Error("Claude JSON capture timed out. Refresh or turn JSON capture off.")); }, 17000);
      window.addEventListener("message", receive);
      window.postMessage({ channel, type: "request", id, chat }, location.origin);
    });
  };
})();
