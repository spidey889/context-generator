# Cap Context Production Logic

This is the single source of truth for current production behavior. Historical decisions and replaced approaches live in `CHANGELOG.md`.

## Production Surface

- `index.html`: dependency-free marketing site served from the repository root on Vercel and GitHub Pages.
- `extension/manifest.json`: Manifest V3 hosts, permissions, service worker, content scripts, analysis bridge, and assets.
- `extension/platform-content.js`: picker, capture, handoff UI, paste, manual-copy recovery, placement, and Latest Run receipt creation.
- `extension/background.js`: tab orchestration, one backend job per transfer, identical-job deduplication, short result cache, receipt expiry alarm, and paste relay.
- `extension/analysis-bridge.js` and `analysis/index.html`: Latest Run analysis on GitHub Pages.
- `supabase/functions/transfer-telemetry`: strict metadata-only transfer ingestion into Supabase.
- `supabase/migrations/`: production database changes, including keeping `transfer_events` unavailable through the anonymous Data API.
- `api/request-security.js`: endpoint trust boundary, request validation, limits, and abuse controls.
- `api/summarize.js`: profiles, isolated provider requests, fallback chain, output validation, normalization, and timing.
- `evaluation/cases.json` and `scripts/run-regression-eval.js`: versioned quality/latency cases and live endpoint scoring.
- `scripts/run-extension-smoke.js`: isolated Brave smoke for the real unpacked extension.
- `test/` and `.github/workflows/regression-gate.yml`: deterministic regressions and the production gate.

Production deploys from `master` to `https://context-generator-five.vercel.app/api/summarize`. `vercel.json` gives the summary function a 240-second ceiling.

## Marketing Website

The root `index.html` uses relative assets, has no build step or runtime API dependency, lazy-loads below-fold images, and respects reduced motion. Its public install path is the Chrome Web Store for Chrome and Brave. The interactive handoff console is local illustration only and never captures a conversation or starts a transfer.

Marketing claims must match production: Claude, ChatGPT, Gemini, Grok, and DeepSeek support; a 350,000-character conversation limit; no capture or provider processing before destination selection; 24-hour local raw-transcript diagnostics; and no automatic Send action. `index.legacy-2026-07-15.html` is an inactive archive. `cap-context-extension.zip` is a release/developer artifact, must contain the contents of `extension/` with `manifest.json` at its root, and must be regenerated after tracked extension changes.

## Platforms And Startup

Cap Context supports Claude, ChatGPT, Gemini, Grok, and DeepSeek. ChatGPT access is limited to `chatgpt.com`, its subdomains, and the legacy `chat.openai.com`; ordinary `openai.com` pages are excluded. The picker lists every supported destination except the source. The toolbar action defaults ChatGPT to Claude and every other source to ChatGPT.

One shared content script handles source and destination behavior. A versioned load id, runtime guards, cached asset URLs, and stale UI/style cleanup make unpacked-extension reloads safe.

## Transfer Flow

1. Opening the picker is UI-only. It may add content-free preconnect hints, but it does not scrape, fingerprint, summarize, or transmit chat text.
2. Every icon-triggered or picker-triggered transfer intent creates a random attempt id and queues a metadata-only `started / intent_started` event before the running-transfer and empty-chat guards. A zero-turn chat then records `failed / no_conversation` while retaining `intent_started` as its last stage, and shows `Nothing to carry yet` without handoff UI, countdown, or destination tab.
3. A valid transfer shows the handoff card and opens the destination inactive while capture continues. Its `Capturing chat`, `Summarizing`, and `Pasting into <destination>` states advance only from real pipeline marks. Capture progress uses existing sweep geometry; summary activity is display-only and capped below completion until the real summary-done mark. The fixed 30-second countdown becomes `Almost done, don't cancel now` after expiry. UI animation never gates work.
4. Capture prepares the source, performs the bounded rendered-window sweep described below, and serializes role-labeled turns without truncation.
5. Input above 350,000 characters stops locally before `SUMMARIZE_WITH_BACKEND`; in-limit input creates one backend summary job.
6. Identical concurrent jobs may share one in-flight promise. Up to eight exact summary results are cached in service-worker memory for two minutes, including their original provider/model/fallback/usage metadata. A cache hit reports zero current summary latency while retaining and explicitly labeling the original generation metadata. This is not warm summarization.
7. Before reuse, a prepared tab is re-read and must still match the selected destination; a missing, navigated-away, or failed prepared tab gets exactly one fresh correct destination. Normal and recovery ChatGPT pastes share the same activation settling and post-paste stability verification.
8. Verified paste focuses the editor but never clicks Send. Destination content scripts do not show recovery UI while another paste attempt is pending. Only after automatic recovery is exhausted does the source show one manual-copy dialog; if both clipboard APIs fail, it selects the preserved text and explicitly asks for manual copying instead of falsely reporting success.

