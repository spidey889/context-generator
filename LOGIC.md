# Cap Context Production Logic

This file documents the current extension and backend contracts. `master` is the production source branch; deployment and Web Store release states are separate. Historical decisions live in `CHANGELOG.md`; `backafter15day.md` is a dated audit and `todo.md` is personal tracking.

## Agent Quick Start

- Work only from `C:\Users\vinit\Desktop\context-generator` unless the owner explicitly says otherwise.
- `master` is the production branch; the remote is `https://github.com/spidey889/context-generator.git`.

- The extension has no build step. Load Brave's unpacked extension from `extension/`, not from the ZIP.
- Use Node 22 for tests and scripts. The project intentionally has no tracked lockfile or runtime npm dependency list; tests and smoke tooling use Node built-ins and Node's global WebSocket.
- `extension/manifest.json` reports `1.4.6` with both Chromium and Firefox background declarations.
- Production API URL: `https://context-generator-five.vercel.app`.
- No extension ZIP is tracked; release packaging uses a fresh archive built from `extension/`.

## Product launch film

`brag-output-2026-09-29-175143/brag.mp4` is the latest `/brag-slim` launch-film cut: 52 seconds at 1080p/60 fps. A realistic staged Claude Kyoto chat reaches its limit; the production Cap Context picker selects ChatGPT; the production transfer card remains visibly inside Claude's conversation through capture, summary and paste; then ChatGPT receives the seven-heading Context Carry and answers the same short day-three follow-up using Sanjo, vegetarian food and an open afternoon. Five cursor-led clicks, decisive macro pushes, short settled reading holds and a new original 100 BPM piano/pulse/Foley score tighten the previous edit. Both ChatGPT Send actions are user-controlled. The app leaves the frame before the standalone message and brand close; the message is `Switch AIs without re-explaining everything.` The output directory holds the editable time-based composition, production DOM/CSS capture with source hash, soundtrack generator/manifest, plan, reference study, poster, share copy, creative review and verification. Only in the film, the handoff card's backdrop blur/shadow and countdown are suppressed to avoid a compositor artifact and invented latency. Claude/ChatGPT shells and reset time are authored illustrations; transfer/generation timing is condensed, not measured live behavior. The film does not change production extension behavior.

`brag-output-2026-09-29-153657/brag.mp4` is the retained 62-second first Kyoto cut. Its output directory preserves its editable composition, distinct earlier soundtrack, poster and verification. The locally installed skill is at `.agents/skills/brag-slim/SKILL.md`, with its source recorded in `skills-lock.json`.

`brag-output/brag.mp4` is the retained 24-second first draft, rejected for repeating the earlier creative direction. It is historical material. The draft does not replace the retained V1/V2 exports.

`video/cap-context-launch-v2-polished.mp4` is a retained earlier standalone launch film: 29.5 seconds, 1080p at 60 fps. `video/v2/` holds the editable composition, production UI captures, original score generator, render/verification scripts and reproduction notes. The original V2 structure remains: a long chat, an explicit illustrated message-limit state, cursor-led Cap Context selection, capture/summary/paste, a new Claude chat with context and user-initiated continuation. Fuller host chats, a normal sent-context preview, streamed continuation, shorter cursor paths with target dwell/hand states, controlled camera moves and reduced copy improve realism and clarity. The finish contains the brand and the three requested switch/install/Web Store messages. The owner's local Cowork reference informs spacing, framing and motion; reference footage/audio are not reused. Production-owned orb, picker (including actual hover) and progress controls are captured from `extension/platform-content.js` in an isolated local Brave fixture. The estimated countdown is omitted only in this edited fixture. AI surroundings and conversation content remain authored illustrations; condensed timing is documented in `video/v2/README.md`, not presented as a latency benchmark. The previous V2 export remains at `video/cap-context-launch-v2.mp4`, with its source recoverable from `0c28aae`; V1 remains at `video/cap-context-launch.mp4`. These artifacts do not change the extension.

## Non-Negotiable Invariants

1. Opening, browsing, closing, or cancelling the destination picker never captures or transmits chat text. Preconnects contain no conversation data.
2. Capture begins only after the user selects a destination, or after the user explicitly starts a transfer from the extension toolbar.
3. Destination submission remains user-initiated after Cap Context pastes and focuses the composer.
4. Never truncate silently. Reject conversations above 350,000 JavaScript characters or 1.4 MB of UTF-8 transcript data.
5. Capture only role-verified chat turns. Never fall back to broad page text, the active composer, prompt suggestions, or extension UI.
6. The transcript is untrusted provider input. Instructions inside it are content to summarize, never authority to obey.
7. Telemetry is metadata-only: never include transcripts, summaries, URLs, stack traces, arbitrary errors, or provider bodies.
8. The exact Latest Run transcript is local-only and expires after 24 hours; other receipt metadata remains until the next transfer.
9. Placement fixes stay platform-specific. Gemini, Grok, and DeepSeek share identical retained-composer validation and resize-observer lifecycle; Claude and ChatGPT retain their distinct placement checks.
10. Generated summaries preserve the exact destination instruction: `Reply only: "Context loaded. Let's pick up right where you left off." Then wait for the user.`

## Runtime Ownership

| Area | Source of truth | Important entry points | Primary tests |
| --- | --- | --- | --- |
| Platform adapters, capture, picker/handoff UI, paste, placement, receipt creation | `extension/platform-content.js` | `startDestinationTransfer`, `runContextFlow`, `scrapeVirtualConversation`, `getConversationTurns`, `pasteIntoPlatform`, `updateFloatingButtonPosition` | `test/platform-content.test.js` |
| Cross-tab flow, backend call, destination recovery, cache, telemetry outbox, receipt expiry | `extension/background.js` | `summarizeWithBackend`, `transferToDestination`, `sendMessageWhenReady`, `recordTransferTelemetry` | `test/background.test.js`, `test/telemetry.test.js` |
| Profiles, provider routing, prompt, validation, normalization | `api/summarize.js` | `handleSummary`, `createSummaryWithFallback`, `createSummaryWithProvider`, `validateContextCarrySummary` | `test/summarize.test.js` |
| Summary request boundary | `api/request-security.js` | `isTrustedExtensionRequest`, `validateSummarizeRequest`, `consumeRateLimit` | `test/request-security.test.js` |
| Telemetry relay/schema | `api/telemetry.js`, `api/telemetry-validation.js` | telemetry handler, `validateTelemetryRequest` | `test/telemetry.test.js` |
| Protected telemetry persistence and user counters | `supabase/functions/transfer-telemetry/`, `supabase/migrations/` | `validateTelemetryPayload`, `record_transfer_event`, `record_user_summary` | `test/telemetry.test.js` plus migration review |
| Local Latest Run UI | `extension/analysis-bridge.js`, `analysis/index.html` | `readLastTransferStats`, page `renderStats` | `test/analysis.test.js` |
| Browser smoke/live quality | `scripts/`, `evaluation/` | `run-extension-smoke.js`, `run-regression-eval.js` | npm scripts below |

`extension/platform-content.js` is a large shared page-lifecycle script. It owns platform selectors, observers, timers, reservations, capture state, and transfer UI. Add characterization tests before extracting or broadly refactoring it.

## Platform Behavior Matrix

