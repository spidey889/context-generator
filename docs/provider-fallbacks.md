# Provider switches and time limits

The default source chain is Ling 3.1 Flash through OpenRouter -> Gemini 3.6 Flash -> Gemini 3.5 Flash-Lite -> Ministral 3 14B -> exact full-transcript local carry. Latest Run calls Ling **Space Bunny 2**. First usable output wins. Tiny chats (up to 1,200 characters) stay local.

One server-only `OPENROUTER_API_KEY` serves four pinned OpenRouter routes:

| Route | Switch | Default |
| --- | --- | --- |
| `inclusionai/ling-3.1-flash` | `OPENROUTER_LING_ENABLED` | Enabled |
| `qwen/qwen3.8-27b:free` | `OPENROUTER_QWEN_ENABLED` | Paused |
| `dots-studio/dots-3-note-preview:free` | `OPENROUTER_DOTS_ENABLED` | Paused |
| `google/gemma-4-26b-a4b-it:free` | `OPENROUTER_GEMMA_ENABLED` | Paused |

Set a paused route's switch to the exact value `true` to enable it, then redeploy. Enabled OpenRouter routes keep the table order, before Google. `OPENROUTER_LING_ENABLED=false` pauses Ling. `OPENROUTER_ENABLED=false` bypasses OpenRouter entirely; missing its key does the same. Ling has no `:free` suffix, so every request additionally enforces zero prompt/completion/request pricing. Dots' current catalog expiration is December 31, 2026: verify its availability before resuming it. The retired `OPENROUTER_APODEX_ENABLED` flag has no effect; a stale deployed value cannot restore that removed route.

OpenRouter requests restrict endpoints with `data_collection: deny` and `require_parameters: true`, and explicitly disable the context-compression plugin. No eligible endpoint or an oversized token context means fallback, never weakening the filter or clipping input. Existing provider keys/settings were not changed for this removal. `MISTRAL_ENABLED=false` pauses Mistral; Google needs `GEMINI_API_KEY` and Mistral needs `MISTRAL_API_KEY`.

The first configured route gets 90 seconds; subsequent routes share the remaining 180 seconds evenly, capped at 90 seconds per route. Default four-route budgets are 90/60/60/60 seconds. Without OpenRouter, the previous 90/90/90 budgets remain. A shared 270-second deadline also caps the whole chain if additional routes are enabled. Vercel's server maximum is 300 seconds and the extension waits 320 seconds. HTTP 429 advances immediately; transient failures get at most two attempts within the same budget, including JSON body reads.

HTTP-200 error envelopes and failed/filtered choices also advance safely. A shared OpenRouter 401/402 bypasses its remaining models for that request; changing the model cannot fix the rejected key/account. Model-specific errors and 429s retain the ordinary fallback order. Hidden reasoning is excluded, output uses existing profile caps, and useful token-limited text retains advisory quality flags. All remote failures return the complete transcript without truncation. Receipts record actual attempts, served provider/model, token usage and provider timings; paused models never appear as tried.

Generated sections have no word/bullet quotas; the prompt prioritizes supported facts, verbatim constraints and unresolved alternatives over length. Output acceptance still cannot establish factual accuracy. The [focused accuracy comparison](summary-accuracy-pass.md) records the earlier Ling/Apodex behavior that led to removing Apodex; its results remain historical evidence, not a fresh evaluation of the remaining fallbacks. The combined Ling-first routing has been merged into master; no new provider requests were made for the route removal, integration or landing.

Changing environment variables or pushing this branch does not update an existing production deployment. Production release remains a separate deployment step. Free-model availability and shared OpenRouter account limits remain external constraints; switching free models does not bypass those limits.

Focused checks: `node --test test/openrouter.test.js test/flash-chain-budget.test.js test/flash-lite-fallback.test.js test/provider-body-timeout.test.js test/summarize.test.js test/analysis.test.js`.

References: [provider routing and price/data filters](https://openrouter.ai/docs/guides/routing/provider-selection), [reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [model catalog](https://openrouter.ai/api/v1/models).
