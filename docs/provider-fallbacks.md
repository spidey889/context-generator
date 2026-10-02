# Provider pauses and time limits

Mistral is resumed in production with `MISTRAL_ENABLED=true`. Set it to `false` and redeploy to pause; set it to `true` or remove it and redeploy to resume. Its key and 90-second budget are retained.

The active production chain is Gemini 3.6 Flash -> Google Gemini 3.5 Flash-Lite -> Ministral 3 14B -> full local transcript carry. Each active model has a 90-second request budget including retries. Fluid Compute is enabled on Vercel Hobby; the server maximum is 300 seconds, active remote allowance is 270 seconds, and the extension waits 320 seconds. Fast errors advance immediately; the first success stops the chain.

Additional Flash models retain their implementation. Set the following production environment switch to exactly `true` and redeploy to restore them:

- `GEMINI_FLASH_FALLBACKS_ENABLED`: Flash 3.7, 3.8, and regular 3.5. Restored Flash routes share the 90-second family allowance by dividing remaining time across remaining model slots.

An unset or non-true switch pauses those Flash models. Restored Flash routes share the first 90-second family slot; Flash-Lite and Mistral each keep their own 90-second slot. Total remote time remains within 270 seconds.

Flash-Lite uses the existing Google key, MINIMAL thinking, existing token allowance and hidden-thought filtering, and advisory summary validation. Failed or empty Flash-Lite output advances to Mistral; exhaustion of all configured remote routes preserves the full captured transcript locally. Receipts identify the actual model and include both Google routes in geminiMs.

Focused checks: node --test test/flash-chain-budget.test.js test/flash-lite-fallback.test.js test/summarize.test.js test/background.test.js.
