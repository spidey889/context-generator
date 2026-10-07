// Manual only. Reuse the production comparison path; never call a provider here.
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { parseArgs } = require("node:util");
const { withLongHistory } = require("../../scripts/compare-summary-prompts");
const { CONTEXT_CARRY_BOX_HEADER, DESTINATION_CONFIRMATION_INSTRUCTION } = require("../../api/summary-prompt");
const root = path.resolve(__dirname, "../..");
const suitePath = path.join(__dirname, "suite.json");
const hash = value => createHash("sha256").update(value).digest("hex");
const json = value => JSON.stringify(value, null, 2) + "\n";
const dimensions = ["continuity", "fidelity", "grounding", "structure"];
const headings = ["🧠 WHO I AM", "🎯 WHAT WE WERE DOING", "📍 WHERE WE LEFT OFF", "✅ DECISIONS MADE", "⚠️ OPEN QUESTIONS", "📦 KEY CONTEXT", "🔁 NEXT STEP"];
function invariant(condition, message) { if (!condition) throw new Error(message); }

function loadSuite() {
  const source = fs.readFileSync(suitePath, "utf8").replace(/\r\n/g, "\n"), suite = JSON.parse(source);
  const sources = new Map();
  const cases = suite.cases.map(spec => {
    if (!sources.has(spec.source)) sources.set(spec.source, fs.readFileSync(path.join(root, spec.source), "utf8").replace(/\r\n/g, "\n"));
    const fixture = JSON.parse(sources.get(spec.source));
    invariant(fixture.syntheticOnly === true, "Only synthetic source fixtures are allowed");
    const base = fixture.cases.find(item => item.id === spec.id);
    invariant(base, `Missing source case: ${spec.id}`);
    const exactText = [...(spec.exactText || [])];
    if (spec.exactCriticalFact !== undefined) {
      const text = base.criticalFacts[spec.exactCriticalFact];
      invariant(typeof text === "string", "Exact payload must be a source string");
      exactText.push(text);
    }
    invariant(exactText.every(text => base.conversation.includes(text)), `Gold payload absent from source: ${spec.id}`);
    invariant(["1", "2", "3"].includes(spec.level) && ["continuity", "fidelity", "grounding"].every(key => spec.expectations[key]), "Incomplete case rubric");
    const testCase = spec.targetChars ? withLongHistory(base, spec.targetChars) : { ...base };
    invariant(testCase.conversation.length > 1200, "Bench cases must exercise generation, not tiny local carry");
    return { ...testCase, benchmark: { level: spec.level, expectations: spec.expectations, exactText } };
  });
  invariant(new Set(cases.map(item => item.id)).size === cases.length, "Duplicate benchmark case");
  // Fingerprint both the rubric and source bytes. Never compare a changed case
  // under an old dataset identity or silently retune gold after seeing outputs.
  const suiteSha256 = hash(source + [...sources].map(([file, bytes]) => file + hash(bytes)).join(""));
  return { suite, cases, suiteSha256 };
}

function fixtureFor(level = "1") {
  const { suite, cases, suiteSha256 } = loadSuite();
  invariant(level === "all" || suite.levels[level], "Level must be 1, 2, 3 or all");
  return { version: 1, syntheticOnly: true, benchmark: { name: suite.name, version: suite.version, level, suiteSha256 },
    reviewCriteria: ["Can the next assistant continue the pending task?", "Are essential facts, corrections and constraints faithful?", "Is every claim supported by its source/status?", "Does the delivered handoff retain the seven sections and trusted confirmation?"],
    cases: cases.filter(item => level === "all" || item.benchmark.level === level) };
}

