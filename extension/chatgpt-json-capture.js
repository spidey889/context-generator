(() => {
  const channel = "cap-context-chatgpt-json-v2";
  const debug = (event, fields = {}) => {
    try {
      const data = { build: 26, ...fields };
      console.info?.(`[CapCapture] ${JSON.stringify({ world: "bridge", event, ...data })}`);
      window.postMessage({ channel, type: "debug", world: "bridge", event, fields: data }, location.origin);
    } catch { /* Timing is local and cannot change capture. */ }
  };
  debug("loaded");
  // Keep the MAIN download gate and serializer aligned for parameterized MIME labels.
  const isPlainTextPaste = file => file?.is_big_paste === true && typeof file.mime_type === "string"
    && file.mime_type.split(";", 1)[0].trim().toLowerCase() === "text/plain";
  const captureError = (message, captureFailureReason, detail = "incomplete_history", stage = "serialize", status) => Object.assign(new Error(message), {
    captureFailureReason, diagnosticCode: captureFailureReason === "size_limit" ? "conversation_too_large"
      : detail === "conversation_changed" ? "conversation_changed" : captureFailureReason === "unavailable" ? "capture_json_unavailable" : "capture_json_failed",
    diagnostics: { version: 1, capture_detail: captureFailureReason === "size_limit" && detail !== "attachment_size_limit" ? "size_limit" : detail, capture_request_stage: stage, failure_site: `capture_${stage}`,
      ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { capture_http_status: status } : {}) }
  });
  const currentChat = (pathname = location.pathname) => pathname.match(/\/c\/([^/]+)\/?$/)?.[1];
  // Estimates never authorize size rejection or become a transferable transcript.
  function roughCaptureSize(data) {
    const messages = Object.values(data?.mapping || {}).map(node => node?.message)
      .filter(item => ["user", "assistant"].includes(item?.author?.role) && !item.metadata?.is_visually_hidden_from_conversation);
    const estimatedCharacterCount = messages.reduce((sum, item) => sum + (typeof item.content?.text === "string" ? item.content.text.length : 0)
      + (Array.isArray(item.content?.parts) ? item.content.parts : []).reduce((n, part) => n + (typeof part === "string" ? part.length : 0), 0), 0);
    return { text: "", messageTurnCount: messages.length, estimatedCharacterCount };
  }
  function serialize(data, chat, pastedTexts = {}, sourceTreeCounts, metrics, measureOnly = false) {
    const blocked = (reason, detail = "incomplete_history") => captureError(`ChatGPT JSON capture blocked: ${reason} Turn JSON capture off to use DOM capture.`, "incomplete", detail);
    const excludedContentTypes = new Set();
    const skippedFiles = new Map();
    let pastedAttachmentIndex = 0;
    let captureWarning;
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
    let nodeCount = Object.keys(data.mapping).length;
    let messageCount = Object.values(data.mapping).filter(node => node?.message).length;
    if (sourceTreeCounts != null) {
      // MAIN sends only the selected path. Native totals still describe the
      // original tree; pruning must neither look partial nor hide real omissions.
      if (!Number.isSafeInteger(sourceTreeCounts.nodes) || sourceTreeCounts.nodes < nodeCount
        || !Number.isSafeInteger(sourceTreeCounts.messages) || sourceTreeCounts.messages < messageCount
        || sourceTreeCounts.messages > sourceTreeCounts.nodes) throw blocked("The source tree counts are invalid.", "count_mismatch");
      nodeCount = sourceTreeCounts.nodes;
      messageCount = sourceTreeCounts.messages;
    }
    for (const [scope, label] of [[data, "conversation"], [data.page_info, "page_info"], [data.pagination, "pagination"], [data.metadata, "conversation metadata"]]) {
      assertComplete(scope, label);
      // Compare advertised totals with the entire tree, never the active branch.
      for (const [key, count] of [["total_node_count", nodeCount], ["total_nodes", nodeCount], ["total_message_count", messageCount], ["total_messages", messageCount]]) {
        if (scope?.[key] != null && (!Number.isSafeInteger(scope[key]) || scope[key] < 0 || scope[key] > count)) throw blocked(`${label}.${key} indicates missing history or an invalid count.`, "count_mismatch");
      }
    }
    if (typeof data.current_node !== "string" || !data.current_node) throw blocked("The active branch's current_node is missing or invalid.", "invalid_branch");
    const branch = [];
    const seen = new Set();
    let id = data.current_node;
    while (true) {
      const node = Object.hasOwn(data.mapping, id) ? data.mapping[id] : null;
      if (!node || typeof node !== "object" || Array.isArray(node)) throw blocked("A node or parent is missing or invalid in the active branch.", "parent_missing");
      if (node.id != null && node.id !== id) throw blocked("An active-branch node has a mismatched ID.", "invalid_branch");
      if (seen.has(id)) throw blocked("The active branch contains a parent cycle.", "branch_cycle");
      if (!Object.hasOwn(node, "parent")) throw blocked("An active-branch node has no parent field; completeness cannot be verified.", "parent_missing");
      if (node.message != null && (typeof node.message !== "object" || Array.isArray(node.message))) throw blocked("An active-branch message is invalid.", "invalid_branch");
      if (node.message?.id != null && node.message.id !== id) throw blocked("An active-branch message has a mismatched ID.", "invalid_branch");
      if (!node.message && node.parent !== null) throw blocked("An active-branch message is missing from a non-root node.", "invalid_branch");
      seen.add(id);
      if (node.message) branch.push(node.message);
      if (node.parent === null) break;
      if (typeof node.parent !== "string" || !node.parent) throw blocked("The active branch has an invalid parent/root marker.", "invalid_branch");
      id = node.parent;
    }
    // Explicit capture takes the text available now, including a streaming or
    // interrupted reply. Generation status/end_turn do not describe missing
    // history; tree, metadata and supported-content validation still apply.
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
      if (message.status != null && message.status !== "finished_successfully") throw blocked("A canvas document is still in progress or failed.", "canvas_invalid");
      const content = message.content;
      const raw = content?.content_type === "code" ? content.text
        : content?.content_type === "text" && Array.isArray(content.parts) && content.parts.every(part => typeof part === "string") ? content.parts.join("") : null;
      let payload;
      try { payload = JSON.parse(raw); } catch { throw blocked("A canvas document has invalid JSON.", "canvas_invalid"); }
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw blocked("A canvas document is missing its text fields.", "canvas_invalid");
      assertComplete(payload, "Canvas document");
      if (command === "create_textdoc") {
        if (payload.type !== canvas.textdoc_type || typeof payload.content !== "string" || typeof payload.name !== "string") throw blocked("A canvas document is missing its complete content string.", "canvas_invalid");
        return payload.content.trim() ? [`Canvas: ${payload.name}\n\n${payload.content}`] : [];
      }
      if (!Array.isArray(payload.updates) || !payload.updates.length) throw blocked("A canvas edit is missing its replacement text.", "canvas_invalid");
      const parts = [];
      for (const update of payload.updates) {
        if (typeof update?.replacement !== "string") throw blocked("A canvas edit is missing its replacement text.", "canvas_invalid");
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
      if (typeof message.content.text !== "string") throw blocked("A Python result is missing its complete text string.", "text_invalid");
      return message.content.text.trim() ? message.content.text : null;
    };
    let hasText = false;
    const turns = branch.reverse().flatMap((message, index) => {
      const role = message.author?.role;
      if (role === "tool") {
        const output = message.metadata?.is_visually_hidden_from_conversation ? null : pythonResult(message, branch[index - 1]);
        if (output === null) { excludedContentTypes.add("tools"); return []; }
        hasText = true;
        return [{ role: "assistant", text: `Python result:\n\n${output}` }];
      }
      if (!["user", "assistant"].includes(role) || message.metadata?.is_visually_hidden_from_conversation) return [];
      if (role === "user" && Array.isArray(message.metadata?.attachments) && message.metadata.attachments.some(file => !isPlainTextPaste(file))) excludedContentTypes.add("uploads");
      if (message.recipient && message.recipient !== "all") {
        const parts = role === "assistant" ? canvasParts(message, branch[index + 1]) : [];
        if (!parts.length) excludedContentTypes.add("tools");
        else hasText = true;
        return parts.length ? [{ role: "assistant", text: parts.join("\n\n") }] : [];
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
        return [{ role: "user", text: attachmentLabels.join("\n\n") }];
      }
      assertComplete(message, "Own-turn message");
      assertComplete(message.metadata, "Own-turn metadata");
      assertComplete(content, "Own-turn content");
      if (content.parts != null && !Array.isArray(content.parts)) throw blocked("An own turn has invalid text parts.", "text_invalid");
      if (content.content_type === "text" && !Array.isArray(content.parts)) throw blocked("An own text turn is missing its text parts.", "text_invalid");
      // Keep known strings without guessing nested content. The owning transfer
      // must report this best-effort capture as failed even if delivery completes.
      if (content.content_type === "text" && content.parts.some(part => typeof part !== "string")) {
        captureWarning = "text_invalid";
      }
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
        if (typeof part.text !== "string") throw blocked("A voice transcription is missing its complete text string.", "text_invalid");
        return part.text.trim() ? [part.text] : [];
      }) : [];
      if (!parts.length && ["thinking", "code", "reasoning_recap"].includes(content.content_type)) {
        const value = content.content_type === "thinking" ? (content.thinking ?? content.text)
          : content.content_type === "reasoning_recap" ? content.content : content.text;
        if (value != null && typeof value !== "string") throw blocked("An own text/thinking string is invalid.", "text_invalid");
        if (typeof value === "string" && value.trim()) parts.push(value);
      }
      // Live ChatGPT's own thoughts are explicit entries, not generic nested
      // tool text. content is the full body; summary/chunks can repeat it.
      if (content.content_type === "thoughts") {
        if (!Array.isArray(content.thoughts)) throw blocked("An own thoughts turn is missing its thoughts array.", "text_invalid");
        for (const thought of content.thoughts) {
          if (typeof thought?.content !== "string") throw blocked("An own thought is missing its complete content string.", "text_invalid");
          // Some live thoughts expose only their visible summary (empty body).
          const value = thought.content.trim() ? thought.content : (typeof thought.summary === "string" && thought.summary.trim() ? thought.summary : "");
          if (value) {
            assertComplete(thought, "Own thought");
            parts.push(value);
          }
        }
      }
      if (role === "user") {
        const inlineParts = [...parts];
        const inlineCopies = new Map();
        const pastedIds = new Set();
        for (const file of Array.isArray(message.metadata?.attachments) ? message.metadata.attachments : []) {
          if (!isPlainTextPaste(file)) continue;
          const index = ++pastedAttachmentIndex;
          const skipFile = () => {
            const name = typeof file.name === "string" && file.name.trim() ? file.name : `Unnamed pasted text attachment ${index}`;
            if (!measureOnly && !/\.pdf$/i.test(name.trim())) skippedFiles.set(file.id || name, { name });
          };
          if (!measureOnly) {
            try { assertComplete(file, "Pasted text attachment"); }
            catch { excludedContentTypes.add("uploads"); skipFile(); continue; }
          }
          const pasted = Object.hasOwn(pastedTexts, file.id) ? pastedTexts[file.id] : null;
          if (measureOnly && typeof pasted !== "string") continue;
          if (typeof pasted !== "string" || !Number.isSafeInteger(file.size) || new TextEncoder().encode(pasted).length !== file.size) {
            excludedContentTypes.add("uploads");
            skipFile();
            continue;
          }
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
      if (parts.some(text => text.trim())) hasText = true;
      parts.push(...attachmentLabels);
      return parts.length ? [{ role, text: parts.join("\n\n") }] : [];
    });
    if (!hasText) throw blocked("No usable user or assistant text remains after skipping tools, files, images, and artifacts.", "missing_text");
    // Reasoning, canvas and Python result blocks belong to one assistant reply.
    // Keep every payload block intact; only the reported message count groups them.
    const messageTurnCount = turns.reduce((count, turn, index) => count +
      (turn.role === "assistant" && turns[index - 1]?.role === "assistant" ? 0 : 1), 0);
    const text = `ChatGPT conversation:\n\n${turns.map(turn => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`).join("\n\n")}`;
    metrics?.set({ selected_turns: messageTurnCount });
    if (metrics ? !metrics.transcript(text) : text.length > 1000000 || new TextEncoder().encode(text).length > 4000000) throw captureError("This chat is too long to transfer (limit: 1,000,000 characters). Try a shorter chat.", "size_limit");
    return { text, messages: turns, messageTurnCount, excludedContentTypes: [...excludedContentTypes].sort(),
      ...(captureWarning ? { captureWarning } : {}), ...(skippedFiles.size ? { skippedFiles: [...skippedFiles.values()] } : {}) };
  }

  function waitForHook(timeoutMs, install = false, signal, metrics) {
    const started = Date.now();
    debug("hook_wait", { wait_ms: timeoutMs, pending: install });
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
        debug("hook_done", { ok: ready, elapsed_ms: Date.now() - started, aborted: Boolean(signal?.aborted) });
        window.removeEventListener("message", receive); signal?.removeEventListener("abort", onAbort);
        resolve(ready);
      };
      const onAbort = () => finish(false);
      const receive = event => {
        const reply = event.data;
        if (event.source === window && event.origin === location.origin && reply?.channel === channel && reply.type === "pong" && reply.id === id
            && reply.version !== 27) metrics?.set({ hook_status: "version_mismatch" });
        if (event.source === window && event.origin === location.origin && reply?.channel === channel
          && reply.type === "pong" && reply.id === id) {
          debug("hook_reply", { observed_version: Number.isSafeInteger(reply.version) ? reply.version : 0 });
          if (reply.version === 27) finish(true);
        }
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
        debug("hook_install");
        // A busy/cold worker's reply can lag behind a working MAIN hook. Trust
        // the correlated pong, not the installation callback, as readiness proof.
        Promise.resolve().then(() => chrome.runtime.sendMessage({ type: "ENSURE_CHATGPT_JSON_HOOK" }))
          .then(reply => { if (!settled && !reply?.ok) { metrics?.set({ hook_status: "install_rejected" }); finish(false); } }, () => { if (!settled) { metrics?.set({ hook_status: "install_failed" }); finish(false); } });
      }
    });
  }

  window.__capCaptureChatGptJson = async (expectedPath = location.pathname, metrics, measureOnly = false, signal, onEstimate) => {
    const hookStarted = Date.now();
    const cancelledError = (stage = "hook") => measureOnly ? new Error("Size check cancelled.")
      : Object.assign(new Error("ChatGPT capture cancelled."), { diagnosticCode: "user_cancelled", captureDetail: "cancelled", captureRequestStage: stage });
    const chat = currentChat(expectedPath);
    metrics.set({ saved_chat: Boolean(chat) });
    if (!chat) { metrics.set({ route_reason: "path_unrecognized", route_found: false }); throw captureError("Open a saved ChatGPT conversation to use JSON capture.", "unavailable", "routing_unavailable", "hook"); }
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
      if (changed) throw captureError("The ChatGPT conversation changed during capture.", "request_failed", "conversation_changed", "hook");
      // Usually document_start already installed MAIN; don't wake/reinstall it
      // on every capture. Missing/older/replaced hooks get bounded recovery.
      metrics.set({ hook_ready: false, hook_status: "no_reply" });
      if (!await waitForHook(250, false, signal, metrics)) {
        if (signal?.aborted) throw cancelledError();
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) metrics.set({ hook_status: "runtime_missing" });
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage || !await waitForHook(8000, true, signal, metrics)) {
          if (signal?.aborted) throw cancelledError();
          throw captureError("Fast capture isn't ready yet. Refresh this chat and try again, or turn off the lightning button.", "unavailable", "hook_unavailable", "hook");
        }
      }
      if (signal?.aborted) throw cancelledError();
      metrics.set({ hook_ready: true, hook_status: "ready", hook_ms: Date.now() - hookStarted, adapter_version: 27 });
      if (changed || currentChat() !== chat) throw captureError("The ChatGPT conversation changed during capture.", "request_failed", "conversation_changed", "hook");
      metrics.checkpoint("route", "history");
      return await new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        // Await the native cancellation reply before releasing the shared read
        // queue; rejecting immediately could race a still-active old download.
        const onAbort = () => { debug("cancel", { measure: measureOnly }); window.postMessage({ channel, type: measureOnly ? "cancel_measurement" : "cancel_capture", id }, location.origin); };
        const cleanup = () => { clearTimeout(timer); window.removeEventListener("message", receive); signal?.removeEventListener("abort", onAbort); };
        const receive = event => {
          const reply = event.data;
          if (event.source !== window || event.origin !== location.origin || reply?.channel !== channel || !["response", "measurement_progress", "capture_progress"].includes(reply.type) || reply.id !== id) return;
          if (reply.type === "measurement_progress") {
            if (measureOnly && !signal?.aborted && !changed && currentChat() === chat && reply.chat === chat
                && Number.isSafeInteger(reply.messageTurnCount) && reply.messageTurnCount > 0
                && Number.isSafeInteger(reply.estimatedCharacterCount) && reply.estimatedCharacterCount >= 0) {
              try { onEstimate?.({ messageTurnCount: reply.messageTurnCount, estimatedCharacterCount: reply.estimatedCharacterCount }); } catch {}
            }
            return;
          }
          if (reply.type === "capture_progress") {
            if (!measureOnly && reply.chat === chat && !changed) metrics.adopt(reply.jsonCapture);
            return;
          }
          debug("bridge_reply", { elapsed_ms: Date.now() - hookStarted, aborted: Boolean(signal?.aborted) });
          cleanup();
          if (signal?.aborted) return reject(cancelledError("history"));
          metrics.adopt(reply.jsonCapture);
          try {
            if (changed || currentChat() !== chat || reply.chat !== chat) throw captureError("The ChatGPT conversation changed during capture.", "request_failed", "conversation_changed", "history");
            if (reply.error) {
              if (reply.error === "size") {
                const fileLimit = reply.captureDetail === "attachment_size_limit";
                throw captureError(fileLimit ? "Text attachments exceed the combined 4.1 MB capture limit." : "This chat is too long to transfer (limit: 1,000,000 characters). Try a shorter chat.",
                  "size_limit", fileLimit ? "attachment_size_limit" : "size_limit", fileLimit ? "attachment_descriptor" : "history");
              }
              const reasons = { auth: "ChatGPT authentication is unavailable. Refresh this signed-in chat.", partial: "ChatGPT returned incomplete, invalid or oversized JSON.", busy: "Another ChatGPT JSON capture is running. Try again after it finishes.", format: "ChatGPT returned a non-JSON response.", changed: "The ChatGPT conversation changed during capture.", timeout: "The full-tree request timed out.", network: "The full-tree request failed or returned invalid JSON." };
              reasons.paste = "A pasted text attachment could not be read completely. Refresh this chat and try again.";
              const reason = reply.error === "http" && Number.isInteger(reply.status) && reply.status >= 100 && reply.status <= 599 ? `The full-tree request returned HTTP ${reply.status}.` : reasons[reply.error] || "The full-tree request failed.";
              const failureReason = { auth: "unavailable", busy: "unavailable", partial: "incomplete", format: "incomplete", paste: "incomplete", timeout: "timeout" }[reply.error] || "request_failed";
              const detail = reply.captureDetail === "invalid_json" ? "invalid_json" : { auth: "auth_missing", busy: "busy", partial: "partial_response", format: "non_json_response", changed: "conversation_changed", timeout: "timeout", network: "network_error", http: "http_error", paste: "attachment_failed", invalid_json: "invalid_json" }[reply.error] || "network_error";
              const stage = ["session", "history", "attachment_descriptor", "attachment_body"].includes(reply.captureRequestStage) ? reply.captureRequestStage : "history";
              throw captureError(`ChatGPT JSON capture failed: ${reason} Turn JSON capture off to use DOM capture.`, failureReason, detail, stage, reply.status);
            }
            metrics.stage("serialize");
            try {
              debug("serialize_start");
              const capture = metrics.timed("serialize_ms", () => serialize(reply.data, chat, reply.pastedTexts, reply.sourceTreeCounts, metrics, measureOnly));
              debug("serialize_done", { chars: capture.text.length, turns: capture.messageTurnCount });
              resolve(capture);
            }
            catch (error) {
              if (!measureOnly) throw error;
              resolve(roughCaptureSize(reply.data));
            }
          } catch (error) { reject(error); }
        };
        const timer = setTimeout(() => { cleanup(); reject(captureError("ChatGPT JSON capture timed out. Refresh or turn JSON capture off.", "timeout", "timeout", "history")); }, 17000);
        signal?.addEventListener("abort", onAbort, { once: true });
        window.addEventListener("message", receive);
        debug("bridge_request", { measure: measureOnly });
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
  const readCapture = window.__capCaptureChatGptJson;
  window.__capMeasureChatGptJson = async (expectedPath, signal, onEstimate) => {
    const metrics = globalThis.CapJsonCaptureMetrics.create({ deadline_ms: 17000 });
    metrics.transcript = () => true;
    const capture = await readCapture(expectedPath, metrics, true, signal, onEstimate);
    return { characterCount: capture.text.length, messageTurnCount: capture.messageTurnCount,
      ...(capture.estimatedCharacterCount !== undefined ? { estimatedCharacterCount: capture.estimatedCharacterCount } : {}) };
  };
  window.__capCaptureChatGptJson = async (expectedPath, signal, onProgress) => {
    const metrics = globalThis.CapJsonCaptureMetrics.create({ deadline_ms: 17000 }, onProgress);
    metrics.stage("hook");
    try {
      const capture = await readCapture(expectedPath, metrics, false, signal);
      metrics.checkpoint("complete", "serialize", { history_checked: true });
      metrics.set({ selected_turns: capture.messageTurnCount });
      if (capture.captureWarning) metrics.set({ outcome: "partial", failure_check: "text_invalid", failure_stage: "serialize" });
      return { ...capture, jsonCapture: metrics.finish() };
    } catch (error) { error.jsonCapture = metrics.finish(error); throw error; }
  };
})();
