# Orca pause and final Flash-Lite fallback

Since 2026-09-18, OrcaRouter is paused by default in `api/summarize.js` (`handleSummary`). Its route, `ORCAROUTER_API_KEY`, and existing tests remain. To unpause, set `ORCAROUTER_ENABLED=true` in Vercel's production environment and redeploy. Removing that variable or setting it to any other value pauses Orca again. No key replacement or code deletion is necessary.

The active generated chain is Gemini Flash family -> Ministral 14B -> optional Groq -> Google `gemini-3.5-flash-lite` -> local transcript carry. Flash-Lite uses the existing `GEMINI_API_KEY` and Google's `generateContent` endpoint, not OpenRouter. It is attempted only after earlier remote routes fail; missing Groq configuration still proceeds to Flash-Lite. Without the Google key, Flash-Lite is skipped. Failed or empty Flash-Lite output proceeds to the unchanged full-transcript local carry.

`tryFlashLiteBeforeLocal()` inside `createSummaryWithFallback()` owns the last attempt. Flash-Lite uses `MINIMAL` thinking, the existing Google token allowance and hidden-thought filtering, and the temporary relaxed summary validation policy. It does not consume or consult Gemini Flash's daily-health records. Receipts record the actual Flash-Lite model while identifying the provider as the existing Google/Gemini API; `geminiMs` includes both Flash and Flash-Lite time.

The active remote allowance is 60s Flash + 55s Mistral + 15s Groq + 60s Flash-Lite = 190s. If Orca is unpaused, Flash-Lite subtracts Orca's elapsed attempt time from its 60s budget (minimum 1s), retaining roughly 19s of headroom under the extension's 210s timeout. This may leave Flash-Lite only a short attempt when Orca exhausts its allowance.

Focused verification: `node --test test/flash-lite-fallback.test.js test/summarize.test.js test/gemini-model-health.test.js`. Google's model/API contract: https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite . Free service availability and per-key quotas still apply.
