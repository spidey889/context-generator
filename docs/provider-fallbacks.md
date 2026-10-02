# Provider pauses and time limits

Mistral is resumed in production with `MISTRAL_ENABLED=true`. Set it to `false` and redeploy to pause; set it to `true` or remove it and redeploy to resume. Its key and 90-second budget are retained.

The active production chain is Gemini 3.6 Flash -> Google Gemini 3.5 Flash-Lite -> Ministral 3 14B -> full local transcript carry. Each active model has a 90-second request budget including retries. Fluid Compute is enabled on Vercel Hobby; the server maximum is 300 seconds, active remote allowance is 270 seconds, and the extension waits 320 seconds. Fast errors advance immediately; the first success stops the chain.

Paused routes retain their keys and implementation. Set the following production environment switches to exactly `true` and redeploy to restore them:

- `GEMINI_FLASH_FALLBACKS_ENABLED`: Flash 3.7, 3.8, and regular 3.5. Restored Flash routes share the 90-second family allowance by dividing remaining time across remaining model slots.
- `ORCAROUTER_ENABLED`: OrcaRouter Free, after Flash-Lite and before Mistral, with its retained 60-second budget.

Unset or non-true switches pause those routes. When the Google key is configured, restoring Orca deducts its elapsed attempt time from Mistral's final 90-second slot. The first two Google routes keep their 90-second budgets. The total remains within 270 seconds; restored routes trade away final-model time.

Flash-Lite uses the existing Google key, MINIMAL thinking, existing token allowance and hidden-thought filtering, and advisory summary validation. It does not consult Flash's daily-health records. Failed or empty Flash-Lite output advances to Mistral; exhaustion of all configured remote routes preserves the full captured transcript locally. Receipts identify the actual model and include both Google routes in geminiMs.

Focused checks: node --test test/flash-chain-budget.test.js test/flash-lite-fallback.test.js test/summarize.test.js test/gemini-model-health.test.js test/background.test.js.
