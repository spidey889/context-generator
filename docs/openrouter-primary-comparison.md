# OpenRouter primary comparison — October 3, 2026

**Recommendation: Ling 3.1 Flash is the best primary candidate among these five under the current request contract. This is a relative recommendation, not a zero-hallucination clearance.** Routing and Vercel flags remain unchanged; Apodex is still the enabled OpenRouter route.

## Fair comparison

Evaluated source `0605f26` using the existing Vercel development key in memory. Only synthetic conversations were sent. Each call enabled exactly one candidate in its process, supplied no Google/Mistral keys, and used the production router, current prompt, profile/output budget, temperature 0.1 and 90-second attempt budget. Required parameter support, denied data collection, enforced zero prompt/completion/request prices, disabled context compression and disabled/excluded reasoning for every model. No filter was relaxed to obtain a response.

- The original Apodex short and long inputs were reconstructed unchanged: 8,456 and 305,869 characters. The long input used approximately 109,300 prompt tokens. It tests exact identifiers, paths, budgets, owner, test results, negative facts, rejected proposals and a quoted hostile override amid archived chatter.
- An additional 286,735-character incident case used approximately 62,600 prompt tokens. It extends the existing `medium-incident-handoff` fixture with distributed archived discussions about copy, design, support, an unrelated project and a glossary. It adds a rejected alternative, an unconditional no-deploy instruction and a malicious quoted ticket. All five candidates received identical input bytes.
- The incident must retain ORBIT-427, billing export worker, eu-west-1, 14:35 UTC, 7ac91ef, intact customer data, healthy database/invoice paths, uploads above 24 MB, accepted 8 MB parts/at most 3 concurrent parts, rollback not approved because of the required tax fix, Mira, enterprise-2026-07.csv and implementation not started. Both jitter options remain open: 250–750 ms and 500–1500 ms. No test or deployment happened. The 16 MB/4-part/rollback alternative was rejected.
- Refreshed Apodex on both original inputs; repeated both long inputs for Ling and the incident input for Apodex. Retried Gemma sequentially after the initial burst. At most two calls ran concurrently.

There were **20 new live attempts: 15 model responses and five Gemma rate-limit failures**. The earlier two post-audit Apodex responses are also retained as reference evidence, outside that count. Results are app-facing summaries after the shared normalization, not raw HTTP response bodies. Manual semantic review takes precedence over string/anchor checks: an output can contain every required phrase and still reverse a decision elsewhere. Local carry counts as a failed generation, never as model accuracy.

## Ranking by factual usefulness

| Rank | Model | New usable responses | Observed accuracy issues | Long-case time |
| --- | --- | --- | --- | --- |
| 1 | Ling 3.1 Flash | 5/5 | Best preservation of exact current state, unresolved choices and unconditional prohibitions. Still inferred user identity on one repeat and added unsupported questions/verification conclusions. | Original long: 19.4–37.9 s; varied incident: 16.5–24.9 s |
| 2 | Apodex 1.1 Mini | 4/4 | Preserved operational anchors but repeatedly converted an observed integrity fact into a requirement, invented user ownership and expanded the agenda. The refreshed long response incorrectly placed the midpoint correction “near the end.” | Original long: 9.2 s; incident: 9.2–9.4 s |
| 3 | Dots3-Note Preview | 3/3 | Invented user acceptance and miscounted archived entries. In the incident, repeatedly claimed 500–1500 ms jitter was rejected while also listing it as unresolved. This changes an actual design decision. | Original long: 13.2 s; incident: 18.0 s |
| 4 | Qwen3.8 27B | 3/3 | Invented user identity/responsibilities, an established root cause and additional work. Reframed unconditional no-deploy as deployment without approval. Short output described the summarizer rather than the user. | Original long: 22.2 s; incident: 22.7 s |
| Unranked for accuracy | Gemma 4 26B A4B | 0/5 | All attempts returned HTTP 429. Follow-up diagnostics identified Google AI Studio upstream rate limiting; other routes succeeded on the same key. No model output exists to grade. Unsuitable for primary availability in this test window. | No generation |

These response counts are a small sample, not uptime estimates. Times include network/provider work and some repeat calls used cached prompt tokens; they are not a controlled speed benchmark. All successful calls finished with `stop`. Dots omitted the required header on its original long response; Qwen duplicated the destination section on the incident. The existing acceptance policy retains useful content with advisory flags, so neither structural nor semantic errors triggered another provider.

## Why Ling leads, and what still fails

The clearest separating example is retry jitter. Ling preserved both alternatives and explicitly said neither was selected. Dots invented a rejection, and Qwen surrounded the correct alternatives with fabricated user responsibilities, a claimed root cause and a broader implementation agenda. Apodex was substantially faster, but speed does not outweigh unsupported ownership and invented questions for this task.

Ling also explicitly retained “no customer data loss” as an observed fact in the original long case, kept Linux untested, kept the exact path/budget/region and preserved the unconditional prohibition. Those facts survived its repeat. Both incident responses kept the accepted design separate from implementation, tests and deployment, and did not import the unrelated project's owner/region/part size into the incident.

**Ling still fails a strict “no invented details anywhere” standard.** Its incident repeat says “The user is incident owner Mira,” although the source names the incident owner without identifying the user. That response also says no rollback state is recorded while elsewhere correctly preserving “rollback not approved.” The original short answer invents an unresolved deployment approval path; the original long answer adds export-file validation concerns. These are concrete semantic errors, even though the critical decisions remain correct. Prompt rules and structural flags do not prove factual entailment.

Choose Ling first if selecting a provisional free OpenRouter primary from this set. Do not describe that selection as guaranteeing faithful summaries or clearing the earlier master-merge accuracy concern. None of the tested generators was free of unsupported details. The current Apodex-first routing remains unchanged pending an explicit routing decision.

## Evidence and limits

Full summaries, safe failure diagnostics, input SHA-256 hashes, source commit, token usage and durations are in [the comparison artifact](../evaluation/results/2026-10-03-openrouter-primary.json). The three fixture hashes identify exact within-run inputs; filler was mechanically repeated and split at character offsets, so this is a synthetic long-context comparison with realistic incident facts, not a representative sample of real user histories. No general accuracy percentage is justified.

This does not measure sustained load, future availability, every language, maximum token-density conversations or production deployment. No provider window-overflow probes were repeated in this comparison; the earlier Apodex overflow-to-exact-carry evidence remains in [the routing audit](routing-audit.md). No runtime code, automated test cases, production settings, database or deployment changed; the large deterministic suite was not rerun for this evidence-only task.

OpenRouter lists [Ling as free with a 262,144-token window](https://openrouter.ai/inclusionai/ling-3.1-flash/), released October 2, 2026, so its track record is short. [Dots' free preview](https://openrouter.ai/dots-studio/dots-3-note-preview:free) is listed as going away December 31, 2026. Free routes remain subject to [account limits](https://openrouter.ai/docs/api/reference/limits) and provider availability; adding model IDs does not provide independent account quota. The existing [provider filters](https://openrouter.ai/docs/guides/routing/provider-selection) can narrow the available endpoint set and were held constant here.
