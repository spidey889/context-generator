# V15 compared with current master

**Recommendation: keep master unchanged.** The shorter prompt improves some continuation details and avoids one severe padding failure, but introduces unsupported analysis and questions in repeated cases. These results do not justify merging the current prompt wholesale.

## Method

Compared master `2c665862a4f3e455bf98bbfc2ec1f0aa62f404ec` with candidate `0f4b23c3f3ac53eeeca00e41757b8e83f7122e76`. Both received identical synthetic input, provider, output allowance and runtime acceptance policy. Order alternated, and every result was retained. Seven short cases plus 90k/280k variants were run twice: **18 baseline/candidate pairs, 36 generated summaries** on the existing free/private Dots route.

[Full Dots outputs](../evaluation/results/2026-10-06-handoff-v15-dots-new-key.json) include hashes, usage, timings and diagnostics. These cases were used during previous prompt development, so this is regression evidence, not an independent measure of generalization. No customer transcripts were used.

The primary Ling route generated one baseline, then returned 429 for its candidate; [its report](../evaluation/results/2026-10-06-handoff-v15-ling-new-key.json) does not constitute a pair. Gemma returned 429 before a generation; [its report](../evaluation/results/2026-10-06-handoff-v15-gemma-new-key.json) is ungraded. A winner across production models cannot be inferred.

## Full-output findings

| Case | Observed comparison |
| --- | --- |
| Corrected export design | Both preserve the corrected concurrency and pending proposal. Candidate paraphrases the unconditional no-deploy instruction instead of copying it and sometimes claims Jules is definitely not the user, where the source only disallows that inference. Baseline also makes identity/status mistakes. |
| Current draft | Both retain the exact opening paragraph. Candidate makes second-paragraph scope clear, but its first repeat omits earlier tone/audience and no-invented-quotes constraints. Baseline retains those. |
| Travel plan | Candidate retains the pending comparison more explicitly. It also computes a new two-night cost in both repeats, invents a wheelchair-route question in one, and states a broader external-research prohibition in the other. Baseline's second repeat is more restrained. |
| Algebra learning | Candidate puts the explicit hint preference in WHO I AM and preserves the corrected exercise and requested step order. Both can continue without giving the final roots. Candidate still mixes current exercise facts into identity in one repeat. |
| CSV debugging | Candidate preserves the pending explanation/sketch request and keeps accepted inspection separate from implementation. Baseline loses that request and one repeat broadens inspection to implementation. Candidate adds an unstated backslash-escape option in one repeat, and renders a real newline as a literal backslash-n in the other. |
| Hostile quotation | Both keep unrelated projects and hostile claims labelled as such. Candidate invents a cause question in both repeats and asks whether mobile was tested despite the source already saying it was not checked. Baseline also invents a no-deploy prohibition in one repeat. |
| Quote review | Baseline preserves the draft and review boundaries without performing budget arithmetic. Candidate computes new totals in both repeats, invents additional expense categories and contract details, and one repeat asks how to obtain the fee despite the no-contact restriction. This is a clear candidate regression, not a keyword-check failure alone. |
| Long draft | Both retain the exact current paragraph. Baseline's second repeat expands into 3,841 words of irrelevant missing constraints and reaches its token limit; candidate stays at 372 words with the pending task intact. Candidate nevertheless invents a Claude attribution in that repeat even though the source is a ChatGPT conversation. |
| Long design | Candidate retains the pending patch proposal in both repeats; baseline's second repeat drops it. Both preserve important active design facts. Identity/status wording and irrelevant archived material remain imperfect. |

The keyword diagnostics cannot settle these findings: negated/rejected phrases create false positives, while mathematically equivalent typography creates false omissions. They also miss invented implications. Full output and the source transcript are the authority.

## Efficiency and boundaries

Across these 18 pairs, baseline used 176,432 input tokens and 13,229 output tokens; candidate used 168,458 and 9,166. That is about 4.5% less input and 30.7% less output, with much of the output saving driven by the single baseline padding failure. The candidate had no structural flags, while six baseline outputs were flagged. These are efficiency/format observations, not proof of better factual quality.

Both supplied credentials existed only in temporary test-process memory/environment. Neither was placed in repository files, Cap Context configuration, reports or environment files. The first process cleared its key on completion. The second used a temporary fetch guard with a cumulative hard cap of 40 HTTP requests and finished at **5 requests including key validation**; its key, guard and counter were removed. Saved reports were checked for credential-shaped text.

No production behavior or UI was changed during this comparison. The earlier v15 CI run was cancelled before any test steps ran; the last local source validation passed 380 deterministic tests.

The useful next direction is preserving pending work and exact evidence while adding source checks for unsupported additions, rather than adding more prose instructions or fine-tuning on a few examples. A profile-specific prompt could be investigated for long histories, but these two artificial histories are insufficient to approve that change yet.