function loadRun(file) {
  // Normalize file line endings, not escaped payload characters inside JSON.
  // Git's Windows conversion must not invalidate an otherwise identical review.
  const reportPath = path.resolve(file), bytes = fs.readFileSync(reportPath, "utf8").replace(/\r\n/g, "\n"), report = JSON.parse(bytes);
  invariant(report.syntheticOnly === true && /^[a-f0-9]{40}$/.test(report.baselineRef) && /^[a-f0-9]{64}$/.test(report.candidatePromptSourceSha256) && /^[a-f0-9]{64}$/.test(report.comparisonRunnerSha256), "Missing synthetic/prompt/runner provenance");
  invariant(Number.isInteger(report.repeats) && report.repeats >= 1 && report.repeats <= 3, "Invalid repeat count");
  const fixture = ["1", "2", "3", "all"].map(fixtureFor).find(item => hash(json(item)) === report.fixtureSha256);
  invariant(fixture, "Report fixture does not match this benchmark version; retain the matching suite snapshot");
  invariant(JSON.stringify(report.selectedCases) === JSON.stringify(fixture.cases.map(item => item.id)), "Selected cases differ from the frozen benchmark fixture");
  const seen = new Set(), cases = new Map(fixture.cases.map(item => [item.id, item]));
  for (const result of report.results) {
    const testCase = cases.get(result.caseId), key = resultKey(result);
    invariant(testCase && ["baseline", "candidate"].includes(result.variant) && Number.isInteger(result.repeat) && result.repeat >= 1 && result.repeat <= report.repeats && !seen.has(key), "Unknown/duplicate result");
    seen.add(key);
    if (result.inputSha256) invariant(result.inputSha256 === hash(testCase.conversation), "Result input does not match source");
    if (result.generated) invariant(result.model === report.model && typeof result.summary === "string" && result.inputSha256 && /^[a-f0-9]{64}$/.test(result.systemPromptSha256) && Number.isFinite(result.maxTokens), "Invalid generated-result provenance");
    else invariant(result.assessment == null, "Unavailable results must remain ungraded");
  }
  for (const result of report.results) {
    const partner = report.results.find(item => item.caseId === result.caseId && item.repeat === result.repeat && item.variant !== result.variant);
    if (partner?.generated && result.generated) invariant(partner.inputSha256 === result.inputSha256 && partner.maxTokens === result.maxTokens && partner.profile === result.profile, "Pair has different input or output allowance");
  }
  return { reportPath, report, reportSha256: hash(bytes), fixture, cases };
}
const resultKey = result => `${result.caseId}:${result.repeat}:${result.variant}`;
const reviewId = (run, result) => hash(run.reportSha256 + resultKey(result)).slice(0, 20);

function automaticChecks(summary, testCase) {
  const text = summary.replace(/\r\n/g, "\n"), lines = text.split("\n");
  const positions = headings.map(heading => lines.indexOf(heading));
  const structure = text.startsWith(CONTEXT_CARRY_BOX_HEADER + "\n") && positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1]) && lines.filter(line => line === headings[index]).length === 1)
    && text.slice(text.lastIndexOf(headings.at(-1)) + headings.at(-1).length).trim() === DESTINATION_CONFIRMATION_INSTRUCTION;
  // Literal matching is justified only for text explicitly required verbatim.
  // General facts and negated/rejected statements need semantic source review.
  const missingExactText = testCase.benchmark.exactText.filter(value => !text.includes(value));
  return { structure, missingExactText };
}

function makeReview(run, reviewPath) {
  return { benchmark: run.fixture.benchmark, reportPath: path.relative(path.dirname(path.resolve(reviewPath)), run.reportPath), reportSha256: run.reportSha256,
    instructions: "Read source and full summary. Set sourceReviewed=true. For each semantic dimension set pass=true/false and cite specific source/output evidence even for a pass. IDs conceal prompt variant; do not edit source/summary/rubric. Auto checks are diagnostic, not semantic grades.",
    entries: run.report.results.filter(item => item.generated).map(result => {
      const testCase = run.cases.get(result.caseId);
      return { id: reviewId(run, result), caseId: result.caseId, source: testCase.conversation, summary: result.summary,
        expectations: testCase.benchmark.expectations, automatic: automaticChecks(result.summary, testCase), sourceReviewed: false,
        judgments: Object.fromEntries(dimensions.slice(0, 3).map(key => [key, { pass: null, evidence: "" }])) };
    }).sort((a, b) => a.id.localeCompare(b.id)) };
}

