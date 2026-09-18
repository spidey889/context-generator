# Provider pauses and time limits

The active chain is Gemini 3.6 Flash -> Ministral 3 14B -> Google Gemini 3.5 Flash-Lite -> full local transcript carry. Each active model has a 90-second request budget including retries. Fluid Compute is enabled on Vercel Hobby; the server maximum is 300 seconds, active remote allowance is 270 seconds, and the extension waits 320 seconds. Fast errors advance immediately; the first success stops the chain.

Paused routes retain their keys and implementation. Set the following production environment switches to exactly `true` and redeploy to restore them:

- `GEMINI_FLASH_FALLBACKS_ENABLED`: Flash 3.7, 3.8, and regular 3.5. Restored Flash routes share the 90-second family allowance by dividing remaining time across remaining model slots.
- `ORCAROUTER_ENABLED`: OrcaRouter Free, before Mistral, with its retained 60-second budget.
- `GROQ_ENABLED`: Groq Compound Mini, after Mistral, with its retained 15-second budget.

Unset or non-true switches pause those routes. Restoring Orca/Groq deducts their elapsed attempt times from Flash-Lite's 90 seconds; exhausted allowance proceeds straight to local carry. Review timing before restoring routes: extra attempts trade away final-model time.

Flash-Lite uses the existing Google key, MINIMAL thinking, existing token allowance and hidden-thought filtering, and advisory summary validation. It does not consult Flash's daily-health records. Failed or empty output preserves the full captured transcript locally. Receipts identify the actual model and include both Google routes in geminiMs.

Focused checks: node --test test/flash-chain-budget.test.js test/flash-lite-fallback.test.js test/summarize.test.js test/gemini-model-health.test.js test/background.test.js.
