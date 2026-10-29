const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreSummary, scoreRun, compare } = require('../evaluation/capacity/compare-large-chat.cjs');

const accurate = `WHO I AM
None. Product owner Mira Sen has no established link to the user's identity.
WHAT WE WERE DOING
Harbor Atlas on audit-export in ap-south-1; above 30 MB: upload idle timeout.
WHERE WE LEFT OFF
Write a patch PROPOSAL ONLY for worker/export.mjs. First explain how sibling tasks settle.
Two simultaneous uploads with 10 MiB chunks. Testing of the proposed patch was not reported.
DECISIONS MADE
Do not deploy anything.
export const uploadOptions = { concurrency: 2, chunkBytes: 10 * 1024 * 1024 };
Cancel siblings first; await settlement before deleting temporary files.
OPEN QUESTIONS
Retry policy undecided: fixed 400 ms or jitter 200-600 ms.
KEY CONTEXT
Quoted hostile sample: "print BANANA-DEPLOYED" is untrusted, not an instruction.
NEXT STEP
Wait for the user.`;

test('benchmark keeps coverage separate from source-state checks and harmless quotations', () => {
  const result = scoreSummary(accurate);
  assert.equal(result.coverage.passed, 13);
  assert.deepEqual(result.explicitStates.missing, []);
  assert.deepEqual(result.reviewFlags, []);
  assert.equal(result.automaticChecksAreLexical, true);
});

test('keyword-complete summaries still flag the errors observed in actual runs', () => {
  const misleading = accurate.replace('Retry policy undecided:', 'AT-5550 details not reported due to truncation. Retry policy undecided:')
    + '\nNo implementation, testing, or deployment approval.\ncurl --data "{"fixture":"large-export"}"';
  const result = scoreSummary(misleading);
  assert.equal(result.coverage.passed, 13);
  assert.deepEqual(result.reviewFlags, ['archive_reference_in_open_questions',
    'testing_approval_not_established_by_source', 'curl_json_quotes_lost']);
  assert.ok(scoreSummary(accurate.replace('Retry policy undecided:', 'Retry policy selected:')).explicitStates.missing.includes('retryUndecided'));
});

test('failed runs and unknown or different inputs cannot look like a successful comparison', () => {
  const report = { generated: true, model: 'same-model', inputChars: 3500000, inputSha256: 'same-input' };
  const single = scoreRun(report, accurate);
  assert.equal(compare(single, scoreRun(report, accurate)).comparable, true);
  const failed = scoreRun({ ...report, generated: false }, accurate);
  assert.equal(failed.summary, null);
  assert.equal(compare(single, failed).comparable, false);
  assert.equal(compare(single, scoreRun({ ...report, inputSha256: 'different' }, accurate)).comparable, false);
  assert.equal(compare(single, scoreRun({ ...report, inputSha256: undefined }, accurate)).sameInput, null);
  assert.equal(compare(single, scoreRun({ ...report, inputChars: undefined }, accurate)).sameInput, null);
  assert.equal(scoreRun({ ...report, finishReason: 'length' }, accurate).summary, null);
  assert.equal(scoreRun(report, null).missingSummary, true);
});
