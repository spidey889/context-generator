# Cap Context Production Logic

This file describes current production behavior. Historical work belongs in `CHANGELOG.md` and Git history.

## System Map

- `index.html` and `privacy.html`: dependency-free public site.
- `extension/manifest.json`: Manifest V3 configuration for Claude, ChatGPT, Gemini, Grok, and DeepSeek.
- `extension/platform-content.js`: destination picker, capture, handoff UI, paste, recovery, placement, and Latest Run receipts.
- `extension/background.js`: tab orchestration, summary jobs, deduplication, short result cache, telemetry outbox, and receipt expiry.
- `api/summarize.js`: summary profiles, provider fallbacks, validation, normalization, and timing.
- `api/telemetry.js`: strict metadata-only telemetry relay to Supabase.
- `analysis/index.html`: local Latest Run analysis through `extension/analysis-bridge.js`.
- `test/`, `evaluation/`, and `scripts/`: deterministic tests, slow capture coverage, Brave extension smoke, and live evaluation.

Production deploys from `master` to `https://context-generator-five.vercel.app`. The site also runs on GitHub Pages. The Chrome Web Store is the public install path; `cap-context-extension.zip` is a release artifact and must match the contents of `extension/` with `manifest.json` at its root.

## Website

The homepage has three sections: a centered hero with a static handoff illustration, a three-step explanation on a muted plum surface, and a control/privacy section. It has no JavaScript or build step. Links have keyboard focus and 44-pixel touch targets, external store links announce new-tab behavior, and motion is disabled when the user requests reduced motion. The shimmer applies only to the emphasized hero word.

Public claims must remain accurate: five supported AI platforms, a 350,000-character limit, no capture before destination selection, no automatic Send action, and 24-hour local retention of raw transcript diagnostics. Source code is proprietary and all rights are reserved.

## Transfer Flow

1. Opening or closing the picker is UI-only. It may preconnect without chat content but never captures or transmits text.
2. Choosing a destination creates an attempt ID and records metadata-only intent telemetry. Empty chats stop locally before handoff UI, summary work, or destination-tab creation.
3. The destination opens inactive while the source captures and summarizes. Progress stages advance only from real pipeline events.
4. Input above 350,000 JavaScript characters stops locally. Valid input creates one backend summary job; identical concurrent jobs may share it, and up to eight exact results are cached in worker memory for two minutes.
5. A prepared destination tab is revalidated before paste. A missing, changed, or failed tab gets at most one fresh correct destination.
6. Claude, Gemini, and DeepSeek can paste while inactive. ChatGPT and Grok activate only after the source completion cue, then perform their required focused paste.
7. Paste is verified and leaves the composer focused. Cap Context never presses Send. Exhausted recovery produces one manual-copy fallback with truthful clipboard failure handling.

The source lock has a six-minute safety reset. Background waits are 12 seconds for source startup, normally 30 seconds for destination messaging, 45 seconds for ChatGPT messaging, and 210 seconds for the backend request.

## Capture

Capture accepts only platform-specific message elements with structural author evidence. It excludes the active composer, extension UI, empty-state text, broad page wrappers, and loose `you` or `me` labels.

Every chat uses a bounded rendered-window sweep. The source scrolls to the top, waits for stable turns, characters, and height, then advances by 60% of the viewport. A proven overlapping window may permit the next 90% step. Each movement waits for render stability, and boundary anchoring is fallback-only.

Windows are sequence-aligned into the quick-capture baseline. Longer matched text may replace shorter text, but a partial rendering cannot downgrade an existing turn. ChatGPT preserves distinct repeated messages through stable `conversation-turn-*` IDs; other platforms retain conservative role-and-text deduplication.

ChatGPT selects the nearest ancestor of a structural turn whose computed `overflow-y` is `auto` or `scroll`. It does not choose roots by size or generic scrollability. Claude and ChatGPT also expand verified pasted-content cards and merge virtualized `[data-index]` rows in order before serialization.

## Summary Pipeline

Chats at or below 1,200 characters use provider-free `local-direct` output. Larger chats use these profiles:

| Profile | Characters | Target length | Mistral/Groq cap | Gemini total cap |
| --- | ---: | ---: | ---: | ---: |
| Small | 1,201-8,000 | ~350 words | 1,000 | 6,500 |
| Medium | 8,001-60,000 | ~700 words | 1,900 | 9,000 |
| Large | 60,001-210,000 | ~1,200 words | 4,200 | 14,000 |
| Extra-large | 210,001-350,000 | ~1,800 words | 7,000 | 20,000 |

Generated summaries try `gemini-3.6-flash`, `gemini-3.5-flash`, `mistral-medium-3-5`, `mistral-large-2512`, `ministral-3b-2512`, then optional Groq `llama-3.1-8b-instant`. Per-model budgets are 45, 45, 55, 40, 25, and 15 seconds. Provider fetches have an 80-second abort ceiling; the Vercel function allows 240 seconds and the extension aborts at 210 seconds. The backend streams whitespace heartbeats every 15 seconds after the first 15 seconds, while the worker performs a harmless runtime call every 25 seconds.

The transcript is JSON-serialized as untrusted user data. Output must contain the exact Context Carry title, all seven sections once and in order, meaningful continuation state, sufficient profile-based length, and the destination confirmation. Normalization may repair formatting but cannot invent sections or facts. Invalid output advances to the next provider.

Decisions must be user-made or user-confirmed. The latest confirmed state wins, and explicitly requested facts, alternatives, numbers, safety statements, and implementation state must survive the handoff.

## Security, Privacy, and Telemetry

`/api/summarize` accepts only strict extension requests with one non-empty `conversation` string. It enforces content type, schema, origin rules, 2.2 MB request size, 350,000 JavaScript characters, 1.4 MB transcript UTF-8 size, per-instance rate limits, and eight concurrent jobs. Raw provider errors are never exposed.

Conversation text leaves the source only after destination selection. The backend does not intentionally store or log transcripts. Telemetry contains only install/attempt IDs, timestamp, source/destination, captured character count, closed-list status/stage/failure values, and extension version. It never includes chat text, summaries, URLs, arbitrary errors, or receipt timelines.

Telemetry is queued locally before delivery and travels `Extension -> Vercel -> Supabase`. Both server layers validate the closed schema. Supabase tables use RLS and are unavailable to public clients. The protected `users` aggregate stores only install ID, first-success order, and lifetime/daily successful-summary counts.

One Latest Run receipt in `chrome.storage.local` keeps timing, size, profile, provider, fallback, usage, and status data. The exact raw transcript expires after 24 hours; other receipt metadata remains until the next transfer.

## Placement and Paste

Placement is intentionally platform-specific: Claude near voice controls, ChatGPT as a fixed bubble left of the model selector, Gemini left of Pro/Flash, Grok beside its mode selector, and DeepSeek near attachment controls. Keep placement fixes scoped to their platform.

Paste uses native setters/events, contenteditable insertion, and stability checks. Firefox alone converts contenteditable line breaks to escaped HTML `<br>` elements. Chrome/Brave and textarea/input paths remain unchanged.

## Verification

- `npm test`: deterministic security, capture, provider, paste, placement, telemetry, licensing, and UI regressions.
- `npm run test:slow`: real-scale 78-turn Claude capture pacing regression.
- `npm run test:extension-smoke`: isolated Brave test of the unpacked extension with fixtures and a stub backend.
- `npm run eval`: live quality and latency evaluation with one retry and typographic-dash normalization.
- `npm run gate`: fast tests, slow capture regression, and live evaluation. GitHub Actions runs the gate on `master`, daily, and on demand using Node 22 with read-only repository permissions.