function readReview(file) {
  const reviewPath = path.resolve(file), review = JSON.parse(fs.readFileSync(reviewPath, "utf8"));
  const run = loadRun(path.resolve(path.dirname(reviewPath), review.reportPath));
  invariant(review.reportSha256 === run.reportSha256, "Report changed after review; create a new review");
  const expected = makeReview(run, reviewPath), entries = new Map(review.entries.map(entry => [entry.id, entry]));
  invariant(entries.size === review.entries.length && entries.size === expected.entries.length && expected.entries.every(entry => entries.has(entry.id)), "Missing, extra or duplicate review entry");
  const grades = new Map();
  for (const original of expected.entries) {
    const entry = entries.get(original.id);
    invariant(["caseId", "source", "summary", "expectations", "automatic"].every(key => JSON.stringify(entry[key]) === JSON.stringify(original[key])), "Source/output/rubric changed inside review");
    const reviewed = entry.sourceReviewed === true && dimensions.slice(0, 3).every(key => typeof entry.judgments?.[key]?.pass === "boolean" && typeof entry.judgments[key].evidence === "string" && entry.judgments[key].evidence.trim().length > 0);
    if (!reviewed) continue;
    grades.set(entry.id, { continuity: entry.judgments.continuity.pass,
      fidelity: entry.judgments.fidelity.pass && entry.automatic.missingExactText.length === 0,
      grounding: entry.judgments.grounding.pass, structure: entry.automatic.structure });
  }
  return { ...run, reviewPath, grades, reviewer: typeof review.reviewer === "string" ? review.reviewer : "unspecified",
    reviewLimit: typeof review.reviewLimit === "string" ? review.reviewLimit : "" };
}

const median = values => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2 : null;
};
const percent = (passed, count) => count ? `${Math.round(100 * passed / count)}% (${passed}/${count})` : "—";