| Platform | Shipped host | DOM pasted-card capture | Stable turn ID | Paste activation | Placement contract |
| --- | --- | --- | --- | --- | --- |
| Claude | `claude.ai` | Yes | No; exact role+text fallback | May paste inactive | Composer-local beside voice controls; `/new` and `/chat/` have separate vertical tuning |
| ChatGPT | `chatgpt.com` | Yes | Yes, from structural turn/message IDs | Focus first, settle 350 ms | Production: fixed left of the model selector; branch experiment below |
| Gemini | `gemini.google.com` | No | No; exact role+text fallback | May paste inactive | Left of Pro/Flash selector |
| Grok | `grok.com` | No | No; exact role+text fallback | Focus first | Beside mode/speed selector |
| DeepSeek | `chat.deepseek.com` | No | No; exact role+text fallback | May paste inactive | Near attachment/input controls |

JavaScript still recognizes exact legacy `chat.openai.com`, but the shipped manifest does not grant or inject on that host. Do not describe it as supported without changing and testing the manifest contract.

## End-to-End Transfer

```text
bubble click
  -> picker opens and preconnects only
  -> destination click creates attempt ID and started telemetry
  -> empty chat fails before destination/handoff work
  -> inactive destination tab opens while source capture runs
  -> source captures fresh network JSON (DOM preparation/sweep when flash is off)
  -> background obtains one local/generated Context Carry
  -> prepared destination is revalidated or replaced once
  -> context is pasted and verified
  -> source completion finishes, destination focuses, receipt/telemetry finish
```

The toolbar action skips the picker. It defaults to Claude when the source is ChatGPT, otherwise to ChatGPT.

Important sequencing:

- Local preview on `codex/smooth-transfer-errors` (not pushed): fast capture requires a saved-chat route matching its JSON bridge. A new chat with zero verified turns goes directly from the picker to `Chat is empty`, before handoff, capture or destination preparation. Unsaved chats with rendered turns use DOM capture; saved JSON chats can still capture before their DOM mounts. Error notifications retain the fixed bottom-right anchor (`right:20px`, `bottom:80px`), slide in from the right and fade left on dismissal, with the existing 260 ms timing and reduced-motion support. Their position never follows picker/handoff geometry. Reopening the picker or starting handoff cancels pending error reveals/dismissals; a dismissed handoff cannot be revived by its queued entrance frame.
- The picker, handoff progress and handoff/error palette styles are adopted directly on supported browsers so page style-tag restrictions cannot strip fonts, selection states, progress circles or colors. Palette additions resync the owned sheets, and teardown removes only extension-owned sheets. The shared design and transfer behavior are unchanged.
- The orb, destination picker, and handoff card form one visual transition. Normal page Tab navigation skips the orb, while pointer activation still opens the picker and explicit keyboard/backdrop dismissal can restore trigger focus programmatically. Clicking a page control preserves focus on that control. Placement-only lifecycle work, including fullscreen resize reflow and transient composer loss, closes stale picker UI without moving focus. A chosen tile holds long enough to register, and the handoff card expands from the picker's measured screen position. Reduced-motion users receive the same state changes without movement.
- The destination picker, handoff card and status/error notifications protect their existing palettes against Dark Reader rewriting inline styles. Their stylesheets use Dark Reader's ignored `darkreader` class and ID-scoped priority colors. Picker hover/selection colors keep inline priority; handoff progress colors remain state-driven. The handoff and notifications snapshot only their static inline palette before insertion, so the fallback rules preserve the authored colors without duplicating them. These styles are extension-owned and removed on teardown; the host page's theme is unaffected.
- If page CSP blocks the handoff's style tag, the same CSS is installed as a constructed stylesheet so stage circles, connectors and labels retain the shared layout. That fallback is removed on teardown.
- `isRunning` is page-local with a six-minute safety reset. The reset clears UI/state but does not abort ongoing capture, fetch, or paste work.
- Picker-path telemetry starts before empty-chat validation so early exits are recorded safely.
- Destination warmup and network preconnects never contain conversation text.
- Progress completes only from real capture, summary, and paste events; in-stage line motion is decorative.
- The summary connector and countdown use captured character count for a display-only estimate: 20 seconds through 60,000 characters, rising smoothly to 65 seconds at 110,000 and capped there. The countdown remains hidden until capture supplies that size and stops as soon as the summary is ready, before destination preparation or pasting. An expired estimate says `Taking a little longer—still working.` without promising imminent completion. This initial curve comes from the owner's September 30 Flash-Lite runs, not measured model progress. The line stops at 90% until a real completion event; the fully opaque tip pulses in size throughout the wait, including overruns, and reduced motion disables the animation. This estimate never changes provider budgets.
- Finishing skips line-animation waits when the source is hidden. Visible completion gets two animation frames with a 120 ms fallback; hiding the source during that wait releases it immediately and cleans up its frame, timer and visibility listener. A suspended repaint cannot indefinitely delay destination activation or receipt saving. The timeline records handoff finish, deferred final activation and transfer completion so the total includes visible final steps.
- ChatGPT and Grok require focus before paste. The source completion cue finishes first; ChatGPT then gets a 350 ms activation settle.
- Claude, Gemini, and DeepSeek paste while inactive. The source completion cue finishes before the already-pasted tab is revalidated and focused.
- A missing, navigated, or failed prepared tab receives at most one fresh destination tab.
- All five destinations use verified paste retries and editor-remount recovery; no separate one-shot paste path exists.
- ChatGPT keeps its in-paste 550 ms stability check. Claude, Gemini, DeepSeek, and Grok recheck 550 ms after the destination becomes visible, without delaying activation. If the editor is empty, they paste once more and check both immediately and after another 550 ms. A still-missing draft, unavailable editor, or nonempty changed draft opens the existing manual-copy modal in the destination tab; changed user text is not overwritten.
- Exhausted paste recovery shows one manual-copy fallback when a summary exists. Clipboard success is claimed only after a real copy succeeds.
- Provider errors are converted to bounded user-safe messages; raw upstream bodies never reach the extension UI.

## Extension Message Contract

These names form an internal API. Update sender, receiver, tests, and this section together.

| Message | Direction | Purpose |
| --- | --- | --- |
| `START_CONTEXT_TRANSFER` | background -> source | Toolbar start; optional destination |
| `CONTEXT_GENERATOR_PING` | background -> content script | Readiness check before retry/injection |
| `ENSURE_CLAUDE_JSON_HOOK`, `ENSURE_CHATGPT_JSON_HOOK`, `ENSURE_NETWORK_JSON_HOOK` | corresponding top-frame bridge -> background | Ensure the matching MAIN-world hook is ready before an explicit JSON capture |
| `PREPARE_DESTINATION` | source -> background | Open and warm an inactive destination |
| `SUMMARIZE_WITH_BACKEND` | source -> background | Submit the captured conversation and return summary/timing |
| `TRANSFER_TO_DESTINATION` | source -> background | Reuse/recover a tab, paste, and apply activation policy |
| `PASTE_CONTEXT` | background -> destination | Insert and verify the prepared context |
| `ACTIVATE_DESTINATION_TAB` | source -> background | Revalidate and focus a destination that pasted inactive |
| `RECORD_TRANSFER_TELEMETRY` | source -> background | Queue a closed-schema metadata snapshot |
| `CONTEXT_TRANSFER_ERROR` | source -> background | Safe badge/log signal |
| `REQUEST_LAST_TRANSFER_STATS` | analysis page -> bridge | Request the local receipt through `window.postMessage` |
| `BRIDGE_READY`, `LAST_TRANSFER_STATS` | bridge -> analysis page | Announce the bridge and return receipt data |

