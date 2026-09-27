(() => {
  const channel = "cap-context-claude-json-v1";
  function serialize(data, chat) {
    // Report structural metadata only, never message text, file names, or tool payloads.
    const unsupported = reason => new Error(`This conversation has incomplete or unsupported JSON content: ${reason} Turn JSON capture off to use DOM capture.`);
    if (data?.uuid !== chat) throw unsupported("The response belongs to a different conversation.");
    if (!Array.isArray(data.chat_messages)) throw unsupported("The chat_messages array is missing or invalid.");
    if (!data.current_leaf_message_uuid) throw unsupported("The active branch's last-message ID is missing.");
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
      id = message.parent_message_uuid;
      // Claude's root parent can be the all-zero UUID rather than null.
      if (id === "00000000-0000-0000-0000-000000000000" || id === "00000000-0000-4000-8000-000000000000") break;
    }
    const turns = branch.reverse().map((message, index) => {
      const label = `Message ${index + 1} (${message.sender === "human" ? "User" : message.sender === "assistant" ? "Assistant" : "unknown role"})`;
      if (!["human", "assistant"].includes(message.sender)) throw unsupported(`${label} has an unsupported sender role.`);
      if (message.truncated) throw unsupported(`${label} is marked truncated.`);
      if (message.files?.length) throw unsupported(`${label} has file entries in message.files; file content is not supported by JSON capture, even when image blocks are skipped.`);
      if (message.sync_sources?.length) throw unsupported(`${label} has synced-source entries in message.sync_sources.`);
      const blocks = message.content || [];
      if (!Array.isArray(blocks)) throw unsupported(`${label}'s content is not an array.`);
      blocks.forEach((block, blockIndex) => {
        if (!["text", "thinking", "image"].includes(block.type)) {
          const type = typeof block.type === "string" && /^[a-z][a-z0-9_]{0,39}$/i.test(block.type) ? block.type : "unknown";
          throw unsupported(`${label}, block ${blockIndex + 1}: unsupported content type "${type}".`);
        }
        if (block.type === "text" && typeof block.text !== "string") throw unsupported(`${label}, block ${blockIndex + 1}: text is missing or is not a string.`);
      });
      // Images and reasoning are excluded; all other unsupported types still fail closed.
      // text/content are alternatives, not duplicates.
      let text = blocks.length ? blocks.filter(block => block.type === "text").map(block => block.text).join("\n\n") : message.text;
      if (typeof text !== "string") throw unsupported(`${label} has no valid text field.`);
      for (const [attachmentIndex, attachment] of (message.attachments || []).entries()) {
        if (typeof attachment.extracted_content !== "string" || !attachment.extracted_content.trim()) throw unsupported(`${label}, attachment ${attachmentIndex + 1}: extracted_content is missing or empty.`);
        text += `\n\n[Attachment: ${attachment.file_name || "pasted content"}]\n${attachment.extracted_content}`;
      }
      if (!text.trim()) throw unsupported(`${label} has no usable text after image and thinking blocks are skipped.`);
      return `${message.sender === "human" ? "User" : "Assistant"}: ${text.trim()}`;
    });
    if (!turns.length) throw unsupported("The active branch contains no messages.");
    const text = `Claude conversation:\n\n${turns.join("\n\n")}`;
    if (text.length > 350000 || new TextEncoder().encode(text).length > 1400000) {
      throw new Error("Conversation exceeds the supported 350,000 character / 1.4 MB limit.");
    }
    return { text, messageTurnCount: turns.length };
  }

  window.__capCaptureClaudeJson = () => new Promise((resolve, reject) => {
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
})();
