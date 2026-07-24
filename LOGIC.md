# Cap Context Production Logic

This is the single source of truth for current production behavior. Historical decisions and replaced approaches live in `CHANGELOG.md`.

## Production Surface

- `index.html`: dependency-free marketing site served from the repository root on Vercel and GitHub Pages.
- `extension/manifest.json`: Manifest V3 hosts, permissions, service worker, content scripts, analysis bridge, and assets.
- `extension/platform-content.js`: picker, capture, handoff UI, paste, manual-copy recovery, placement, and Latest Run receipt creation.
- `extension/background.js`: tab orchestration, one backend job per transfer, identical-job deduplication, short result cache, receipt expiry alarm, and paste relay.
- `extension/analysis-bridge.js` and `analysis/index.html`: Latest Run analysis on GitHub Pages.
- `api/telemetry.js` and `api/telemetry-validation.js`: strict metadata-only Vercel telemetry boundary and server-side forwarding.
- `supabase/functions/transfer-telemetry`: second strict validation boundary and service-role ingestion into Supabase.
- `supabase/migrations/`: production database changes, including keeping telemetry unavailable through the anonymous Data API and maintaining the protected aggregate `users` table.
- `api/request-security.js`: endpoint trust boundary, request validation, limits, and abuse controls.
- `api/summarize.js`: profiles, isolated provider requests, fallback chain, output validation, normalization, and timing.
- `evaluation/cases.json` and `scripts/run-regression-eval.js`: versioned quality/latency cases and live endpoint scoring.
- `scripts/run-extension-smoke.js`: isolated Brave smoke for the real unpacked extension.
- `test/` and `.github/workflows/regression-gate.yml`: deterministic regressions and the production gate.

Production deploys from `master` to `https://context-generator-five.vercel.app`. Summaries use `/api/summarize`, telemetry uses `/api/telemetry`, and `vercel.json` gives only the summary function a 240-second ceiling.

The merged Claude/ChatGPT pasted-content capture work is retained under the descriptive branch `pasted-content-fix` for easy historical lookup. Its former temporary name `coppppy` is no longer used.

## Marketing Website

The root `index.html` uses relative assets, has no build step or runtime API dependency, lazy-loads below-fold images, and respects reduced motion. Its public install path is the Chrome Web Store for Chrome and Brave. The interactive handoff console is local illustration only and never captures a conversation or starts a transfer.

Marketing claims must match production: Claude, ChatGPT, Gemini, Grok, and DeepSeek support; a 350,000-character conversation limit; no capture or provider processing before destination selection; 24-hour local raw-transcript diagnostics; and no automatic Send action. `index.legacy-2026-07-15.html` is an inactive archive. `cap-context-extension.zip` is a release/developer artifact, must contain the contents of `extension/` with `manifest.json` at its root, and must be regenerated after tracked extension changes.

Cap Context source is proprietary and all rights are reserved. Public-facing surfaces must not describe the source as publicly reusable, invite public code contributions, or present the GitHub repository as a source-install path. The privacy policy remains publicly linked, and normal use of the officially distributed extension remains separate from source-code reuse rights.

## Platforms And Startup

Cap Context supports Claude, ChatGPT, Gemini, Grok, and DeepSeek. ChatGPT access is limited to `chatgpt.com`, its subdomains, and the legacy `chat.openai.com`; ordinary `openai.com` pages are excluded. The picker lists every supported destination except the source. The toolbar action defaults ChatGPT to Claude and every other source to ChatGPT.

One shared content script handles source and destination behavior. A versioned load id, runtime guards, cached asset URLs, and stale UI/style cleanup make unpacked-extension reloads safe.

The manifest requests only `alarms`, `scripting`, and `storage`. Supported-site host access supplies the matching tab URL visibility needed by `chrome.tabs`; the broader `tabs` permission and temporary `activeTab` grant are intentionally absent. The GitHub analysis bridge retains its narrow static content-script match without a duplicate host permission, and the ChatGPT wildcard covers both `chatgpt.com` and its subdomains.