Background retries missing receivers every 120 ms and may inject the shared `platform-content.js` script. Pre- and post-injection attempts use the same deadline and error policy; non-retryable errors stop immediately. Timeouts: 12 seconds for source startup, normally 30 seconds for destination messaging, 45 seconds for ChatGPT, 9 seconds for normal warmup, and 12 seconds for ChatGPT warmup.

## Capture Engine

### Network JSON capture

All five sources use the shared default-on fast-capture control in the picker: an outlined lightning icon, yellow when enabled, with hover/focus feedback and accessible state. Opting out selects DOM capture for the current page instance until reload/reinjection; reopening the picker preserves the setting. Toolbar transfers always use DOM capture. Opening or toggling the picker does not read or transmit chat text.

A Claude-only MAIN-world script at `document_start` wraps `fetch` to remember a bounded set of conversation endpoint URLs keyed by chat ID, without reading or retaining response bodies. After a destination selection with the toggle on, an isolated-world bridge requests fresh JSON through a same-origin fetch using the browser's existing cookies. The response is cloned, correlated to the request and current chat, and serialized locally into the existing `SUMMARIZE_WITH_BACKEND` transcript contract. Raw JSON and cookies are never sent to the backend. Opening or toggling the picker does not capture or transmit messages.

Claude JSON strings bypass DOM cleanup at the capture-metrics boundary, preserving NBSP, code indentation and line whitespace; existing outer-transcript trimming remains. Claude capture follows `current_leaf_message_uuid` through parent links and extracts direct `text` and `thinking` blocks from human/assistant turns (`text` or `thinking` string fields). Claude pasted cards are also included from human-turn `message.attachments`: only entries with `file_type: "txt"`, `file_name: ""`, and a non-empty string `extracted_content` qualify. This shape was verified against a live 441-line pasted card; named uploads and other attachment types remain ignored. Original pasted strings, including indentation and outer whitespace, belong to their owning user turn, including pasted-only turns. Repeated attachment IDs are deduplicated within that turn; distinct cards with identical or overlapping text remain in attachment order. A matching complete inline paragraph can represent one card, with its original whitespace restored; an arbitrary prompt substring is never enough to drop a card. Pasted text counts toward the existing transcript size limits. The extractor never recursively reads text from tool calls/results, search snippets, artifacts, files, attachment subobjects, or sync sources. All tools, files, images, artifacts, and other block types are skipped silently, regardless of tool name or pairing. Legacy `message.text` is used only when structured content is absent/empty; it is not appended to structured blocks. Turns with no usable text are skipped, and content filtering fails only when the whole active branch has no usable user/assistant text or pasted text. Conversation identity, branch integrity, transport limits, and destination paste/no-auto-send checks remain. Fast-capture failure shows a fixed safe notice and automatically runs the existing DOM preparation/sweep once within the same transfer, reusing its prepared destination; only the completed capture reaches summarization/paste. Latest Run labels successful capture `claude-json`.

Claude JSON scripts are reinstalled on already-open Claude tabs when the extension starts/reloads. Explicit capture first checks the MAIN hook with a correlated v3 ping/pong on the v2 bridge channel, which isolates legacy v1 hooks. A working hook needs no worker round-trip; a missing, older, or replaced hook gets one bounded eight-second background recovery, and actual hook readiness can succeed before a delayed installation callback. Installation is idempotent and replaceable without accumulating message handlers. Replacement retains the hook's bounded exact-chat route map even when resource timing has evicted or cleared those URLs; late installation also recovers routing from resource timing without reading prior response bodies. A 1.5-second bounded wait allows an initial/SPA request to expose a missing endpoint. Other-chat prefetches cannot replace the selected chat's route; absent routing fails visibly rather than guessing an organization. Refresh remains a recovery option when neither route history nor a matching request exists. Claude JSON accepts complete API history before native turns mount, and pins the chat path at destination selection before handoff animation/setup. Concurrent requests fail promptly; capture rejects Navigation API chat changes (including away-and-back) or history popstate during setup, fetching, and response delivery, and always rechecks identity/path after parsing. Browser-specific MAIN-world/Navigation API support and live Claude schema compatibility remain capture limitations; the DOM sweep below remains available through the toolbar or an explicit picker opt-out.

JSON structural validation failures identify missing fields or invalid parent links without including conversation text, filenames, or tool payloads. Both the all-zero root sentinel and Claude's `00000000-0000-4000-8000-000000000000` root marker are accepted.

Claude JSON requests rebuild the observed conversation URL with the native full-tree/message/all-tool/inline-comparison/strong-consistency parameters and discard observed pagination/window parameters. Only HTTP 200 JSON without `Content-Range` is accepted. Completeness checks reject explicit partial/truncated/missing-history flags, further-page cursors, and advertised total counts larger than the returned message array. These checks inspect conversation, `page_info`, and `pagination` metadata, active own-turn messages, captured direct text/thinking blocks, and recognized pasted attachments; they do not recursively inspect skipped tools or files. Active parent chains must reach null or a recognized root marker; false-like or malformed parent markers are errors. Explicit unfinished own turns/blocks, malformed captured content, and missing pasted `extracted_content` fail before summary submission. When a pasted card supplies `file_size`, its untrimmed extracted UTF-8 byte count must match or completeness is unverifiable and capture fails. Empty hidden thinking with `truncated: true` is normal live Claude metadata and remains skipped. Live inspection on 2026-09-27 found a full 114-message tree with `message.truncated: false`, but no authoritative total-count/completeness field. Full-tree requests plus these checks catch detectable omissions; an unmarked, internally consistent server omission cannot be independently proven absent.

ChatGPT uses the shared fast-capture control. ChatGPT's MAIN hook is installed at `document_start` and reinstalled on existing ChatGPT tabs when the extension starts/reloads. Each explicit JSON capture first probes the live v5 MAIN hook with a same-window/origin, ID-correlated ping/pong; the hook replies only while it owns the current fetch wrapper. A working hook proceeds without waking/reinstalling through the extension worker. If the hook is missing, older, or replaced, one top-frame-only background installation gets an eight-second recovery window. Repeated probes detect actual readiness even when the worker callback is delayed; an installation acknowledgement alone cannot authorize capture. The picker pins the destination-click chat before handoff preparation. Bridge navigation listeners span readiness through response delivery, latching away-and-back changes; project path aliases for the same chat remain valid. Probe/navigation timers and listeners are cleaned on completion. Versioned installation avoids duplicate handlers and preserves page-memory auth across reinjection. No session/message reads occur just from installation, readiness probes, opening the picker, or toggling it.

The hook observes allowlisted auth/account headers on same-origin `/backend-api/` fetches without reading their response bodies. Authentication is session/account scoped, so a cached sidebar or project `/g/.../c/{id}` navigation does not need a new conversation-specific request. Capture always fetches a fresh same-origin `GET /backend-api/conversation/{id}` with browser cookies and observed headers, without pagination parameters. When installed late with no observed auth, it obtains `accessToken` and the current session account ID from `/api/auth/session` only on explicit capture. Every authenticated tree/paste-descriptor read uses the latest observed headers. One HTTP 401 retry is shared across the entire capture: use newer observed same-workspace auth when available, otherwise refresh the session once, then recheck navigation/account cancellation before retrying. HTTP 403 and partial responses are never retried or redirected to a guessed workspace. Signed paste-content requests never receive bearer headers. Tokens, session data, cookies, and auth headers stay in MAIN memory and never cross the bridge or reach storage/logs/the summary backend. Account changes and navigation away/back abort in-flight captures; concurrent requests fail promptly. Readiness and request waits are bounded. Absent auth or unavailable MAIN-world support triggers the same announced one-time DOM fallback.

