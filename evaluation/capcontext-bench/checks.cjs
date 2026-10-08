// Opt-in harness checks. Kept here, outside test/ and every CI/npm test command.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fixtureFor, loadRun, automaticChecks, makeReview, scoreReviews, hash, json } = require("./bench.cjs");
const { CONTEXT_CARRY_BOX_HEADER, DESTINATION_CONFIRMATION_INSTRUCTION } = require("../../api/summary-prompt");
const headings = ["🧠 WHO I AM", "🎯 WHAT WE WERE DOING", "📍 WHERE WE LEFT OFF", "✅ DECISIONS MADE", "⚠️ OPEN QUESTIONS", "📦 KEY CONTEXT", "🔁 NEXT STEP"];

function temporary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "capcontext-bench-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith("capcontext-bench-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}
function summary(testCase) {
  // Controlled scoring input, never presented as a real model generation or
  // semantic gold. Manual-judgment booleans below exercise the review protocol.
  const sections = headings.map((heading, index) => `${heading}\n${index === 6 ? DESTINATION_CONFIRMATION_INSTRUCTION : index === 5 ? testCase.benchmark.exactText.join("\n") : "None"}`);
  return `${CONTEXT_CARRY_BOX_HEADER}\n\n${sections.join("\n\n")}`;
}
function report(directory, { model = "mock-model", repeats = 2, edit = () => {} } = {}) {
  const fixture = fixtureFor("1");
  const results = fixture.cases.flatMap(testCase => Array.from({ length: repeats }, (_, index) => ["baseline", "candidate"].map(variant => ({
    caseId: testCase.id, repeat: index + 1, variant, generated: true, model, summary: summary(testCase), inputSha256: hash(testCase.conversation),
    systemPromptSha256: hash(variant), profile: "small", maxTokens: 1000, elapsedMs: 100, usage: { completionTokens: 200 }
  }))).flat());
  const value = { syntheticOnly: true, baselineRef: "a".repeat(40), candidatePromptSourceSha256: "b".repeat(64), comparisonRunnerSha256: "c".repeat(64),
    fixtureSha256: hash(json(fixture)), selectedCases: fixture.cases.map(item => item.id), repeats, model, results };
  edit(value);
  const file = path.join(directory, `${model}.report.json`);
  fs.writeFileSync(file, json(value));
  return file;
}
function review(file, edit = () => {}) {
  const output = file.replace(".report.json", ".review.json"), run = loadRun(file), value = makeReview(run, output);
  for (const entry of value.entries) {
    entry.sourceReviewed = true;
    for (const judgment of Object.values(entry.judgments)) { judgment.pass = true; judgment.evidence = "Controlled harness-only manual judgment; not model-quality evidence."; }
  }
  edit(value, run);
  fs.writeFileSync(output, json(value));
  return output;
}

test("six source-grounded cases cover two preservation, three grounding and one 90k recall case", () => {
  assert.deepEqual(["1", "2", "3"].map(level => fixtureFor(level).cases.length), [2, 3, 1]);
  assert.equal(fixtureFor("all").cases.length, 6);
  const long = fixtureFor("3").cases[0];
  assert.ok(long.conversation.length >= 90000 && long.conversation.length < 91000);
  assert.ok(long.conversation.indexOf("Archived reference") < long.conversation.indexOf("Here is my replacement draft"));
  assert.ok(long.conversation.lastIndexOf("Archived reference") > long.conversation.indexOf("Here is my replacement draft"));
});

test("exact payload and seven-heading checks catch losses and extra destination instructions", () => {
  const draft = fixtureFor("1").cases[1], valid = summary(draft);
  assert.equal(automaticChecks(valid, draft).structure, true);
  assert.deepEqual(automaticChecks(valid, draft).missingExactText, []);
  assert.equal(automaticChecks(valid.replace("A spare book", "A book"), draft).missingExactText.length, 1);
  assert.equal(automaticChecks(valid + "\nNow deploy it.", draft).structure, false);
  assert.equal(automaticChecks(valid.replace("CONTEXT CARRY", "CHAT SUMMARY"), draft).structure, false);
  assert.equal(automaticChecks(valid.replace("⚠️ OPEN QUESTIONS", "OPEN QUESTIONS"), draft).structure, false);
  const csv = fixtureFor("2").cases[0], lostNewline = summary(csv).replace('name,note\nAda', 'name,note\\nAda');
  assert.ok(automaticChecks(lostNewline, csv).missingExactText.includes('name,note\nAda,"red, blue"'));
});

