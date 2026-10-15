# Provider switches and time limits

The configured order is TokenHarbor Haiku -> OpenRouter Dots -> Gemini Flash -> Gemini Flash-Lite -> Mistral -> exact local carry. Missing keys and paused routes are skipped. The current contract is [LOGIC.md](../LOGIC.md#configured-provider-order); old provider trials remain in the changelog.

| Route | Server key / switch | Default |
| --- | --- | --- |
| TokenHarbor `claude-haiku-5.5:free` | `TOKENHARBOR_API_KEY`; `TOKENHARBOR_ENABLED` and model flags in `api/summarize.js` | Enabled when key exists |
| TokenHarbor `deepseek-v4.1-flash:free` | Same key and code flags | Paused |
| OpenRouter `dots-studio/dots-3-note-preview:free` | `OPENROUTER_API_KEY`; `OPENROUTER_DOTS_ENABLED=false` pauses | Enabled |
| OpenRouter `qwen/qwen3.8-27b:free` | `OPENROUTER_QWEN_ENABLED=true` | Paused |
| OpenRouter `google/gemma-4-26b-a4b-it:free` | `OPENROUTER_GEMMA_ENABLED=true` | Paused |
| Google `gemini-3.6-flash`, then `gemini-3.5-flash-lite` | `GEMINI_API_KEY` | Enabled when key exists |
| Mistral `ministral-14b-2512` | `MISTRAL_API_KEY`; `MISTRAL_ENABLED=false` pauses | Enabled when key exists |

Only the first enabled TokenHarbor model is selected. `OPENROUTER_ENABLED=false` bypasses all OpenRouter models; enabled entries keep table order. Retired Ling and Apodex flags have no effect. Never substitute a paid model, strip `:free` or use automatic model selection. The [Haiku free route](https://tokenharbor.ai/models/claude-haiku-5.5:free) is explicitly never billed; recheck terms and availability before changing routes.

Optional server-only `TOKENHARBOR_BACKUP_API_KEY` tries the same model if the main key fails, after existing temporary retries and within the original TokenHarbor time slice. Both rejected keys continue to Dots; a fully exhausted slice skips backup. Blank/duplicate keys are skipped, backup-only configuration works, and neither key enters receipts or logs. TokenHarbor account verification and shared account limits still apply; another key does not guarantee additional quota.

Transcripts under 10,000 characters and 350,001-500,000 characters use exact local carries; above 500,000 fails without clipping. The frontend handles admitted local carries without a backend summary request. Remote summaries use the existing profile output caps, with extra thinking room only for the paused TokenHarbor DeepSeek route.

TokenHarbor and OpenRouter share one 90-second free-provider window. With both configured, Haiku gets at most 45 seconds and Dots uses the remaining window. The three funded routes then receive at most 60 seconds each, within the unchanged 270-second chain deadline. Without TokenHarbor, the original first-route 90-second allocation and remaining-route division apply. Vercel allows 300 seconds and the worker waits 320 seconds.

Streamed routes must start visible answer text within 30 seconds; paused TokenHarbor DeepSeek may use its existing 45-second slice for thinking. Headers, heartbeats and hidden thinking never stop that watchdog. Gateway thinking blocks are removed from previews even when tags split across chunks. Silence advances without retrying that model. Other temporary failures get one retry inside the same route budget; auth, billing, permission and rate-limit failures advance immediately. OpenRouter 401/402 skips its remaining models for that request; TokenHarbor failure never disables the separate OpenRouter account.

OpenRouter requires zero endpoint pricing, `data_collection: deny`, parameter support and disabled context compression. TokenHarbor receives the shared untrusted transcript envelope without OpenRouter-specific fields. Gemini/Mistral retain their shared funded-work reservations. Keep complete input, strict UTF-8/JSON/SSE parsing, cancellation and final content validation. Failed remote routes preserve the exact transcript locally.

The extension calls the public production endpoint with cookies omitted and redirects rejected. A new provider needs its production Vercel key scope plus matching telemetry Edge receipt/model catalogs and SQL allowlists before activation. A Git push, ready deployment and installed extension update are separate states. Receipts report actual attempts, provider/model, token usage and timings; paused or missing-key routes never appear as tried.

Focused checks: `node --test test/tokenharbor.test.js test/openrouter.test.js test/summary-stream.test.js test/flash-chain-budget.test.js test/verified-telemetry.test.js test/background.test.js`. `npm run test:db` verifies model allowlists and preservation; `CAP_CONTEXT_TOKENHARBOR_SMOKE=1 CAP_CONTEXT_TELEMETRY_SMOKE=1 npm run test:extension-smoke` exercises synthetic Haiku receipts through installed Brave and local SQL without live AI calls.