The bridge follows the `mapping` tree from `current_node` to a null-parent root. It rejects malformed/missing nodes or messages, mismatched IDs, invalid false-like roots, cycles, explicit previous/next/missing/partial/truncated indicators, malformed completeness metadata, and advertised totals greater than the entire returned tree. It accepts only HTTP 200 JSON without `Content-Range`; partial HTTP 206, invalid JSON and non-JSON fail before backend submission. Own captured text and metadata must not advertise incomplete content. In-progress/failed turns and nonterminal active assistant nodes with `end_turn: false` are rejected. A terminal `finished_partial` generation (for example, deliberately stopped by the user) can retain its text even when `end_turn` remains false, if its own completeness metadata passes; this is distinct from a partially loaded network history. The JSON path does not depend on rendered message count or invoke DOM scroll/pasted-card preparation.

Only verified own user/assistant text is captured: text/multimodal string parts, immediate multimodal `audio_transcription.text` parts, direct `code.text` and `thinking` fields, `reasoning_recap.content`, and `thoughts[].content` (or the visible own summary when the body is empty). Voice transcripts require a complete string and passing part/metadata completeness checks; audio/image pointers, pointer metadata, binary media and nested tool transcriptions remain excluded. Original strings preserve indentation, CRLF, NBSP and line whitespace. The ChatGPT JSON capture-metrics boundary bypasses DOM cleanup so code/pasted/canvas text is not rewritten; the existing summary pipeline still trims outer transcript whitespace. Repeated content in separate turns is preserved. Full thought bodies take precedence over duplicate summaries/chunks. Modern editable `:::writing` document blocks are already direct assistant text and remain intact.

ChatGPT also converts large user pastes to `metadata.attachments` with `is_big_paste: true` and `mime_type: "text/plain"`, sometimes leaving `content.parts` empty. Only those active, visible user-turn attachments qualify. On explicit capture, MAIN follows the native authenticated `/backend-api/files/download/{id}` descriptor and its signed same-origin `/backend-api/estuary/content?id={id}` URL. The content request carries no bearer headers, disallows redirects, and the signed URL stays in MAIN. HTTP 200 plain text, no `Content-Range`, matching descriptor/attachment/download byte counts and valid UTF-8 are required. Reads share the existing capture timeout/navigation/account cancellation and a bounded byte budget. The bridge preserves each distinct card in its owning user turn, including identical/overlapping card text. Repeated file IDs are deduplicated only within that turn; one complete inline paragraph occurrence may represent one card, with original whitespace restored without shifting other inline ranges. Arbitrary prompt substrings are not copies, and both LF and CRLF paragraph boundaries are recognized. A recognized paste that cannot be read completely fails visibly instead of dropping the user. Inactive branches, assistant/tool attachments, ordinary uploaded files and non-text paste types are not fetched. Live capture of the owner's example verified all 13,530 original user bytes and an exact 27,040-character transcript ordered user -> assistant recap -> assistant writing block.

Legacy canvas documents have one narrow exception to the tool-directed-message filter: assistant `canmore.create_textdoc` and `canmore.update_textdoc` messages followed on the active branch by their successful tool acknowledgement with matching command and `metadata.canvas` identity/type. Live JSON verified both `code.text` and `text.parts` JSON envelopes. Only the created document's `content` (with its title) or an edit's `updates[].replacement` text is retained as assistant content; document and `code/*` types qualify. Full rewrites and partial edit text preserve their original whitespace and chronological turn placement. Partial changes are labelled canvas edits, not reconstructed into a guessed latest document. Editor-only changes outside conversation messages are not fetched. Tool replies, patterns, operation parameters and unrelated tools remain excluded. Malformed or detectably incomplete acknowledged document text fails visibly, and all document text counts toward the existing limits.

System/tool roles, other tool-directed assistant messages, hidden messages, non-string multimodal objects, uploaded files, arbitrary artifact objects, citation metadata, images/audio and other unsupported content remain skipped; no tool payload is recursively searched for text. Empty turns are skipped, and a wholly empty transcript fails. The existing 350,000-character / 1.4 MB limit applies without truncation. Latest Run labels successful capture `chatgpt-json`. Validation errors expose structural reasons only; picker failures use the announced one-time DOM fallback.

Live read-only inspection on 2026-09-28 verified a 74-node native full tree, the separate 10-turn recent-message endpoint, null-root/terminal-turn metadata, tool-directed code, direct recap strings, and own thoughts with empty bodies plus visible summaries. An explicit session-authenticated full-tree read succeeded (77 nodes after the conversation advanced). No authoritative total/completeness field was present beyond `context_truncation_continuation: null`. Full-tree requests and structural checks catch detectable omissions; an unmarked, internally consistent server omission cannot be independently proven absent. Real-site inspection did not send a transcript to the production summary backend.

### Gemini, Grok and DeepSeek JSON capture

`network-json-data.js` owns the three verified format adapters; `network-fetch-main.js` observes native routing/session envelopes and performs explicit fresh reads in MAIN. Both Gemini and DeepSeek use native XHR, so the hook observes outgoing XHR URL/body/header calls as well as fetch; native responses remain unread. `network-json-capture.js` checks hook readiness and requests only the current saved chat. The bridge receives the validated transcript and turn count, not raw JSON, bearer credentials, RPC CSRF tokens, or signed file addresses. MAIN installation is idempotent, previous session/routing state survives replacement, startup installs both worlds on existing tabs, and explicit capture can recover a missing hook independently of a delayed worker callback through `ENSURE_NETWORK_JSON_HOOK`. A first late DeepSeek installation without any observed native authenticated request requires a signed-in page refresh; it never reads arbitrary browser storage for tokens.

- Gemini: native XHR/fetch `hNvQHb` batchexecute RPC. Observe request envelopes only; late installation can recover the native endpoint from resource timing and its matching `WIZ_global_data.SNlM0e` CSRF value. Request ten turns per page and follow the returned opaque cursor until null. Require complete framed RPC envelopes, the final RPC marker, unique chat/turn IDs, uninterrupted parent linkage down to a null root, and the selected response candidate. Native pages are newest first; serialize oldest user/assistant pairs first. Preserve direct user text and selected response text, including complete code/document strings; presentation blocks, other candidates and nested tools are not recursively read. The optional flag at assistant index 9 is absent on valid older chats and is not an authoritative completeness indicator. Pagination that fails to advance, missing roots/parents/candidates and truncated frames fail visibly.

