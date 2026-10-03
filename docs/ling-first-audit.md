# Ling-first routing audit — October 3, 2026

Ling 3.1 Flash is now the primary OpenRouter route, with Apodex Mini enabled immediately after it. Latest Run displays Ling as **Space Bunny 2**; provider IDs, logs and receipts continue to use `inclusionai/ling-3.1-flash`. Qwen, Dots and Gemma remain paused. Master `a0c22d5` is still the remote master tip and is already merged into this branch.

## Changes and routing review

- Both Ling and Apodex default enabled; each can be paused independently. Global OpenRouter pause and missing keys still skip its routes. No random router or upstream automatic fallback list was added.
- The existing Vercel Ling flag changed from false to true across development/preview/production and was read back successfully. Apodex=true and all three paused flags=false, scopes and unrelated switches were preserved. No production redeployment was requested. Existing deployments do not establish this source change's live release state.
- With all configured production keys, the chain is Ling → Apodex → Gemini 3.6 Flash → Gemini 3.5 Flash-Lite → Ministral 14B → exact local carry. Budgets are 90/45/45/45/45 seconds within the unchanged absolute 270-second chain limit; retries and bodies share each slot. Missing keys/pauses recalculate the fallback allowance. Development has only the readable OpenRouter key, giving its two routes 90 seconds each.
- Shared OpenRouter 401/402 skips Apodex because it cannot repair the account/key. Model-specific errors, 429, malformed/error envelopes, empty/refusal output and unfinished thinking retain fallback order. Transient failures retry at most twice within the same slot. Paused models never execute implicitly. Privacy/parameter support, disabled compression/reasoning and zero-price routing remain identical for both models.
- Tightened the prompt and template hints to avoid inferring user identity from a named owner and to avoid converting absent information or confirmed states into invented questions. Advanced Mistral cache to v9. An initial template edit broke the exact hint matching used to reject empty templates; existing tests caught it and the final source preserves matching hints, with a comment documenting that coupling.

No factual entailment checker or strict length/shape rejection was added. A model can still return useful text containing unsupported facts or missing constraints, and structural flags remain advisory.

## Live results

Only synthetic transcripts were sent; credentials stayed in memory. The same inputs from the primary comparison were used, with the new prompt and both enabled OpenRouter routes.

| Case | Result |
| --- | --- |
| Short: 8,456 characters | Ling, 4,571 input tokens, 873 output tokens, 9.7 seconds, `stop`. |
| Original long: 305,869 characters | Ling, 109,439 input tokens, 1,336 output tokens, 33.7 seconds, `stop`. |
| Varied incident: 286,735 characters | Ling, 62,629 input tokens, 1,541 output tokens, 30.5 seconds, `stop`. |
| Controlled Ling 429, real incident fallback | Real Apodex response in 7.5 seconds; tried chain Ling → Apodex; truthful fallback metadata. |
| High-density token overflow: 320,055 characters | Both real OpenRouter endpoints returned context-limit HTTP 400; exact full local carry in 2.7 seconds. |

Ling preserved the original project's identifier, Windows 17/17 result, untested Linux, exact path/region/budget/owner, observed integrity fact and no-deploy state in the long output. Its incident output retained the start time, commit, intact data, accepted 8 MB/max-3 design, unimplemented status, no-deploy/rollback constraints and both unresolved jitter ranges, while distinguishing Mira from the user. Quoted hostile claims did not become operational state.

**Semantic errors remain.** Ling's original long response claimed 1,619 archived references; indices 0–1,619 actually represent 1,620. It also added Linux scheduling/authorization questions, and the short output called a stated integrity fact a requirement in one section. Apodex recovery falsely identified the user as Mira, called the timeout symptom a root cause and omitted the explicit “Do not deploy this change” prohibition. It also missed a required section, which the advisory acceptance gate correctly recorded but did not reject. These errors matter more than a clean transport response.

The temporary live timeout harness had only two configured routes and accidentally shortened **both** 90-second timers to 500 ms. Its Apodex timeout is excluded from live provider availability/recovery claims. The controlled two-route exhaustion case also does not establish five-route provider switching. Both raw cases are retained and explicitly marked in the artifact to prevent overstating evidence.

Production/preview Google and Mistral keys are sensitive, unreadable bindings; they were not copied or decrypted. A subsequent attempt to repeat real Apodex recovery in a controlled five-route configuration did not start because Vercel project API access returned 403. No further environment mutation was attempted. Five-route budgets, provider switching, stalled bodies and exact carry are covered by the deterministic tests below; no protected deployed preview is claimed verified for this patch.

## Verification and readiness

- Final full deterministic verification: **313/313 passed**. Existing cases were updated for Ling-first flags/receipts, three paused routes, Apodex recovery, shared-account bypass, Space Bunny 2 labels and exact 90/45/45/45/45 budgets. No new automated test cases were added.
- All six existing stalled-body cases passed with real local HTTP headers and controlled timers, including both default OpenRouter slots and HTTP 200/429/503 bodies. A restricted sandbox full run could not receive localhost headers; the final run with localhost access passed.
- Slow capture regression: **1/1 passed**.
- Isolated installed Brave smoke passed: all five placement fixtures, picker/no-capture interactions, exact paste, Send untouched, signed local telemetry and drained outbox. Backend response was stubbed; this is not live provider or hosted database evidence.
- Prior combined-branch verification of 23 migrations/348 SQL checks remains applicable; no database source changed and that gate was not rerun. No production deployment, hosted database mutation or master merge occurred.

**Routing implementation is mechanically ready; strict factual-preservation merge clearance remains on hold.** Ling improves the primary selection, but the live Apodex fallback still lost an explicit operational prohibition. Passing code checks and a stronger prompt do not fix that semantic acceptance risk. Retaining Apodex as requested preserves availability, with this known quality limitation.

The [safe evidence artifact](../evaluation/results/2026-10-03-ling-first-audit.json) contains input hashes, source hashes, full synthetic model summaries, classifications for invalid/controlled cases and verification limits. This small synthetic sample supports the relative Ling choice, not an accuracy percentage or production SLA. The earlier [comparison](openrouter-primary-comparison.md) and [routing audit](routing-audit.md) remain historical evidence. Vercel's [environment-variable API](https://vercel.com/docs/rest-api/projects/edit-an-environment-variable) was used for the single flag update.
