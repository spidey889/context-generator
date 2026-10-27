# Provider routing and fallbacks

This is the detailed reference for the summary provider chain, settings, deadlines and recovery. [LOGIC.md](../LOGIC.md#configured-provider-order) retains the production architecture and its summary of this contract. The implementation is [api/summarize.js](../api/summarize.js); deployment configuration and available provider routes can change independently of source.

## When providers are used

The extension uses the captured transcript's untrimmed JavaScript `String.length`, including role and platform labels. Below 10,000 characters it builds an exact local carry without a backend request. From 10,000 through 1,000,000 characters it requests an AI summary; above 1,000,000 it rejects without clipping. The transcript also has a 4,000,000-byte UTF-8 limit. The serialized backend request has a separate 4,400,000-byte limit, so JSON escaping and message-array overhead can cause rejection even when the transcript is within its character limit. Backend profiles include a tiny local path for older clients. Capture and file-download limits are separate; see [LOGIC.md](../LOGIC.md#capture).

The captured text is untrusted input to the shared summary prompt. Useful output is accepted even if it is short, token-limited or has imperfect headings; refusals and substantively empty output advance the fallback chain. The checks cannot verify that all facts or constraints survived. See [summary validation](summary-validation.md) and the current prompt contract in [LOGIC.md](../LOGIC.md#prompt-and-output-policy).

Backend profiles determine output allowances, not provider priority. Word targets are guidance, not minimum accepted lengths or section quotas. The extension's 10,000-character cutoff above is separate from these backend profile boundaries.

| Backend profile | Input characters | Advisory words | OpenRouter / TokenHarbor / Mistral tokens | Gemini summary + reasoning tokens |
| --- | ---: | ---: | ---: | ---: |
| Tiny | 0–1,200 | Exact carry | 0 | No provider |
| Small | 1,201–8,000 | 350 | 1,000 | 1,500 + 5,000 |
| Medium | 8,001–60,000 | 700 | 1,900 | 3,000 + 6,000 |
| Large | 60,001–210,000 | 1,200 | 4,200 | 6,000 + 8,000 |
| Extra-large | 210,001–350,000 | 1,800 | 7,000 | 10,000 + 10,000 |
| Larger chats | 350,001–1,000,000 | 1,800 | 10,000 | Not routed to Gemini |

DeepSeek's 8,192 additional reasoning tokens are added to its listed cap. Limits describe the requested generation allowance, not a guarantee that a provider will produce a particular length or faithful summary.

## Configured order and switches

For generated summaries of up to 350,000 characters, routes run in this order. Missing keys and paused routes are skipped. The first provider returning usable context wins.

| Order | Route | Server-side configuration |
| --- | --- | --- |
| 1 | OpenRouter `dots-studio/dots-3-note-preview:free` | `OPENROUTER_API_KEY`; enabled by default, `OPENROUTER_DOTS_ENABLED=false` pauses it |
| 2 | OpenRouter `qwen/qwen3.8-27b:free`, then `google/gemma-4-26b-a4b-it:free` | Paused by default; enable individually with `OPENROUTER_QWEN_ENABLED=true` or `OPENROUTER_GEMMA_ENABLED=true` |
| 3 | TokenHarbor `deepseek-v4.1-flash:free`, main key | `TOKENHARBOR_API_KEY`; the global `TOKENHARBOR_ENABLED` and model's `enabled` flag are code switches in `api/summarize.js` |
| 4 | TokenHarbor `deepseek-v4.1-flash:free`, second key | Optional `TOKENHARBOR_BACKUP_API_KEY`; shares the main route's time slice |
| 5 | Google `gemini-3.6-flash`, then `gemini-3.5-flash-lite` | `GEMINI_API_KEY` |
| 6 | Mistral `ministral-14b-2512` | `MISTRAL_API_KEY`; `MISTRAL_ENABLED=false` pauses it |
| 7 | Exact `local-direct` carry | Used when routes are absent or exhausted, or funded work cannot be reserved |

`OPENROUTER_ENABLED=false` bypasses every OpenRouter model. Enabling a paused candidate requires the exact value `true`; check its availability and data policy first. The main TokenHarbor key uses the first enabled `TOKENHARBOR_MODELS` entry, currently DeepSeek. The backup uses the pinned DeepSeek model, including if the main key is absent; blank or duplicate keys are skipped. A failed main key may fall back to the second key only while shared time remains. There is no picker setting, random model selection, paid substitute or automatic provider model list. Ling and Apodex are retired from current routing; historical Ling/Space Bunny 2 receipts remain valid.

For **350,001–1,000,000 characters**, use only enabled OpenRouter Dots once, then the first configured TokenHarbor key once. No Qwen, Gemma, second TokenHarbor attempt, Google or Mistral route runs for these larger inputs. A backup key may be the first configured key when the main key is absent. If neither attempt succeeds, return the exact local carry.

## Time budgets and retry rules

- Through 350,000 characters, the chain has a 270-second absolute deadline. With both gateways configured, OpenRouter has up to 45 seconds and TokenHarbor has up to 45 seconds within a shared 90-second free-provider window. Enabled OpenRouter candidates divide its remaining stage time. TokenHarbor's main key, backup and retries share its own stage, starting on dispatch; neither a second key nor early OpenRouter failure renews it.
- The remaining 180 seconds are divided across configured Google/Mistral routes, at most 90 seconds each. The default chain is 45 / 45 / 60 / 60 / 60 seconds. Early completion advances immediately; unused time does not expand another stage. An expired free window skips free routes without skipping funded fallbacks.
- With TokenHarbor disabled or unconfigured, the first configured route gets at most 90 seconds and remaining routes divide the other 180 seconds, each capped at 90. With TokenHarbor but no OpenRouter, both TokenHarbor keys share the original 90-second free window.
- For larger inputs, each of the two eligible routes gets one attempt with up to 90 seconds to begin and complete an answer; the total chain is bounded at 180 seconds. There are no same-model network or HTTP retries in this path.
- For streamed smaller-input requests, DeepSeek has up to 45 seconds to start non-whitespace answer text; other models have 30 seconds. The remaining attempt deadline can shorten either allowance. Headers, heartbeats and hidden reasoning do not count as an answer. Silence advances without retrying the silent model; after answer text begins, the completion deadline still applies. A JSON response to a streamed request must finish inside the first-answer limit. Legacy non-streaming requests use their normal completion deadline.
- Temporary network/server failures and HTTP 500/502/503/504/529, including matching temporary error envelopes, get at most one retry after 450 ms within the original route deadline. Rate limits, authentication, billing, permission and other non-temporary errors advance immediately. OpenRouter 401/402 skips its other models because they share an account; 429 and model-specific errors retain the ordinary order. The TokenHarbor backup remains eligible after OpenRouter failures.
- Deadlines cover headers and body processing, and caller cancellation aborts pending provider work. A partial stream is not a successful summary. Cancelling cannot undo provider work already accepted upstream.

## Provider-specific requirements

- **OpenRouter:** use pinned free models, require support for supplied parameters, deny data collection, enforce zero prompt/completion/request prices, disable context compression and exclude hidden reasoning. If no endpoint qualifies, fall through rather than relaxing those requirements.
- **TokenHarbor:** use its OpenAI-compatible chat-completions endpoint and the same untrusted transcript envelope without OpenRouter-specific routing fields. DeepSeek gets 8,192 additional tokens for default reasoning; hidden thinking is excluded from streamed previews and the carry. Preserve `:free` and verify route terms and availability before changes.
- **Gemini:** Flash uses `MEDIUM` thinking and Flash-Lite uses `MINIMAL`, with the separate profile generation/reasoning allowances documented in [LOGIC.md](../LOGIC.md#profiles-and-exact-local-carries). Hidden thought parts do not enter the carry.
- **Mistral:** retain the prompt-cache namespace from `api/summary-prompt.js`; change it when prompt wording changes. Streamed content accepts strings or typed content blocks, but only text blocks enter previews and the carry.
- Provider responses use strict UTF-8 decoding. Invalid response content, refusal-only output, unfinished thinking and empty output fail safely; raw provider error bodies are not stored in telemetry.

## Funded work and recovery

Before each Gemini/Mistral HTTP attempt, including retries, reserve IP and global UTC-day work allowances in shared Redis. Units are serialized provider request bytes plus the maximum output-token allowance, not a dollar amount. Defaults are `FUNDED_SUMMARY_IP_DAILY_UNITS=2000000` and `FUNDED_SUMMARY_GLOBAL_DAILY_UNITS=10000000`. Zero disables funded work. Invalid limits, missing Redis configuration, exhausted allowances, store errors or the 450 ms store deadline stop the funded chain and return an exact local carry. Reservations are not refunded on failure or disconnect. Use `KV_REST_API_URL` / `KV_REST_API_TOKEN` or the existing `UPSTASH_REDIS_REST_*` aliases. OpenRouter and the pinned free TokenHarbor route are exempt.

Backend `local-direct` preserves the full verified transcript when no usable provider output is available; it does not compress the conversation. Separately, after verified capture, the source can build a local carry when the backend or worker cannot deliver a summary. Source recovery has no new server receipt. A request-size rejection remains an error rather than silently falling back. Neither recovery can restore content that capture failed to verify.

The worker calls the production backend with cookies omitted and redirects rejected. Keys stay server-side and never enter extension files, receipts or logs. Receipts record actual served provider/model, attempted chain, safe usage and timings; they are not proof of summary accuracy. Provider failure diagnostics contain bounded metadata, not conversation text or raw provider errors. Deploy matching Vercel configuration, telemetry Edge validator/receipt catalog and SQL allowlists before enabling a new provider. A source push, ready backend deployment and extension publication are separate states.

For diagnosis, `openrouterModelsTried` and `tokenharborModelsTried` record actual attempts; `tokenharborMs` includes both key slots, while `providerMs` and `initialMs` describe the served model. Paused or missing routes are not listed as tried. The worker shares concurrent requests for identical structured input and retains up to eight completed results for two minutes; cache hits preserve the original provider metadata. Source recovery after a backend transport or parsing failure can return the same exact transcript without a fresh signed receipt.

## Focused verification

Use the relevant deterministic checks when changing the chain: `node --test test/tokenharbor.test.js test/openrouter.test.js test/summary-stream.test.js test/flash-chain-budget.test.js test/flash-lite-fallback.test.js test/provider-body-timeout.test.js test/verified-telemetry.test.js test/background.test.js`. `npm run test:db` verifies database model allowlists and preservation when those contracts change. The optional `CAP_CONTEXT_TOKENHARBOR_SMOKE=1 CAP_CONTEXT_TELEMETRY_SMOKE=1 npm run test:extension-smoke` uses synthetic DeepSeek receipts with local SQL, not live AI calls. Live model quality and deployed configuration require separate evidence.
