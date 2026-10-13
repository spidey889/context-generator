(() => {
  class CaptureError extends Error {
    constructor(reason, captureFailureReason = "incomplete", captureDetail = "incomplete_history") {
      super(reason);
      this.captureFailureReason = reason === "size" ? "size_limit" : captureFailureReason;
      this.captureDetail = reason === "size" ? "size_limit" : captureFailureReason === "unsupported" ? "unsupported_content" : captureDetail;
    }
  }
  const fail = (reason, captureFailureReason, detail) => { throw new CaptureError(reason, captureFailureReason, detail); };
  const complete = value => {
    if (!value || typeof value !== "object") return;
    for (const key of ["has_more", "has_next_page", "has_previous_page", "is_partial", "is_incomplete", "is_truncated", "partial", "truncated", "incomplete", "missing_messages", "next_cursor", "previous_cursor", "hasMore", "hasNextPage", "hasPreviousPage", "isPartial", "isIncomplete", "isTruncated", "missingMessages", "nextCursor", "previousCursor"]) {
      const flag = value[key];
      if (flag != null && flag !== false && flag !== 0 && flag !== "" && !(Array.isArray(flag) && !flag.length)) fail("Incomplete history was returned.");
    }
    // A textual false carries the same explicit warning as the boolean value.
    if ([value.is_complete, value.complete, value.isComplete].some(flag => flag === false
      || (typeof flag === "string" && flag.trim().toLowerCase() === "false"))) fail("Incomplete history was returned.");
  };
  const transcript = (name, turns, excludedContentTypes = new Set()) => {
    if (!turns.length) fail("No usable user or assistant text was found.", undefined, "missing_text");
    const text = `${name} conversation:\n\n${turns.map(turn => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`).join("\n\n")}`;
    if (text.length > 500000 || new TextEncoder().encode(text).length > 2000000) fail("size");
    return { text, messages: turns, messageTurnCount: turns.length, excludedContentTypes: [...excludedContentTypes].sort() };
  };
  const turn = (role, parts) => parts.filter(text => typeof text === "string" && text.trim()).length
    ? [{ role: role === "User" ? "user" : "assistant", text: parts.filter(text => typeof text === "string" && text.trim()).join("\n\n") }] : [];
  const chain = (items, leaf, idKey, parentKey, externalRoot = false) => {
    if (!Array.isArray(items) || !items.length) fail("The conversation history is missing.");
    const mapping = new Map();
    for (const item of items) {
      const id = item?.[idKey];
      if ((typeof id !== "string" && !Number.isSafeInteger(id)) || mapping.has(id) || (!externalRoot && !Object.hasOwn(item, parentKey))) fail("Invalid or duplicate message IDs were returned.", undefined, "invalid_branch");
      mapping.set(id, item);
    }
    let externalRootParent = null;
    if (externalRoot) {
      // Real native samples use an omitted UUIDv5 starting marker, while own
      // message IDs are UUIDv4. A missing ordinary parent is lost history, not
      // a synthetic root. Unknown marker shapes fail into normal capture.
      // The UUID shape is a compatibility guard, not proof of server completeness.
      // Keep selected nodes and human starting points in root checks. Broken
      // unused assistant replies must not invalidate the selected path; selected
      // orphan replies and genuinely competing human roots must still fail.
      const selectedIds = new Set();
      let selectedId = leaf;
      while (mapping.has(selectedId) && !selectedIds.has(selectedId)) {
        selectedIds.add(selectedId);
        selectedId = mapping.get(selectedId)[parentKey];
      }
      const rootItems = items.filter(item => item.sender === "human" || selectedIds.has(item[idKey]));
      const roots = rootItems.filter(item => Object.hasOwn(item, parentKey) && item[parentKey] !== null && !mapping.has(item[parentKey]));
      if (roots.length) {
        const parent = roots[0][parentKey];
        if (typeof parent !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parent)
          || rootItems.some(item => item[parentKey] === null)
          || roots.some(item => item.sender !== "human" || item[parentKey] !== parent)) {
          fail("A parent message is missing from the history.", undefined, "parent_missing");
        }
        externalRootParent = parent;
      }
    }
    const branch = [], seen = new Set();
    let id = leaf;
    while (true) {
      const item = mapping.get(id);
      if (!item || seen.has(id)) fail("A message is missing or the branch contains a cycle.", undefined, "branch_cycle");
      if (!Object.hasOwn(item, parentKey)) fail("A selected message has no parent field.", undefined, "parent_missing");
      seen.add(id); branch.push(item);
      const parent = item[parentKey];
      if (parent === null) break;
      if (externalRootParent !== null && parent === externalRootParent) break;
      if ((typeof parent !== "string" && !Number.isSafeInteger(parent)) || !mapping.has(parent)) fail("A parent message is missing from the history.", undefined, "parent_missing");
      id = parent;
    }
    return branch.reverse();
  };
  const geminiPage = body => {
    if (typeof body !== "string" || !body.startsWith(")]}'") || !body.endsWith("\n")) fail("Invalid or truncated Gemini RPC response.");
    const lines = body.slice(4).split("\n").filter(line => line.length);
    if (!lines.length || lines.length % 2) fail("A Gemini RPC frame is incomplete.");
    const rows = [];
    for (let i = 0; i < lines.length; i += 2) {
      // Native batchexecute lengths include the two terminating newlines and
      // count JavaScript characters, not UTF-8 bytes (verified with Unicode).
      if (!/^\d+$/.test(lines[i]) || Number(lines[i]) !== lines[i + 1].length + 2) fail("A Gemini RPC frame is incomplete.");
      const frame = JSON.parse(lines[i + 1]);
      if (!Array.isArray(frame)) fail("Invalid Gemini RPC frame.");
      rows.push(...frame);
    }
    const responses = rows.filter(row => row?.[0] === "wrb.fr" && row[1] === "hNvQHb");
    if (responses.length !== 1 || typeof responses[0][2] !== "string" || !rows.some(row => row?.[0] === "e")) fail("The Gemini history response is incomplete or failed.");
    const page = JSON.parse(responses[0][2]);
    if (!Array.isArray(page?.[0]) || (page[1] != null && (typeof page[1] !== "string" || !page[1]))) fail("Invalid Gemini history page.");
    return { turns: page[0], cursor: page[1] ?? null };
  };
  const gemini = (pages, chat) => {
    if (!Array.isArray(pages) || !pages.length || pages.at(-1).cursor !== null) fail("Gemini still has previous history pages.");
    const turns = [], seen = new Set();
    const excludedContentTypes = new Set();
    let expected = null, selectedParentCandidate = null;
    for (const page of pages) for (const item of page.turns) {
      if (!Array.isArray(item) || item[0]?.[0] !== `c_${chat}` || typeof item[0][1] !== "string" || seen.has(item[0][1])) fail("Gemini returned a wrong conversation or duplicate turn.", undefined, "invalid_branch");
      const id = item[0][1];
      if (seen.size && id !== expected) fail("A Gemini history turn is missing or out of order.", undefined, "invalid_branch");
      seen.add(id);
      if (item[1] !== null && (item[1]?.[0] !== `c_${chat}` || typeof item[1]?.[1] !== "string")) fail("Gemini returned an invalid parent turn.");
      const user = item[2]?.[0]?.[0];
      if (typeof user !== "string") fail("A Gemini user text field is missing or malformed.", undefined, "text_invalid");
      const userParts = [user];
      // hNvQHb user attachment slot: groups contain descriptors at [4], name at [2].
      // Read this slot only, never recursively collect strings from render/tool data.
      const groups = item[2]?.[0]?.[4];
      let unrecognizedMetadata = groups != null && !Array.isArray(groups);
      if (Array.isArray(groups)) for (const group of groups) {
        if (group == null) continue;
        if (!Array.isArray(group?.[4])) {
          if (!Array.isArray(group) || group.some(value => value != null)) unrecognizedMetadata = true;
          continue;
        }
        for (const file of group[4]) {
          if (file == null) continue;
          if (Array.isArray(file) && typeof file[1] === "number" && typeof file[2] === "string" && file[2].trim()) {
            userParts.push(`Attachment: ${JSON.stringify(file[2])}`);
            excludedContentTypes.add("uploads");
          } else unrecognizedMetadata = true;
        }
      }
      if (unrecognizedMetadata) {
        // This optional slot also carries context/media metadata. Unsupported
        // labels must not discard verified own text; keep unknown data excluded.
        // Without a prompt, that data could be the entire user input, so fallback
        // is still required rather than accepting a label/answer-only history.
        if (!user.trim()) fail("Gemini attachment labels have an unsupported shape.", "unsupported", "attachment_failed");
        excludedContentTypes.add("other");
      }
      const assistant = item[3];
      // The newest prompt can exist before Gemini has produced a response.
      // Preserve that prompt and its verified parents without waiting for text.
      if (seen.size === 1 && (assistant == null || (Array.isArray(assistant?.[0]) && !assistant[0].length))) {
        expected = item[1]?.[1] ?? null;
        selectedParentCandidate = item[1]?.[2] ?? null;
        if (selectedParentCandidate !== null && (typeof selectedParentCandidate !== "string" || !selectedParentCandidate)) fail("Gemini returned an invalid parent response.");
        turns.unshift(...turn("User", userParts));
        continue;
      }
      if (!Array.isArray(assistant?.[0]) || !assistant[0].length) fail("A Gemini response is missing or unfinished.");
      // hNvQHb often omits assistant[3]. The next chronological turn's parent
      // triple identifies the older candidate actually continued, even across
      // pages. For the newest reply, native candidate order supplies the current
      // response unless the optional explicit selection is present.
      const selected = selectedParentCandidate ?? (typeof assistant[3] === "string" ? assistant[3] : assistant[0][0]?.[0]);
      const matches = assistant[0].filter(candidate => candidate?.[0] === selected);
      const candidate = matches[0];
      if (typeof selected !== "string" || !selected || matches.length !== 1 || !Array.isArray(candidate[1])) fail("The selected Gemini response is missing.");
      expected = item[1]?.[1] ?? null;
      selectedParentCandidate = item[1]?.[2] ?? null;
      if (selectedParentCandidate !== null && (typeof selectedParentCandidate !== "string" || !selectedParentCandidate)) fail("Gemini returned an invalid parent response.");
      if (candidate[1].some(part => part != null && typeof part !== "string")) excludedContentTypes.add("other");
      // Only the selected response's own text; render blocks duplicate that
      // text and can contain search/tool payloads, so never walk them recursively.
      turns.unshift(...turn("User", userParts), ...turn("Assistant", candidate[1].filter(part => typeof part === "string")));
    }
    if (expected !== null || !seen.size) fail("Gemini's oldest history turn is missing.", undefined, "parent_missing");
    return transcript("Gemini", turns, excludedContentTypes);
  };
  const grokBranch = (data, selected) => {
    complete(data);
    if (!Array.isArray(data?.responseNodes) || !Array.isArray(data.inflightResponses)) fail("Grok history is missing.");
    if ([data.total_count, data.totalCount, data.totalResponses].some(count => count != null && (!Number.isSafeInteger(count) || count > data.responseNodes.length))) fail("Grok history has missing responses.");
    const parents = new Set(data.responseNodes.map(node => node.parentResponseId));
    const leaves = data.responseNodes.filter(node => !parents.has(node.responseId));
    const leaf = selected || (leaves.length === 1 ? leaves[0].responseId : null);
    if (!leaf) fail("The active Grok branch could not be identified.", undefined, "invalid_branch");
    return chain(data.responseNodes, leaf, "responseId", "parentResponseId", true);
  };
  const grok = (nodes, responses, selected) => {
    const branch = grokBranch(nodes, selected);
    if (!Array.isArray(responses)) fail("Grok message bodies are missing.");
    const mapping = new Map();
    const excludedContentTypes = new Set();
    for (const message of responses) {
      if (mapping.has(message?.responseId)) fail("Grok returned duplicate message bodies.", undefined, "invalid_branch");
      mapping.set(message?.responseId, message);
    }
    const turns = branch.flatMap(node => {
      const message = mapping.get(node.responseId);
      if (!message && node.sender === "assistant" && nodes.inflightResponses.some(reply => reply?.responseId === node.responseId)) return [];
      if (!message || message.sender !== node.sender || message.parentResponseId !== node.parentResponseId) fail("A Grok message body is missing or mismatched.");
      // An assistant's generation state is not a missing-history marker. Keep
      // its current own text, including a stopped reply, without polling it.
      if (message.sender === "assistant") { const { partial, ...metadata } = message; complete(metadata); }
      else complete(message);
      if (!["human", "assistant"].includes(message.sender) || message.isControl) return [];
      if ([message.fileAttachments, message.fileAttachmentsMetadata].some(files => Array.isArray(files) && files.length)) excludedContentTypes.add("uploads");
      if (Array.isArray(message.toolResponses) && message.toolResponses.length) excludedContentTypes.add("tools");
      if (message.sender === "assistant" && message.partial === true && message.message == null) return [];
      if (typeof message.message !== "string") fail("A Grok own-turn text field is missing.", undefined, "text_invalid");
      // File bodies are unsupported here. Do not accept an answer-only transcript
      // when its authored user turn consists solely of an attachment.
      if (message.sender === "human" && !message.message.trim() && [message.fileAttachments, message.fileAttachmentsMetadata].some(files => Array.isArray(files) && files.length)) fail("Grok has a file-only user turn that fast capture cannot read.", "unsupported");
      const parts = [message.message];
      if (message.sender === "human" && Array.isArray(message.fileAttachmentsMetadata)) {
        for (const file of message.fileAttachmentsMetadata) {
          if (typeof file?.fileName === "string" && file.fileName.trim()) parts.push(`Attachment: ${JSON.stringify(file.fileName)}`);
        }
      }
      return turn(message.sender === "human" ? "User" : "Assistant", parts);
    });
    return transcript("Grok", turns, excludedContentTypes);
  };
  const deepseekBranch = (data, chat) => {
    if (data?.code !== 0 || data.data?.biz_code !== 0) fail("DeepSeek could not load the conversation.");
    complete(data); complete(data.data);
    const history = data.data.biz_data;
    complete(history);
    complete(history?.pagination);
    complete(history?.chat_session);
    if (history?.chat_session?.id !== chat || history.cache_control !== "REPLACE") fail("DeepSeek returned a cache update instead of the full history.");
    return chain(history.chat_messages, history.chat_session.current_message_id, "message_id", "parent_id");
  };
  // DeepSeek accepts ordinary source/config/data uploads as well as .txt.
  // Keep binary/Office/PDF formats excluded; original UTF-8 and exact byte
  // counts are still verified by MAIN before any file text reaches the bridge.
  const textFile = file => file?.is_image === false && /\.(txt|md|markdown|csv|json|py|js|ts|tsx|jsx|java|kt|swift|c|h|cpp|hpp|cs|go|rs|rb|php|sh|bash|zsh|lua|r|scala|dart|html|htm|css|scss|vue|svelte|xml|yaml|yml|toml|tsv|sql|ipynb|log)$/i.test(file.file_name || "");
  // Keep descriptor discovery and serialization aligned for a single-file object.
  const fileList = value => Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  const deepseek = (data, chat, files = {}) => {
    const excludedContentTypes = new Set();
    const turns = deepseekBranch(data, chat).flatMap(message => {
      if (!["USER", "ASSISTANT"].includes(message.role)) return [];
      complete(message);
      // WIP/pending/continuing describe future generation, not missing parents.
      // The fresh REPLACE snapshot already contains the text available now.
      if (!Array.isArray(message.fragments)) fail("DeepSeek turn fragments are missing.");
      const parts = [];
      const fileIds = new Set();
      for (const fragment of message.fragments) {
        if ((message.role === "USER" && fragment.type === "REQUEST") || (message.role === "ASSISTANT" && ["RESPONSE", "THINK"].includes(fragment.type))) {
          if (fragment.content == null && message.role === "ASSISTANT"
            && (message.status === "WIP" || message.has_pending_fragment === true || message.auto_continue === true)) continue;
          complete(fragment);
          if (typeof fragment.content !== "string") fail("A DeepSeek own-turn text field is missing.", undefined, "text_invalid");
          parts.push(fragment.content);
        } else if (message.role === "USER" && fragment.type === "FILE") {
          for (const file of fileList(fragment.files)) {
            if (typeof file?.file_name === "string" && file.file_name.trim() && !fileIds.has(file.id)) parts.push(`Attachment: ${JSON.stringify(file.file_name)}`);
            if (!textFile(file)) { excludedContentTypes.add(file?.is_image === true ? "media" : "uploads"); continue; }
            complete(file);
            const text = Object.hasOwn(files, file.id) ? files[file.id] : null;
            if (file.status !== "SUCCESS" || typeof text !== "string" || new TextEncoder().encode(text).length !== file.file_size) fail("A DeepSeek text attachment is missing or incomplete.", undefined, "attachment_failed");
            // Identity, not text equality, identifies a repeated attachment.
            // The same file may legitimately appear again in another turn.
            if (!fileIds.has(file.id)) {
              fileIds.add(file.id);
              // Exact byte count plus a named end marker separates file data from
              // the next file/request, even for empty files or delimiter-like text.
              parts.push(`File contents (${file.file_size} UTF-8 bytes):\n${text}\nEnd attachment: ${JSON.stringify(file.file_name)}`);
            }
          }
        } else {
          excludedContentTypes.add(fragment.type === "TOOL" ? "tools" : "other");
        }
      }
      return turn(message.role === "USER" ? "User" : "Assistant", parts);
    });
    return transcript("DeepSeek", turns, excludedContentTypes);
  };
  globalThis.__capNetworkJsonData = { CaptureError, complete, geminiPage, gemini, grokBranch, grok, deepseekBranch, deepseek, textFile, fileList };
})();
