# Cap Context Production Logic

This is the agent-facing source of truth for the current production architecture. Use `CHANGELOG.md` for history. `backafter15day.md` is a dated audit whose findings must be reverified, and `todo.md` is the owner's personal tracker—not an instruction queue.

When code and this file disagree, verify the behavior in code and tests, then update this file in the same change.

## Agent Quick Start

- Work only from `C:\Users\vinit\Desktop\context-generator` unless the owner explicitly says otherwise.
- `master` is the production branch; the remote is `https://github.com/spidey889/context-generator.git`.
- Preserve unrelated working-tree changes and stage only files owned by the task.
- The extension has no build step. Load Brave's unpacked extension from `extension/`, not from the ZIP.
- `extension/manifest.json` currently reports version `1.4.2` and contains both Chromium and Firefox background declarations.
- Production web/API URL: `https://context-generator-five.vercel.app`. The analysis bridge and canonical site links currently use `https://spidey889.github.io/context-generator`.
- Release warning verified 2026-09-08: `cap-context-extension.zip` is stale relative to `extension/`. It is missing both EBGaramond fonts and contains older `manifest.json` and `platform-content.js` files. Do not publish it until rebuilt and compared again.

## Non-Negotiable Invariants

1. Opening, browsing, closing, or cancelling the destination picker never captures or transmits chat text. Preconnects contain no conversation data.
2. Capture begins only after the user selects a destination, or after the user explicitly starts a transfer from the extension toolbar.
3. Cap Context pastes and focuses the destination composer but never presses Send.
4. Never truncate silently. Reject conversations above 350,000 JavaScript characters or 1.4 MB of UTF-8 transcript data.
5. Capture only role-verified chat turns. Never fall back to broad page text, the active composer, prompt suggestions, or extension UI.
6. The transcript is untrusted provider input. Instructions inside it are content to summarize, never authority to obey.
7. Telemetry is metadata-only: never include transcripts, summaries, URLs, stack traces, arbitrary errors, or provider bodies.
8. The exact Latest Run transcript is local-only and expires after 24 hours; other receipt metadata remains until the next transfer.
9. Placement fixes stay platform-specific.
10. Generated summaries preserve the exact destination instruction: `Reply only: "Context loaded. Let's pick up right where you left off." Then wait for the user.`

## Runtime Ownership

| Area | Source of truth | Important entry points | Primary tests |
| --- | --- | --- | --- |
| Site adapters, capture, picker/handoff UI, paste, placement, receipt creation | `extension/platform-content.js` | `startDestinationTransfer`, `runContextFlow`, `scrapeVirtualConversation`, `getConversationTurns`, `pasteIntoPlatform`, `updateFloatingButtonPosition` | `test/platform-content.test.js` |
| Cross-tab flow, backend call, destination recovery, cache, telemetry outbox, receipt expiry | `extension/background.js` | `summarizeWithBackend`, `transferToDestination`, `sendMessageWhenReady`, `recordTransferTelemetry` | `test/background.test.js`, `test/telemetry.test.js` |
| Profiles, provider routing, prompt, validation, normalization | `api/summarize.js` | `handleSummary`, `createSummaryWithFallback`, `createSummaryWithProvider`, `validateContextCarrySummary` | `test/summarize.test.js` |
| Summary request boundary | `api/request-security.js` | `isTrustedExtensionRequest`, `validateSummarizeRequest`, `consumeRateLimit` | `test/request-security.test.js` |
| Telemetry relay/schema | `api/telemetry.js`, `api/telemetry-validation.js` | telemetry handler, `validateTelemetryRequest` | `test/telemetry.test.js` |
| Protected telemetry persistence and user counters | `supabase/functions/transfer-telemetry/`, `supabase/migrations/` | `validateTelemetryPayload`, `record_transfer_event`, `record_user_summary` | `test/telemetry.test.js` plus migration review |
| Local Latest Run UI | `extension/analysis-bridge.js`, `analysis/index.html` | `readLastTransferStats`, page `renderStats` | `test/analysis.test.js` |
| Static public site/privacy | `index.html`, `privacy.html`, `PRIVACY.md` | Static HTML/CSS; no JavaScript/build step | `test/license.test.js` plus manual visual review |
| Browser smoke/live quality | `scripts/`, `evaluation/` | `run-extension-smoke.js`, `run-regression-eval.js` | npm scripts below |