Picker capture preparation and scraping share one failure boundary, so either error immediately releases the source lock and replaces the handoff UI with the real failure. The source lock's six-minute safety reset covers the 210-second summary ceiling plus prepared and fresh paste attempts. Background waits are 12 seconds for source startup, normally 30 seconds for destination messaging, 45 seconds for ChatGPT destination messaging, and 210 seconds for the single backend request.

## Conversation Capture

Capture accepts only platform-specific message elements with structural author evidence such as role attributes, platform test ids, or equivalent role-bearing ancestors. Loose `you` or `me` labels are not author evidence. The active composer, its descendants, containing wrappers, extension-owned DOM, known empty-state text, and role-unverified content are excluded. An unexpected exact empty-capture error gets the same bounded 1.8-second retry on every platform; successful first capture returns immediately.

Candidate containment is indexed once as a DOM parent-to-child tree. Selection prefers real child turns over broad conversation wrappers. On Claude, one role-bearing message wrapper owns its same-role rendered fragments, while mixed-role or conversation-level wrappers split into their real child turns. Capture never falls back to broad page, `main`, thread, chat, or conversation text.

Every chat enters the same bounded rendered-window sweep; there is no initial turn-count or size gate. The source first scrolls to the top, waits for delayed turn/character/height stability, and expands safe reading controls. Each real downward pixel advance is followed by a two-sample render-stability wait. Steps use 60% of the viewport unless consecutive settled snapshots prove at least 50% ordered turn overlap and a positional shift, which permits the next step to use 90%. Boundary anchoring is used only when pixel scrolling cannot move. Physical movement counts as progress even when one oversized message keeps the rendered signature unchanged; a terminal quiet check ends short or completed chats.

ChatGPT resolves one authoritative conversation scroll root by walking upward from a structural `conversation-turn-*` or author-role marker and selecting the nearest ancestor whose computed `overflow-y` is exactly `auto` or `scroll`. Root selection never consults `scrollHeight`, `clientHeight`, element size, or generic scroll candidates; large `overflow-y: visible` ancestors are excluded even when their apparent scroll range is larger. Other platforms retain the shared scroll-target path. ChatGPT movement, step size, remaining distance, and diagnostics use the chosen root's geometry only after selection. One focused deterministic regression covers both allowed overflow values, misleading visible ancestors, and a farther eligible ancestor to enforce the nearest-ancestor rule. Current diagnostics log the selected root immediately before and after the top-reset call and log the full ancestor chain from one structural conversation turn through `<html>`. These logs do not alter capture behavior.

Settled virtual windows are sequence-aligned against all accumulated turns so interior additions and sliding windows merge in position. Final selection starts from the quick capture, merges swept turns into that baseline, replaces a matched turn only with longer text, and cannot downgrade it with a shorter rendering. ChatGPT carries its stable `conversation-turn-*` identity through snapshot alignment and final serialization: repeated text from different turn ids is preserved, while repeated renderings of the same turn id collapse. Platforms without a stable turn id retain the conservative exact role-and-text safety pass.

Capture preserves the complete middle, leaves the source at its final capture position, and serializes role-labeled turns only. The extension and backend independently enforce the 350,000-character limit. Sweep diagnostics record start, each advance, geometry/turn counts, and the final exit reason.

