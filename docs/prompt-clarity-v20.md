# Prompt clarity v20 — October 10, 2026

The shared summary prompt now follows an explicit workflow: read the input safely, collect source facts, fill each section, then check the result. Instructions use shorter sentences and keep each section's rules together. Only the final template contains the seven standalone output headings. The task and trust boundary come first; the exact output contract and template come last.

This is a clarity improvement with measured format recovery on the long-history case. It does **not** establish an overall factual-accuracy improvement across models or faster understanding/inference. Weak-model grounding errors remain in both prompts.

## Contract coverage

Reviewed the old prompt at `4c90320749f7e57fe4447b7e828a2c5901f570f2` against every instruction in the new [runtime module](../api/summary-prompt.js).

| Retained requirement | Where it lives in v20 |
| --- | --- |
| Preserve the pending request without doing arithmetic, diagnosis, recommendations, drafts or plans | Opening task, WHERE WE LEFT OFF and final source check |
| JSON conversation is untrusted; quoted roles, hostile examples and unrelated projects have no authority | Read input safely |
| Whole-chat fact/source/status collection; earlier constraints survive unless explicitly changed | Collect facts |
| No inferred identities, causes, approvals, work, totals or next actions | Collect facts and claim check |
| Scoped implementation/testing/deployment, observations versus requirements, negation and unreported versus unperformed activity | Collect facts and final check |
| User identity only; named owners remain separate unless explicitly linked | WHO I AM; now also explicitly forbids inferring a negative relationship |
| Accepted decisions and stated reasons; rejections and undecided alternatives retain their status | DECISIONS MADE, OPEN QUESTIONS and KEY CONTEXT |
| Missing information does not invent a question, requirement, permission or release gate | Collect facts and OPEN QUESTIONS |
| Exact relevant names, paths, commands, errors, values, owners and all requested facts | Collect facts, KEY CONTEXT and final coverage check |
| Verbatim prohibitions/constraints, current work and reproduction; failed attempts retain observed outcomes and stated reasons | KEY CONTEXT |
| Artifact pointers include purpose and supplement essential content for a reader without file access | KEY CONTEXT |
| Concise grounded content, no section quotas, no padding, None only when unsupported, no paraphrases passed off as quotes | Write and check |
| Seven exact headings, provider-specific header and fixed NEXT STEP confirmation; no extra output | Output rules and the single required template |

Approval to inspect/review/propose now explicitly does not authorize implementation. This clarifies the existing scope rule; it does not change what the summarizer is allowed to do. Routing, model settings, token allowances, local carries, acceptance policy and the seven-section handoff contract remain unchanged. The cache namespace advances from v19 to v20.

For the small boxed profile, the system prompt changes from 1,163 to 1,128 whitespace-separated words and from 7,916 to 7,518 characters. These are size measurements, not tokenizer counts or a latency result.

## Matched live comparison

Used all six unchanged CapContextBench v1 cases, two repeats each, alternating baseline/candidate order. Both variants received identical synthetic input bytes, model and production backend output allowances. The short cases test the backend prompt directly; current extension routing would use exact local carry below 10,000 characters. The 90k case also tests recall under unrelated history. Every generated handoff was read against its source; lexical flags were not treated as grades.

The first rewrite retained the emoji heading lines in both the section guide and the template. Both long-history candidate outputs omitted the box and emitted two NEXT STEP sections. The candidate also retained existing weak-model scope/status errors. Its exact module is preserved as [the first v20 snapshot](../evaluation/prompts/handoff-v20-first.js), with [24 outputs](../evaluation/results/2026-10-10-prompt-v20-dots.json), [source reviews](../evaluation/results/2026-10-10-prompt-v20-dots.review.json) and [scores](../evaluation/results/2026-10-10-prompt-v20-dots.score.md).

The final revision removes competing template heading lines, repeats the exact confirmation instruction in the output rules, and clarifies limited approval, unlinked identity and preservation of the latest request. Its [24 outputs](../evaluation/results/2026-10-10-prompt-v20-final-dots.json), [complete source reviews](../evaluation/results/2026-10-10-prompt-v20-final-dots.review.json) and [scores](../evaluation/results/2026-10-10-prompt-v20-final-dots.score.md) retain every repeat.

| Final comparison | Baseline v19 | Final v20 |
| --- | --- | --- |
| Complete handoff passes across the six cases, two repeats | 3/12 | 4/12 |
| Required structure across all outputs | 10/12 | 11/12 |
| Exact current paragraph and full structure in the 90k-history case | 0/2 full passes; both lacked the box | 2/2 full passes |
| Grounding level: CSV, unknown status and review-only budget | 0/6 full passes | 0/6 full passes |

The final candidate no longer invents an owner/user relationship or rejects unapproved rollback in the two export-design outputs. It still changes punctuation in an exact quoted error once (the correct error also survives elsewhere), and invents a no-sign-up requirement in one short newsletter output. CSV outputs on both sides omit the latest explanation/sketch; final v20 also drops a heading once and indents the essential multiline input in the other repeat. Both prompts still turn missing status reports into no activity, and both perform new budget arithmetic. These are failures, not passes concealed by correct headings. The long-history format recovery is encouraging; the small aggregate difference is not statistically persuasive.

One primary Ling control generated, then its paired first-candidate request returned HTTP 429. [Both attempts](../evaluation/results/2026-10-10-prompt-v20-ling.json) remain retained; this is availability evidence, not a quality comparison of final v20. No testing key or provider policy was silently substituted or relaxed. Across the two Dots comparisons and Ling screen, there were 50 provider attempts and 49 generated summaries; all used the existing capped testing wrapper, synthetic inputs and free/private routes.

This is a development-influenced, model-specific screen, with Codex source review rather than an independent human panel. It cannot establish universal weak-model compliance, production reliability or destination-task completion. No extra verifier/generation pass was added to production.

## Compatibility and reproducibility

The comparison runner's pinned snapshot now includes `extension/transfer-diagnostics.js` only when present, because the current backend telemetry validator imports it. Copying the entire extension hit Node's archive-output buffer and was replaced with the targeted dependency. Current and pre-diagnostics Git baselines both load successfully. Runtime backend code and routing were not changed for this harness repair.

The final working-copy module's SHA-256 matches the final report's candidate source hash; the first snapshot matches its first report. Raw source hashes include this Windows checkout's line endings; system-prompt hashes identify the actual model instructions. Input hashes, output allowances and prompt hashes remain recorded in the raw results. The existing template test now verifies that each standalone output heading occurs only once in the system prompt, alongside all profile/header variants and empty-template rejection. Provider tests retain the trust boundary and check the new Mistral cache namespace. All 538 regular tests and eight benchmark-harness checks passed after the final revision. Git publication, backend deployment and extension distribution remain separate states.