`extension/platform-content.js` is a large shared page-lifecycle script. It owns platform selectors, observers, timers, reservations, capture state, and transfer UI. Add characterization tests before extracting or broadly refactoring it.

## End-to-End Transfer

```text
bubble click
  -> picker opens and preconnects only
  -> destination click creates attempt ID and started telemetry
  -> empty chat fails before destination/handoff work
  -> inactive destination tab opens while source capture runs
  -> source scrolls to top, stabilizes, expands, sweeps, and serializes
  -> background obtains one local/generated Context Carry
  -> prepared destination is revalidated or replaced once
  -> context is pasted and verified
  -> source completion finishes, destination focuses, receipt/telemetry finish
```

The toolbar action skips the picker. It defaults to Claude when the source is ChatGPT, otherwise to ChatGPT.

Important sequencing:

- `isRunning` is page-local with a six-minute safety reset. The reset clears UI/state but does not abort ongoing capture, fetch, or paste work.
- Picker-path telemetry starts before empty-chat validation so early exits are recorded safely.
- Destination warmup and network preconnects never contain conversation text.
- Progress completes only from real capture, summary, and paste events; in-stage line motion is decorative.
- ChatGPT and Grok require focus before paste. The source completion cue finishes first; ChatGPT then gets a 350 ms activation settle.
- Claude, Gemini, and DeepSeek paste while inactive. The source completion cue finishes before the already-pasted tab is revalidated and focused.
- A missing, navigated, or failed prepared tab receives at most one fresh destination tab.
- Exhausted paste recovery shows one manual-copy fallback when a summary exists. Clipboard success is claimed only after a real copy succeeds.
- Provider errors are converted to bounded user-safe messages; raw upstream bodies never reach the extension UI.

## Extension Message Contract

These names form an internal API. Update sender, receiver, tests, and this section together.

| Message | Direction | Purpose |
| --- | --- | --- |
| `START_CONTEXT_TRANSFER` | background -> source | Toolbar start; optional destination |
| `CONTEXT_GENERATOR_PING` | background -> content script | Readiness check before retry/injection |
| `PREPARE_DESTINATION` | source -> background | Open and warm an inactive destination |
| `SUMMARIZE_WITH_BACKEND` | source -> background | Submit the captured conversation and return summary/timing |
| `TRANSFER_TO_DESTINATION` | source -> background | Reuse/recover a tab, paste, and apply activation policy |
| `PASTE_CONTEXT` | background -> destination | Insert and verify the prepared context |
| `ACTIVATE_DESTINATION_TAB` | source -> background | Revalidate and focus a destination that pasted inactive |
| `RECORD_TRANSFER_TELEMETRY` | source -> background | Queue a closed-schema metadata snapshot |
| `CONTEXT_TRANSFER_ERROR` | source -> background | Safe badge/log signal |
| `REQUEST_LAST_TRANSFER_STATS` | analysis page -> bridge | Request the local receipt through `window.postMessage` |
| `BRIDGE_READY`, `LAST_TRANSFER_STATS` | bridge -> analysis page | Announce the bridge and return receipt data |

Background retries missing receivers every 120 ms and may inject the content script. Timeouts: 12 seconds for source startup, normally 30 seconds for destination messaging, 45 seconds for ChatGPT, 9 seconds for normal warmup, and 12 seconds for ChatGPT warmup.

## Capture Engine

### Preparation and sweep

Every transfer uses the same bounded rendered-window sweep:

1. Reset per-transfer pasted-card state and cached scroll roots.
2. Scroll the real conversation root to the top and wait for three stable samples of turn count, characters, height, and top position. Claude/ChatGPT allow 4.5 seconds; other sites allow 1.8 seconds.
3. Expand verified collapsed content and supported pasted-content cards.
4. Capture a window, advance by 60% of the viewport, and wait for rendering stability. Proven ordered overlap may permit the next 90% step.
5. Stop through bounded no-movement/quiet logic, a stale limit, or 480 advances. Boundary `scrollIntoView` is fallback-only.
6. Sequence-align rendered windows into the initial baseline. Longer matching text may replace a shorter rendering; partial text never downgrades a collected turn.
7. Serialize as `<Platform> conversation:` followed by `User:` and platform-role turns separated by blank lines.

