// Offline tests cannot prove model quality. This experiment uses only explicit
// synthetic fixtures and keeps every generation, including failures and retries.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { parseArgs } = require("node:util");
const { containsFact } = require("./run-regression-eval");
const root = path.join(__dirname, "..");
const sha256 = text => createHash("sha256").update(text).digest("hex");
const factLabel = fact => Array.isArray(fact) ? fact.join(" OR ") : fact;

function withLongHistory(testCase, targetChars) {
  if (!Number.isInteger(targetChars) || targetChars < testCase.conversation.length || targetChars > 340000) {
    throw new Error("Long-history target must preserve the base conversation and fit the transcript limit");
  }
  const turns = testCase.conversation.split("\n\n");
  const anchor = testCase.historyAnchor
    ? turns.findIndex(turn => turn.includes(testCase.historyAnchor))
    : Math.floor(turns.length / 2);
  if (anchor < 0) throw new Error("Long-history anchor must match a source turn");
  const archive = [[], []];
  const topics = [
    "the retired Meadow bookmark project used a green star icon; that project is unrelated to the active task",
    "an old neighborhood bulletin used a two-column layout; it supplies no decision about the current work",
    "a sample cooking exercise described oats and apples; its quantities are not active project requirements",
    "the archived Kite puzzle discussion preferred arrow keys; no current input behavior was decided there",
    "a fictional reading club discussed a poetry anthology; its owner and dates are irrelevant here"
  ];
  let chars = testCase.conversation.length;
  for (let index = 0; chars < targetChars; index++) {
    const paragraph = `Assistant: Archived reference ${index + 1}: ${topics[index % topics.length]}. This reference is historical background only.`;
    archive[index % 2].push(paragraph);
    chars += paragraph.length + 2;
  }
  // Insert complete unrelated turns without cutting, reordering or rewriting any
  // source turn. Corrections now sit between two substantial history blocks.
  const conversation = turns.flatMap((turn, index) => {
    return index === anchor ? [...archive[0], turn, ...archive[1]] : [turn];
  }).join("\n\n");
  return { ...testCase, id: `${testCase.id}-long-${targetChars}`, conversation,
    purpose: `${testCase.purpose} Distributed among unrelated archived turns.`,
    baseCaseId: testCase.id, targetChars };
}

function assessSummary(summary, testCase) {
  const missing = facts => facts.filter(fact => !containsFact(summary, fact)).map(factLabel);
  return {
    missingFacts: missing(testCase.requiredFacts),
    missingCriticalFacts: missing(testCase.criticalFacts),
    incorrectFacts: [
      ...testCase.forbiddenFacts.filter(fact => containsFact(summary, fact)),
      ...testCase.contradictions.filter(rule => new RegExp(rule.pattern, "i").test(summary)).map(rule => rule.label)
    ]
  };
}