function scoreReviews(files) {
  const runs = files.map(readReview), reportHashes = new Set(), cohorts = new Map();
  for (const run of runs) {
    invariant(!reportHashes.has(run.reportSha256), "The same generation report cannot count twice");
    reportHashes.add(run.reportSha256);
    const { report, fixture } = run;
    const cohortKey = JSON.stringify([fixture.benchmark, report.baselineRef, report.candidatePromptSourceSha256, report.comparisonRunnerSha256, report.repeats]);
    if (!cohorts.has(cohortKey)) cohorts.set(cohortKey, { fixture, policies: new Map(), runs: [] });
    const cohort = cohorts.get(cohortKey);
    for (const result of report.results.filter(item => item.generated)) {
      const key = `${result.variant}:${result.caseId}`, policy = JSON.stringify([result.systemPromptSha256, result.profile, result.maxTokens]);
      invariant(!cohort.policies.has(key) || cohort.policies.get(key) === policy, "Models have different prompts/profiles/output allowances; compare them separately");
      cohort.policies.set(key, policy);
    }
    cohort.runs.push(run);
  }
  const output = ["# CapContextBench v1", "", "Manual source-reviewed handoffs; rates include every retained repeat. Availability and review coverage are separate from quality. Unreviewed/partial runs have no final score. Compare models only inside the same cohort and level.", ""];
  for (const [key, cohort] of cohorts) {
    output.push(`## Cohort ${hash(key).slice(0, 12)} — selected level ${cohort.fixture.benchmark.level}`, "", `Baseline: ${cohort.runs[0].report.baselineRef}. Candidate source: ${cohort.runs[0].report.candidatePromptSourceSha256}. Repeats per run: ${cohort.runs[0].report.repeats}.`, "");
    const rows = new Map();
    for (const run of cohort.runs) for (const variant of ["baseline", "candidate"]) for (const level of [...new Set(run.fixture.cases.map(item => item.benchmark.level))]) {
      const rowKey = `${run.report.model}:${variant}:${level}`;
      if (!rows.has(rowKey)) rows.set(rowKey, { model: run.report.model, variant, level, expected: 0, attempts: 0, generated: [], grades: [] });
      const row = rows.get(rowKey), caseIds = new Set(run.fixture.cases.filter(item => item.benchmark.level === level).map(item => item.id));
      row.expected += caseIds.size * run.report.repeats;
      const results = run.report.results.filter(item => item.variant === variant && caseIds.has(item.caseId));
      row.attempts += results.length;
      for (const result of results.filter(item => item.generated)) {
        row.generated.push(result);
        const grade = run.grades.get(reviewId(run, result));
        if (grade) row.grades.push(grade);
      }
    }
    output.push("| Model | Prompt | Level | Generated/planned | Reviewed/generated | Handoff pass | Continuity | Fidelity | Grounding | Structure | Median ms | Median output tokens | Result |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const row of rows.values()) {
      const complete = row.generated.length === row.expected && row.grades.length === row.generated.length;
      const passed = row.grades.filter(grade => dimensions.every(dimension => grade[dimension])).length;
      const result = complete ? (passed === row.expected ? "PASS" : "QUALITY FAIL") : row.generated.length !== row.expected ? "UNAVAILABLE / INCOMPLETE" : "NEEDS REVIEW";
      const rate = key => complete ? percent(row.grades.filter(grade => grade[key]).length, row.grades.length) : "pending";
      output.push(`| ${row.model} | ${row.variant} | ${row.level} | ${row.generated.length}/${row.expected} (${row.attempts} attempted) | ${row.grades.length}/${row.generated.length} | ${complete ? percent(passed, row.expected) : "pending"} | ${dimensions.map(rate).join(" | ")} | ${median(row.generated.map(item => item.elapsedMs)) ?? "—"} | ${median(row.generated.map(item => item.usage?.completionTokens)) ?? "—"} | ${result} |`);
    }
    output.push("", "### Matched failure patterns", "", "Counts concern complete, reviewed pairs only. Shared failure means both prompts failed that dimension; it does not prove a purely model-only cause. Candidate-only failures are comparative warnings, not statistical proof from a tiny sample.", "", "| Model | Case | Dimension | Pairs reviewed | Both fail | Master only fails | Candidate only fails | Both pass |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    const pairs = new Map();
    for (const run of cohort.runs) for (const testCase of run.fixture.cases) for (const dimension of dimensions) {
      const key = `${run.report.model}:${testCase.id}:${dimension}`;
      if (!pairs.has(key)) pairs.set(key, { model: run.report.model, caseId: testCase.id, dimension, counts: [0, 0, 0, 0] });
      const pair = pairs.get(key);
      for (let repeat = 1; repeat <= run.report.repeats; repeat++) {
        const results = ["baseline", "candidate"].map(variant => run.report.results.find(item => item.caseId === testCase.id && item.repeat === repeat && item.variant === variant));
        const grades = results.map(result => result?.generated ? run.grades.get(reviewId(run, result)) : null);
        if (grades.every(Boolean)) pair.counts[(grades[0][dimension] ? 2 : 0) + (grades[1][dimension] ? 1 : 0)]++;
      }
    }
    for (const pair of pairs.values()) output.push(`| ${pair.model} | ${pair.caseId} | ${pair.dimension} | ${pair.counts.reduce((a, b) => a + b, 0)} | ${pair.counts[0]} | ${pair.counts[1]} | ${pair.counts[2]} | ${pair.counts[3]} |`);
    output.push("", "Sources:", "", ...cohort.runs.flatMap(run => [
      `- Review: ${path.relative(root, run.reviewPath)}; report SHA-256: ${run.reportSha256}`,
      `- Reviewer: ${run.reviewer}${run.reviewLimit ? `. Limit: ${run.reviewLimit}` : ""}`
    ]), "");
  }
  return output.join("\n").trimEnd();
}

function writeFresh(file, text) {
  invariant(file, "An output path is required");
  const target = path.resolve(file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, text, { flag: "wx" });
  console.log(`Saved: ${target}`);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { level: { type: "string", default: "1" }, out: { type: "string" } } });
  if (command === "prepare") {
    invariant(positionals.length === 0, "prepare accepts --level and --out");
    const fixture = fixtureFor(values.level);
    writeFresh(values.out, json(fixture));
    console.log(`${fixture.cases.length} cases; ${fixture.cases.length * 2} requests for one model/master-candidate repeat. Repeat twice to investigate a failure. No network calls made.`);
  } else if (command === "review") {
    invariant(positionals.length === 1, "review requires one generation report and --out");
    const run = loadRun(positionals[0]);
    writeFresh(values.out, json(makeReview(run, values.out)));
  } else if (command === "score") {
    invariant(positionals.length > 0, "score requires one or more review files");
    const text = scoreReviews(positionals);
    if (values.out) writeFresh(values.out, text + "\n"); else console.log(text);
  } else throw new Error("Use prepare --level 1|2|3|all --out FILE, review REPORT --out FILE, or score REVIEW... [--out FILE]");
}
if (require.main === module) {
  try { main(); } catch (error) { console.error(`CapContextBench: ${error.message}`); process.exitCode = 1; }
}
module.exports = { loadSuite, fixtureFor, loadRun, automaticChecks, makeReview, readReview, scoreReviews, hash, json };
