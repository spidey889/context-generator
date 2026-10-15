// One shared existing fixture, one generation per model, no retries or judge calls.
// This small screen is separate from the complete CapContextBench v1 levels.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const Module = require('node:module');
const { createGuardedFetch } = require('../../scripts/openrouter-test-budget.cjs');
// Reuse the actual private delivery helper instead of repairing malformed model
// output more generously than production. This only compiles an in-memory copy.
const backendFile = require.resolve('../../api/summarize.js');
const backendModule = new Module(backendFile, module);
backendModule.filename = backendFile;
backendModule.paths = Module._nodeModulePaths(path.dirname(backendFile));
backendModule._compile(fs.readFileSync(backendFile, 'utf8') + '\nmodule.exports.__test.appendDestinationConfirmation = appendDestinationConfirmation;', backendFile);
const backend = backendModule.exports.__test;
const { SUMMARY_PROMPT_CACHE_VERSION } = require('../../api/summary-prompt.js');
const root = path.resolve(__dirname, '../..');
const output = path.join(__dirname, 'baselines/2026-10-15-small-screen/generations.json');
const testCase = require('../handoff-quality-cases.json').cases.find(c => c.id === 'corrected-export-design');
const hash = value => createHash('sha256').update(value).digest('hex');
const system = backend.getSummarySystemPrompt(backend.getSummaryProfile(testCase.conversation));
const messages = [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ conversation: testCase.conversation }) }];
function delivered(raw) {
  const validation = backend.validateContextCarrySummary(raw, backend.getSummaryProfile(testCase.conversation));
  return validation.ok ? backend.normalizeContextCarrySummary(raw) : backend.appendDestinationConfirmation(raw);
}
const plan = [
  { name: 'Haiku 5.5', model: 'claude-haiku-5.5:free', provider: 'tokenharbor' },
  { name: 'DeepSeek V4.1 Flash', model: 'deepseek-v4.1-flash:free', provider: 'tokenharbor' },
  { name: 'MiMo V2.6 Flash', model: 'mimo-v2.6-flash:free', provider: 'tokenharbor' },
  { name: 'Dots3 Note Preview', model: 'dots-studio/dots-3-note-preview:free', provider: 'openrouter' }
];
async function main() {
  const provider = process.argv[2];
  if (provider === 'postprocess') {
    const report = JSON.parse(fs.readFileSync(output, 'utf8'));
    if (report.inputSha256 !== hash(testCase.conversation) || report.systemPromptSha256 !== hash(system)) throw Error('Frozen input/prompt changed');
    for (const row of report.results) if (row.rawSummary) row.summary = delivered(row.rawSummary);
    report.runnerSha256 = hash(fs.readFileSync(__filename));
    report.backendSha256 = hash(fs.readFileSync(backendFile));
    report.latencyDefinition = 'Elapsed non-streaming HTTP request through complete JSON response; excludes offline delivery normalization and review. One observation, not a median.';
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log('Reapplied exact production delivery processing offline; zero requests.'); return;
  }
  if (!['openrouter', 'tokenharbor'].includes(provider)) throw Error('Choose openrouter or tokenharbor explicitly');
  // Accept an ephemeral key through masked stdin so it never enters shell args
  // or a credential file. The process exits after this bounded run.
  let key = provider === 'tokenharbor' ? process.env.TOKENHARBOR_API_KEY : process.env.CAP_CONTEXT_SCREEN_OPENROUTER_KEY;
  if (provider === 'tokenharbor' && process.argv.includes('--key-stdin')) {
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    console.log('Waiting for ephemeral credential on masked stdin');
    key = await new Promise(resolve => {
      let value = '';
      function read(chunk) {
        value += chunk.toString('utf8');
        if (!/[\r\n]/.test(value)) return;
        process.stdin.removeListener('data', read);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(value.split(/[\r\n]/)[0].trim());
      }
      process.stdin.on('data', read); process.stdin.resume();
    });
  }
  if (!key) throw Error('Dedicated benchmark credential unavailable');
  const url = provider === 'tokenharbor' ? 'https://tokenharbor.ai/v1/chat/completions' : 'https://openrouter.ai/api/v1/chat/completions';
  let request = fetch;
  if (provider === 'openrouter') {
    if (!process.env.CAP_CONTEXT_TEST_LEDGER_PATH) throw Error('Missing dedicated test-key ledger');
    request = createGuardedFetch(fetch, { key, ledgerPath: process.env.CAP_CONTEXT_TEST_LEDGER_PATH, slot: 'test-b' });
  } else {
    // Only currently advertised free campaign routes are eligible. No paid alias.
    const response = await fetch('https://tokenharbor.ai/v1/models', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error(`Catalog HTTP ${response.status}`);
    const catalog = await response.json();
    const advertised = new Set((catalog.data || []).map(item => item.id));
    for (const item of plan.filter(item => item.provider === provider)) {
      if (!advertised.has(item.model)) throw Error(`Missing advertised free route: ${item.model}`);
    }
  }
  const inputHash = hash(testCase.conversation), promptHash = hash(system);
  let report = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : {
    name: 'CapContextBench small screen', date: '2026-10-15', syntheticOnly: true,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    caseId: testCase.id, case: testCase, inputChars: testCase.conversation.length,
    systemPromptChars: system.length, inputSha256: inputHash, systemPromptSha256: promptHash,
    promptVersion: SUMMARY_PROMPT_CACHE_VERSION, systemPrompt: system, requestCountLimit: 4,
    settings: { temperature: 0.1, maxTokens: null, retries: 0, streaming: false },
    caveat: 'One synthetic case per model; not the complete v1 suite or a reliability estimate. Provider labels are unverified gateway claims.',
    results: []
  };
  if (report.inputSha256 !== inputHash || report.systemPromptSha256 !== promptHash) throw Error('Frozen input/prompt changed');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  for (const item of plan.filter(item => item.provider === provider)) {
    if (report.results.some(r => r.model === item.model)) { console.log(`${item.name}: already attempted; skipping`); continue; }
    if (report.results.length >= 4) throw Error('Request cap reached');
    const row = { ...item, attempt: 1, status: 'reserved' };
    report.results.push(row);
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    const body = { model: item.model, messages, temperature: 0.1, stream: false };
    if (provider === 'openrouter') Object.assign(body, {
      plugins: [{ id: 'context-compression', enabled: false }], reasoning: { enabled: false, exclude: true },
      provider: { require_parameters: true, data_collection: 'deny', max_price: { prompt: 0, completion: 0, request: 0 } }
    });
    const start = performance.now();
    try {
      const response = await request(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
      row.httpStatus = response.status;
      const data = await response.json();
      row.elapsedMs = Math.round(performance.now() - start);
      if (!response.ok || data.error) {
        row.status = 'unavailable'; row.errorCode = typeof data.error?.code === 'string' ? data.error.code.slice(0, 100) : `http_${response.status}`;
      } else {
        row.servedModel = data.model || null; row.finishReason = data.choices?.[0]?.finish_reason || null;
        row.usage = data.usage || null;
        row.rawSummary = data.choices?.[0]?.message?.content || '';
        // The same backend normalization is applied to every generated output.
        row.summary = row.rawSummary ? delivered(row.rawSummary) : '';
        row.status = row.rawSummary.trim() ? 'generated' : 'empty';
      }
    } catch (error) { row.status = 'request_failed'; row.errorCode = error.name; row.elapsedMs = Math.round(performance.now() - start); }
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
    console.log(`${row.name}: ${row.status}; ${row.elapsedMs}ms; output tokens=${row.usage?.completion_tokens ?? 'unavailable'}`);
  }
  console.log(`Saved ${report.results.length}/4 attempts; input=${report.inputChars} chars; system=${report.systemPromptChars} chars`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