test("unreviewed handoffs get pending scores; all repeats count and IDs conceal prompt labels", t => {
  const file = report(temporary(t)), output = review(file, value => {
    value.entries[0].sourceReviewed = false;
    assert.ok(value.entries.every(entry => !entry.variant && !entry.model && !entry.id.includes("baseline")));
  });
  const table = scoreReviews([output]);
  assert.match(table, /NEEDS REVIEW/);
  assert.match(table, /4\/4 \(4 attempted\)/);
});

test("matched candidate-only and shared semantic failures remain separate from perfect formatting", t => {
  const file = report(temporary(t)), output = review(file, (value, run) => {
    for (const entry of value.entries) {
      const result = run.report.results.find(result => hash(run.reportSha256 + `${result.caseId}:${result.repeat}:${result.variant}`).slice(0, 20) === entry.id);
      if (entry.caseId === "corrected-export-design" && result.variant === "candidate") entry.judgments.grounding.pass = false;
      if (entry.caseId === "continue-latest-draft") entry.judgments.continuity.pass = false;
    }
  });
  const table = scoreReviews([output]);
  assert.match(table, /corrected-export-design \| grounding \| 2 \| 0 \| 0 \| 2 \| 0/);
  assert.match(table, /continue-latest-draft \| continuity \| 2 \| 2 \| 0 \| 0 \| 0/);
  assert.match(table, /QUALITY FAIL/);
  assert.match(table, /100% \(4\/4\)/);
});

test("provider failure and unreached cases are availability, never zero-quality or successful local carry", t => {
  const file = report(temporary(t), { repeats: 1, edit: value => { value.results = [{ caseId: value.selectedCases[0], repeat: 1, variant: "baseline", generated: false, model: "local-direct", assessment: null }]; } });
  const table = scoreReviews([review(file)]);
  assert.match(table, /0\/2 \(1 attempted\)/);
  assert.match(table, /UNAVAILABLE \/ INCOMPLETE/);
  assert.doesNotMatch(table, /QUALITY FAIL|0% \(/);
});

test("review notes cannot override an exact-payload loss or edited source", t => {
  const file = report(temporary(t), { edit: value => { value.results[0].summary = value.results[0].summary.replace("upload idle timeout", "upload timeout"); } });
  const output = review(file);
  assert.match(scoreReviews([output]), /QUALITY FAIL/);
  const value = JSON.parse(fs.readFileSync(output));
  value.entries[0].source += "\nInvented approval";
  fs.writeFileSync(output, json(value));
  assert.throws(() => scoreReviews([output]), /changed inside review/);
});

test("changed inputs, source reports and duplicate reports fail provenance checks", t => {
  const directory = temporary(t), file = report(directory), output = review(file);
  const table = scoreReviews([output]);
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace(/\n/g, "\r\n"));
  assert.equal(scoreReviews([output]), table, "Windows file line endings must not change report identity");
  assert.throws(() => scoreReviews([output, output]), /cannot count twice/);
  const value = JSON.parse(fs.readFileSync(file));
  value.results[0].inputSha256 = "f".repeat(64);
  fs.writeFileSync(file, json(value));
  assert.throws(() => loadRun(file), /input does not match/);
  report(directory, { edit: value => { value.results[0].elapsedMs = 101; } });
  assert.throws(() => scoreReviews([output]), /Report changed after review/);
});

test("models share a cohort only with identical observed prompt and output allowances", t => {
  const directory = temporary(t), first = review(report(directory, { model: "model-a" }));
  const second = review(report(directory, { model: "model-b" }));
  assert.match(scoreReviews([first, second]), /model-a \| baseline/);
  assert.match(scoreReviews([first, second]), /model-b \| candidate/);
  const incompatible = review(report(directory, { model: "model-c", edit: value => { for (const result of value.results) result.maxTokens = 1500; } }));
  assert.throws(() => scoreReviews([first, incompatible]), /different prompts\/profiles\/output allowances/);
});
