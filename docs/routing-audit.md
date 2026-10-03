# Routing audit — October 3, 2026

Scope: `routing-flash` after merging master `a0c22d5`. Reviewed provider adapters, prompts, output acceptance, flags, the complete fallback chain, request/body/retry deadlines, receipts/cache, recovery and branch history. This is source and synthetic-provider evidence, not production deployment clearance.

## Findings and fixes

| Finding | Result |
| --- | --- |
| The prompt demanded expansion below a word floor even when few supported facts existed | Budgets are now advisory; grounded facts take precedence. Added explicit prohibitions on invented counts, roles, gates and questions, with unchanged useful-output acceptance. Mistral prompt cache advanced to v8. |
| OpenRouter could choose endpoints that ignore supplied parameters | Required parameter support. Explicitly disabled context compression so token overflow fails into fallback instead of relying on router defaults. The real Apodex endpoint accepts both settings. |
| Enabled OpenRouter backups retried a rejected shared key/account | 401/402, including numeric codes in HTTP-200 error envelopes, skip remaining OpenRouter routes for that request. 403/404/429 and model-specific failures retain ordinary fallback. |
| Arbitrary provider error-code strings were reflected into logs | Removed the raw-code helper and unused extraction. An in-memory replay of the prior commit reflected the synthetic sentinel; the fixed version did not. Numeric HTTP status and fixed diagnostics remain. |
| An old Mistral-only model-selection helper had no runtime or test callers | Removed it; the configured-route selection remains the single implementation. |

The first route still gets 90 seconds; defaults divide the remaining 180 seconds into three 60-second slots. The absolute chain limit remains 270 seconds, including response-body reads and retries. Paused routes never execute unless enabled explicitly. First useful output wins; exhausted providers return the full transcript. No strict word-floor rejection or extra inference pass was introduced.

## Live evidence

Only synthetic transcripts were sent. The inherited local key returned 401, exercising exact local recovery; it was not counted as an Apodex accuracy check. The existing Vercel development key passed authenticated validation. Production/preview/development bindings still enable OpenRouter and Apodex and pause Qwen, Dots, Gemma and Ling; no settings changed.

| Post-fix case | Evidence |
| --- | --- |
| Short, 8,456 characters | Apodex; 4,438 prompt tokens, 750 completion tokens, 5,464 ms, finish `stop`. |
| Long, 305,869 characters | Apodex; 109,354 prompt tokens, 1,291 completion tokens, 10,179 ms, finish `stop`. |
| Token overflow, 320,055 characters | Apodex HTTP 400; exact 320,000-character high-token-density body retained in local carry, 387 ms. |

Both usable Apodex responses retained CIRRUS-241, Windows 17/17, Linux untested, the Windows export path, eu-north-1, USD 37.45, Maya and the no-deploy state. The quoted hostile email did not become authority. These checks establish transport and selected fact retention, not a general accuracy percentage.

The baseline output invented a Linux-dependent exception to the no-deploy instruction. The hardened long output preserved the unconditional prohibition, but still invented questions about email escalation and outside deployment artifacts, and described the stated fact “No customer data loss” as a requirement. Prompt hardening reduced particular errors; it did not eliminate unsupported inference. The active acceptance gate checks content/shape, not entailment against the transcript.

## Verification and decision

- One combined deterministic run: 313/313 passed. After the final logging simplification: 49/49 focused routing, summary, body-timeout, budget, fallback and signed-receipt checks passed; the case-insensitive redaction assertion also passed. Existing cases were extended/reused, with no added cases.
- The immediately preceding merge verification passed 348 SQL checks, the long-scroll regression and installed Brave transfer/relay/Edge/database smoke. Database, extension runtime and browser harness were unchanged by this audit, so those checks were not repeated.
- No hosted database, Vercel environment or production deployment changed. Provider calls used the development key in memory; credentials were not saved in source or audit artifacts.

**Recommendation: hold the master merge with Apodex first.** The implementation and fallback mechanics pass verification, but the requested factual reliability is not established and live semantic errors remain. Reconsider the primary model/order before release and retain representative factual evaluations when switching to paid inference. Free account quotas and endpoint availability are shared external constraints; more free model IDs do not remove them. Exact local carry avoids compression errors but can exceed a destination model's own context limit.

Subsequent evidence: [the matched-input primary comparison](openrouter-primary-comparison.md) recommends Ling over Apodex on factual usefulness, but found unsupported details in every generator that produced outputs. It leaves routing unchanged and does not remove this accuracy hold.

Later source cutover: [the Ling-first configuration audit](ling-first-audit.md) enables Ling with Apodex retained as fallback and verifies the new five-route budgets. Its mechanical checks pass, but live fallback lost a no-deploy prohibition, so strict factual-preservation clearance remains on hold.

Primary references: [OpenRouter parameter/data routing](https://openrouter.ai/docs/guides/routing/provider-selection), [context compression](https://openrouter.ai/docs/guides/features/message-transforms), [Apodex catalog](https://openrouter.ai/apodex/apodex-1.1-mini:free), [account limits](https://openrouter.ai/docs/api/reference/limits).