## Transfer Flow

1. Opening the picker is UI-only. It may add content-free preconnect hints, but it does not scrape, fingerprint, summarize, or transmit chat text.
2. Every icon-triggered or picker-triggered transfer intent creates a random attempt id and queues a metadata-only `started / intent_started` event before the running-transfer and empty-chat guards. A zero-turn chat then records `failed / no_conversation` while retaining `intent_started` as its last stage, and shows `Chat is empty` without handoff UI, countdown, or destination tab.
3. A valid transfer opens the destination inactive while capture continues. Its `Capturing chat`, `Summarizing`, and `Pasting into <destination>` states advance only from real pipeline marks. Capture progress uses existing sweep geometry with linear connector motion; summary activity moves toward its below-completion cap over 20 seconds, then waits for the real summary-done mark. A fast provider-free tiny carry explicitly finishes the capture connector before the summary connector begins, so the two lines never advance together. Claude, Gemini, and DeepSeek paste and verify while inactive; after verified paste, any remaining connector distance finishes continuously over one second, the completed destination tick is painted, and the destination activates immediately. ChatGPT and Grok retain their required focused-paste behavior: the same one-second source completion and tick happen first, then the destination opens and performs its focused, verified paste. The neutral, high-contrast fixed 40-second countdown becomes `Almost done, don't cancel now` after expiry. No path opens the destination before the source completion cue, and no visual deferral may disable a platform's required paste preparation.
4. Capture prepares the source, performs the bounded rendered-window sweep described below, and serializes role-labeled turns without truncation.
5. Input above 350,000 characters stops locally before `SUMMARIZE_WITH_BACKEND`; in-limit input creates one backend summary job.
6. Identical concurrent jobs may share one in-flight promise. Up to eight exact summary results are cached in service-worker memory for two minutes, including their original provider/model/fallback/usage metadata. A cache hit reports zero current summary latency while retaining and explicitly labeling the original generation metadata. This is not warm summarization.
7. Before reuse, a prepared tab is re-read and must still match the selected destination; a missing, navigated-away, or failed prepared tab gets exactly one fresh correct destination. Normal and recovery ChatGPT pastes retain the same activation settle and post-paste stability verification. Destinations that support inactive paste are revalidated immediately before their post-success activation; focus-required destinations are revealed only after the source completion cue and then paste while active.
8. Verified paste focuses the editor but never clicks Send. Destination content scripts do not show recovery UI while another paste attempt is pending. Only after automatic recovery is exhausted does the source show one manual-copy dialog; if both clipboard APIs fail, it selects the preserved text and explicitly asks for manual copying instead of falsely reporting success.

Picker capture preparation and scraping share one failure boundary, so either error immediately releases the source lock and replaces the handoff UI with the real failure. The source lock's six-minute safety reset covers the 210-second summary ceiling plus prepared and fresh paste attempts. Background waits are 12 seconds for source startup, normally 30 seconds for destination messaging, 45 seconds for ChatGPT destination messaging, and 210 seconds for the single backend request. Destination message deadlines cover both connection retries and an already-delivered message awaiting its content-script response, so a hung destination listener cannot silently outlive the configured wait.

The handoff card uses a restrained near-black presentation with one clear live-status headline, a compact three-stage rail, and brand-purple active and completed states. Surface depth, the active-stage halo, and reduced-motion handling are visual only; they do not alter stage timing or transfer behavior.

## Conversation Capture

Capture accepts only platform-specific message elements with structural author evidence such as role attributes, platform test ids, or equivalent role-bearing ancestors. Loose `you` or `me` labels are not author evidence. The active composer, its descendants, containing wrappers, extension-owned DOM, known empty-state text, and role-unverified content are excluded. An unexpected exact empty-capture error gets the same bounded 1.8-second retry on every platform; successful first capture returns immediately.

