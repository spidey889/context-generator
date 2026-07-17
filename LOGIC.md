# Cap Context Production Logic

This is the single source of truth for current production behavior. Historical decisions and replaced approaches live in `CHANGELOG.md`.

## Production Surface

- `index.html`: dependency-free marketing site served from the repository root on Vercel and GitHub Pages.
- `extension/manifest.json`: Manifest V3 hosts, permissions, service worker, content scripts, analysis bridge, and assets.
- `extension/platform-content.js`: picker, capture, handoff UI, paste, manual-copy recovery, placement, and Latest Run receipt creation.
- `extension/background.js`: tab orchestration, one backend job per transfer, identical-job deduplication, short result cache, receipt expiry alarm, and paste relay.
- `extension/analysis-bridge.js` and `analysis/index.html`: Latest Run analysis on GitHub Pages.
- `api/request-security.js`: endpoint trust boundary, request validation, limits, and abuse controls.
- `api/summarize.js`: profiles, isolated provider requests, fallback chain, output validation, normalization, and timing.
- `evaluation/cases.json` and `scripts/run-regression-eval.js`: versioned quality/latency cases and live endpoint scoring.
- `scripts/run-extension-smoke.js`: isolated Brave smoke for the real unpacked extension.
- `test/` and `.github/workflows/regression-gate.yml`: deterministic regressions and the production gate.

Production deploys from `master` to `https://context-generator-five.vercel.app/api/summarize`. `vercel.json` gives the summary function a 240-second ceiling.

## Marketing Website

The root `index.html` uses relative assets, has no build step or runtime API dependency, lazy-loads below-fold images, and respects reduced motion. Its public install path is the Chrome Web Store for Chrome and Brave. The interactive handoff console is local illustration only and never captures a conversation or starts a transfer.

Marketing claims must match production: Claude, ChatGPT, Gemini, Grok, and DeepSeek support; a 210,000-character conversation limit; no capture or provider processing before destination selection; 24-hour local raw-transcript diagnostics; and no automatic Send action. `index.legacy-2026-07-15.html` is an inactive archive. `cap-context-extension.zip` is a release/developer artifact, must contain the contents of `extension/` with `manifest.json` at its root, and must be regenerated after tracked extension changes.

## Platforms And Startup

Cap Context supports Claude, ChatGPT, Gemini, Grok, and DeepSeek. ChatGPT access is limited to `chatgpt.com`, its subdomains, and the legacy `chat.openai.com`; ordinary `openai.com` pages are excluded. The picker lists every supported destination except the source. The toolbar action defaults ChatGPT to Claude and every other source to ChatGPT.

One shared content script handles source and destination behavior. A versioned load id, runtime guards, cached asset URLs, and stale UI/style cleanup make unpacked-extension reloads safe.

## Transfer Flow

1. Opening the picker is UI-only. It may add content-free preconnect hints, but it does not scrape, fingerprint, summarize, or transmit chat text.
2. Destination selection first requires at least one structurally verified real message. A zero-turn chat shows `Nothing to carry yet` without handoff UI, countdown, or destination tab.
3. A valid transfer shows the handoff card and opens the destination inactive while capture continues. Its `Capturing chat`, `Summarizing`, and `Pasting into <destination>` states advance only from real pipeline marks. Capture progress uses existing sweep geometry; summary activity is display-only and capped below completion until the real summary-done mark. The fixed 30-second countdown becomes `Almost done, don't cancel now` after expiry. UI animation never gates work.
4. Capture prepares the source, performs the bounded rendered-window sweep described below, and serializes role-labeled turns without truncation.
5. Input above 210,000 characters stops locally before `SUMMARIZE_WITH_BACKEND`; in-limit input creates one backend summary job.
6. Identical concurrent jobs may share one in-flight promise. Up to eight exact summary texts are cached in service-worker memory for two minutes. This is not warm summarization.
7. The result is pasted into the prepared destination. Missing or failed prepared tabs retry in a fresh destination tab. ChatGPT adds activation settling and post-paste stability verification.
8. Verified paste focuses the editor but never clicks Send. If generated context cannot be transferred, the manual-copy dialog preserves it.

The source lock resets after five minutes. Background waits are 12 seconds for source startup, normally 30 seconds for destination messaging, 45 seconds for ChatGPT destination messaging, and 210 seconds for the single backend request.