function loadBaseline(ref) {
  // Read a pinned Git snapshot without switching branches or touching other worktrees.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cap-context-summary-baseline-"));
  const archive = path.join(directory, "source.tar");
  const cleanup = () => {
    const target = path.resolve(directory);
    if (path.dirname(target) !== path.resolve(os.tmpdir()) || !path.basename(target).startsWith("cap-context-summary-baseline-")) {
      throw new Error("Refusing to remove a directory outside the experiment's temporary root");
    }
    fs.rmSync(target, { recursive: true, force: true });
  };
  try {
    fs.writeFileSync(archive, execFileSync("git", ["archive", "--format=tar", ref, "api", "supabase/functions/_shared"], { cwd: root }));
    execFileSync("tar", ["-xf", archive, "-C", directory]);
    const backend = require(path.join(directory, "api", "summarize.js")).__test;
    return { backend, cleanup };
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function comparePrompts({ cases, variants, repeats = 1, generate, onResult = () => {} }) {
  const results = [];
  // Alternate pair order to reduce systematic first-call/cache effects. A failed
  // generation stays a failure; never select only the best repeat for a prompt.
  for (let repeat = 1; repeat <= repeats; repeat++) {
    for (const [index, testCase] of cases.entries()) {
      const order = (index + repeat) % 2 ? variants : [...variants].reverse();
      for (const variant of order) {
        let result;
        try {
          const generated = await generate(variant, testCase);
          result = { caseId: testCase.id, repeat, variant: variant.name, ...generated,
            assessment: generated.generated ? assessSummary(generated.summary, testCase) : null };
        } catch {
          // Do not serialize arbitrary errors: they can contain URLs or credentials.
          result = { caseId: testCase.id, repeat, variant: variant.name, error: "generation_failed" };
        }
        results.push(result);
        onResult(result, results);
      }
    }
  }
  return results;
}

async function main() {
  const { values } = parseArgs({ options: {
    "baseline-ref": { type: "string", default: "master" },
    cases: { type: "string", default: "evaluation/handoff-quality-cases.json" },
    output: { type: "string" },
    "case-id": { type: "string" },
    "long-history": { type: "boolean", default: false },
    repeats: { type: "string", default: "1" },
    model: { type: "string", default: "inclusionai/ling-3.1-flash" }
  } });
  const repeats = Number(values.repeats);
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw new Error("repeats must be between 1 and 3");
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is required");
  const flags = {
    "inclusionai/ling-3.1-flash": "OPENROUTER_LING_ENABLED",
    "qwen/qwen3.8-27b:free": "OPENROUTER_QWEN_ENABLED"
  };
  if (!flags[values.model]) throw new Error("Only the configured free Ling and Qwen experiment routes are supported");
  process.env.OPENROUTER_ENABLED = "true";
  for (const flag of ["OPENROUTER_LING_ENABLED", "OPENROUTER_QWEN_ENABLED", "OPENROUTER_DOTS_ENABLED", "OPENROUTER_GEMMA_ENABLED"]) {
    process.env[flag] = flag === flags[values.model] ? "true" : "false";
  }
  const casesPath = path.resolve(root, values.cases);
  const fixtureSource = fs.readFileSync(casesPath, "utf8");
  const fixture = JSON.parse(fixtureSource);
  if (fixture.syntheticOnly !== true) throw new Error("Comparison requires explicitly synthetic fixtures");
  let cases = fixture.cases;
  if (values["long-history"]) {
    cases = [...cases,
      withLongHistory(fixture.cases.find(item => item.id === "continue-latest-draft"), 90000),
      withLongHistory(fixture.cases.find(item => item.id === "corrected-export-design"), 280000)
    ];
  }
  if (values["case-id"]) cases = cases.filter(item => item.id === values["case-id"]);
  if (!cases.length) throw new Error("No matching synthetic case");
  const baselineRef = execFileSync("git", ["rev-parse", "--verify", `${values["baseline-ref"]}^{commit}`], { cwd: root, encoding: "utf8" }).trim();
  const baseline = loadBaseline(baselineRef);
  const candidate = require("../api/summarize").__test;
  const output = path.resolve(root, values.output || `evaluation/results/${new Date().toISOString().slice(0, 10)}-prompt-comparison.json`);
  const report = {
    version: 1, syntheticOnly: true, baselineRef, candidateRef: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
    candidatePromptSourceSha256: sha256(fs.readFileSync(path.join(root, "api", "summary-prompt.js"))),
    fixtureSha256: sha256(fixtureSource), model: values.model, repeats,
    selectedCases: cases.map(item => item.id), longHistory: values["long-history"],
    comparisonRunnerSha256: sha256(fs.readFileSync(__filename)),
    reviewCriteria: fixture.reviewCriteria,
    limitations: "Lexical checks are diagnostics, not semantic grading. Review every full handoff; local fallback is not a successful model generation. Short fixtures force the same generated profile on both variants; production tiny chats still use exact local carry.",
    results: []
  };
  try {
    await comparePrompts({ cases, variants: [{ name: "baseline", backend: baseline.backend }, { name: "candidate", backend: candidate }], repeats,
      generate: async (variant, testCase) => {
        let profile = variant.backend.getSummaryProfile(testCase.conversation);
        const forcedGeneratedProfile = Boolean(profile.directCarry);
        if (forcedGeneratedProfile) profile = variant.backend.getSummaryProfile("x".repeat(1201));
        const startedAt = Date.now();
        const result = await variant.backend.createSummaryWithFallback({ conversation: testCase.conversation, profile,
          openrouterApiKey: process.env.OPENROUTER_API_KEY });
        return { summary: result.model === values.model ? result.summary : null, generated: result.model === values.model, model: result.model,
          elapsedMs: Date.now() - startedAt, inputChars: testCase.conversation.length, inputSha256: sha256(testCase.conversation),
          systemPromptSha256: sha256(variant.backend.getSummarySystemPrompt(profile)), profile: profile.id,
          forcedGeneratedProfile, maxTokens: profile.maxTokens, usage: result.usage, qualityFlags: result.qualityFlags, fallback: result.fallback };
      },
      onResult: (result, results) => {
        report.results = results;
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
        const assessment = result.assessment;
        process.stdout.write(`${result.caseId} ${result.variant} repeat=${result.repeat}: ${result.error || (result.generated ? `generated; missing-critical=${assessment.missingCriticalFacts.length}; incorrect=${assessment.incorrectFacts.length}; ${result.elapsedMs}ms` : "provider unavailable; local fallback")}\n`);
        if (/OpenRouter API error (401|402|404|429)/.test(result.fallback?.reason || "")) {
          throw new Error("Experiment route unavailable; inspect retained results before spending more requests");
        }
      }
    });
    if (report.results.some(result => !result.generated)) process.exitCode = 1;
    process.stdout.write(`Saved all ${report.results.length} attempts: ${output}\n`);
  } finally { baseline.cleanup(); }
}

if (require.main === module) main().catch(() => { console.error("Prompt comparison failed; inspect configuration and retained safe results."); process.exitCode = 1; });
module.exports = { assessSummary, comparePrompts, withLongHistory };