Candidate containment is indexed once as a DOM parent-to-child tree. Selection prefers real child turns over broad conversation wrappers. On Claude, one role-bearing message wrapper owns its same-role rendered fragments, while mixed-role or conversation-level wrappers split into their real child turns. Capture never falls back to broad page, `main`, thread, chat, or conversation text.

Every chat enters the same bounded rendered-window sweep; there is no initial turn-count or size gate. The source first scrolls to the top, waits for delayed turn/character/height stability, and expands safe reading controls. Each real downward pixel advance is followed by a two-sample render-stability wait. Steps use 60% of the viewport unless consecutive settled snapshots prove at least 50% ordered turn overlap and a positional shift, which permits the next step to use 90%. Boundary anchoring is used only when pixel scrolling cannot move. Physical movement counts as progress even when one oversized message keeps the rendered signature unchanged; a terminal quiet check ends short or completed chats.

ChatGPT resolves one authoritative conversation scroll root by walking upward from a structural `conversation-turn-*` or author-role marker and selecting the nearest ancestor whose computed `overflow-y` is exactly `auto` or `scroll`. Root selection never consults `scrollHeight`, `clientHeight`, element size, or generic scroll candidates; large `overflow-y: visible` ancestors are excluded even when their apparent scroll range is larger. Other platforms retain the shared scroll-target path. ChatGPT movement, step size, and remaining distance use the chosen root's geometry only after selection. One focused deterministic regression covers both allowed overflow values, misleading visible ancestors, and a farther eligible ancestor to enforce the nearest-ancestor rule.

Settled virtual windows are sequence-aligned against all accumulated turns so interior additions and sliding windows merge in position. Final selection starts from the quick capture, merges swept turns into that baseline, replaces a matched turn only with longer text, and cannot downgrade it with a shorter rendering. ChatGPT carries its stable `conversation-turn-*` identity through snapshot alignment and final serialization: repeated text from different turn ids is preserved, while repeated renderings of the same turn id collapse. Platforms without a stable turn id retain the conservative exact role-and-text safety pass.

Capture preserves the complete middle, leaves the source at its final capture position, and serializes role-labeled turns only. The extension and backend independently enforce the 350,000-character limit. Capture timing and sweep metrics remain available in the local Latest Run receipt without writing per-step debug output to the browser console.

Claude and ChatGPT capture also handles collapsed `Pasted content` cards inside verified user turns. Claude card detection accepts its real accessible label prefix `Pasted Text` even when the label continues with paste and line-count metadata. Candidate discovery retains the message-local checks and also performs a Claude-only page-level `button[aria-label]` scan, so a real pasted card is found even when Claude exposes only unrelated role-marked `<p>` message text. A matched button is attached to a related user boundary when one exists; otherwise it becomes a standalone user turn at its own document position. The scraper opens each rendered card sequentially; when its detail panel virtualizes absolute-positioned `[data-index]` rows, it finds that panel's nearest scrollable ancestor, sweeps top-to-bottom with overlap, reads the longest meaningful payload descendant inside each indexed wrapper, and merges the rows in numeric order. An empty virtual result falls through to the panel payload fallback instead of suppressing it. After the panel closes, accepted payloads are reconciled against the final selected turns; if Claude remounted the card or discarded an earlier candidate boundary, the live button is resolved by accessible label and occurrence and the full payload is attached to the current owning user turn before serialization. Pasted-card payloads and attempt counters reset at the start of every transfer so repeated transfers and SPA chat changes cannot reuse stale associations. This is capture-only behavior; other platforms, summary routing, and the local-direct carry format are unchanged.

## Summary Profiles And Provider Chain