### Turn identity and filtering

- Candidates must be visible and outside nav/header/footer/aside/menu, the active composer, prompt suggestions, and Cap Context DOM.
- Role evidence comes from platform selectors, role-bearing attributes, or semantic ancestor labels within eight levels. Loose `you`/`me` labels are ignored.
- Containment scoring keeps true message boundaries and rejects page/conversation wrappers. Claude message wrappers own their paragraph/code descendants as one turn.
- ChatGPT selects the nearest structural-turn ancestor with computed `overflow-y: auto|scroll`; it does not choose roots by generic size or scrollability.
- ChatGPT stable `conversation-turn-*` or `data-message-id` identities preserve real repeated text while collapsing duplicate DOM copies.
- Other platforms use exact role+text deduplication. This prevents virtual-window inflation but may remove a genuine repeated turn; do not weaken it without paired repetition and overlap tests.
- Tiny local carries preserve explicit one- or two-character replies. Generated captures normally ignore turns shorter than three characters.
- Empty-state copy and unverified page text fail closed.

Claude and ChatGPT additionally open recognized pasted-content cards, read normal or virtualized `[data-index]` rows in order, close the panel, and reattach the full payload to the owning user turn after DOM remounts. This state resets every transfer.

## Summary Pipeline

Input length selects output guidance and budgets, not the starting generated model.

| Profile | Input chars | Target | Mistral/Groq cap | Gemini summary + reasoning | Real validator floor |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tiny | 0-1,200 | exact local carry | 0 | provider-free | n/a |
| Small | 1,201-8,000 | ~350 words | 1,000 | 1,500 + 5,000 = 6,500 | 80 substantive words |
| Medium | 8,001-60,000 | ~700 words | 1,900 | 3,000 + 6,000 = 9,000 | 140 substantive words |
| Large | 60,001-210,000 | ~1,200 words | 4,200 | 6,000 + 8,000 = 14,000 | 200 substantive words |
| Extra-large | 210,001-350,000 | ~1,800 words | 7,000 | 10,000 + 10,000 = 20,000 | 200 substantive words |

Tiny output is different by design: canonical header, quoted `CONVERSATION SO FAR`, and the exact `NEXT STEP`. It does not call a provider or use all seven generated-summary sections.

Generated provider order:

```text
Gemini 3.8 Flash -> 3.7 Flash -> 3.6 Flash -> 3.5 Flash
-> Mistral Medium 3.5 -> Mistral Large 2512 -> Ministral 3B 2512
-> optional Groq Llama 3.1 8B Instant
```

- Gemini is skipped without `GEMINI_API_KEY`. Its four models share one 90-second family deadline; each model is capped at 45 seconds.
- Mistral is skipped without `MISTRAL_API_KEY`. Model budgets are 55, 40, and 25 seconds. A Mistral HTTP 429 jumps directly to Groq.
- Groq is optional via `GROQ_API_KEY` and has 15 seconds.
- Retryable provider calls get at most two attempts within the model budget, an 80-second per-attempt ceiling, and a 450 ms retry interval.
- Gemini uses `thinkingLevel: MEDIUM`. Mistral prompt-cache keys use `capcontext-summary-v6-<profile>-<model>`.
- Vercel allows 240 seconds; the extension aborts the backend call at 210 seconds and calls an extension API every 25 seconds to keep the MV3 worker alive.
- The backend emits JSON-safe whitespace heartbeats every 15 seconds after the first 15 seconds.
- Identical concurrent conversations share one background promise. Up to eight exact completed results remain in worker memory for two minutes; cache hits preserve original provider metadata.

### Prompt and validation

Providers receive a system prompt and a user JSON envelope with schema `cap-context-conversation-v1` and data type `untrusted-conversation-transcript`. Repository `SKILL.md` is not sent to providers; `getSummarySystemPrompt()` and `getContextCarryTemplate()` are the real backend contract.

Generated output requires the exact title and all seven sections once and in order: WHO I AM, WHAT WE WERE DOING, WHERE WE LEFT OFF, DECISIONS MADE, OPEN QUESTIONS, KEY CONTEXT, NEXT STEP. The three core continuation sections must be meaningful, and NEXT STEP must match the exact destination instruction.

Normalization can remove fences/legacy footers, canonicalize recognized headings, add the Unicode box, and replace NEXT STEP. It cannot invent missing sections or make free-form output valid.