## Summary Profiles And Provider Chain

Input at or below 1,200 characters uses `local-direct`: the backend builds the Context Carry locally from the exact short transcript and calls no provider.

| Profile | Input characters | Target | Output cap |
| --- | ---: | ---: | ---: |
| `small` | 1,201-8,000 | about 350 words | 1,000 tokens |
| `medium` | 8,001-60,000 | about 700 words | 1,900 tokens |
| `large` | 60,001-210,000 | about 1,200 words | 4,200 tokens |
| `extra-large` | 210,001-350,000 | about 1,800 words | 7,000 tokens |

The large and extra-large profiles' 1,100- and 1,600-word quality floors are diagnostic only. There is no expansion pass.

Each non-tiny transfer creates one backend job. Transient failures and invalid output may advance through:

1. Gemini `gemini-3.5-flash`, when `GEMINI_API_KEY` exists
2. Mistral `mistral-medium-3-5`
3. Mistral `mistral-large-2512`
4. Mistral `ministral-3b-2512`
5. Groq `llama-3.1-8b-instant`, when `GROQ_API_KEY` exists

Gemini uses native `generateContent`, `MEDIUM` thinking, default sampling, explicit non-storage, and the profile cap plus a 4,000-token reasoning allowance. `MISTRAL_MODEL` does not override the chain. A provider-wide Mistral 429 skips directly to optional Groq. Per-model budgets are 45, 55, 40, 25, and 15 seconds; provider fetches also have an 80-second abort ceiling. The extension never replays the backend job.

The Vercel function has an explicit 240-second maximum and the extension aborts at 210 seconds. If provider work is still running after 15 seconds, the backend streams JSON-safe whitespace heartbeats every 15 seconds before the final JSON object. The Manifest V3 worker also calls a harmless extension runtime API every 25 seconds while that request is active. This prevents Chromium from suspending a valid long summary job during a silent fetch; after headers are committed, backend failures retain their real status inside the JSON body and the extension converts them back into the existing typed public errors.

## Prompt Isolation And Validation

The system instruction owns the exact seven-section Context Carry contract. The transcript is JSON-serialized into a separate versioned user-role envelope and declared untrusted data, including any apparent system, developer, tool, API, or instruction text inside it. Gemini receives native `systemInstruction` plus user `contents`; Mistral and Groq receive equivalent system/user messages.

The model must search the complete transcript before using `None`. `WHAT WE WERE DOING`, `WHERE WE LEFT OFF`, and `KEY CONTEXT` must remain meaningful and transcript-grounded. `DECISIONS MADE` contains only user-made or clearly user-confirmed decisions, including deferred choices and accepted tradeoffs. The latest user-confirmed state wins conflicts; an older state is retained only when still relevant and labeled as replaced, rejected, changed, or historical.

Generated output is validated locally without another model call. It must contain the Context Carry title, all seven sections exactly once and in order, meaningful continuation-critical sections, a profile-derived minimum body length, and the exact destination confirmation. Obvious refusals and API-error output fail.

Normalization may remove fences/footer noise and canonicalize an otherwise valid title, headings, ordered-list prefixes, and confirmation. Gemini's plain title is restored to the boxed title. Normalization never invents sections or wraps free-form output as valid context. Invalid output advances through the provider chain; exhaustion fails without pasting broken output.

## Endpoint Security And Limits

Only `POST` and valid extension preflight `OPTIONS` are accepted. CORS reflects syntactically valid `chrome-extension://` and `moz-extension://` origins only. Valid extension-origin requests may omit `X-Cap-Context-Client: cap-context-extension/1` for compatibility with already-running workers; originless or `Origin: null` Firefox requests require it. The marker is compatibility metadata, not authentication.

JSON must contain exactly one non-empty string field, `conversation`. The endpoint rejects extra fields, invalid JSON/types, non-JSON content, bodies above 2,200,000 bytes, conversations above 350,000 JavaScript characters, and conversation UTF-8 payloads above 1,400,000 bytes before provider work.

