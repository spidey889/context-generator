// Archive ranks are the recorded manual judgment, not invented percentages.
// Keep the historical cohort separate from CapContextBench v1 scores.
const fs = require("node:fs");
const path = require("node:path");
const bench = require("./bench.cjs");
const root = path.resolve(__dirname, "../..");
const archivePath = "evaluation/results/2026-10-03-openrouter-primary.json";
const reviewPath = "docs/openrouter-primary-comparison.md";
const read = file => fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
const archiveSource = read(archivePath), reviewSource = read(reviewPath);
const archive = JSON.parse(archiveSource);
const definitions = [
  [1, "Space Bunny 2", "inclusionai/ling-3.1-flash", "Ling 3.1 Flash", "Best preservation; some invented identity and questions remain."],
  [2, "Apodex 1.1 Mini", "apodex/apodex-1.1-mini:free", "Apodex 1.1 Mini", "Fast responses; invents ownership and extra requirements."],
  [3, "Dots3 Note Preview", "dots-studio/dots-3-note-preview:free", "Dots3-Note Preview", "Changes unresolved retry choices and invents acceptance."],
  [4, "Qwen3.8 27B", "qwen/qwen3.8-27b:free", "Qwen3.8 27B", "Invents causes and identity; weakens explicit prohibitions."],
  [null, "Gemma 4 26B A4B", "google/gemma-4-26b-a4b-it:free", "Gemma 4 26B A4B", "Unscored: all five attempts returned HTTP 429."]
];
function check(condition, message) { if (!condition) throw new Error(message); }
const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null;
};
check(archive.sourceCommit === "0605f265c0960f6892a878479a9c723e1d68e0cf" && archive.method.settingsChanged === false, "Archive snapshot/contract changed; review comparability first");
const inputHashes = new Set(archive.fixtures.map(item => item.sha256));
check(inputHashes.size === 3 && archive.runs.every(item => inputHashes.has(item.inputSha256)), "Archive includes unmatched cases");
const rows = definitions.map(([rank, name, model, recordedName, note]) => {
  check(reviewSource.split("\n").some(line => line.startsWith(`| ${rank ?? "Unranked for accuracy"} | ${recordedName} |`)), "Recorded ranking changed; do not silently retain the old order");
  const attempts = archive.runs.map((result, index) => ({ ...result, index })).filter(result => result.candidate === model);
  const generated = attempts.filter(result => result.model === model && typeof result.summary === "string" && result.summary.length > 0);
  check(new Set(attempts.map(item => item.inputSha256)).size === 3, "Model lacks a shared archive case");
  if (rank === null) check(attempts.length === 5 && generated.length === 0 && attempts.every(item => item.httpStatuses?.includes(429)), "Unscored-model availability evidence changed");
  return { rank, name, model, note, attempts: attempts.length, generated: generated.length,
    resultIndices: attempts.map(item => item.index),
    medianElapsedMs: median(generated.map(item => item.elapsedMs)),
    medianCompletionTokens: median(generated.map(item => item.usage?.completionTokens)) };
});
check(rows.reduce((sum, row) => sum + row.attempts, 0) === archive.runs.length, "An archive attempt was omitted");
check(archive.runs.length === 20 && rows.reduce((sum, row) => sum + row.generated, 0) === 15, "Unexpected archive counts");
const v1ReviewPath = "evaluation/capcontext-bench/baselines/2026-10-07-dots/review.json";
const v1 = bench.readReview(path.join(root, v1ReviewPath));
const latest = ["candidate", "baseline"].map(variant => {
  const results = v1.report.results.filter(result => result.variant === variant && result.generated);
  const grades = results.map(result => v1.grades.get(bench.hash(v1.reportSha256 + `${result.caseId}:${result.repeat}:${variant}`).slice(0, 20)));
  const expected = v1.fixture.cases.length * v1.report.repeats;
  check(results.length === expected && grades.every(Boolean), "Latest run has incomplete generation/review; do not publish its score");
  const passed = grades.filter(grade => ["continuity", "fidelity", "grounding", "structure"].every(key => grade[key])).length;
  return { model: v1.report.model, prompt: variant, label: variant === "candidate" ? "Candidate prompt · v19" : "Master prompt", passed, total: expected, scorePercent: 100 * passed / expected };
});
const data = { title: "CapContextBench", asOf: "2026-10-07",
  archive: { date: "2026-10-03", metric: "Recorded qualitative rank by factual usefulness", sourceCommit: archive.sourceCommit,
    sources: [{ path: archivePath, sha256: bench.hash(archiveSource) }, { path: reviewPath, sha256: bench.hash(reviewSource) }],
    cases: archive.fixtures, attempts: archive.runs.length, generated: 15, rows,
    limitations: "Three synthetic conversations, uneven retained repeats, one recorded manual review. Historical prompts; no general accuracy percentage. Latency is descriptive, not a controlled speed ranking. Gemma is unscored, not last for quality." },
  latest: { date: "2026-10-07", benchmark: v1.fixture.benchmark, source: v1ReviewPath, reportSha256: v1.reportSha256,
    reviewer: v1.reviewer, limitations: v1.reviewLimit, rows: latest },
  interpretation: "Archive ordinal ranks and v1 handoff percentages use different prompts/cases. Do not combine them or claim a current cross-model v1 winner. No new provider calls were made." };
const output = path.join(__dirname, "model-ranking.json");
fs.writeFileSync(output, bench.json(data));
console.log(`Exported ${rows.filter(row => row.rank).length} historical ranks, one unscored model and two separate v1 prompt scores: ${output}`);
