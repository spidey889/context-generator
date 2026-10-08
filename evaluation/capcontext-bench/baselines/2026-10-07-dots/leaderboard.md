# CapContextBench v1

Manual source-reviewed handoffs; rates include every retained repeat. Availability and review coverage are separate from quality. Unreviewed/partial runs have no final score. Compare models only inside the same cohort and level.

## Cohort 78bb5e503789 — selected level 1

Baseline: a95254190755a55c09341c6626301012b1805726. Candidate source: 2f1d3e6fbf4ff421293072f48aedd597d14e6696e1737f905aab43ed7075e70b. Repeats per run: 2.

| Model | Prompt | Level | Generated/planned | Reviewed/generated | Handoff pass | Continuity | Fidelity | Grounding | Structure | Median ms | Median output tokens | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dots-studio/dots-3-note-preview:free | baseline | 1 | 4/4 (4 attempted) | 4/4 | 50% (2/4) | 75% (3/4) | 75% (3/4) | 75% (3/4) | 75% (3/4) | 8783 | 481.5 | QUALITY FAIL |
| dots-studio/dots-3-note-preview:free | candidate | 1 | 4/4 (4 attempted) | 4/4 | 75% (3/4) | 100% (4/4) | 100% (4/4) | 75% (3/4) | 100% (4/4) | 10478.5 | 581 | QUALITY FAIL |

### Matched failure patterns

Counts concern complete, reviewed pairs only. Shared failure means both prompts failed that dimension; it does not prove a purely model-only cause. Candidate-only failures are comparative warnings, not statistical proof from a tiny sample.

| Model | Case | Dimension | Pairs reviewed | Both fail | Master only fails | Candidate only fails | Both pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dots-studio/dots-3-note-preview:free | corrected-export-design | continuity | 2 | 0 | 1 | 0 | 1 |
| dots-studio/dots-3-note-preview:free | corrected-export-design | fidelity | 2 | 0 | 1 | 0 | 1 |
| dots-studio/dots-3-note-preview:free | corrected-export-design | grounding | 2 | 0 | 1 | 0 | 1 |
| dots-studio/dots-3-note-preview:free | corrected-export-design | structure | 2 | 0 | 1 | 0 | 1 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft | continuity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft | fidelity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft | grounding | 2 | 0 | 0 | 1 | 1 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft | structure | 2 | 0 | 0 | 0 | 2 |

Sources:

- Review: evaluation\capcontext-bench\baselines\2026-10-07-dots\review.json; report SHA-256: a161c643666e0d627eac36ecd61b3f82e3871d58e95b49cab647565b55cc47c2
- Reviewer: Codex source review, 2026-10-07; one reviewer, not a fully blinded assessment. Limit: Only level 1 and one model measured. Candidate draft repeat 1 uses verified without a reported verification; that conservative judgment is explicitly available for owner review. No overall model ranking follows from this sample.