Instance-local controls allow 8 requests per observed client IP per minute, 40 per hour, and 8 concurrent jobs per warm function instance. They are not a global durable quota. Provider failures become bounded public messages; raw provider response bodies are not exposed or logged.

## Privacy, Diagnostics, Placement, And Paste

Chat text leaves the source only after destination selection. It goes to the Cap Context backend and, for generated summaries, the configured provider chain. The backend does not intentionally persist or log transcripts. Picker open/close and destination preconnection contain no chat text. Pasted text is never submitted automatically.

Central transfer telemetry uses one random UUID stored in `chrome.storage.local` for the lifetime of the installation and one random UUID per attempt. It sends only the install id, attempt id and timestamp, source/destination ids, captured character count when known, `started`/`succeeded`/`failed` status, the last closed-list pipeline stage, one closed-list failure reason, and extension version. The stage sequence is `intent_started`, `capture_started`, `capture_completed`, `summary_request_started`, `summary_response_started`, `summary_completed`, `paste_started`, and `completed`. The background records `summary_response_started` as soon as streamed response headers arrive; failed attempts retain the furthest successfully recorded stage instead of being labeled completed.

Raw chat text, generated summaries, URLs, arbitrary JavaScript errors, provider response bodies, and receipt timelines are never added to telemetry. Every stage and terminal operation is stored in an ordered local outbox before delivery; Supabase failures are silent to the transfer, remain queued, and retry on the next worker startup or retry alarm.

The `transfer-telemetry` Supabase Edge Function accepts only the exact metadata schema, authenticates the configured public extension key, enforces UUID/platform/status/stage/failure/size limits, and calls a service-role-only Postgres function that atomically upserts by attempt id. Stage updates are monotonic: a late retry may apply a terminal outcome but cannot replace a newer stored stage with an older one. The underlying `transfer_events` table has RLS enabled and no anonymous Data API grants or policies, so public clients cannot bypass the function validator or read global events.

The exact-result cache and in-flight map are memory-only. One Latest Run receipt in `chrome.storage.local` records end-to-end/capture/backend/paste timing, turn counts, input/output sizes, profile, serving provider/model, full fallback chain, usage, status, and initially the exact captured transcript. Cache-served receipts retain the original generation metadata, label it as cached, and record zero current summary latency. An alarm removes only the raw transcript and expiry marker after 24 hours; the analysis bridge enforces the same expiry on read. Other receipt metadata remains until the next transfer replaces it. The analysis page shows raw text only inside a collapsed panel and never stores the generated summary.

Placement is platform-specific: Claude anchors beside voice controls, ChatGPT near its model selector at the page root, Gemini near `Flash`, Grok near its mode selector, and DeepSeek near attachment. Bounded editor/composer fallbacks handle hydration or selector drift; they are not conversation-capture fallbacks. Extension-owned nudges are excluded from capture.

Paste uses platform editor selectors, native setters/events, contenteditable insertion paths, and stable Context Carry anchors. Firefox contenteditable paste uses escaped HTML line breaks; Chrome/Brave contenteditable behavior and textarea/input setters remain unchanged. ChatGPT adds hydration stability checks. Manual copy is the final recovery path after summary generation.

## Verification Contract

- `npm test`: deterministic security, privacy, telemetry/outbox, capture, provider, validation, paste, placement, handoff, and receipt regressions. It also loads the versioned capture fixtures and fails on lost/changed turns or fixture latency regressions.
- `npm run test:extension-smoke`: isolated Brave end-to-end check of the unpacked extension against controlled fixtures and a stub backend; it never uses live accounts or production AI APIs.
- `npm run eval`: live endpoint scoring. A failed case retries once; the stronger attempt must meet 90% required-fact recall, zero forbidden facts, valid structure, 30-second small/60-second medium latency, and a 90-second selected-case total.
- `npm run gate`: release command combining deterministic tests and live evaluation. GitHub Actions runs it after `master` pushes, daily, and on demand.
