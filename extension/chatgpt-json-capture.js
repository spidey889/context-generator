(() => {
  const channel = "cap-context-chatgpt-json-v1";
  const currentChat = () => location.pathname.match(/\/c\/([^/]+)\/?$/)?.[1];
  function serialize(data, chat) {
    const blocked = reason => new Error(`ChatGPT JSON capture blocked: ${reason} Turn JSON capture off to use DOM capture.`);
    if ((data?.conversation_id ?? data?.id) !== chat) throw blocked("The response belongs to a different conversation.");
    // Full-tree responses must not advertise omitted history. Cursors alone are
    // boundaries, but a previous/next/missing flag means capture is incomplete.
    for (const scope of [data, data.page_info, data.pagination, data.metadata].filter(value => value && typeof value === "object")) {
      for (const [key, value] of Object.entries(scope)) {
        if (/^(has_previous_page|has_next_page|has_previous|has_next|has_more|has_more_messages|has_missing_messages|has_missing_nodes|is_partial|is_incomplete|is_truncated|partial|incomplete|truncated|missing_messages|missing_nodes|missing_message_ids|missing_node_ids|previous_cursor|next_cursor|previous_page|next_page|context_truncation_continuation)$/.test(key)
          && value != null && value !== false && value !== 0 && value !== "" && !(Array.isArray(value) && value.length === 0)) {
          throw blocked(`The response indicates incomplete history (${key}).`);
        }
        if (["is_complete", "complete"].includes(key) && value === false) throw blocked(`The response indicates incomplete history (${key}).`);
      }
    }
    if (!data.mapping || typeof data.mapping !== "object" || Array.isArray(data.mapping)) throw blocked("The full conversation tree is missing; recent-message pages are not accepted.");
    if (!data.current_node) throw blocked("The active branch's current_node is missing.");
    const branch = [];
    const seen = new Set();
    let id = data.current_node;
    while (id) {
      const node = Object.hasOwn(data.mapping, id) ? data.mapping[id] : null;
      if (!node) throw blocked("A node or parent is missing from the active branch.");
      if (seen.has(id)) throw blocked("The active branch contains a parent cycle.");
      if (!Object.hasOwn(node, "parent")) throw blocked("An active-branch node has no parent field; completeness cannot be verified.");
      if (!node.message && node.parent != null) throw blocked("An active-branch message is missing from a non-root node.");
      seen.add(id);
      if (node.message) branch.push(node.message);
      id = node.parent;
    }
    const turns = branch.reverse().flatMap(message => {
      const role = message.author?.role;
      if (!["user", "assistant"].includes(role) || (message.recipient && message.recipient !== "all") || message.metadata?.is_visually_hidden_from_conversation) return [];
      const content = message.content;
      if (!["text", "multimodal_text", "thinking", "reasoning_recap"].includes(content?.content_type)) return [];
      // Only direct strings in own turn content. Never descend into tool results,
      // multimodal objects, files, attachments, artifacts, or metadata.
      const parts = Array.isArray(content.parts) ? content.parts.filter(part => typeof part === "string" && part.trim()).map(part => part.trim()) : [];
      if (!parts.length && content.content_type === "thinking") {
        const value = content.thinking ?? content.text;
        if (typeof value === "string" && value.trim()) parts.push(value.trim());
      }
      return parts.length ? [`${role === "user" ? "User" : "Assistant"}: ${parts.join("\n\n")}`] : [];
    });
    if (!turns.length) throw blocked("No usable user or assistant text remains after skipping tools, files, images, and artifacts.");
    const text = `ChatGPT conversation:\n\n${turns.join("\n\n")}`;
    if (text.length > 350000 || new TextEncoder().encode(text).length > 1400000) throw blocked("Conversation exceeds the supported 350,000 character / 1.4 MB limit.");
    return { text, messageTurnCount: turns.length };
  }

  window.__capCaptureChatGptJson = () => new Promise((resolve, reject) => {
    const chat = currentChat();
    if (!chat) return reject(new Error("Open a saved ChatGPT conversation to use JSON capture."));
    const id = crypto.randomUUID();
    const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); };
    const receive = event => {
      const reply = event.data;
      if (event.source !== window || event.origin !== location.origin || reply?.channel !== channel || reply.type !== "response" || reply.id !== id) return;
      cleanup();
      try {
        if (currentChat() !== chat || reply.chat !== chat) throw new Error("The ChatGPT conversation changed during capture.");
        if (reply.error) {
          const reasons = { refresh: "Refresh this ChatGPT conversation so the fetch hook can observe its authenticated request.", format: "ChatGPT returned a non-JSON response.", changed: "The ChatGPT conversation changed during capture.", timeout: "The full-tree request timed out.", network: "The full-tree request failed or returned invalid JSON." };
          const reason = reply.error === "http" && Number.isInteger(reply.status) && reply.status >= 100 && reply.status <= 599 ? `The full-tree request returned HTTP ${reply.status}.` : reasons[reply.error] || "The full-tree request failed.";
          throw new Error(`ChatGPT JSON capture failed: ${reason} Turn JSON capture off to use DOM capture.`);
        }
        resolve(serialize(reply.data, chat));
      } catch (error) { reject(error); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error("ChatGPT JSON capture timed out. Refresh or turn JSON capture off.")); }, 17000);
    window.addEventListener("message", receive);
    window.postMessage({ channel, type: "request", id, chat }, location.origin);
  });
})();