Input at or below 1,200 characters uses `local-direct`: the backend calls no provider and produces a compact handoff containing only the Context Carry title, `CONVERSATION SO FAR`, the exact short transcript, and the destination confirmation. Explicit user or assistant turns as short as one character are preserved for this tiny profile, so exchanges such as `hi` plus its reply retain both sides. Generated-summary profiles keep the existing minimum turn-length behavior. The tiny carry does not pad chats with generated-summary sections or backend/template language.

| Profile | Input characters | Target | Mistral/Groq cap | Gemini summary allowance | Gemini reasoning headroom | Gemini total cap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `small` | 1,201-8,000 | about 350 words | 1,000 tokens | 1,500 tokens | 5,000 tokens | 6,500 tokens |
| `medium` | 8,001-60,000 | about 700 words | 1,900 tokens | 3,000 tokens | 6,000 tokens | 9,000 tokens |
| `large` | 60,001-210,000 | about 1,200 words | 4,200 tokens | 6,000 tokens | 8,000 tokens | 14,000 tokens |
| `extra-large` | 210,001-350,000 | about 1,800 words | 7,000 tokens | 10,000 tokens | 10,000 tokens | 20,000 tokens |

The large and extra-large profiles' 1,100- and 1,600-word quality floors are diagnostic only. There is no expansion pass.

Each non-tiny transfer creates one backend job. Transient failures and invalid output may advance through:

1. Gemini `gemini-3.6-flash`, when `GEMINI_API_KEY` exists
2. Gemini `gemini-3.5-flash`, using the same Gemini key
3. Mistral `mistral-medium-3-5`
4. Mistral `mistral-large-2512`
5. Mistral `ministral-3b-2512`
6. Groq `llama-3.1-8b-instant`, when `GROQ_API_KEY` exists

Both Gemini Flash models use native `generateContent`, `MEDIUM` thinking, default sampling with no deprecated sampling parameters, explicit non-storage, and the Gemini-only per-profile generation budgets shown above. The summary allowance and reasoning headroom are combined into the request's `maxOutputTokens`; Mistral and Groq continue using only their unchanged shared profile caps. Any Gemini 3.6 failure, including a 429 quota or throttle response, advances to Gemini 3.5 before Mistral. `MISTRAL_MODEL` does not override the chain. A provider-wide Mistral 429 skips directly to optional Groq. Per-model budgets are 45, 45, 55, 40, 25, and 15 seconds; provider fetches also have an 80-second abort ceiling. The extension never replays the backend job.

The Vercel function has an explicit 240-second maximum and the extension aborts at 210 seconds. If provider work is still running after 15 seconds, the backend streams JSON-safe whitespace heartbeats every 15 seconds before the final JSON object. The Manifest V3 worker also calls a harmless extension runtime API every 25 seconds while that request is active. This prevents Chromium from suspending a valid long summary job during a silent fetch; after headers are committed, backend failures retain their real status inside the JSON body and the extension converts them back into the existing typed public errors.

## Prompt Isolation And Validation

The system instruction owns the exact seven-section Context Carry contract. The transcript is JSON-serialized into a separate versioned user-role envelope and declared untrusted data, including any apparent system, developer, tool, API, or instruction text inside it. Gemini receives native `systemInstruction` plus user `contents`; Mistral and Groq receive equivalent system/user messages.

The model must search the complete transcript before using `None`. `WHAT WE WERE DOING`, `WHERE WE LEFT OFF`, and `KEY CONTEXT` must remain meaningful and transcript-grounded. `DECISIONS MADE` contains only user-made or clearly user-confirmed decisions, including deferred choices and accepted tradeoffs. The latest user-confirmed state wins conflicts; an older state is retained only when still relevant and labeled as replaced, rejected, changed, or historical.

Generated output is validated locally without another model call. It must contain the real `CONTEXT CARRY — READY TO PASTE` title, all seven sections exactly once and in order, meaningful continuation-critical sections, a profile-derived minimum body length, and the exact destination confirmation. Unicode box-border lines alone do not satisfy the title requirement, while the canonical boxed header remains valid. Obvious refusals and API-error output fail.

