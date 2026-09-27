(() => {
  const channel = "cap-context-claude-json-v1";
  function serialize(data, chat) {
    const unsupported = () => new Error("This conversation has incomplete or unsupported JSON content. Turn JSON capture off to use DOM capture.");
    if (data?.uuid !== chat || !Array.isArray(data.chat_messages) || !data.current_leaf_message_uuid) throw unsupported();
    const messages = new Map(data.chat_messages.map(message => [message.uuid, message]));
    if (messages.size !== data.chat_messages.length) throw unsupported();
    const branch = [];
    const seen = new Set();
    let id = data.current_leaf_message_uuid;
    while (id) {
      const message = messages.get(id);
      if (!message || seen.has(id) || !Object.hasOwn(message, "parent_message_uuid")) throw unsupported();
      seen.add(id);
      branch.push(message);
      id = message.parent_message_uuid;
      // Claude's root parent can be the all-zero UUID rather than null.
      if (id === "00000000-0000-0000-0000-000000000000") break;
    }
    const turns = branch.reverse().map(message => {
      if (!["human", "assistant"].includes(message.sender) || message.truncated || message.files?.length || message.sync_sources?.length) throw unsupported();
      const blocks = message.content || [];
      if (!Array.isArray(blocks) || blocks.some(block => !["text", "thinking", "image"].includes(block.type) || (block.type === "text" && typeof block.text !== "string"))) throw unsupported();
      // Images and reasoning are excluded; all other unsupported types still fail closed.
      // text/content are alternatives, not duplicates.
      let text = blocks.length ? blocks.filter(block => block.type === "text").map(block => block.text).join("\n\n") : message.text;
      if (typeof text !== "string") throw unsupported();
      for (const attachment of message.attachments || []) {
        if (typeof attachment.extracted_content !== "string" || !attachment.extracted_content.trim()) throw unsupported();
        text += `\n\n[Attachment: ${attachment.file_name || "pasted content"}]\n${attachment.extracted_content}`;
      }
      if (!text.trim()) throw unsupported();
      return `${message.sender === "human" ? "User" : "Assistant"}: ${text.trim()}`;
    });
    if (!turns.length) throw unsupported();
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
