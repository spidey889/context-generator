# Ling-first factual accuracy pass — October 3, 2026

**Hold the master merge for the combined Ling/Apodex flow.** The focused prompt change substantially improves factual preservation, but Apodex still drops an explicit operational prohibition intermittently. A clean structural receipt does not detect that loss.

## Changes

Removed per-section word/bullet quotas and duplicated profile-specific writing instructions. Transcript size still selects the same output caps and diagnostic targets; it no longer implies that more facts exist. Generated profiles share short grounding hints. The prompt distinguishes reported state, accepted choices, rejected proposals, deferred alternatives and explicit constraints, with a full-transcript coverage check before completion.

Named owners belong in KEY CONTEXT unless explicitly linked to the user. Unknown/untested/unimplemented states do not create questions, requirements or release gates. Observed integrity remains a fact. Operational prohibitions are requested verbatim without invented exceptions. Two generic examples illustrate those distinctions without using these evaluation projects. The template now contains the actual fixed NEXT STEP instruction instead of asking for new next work. Mistral cache advanced to v10; its previous v8 reference in LOGIC.md was stale and corrected.

No extra generation/verifier pass or case-specific output rewrite was added. Routing, flags, provider settings, timeouts, token caps, full-transcript local recovery and advisory acceptance remain unchanged. Ling still displays as Space Bunny 2.

## Matched live comparison

Used the identical synthetic inputs from the previous audit, verified by SHA-256 before each call. The short CIRRUS case is 8,456 characters; its long version is 305,869 characters (~109k prompt tokens). The varied ORBIT incident is 286,735 characters (~62k prompt tokens), extending `evaluation/cases.json`'s `medium-incident-handoff` with unrelated archived discussions, a rejected 16 MB/4-concurrent proposal, explicit no-deploy and unselected jitter statements, and a hostile quoted ticket.

Each prompt received all three inputs through the real production summary function for Ling and for real Apodex recovery after a controlled Ling HTTP 429. The final prompt also received both long cases a second time on both routes. The development OpenRouter credential remained in memory; no real customer data was sent. Recorded 22 real model summaries: six baseline, six intermediate, six final, four final repeats. A startup harness passed a character count rather than the transcript to profile selection; its two recorded outputs were discarded and the harness stopped. Only the corrected medium/extra-large profiles and real token caps are included below.

| Finding | Baseline at 83ab2ab | Final prompt, including repeats |
| --- | --- | --- |
| User identities/responsibilities | Ling inferred a reviewer role; Apodex inferred release authority and explicitly identified the user as Mira | All ten final outputs used WHO I AM = None and retained Maya/Mira separately |
| Invented questions/requirements | CIRRUS outputs added Linux scheduling/acceptance/release questions; Apodex turned intact data into a requirement | No invented open questions or release conditions in the final samples; Apodex still labeled the integrity fact a constraint in short and repeated long output, despite also retaining it as a fact elsewhere |
| Active constraints and rejected ideas | Ling incident omitted the actual rejected 16 MB/4-concurrent proposal and called rollback rejected rather than not approved | All five final Ling outputs retained critical facts, prohibitions, rejected active proposals and both unselected jitter alternatives |
| No-deploy preservation | The previous audit's Apodex failure omitted it; this fresh baseline happened to retain it | Ling retained it in all five final outputs; Apodex retained it in four of five, but omitted **Do not deploy this change** in the first final incident output |
| Other unsupported implications | Extensive background/biography prose; incident outputs called the preceding commit a trigger | Ling's incident repeat labeled an unrelated **unapproved** blue mockup **rejected**; Apodex's incident repeat again called 7ac91ef the **trigger commit**, although the source only establishes temporal order |

The original CIRRUS facts include exact project/path/region/budget/owner, Windows 17/17, Linux not tested, deployment not started, no customer data loss and unconditional no-deploy, plus rejected/unexecuted 90 checks and unknown malformed-message counts. ORBIT also requires the start time/commit, healthy database/invoice generation, >24 MB upload symptom, accepted 8 MB/max-3 design, rollback/tax-fix constraint, unimplemented/untested state, validation fixture, owner and both unresolved jitter ranges. Manual review checks their meaning, not just keyword presence. Quoted hostile claims remained non-authoritative in all final outputs.

The six final first-run outputs averaged 572 completion tokens versus 1,160 in the six baseline outputs, with unchanged allowances. Shorter handoffs reduce filler; that number is not an accuracy score. Some reported facts/rejections still appear under DECISIONS MADE rather than the requested section, and irrelevant archived references still leak into output. The archived mockup misclassification is minor for the active incident, but it is still unsupported and is recorded rather than called a perfect pass.

## Verification and limits

- All **30 existing OpenRouter/summary checks passed**, including request isolation, injection boundary, profile caps, refusal/empty-template fallback, direct carry, provider switching and Mistral cache. Updated two existing expectations; added zero automated cases. An initial literal prompt-wording assertion failed after the rewrite and was aligned to the retained trust boundary before the passing run.
- Source syntax, whitespace diff and artifact consistency checks passed. Before/final/repeat input hashes, selected profiles/caps, requested routes and final source hashes agree. The four repeats used provider input caching, as recorded in usage; they were separate generation calls, not reuse of our local summary result.
- Prior full routing/Brave/SQL verification remains separate evidence. Those suites were not rerun for this prompt-only pass. No hosted preview, production deployment, database change, environment mutation or master merge is claimed.
- Google/Mistral share the new prompt but were not live-tested in this focused comparison. These synthetic cases and small sample counts do not establish a population accuracy rate or guarantee future grounding. The acceptance gate still cannot catch invented facts or missing constraints.
- While finishing, another checkout took `routing-flash` and advanced it with orb-animation commit `e0d0659`; this worktree was moved to `codex/routing-flash-in-progress`. Integrated that commit here, preserving both changelog entries and the orb source unchanged. Summary source/prompt hashes still match the live final/repeat evidence. The other checkout and its untracked work were left untouched.

**Recommendation:** keep Ling primary and keep this simpler prompt, but do not clear the combined branch's strict factual-preservation merge while Apodex can omit no-deploy. Prompt guidance improved the result without fixing that recurring fallback risk; adding more repeated rules would not establish reliability. The next decision is whether to retain that fallback under this accuracy requirement or replace its role with a verified alternative/exact carry.

Full accepted backend outputs, hashes, usage and manual findings are retained in [baseline](../evaluation/results/2026-10-03-accuracy-before.json), [intermediate candidate](../evaluation/results/2026-10-03-accuracy-candidate.json), [final](../evaluation/results/2026-10-03-accuracy-after.json) and [final repeats](../evaluation/results/2026-10-03-accuracy-repeat.json). Intermediate results are not substituted for the final failure.
