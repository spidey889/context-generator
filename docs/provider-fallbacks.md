# Provider switches and time limits

The source chain is Apodex 1.1 Mini through OpenRouter -> Gemini 3.6 Flash -> Gemini 3.5 Flash-Lite -> Ministral 3 14B -> exact full-transcript local carry. First usable output wins. Tiny chats (up to 1,200 characters) stay local.

One server-only `OPENROUTER_API_KEY` serves all five pinned OpenRouter routes:

| Route | Switch | Default |
| --- | --- | --- |
| `apodex/apodex-1.1-mini:free` | `OPENROUTER_APODEX_ENABLED` | Enabled |
| `qwen/qwen3.8-27b:free` | `OPENROUTER_QWEN_ENABLED` | Paused |
| `dots-studio/dots-3-note-preview:free` | `OPENROUTER_DOTS_ENABLED` | Paused |
| `google/gemma-4-26b-a4b-it:free` | `OPENROUTER_GEMMA_ENABLED` | Paused |
| `inclusionai/ling-3.1-flash` | `OPENROUTER_LING_ENABLED` | Paused |

Set a paused route's switch to the exact value `true` to enable it, then redeploy. Enabled OpenRouter routes keep the table order, before Google. `OPENROUTER_ENABLED=false` bypasses OpenRouter entirely; missing its key does the same. Ling has no `:free` suffix, so every request additionally enforces zero prompt/completion/request pricing. Dots' current catalog expiration is December 31, 2026: verify its availability before resuming it.

OpenRouter requests restrict endpoints with `data_collection: deny`; no eligible endpoint means fallback, never weakening the filter. The key is configured in Vercel production/preview as sensitive and development as encrypted. Apodex and the global switch are explicitly `true`, the other four explicitly `false`, in all three scopes. Existing provider keys and settings are retained. `MISTRAL_ENABLED=false` pauses Mistral; Google needs `GEMINI_API_KEY` and Mistral needs `MISTRAL_API_KEY`.

The first configured route gets 90 seconds; subsequent routes share the remaining 180 seconds evenly, capped at 90 seconds per route. Default four-route budgets are 90/60/60/60 seconds. Without OpenRouter, the previous 90/90/90 budgets remain. A shared 270-second deadline also caps the whole chain if additional routes are enabled. Vercel's server maximum is 300 seconds and the extension waits 320 seconds. HTTP 429 advances immediately; transient failures get at most two attempts within the same budget, including JSON body reads.

HTTP-200 error envelopes and failed/filtered choices also advance safely. Hidden reasoning is excluded, output uses existing profile caps, and useful token-limited text retains advisory quality flags. All remote failures return the complete transcript without truncation. Receipts record actual attempts, served provider/model, token usage and provider timings; paused models never appear as tried.

Changing environment variables or pushing this branch does not update an existing production deployment. Production release remains a separate deployment step. Free-model availability and shared OpenRouter account limits remain external constraints; switching free models does not bypass those limits.

Focused checks: `node --test test/openrouter.test.js test/flash-chain-budget.test.js test/flash-lite-fallback.test.js test/provider-body-timeout.test.js test/summarize.test.js test/analysis.test.js`.

References: [provider routing and price/data filters](https://openrouter.ai/docs/guides/routing/provider-selection), [reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [model catalog](https://openrouter.ai/api/v1/models).