Gemini and Grok use v2 readiness; DeepSeek uses v3 to replace older handlers that accepted readiness without checking XHR ownership; Grok v2 replaces old MAIN adapter closures before enforcing file-only turn protection. Gemini's hook answers only while it owns both current fetch and XHR observation; replacement repairs the wrappers without discarding the observed RPC template or page's newer network layer. The picker pins Gemini's chat at destination click, and the bridge latches away-and-back navigation from readiness through queued response delivery, with listeners removed on every exit. Gemini JSON strings bypass DOM cleanup at the capture-metrics boundary, preserving NBSP in code, CRLF, indentation and line whitespace; the existing summary pipeline still trims outer transcript whitespace.
- Grok: fresh `response-node`, then `load-responses` for the active branch in bounded batches. Use the native URL's `rid` when present; otherwise require one unambiguous leaf. Native first human nodes point to a synthetic root absent from the tree; only that first node may use an external root. Every other parent and requested message body must exist and match identity/role/parent. Preserve direct human/assistant `message` strings (including a verified 37,887-character original user paste and long authored code). Ignore control turns and nested chunks, tool/search output and file metadata. A human turn with blank text and nonempty `fileAttachments` or `fileAttachmentsMetadata` fails visibly instead of silently dropping the turn; this does not fetch attachment bodies. Empty turns without files and control turns remain excluded. The picker pins Grok's full source URL at destination click, including `rid`; the bridge checks both chat and branch and latches away-and-back navigation throughout readiness and queued response delivery. Grok JSON bypasses DOM cleanup at the metrics boundary, preserving source code/NBSP/line whitespace. Inflight responses, partial/error flags, missing bodies, ambiguous branches and explicit pagination/count omissions fail visibly.
- DeepSeek: fresh authenticated `history_messages` without the native device/cache client headers. Require `code: 0`, `biz_code: 0`, matching chat identity and `cache_control: "REPLACE"`; a `MERGE` delta is not full history even when it contains no messages. Follow `current_message_id` through numeric parents to null. Preserve own user `REQUEST` and assistant `THINK`/`RESPONSE` fragments in order, with terminal `FINISHED` status and no pending/incomplete/continuing fragment flags. Active user `FILE` entries for non-image plain text, Markdown, code, web source and structured-text data files qualify through the bounded extension list in `textFile` (including `.py`, `.js`, `.yaml` and `.sql`). Read their original native signed `files.deepseeksvc.com/api/file` route with `ty=r`, without bearer/cookies. Require the exact file ID, successful parse status, allowed text/octet-stream response, complete UTF-8 including any BOM and matching original byte count. The earlier native `.txt` upload contained 3,318 bytes; signed URLs remain in MAIN. Binary, Office, PDF, images and tool fragments remain excluded. The picker pins DeepSeek's chat at destination click, and the bridge latches navigation through readiness and queued response delivery. DeepSeek JSON bypasses DOM cleanup so original source whitespace/NBSP survives the metrics boundary; existing outer-transcript trimming remains. The v3 contract replaces older MAIN adapter closures on demand while retaining observed session auth. Readiness and idempotent installation verify current fetch and XHR prototype/open/send/header ownership; replaced observers trigger bounded recovery before capture. No new role/fragment extraction or `incomplete_message` interpretation is inferred from hypothetical values; see `docs/debugging/deepseek-json-audit.md` for the confirmed and deferred findings.

All three reject non-200/ranged transport, malformed histories, zero usable text, detected incomplete content and oversized transcripts without clipping; the picker then uses the announced one-time DOM fallback. Only typed adapter errors expose structural details; arbitrary native fetch/parser/decoder errors are masked. Navigation/session changes cancel active reads, concurrent captures fail promptly, and requests share a 25-second budget with a 6 MB raw-read ceiling. Raw-size failure uses the existing user-facing character-limit message. Latest Run identifies `gemini-json`, `grok-json` or `deepseek-json`; summarization and destination paste behavior remain unchanged. These native APIs expose no independent authoritative guarantee against unmarked, internally consistent omissions. Dedicated Gemini Canvas / Grok Build editor state outside verified conversation strings, binary/PDF/Office uploads, images and audio are not fetched. The live Gemini Canvas attempt failed in the provider UI, so its separate editor format remains unverified rather than claimed supported.

### Preparation and sweep

The standard DOM preparation/sweep remains available on all five platforms. If fast capture fails, the handoff says `Fast capture failed. Using normal capture instead.` and runs DOM preparation/capture once without restarting the transfer, opening another destination, or submitting twice. Native error details are not displayed or recorded for this recovery. Navigation/session cancellation or a changed source URL aborts safely rather than capturing a different chat; a failed DOM fallback retains the normal failure handling and size limits. The JSON adapters above run only after choosing a destination with the source's lightning button enabled; the toolbar continues using DOM capture.

The DOM path uses this bounded rendered-window sweep:

1. Reset per-transfer pasted-card state and cached scroll roots.
2. Scroll the real conversation root to the top and wait for three stable samples of turn count, characters, height, and top position. Claude/ChatGPT allow 4.5 seconds; other sites allow 1.8 seconds.
3. Expand verified collapsed content and supported pasted-content cards.
4. Capture a window, advance by 60% of the viewport, and wait for rendering stability. Proven ordered overlap may permit the next 90% step.
5. Stop through bounded no-movement/quiet logic, a stale limit, or 480 advances. Boundary `scrollIntoView` is fallback-only.
6. Sequence-align rendered windows into the initial baseline. Longer matching text may replace a shorter rendering; partial text never downgrades a collected turn.
7. Serialize as `<Platform> conversation:` followed by `User:` and platform-role turns separated by blank lines.

Grok uses a platform-specific adaptive sweep because its rendered message window normally updates promptly after instant scrolling: two 40 ms preparation samples, two samples inside a 100 ms fast settle window, 70% viewport advances until ordered overlap is proven, then 90% advances, 10 ms change polling, and a 160 ms terminal quiet check. When a physical scroll produces no immediate window change, Grok waits up to 220 ms for a delayed virtualized render before advancing again. Other platforms retain the shared conservative timing and adaptive 60%/90% policy. The Grok path still sequence-aligns every rendered window and applies the same role verification, exact deduplication, limits, and terminal checks.

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

| Profile | Input chars | Target | Orca/Mistral/Groq cap | Gemini summary + reasoning | Advisory word floor |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tiny | 0-1,200 | exact local carry | 0 | provider-free | n/a |
| Small | 1,201-8,000 | ~350 words | 1,000 | 1,500 + 5,000 = 6,500 | 80 substantive words |
| Medium | 8,001-60,000 | ~700 words | 1,900 | 3,000 + 6,000 = 9,000 | 140 substantive words |
| Large | 60,001-210,000 | ~1,200 words | 4,200 | 6,000 + 8,000 = 14,000 | 200 substantive words |
| Extra-large | 210,001-350,000 | ~1,800 words | 7,000 | 10,000 + 10,000 = 20,000 | 200 substantive words |

Tiny output is different by design: canonical header, quoted `CONVERSATION SO FAR`, and the exact `NEXT STEP`. It does not call a provider or use all seven generated-summary sections.

Generated provider order:

```text
Gemini 3.6 Flash
-> Google Gemini 3.5 Flash-Lite
-> Ministral 3 14B (25.12)
-> emergency local-direct exact transcript
```