## Conversation Capture

Capture accepts only platform-specific message elements with structural author evidence such as role attributes, platform test ids, or equivalent role-bearing ancestors. Loose `you` or `me` labels are not author evidence. The active composer, its descendants, containing wrappers, extension-owned DOM, known empty-state text, and role-unverified content are excluded. An unexpected exact empty-capture error gets the same bounded 1.8-second retry on every platform; successful first capture returns immediately.

Candidate containment is indexed once as a DOM parent-to-child tree. Selection prefers real child turns over broad conversation wrappers. On Claude, one role-bearing message wrapper owns its same-role rendered fragments, while mixed-role or conversation-level wrappers split into their real child turns. Capture never falls back to broad page, `main`, thread, chat, or conversation text.

Every chat enters the same bounded rendered-window sweep; there is no initial turn-count or size gate. The source first scrolls to the top, waits for delayed turn/character/height stability, and expands safe reading controls. Each real downward pixel advance is followed by a two-sample render-stability wait. Steps use 60% of the viewport unless consecutive settled snapshots prove at least 50% ordered turn overlap and a positional shift, which permits the next step to use 90%. Boundary anchoring is used only when pixel scrolling cannot move. Physical movement counts as progress even when one oversized message keeps the rendered signature unchanged; a terminal quiet check ends short or completed chats.

ChatGPT resolves one authoritative conversation scroll root from structural `conversation-turn-*` or author-role markers, with an app-sized largest-range fallback for detached virtualizers. Generic scrape candidates never vote on ChatGPT's scroll root, so surrounding chat UI cannot keep the real conversation pinned at the bottom. Other platforms retain the shared scroll-target path. Movement, step size, remaining distance, and diagnostics use the chosen geometry. Current ChatGPT diagnostics log the selected root immediately before and after the existing top-reset call and log the full ancestor chain from one structural conversation turn through `<html>`, including each element's class, scroll geometry, and computed vertical overflow. These logs do not alter capture behavior.

Settled virtual windows are sequence-aligned against all accumulated turns so interior additions and sliding windows merge in position. Final selection starts from the quick capture, merges swept turns into that baseline, replaces a matched turn only with longer text, and cannot downgrade it with a shorter rendering. ChatGPT carries its stable `conversation-turn-*` identity through snapshot alignment and final serialization: repeated text from different turn ids is preserved, while repeated renderings of the same turn id collapse. Platforms without a stable turn id retain the conservative exact role-and-text safety pass.

Capture preserves the complete middle, leaves the source at its final capture position, and serializes role-labeled turns only. The extension and backend independently enforce the 210,000-character limit. Sweep diagnostics record start, each advance, geometry/turn counts, and the final exit reason.

## Summary Profiles And Provider Chain

Input at or below 1,200 characters uses `local-direct`: the backend builds the Context Carry locally from the exact short transcript and calls no provider.

| Profile | Input characters | Target | Output cap |
| --- | ---: | ---: | ---: |
| `small` | 1,201-8,000 | about 350 words | 1,000 tokens |
| `medium` | 8,001-60,000 | about 700 words | 1,900 tokens |
| `large` | 60,001-210,000 | about 1,200 words | 4,200 tokens |

The large profile's 1,100-word quality floor is diagnostic only. There is no expansion pass.

Each non-tiny transfer creates one backend job. Transient failures and invalid output may advance through:

1. Gemini `gemini-3.5-flash`, when `GEMINI_API_KEY` exists
2. Mistral `mistral-medium-2604`
3. Mistral `mistral-large-2512`
4. Mistral `ministral-3b-2512`
5. Groq `llama-3.1-8b-instant`, when `GROQ_API_KEY` exists

Gemini uses native `generateContent`, `MEDIUM` thinking, default sampling, explicit non-storage, and the profile cap plus a 4,000-token reasoning allowance. `MISTRAL_MODEL` does not override the chain. A provider-wide Mistral 429 skips directly to optional Groq. Per-model budgets are 45, 55, 40, 25, and 15 seconds; provider fetches also have an 80-second abort ceiling. The extension never replays the backend job.

## Prompt Isolation And Validation

