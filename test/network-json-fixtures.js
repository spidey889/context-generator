// Sanitized shapes from native Gemini/Grok/DeepSeek histories, shared with the
// installed-extension smoke. No private conversation text or credentials.
const paste = `NETWORK_PASTE_START\r\n${"  Original Unicode line — 世界\r\n".repeat(600)}NETWORK_PASTE_MIDDLE\r\n${"  Original final line\r\n".repeat(600)}NETWORK_PASTE_END`;
const document = `NETWORK_DOCUMENT_START\n${"  Long authored document/code line\n".repeat(500)}NETWORK_DOCUMENT_END`;
const prompt = `SMOKE_USER_SENTINEL: preserve the deployment checklist.\nJSON_ONLY_SENTINEL: earliest API-only turn.\n${paste}`;
const answer = `SMOKE_ASSISTANT_SENTINEL: verify staging before release.\n${document}`;
const geminiTurn = (i, chat = "smoke", user = `User ${i}`, assistant = `Assistant ${i}`) => {
  const result = []; result[0] = [[`rc_${i}`, [assistant]]]; result[3] = `rc_${i}`; result[9] = true;
  return [[`c_${chat}`, `r_${i}`], i ? [`c_${chat}`, `r_${i - 1}`, `rc_${i - 1}`] : null, [[user]], result, [1, 0]];
};
const rpcFrame = page => {
  const frame = JSON.stringify([["wrb.fr", "hNvQHb", JSON.stringify([page.turns, page.cursor, null, []]), null, null, null, "generic"]]);
  const end = JSON.stringify([["e", 4, null, null, 1]]);
  return `)]}'\n\n${frame.length + 2}\n${frame}\n\n${end.length + 2}\n${end}\n\n`;
};
function fixtures(platform, chat = "smoke", count = 24) {
  const turns = Array.from({ length: count }, (_, i) => [i ? `User ${i}` : prompt, i === count - 1 ? answer : `Assistant ${i}`]);
  if (["gemini", "grok"].includes(platform) && count > 1) {
    // Exact source whitespace must survive the installed transfer boundary.
    turns[1][0] += "\n  Original pasted line  \r\n";
    turns[1][1] += '  \n  print("a\u00a0b")  \n';
  }
  if (platform === "deepseek") turns[0][0] += '\n  print("a\u00a0b")  \r\nSOURCE_CODE_END';
  const name = { gemini: "Gemini", grok: "Grok", deepseek: "DeepSeek" }[platform];
  let expected = `${name} conversation:\n\n${turns.flatMap(([user, assistant]) => [`User: ${user}`, `Assistant: ${assistant}`]).join("\n\n")}`;
  if (platform === "gemini") {
    const reverse = turns.map(([user, assistant], i) => geminiTurn(i, chat, user, assistant)).reverse();
    const pages = [];
    for (let i = 0; i < reverse.length; i += 10) pages.push({ turns: reverse.slice(i, i + 10), cursor: i + 10 < reverse.length ? `PAGE_${pages.length + 1}` : null });
    return { pages, expected };
  }
  if (platform === "grok") {
    const responses = turns.flatMap(([user, assistant], i) => [
      { responseId: `user_${i}`, parentResponseId: i ? `answer_${i - 1}` : "external-root", sender: "human", message: user, partial: false, inputChunks: [], fileAttachments: [] },
      { responseId: `answer_${i}`, parentResponseId: `user_${i}`, sender: "assistant", message: assistant, partial: false, outputChunks: [], toolResponses: [{ text: "TOOL_SENTINEL" }] }
    ]);
    return { nodes: { responseNodes: responses.map(({ responseId, parentResponseId, sender }) => ({ responseId, parentResponseId, sender })), inflightResponses: [] }, responses, expected };
  }
  const upload = turns[0][0];
  const file = { id: "file-test-paste", file_name: "Original source.py", file_size: Buffer.byteLength(upload), is_image: false, status: "SUCCESS", signed_path: "/file?file_id=test-paste&sig=SIGNED_SENTINEL" };
  expected = expected.replace(`User: ${upload}`, `User: Attachment: "Original source.py"\n\nFile contents (${file.file_size} UTF-8 bytes):\n${upload}\nEnd attachment: "Original source.py"\n\nAttachment: "ignored.png"`);
  const messages = turns.flatMap(([user, assistant], i) => [
    { message_id: i * 2 + 1, parent_id: i ? i * 2 : null, role: "USER", status: "FINISHED", incomplete_message: null, has_pending_fragment: false, auto_continue: false, fragments: i ? [{ type: "REQUEST", content: user }] : [{ type: "FILE", files: [file] }, { type: "FILE", files: [{ is_image: true, file_name: "ignored.png", signed_path: "/DO_NOT_FETCH_IMAGE" }] }] },
    { message_id: i * 2 + 2, parent_id: i * 2 + 1, role: "ASSISTANT", status: "FINISHED", incomplete_message: null, has_pending_fragment: false, auto_continue: false, fragments: [{ type: "RESPONSE", content: assistant }, { type: "TOOL", content: "TOOL_SENTINEL" }] }
  ]);
  return { data: { code: 0, data: { biz_code: 0, biz_data: { chat_session: { id: chat, current_message_id: count * 2 }, chat_messages: messages, cache_control: "REPLACE" } } }, files: { [file.id]: upload }, file, expected };
}
module.exports = { fixtures, rpcFrame, geminiTurn, paste, document, prompt, answer };