- Gemini is skipped without `GEMINI_API_KEY`. Only 3.6 Flash is active, with a 90-second family and model budget. Flash 3.7, 3.8, and regular 3.5 remain paused; set `GEMINI_FLASH_FALLBACKS_ENABLED=true` to restore them within that same family allowance. Re-enabled Flash routes divide the remaining family time across remaining model slots. Daily health skips still apply.
- When Vercel has `KV_REST_API_URL` and `KV_REST_API_TOKEN` (or the older `UPSTASH_REDIS_REST_*` aliases), each Gemini model uses a shared Pacific-day health record. Twenty successful summaries mark it `exhausted`; three consecutive failed summary attempts mark it `bad_mood`; either status skips that model until the next Pacific day. An explicit daily-quota response also marks it exhausted immediately. Gemini 429 responses move directly to the next model instead of retrying the same model. Redis stores only model counters/status/timestamps, and storage trouble fails open to the normal provider order. See `GEMINI_MODEL_HEALTH.md` for production setup and diagnosis.
- OrcaRouter is paused by default. Set `ORCAROUTER_ENABLED=true` and redeploy to restore its retained free route between Flash-Lite and Mistral. Orca keeps its 60-second budget; when both Google routes are configured, its elapsed time is deducted from the final Mistral allowance. See `docs/provider-fallbacks.md`.
- Successful OrcaRouter responses use `X-Orca-Resolved-Model` as the receipt model, so Latest Run names the concrete DeepSeek, GLM, or other free model instead of showing the `orcarouter/free` request alias.
- Mistral is active in production with `MISTRAL_ENABLED=true`. Set it to `false` and redeploy to pause reversibly. It is also skipped without `MISTRAL_API_KEY`. Only Ministral 3 14B is active, with a 90-second budget. It has one model attempt in the routing chain; HTTP retries remain bounded inside that model budget. Mistral Large 3 remains excluded because the Free-tier key receives HTTP 403 code 1910. HTTP 429 advances immediately to the next route.
- Groq is paused even when its key exists. Set `GROQ_ENABLED=true` to restore `groq/compound-mini` with its retained 15-second budget; when both Google routes are configured, its 15-second slot is reserved from Mistral so restoring routes does not extend the total allowance.
- Flash-Lite uses Google `gemini-3.5-flash-lite` and the existing `GEMINI_API_KEY` immediately after the Flash family and before Mistral (and any explicitly restored routes). It has 90 seconds with `MINIMAL` thinking and remains independent of Flash daily-health skips. Parsing, hidden-thought filtering, relaxed validation, and Google timings remain unchanged. Flash-Lite has its own 90-second slot; restored Orca elapsed time and the optional Groq reserve share Mistral's final slot so the whole chain stays within 270 seconds.
- If every configured remote provider fails or no provider key is available, the backend returns the complete captured transcript through the provider-free `local-direct` format. It never truncates the transcript; the transfer remains usable during a provider-wide outage, though it is not compressed.
- Once a supported transcript has been verified and captured, backend HTTP/network/parse failures, empty replies, and unavailable extension-worker messaging also recover in the source page with a quoted full-transcript carry. This source-local result is reported as `local-direct` with the fixed fallback reason `summary_service_unavailable`; no raw error is copied into its receipt. Destination failure still offers manual copy. Capture verification and the 350,000-character boundary remain enforced; missing or unverified captures are never guessed.
- Retryable provider calls get at most two attempts within the model budget and an 90-second per-attempt ceiling. Ordinary retries wait 450 ms. Gemini, OrcaRouter Free, and Mistral move immediately to their next fallback on HTTP 429; Groq honors `Retry-After` or waits at least one second.
- Gemini uses `thinkingLevel: MEDIUM`. Mistral prompt-cache keys use `capcontext-summary-v7-<profile>-<model>`; v7 adds an explicit full-transcript checklist and final omission check for user-protected exact facts, especially integrity and implementation-state details.
- The extension calls the production alias `context-generator-five.vercel.app`. Git pushes to `codex/*` branches create preview deployments; they do not replace that alias. To release backend routing changes, redeploy the tested deployment with Vercel target `production` so it uses production environment variables, then verify the alias, source commit and a real summary receipt. A successful push or ready preview alone is not a production release.
- Fluid Compute is enabled on Vercel Hobby. The server allows 300 seconds; active provider budgets total 270 seconds, reserving about 30 seconds for overhead. The extension aborts at 320 seconds, allowing transport time after server completion, and keeps its MV3 worker alive every 25 seconds.
- The backend emits JSON-safe whitespace heartbeats every 15 seconds after the first 15 seconds.
- Identical concurrent conversations share one background promise. Up to eight exact completed results remain in worker memory for two minutes; cache hits preserve original provider metadata.

### Prompt and validation

Providers receive a system prompt and a user JSON envelope with schema `cap-context-conversation-v1` and data type `untrusted-conversation-transcript`. `getSummarySystemPrompt()` and `getContextCarryTemplate()` are the complete backend prompt contract; the retained standalone `legacy/SKILL.md` is a reference artifact and is not read by the backend.

The prompt still requests the exact title and all seven sections once and in order: WHO I AM, WHAT WE WERE DOING, WHERE WE LEFT OFF, DECISIONS MADE, OPEN QUESTIONS, KEY CONTEXT, NEXT STEP. Structure and formatting never cause provider rejection. A separate content check rejects only refusal-only output and substantively empty output (no actual content after recognized scaffolding, empty placeholders and trusted instructions are removed). Short useful text, malformed/duplicate/missing headings, and useful token-limited output remain deliverable. Quoted refusals, contextual inability to connect/build, and useful content alongside a refusal remain deliverable. Rejected output advances through the existing chain to the full-transcript `local-direct` carry. See `docs/summary-validation.md` for the precise policy and its heuristic limits.

Strictly valid output retains existing normalization: remove fences/legacy footers, canonicalize recognized headings, add the Unicode box, and replace NEXT STEP. Other non-empty output is preserved verbatim apart from outer whitespace, with the trusted destination-confirmation NEXT STEP appended; missing sections are not invented.

Generated-summary response timing also includes `validationReason` (a bounded validator reason, or null) and `qualityFlags` (`bad_structure`, `missing_section`, `duplicate_section`, `token_limit`, `too_short`, `refusal_like`). The quality log contains only those diagnostics and the summary word count. Flags remain advisory; the independent content check decides whether output is refusal-only or empty. Tiny and emergency backend local-direct carries report an empty flag list and null reason. These fields are not part of Supabase telemetry.

Do not overstate current quality enforcement:

- Large-profile `minWords` is prompt guidance and a `qualityFloorMet` diagnostic. The retained advisory validator uses 20% of target, clamped to 80-200 substantive words; this floor no longer rejects provider text.
- `finishReason` is recorded but token-limit output is not rejected solely for that reason.
- Validation does not receive the source transcript, so it cannot detect a fluent, well-shaped hallucination.
- There is no expansion or semantic quality loop. The first provider result containing actual context wins; short or cut-off useful output is retained.

## Backend Boundary

`POST /api/summarize` requires `Content-Type: application/json`, public marker `X-Cap-Context-Client: cap-context-extension/1`, and exactly `{ "conversation": <non-empty string> }`.

- Accepted origins are Chromium and Firefox extension origins. Firefox may omit Origin; then the marker is mandatory. An already-running extension worker with a valid extension Origin may omit the marker for compatibility.
- The marker is public and is not an authentication secret.
- Limits: 2.2 MB JSON request, 350,000 JavaScript characters, 1.4 MB transcript UTF-8, 8 requests/minute and 40/hour per forwarded IP, and 8 concurrent jobs per warm server instance.
- Rate/concurrency state is process-local, not a durable global limiter.
- Responses are `no-store`; provider error bodies are not exposed.
- Both Vercel endpoints share bounded JSON parsing and case-insensitive header handling through `api/request-validation.js`. The Vercel and Supabase telemetry payload validators intentionally remain separate because they run in different deployment bundles; parity tests enforce their shared closed schema.

