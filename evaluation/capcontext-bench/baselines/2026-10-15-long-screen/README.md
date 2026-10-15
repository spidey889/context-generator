# October 15 long screen

Exactly four new generation requests, one per model, with no retries or judge calls. The existing long-history generator surrounds the same short-screen source conversation with unrelated synthetic archive turns, preserving every original turn in order and the original gold. Actual input: **90,029 characters**, plus a shared **7,824-character v21 system prompt**. The key two-upload correction sits between substantial archive blocks. No customer conversation was used.

| Model | Reviewed rank | Continuity | Fidelity | Grounding | Delivered structure | Response |
| --- | --- | --- | --- | --- | --- | --- |
| DeepSeek V4.1 Flash | 1, tied | Pass | Pass | Pass | Pass | 11.602 s |
| MiMo V2.6 Flash | 1, tied | Pass | Pass | Pass | Pass | 9.782 s |
| Haiku 5.5 | 3 | Pass | Concern | Concern | Pass | 6.645 s |
| Dots3 Note Preview | 4 | Pass | Fail | Fail | Pass | 9.523 s |

All four retained the essential facts, corrected upload count, exact target/error, pending proposal and retry choices. DeepSeek and MiMo preserved rollback as unapproved. Haiku correctly says that in DECISIONS but later adds the ambiguous label `Rejected: rollback is not approved`; its conservative fidelity/grounding failures are one shared label concern, open to owner review. Dots explicitly says `reject rollback` and adds a `no rollback` constraint absent from the source. The review ranks that stronger claim below Haiku's inconsistent label. Ranks are qualitative single-case judgments, not percentages or general reliability.

All delivered structures pass. Production normalized DeepSeek's irregular box border and Dots' mixed-case heading. No transcript or summary was clipped, and no output-token cap was set. Temperature was 0.1; responses were non-streaming. TokenHarbor retained native model defaults; Dots used the existing free/private OpenRouter guard and dedicated encrypted test key. Model labels are gateway-reported, not independently authenticated upstream identities.

Times are one complete HTTP/JSON observation per model, including gateway/network effects, before offline delivery processing. DeepSeek reports **1,024 cached prompt tokens**; Dots reports zero; Haiku/MiMo do not report cache usage. These are not uniformly uncached measurements or statistically reliable speed rankings. Compared with the earlier short screen, the production profile's output guidance also changes, and request timeout is 180 rather than 90 seconds. Length alone therefore does not isolate a cause or establish long-context superiority. The repetitive distractors are an inexpensive controlled screen, not a realistic customer-history distribution.

[generations.json](generations.json) preserves the complete long source, shared prompt, hashes, every output, timing and usage. [review.json](review.json) binds source-based judgments and the existing deterministic structure/exact-text checks to the report hash. The key was supplied through masked stdin and was not saved. Existing outputs are never retried automatically.

Re-render the [matching dark image](../../model-ranking-dark-2026-10-15-long.png) offline:

```powershell
python evaluation/capcontext-bench/render-screen-2026-10-15.py --long-history
```

The [short screen](../2026-10-15-small-screen/README.md), long screen and historical archive remain separate cohorts. This request added four generations, bringing the short-plus-long experiment to eight total.
