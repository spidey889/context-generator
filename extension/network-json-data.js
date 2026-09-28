(() => {
  class CaptureError extends Error {}
  const fail = reason => { throw new CaptureError(reason); };
  const complete = value => {
    if (!value || typeof value !== "object") return;
    for (const key of ["has_more", "has_next_page", "has_previous_page", "is_partial", "is_incomplete", "is_truncated", "partial", "truncated", "incomplete", "missing_messages", "next_cursor", "previous_cursor", "hasMore", "hasNextPage", "hasPreviousPage", "isPartial", "isIncomplete", "isTruncated", "missingMessages", "nextCursor", "previousCursor"]) {
      const flag = value[key];
      if (flag != null && flag !== false && flag !== 0 && flag !== "" && !(Array.isArray(flag) && !flag.length)) fail("Incomplete history was returned.");
    }
    if (value.is_complete === false || value.complete === false || value.isComplete === false) fail("Incomplete history was returned.");
  };
  const transcript = (name, turns) => {
    if (!turns.length) fail("No usable user or assistant text was found.");
    const text = `${name} conversation:\n\n${turns.join("\n\n")}`;
    if (text.length > 350000 || new TextEncoder().encode(text).length > 1400000) fail("size");
    return { text, messageTurnCount: turns.length };
  };
  const turn = (role, parts) => parts.filter(text => typeof text === "string" && text.trim()).length
    ? [`${role}: ${parts.filter(text => typeof text === "string" && text.trim()).join("\n\n")}`] : [];
  const chain = (items, leaf, idKey, parentKey, externalRoot = false) => {
    if (!Array.isArray(items) || !items.length) fail("The conversation history is missing.");
    const mapping = new Map();
    for (const item of items) {
      const id = item?.[idKey];
      if ((typeof id !== "string" && !Number.isSafeInteger(id)) || mapping.has(id) || !Object.hasOwn(item, parentKey)) fail("Invalid or duplicate message IDs were returned.");
      mapping.set(id, item);
    }
    const branch = [], seen = new Set();
    let id = leaf;
    while (true) {
      const item = mapping.get(id);
      if (!item || seen.has(id)) fail("A message is missing or the branch contains a cycle.");
      seen.add(id); branch.push(item);
      const parent = item[parentKey];
      if (parent === null) break;
      // Grok's first human node points at a synthetic root absent from the
      // response tree. All other parents must be real returned nodes.
      if (externalRoot && !mapping.has(parent) && item === items[0] && item.sender === "human" && typeof parent === "string" && parent) break;
      if ((typeof parent !== "string" && !Number.isSafeInteger(parent)) || !mapping.has(parent)) fail("A parent message is missing from the history.");
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
    let expected = null;
    for (const page of pages) for (const item of page.turns) {
      if (!Array.isArray(item) || item[0]?.[0] !== `c_${chat}` || typeof item[0][1] !== "string" || seen.has(item[0][1])) fail("Gemini returned a wrong conversation or duplicate turn.");
      const id = item[0][1];
      if (seen.size && id !== expected) fail("A Gemini history turn is missing or out of order.");
      seen.add(id);
      if (item[1] !== null && (item[1]?.[0] !== `c_${chat}` || typeof item[1]?.[1] !== "string")) fail("Gemini returned an invalid parent turn.");
      expected = item[1]?.[1] ?? null;
      const user = item[2]?.[0]?.[0];
      const assistant = item[3];
      if (!Array.isArray(assistant?.[0]) || typeof assistant[3] !== "string") fail("A Gemini response is missing or unfinished.");
      const candidate = assistant[0].find(candidate => candidate?.[0] === assistant[3]);
      if (!candidate || !Array.isArray(candidate[1])) fail("The selected Gemini response is missing.");
      // Only the selected response's own text; render blocks duplicate that
      // text and can contain search/tool payloads, so never walk them recursively.
      turns.unshift(...turn("User", [user]), ...turn("Assistant", candidate[1].filter(part => typeof part === "string")));
    }
    if (expected !== null || !seen.size) fail("Gemini's oldest history turn is missing.");
    return transcript("Gemini", turns);
  };
  const grokBranch = (data, selected) => {
    complete(data);
    if (!Array.isArray(data?.responseNodes) || !Array.isArray(data.inflightResponses) || data.inflightResponses.length) fail("Grok history is missing or a response is still in progress.");
    if ([data.total_count, data.totalCount, data.totalResponses].some(count => count != null && (!Number.isSafeInteger(count) || count > data.responseNodes.length))) fail("Grok history has missing responses.");
    const parents = new Set(data.responseNodes.map(node => node.parentResponseId));
    const leaves = data.responseNodes.filter(node => !parents.has(node.responseId));
    const leaf = selected || (leaves.length === 1 ? leaves[0].responseId : null);
    if (!leaf) fail("The active Grok branch could not be identified.");
    return chain(data.responseNodes, leaf, "responseId", "parentResponseId", true);
  };
  const grok = (nodes, responses, selected) => {
    const branch = grokBranch(nodes, selected);
    if (!Array.isArray(responses)) fail("Grok message bodies are missing.");
    const mapping = new Map();
    for (const message of responses) {
      if (mapping.has(message?.responseId)) fail("Grok returned duplicate message bodies.");
      mapping.set(message?.responseId, message);
    }
    const turns = branch.flatMap(node => {
      const message = mapping.get(node.responseId);
      if (!message || message.sender !== node.sender || message.parentResponseId !== node.parentResponseId) fail("A Grok message body is missing or mismatched.");
      complete(message);
      if (message.partial === true || message.streamErrors?.length) fail("A Grok response is incomplete.");
      if (!["human", "assistant"].includes(message.sender) || message.isControl) return [];
      if (typeof message.message !== "string") fail("A Grok own-turn text field is missing.");
      return turn(message.sender === "human" ? "User" : "Assistant", [message.message]);
    });
    return transcript("Grok", turns);
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
  const deepseek = (data, chat, files = {}) => {
    const turns = deepseekBranch(data, chat).flatMap(message => {
      if (!["USER", "ASSISTANT"].includes(message.role)) return [];
      complete(message);
      if (message.status !== "FINISHED" || message.incomplete_message != null || message.has_pending_fragment || message.auto_continue) fail("A DeepSeek turn is unfinished or incomplete.");
      if (!Array.isArray(message.fragments)) fail("DeepSeek turn fragments are missing.");
      const parts = [];
      for (const fragment of message.fragments) {
        if ((message.role === "USER" && fragment.type === "REQUEST") || (message.role === "ASSISTANT" && ["RESPONSE", "THINK"].includes(fragment.type))) {
          complete(fragment);
          if (typeof fragment.content !== "string") fail("A DeepSeek own-turn text field is missing.");
          parts.push(fragment.content);
        } else if (message.role === "USER" && fragment.type === "FILE") {
          for (const file of Array.isArray(fragment.files) ? fragment.files : []) {
            if (!textFile(file)) continue;
            complete(file);
            const text = Object.hasOwn(files, file.id) ? files[file.id] : null;
            if (file.status !== "SUCCESS" || typeof text !== "string" || new TextEncoder().encode(text).length !== file.file_size) fail("A DeepSeek text attachment is missing or incomplete.");
            if (text.trim() && !parts.includes(text)) parts.push(text);
          }
        }
      }
      return turn(message.role === "USER" ? "User" : "Assistant", parts);
    });
    return transcript("DeepSeek", turns);
  };
  globalThis.__capNetworkJsonData = { CaptureError, complete, geminiPage, gemini, grokBranch, grok, deepseekBranch, deepseek, textFile };
})();
