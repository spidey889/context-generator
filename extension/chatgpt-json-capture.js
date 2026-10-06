(() => {
  const channel = "cap-context-chatgpt-json-v2";
  const captureError = (message, captureFailureReason) => Object.assign(new Error(message), { captureFailureReason });
  const currentChat = (pathname = location.pathname) => pathname.match(/\/c\/([^/]+)\/?$/)?.[1];
  function serialize(data, chat, pastedTexts = {}) {
    const blocked = reason => captureError(`ChatGPT JSON capture blocked: ${reason} Turn JSON capture off to use DOM capture.`, "incomplete");
    const excludedContentTypes = new Set();
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
    // finished_partial is terminal after a user stop, even if the streaming
    // end_turn flag was never advanced. Own completeness checks still apply.
    if (branch[0]?.author?.role === "assistant" && branch[0].end_turn === false
      && branch[0].status !== "finished_partial") throw blocked("The active assistant turn is still in progress.");
    // Legacy canvas bodies are assistant-authored, but delivered through a
    // canmore operation. Only a successful, adjacent canvas acknowledgement
    // identifies these document fields; never import the tool reply or params.
    const canvasParts = (message, result) => {
      const command = message.recipient === "canmore.create_textdoc" ? "create_textdoc"
        : message.recipient === "canmore.update_textdoc" ? "update_textdoc" : null;
      const canvas = result?.metadata?.canvas;
      if (!command || result?.author?.role !== "tool" || result.author.name !== message.recipient
        || result.status !== "finished_successfully" || result.metadata?.command !== command
        || typeof canvas?.textdoc_id !== "string" || !canvas.textdoc_id
        || typeof canvas.textdoc_type !== "string"
        || !(canvas.textdoc_type === "document" || canvas.textdoc_type.startsWith("code/"))) return [];
      assertComplete(message, "Canvas message");
      assertComplete(message.metadata, "Canvas metadata");
      assertComplete(message.content, "Canvas content");
      if (message.status != null && message.status !== "finished_successfully") throw blocked("A canvas document is still in progress or failed.");
      const content = message.content;
      const raw = content?.content_type === "code" ? content.text
        : content?.content_type === "text" && Array.isArray(content.parts) && content.parts.every(part => typeof part === "string") ? content.parts.join("") : null;
      let payload;
      try { payload = JSON.parse(raw); } catch { throw blocked("A canvas document has invalid JSON."); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw blocked("A canvas document is missing its text fields.");
      assertComplete(payload, "Canvas document");
      if (command === "create_textdoc") {
        if (payload.type !== canvas.textdoc_type || typeof payload.content !== "string" || typeof payload.name !== "string") throw blocked("A canvas document is missing its complete content string.");
        return payload.content.trim() ? [`Canvas: ${payload.name}\n\n${payload.content}`] : [];
      }
      if (!Array.isArray(payload.updates) || !payload.updates.length) throw blocked("A canvas edit is missing its replacement text.");
      const parts = [];
      for (const update of payload.updates) {
        if (typeof update?.replacement !== "string") throw blocked("A canvas edit is missing its replacement text.");
        assertComplete(update, "Canvas edit");
        // Preserve authored edit text in this turn, not regex patterns or a
        // guessed reconstruction of the latest document (edits can be partial).
        if (update.replacement.trim()) parts.push(`Canvas edit:\n\n${update.replacement}`);
      }
      return parts;
    };
    // The native Analysis panel renders Python execution_output.text. Keep only
    // this adjacent completed call/result pair, not code or visualization metadata.
    const pythonResult = (message, call) => {
      if (message.author?.name !== "python" || message.recipient !== "all"
        || message.content?.content_type !== "execution_output"
        || call?.author?.role !== "assistant" || call.recipient !== "python"
        || call.content?.content_type !== "code" || typeof call.content.text !== "string"
        || call.metadata?.is_visually_hidden_from_conversation
        || call.status !== "finished_successfully" || message.status !== "finished_successfully") return null;
      for (const [scope, label] of [[call, "Python call"], [call.metadata, "Python call metadata"], [call.content, "Python call content"],
        [message, "Python result"], [message.metadata, "Python result metadata"], [message.content, "Python result content"]]) assertComplete(scope, label);
      if (typeof message.content.text !== "string") throw blocked("A Python result is missing its complete text string.");
      return message.content.text.trim() ? message.content.text : null;
    };
    const turns = branch.reverse().flatMap((message, index) => {
      const role = message.author?.role;
      if (role === "tool") {
        const output = message.metadata?.is_visually_hidden_from_conversation ? null : pythonResult(message, branch[index - 1]);
        if (output === null) { excludedContentTypes.add("tools"); return []; }
        return [`Assistant: Python result:\n\n${output}`];
      }
      if (!["user", "assistant"].includes(role) || message.metadata?.is_visually_hidden_from_conversation) return [];
      if (role === "user" && Array.isArray(message.metadata?.attachments) && message.metadata.attachments.some(file => file?.is_big_paste !== true || file.mime_type !== "text/plain")) excludedContentTypes.add("uploads");
      if (message.recipient && message.recipient !== "all") {
        const parts = role === "assistant" ? canvasParts(message, branch[index + 1]) : [];
        if (!parts.length) excludedContentTypes.add("tools");
        return parts.length ? [`Assistant: ${parts.join("\n\n")}`] : [];
      }
      const attachmentLabels = role === "user" && Array.isArray(message.metadata?.attachments)
        ? message.metadata.attachments.flatMap(file => file?.is_big_paste !== true && typeof file?.name === "string" && file.name.trim()
          ? [`Attachment: ${JSON.stringify(file.name)}`] : []) : [];
      const content = message.content;
      if (!["text", "multimodal_text", "code", "thinking", "thoughts", "reasoning_recap"].includes(content?.content_type)) {
        excludedContentTypes.add(/image|audio|video/.test(content?.content_type || "") ? "media" : "other");
        if (!attachmentLabels.length) return [];
        assertComplete(message, "Own-turn message");
        assertComplete(message.metadata, "Own-turn metadata");
        assertComplete(content, "Own-turn content");
        if (message.status != null && !["finished_successfully", "finished_partial"].includes(message.status)) throw blocked("An own turn is still in progress or failed.");
        return [`User: ${attachmentLabels.join("\n\n")}`];
      }
      assertComplete(message, "Own-turn message");
      assertComplete(message.metadata, "Own-turn metadata");
      assertComplete(content, "Own-turn content");
      // finished_partial is a terminal, user-interrupted generation, not a
      // partial network tree. A still-streaming turn must never look complete.
      if (message.status != null && !["finished_successfully", "finished_partial"].includes(message.status)) throw blocked("An own turn is still in progress or failed.");
      if (content.parts != null && !Array.isArray(content.parts)) throw blocked("An own turn has invalid text parts.");
      if (content.content_type === "text" && !Array.isArray(content.parts)) throw blocked("An own text turn is missing its text parts.");
      // Own strings plus explicitly typed voice transcripts only. Never recurse
      // into tools, audio/image pointers, artifacts, files or their metadata.
      const parts = Array.isArray(content.parts) ? content.parts.flatMap(part => {
        if (typeof part === "string") return part.trim() ? [part] : [];
        if (content.content_type !== "multimodal_text" || part?.content_type !== "audio_transcription") {
          excludedContentTypes.add(/image|audio|video/.test(part?.content_type || "") ? "media" : "other");
          return [];
        }
        assertComplete(part, "Voice transcription");
        assertComplete(part.metadata, "Voice transcription metadata");
        if (typeof part.text !== "string") throw blocked("A voice transcription is missing its complete text string.");
        return part.text.trim() ? [part.text] : [];
      }) : [];
      if (!parts.length && ["thinking", "code", "reasoning_recap"].includes(content.content_type)) {
        const value = content.content_type === "thinking" ? (content.thinking ?? content.text)
          : content.content_type === "reasoning_recap" ? content.content : content.text;
        if (value != null && typeof value !== "string") throw blocked("An own text/thinking string is invalid.");
        if (typeof value === "string" && value.trim()) parts.push(value);
      }
      // Live ChatGPT's own thoughts are explicit entries, not generic nested
      // tool text. content is the full body; summary/chunks can repeat it.
      if (content.content_type === "thoughts") {
        if (!Array.isArray(content.thoughts)) throw blocked("An own thoughts turn is missing its thoughts array.");
        for (const thought of content.thoughts) {
          if (typeof thought?.content !== "string") throw blocked("An own thought is missing its complete content string.");
          // Some live thoughts expose only their visible summary (empty body).
          const value = thought.content.trim() ? thought.content : (typeof thought.summary === "string" && thought.summary.trim() ? thought.summary : "");
          if (value) {
            assertComplete(thought, "Own thought");
            if (thought.finished === false) throw blocked("An own thought is still in progress.");
            parts.push(value);
          }
        }
      }
      if (role === "user") {
        const inlineParts = [...parts];
        const inlineCopies = new Map();
        const pastedIds = new Set();
        for (const file of Array.isArray(message.metadata?.attachments) ? message.metadata.attachments : []) {
          if (file?.is_big_paste !== true || file.mime_type !== "text/plain") continue;
          assertComplete(file, "Pasted text attachment");
          const pasted = Object.hasOwn(pastedTexts, file.id) ? pastedTexts[file.id] : null;
          if (typeof pasted !== "string" || !Number.isSafeInteger(file.size) || new TextEncoder().encode(pasted).length !== file.size) throw blocked("A pasted text attachment is missing or incomplete.");
          if (!pasted.trim() || pastedIds.has(file.id)) continue;
          pastedIds.add(file.id);
          // Attachment identity, not substring overlap, decides duplication.
          // One full inline paragraph occurrence may represent one card.
          let inlineCopy = null;
          for (const [index, part] of inlineParts.entries()) {
            for (const candidate of [pasted, pasted.trim()]) {
              for (let start = part.indexOf(candidate); start >= 0; start = part.indexOf(candidate, start + 1)) {
                const end = start + candidate.length;
                if ((start === 0 || /(?:\r?\n){2}$/.test(part.slice(0, start)))
                  && (end === part.length || /^(?:\r?\n){2}/.test(part.slice(end)))
                  && !(inlineCopies.get(index) || []).some(copy => start < copy.end && end > copy.start)) {
                  inlineCopy = { index, start, end, text: pasted };
                  break;
                }
              }
              if (inlineCopy) break;
            }
            if (inlineCopy) break;
          }
          if (!inlineCopy) parts.push(pasted);
          else {
            if (!inlineCopies.has(inlineCopy.index)) inlineCopies.set(inlineCopy.index, []);
            inlineCopies.get(inlineCopy.index).push(inlineCopy);
          }
        }
        // Work backwards so whitespace restoration does not shift another card.
        for (const [index, copies] of inlineCopies) {
          for (const copy of copies.sort((a, b) => b.start - a.start)) {
            parts[index] = parts[index].slice(0, copy.start) + copy.text + parts[index].slice(copy.end);
          }
        }
      }
      // Only explicit upload names; never serialize signed pointers or nested metadata.
      parts.push(...attachmentLabels);
      return parts.length ? [`${role === "user" ? "User" : "Assistant"}: ${parts.join("\n\n")}`] : [];
    });
    if (!turns.length) throw blocked("No usable user or assistant text remains after skipping tools, files, images, and artifacts.");
    const text = `ChatGPT conversation:\n\n${turns.join("\n\n")}`;
    if (text.length > 350000 || new TextEncoder().encode(text).length > 1400000) throw captureError("This chat is too long to transfer (limit: 350,000 characters). Try a shorter chat.", "size_limit");
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
          && reply.type === "pong" && reply.id === id && reply.version === 6) finish(true);
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
        // A busy/cold worker's reply can lag behind a working MAIN hook. Trust
        // the correlated pong, not the installation callback, as readiness proof.
        Promise.resolve().then(() => chrome.runtime.sendMessage({ type: "ENSURE_CHATGPT_JSON_HOOK" }))
          .then(reply => { if (!reply?.ok) finish(false); }, () => finish(false));
      }
    });
  }

  window.__capCaptureChatGptJson = async (expectedPath = location.pathname) => {
    const chat = currentChat(expectedPath);
    if (!chat) throw new Error("Open a saved ChatGPT conversation to use JSON capture.");
    let changed = currentChat() !== chat;
    const navigated = event => {
      const destination = event?.destination ? new URL(event.destination.url) : location;
      if (destination.origin !== location.origin || currentChat(destination.pathname) !== chat) changed = true;
    };
    // Keep the navigation latch through setup and response delivery as well as
    // the network read; a final pathname alone misses away-and-back changes.
    window.navigation?.addEventListener("navigate", navigated);
    window.addEventListener("popstate", navigated);
    try {
      if (changed) throw new Error("The ChatGPT conversation changed during capture.");
      // Usually document_start already installed MAIN; don't wake/reinstall it
      // on every capture. Missing/older/replaced hooks get bounded recovery.
      if (!await waitForHook(250)) {
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage || !await waitForHook(8000, true)) {
          throw captureError("Fast capture isn't ready yet. Refresh this chat and try again, or turn off the lightning button.", "unavailable");
        }
      }
      if (changed || currentChat() !== chat) throw new Error("The ChatGPT conversation changed during capture.");
      return await new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); };
        const receive = event => {
          const reply = event.data;
          if (event.source !== window || event.origin !== location.origin || reply?.channel !== channel || reply.type !== "response" || reply.id !== id) return;
          cleanup();
          try {
            if (changed || currentChat() !== chat || reply.chat !== chat) throw new Error("The ChatGPT conversation changed during capture.");
            if (reply.error) {
              if (reply.error === "size") throw captureError("This chat is too long to transfer (limit: 350,000 characters). Try a shorter chat.", "size_limit");
              const reasons = { auth: "ChatGPT authentication is unavailable. Refresh this signed-in chat.", partial: "ChatGPT returned a partial/ranged response.", busy: "Another ChatGPT JSON capture is running. Try again after it finishes.", format: "ChatGPT returned a non-JSON response.", changed: "The ChatGPT conversation changed during capture.", timeout: "The full-tree request timed out.", network: "The full-tree request failed or returned invalid JSON." };
              reasons.paste = "A pasted text attachment could not be read completely. Refresh this chat and try again.";
              const reason = reply.error === "http" && Number.isInteger(reply.status) && reply.status >= 100 && reply.status <= 599 ? `The full-tree request returned HTTP ${reply.status}.` : reasons[reply.error] || "The full-tree request failed.";
              const failureReason = { auth: "unavailable", busy: "unavailable", partial: "incomplete", format: "incomplete", paste: "incomplete", timeout: "timeout" }[reply.error] || "request_failed";
              throw captureError(`ChatGPT JSON capture failed: ${reason} Turn JSON capture off to use DOM capture.`, failureReason);
            }
            resolve(serialize(reply.data, chat, reply.pastedTexts));
          } catch (error) { reject(error); }
        };
        const timer = setTimeout(() => { cleanup(); reject(captureError("ChatGPT JSON capture timed out. Refresh or turn JSON capture off.", "timeout")); }, 17000);
        window.addEventListener("message", receive);
        window.postMessage({ channel, type: "request", id, chat }, location.origin);
      });
    } finally {
      window.navigation?.removeEventListener("navigate", navigated);
      window.removeEventListener("popstate", navigated);
    }
  };
})();
