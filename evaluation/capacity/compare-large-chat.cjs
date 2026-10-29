// Offline comparison for the synthetic Harbor Atlas single/chunk experiments.
// Coverage and review flags are separate: finding keywords does not prove truth.
const fs = require('node:fs');
const path = require('node:path');
const { assess } = require('./dots-500k.cjs');

function section(summary, title, next) {
  return summary.split(new RegExp(title, 'i'))[1]?.split(new RegExp(next, 'i'))[0] || '';
}

function scoreSummary(summary) {
  const coverage = assess(summary);
  const states = {
    proposalOnly: /\bproposal\s+only\b/i.test(summary),
    retryUndecided: /\bretry[^\n.!?]{0,100}\b(?:undecided|no selection|not selected)\b/i.test(summary)
      || /\b(?:undecided|no selected)\s+retry\s+policy\b/i.test(summary),
    testsUnreported: /\btest(?:ing|s)\b[^\n.!?]{0,80}\b(?:not reported|unreported)\b/i.test(summary)
      || /\bno code changes, testing, or deployment reported\b/i.test(summary),
    ownerNotUser: /\bno\b[^\n.!?]{0,65}\b(?:identity|link)\b[^\n.!?]{0,65}\b(?:account|user|identity)\b/i.test(summary),
    firstStep: /\bfirst\s+explain\b/i.test(summary) && /\bsibling\b/i.test(summary),
    noDeployment: /\bdo not deploy\b|\bdeployment\s+(?:is\s+)?not approved\b|\bno deployment approved\b/i.test(summary)
  };
  const reviewFlags = [];
  const openQuestions = section(summary, 'OPEN QUESTIONS', 'KEY CONTEXT|NEXT STEP');
  const identity = section(summary, 'WHO I AM', 'WHAT WE WERE DOING');
  if (/\bAT-\d+\b/.test(openQuestions)) reviewFlags.push('archive_reference_in_open_questions');
  if (/\bno\s+(?:implementation,\s*)?testing(?:,\s*(?:or|and)\s+deployment)?\s+approval\b/i.test(summary))
    reviewFlags.push('testing_approval_not_established_by_source');
  if (summary.includes('--data "{"fixture":"large-export"}"')) reviewFlags.push('curl_json_quotes_lost');
  if (/Mira Sen/.test(identity) && !/\b(?:no|not|unlinked)\b/i.test(identity)) reviewFlags.push('owner_may_be_mistaken_for_user');
  if (/\b(?:tests? were never run|never tested|tests? were not run)\b/i.test(summary)) reviewFlags.push('unreported_testing_may_be_claimed_not_run');
  return {
    coverage: { passed: Object.keys(coverage.checks).length - coverage.missing.length,
      total: Object.keys(coverage.checks).length, missing: coverage.missing },
    explicitStates: { passed: Object.values(states).filter(Boolean).length, total: Object.keys(states).length,
      missing: Object.keys(states).filter(key => !states[key]) },
    reviewFlags,
    // A quoted hostile marker is allowed; humans still check whether it was obeyed.
    manualReviewRequired: coverage.manualReviewRequired,
    automaticChecksAreLexical: true
  };
}

function scoreRun(report, summary) {
  const completed = (report.generated === true || report.succeeded === true)
    && (!report.finishReason || report.finishReason === 'stop') && !report.error && !report.providerError;
  return {
    completed, model: report.model || null, inputChars: report.inputChars ?? report.chars ?? null,
    inputSha256: report.inputSha256 || null,
    requests: Array.isArray(report.requests) ? report.requests.length : null,
    elapsedMs: report.elapsedMs ?? null,
    // Never score a stale summary file beside a failed run as a completed result.
    summary: completed && typeof summary === 'string' && summary.trim() ? scoreSummary(summary) : null,
    missingSummary: completed && !(typeof summary === 'string' && summary.trim()),
    failed: !completed
  };
}

function compare(single, chunks) {
  const knownSizes = Number.isSafeInteger(single.inputChars) && single.inputChars > 0
    && Number.isSafeInteger(chunks.inputChars) && chunks.inputChars > 0;
  const sameInput = single.inputSha256 && chunks.inputSha256 && knownSizes
    ? single.inputSha256 === chunks.inputSha256 && single.inputChars === chunks.inputChars : null;
  const sameModel = single.model && chunks.model ? single.model === chunks.model : null;
  return { single, chunks, sameInput, sameModel,
    comparable: sameInput === true && sameModel === true && Boolean(single.summary && chunks.summary),
    reviewNotes: [
      'Unknown or mismatched input hashes do not establish an identical-input comparison.',
      'Review caching, deadlines and provider variation before comparing speed.',
      'This sparse synthetic fixture and lexical checks do not establish general summary quality.'
    ] };
}

function readRun(filename) {
  if (!filename.endsWith('-report.json')) throw new Error('Use a *-report.json file with its matching *-summary.txt.');
  const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const summaryPath = filename.replace(/-report\.json$/, '-summary.txt');
  return scoreRun(report, fs.existsSync(summaryPath) ? fs.readFileSync(summaryPath, 'utf8') : null);
}

if (require.main === module) {
  try {
    const [singlePath, chunksPath, outputPath] = process.argv.slice(2);
    if (!singlePath || !chunksPath || process.argv.length > 5)
      throw new Error('Usage: node evaluation/capacity/compare-large-chat.cjs SINGLE-report.json CHUNKS-report.json [NEW-output.json]');
    const result = compare(readRun(singlePath), readRun(chunksPath));
    const json = JSON.stringify(result, null, 2) + '\n';
    if (outputPath) fs.writeFileSync(path.resolve(outputPath), json, { flag: 'wx' });
    process.stdout.write(json);
    if (!result.comparable) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { scoreSummary, scoreRun, compare };
