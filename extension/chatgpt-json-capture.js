(() => {
  const channel = "cap-context-chatgpt-json-v2";
  const currentChat = () => location.pathname.match(/\/c\/([^/]+)\/?$/)?.[1];
  function serialize(data, chat) {
    const blocked = reason => new Error(`ChatGPT JSON capture blocked: ${reason} Turn JSON capture off to use DOM capture.`);
    if ((data?.conversation_id ?? data?.id) !== chat) throw blocked("The response belongs to a different conversation.");
    const assertComplete = (scope, label) => {
      if (scope == null) return;
      if (typeof scope !== "object" || Array.isArray(scope)) throw blocked(`${label} metadata is invalid.`);
      for (const key of ["has_previous_page", "has_next_page", "has_previous", "has_next", "has_more", "has_more_messages", "has_missing_messages", "has_missing_nodes", "is_partial", "is_incomplete", "is_truncated", "partial", "incomplete", "truncated", "missing_message_count", "missing_node_count", "missing_messages", "missing_nodes", "missing_message_ids", "missing_node_ids", "previous_cursor", "next_cursor", "previous_page", "next_page", "context_truncation_continuation"]) {
        const value = scope[key];
        if (value != null && value !== false && value !== 0 && value !== "" && !(Array.isArray(value) && value.length === 0)) throw blocked(`${label}.${key} indicates incomplete history.`);
      }
      for (const key of ["is_complete", "complete"]) {
        if (scope[key] != null && scope[key] !== true) throw blocked(`${label}.${key} does not confirm complete content.`);
      }
    };
    if (!data.mapping || typeof data.mapping !== "object" || Array.isArray(data.mapping)) throw blocked("The full conversation tree is missing; recent-message pages are not accepted.");
    const nodeCount = Object.keys(data.mapping).length;
    const messageCount = Object.values(data.mapping).filter(node => node?.message).length;
    for (const [scope, label] of [[data, "conversation"], [data.page_info, "page_info"], [data.pagination, "pagination"], [data.metadata, "conversation metadata"]]) {
      assertComplete(scope, label);
      // Compare advertised totals with the entire tree, never the active branch.
      for (const [key, count] of [["total_node_count", nodeCount], ["total_nodes", nodeCount], ["total_message_count", messageCount], ["total_messages", messageCount]]) {
        if (scope?.[key] != null && (!Number.isSafeInteger(scope[key]) || scope[key] < 0 || scope[key] > count)) throw blocked(`${label}.${key} indicates missing history or an invalid count.`);
      }
    }
    if (typeof data.current_node !== "string" || !data.current_node) throw blocked("The active branch's current_node is missing or invalid.");
    const branch = [];
    const seen = new Set();
    let id = data.current_node;
    while (true) {
      const node = Object.hasOwn(data.mapping, id) ? data.mapping[id] : null;
      if (!node || typeof node !== "object" || Array.isArray(node)) throw blocked("A node or parent is missing or invalid in the active branch.");
      if (node.id != null && node.id !== id) throw blocked("An active-branch node has a mismatched ID.");
      if (seen.has(id)) throw blocked("The active branch contains a parent cycle.");
      if (!Object.hasOwn(node, "parent")) throw blocked("An active-branch node has no parent field; completeness cannot be verified.");
      if (node.message != null && (typeof node.message !== "object" || Array.isArray(node.message))) throw blocked("An active-branch message is invalid.");
      if (node.message?.id != null && node.message.id !== id) throw blocked("An active-branch message has a mismatched ID.");
      if (!node.message && node.parent !== null) throw blocked("An active-branch message is missing from a non-root node.");
      seen.add(id);
      if (node.message) branch.push(node.message);
      if (node.parent === null) break;
      if (typeof node.parent !== "string" || !node.parent) throw blocked("The active branch has an invalid parent/root marker.");
      id = node.parent;
    }
    if (branch[0]?.status != null && !["finished_successfully", "finished_partial"].includes(branch[0].status)) throw blocked("The active turn is still in progress or failed.");
    if (branch[0]?.author?.role === "assistant" && branch[0].end_turn === false) throw blocked("The active assistant turn is still in progress.");
    const turns = branch.reverse().flatMap(message => {
      const role = message.author?.role;
      if (!["user", "assistant"].includes(role) || (message.recipient && message.recipient !== "all") || message.metadata?.is_visually_hidden_from_conversation) return [];
      const content = message.content;
      if (!["text", "multimodal_text", "code", "thinking", "thoughts", "reasoning_recap"].includes(content?.content_type)) return [];
      assertComplete(message, "Own-turn message");
      assertComplete(message.metadata, "Own-turn metadata");
      assertComplete(content, "Own-turn content");
      // finished_partial is a terminal, user-interrupted generation, not a
      // partial network tree. A still-streaming turn must never look complete.
      if (message.status != null && !["finished_successfully", "finished_partial"].includes(message.status)) throw blocked("An own turn is still in progress or failed.");
      if (content.parts != null && !Array.isArray(content.parts)) throw blocked("An own turn has invalid text parts.");
      if (content.content_type === "text" && !Array.isArray(content.parts)) throw blocked("An own text turn is missing its text parts.");
      // Direct own strings only. Never recurse into tools, multimodal objects,
      // uploaded files, canvas/artifact payloads, citations, or message metadata.
      const parts = Array.isArray(content.parts) ? content.parts.filter(part => typeof part === "string" && part.trim()).map(part => part.trim()) : [];
      if (!parts.length && ["thinking", "code", "reasoning_recap"].includes(content.content_type)) {
        const value = content.content_type === "thinking" ? (content.thinking ?? content.text)
          : content.content_type === "reasoning_recap" ? content.content : content.text;
        if (value != null && typeof value !== "string") throw blocked("An own text/thinking string is invalid.");
        if (typeof value === "string" && value.trim()) parts.push(value.trim());
      }
      // Live ChatGPT's own thoughts are explicit entries, not generic nested
      // tool text. content is the full body; summary/chunks can repeat it.
      if (content.content_type === "thoughts") {
        if (!Array.isArray(content.thoughts)) throw blocked("An own thoughts turn is missing its thoughts array.");
        for (const thought of content.thoughts) {
          if (typeof thought?.content !== "string") throw blocked("An own thought is missing its complete content string.");
          // Some live thoughts expose only their visible summary (empty body).
          const value = thought.content.trim() || (typeof thought.summary === "string" ? thought.summary.trim() : "");
          if (value) {
            assertComplete(thought, "Own thought");
            if (thought.finished === false) throw blocked("An own thought is still in progress.");
            parts.push(value);
          }
        }
      }
      return parts.length ? [`${role === "user" ? "User" : "Assistant"}: ${parts.join("\n\n")}`] : [];
    });
    if (!turns.length) throw blocked("No usable user or assistant text remains after skipping tools, files, images, and artifacts.");
    const text = `ChatGPT conversation:\n\n${turns.join("\n\n")}`;
    if (text.length > 350000 || new TextEncoder().encode(text).length > 1400000) throw new Error("This chat is too long to transfer (limit: 350,000 characters). Try a shorter chat.");
    return { text, messageTurnCount: turns.length };
  }

  window.__capCaptureChatGptJson = async () => {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      let readinessTimer;
      try {
        const ready = await Promise.race([
          chrome.runtime.sendMessage({ type: "ENSURE_CHATGPT_JSON_HOOK" }),
          new Promise((_, reject) => { readinessTimer = setTimeout(() => reject(new Error("ChatGPT JSON hook installation timed out. Refresh or turn JSON capture off.")), 3000); })
        ]);
        if (!ready?.ok) throw new Error("ChatGPT JSON hook could not be installed. Refresh or turn JSON capture off.");
      } finally { clearTimeout(readinessTimer); }
    }
    return new Promise((resolve, reject) => {
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
            const reasons = { auth: "ChatGPT authentication is unavailable. Refresh this signed-in chat.", partial: "ChatGPT returned a partial/ranged response.", busy: "Another ChatGPT JSON capture is running. Try again after it finishes.", format: "ChatGPT returned a non-JSON response.", changed: "The ChatGPT conversation changed during capture.", timeout: "The full-tree request timed out.", network: "The full-tree request failed or returned invalid JSON." };
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
  };
})();