Do not overstate current quality enforcement:

- Large-profile `minWords` is prompt guidance and a `qualityFloorMet` diagnostic. The true validation floor is 20% of target, clamped to 80-200 substantive words.
- `finishReason` is recorded but token-limit output is not rejected solely for that reason.
- Validation does not receive the source transcript, so it cannot detect a fluent, well-shaped hallucination.
- There is no expansion or semantic quality loop. The first structurally valid provider result wins.

## Backend Boundary

`POST /api/summarize` requires `Content-Type: application/json`, public marker `X-Cap-Context-Client: cap-context-extension/1`, and exactly `{ "conversation": <non-empty string> }`.

- Accepted origins are Chromium and Firefox extension origins. Firefox may omit Origin; then the marker is mandatory. An already-running extension worker with a valid extension Origin may omit the marker for compatibility.
- The marker is public and is not an authentication secret.
- Limits: 2.2 MB JSON request, 350,000 JavaScript characters, 1.4 MB transcript UTF-8, 8 requests/minute and 40/hour per forwarded IP, and 8 concurrent jobs per warm server instance.
- Rate/concurrency state is process-local, not a durable global limiter.
- Responses are `no-store`; provider error bodies are not exposed.

## Telemetry, Storage, and Analysis

| Key/alarm | Purpose |
| --- | --- |
| `context-generator-onboarding-dismissed-v2` | Local onboarding dismissal |
| `context-generator-last-transfer-stats-v1` | One Latest Run receipt; raw text expires after 24 hours |
| `context-generator-install-id-v1` | Random install UUID, not an account or real identity |
| `context-generator-telemetry-outbox-v1` | Ordered retryable metadata queue |
| `expire-latest-run-raw-transcript` | Alarm that removes only raw transcript fields |
| `retry-transfer-telemetry` | Alarm that retries delivery after five minutes |

The receipt records transfer/capture timings, counts, sizes, profile, serving provider/model, attempted chain, fallback, finish reason, token usage, status, and exact captured text. It deliberately does not store the generated summary. Background expiry and the analysis bridge both remove expired raw text.

Closed telemetry stages are: `intent_started`, `capture_started`, `capture_completed`, `summary_request_started`, `summary_response_started`, `summary_completed`, `paste_started`, `completed`.

Allowed failures are: `no_conversation`, `conversation_too_large`, `capture_failed`, `summary_rate_limited`, `summary_service_busy`, `summary_access_denied`, `summary_failed`, `destination_open_failed`, `paste_failed`, `extension_reloaded`, `client_interrupted`, `user_cancelled`, `unknown_failure`.

The only payload fields are install/attempt IDs, time, source/destination, captured character count, status, last stage, closed failure reason, and extension version.

Delivery path: `content script -> background outbox -> Vercel /api/telemetry -> Supabase Edge Function -> record_transfer_event`. Every layer rejects unknown fields. Supabase credentials remain server-side; RLS/grants block public tables. Upserts preserve the furthest stage and terminal result.

The protected `users` table creates a row on an install's first successful transfer and maintains lifetime and UTC-day summary counts. An advisory transaction lock prevents duplicate first-user races; pg_cron resets stale daily values at 00:00 UTC.

## Placement and Paste

- Claude: absolute beside the voice controls. Empty `/new` and `/chat/...` composers use a total one-pixel optical lift based on the orb's transparent inset; typed states remain separately tuned.
- Claude composer surfaces must remain horizontally close to the editor. `CLAUDE_MAX_COMPOSER_HORIZONTAL_PADDING` is 160 px across the combined left and right padding. Reject page-sized ancestors beyond this bound so phantom width cannot push mic/voice controls and the orb outside the composer or make placement oscillate during hydration. Apply this check to both retained and newly scored surfaces while still allowing tall real composers.
- ChatGPT: fixed left of the model selector; retains its last usable surface and requires focused paste.
- Gemini: left of the Pro/Flash selector; retains the outer composer during large-paste expansion.
- Grok: beside the mode/speed selector; retains the outer composer and requires focused paste.
- DeepSeek: near attachment/input controls; retains the outer composer during expansion.

Composer discovery scores platform candidates, rejects page-sized/misaligned surfaces, caps dimensions, and restores prior inline styles when reservations change. Resize observers cover expanding composers; Claude and ChatGPT also watch class/style changes when controls swap visibility without a remount.

