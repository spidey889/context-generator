# CapContextBench v1

Manual source-reviewed handoffs; rates include every retained repeat. Availability and review coverage are separate from quality. Unreviewed/partial runs have no final score. Compare models only inside the same cohort and level.

## Cohort 822badbc38a3 — selected level all

Baseline: 4c90320749f7e57fe4447b7e828a2c5901f570f2. Candidate source: d0ca375999add59507911d330e47cd38d675e8343e1a4f9d16d25431627bdb58. Repeats per run: 2.

| Model | Prompt | Level | Generated/planned | Reviewed/generated | Handoff pass | Continuity | Fidelity | Grounding | Structure | Median ms | Median output tokens | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dots-studio/dots-3-note-preview:free | baseline | 1 | 4/4 (4 attempted) | 4/4 | 100% (4/4) | 100% (4/4) | 100% (4/4) | 100% (4/4) | 100% (4/4) | 7981 | 542.5 | PASS |
| dots-studio/dots-3-note-preview:free | baseline | 2 | 6/6 (6 attempted) | 6/6 | 17% (1/6) | 33% (2/6) | 33% (2/6) | 17% (1/6) | 100% (6/6) | 6390 | 445 | QUALITY FAIL |
| dots-studio/dots-3-note-preview:free | baseline | 3 | 2/2 (2 attempted) | 2/2 | 0% (0/2) | 100% (2/2) | 100% (2/2) | 0% (0/2) | 100% (2/2) | 8620.5 | 714 | QUALITY FAIL |
| dots-studio/dots-3-note-preview:free | candidate | 1 | 4/4 (4 attempted) | 4/4 | 50% (2/4) | 100% (4/4) | 50% (2/4) | 50% (2/4) | 100% (4/4) | 7041 | 514.5 | QUALITY FAIL |
| dots-studio/dots-3-note-preview:free | candidate | 2 | 6/6 (6 attempted) | 6/6 | 17% (1/6) | 33% (2/6) | 33% (2/6) | 17% (1/6) | 100% (6/6) | 6919.5 | 484 | QUALITY FAIL |
| dots-studio/dots-3-note-preview:free | candidate | 3 | 2/2 (2 attempted) | 2/2 | 0% (0/2) | 100% (2/2) | 100% (2/2) | 100% (2/2) | 0% (0/2) | 12135 | 1087 | QUALITY FAIL |

### Matched failure patterns

Counts concern complete, reviewed pairs only. Shared failure means both prompts failed that dimension; it does not prove a purely model-only cause. Candidate-only failures are comparative warnings, not statistical proof from a tiny sample.

| Model | Case | Dimension | Pairs reviewed | Both fail | Master only fails | Candidate only fails | Both pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dots-studio/dots-3-note-preview:free | corrected-export-design | continuity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | corrected-export-design | fidelity | 2 | 0 | 0 | 2 | 0 |
| dots-studio/dots-3-note-preview:free | corrected-export-design | grounding | 2 | 0 | 0 | 2 | 0 |
| dots-studio/dots-3-note-preview:free | corrected-export-design | structure | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft | continuity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft | fidelity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft | grounding | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft | structure | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | debugging-reproduction | continuity | 2 | 2 | 0 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | debugging-reproduction | fidelity | 2 | 2 | 0 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | debugging-reproduction | grounding | 2 | 2 | 0 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | debugging-reproduction | structure | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | missing-reason-and-unverified-status | continuity | 2 | 2 | 0 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | missing-reason-and-unverified-status | fidelity | 2 | 2 | 0 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | missing-reason-and-unverified-status | grounding | 2 | 2 | 0 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | missing-reason-and-unverified-status | structure | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | review-budget-draft | continuity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | review-budget-draft | fidelity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | review-budget-draft | grounding | 2 | 0 | 1 | 1 | 0 |
| dots-studio/dots-3-note-preview:free | review-budget-draft | structure | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft-long-90000 | continuity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft-long-90000 | fidelity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft-long-90000 | grounding | 2 | 0 | 2 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft-long-90000 | structure | 2 | 0 | 0 | 2 | 0 |

Sources:

- Review: evaluation\results\2026-10-10-prompt-v20-dots.review.json; report SHA-256: 8bb0f61684292bfc5b698042c44bed785719e0074d8a40c9314e37b690048820
- Reviewer: unspecified