The system instruction owns the exact seven-section Context Carry contract. The transcript is JSON-serialized into a separate versioned user-role envelope and declared untrusted data, including any apparent system, developer, tool, API, or instruction text inside it. Gemini receives native `systemInstruction` plus user `contents`; Mistral and Groq receive equivalent system/user messages.

The model must search the complete transcript before using `None`. `WHAT WE WERE DOING`, `WHERE WE LEFT OFF`, and `KEY CONTEXT` must remain meaningful and transcript-grounded. `DECISIONS MADE` contains only user-made or clearly user-confirmed decisions, including deferred choices and accepted tradeoffs. The latest user-confirmed state wins conflicts; an older state is retained only when still relevant and labeled as replaced, rejected, changed, or historical.

Generated output is validated locally without another model call. It must contain the Context Carry title, all seven sections exactly once and in order, meaningful continuation-critical sections, a profile-derived minimum body length, and the exact destination confirmation. Obvious refusals and API-error output fail.

Normalization may remove fences/footer noise and canonicalize an otherwise valid title, headings, ordered-list prefixes, and confirmation. Gemini's plain title is restored to the boxed title. Normalization never invents sections or wraps free-form output as valid context. Invalid output advances through the provider chain; exhaustion fails without pasting broken output.

## Endpoint Security And Limits

Only `POST` and valid extension preflight `OPTIONS` are accepted. CORS reflects syntactically valid `chrome-extension://` and `moz-extension://` origins only. Valid extension-origin requests may omit `X-Cap-Context-Client: cap-context-extension/1` for compatibility with already-running workers; originless or `Origin: null` Firefox requests require it. The marker is compatibility metadata, not authentication.

JSON must contain exactly one non-empty string field, `conversation`. The endpoint rejects extra fields, invalid JSON/types, non-JSON content, bodies above 1,000,000 bytes, conversations above 210,000 JavaScript characters, and conversation UTF-8 payloads above 840,000 bytes before provider work.

Instance-local controls allow 8 requests per observed client IP per minute, 40 per hour, and 8 concurrent jobs per warm function instance. They are not a global durable quota. Provider failures become bounded public messages; raw provider response bodies are not exposed or logged.

## Privacy, Diagnostics, Placement, And Paste

Chat text leaves the source only after destination selection. It goes to the Cap Context backend and, for generated summaries, the configured provider chain. The backend does not intentionally persist or log transcripts. Picker open/close and destination preconnection contain no chat text. Pasted text is never submitted automatically.

The exact-summary cache and in-flight map are memory-only. One Latest Run receipt in `chrome.storage.local` records end-to-end/capture/backend/paste timing, turn counts, input/output sizes, profile, serving provider/model, full fallback chain, usage, status, and initially the exact captured transcript. An alarm removes only the raw transcript and expiry marker after 24 hours; the analysis bridge enforces the same expiry on read. Other receipt metadata remains until the next transfer replaces it. The analysis page shows raw text only inside a collapsed panel and never stores the generated summary.

Placement is platform-specific: Claude anchors beside voice controls, ChatGPT near its model selector at the page root, Gemini near `Flash`, Grok near its mode selector, and DeepSeek near attachment. Bounded editor/composer fallbacks handle hydration or selector drift; they are not conversation-capture fallbacks. Extension-owned nudges are excluded from capture.

Paste uses platform editor selectors, native setters/events, contenteditable insertion paths, and stable Context Carry anchors. Firefox contenteditable paste uses escaped HTML line breaks; Chrome/Brave contenteditable behavior and textarea/input setters remain unchanged. ChatGPT adds hydration stability checks. Manual copy is the final recovery path after summary generation.

## Verification Contract

- `npm test`: deterministic security, privacy, capture, provider, validation, paste, placement, handoff, and receipt regressions. It also loads the versioned capture fixtures and fails on lost/changed turns or fixture latency regressions.
- `npm run test:extension-smoke`: isolated Brave end-to-end check of the unpacked extension against controlled fixtures and a stub backend; it never uses live accounts or production AI APIs.
- `npm run eval`: live endpoint scoring. A failed case retries once; the stronger attempt must meet 90% required-fact recall, zero forbidden facts, valid structure, 30-second small/60-second medium latency, and a 90-second selected-case total.
- `npm run gate`: release command combining deterministic tests and live evaluation. GitHub Actions runs it after `master` pushes, daily, and on demand.