## Telemetry, Storage, and Analysis

| Key/alarm | Purpose |
| --- | --- |
| `context-generator-onboarding-dismissed-v2` | Local onboarding dismissal |
| `context-generator-last-transfer-stats-v1` | One Latest Run receipt; raw text expires after 24 hours |
| `context-generator-install-id-v1` | Random install UUID, not an account or real identity |
| `context-generator-telemetry-outbox-v1` | Ordered retryable metadata queue |
| `expire-latest-run-raw-transcript` | Alarm that removes only raw transcript fields |
| `retry-transfer-telemetry` | Alarm that retries delivery after five minutes |

`chrome.storage.local` persists receipts and outbox data; the summary cache, in-flight deduplication, active transfers and source `isRunning` lock are memory-only. The analysis renderer reads receipts through the GitHub Pages-matched bridge and its `window.postMessage` contract, rather than accessing extension storage directly.

The receipt records transfer/capture timings, counts, sizes, profile, the model that actually served, attempted and health-skipped models, fallback, finish reason, token usage, status, and exact captured text. Latest Run labels the serving model directly and excludes it from the failed portion of the fallback log. It deliberately does not store the generated summary. Background expiry and the analysis bridge both remove expired raw text.

The analysis page's overlapping-squares **Copy all details** icon copies the displayed Latest Run cards and timeline as readable label/value lines, excluding raw chat text. It is disabled without a receipt and briefly shows a check or cross for clipboard success or failure, with tooltips and accessible status text; a selection-based fallback supports clipboard-restricted browsers/local files. This adds no storage or backend requests.

Closed telemetry stages are: `intent_started`, `capture_started`, `capture_completed`, `summary_request_started`, `summary_response_started`, `summary_completed`, `paste_started`, `completed`.

Allowed failures are: `no_conversation`, `conversation_too_large`, `capture_failed`, `summary_rate_limited`, `summary_service_busy`, `summary_access_denied`, `summary_failed`, `destination_open_failed`, `paste_failed`, `extension_reloaded`, `client_interrupted`, `user_cancelled`, `unknown_failure`.

The only payload fields are install/attempt IDs, time, source/destination, captured character count, status, last stage, closed failure reason, and extension version.

Delivery path: `content script -> background outbox -> Vercel /api/telemetry -> Supabase Edge Function -> record_transfer_event`. Every layer rejects unknown fields. Supabase credentials remain server-side; RLS/grants block public tables. Upserts preserve the furthest stage and terminal result.

On 2026-09-29, the live `cap-context-telemetry` project (`iqkzynzxbmemhtiupwwu`) was verified with `transfer-telemetry` version 6 and a database constraint accepting all 13 failure reasons, including `user_cancelled`. The database was widened before function deployment to restore compatibility with existing ordered retry queues. `anon` and `authenticated` have no table privileges on `transfer_events` or `users`; `service_role` retains its table grants and EXECUTE on `record_transfer_event`. RLS and policies were unchanged. The ten active migration files match the live recorded history; the never-applied activity-view migration is retained outside the active folder. See `supabase/README.md` for target checks, dry runs and rollback SQL.

The protected `users` table creates a row on an install's first successful transfer and maintains lifetime and UTC-day summary counts. An advisory transaction lock prevents duplicate first-user races; pg_cron resets stale daily values at 00:00 UTC.

## Placement and Paste

- `inline-pill-experiment` branch only (not merged to production): Claude mounts the existing pill as a 32px non-shrinking child of the active editor's LEFT toolbar. Discovery walks the editor's ancestors for a sibling named `ChatComposerActions`, validates the attachment test ID and distinct native action rows, and rejects popup controls. New chats validate the model within that actions container; compact existing chats validate the model in the same named `ChatComposer` chin and the Send branch in their own right row. Unknown layouts hide the pill until a valid toolbar returns.
- Scoped adopted CSS moves Claude's absolute toolbar groups into wrapping normal flow and clears the editor's native left/right/bottom and pseudo-element reservations. Narrow new-chat layouts may gain a second toolbar row; compact existing chats gain a toolbar beneath the text row. The native model, Voice/Send controls and their animations remain functional without translating them.
- The existing document child-list observer, focus/visibility/resize events and SPA navigation monitoring remount the same owned button after editor replacement. Old native marker attributes are removed on replacement/teardown. Neither inline adapter uses a placement ResizeObserver or fixed geometry; Claude also removes its optical nudges and control translations. Legacy reservation cleanup remains for upgrading an already-running older content script.
- Picker/handoff overlays retain their page-root lifecycle. An open Claude/ChatGPT picker closes without restoring focus when the editor/toolbar is replaced, the route changes or the viewport resizes; normal mounting then resumes. The picker position remains locked during its transfer animation.
- Historical Claude fixed-placement evidence and discarded approaches remain in `docs/debugging/claude-last-known-dom.md` and `docs/debugging/claude-placement-logs.md`.
- `inline-pill-experiment` branch only (not merged to production): ChatGPT mounts a 32px non-shrinking child immediately before the model/reasoning trigger in `[data-composer-footer-responsive]`. That footer must contain the active editor's `[data-composer-input]` inside the same `[data-composer-body]`. The `add-context` navigation target identifies the left row; a distinct native-control row validates the right side without requiring a paid model selector. The `reasoning` navigation target selects the model trigger independently of its High/Medium/Instant label. Its native wrapper keeps the pill and trigger together; layouts without that trigger mount before the right-side native controls. Nested popup controls are excluded. The same owned button survives editor replacement, and unknown layouts hide until ownership can be validated again.
- Scoped adopted CSS lets ChatGPT's native control tracks size to their contents and preserves native editor row switching. The model trigger's native wrapper becomes an inline flex box, with the pill 6px before the trigger. The common ancestor of visible right-side native buttons is marked for wrapping: its model/voice branches use intrinsic flex bases instead of forcing a model button into a too-small track. At narrow widths this can add a native-control row. Markers are removed on remount/teardown. Old fixed anchors, synthetic composer rectangles, retained placement surfaces and dedicated GPT placement observers are removed; ChatGPT still requires focused paste.
- Gemini: left of the Pro/Flash selector; retains the outer composer during large-paste expansion.
- Grok: beside whichever visible Fast, Build, Auto, Expert, Heavy, or thinking-mode selector is active; retains the outer composer and requires focused paste.
- DeepSeek: near attachment/input controls; retains the outer composer during expansion.
- Gemini, Grok, and DeepSeek keep the last verified viewport placement for up to 700 ms when composer discovery temporarily fails. Because their normal orb is composer-owned, the grace path temporarily moves it to the page root; a valid remounted composer immediately reclaims it and recalculates from current geometry. Persistent loss still hides the orb after the bound.

For the other platforms, composer discovery scores platform candidates, rejects page-sized/misaligned surfaces, caps dimensions, and restores prior inline styles when reservations change. It never falls back to an unvalidated editor parent: if no surface qualifies, the bounded provider remount grace applies and persistent loss hides the orb. Resize observers cover expanding composers; composer-scoped mutation observers also track native control remounts, text/state changes, and visibility changes that do not resize the composer. Gemini, Grok, and DeepSeek place the orb before the geometry-defined right-side control row instead of recognizing English labels or assuming a fixed button index.

Each platform-content instance publishes a teardown callback before it begins monitoring. A later content-script version invokes that callback before taking ownership, removing its runtime message listener and DOM listeners, disconnecting all owned observers, cancelling timers/intervals/animation frames, restoring reservations, and removing owned UI. Same-version duplicate injection remains a no-op.

