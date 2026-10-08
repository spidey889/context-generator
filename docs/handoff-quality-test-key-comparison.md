# Dedicated testing-key comparison — October 7, 2026

The fresh master control confirms several shared model failures. The candidate improves preservation of the long current draft and pending requests, but also loses some scope details. Retain the four selective handoff principles; these outputs establish neither a consistent regression nor an overall quality win. No prompt wording, production configuration or master merge was changed for this comparison.

## Method and retained evidence

Master is pinned to `a95254190755a55c09341c6626301012b1805726`; candidate checkout parent is `fe868513c9e90231e21abc1b3ec202d6717f6579`. The unchanged v19 source SHA-256 is `2f1d3e6fbf4ff421293072f48aedd597d14e6696e1737f905aab43ed7075e70b`. Reports also record fixture/input hashes, full system-prompt hashes, runner hash, token allowances, usage and every output. Both variants receive identical input bytes, model and production acceptance policy; order alternates. These synthetic cases have already influenced development, so they are regression evidence rather than an independent holdout.

| Run | Attempts | Generated | Complete pairs | Report |
| --- | ---: | ---: | ---: | --- |
| Ling, first test key | 1 | 0 | 0 | [429 failure](../evaluation/results/2026-10-07-handoff-v19-ling-test-a-regressions.json) |
| Ling, second test key | 1 | 0 | 0 | [429 failure](../evaluation/results/2026-10-07-handoff-v19-ling-test-b-regressions.json) |
| Dots, seven short and two long original cases | 18 | 18 | 9 | [Full outputs](../evaluation/results/2026-10-07-handoff-v19-dots-test-a-regressions.json) |
| Dots, four adaptation cases repeated twice | 16 | 16 | 8 | [Full outputs](../evaluation/results/2026-10-07-handoff-v19-dots-test-a-adaptations.json) |

Total: 36 attempts, 34 generated summaries, 17 complete pairs. Neither Ling failure receives a quality assessment. The configured Qwen route was absent from the public catalog and was not called. Dots succeeding with the same first key means Ling's failures do not establish exhaustion of that key. At completion, the local rolling-day ledgers count 35 requests for `test-a` and one for `test-b`, including failures; these are not provider-side remaining quotas.

## Full-output findings

Every generated output was read against its source, including both adaptation repeats. Lexical flags are advisory: quoted/rejected material and faithful paraphrases can trigger misleading flags.

| Case | Observed result |
| --- | --- |
| Corrected export design, short | Both retain final concurrency, size, region and retry options. Candidate preserves the pending patch proposal that master drops, but describes the broader goal as implementation. |
| Current draft, short | Both retain the exact paragraph. Master keeps the second-paragraph-only boundary more explicitly; candidate's scope wording is weaker, although it locks the current paragraph elsewhere. |
| Unbooked travel | Both calculate a new two-night price and invent accessibility details. Master claims availability without verification; candidate calls a stay confirmed despite the unaccepted option, while also saying no bookings. Candidate keeps the pending comparison. |
| Tutoring | Both preserve the corrected equation and avoid final roots. Both put WHO I AM as None despite the stated hint preference, carried elsewhere. Candidate loses the explicit no-finishing-expansion boundary. Superscript formatting causes lexical false omissions. |
| Exact CSV evidence | Both turn accepted inspection into permission to implement a quote-aware parser. Both replace an actual newline with literal `\n`. Reproduction and expected/actual counts remain, but the pending explanation/sketch is weakened. This completes the previously missing master control. |
| Hostile quotation | Both correctly separate unrelated quoted instructions. Candidate additionally invents a no-deploy prohibition from reported non-deployment. Quoting the hostile text while labelling it untrusted is not itself evidence that the model obeyed it. |
| Budget review | Both invent a 380 subtotal; master also calculates a 320 remainder. Candidate retains the pending review more clearly. The exact current draft and no-contact boundary survive. This previously unreached case now demonstrates the arithmetic error on master too. |
| 90k current-draft history | Candidate retains the exact current paragraph and pending second-paragraph request. Master omits the paragraph while saying it is locked. Both retain unnecessary archived details. This is a concrete continuity gain. |
| 280k corrected-design history | Both preserve the current design and pending proposal. Both alter punctuation in an exact quoted error; candidate retains the correct string elsewhere. Candidate adds an unsupported identity exclusion and tautological decision reasons. Master preserves some explicit boundaries more clearly. |
| Stated reason, two repeats | Both preserve the memory rationale, corrected upload count, mock/provider distinction and undecided retry options. Candidate sometimes carries the pending request more clearly; one repeat changes punctuation in the exact mock output. |
| Failed attempts, two repeats | Both preserve each attempt and actual output without claiming a root cause. Candidate keeps the requested missing-evidence review pending; master adds speculative cause questions and once invents an exclusive reproduction-command constraint. Candidate's exact no-source-change wording is weaker, with no-implementation scope retained elsewhere. |
| Artifact and scoped status, two repeats | All four retain the exact paragraph and useful references with local-rendering/publication/accessibility boundaries. Candidate once broadens the overall goal to publication/accessibility despite the current exclusion and drops museum-manager attribution. |
| Unstated reasons and unknown status, two repeats | All four leave reasons unstated. Both prompts still strengthen missing reports into absent work, sometimes contradicting unknown-status wording elsewhere. Candidate carries the pending requirements/options request better; neither reproduces the requirements paragraph exactly. |

Shared failures prove that the problem occurs on master; they do not isolate a purely model-only cause or establish equal failure rates. Candidate gains and weaknesses must both inform a future merge decision. These 17 development-influenced pairs from one model do not measure customer outcomes or establish reliability across models. No best-output selection, silent retries, paid route or relaxed privacy policy was used.

## Test setup validation

Credentials are retained encrypted outside Git for this Windows user. [The wrapper](../scripts/compare-summary-with-test-key.ps1) supplies only the selected testing key; missing credentials stop the run. Its [guard](../scripts/openrouter-test-budget.cjs) caps each persistent rolling-day ledger at 50, counts failures, spaces requests and rejects other credentials or paid/private-policy violations before sending. Four mocked budget tests and four existing comparison-integrity tests passed. The PowerShell wrapper parsed successfully. These checks validate the testing workflow; they do not certify summary semantics.