Normalization may remove fences/footer noise and canonicalize an otherwise valid title, headings, ordered-list prefixes, and confirmation. Gemini's plain title is restored to the boxed title. Normalization never invents sections or wraps free-form output as valid context. Invalid output advances through the provider chain; exhaustion fails without pasting broken output.

## Endpoint Security And Limits

Only `POST` and valid extension preflight `OPTIONS` are accepted. CORS reflects syntactically valid `chrome-extension://` and `moz-extension://` origins only. Valid extension-origin requests may omit `X-Cap-Context-Client: cap-context-extension/1` for compatibility with already-running workers; originless or `Origin: null` Firefox requests require it. The marker is compatibility metadata, not authentication.

JSON must contain exactly one non-empty string field, `conversation`. The endpoint rejects extra fields, invalid JSON/types, non-JSON content, bodies above 2,200,000 bytes, conversations above 350,000 JavaScript characters, and conversation UTF-8 payloads above 1,400,000 bytes before provider work.

Instance-local controls allow 8 requests per observed client IP per minute, 40 per hour, and 8 concurrent jobs per warm function instance. They are not a global durable quota. Provider failures become bounded public messages; raw provider response bodies are not exposed or logged.

## Privacy, Diagnostics, Placement, And Paste

Chat text leaves the source only after destination selection. It goes to the Cap Context backend and, for generated summaries, the configured provider chain. The backend does not intentionally persist or log transcripts. Picker open/close and destination preconnection contain no chat text. Pasted text is never submitted automatically.

Central transfer telemetry uses one random UUID stored in `chrome.storage.local` for the lifetime of the installation and one random UUID per attempt. The install UUID is reused across summaries, service-worker/browser restarts, and extension updates; only clearing extension storage or uninstalling the extension removes it. Telemetry sends only the install id, attempt id and timestamp, source/destination ids, captured character count when known, `started`/`succeeded`/`failed` status, the last closed-list pipeline stage, one closed-list failure reason, and extension version. The stage sequence is `intent_started`, `capture_started`, `capture_completed`, `summary_request_started`, `summary_response_started`, `summary_completed`, `paste_started`, and `completed`. The background records `summary_response_started` as soon as streamed response headers arrive; failed attempts retain the furthest successfully recorded stage instead of being labeled completed.

While an attempt is active, the background associates it with the source tab. If that source tab is closed before completion, the attempt is finalized as `failed / user_cancelled` while retaining its last recorded stage. Provider failures, request timeouts, extension reloads, and other technical failures do not use this category.

Raw chat text, generated summaries, URLs, arbitrary JavaScript errors, provider response bodies, and receipt timelines are never added to telemetry. Every stage and terminal operation is stored in an ordered local outbox before delivery; Vercel or Supabase failures are silent to the transfer, remain queued, and retry on the next worker startup or retry alarm.

The extension sends telemetry only to the existing Vercel backend and contains no Supabase URL, key, or host permission. Vercel accepts only trusted extension requests, applies the exact closed metadata schema and 4 KB limit, then uses server-only environment variables to forward the normalized payload to the `transfer-telemetry` Supabase Edge Function. The Edge Function independently validates the same schema, authenticates the server-held publishable key, and calls a service-role-only Postgres function that atomically upserts by attempt id. Stage updates are monotonic: a late retry may apply a terminal outcome but cannot replace a newer stored stage with an older one. The underlying `transfer_events` table has RLS enabled and no anonymous Data API grants or policies, so public clients cannot bypass either validator or read global events.