Add `?__cap_context_debug_placement=1` on Claude for deduplicated, content-free input/composer/anchor/bubble geometry.

Paste uses native setters/events plus stability checks. Firefox alone converts contenteditable line breaks to escaped HTML `<br>` elements. ChatGPT gets longer insert/verify/stability windows. Verification samples beginning, middle, and end anchors so benign editor differences do not cause false failure.

## Contracts That Must Change Together

- Platform support: manifest matches/permissions, `PLATFORMS`, background `DESTINATIONS`, `DESTINATION_HOST_RULES`, telemetry platform lists, public/privacy copy, tests, smoke fixtures.
- Conversation limits: content-script cap, request-security character/byte/body limits, public/privacy copy, analysis display, tests.
- Model/profile routing: provider constants/budgets, prompts, Latest Run labels, evaluation expectations, this file, `memory.md`, `extension/README.md`.
- Telemetry fields/stages/failures: source/background sanitizers, Vercel validator, Supabase validator, SQL constraints/functions, privacy wording, tests. Free-form telemetry fields are forbidden.
- Latest Run receipt: producer, background expiry, bridge, analysis renderer, privacy wording, analysis tests.
- Any content-script change: update `CONTENT_SCRIPT_LOAD_ID` so open tabs replace stale code, and retain stale-node/reservation cleanup.
- Extension release: bump `extension/manifest.json`, rebuild the ZIP with `manifest.json` at its root, hash-compare every file against `extension/`, then test the unpacked folder in a new Brave window.

## Known Current Risks

Do not claim these are fixed without a reproduction and regression test:

- Live long ChatGPT chats have under-captured despite deterministic virtual-window fixtures passing.
- The six-minute source lock can reset without cancelling active work.
- Worst-case provider budgets reach 225 seconds while the extension aborts at 210 seconds.
- Summary validation is structural, not grounded; large output may pass at 200 substantive words and finish reason is informational.
- The telemetry outbox is unbounded, active cancellation state is worker-memory-only, and Vercel's Supabase fetch has no explicit timeout.
- A destination prepared before capture/summary failure may remain open unused.
- `npm run gate` omits the installed-extension smoke; that smoke covers controlled ChatGPT -> Claude, not all five sites.
- Browser packaging uses one hybrid Chromium/Firefox manifest while automation is Brave-only.
- Website tests have no visual regression coverage.
- The checked-in ZIP is stale, as noted above.

`backafter15day.md` has deeper evidence, but recheck it against current code. For example, its stale content-script-ID finding is now superseded by `platform-content-2026-09-08-claude-composer-bounds`.

## Verification Matrix

| Change | Focused check | Broader check |
| --- | --- | --- |
| Capture, pasted cards, placement, picker/handoff | `node --test test/platform-content.test.js --test-skip-pattern="^slow/release:"` | `npm run test:slow`; Brave smoke for real extension/UI work |
| Background messages, destination recovery, cache | `node --test test/background.test.js` | `npm test` |
| Summary prompt/routing/validation | `node --test test/summarize.test.js test/request-security.test.js` | `npm run eval` for quality/provider changes |
| Telemetry/Supabase | `node --test test/telemetry.test.js` | `npm test` plus schema/grant review |
| Latest Run analysis | `node --test test/analysis.test.js` | Open GitHub Pages analysis with extension loaded |
| Website/privacy | `node --test test/license.test.js` | Manual desktop/mobile, keyboard, reduced-motion, link review |
| Release/package | `npm test` and `npm run test:extension-smoke` | `npm run gate`, then ZIP hash comparison |

- `npm test`: deterministic suite excluding the named slow release capture.
- `npm run test:slow`: paced 78-turn Claude capture regression.
- `npm run test:extension-smoke`: isolated Brave profile, unpacked extension, controlled ChatGPT-source/Claude-destination fixtures, stub backend. Use a new window/profile, never the owner's main browser.
- `npm run eval`: live production-endpoint quality/latency evaluation with one retry for a failed case.
- `npm run gate`: fast tests, slow capture, live evaluation; it does not include Brave smoke.

GitHub Actions runs the gate on `master`, daily at 06:17 UTC, and manually using Node 22, read-only repository permissions, and an eight-minute job timeout.
