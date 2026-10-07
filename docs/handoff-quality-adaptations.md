# Selective handoff adaptations

The useful comparison is whether a destination assistant can continue correctly with the text it receives. Our extension carries arbitrary conversations between AI products; the upstream workflow hands a coding session to an agent with repository access. That difference determines which ideas transfer.

Compared the entire imported [handoff reference](../HANDOFF_SKILL.md), [historical skill](../legacy/SKILL.md), production prompt at `a95254190755a55c09341c6626301012b1805726`, and the summary-quality candidate. The imported reference is pinned to [David Ondrej's upstream commit](https://github.com/davidondrej/skills/blob/7dce66c24bf4e98bb846e46dbefe9c81d80c1f91/skills/agent-orchestration/handoff/SKILL.md); it is reference material, not the runtime prompt. The backend uses `api/summary-prompt.js`, not `legacy/SKILL.md`.

## Worth adapting

| Upstream strength | Our adaptation | Why it helps |
| --- | --- | --- |
| Key Decisions **and why** | DECISIONS MADE pairs accepted choices with explicitly stated reasons; absent reasons stay absent. | A choice without its constraint or tradeoff is easy to undo accidentally. |
| Traps & Dead Ends | KEY CONTEXT pairs relevant failed attempts with observed results and stated abandonment reasons. Failure does not prove a cause or another fix. | The next assistant can avoid repeating an experiment without mistaking a hypothesis for evidence. |
| DONE / PARTIAL / NOT STARTED | WHERE WE LEFT OFF separates implementation, testing and deployment within their reported scope. Missing reports stay unknown. | Approval, a local check and publication establish different things. One cannot substitute for another. |
| Relevant Files & Pointers | Include a supplied path/URL and its stated purpose, while embedding essential current text/code/evidence. | A useful pointer saves rediscovery; the portable handoff still works when the destination cannot open the artifact. |

Keep the existing seven headings. These four ideas fit existing sections and do not require another template. Our current grounding, correction, unresolved-choice and trusted confirmation rules already cover other valuable upstream principles; duplicating them is not an improvement.

Do not copy the artifact-only approach or blanket instruction to read every file: a browser destination may have no file access. Do not import session timestamps, file-saving procedures, agent dependencies or repository assumptions into arbitrary customer chats. Do not add realistic worked examples: earlier experiments copied example facts into unrelated handoffs. The reference's blanket PII omission also needs separate product design; removing supplied names/owners would conflict with exact continuity and is not part of these four adaptations.

## Experiment design

Four fresh synthetic conversations in [handoff-adaptation-cases.json](../evaluation/handoff-adaptation-cases.json) exercise stated/absent reasons, failed attempts, independently reported work states, useful references, and an exact paragraph unavailable through artifact access. Every required/critical ground-truth phrase was checked against its source. These cases exceed the 1,200-character local-carry boundary and use the real generated-summary path.

The comparison alternates prompt order with identical input, selected provider, output allowance and runtime acceptance policy. It retains every full output, hash, usage and failure. Lexical flags are advisory: negated statements and faithful paraphrases can be false positives/omissions, while fluent unsupported implications can pass. Full source/output review decides whether continuation is safe.

Development credentials are loaded only for the evaluation process from a temporary file outside the repository. The configured free/private endpoint policy remains enforced. No customer conversation is used, and no production deployment or master merge is part of this experiment.

## Replaced candidates

- **v16:** Four rules added to v15. Eight pairs against pinned v15 preserved reasons and attempts, but the candidate invented missing-evidence requirements, broadened a local mock into no testing, and converted unreported testing into no activity. [All outputs](../evaluation/results/2026-10-07-handoff-v16-adaptations-dots.json).
- **v17:** Added explicit scope and pending-request checks. Eight pairs against master still produced unsupported status claims and a claim that both experiments were reverted where only one was. [All outputs](../evaluation/results/2026-10-07-handoff-v17-adaptations-dots.json).
- **v18:** Restored master's fuller fact/source/status and constraint checks, removed illustrative facts, and retained the four additions and exact-current-work rules. Four pairs improved reason/attempt preservation, but the missing-result case still became no testing. [All outputs](../evaluation/results/2026-10-07-handoff-v18-adaptations-dots.json).

The exact rejected prompt modules are retained under `evaluation/prompts`; their SHA-256 hashes match their reports. v19 adds a direct missing-report versus missing-activity check. These development cases have now been inspected and used for revision; further runs measure regression, not independent generalization.

## Final v19 findings

**Recommendation: retain the four principles, but hold this candidate's production merge.** Actual outputs do not establish an overall quality win. Stronger wording does not provide semantic verification.

| Case | Full-output result |
| --- | --- |
| Stated decision reason | Dots carries the memory rationale, corrected upload count and pending retry choice. It also invents acceptance of the mock as valid planning evidence and an additional unknown-state question. |
| Failed attempts | Dots retains both attempts, observed counts, reproduction and no-change boundary. Both variants carry the requested missing-evidence review; the candidate preserves it as pending rather than answering it. |
| Portable artifact and work status | Both retain the exact paragraph and references. Candidate distinguishes local rendering from publication/accessibility, but broadens the exclusions to "permanently excluded." |
| Unstated reasons and unknown status | Both Dots variants leave rationale unstated, but still equate absent reports with absent work; candidate also puts unknown testing in OPEN QUESTIONS. Ling's complete pair preserves the reported unknown state. Its candidate additionally keeps the exact requirements, no-selection boundary and inspection promise; both Ling boxes are malformed. One pair is not general improvement across models. |
| Corrected export design | Both preserve current concurrency, region, no-deploy boundary and pending proposal. Candidate once changes the exact error inside a quote by adding a period, while retaining the correct string elsewhere. |
| Current draft | Both retain the paragraph verbatim. Candidate preserves the pending second-paragraph-only request and no-rewrite scope more clearly. Lexical rejection flags count the correctly labelled obsolete draft as if it were current. |
| Unbooked travel plan | Candidate keeps the pending comparison and unbooked status but calculates a new two-night cost and invents specific accessibility questions. Baseline incorrectly calls Bay House selected and omits the pending comparison. Neither output is fully reliable. |
| CSV debugging | Candidate retains exact multiline input, expected/actual rows and reproduction, but converts accepted inspection into implementation approval and loses the pending explanation/sketch. Baseline generation failed, so this is not a complete pair. |
| Tutoring, hostile quotation and long histories | Tutoring candidate and CSV baseline returned 502. Dots then returned 429 at the hostile-quotation candidate. The budget-review and 90k/280k cases were never reached and have no v19 quality result. |

[Dots adaptation outputs](../evaluation/results/2026-10-07-handoff-v19-adaptations-dots.json), [partial regression outputs](../evaluation/results/2026-10-07-handoff-v19-regressions-dots.json), and [Ling status pair](../evaluation/results/2026-10-07-handoff-v19-status-ling.json) retain the evidence. A [broader Ling run](../evaluation/results/2026-10-07-handoff-v19-adaptations-ling.json) generated only its first baseline before candidate 429; it adds no pair. Availability failures remain ungraded, not passes or prompt failures.

Across v16-v19, all 63 attempts are retained: 59 generated handoffs and four provider failures, with 28 complete pairs and three unpaired generations. Final v19 has eight complete pairs plus three unpaired generations. This is a small synthetic, development-influenced sample. It cannot prove production quality or replace the unreached regressions.

The report's `candidateRef` is the checkout parent before the uncommitted experiment, not a claim that v19 was already committed there. Prompt source hashes, each full system-prompt hash and fixture/input hashes identify the evaluated bytes. Rejected snapshots reproduce the earlier source hashes; the final runtime module matches the v19 reports.

Final compatibility checks: 28 focused tests passed for provider/template/cache integration, empty-template rejection and comparison integrity. Ground-truth phrase checks and diff checks passed. Routing, output allowances, validation policy, seven headings and trusted destination confirmation remain unchanged. The development environment file was removed after evaluation. No master merge or deployment was performed.

The next quality decision needs an available route, completed failure-prone/long-history comparisons, and full source/output review. Further wording changes alone should not be declared a fix for unsupported facts.
