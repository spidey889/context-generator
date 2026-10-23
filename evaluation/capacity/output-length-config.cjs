// Test-only evidence and prompt variants. Production prompt files stay untouched.
const assert = require('node:assert/strict');
const flatten = messages => `ChatGPT conversation:\n\n${messages.map(turn => `${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`).join('\n\n')}`;

function makeDenseFixture(base) {
  const messages = base.messages.filter(turn => !turn.text.startsWith('Final historical reference'));
  const latest = messages.pop();
  const cases = [];
  const phases = ['descriptor request', 'first chunk upload', 'second chunk upload', 'response validation', 'progress callback', 'temporary-file cleanup', 'retry wait', 'source cancellation'];
  const witnesses = ['cancel_requested -> sibling_settled -> cleanup_started', 'sibling_rejected -> cancel_requested -> sibling_settled', 'cancel_requested -> reader_closed -> sibling_settled'];
  const additions = [];
  additions.push({ role: 'user', text: 'The following 80 cancellation cases are CURRENT supporting evidence for the Harbor Atlas proposal. Preserve every case ID, fixture path, test path and exact log line in the handoff, with the trigger, expected ordering, observed ordering and scope. The next assistant needs this material to review the pending proposal. These are supplied baseline observations, not results of testing the proposed patch. Keep the older AT reference discussions separate.' });
  for (let n = 1; n <= 80; n++) {
    const id = `HC-${String(n).padStart(3, '0')}`;
    const record = { id, fixture: `fixtures/cancellation/case-${String(n).padStart(3, '0')}.json`, test: `test/cancellation/case-${String(n).padStart(3, '0')}.test.mjs`, log: `${id}: cancellation observed during ${phases[(n - 1) % phases.length]}` };
    cases.push(record);
    additions.push({ role: 'user', text: `${id} baseline evidence. Fixture: ${record.fixture}. Test: ${record.test}. Exact log: "${record.log}". Trigger: the user cancels during ${phases[(n - 1) % phases.length]}, after checkpoint ${n + 100} has been acknowledged but before checkpoint ${n + 101}. Expected ordering: request sibling cancellation, await settlement of both uploads, close readers, then delete temporary files. Observed ordering in the supplied baseline trace: ${witnesses[(n - 1) % witnesses.length]}. The fixture's cleanup marker is CLEANUP_${n + 700}; its retained diagnostic marker is TRACE_${n + 900}. These observations concern only this named fixture and do not establish the proposed patch's behavior. The source does not report why the timing differs between fixtures. Keep the two-upload/10 MiB decision, undecided retry options, and no-edit/no-deploy restrictions unchanged. Do not infer that the proposed patch was implemented or that its tests passed.` });
  }
  // Spread active evidence through the history, then remove complete archive
  // turns to keep exactly the same input size without clipping any evidence.
  const inserted = [];
  let cursor = 0;
  for (const [index, turn] of messages.entries()) {
    inserted.push(turn);
    if (index > 0 && index % 9 === 0 && cursor < additions.length) inserted.push(additions[cursor++]);
  }
  inserted.push(...additions.slice(cursor));
  while (flatten([...inserted, latest]).length > base.conversation.length - 2000) {
    const index = inserted.findIndex(turn => /^(?:Reference review AT-|Review AT-)/.test(turn.text));
    assert.ok(index >= 0, 'Dense evidence exceeds the input allowance');
    inserted.splice(index, 1);
  }
  const prefix = 'Historical reference remainder: ';
  const remaining = base.conversation.length - flatten(inserted).length - '\n\nAssistant: '.length - prefix.length - '\n\nUser: '.length - latest.text.length;
  assert.ok(remaining >= 0);
  const sentence = 'This archived example supplies no new active-task requirement. ';
  inserted.push({ role: 'assistant', text: prefix + sentence.repeat(Math.ceil(remaining / sentence.length)).slice(0, remaining) }, latest);
  const conversation = flatten(inserted);
  assert.equal(conversation.length, base.conversation.length);
  assert.equal(cases.length, 80);
  return { ...base, messages: inserted, conversation, cases, anchors: undefined, fixtureType: 'dense-active-evidence' };
}

function getLengthSpec(mode) {
  assert.ok(['current', '3000', '6000', 'detail-first'].includes(mode));
  if (mode === 'current') return { mode, requestedMinWords: null, promptOverride: null };
  if (mode === 'detail-first') return { mode, requestedMinWords: null, targetWords: 4500, maxTokens: 16000,
    promptOverride: '- Write a detailed handoff aiming for about 4,000–5,000 words when supported, with no mandatory word floor. Preserve all 80 CURRENT cancellation evidence records in KEY CONTEXT: each exact case ID, exact fixture path, exact test path, exact log line, trigger/checkpoints, expected ordering, observed ordering, diagnostic markers and limited result scope. Give each case one factual entry. Keep the incident facts, current configuration, proposed comment, permissions and pending request. NEVER enumerate AT archive references or include their IDs; they are unrelated and explicitly excluded. Do not invent facts, repeat material to fill a quota or discuss this length instruction. Once HC-080 and the other essential active facts are included, immediately write the fixed NEXT STEP section and STOP. A complete accurate handoff is preferable to adding words after the required evidence. Use the seven headings exactly once and preserve the required boxed header.' };
  const minimum = Number(mode);
  return { mode, requestedMinWords: minimum, targetWords: minimum + 500, maxTokens: minimum === 3000 ? 10000 : 16000,
    promptOverride: `- For this diagnostic handoff, write ${minimum.toLocaleString('en-US')} to ${(minimum + 1000).toLocaleString('en-US')} words. This is a required minimum of ${minimum.toLocaleString('en-US')} words, not a short-summary allowance. Do not finish after an overview. The transcript supplies 80 active cancellation evidence cases that the user explicitly needs carried forward. Preserve every case's ID, exact fixture path, exact test path and exact log, plus its trigger/checkpoints, expected ordering, observed ordering, diagnostic markers and limited result scope. Put this evidence in KEY CONTEXT with one substantial entry per case. Use the other sections for their supported subjects. WHO I AM may remain None and NEXT STEP must remain the fixed confirmation; put additional supported detail in KEY CONTEXT rather than inventing identity or open questions. Before ending, privately estimate length and restore omitted source evidence until the required minimum is reached. Do not print the count, repeat facts as padding, invent reasons/results, answer the pending task, or carry irrelevant AT archive discussions. Keep all seven template headings exactly once.` };
}

function expandPrompt(original, profile, spec) {
  if (!spec.promptOverride) return original;
  const old = `- Use concise factual bullets and near-verbatim wording. The ${profile.id} allowance of about ${profile.targetWords} words is guidance, not a minimum. No section has a word or bullet quota. A long chat can need a short handoff. Do not pad or repeat facts; accuracy and constraint coverage come first.`;
  assert.ok(original.includes(old), 'The production length instruction changed; inspect before running');
  return original.replace(old, spec.promptOverride);
}

function assessCases(summary, cases = []) {
  return { caseCount: cases.length,
    idsMissing: cases.filter(item => !summary.includes(item.id)).map(item => item.id),
    fixturesMissing: cases.filter(item => !summary.includes(item.fixture)).map(item => item.id),
    testsMissing: cases.filter(item => !summary.includes(item.test)).map(item => item.id),
    exactLogsMissing: cases.filter(item => !summary.includes(item.log)).map(item => item.id) };
}

module.exports = { makeDenseFixture, getLengthSpec, expandPrompt, assessCases };
