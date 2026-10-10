# CapContextBench v1

Manual source-reviewed handoffs; rates include every retained repeat. Availability and review coverage are separate from quality. Unreviewed/partial runs have no final score. Compare models only inside the same cohort and level.

## Cohort c777417ed54d — selected level all

Baseline: 4c90320749f7e57fe4447b7e828a2c5901f570f2. Candidate source: 96f6c0895eaad9d96dfd6abcc7525d23fca39a93162f93b43dd98cc4ce57b418. Repeats per run: 2.

| Model | Prompt | Level | Generated/planned | Reviewed/generated | Handoff pass | Continuity | Fidelity | Grounding | Structure | Median ms | Median output tokens | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dots-studio/dots-3-note-preview:free | baseline | 1 | 4/4 (4 attempted) | 4/4 | 75% (3/4) | 100% (4/4) | 75% (3/4) | 75% (3/4) | 100% (4/4) | 8260 | 549 | QUALITY FAIL |
| dots-studio/dots-3-note-preview:free | baseline | 2 | 6/6 (6 attempted) | 6/6 | 0% (0/6) | 33% (2/6) | 33% (2/6) | 17% (1/6) | 100% (6/6) | 7014 | 515.5 | QUALITY FAIL |
| dots-studio/dots-3-note-preview:free | baseline | 3 | 2/2 (2 attempted) | 2/2 | 0% (0/2) | 100% (2/2) | 100% (2/2) | 0% (0/2) | 0% (0/2) | 8144.5 | 603.5 | QUALITY FAIL |
| dots-studio/dots-3-note-preview:free | candidate | 1 | 4/4 (4 attempted) | 4/4 | 50% (2/4) | 100% (4/4) | 50% (2/4) | 75% (3/4) | 100% (4/4) | 7210.5 | 542.5 | QUALITY FAIL |
| dots-studio/dots-3-note-preview:free | candidate | 2 | 6/6 (6 attempted) | 6/6 | 0% (0/6) | 33% (2/6) | 33% (2/6) | 17% (1/6) | 83% (5/6) | 6898 | 471 | QUALITY FAIL |
| dots-studio/dots-3-note-preview:free | candidate | 3 | 2/2 (2 attempted) | 2/2 | 100% (2/2) | 100% (2/2) | 100% (2/2) | 100% (2/2) | 100% (2/2) | 8730 | 576.5 | PASS |

### Matched failure patterns

Counts concern complete, reviewed pairs only. Shared failure means both prompts failed that dimension; it does not prove a purely model-only cause. Candidate-only failures are comparative warnings, not statistical proof from a tiny sample.

| Model | Case | Dimension | Pairs reviewed | Both fail | Master only fails | Candidate only fails | Both pass |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dots-studio/dots-3-note-preview:free | corrected-export-design | continuity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | corrected-export-design | fidelity | 2 | 1 | 0 | 0 | 1 |
| dots-studio/dots-3-note-preview:free | corrected-export-design | grounding | 2 | 0 | 1 | 0 | 1 |
| dots-studio/dots-3-note-preview:free | corrected-export-design | structure | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft | continuity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft | fidelity | 2 | 0 | 0 | 1 | 1 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft | grounding | 2 | 0 | 0 | 1 | 1 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft | structure | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | debugging-reproduction | continuity | 2 | 2 | 0 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | debugging-reproduction | fidelity | 2 | 2 | 0 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | debugging-reproduction | grounding | 2 | 0 | 1 | 1 | 0 |
| dots-studio/dots-3-note-preview:free | debugging-reproduction | structure | 2 | 0 | 0 | 1 | 1 |
| dots-studio/dots-3-note-preview:free | missing-reason-and-unverified-status | continuity | 2 | 2 | 0 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | missing-reason-and-unverified-status | fidelity | 2 | 2 | 0 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | missing-reason-and-unverified-status | grounding | 2 | 2 | 0 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | missing-reason-and-unverified-status | structure | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | review-budget-draft | continuity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | review-budget-draft | fidelity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | review-budget-draft | grounding | 2 | 2 | 0 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | review-budget-draft | structure | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft-long-90000 | continuity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft-long-90000 | fidelity | 2 | 0 | 0 | 0 | 2 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft-long-90000 | grounding | 2 | 0 | 2 | 0 | 0 |
| dots-studio/dots-3-note-preview:free | continue-latest-draft-long-90000 | structure | 2 | 0 | 2 | 0 | 0 |

Sources:

- Review: evaluation\results\2026-10-10-prompt-v20-final-dots.review.json; report SHA-256: bdcf9f3beca4c16655d93de503de97659e27537de7a3aca184237e9ff0a5d2fc
- Reviewer: unspecified