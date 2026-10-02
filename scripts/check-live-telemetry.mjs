// Explicit deployment probe: writes synthetic metadata to the selected backend.
// The output manifest identifies ONLY these fixtures for owner-side inspection
// and cleanup; never delete historical events or reset production counters.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createSummaryProof } from '../supabase/functions/_shared/summary-proof.mjs';

const base = process.argv[2];
const output = process.argv[3];
assert.ok(base && output, 'Usage: node scripts/check-live-telemetry.mjs https://backend /temporary/fixture-manifest.json');
assert.ok(/^https:\/\//.test(base) || /^http:\/\/127\.0\.0\.1/.test(base));
const install = randomUUID();
const fixtures = [];
const headers = { 'Content-Type': 'application/json', 'X-Cap-Context-Client': 'cap-context-extension/1' };
let checks = 0;
const equal = (actual, expected) => { assert.equal(actual, expected); checks++; };
async function post(path, body, extraHeaders = {}) {
  const res = await fetch(`${base.replace(/\/$/, '')}${path}`, {
    method: 'POST', headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(path === '/api/summarize' ? 320000 : 15000)
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { throw new Error(`Probe received invalid JSON (HTTP ${res.status})`); }
  return { status: res.status, json };
}
function context(label) {
  const row = {
    attempt_id: randomUUID(), install_id: install, attempted_at: new Date().toISOString(),
    source_platform: 'claude', destination_platform: 'chatgpt', character_count: 52,
    status: 'started', last_stage: 'summary_request_started', failure_reason: null, extension_version: '1.4.6'
  };
  fixtures.push({ label, attempt_id: row.attempt_id });
  return row;
}
async function save() {
  await writeFile(output, JSON.stringify({ install_id: install, fixtures, checks }, null, 2));
}
async function summary(row, remote = false) {
  const conversation = remote
    ? 'USER: We are auditing a context transfer app. Keep the existing database rows and first terminal outcomes.\nASSISTANT: We will check migrations, privileges, offline delivery and verified counts.\n'.repeat(12)
    : 'USER: Preserve database rows.\nASSISTANT: Verify first.';
  const res = await post('/api/summarize', { conversation, telemetry: row });
  equal(res.status, 200);
  assert.ok(typeof res.json?.summary === 'string' && res.json.summary.length > 0); checks++;
  assert.match(res.json.summaryProof, /^[0-9a-f]{64}$/); checks++;
  assert.match(res.json.summaryProofV2, /^[0-9a-f]{64}$/); checks++;
  assert.ok(Number.isFinite(Date.parse(res.json.summaryConfirmedAt))); checks++;
  return res.json;
}
try {
  const normal = context('verified_v2_success');
  await save();
  equal((await post('/api/telemetry', normal)).status, 204);
  const receipt = await summary(normal, true);
  const signed = { ...normal, summary_proof: receipt.summaryProofV2, summary_confirmed_at: receipt.summaryConfirmedAt };
  equal((await post('/api/telemetry', { ...signed, last_stage: 'summary_completed' })).status, 204);
  const terminal = { ...signed, status: 'succeeded', last_stage: 'completed', completed_at: new Date().toISOString() };
  for (const res of await Promise.all(Array.from({ length: 4 }, () => post('/api/telemetry', terminal)))) equal(res.status, 204);
  equal((await post('/api/telemetry', { ...terminal, status: 'failed', last_stage: 'paste_started', failure_reason: 'paste_failed' })).status, 204);
  equal((await post('/api/telemetry', { ...terminal, extension_version: '1.4.7', summary_proof: undefined, summary_confirmed_at: undefined })).status, 204);
  const mismatch = await post('/api/telemetry', { ...terminal, install_id: randomUUID(), summary_proof: undefined, summary_confirmed_at: undefined });
  equal(mismatch.status, 422); equal(mismatch.json.code, 'attempt_identity_mismatch');
  const badProof = await post('/api/telemetry', { ...terminal, summary_proof: '0'.repeat(64) });
  equal(badProof.status, 422); equal(badProof.json.code, 'invalid_summary_proof');
  equal((await post('/api/telemetry', { ...terminal, character_count: -1 })).status, 400);
  equal((await post('/api/telemetry', { ...terminal, conversation: 'must never be persisted' })).status, 400);

  const forged = context('unsigned_success'); await save();
  equal((await post('/api/telemetry', { ...forged, status: 'succeeded', last_stage: 'completed' })).status, 204);
  const legacy = context('verified_v1_unknown_day'); await save();
  const v1 = await summary(legacy);
  equal((await post('/api/telemetry', { ...legacy, status: 'succeeded', last_stage: 'completed', summary_proof: v1.summaryProof })).status, 204);
  const failed = context('verified_v2_failed_paste'); await save();
  const failedReceipt = await summary(failed);
  equal((await post('/api/telemetry', { ...failed, status: 'failed', last_stage: 'paste_started', failure_reason: 'paste_failed',
    completed_at: new Date().toISOString(), summary_proof: failedReceipt.summaryProofV2, summary_confirmed_at: failedReceipt.summaryConfirmedAt })).status, 204);

  // An owner-side signed yesterday fixture tests delayed delivery's UTC attribution.
  if (process.env.TELEMETRY_SIGNING_KEY) {
    const delayed = context('verified_v2_yesterday'); await save();
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const timed = { ...delayed, summary_confirmed_at: yesterday };
    equal((await post('/api/telemetry', { ...timed, status: 'succeeded', last_stage: 'completed',
      summary_proof: await createSummaryProof(timed, process.env.TELEMETRY_SIGNING_KEY) })).status, 204);
  }
  if (process.env.TELEMETRY_EDGE_URL) {
    const res = await fetch(process.env.TELEMETRY_EDGE_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(normal), signal: AbortSignal.timeout(15000)
    });
    equal(res.status, 401);
  }
  await save();
  console.log(`PASS: ${checks} live HTTP checks; verify ${fixtures.length} isolated metadata fixtures using the private manifest.`);
} catch (error) {
  await save();
  console.error(`FAIL: live telemetry probe (${error.code || error.message}). Fixture manifest retained for inspection/cleanup.`);
  process.exitCode = 1;
}