The protected `users` table contains one row per browser or extension install after that install's first successful summary. Its identity-backed `user_no` is assigned in first-success order, and it stores only the install id, lifetime successful-summary count, current UTC-day successful-summary count, and the UTC date for that daily count. Insert and status-transition triggers increment these aggregates only when a transfer first becomes `succeeded`. The counter function takes a per-install transaction lock, updates an existing `install_id` first, and inserts only when no row exists, so repeat summaries never consume identity sequence values. Its `security invoker` execution is backed by narrowly scoped `service_role` select, insert, and update grants. A Postgres Cron job resets stale daily counts at 00:00 UTC, while the trigger independently resets a stale row if a successful transfer arrives before or after that job. The table has RLS enabled, is unavailable to public, anonymous, and authenticated clients, and contains no conversation content, account, name, email, route, character count, failure detail, or per-transfer activity.

The exact-result cache and in-flight map are memory-only. One Latest Run receipt in `chrome.storage.local` records end-to-end/capture/backend/paste timing, turn counts, input/output sizes, profile, serving provider/model, full fallback chain, usage, status, and initially the exact captured transcript. Cache-served receipts retain the original generation metadata, label it as cached, and record zero current summary latency. An alarm removes only the raw transcript and expiry marker after 24 hours; the analysis bridge enforces the same expiry on read. Other receipt metadata remains until the next transfer replaces it. The analysis page shows raw text only inside a collapsed panel and never stores the generated summary.

## Floating Button Placement Invariants

Placement is intentionally platform-specific. All five platforms accept expanded composers up to 720px tall, but their anchor and reflow systems are not interchangeable:

- Claude anchors beside its voice controls. It retains the already-verified outer composer during staged large-paste reflow and observes the input and composer for resizing. Its sensitive voice/model-control geometry must not be replaced with another platform's fallback rules.
- ChatGPT uses a page-root, fixed-position bubble immediately left of the live `Instant`, `Medium`, or `High` model-selector button. It does not mount into or reserve composer space. Model discovery accepts only real `button` elements sharing the editor's form or verified composer surface; page-wide text, spans, tabindex wrappers, and streamed response content are never eligible. It observes input/surface resizing plus style, class, state, and character-data mutations inside the verified composer root so CSS-only large-paste reflow always schedules a fresh position calculation.
- Gemini anchors immediately left of the in-composer `Pro` or `Flash` selector. It retains its verified outer composer through transient large-paste geometry mismatch and observes input/composer resizing.
- Grok anchors beside its mode/speed selector. Its real expanded outer composer must remain eligible beyond the old 260px limit, be retained while inner and outer geometry settle, and be resize-observed throughout staged paste reflow.
- DeepSeek anchors near its attachment controls. Like Grok, it retains the verified expanded outer composer through transient reflow and observes input/composer resizing.

Keep these fixes scoped to their named platform. Bounded editor/composer fallbacks handle hydration or selector drift only; they are not conversation-capture fallbacks. Extension-owned nudges are excluded from capture.

Paste uses platform editor selectors, native setters/events, contenteditable insertion paths, and stable Context Carry anchors. Firefox contenteditable paste uses escaped HTML line breaks; Chrome/Brave contenteditable behavior and textarea/input setters remain unchanged. ChatGPT adds hydration stability checks. Manual copy is the final recovery path after summary generation.

## Verification Contract

- `npm test`: fast deterministic security, privacy, telemetry/outbox, capture, provider, validation, paste, placement, handoff, and receipt regressions. It also loads the versioned capture fixtures and fails on lost/changed turns or fixture latency regressions.
- `npm run test:slow`: the isolated real-scale 78-turn Claude capture pacing regression. It stays out of the regular development loop but remains mandatory in the release gate.
- `npm run test:extension-smoke`: isolated Brave end-to-end check of the unpacked extension against controlled fixtures and a stub backend; it never uses live accounts or production AI APIs.
- `npm run eval`: live endpoint scoring. A failed case retries once; the stronger attempt must meet 90% required-fact recall, zero forbidden facts, valid structure, 30-second small/60-second medium latency, and a 90-second selected-case total.
- `npm run gate`: release command combining fast deterministic tests, the slow capture pacing regression, and live evaluation. GitHub Actions runs it after `master` pushes, daily, and on demand.