Paste uses native setters/events plus stability checks. Paste discovery ranks only writable, enabled candidates, so a disabled or read-only high-scoring editor cannot mask an available composer; a previously verified composer remains retained through a temporary disabled/`aria-hidden` state. Firefox alone converts contenteditable line breaks to escaped HTML `<br>` elements. ChatGPT gets longer insert/verify/stability windows. Verification requires at least 95% of the expected summary's normalized words to appear in order across the full editor text. Whitespace, newlines, punctuation, bullets and rendered Markdown differences (link targets, code-fence labels, ordered/task-list markers) are ignored. A linear scan handles ordinary pastes; bounded word insertion/deletion matching handles small omissions and repeated words without relying on three samples. This deliberately tolerates up to 5% missing words and does not prove byte-for-byte completeness. A detached editor cannot complete verification after a remount. Initial insertion, retries and delayed rechecks preserve nonempty drafts, including drafts restored on focus; already verified text is accepted without replacing it. Failed verification uses the existing destination recovery/manual-copy path.

Native menus and popovers may temporarily mark the background application `aria-hidden` without visually removing its composer. Placement retains only the last verified, connected, geometrically visible input through that state; removed or visually hidden composers still make Cap Context hide normally. Newly mounted textareas/contenteditables inside native dialogs are excluded from composer selection, so settings editors cannot replace the verified chat input.

## Contracts That Must Change Together

- Platform support: manifest matches/permissions, `PLATFORMS`, background `DESTINATIONS`, `DESTINATION_HOST_RULES`, telemetry platform lists, tests, smoke fixtures.
- Conversation limits: content-script cap, request-security character/byte/body limits, analysis display, tests.
- Model/profile routing: provider constants/budgets, prompts, Latest Run labels, evaluation expectations, this file, `memory.md`, `extension/README.md`.
- Telemetry fields/stages/failures: source/background sanitizers, Vercel validator, Supabase validator, SQL constraints/functions, tests. Free-form telemetry fields are forbidden.
- Latest Run receipt: producer, background expiry, bridge, analysis renderer, analysis tests.
- Content-script changes must advance `CONTENT_SCRIPT_LOAD_ID` for open-tab replacement and retain stale-node/reservation cleanup. Current value: `platform-content-2026-10-01-claude-popup-anchor-v76`.
- Extension release: bump `extension/manifest.json`, rebuild the ZIP with `manifest.json` at its root, hash-compare every file against `extension/`, then test the unpacked folder in a new Brave window.

## Known Current Risks

- Long ChatGPT DOM capture has historically under-captured; deterministic virtual-window fixtures alone do not establish native-chat completeness.
- The six-minute source lock can reset without cancelling active work.
- Summary diagnostics are structural, not grounded; the content gate is conservative and heuristic. Useful short/token-limited output is retained, but factual grounding and omission detection are not enforced.
- The telemetry outbox is unbounded, active cancellation state is worker-memory-only, and Vercel's Supabase fetch has no explicit timeout.
- A destination prepared before capture/summary failure may remain open unused.
- `npm run gate` omits installed-extension smoke. Default smoke covers ChatGPT → Claude; optional JSON modes cover all five source platforms against fixtures and a stub backend.
- Browser packaging uses one hybrid Chromium/Firefox manifest while automation is Brave-only.

## Verification Matrix

| Change | Focused check | Broader check |
| --- | --- | --- |
| Capture, pasted cards, placement, picker/handoff | `node --test --test-skip-pattern="^slow/release:" test/platform-content.test.js` | `npm run test:slow`; Brave smoke for real extension/UI work |
| Background messages, destination recovery, cache | `node --test test/background.test.js` | `npm test` |
| Summary prompt/routing/validation | `node --test test/summarize.test.js test/request-security.test.js`; model health: `node --test test/gemini-model-health.test.js` | `npm run eval` for quality/provider changes |
| Telemetry/Supabase | `node --test test/telemetry.test.js` | `npm test` plus schema/grant review |
| Latest Run analysis | `node --test test/analysis.test.js` | Open GitHub Pages analysis with extension loaded |
| Release/package | `npm test` and `npm run test:extension-smoke` | `npm run gate`, then ZIP hash comparison |

- `npm test`: deterministic suite excluding the three `slow/release:` capture tests.
- `npm run test:slow`: paced 78-turn Claude capture plus delayed virtualized-batch and physical-scroll regressions.
- `npm run test:extension-smoke`: disposable Brave profile, unpacked extension, ChatGPT-source/Claude-destination fixtures and stub backend. It verifies content/background startup, exact transfer and Claude/ChatGPT inline placement (empty/long drafts, narrow widths and remount) without depending on an ephemeral worker DevTools target. `test/extension-smoke.test.js` guards injected-script escaping and bounded command cleanup. Use a separate browser window/profile.
- `npm run eval`: live production-endpoint quality/latency evaluation with one retry for a failed quality case or transient request/provider error; two failures still block the gate. Each request has a 320-second deadline covering the complete response body; latency includes generation after streaming heartbeat headers. Malformed JSON is a retryable service failure.
- `npm run gate`: fast tests, slow capture, live evaluation; it does not include Brave smoke.

JSON capture checks:

| Source | Focused tests | `CAP_CONTEXT_JSON_SMOKE` |
| --- | --- | --- |
| Claude | `node --test test/claude-json-capture.test.js` | `1` |
| ChatGPT | `node --test test/chatgpt-json-capture.test.js test/background.test.js` | `chatgpt` |
| Gemini/Grok/DeepSeek | `node --test test/network-json-capture.test.js test/background.test.js` | `gemini`, `grok`, `deepseek` |

Run smoke modes with `npm run test:extension-smoke`. Optional scenarios: `CAP_CONTEXT_CLAUDE_RELOAD_SMOKE=1`, `CAP_CONTEXT_CLAUDE_PARTIAL_SMOKE=1`, `CAP_CONTEXT_CHATGPT_RELOAD_SMOKE=1`, `CAP_CONTEXT_CHATGPT_FAILURE_SMOKE=partial|streaming|ranged`, and `CAP_CONTEXT_NETWORK_FAILURE_SMOKE=partial` or Grok's `file-only`. Clear scenario variables before a default/success run. Fixtures cover history absent from the DOM, source identity/auth recovery, complete pasted/document text, announced DOM fallback, exact backend transcript/paste and no Send. They establish extension integration, not fresh native-account capture or provider quality.

GitHub Actions uses Node 22 and read-only repository permissions. Pushes to `master` and `codex/**`, plus pull requests into `master`, run the deterministic suite and slow capture regressions as separately named steps in `Code regression checks`, with an eight-minute job timeout and cancellation of superseded runs on the same ref. These checks validate the checked-out code without calling production providers.

At 06:17 UTC daily, `Live production summary check` probes the deployed API with the existing accuracy, structure, incorrect-fact and latency thresholds. Manual runs execute the code checks and can also enable `evaluate_production` (off by default, uses live provider quota). Production checks are serialized and have a 25-minute job allowance for the existing two cases with at most two bounded attempts each. A failed production check remains a real failure; it is separate from code validation and does not gate GitHub Pages or Vercel deployments. The local `npm run gate` still includes all three commands for release verification. Branch workflow changes become the scheduled/default workflow only after they reach `master`.
