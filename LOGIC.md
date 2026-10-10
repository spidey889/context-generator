# Cap Context Production Logic

This is the working reference for the extension and backend contracts in this checkout. `master` is the production source branch, but a local change, Git push, ready Vercel deployment and Web Store release are separate states. Verify the relevant deployed artifact before making a production claim. Historical decisions and validation results belong in [CHANGELOG.md](CHANGELOG.md).

Read the invariants and ownership map first, then the section for the component being changed. This document explains the contracts and the reasons for fragile behavior; source constants and tests resolve exact implementation details. Update it when behavior changes, without copying past test counts or deployment snapshots into the current contract.

## Navigation and runtime

- [Ownership map](#ownership-map): files and entry points for a change.
- [Transfer lifecycle](#transfer-lifecycle): sequencing, deadlines and cross-tab messages.
- [Capture](#capture): JSON adapters, DOM sweep and completeness boundaries.
- [Summaries and backend](#summaries-and-backend): routing, validation and exact local recovery.
- [Telemetry and local receipts](#telemetry-and-local-receipts): proof, persistence, counters and privacy.
- [Composer UI and paste](#composer-ui-and-paste): placement ownership, lifecycle and draft protection.
- [Changes that must stay aligned](#changes-that-must-stay-aligned): coupled contracts.
- [Verification and diagnosis](#verification-and-diagnosis): checks to run and what their results establish.

Runtime and packaging:

- Node 22 for backend/scripts/CI. The extension has no build step or runtime npm dependencies; browser checks load `extension/` directly.
- [extension/manifest.json](extension/manifest.json) is the version and shipped-host authority. It currently declares version `1.4.12`, Chromium service-worker and Firefox background-script variants. Automation uses Brave; that does not certify Firefox compatibility.
- The extension's backend alias is `https://context-generator-five.vercel.app`. Its Latest Run bridge is injected on `https://spreadz.in/analysis*` and the legacy `https://spidey889.github.io/context-generator/analysis*` URL. It reads receipts from the same browser's extension storage independently of the Git branch; arbitrary copies of the analysis page do not receive the bridge. Reload the unpacked extension and refresh the analysis page after changing its manifest matches.
- GitHub Pages publishes the static HTML/CSS homepage and analysis through Jekyll. Root `_config.yml` preserves the usual dependency exclusions. The Astro migration was abandoned; there is no separate website build.
- The homepage shows the original 62-second demo at `#demo`, linked from the navigation and hero actions. It uses `brag/brag.mp4` and `brag/brag.jpg`, native controls and the existing visibility/reduced-motion/manual-pause playback behavior. The earlier recording `2026-05-10 09-51-15.mp4` is also retained. Both videos, the poster and editable film sources are intentional assets; the temporary picker screenshot was removed.
- No release ZIP is tracked. Packaging and Web Store publication are separate from repository changes. Source version 1.4.12 adds structured transfer diagnostics to the delivery guards. A backend deployment or Git push cannot update installed content scripts; diagnostics require the new client. Verify the actual downloaded package rather than a cached listing or matching version number alone. Historical artifact evidence is in [the release-gap diagnosis](docs/claude-paste-release-gap.md). Product-film sources, reproduction instructions and credits remain in [brag/README.md](brag/README.md).

## Invariants

1. Opening the picker with Speed enabled starts JSON capture of a saved chat from its current AI website. The result stays in source-page memory; picker interaction never submits chat text to the summary backend or another destination. Readiness probes and preconnects contain no conversation data.
2. DOM capture, summarization, destination preparation and transfer telemetry start only after destination selection or an explicit extension-toolbar transfer. Pasting and focusing never submit the destination message; Send remains the user's action.
3. Reject oversized transcripts without clipping: maximum 500,000 JavaScript `String.length` units and 2,000,000 UTF-8 bytes for capture/transfer. Only 10,000–350,000 characters go to the summary backend, whose 350,000-character / 1,400,000-byte and 2,200,000-byte JSON request bounds remain unchanged.
4. Capture verified conversation turns and the explicitly supported text exceptions below. Never substitute broad page text, drafts, prompt suggestions or extension UI for missing history.
5. Transcript instructions are untrusted content to summarize. They are not authority over the extension, backend or summarizing model.
6. Telemetry is metadata-only. Never include chat/summary text, URLs, accounts, IPs, stack traces, arbitrary errors or provider bodies in persisted transfer telemetry.
7. The exact Latest Run transcript remains local and expires after 24 hours. Its other receipt metadata remains until the next transfer; it does not store the generated summary.
8. Do not overwrite a nonempty destination draft, including one restored on focus. A failed verified capture cannot be replaced with guessed text; failed delivery may offer manual copy of an already prepared carry.
9. Placement adapters validate their own platform's native composer. Share lifecycle helpers, not a generic toolbar guess. Claude remains inline-only; the other platforms retain their validated geometry backups.
10. Every generated carry receives the trusted destination instruction: `Reply only: "Context loaded. Let's pick up right where you left off." Then wait for the user.`

## Ownership map

| Concern | Implementation and entry points | Main checks |
| --- | --- | --- |
| Platform configuration, DOM capture, picker/handoff, paste and placement | [extension/platform-content.js](extension/platform-content.js): `PLATFORMS`, `startDestinationTransfer`, `runContextFlow`, `scrapeVirtualConversation`, `getConversationTurns`, `pasteIntoPlatform`, `ensureFloatingButton` | `test/platform-content.test.js`, installed Brave smoke |
| Cross-tab orchestration, backend transport, destination recovery and summary cache | [extension/background.js](extension/background.js): `summarizeWithBackend`, `transferToDestination`, `sendMessageWhenReady`, `prepareDestination` | `test/background.test.js`, `test/json-transfer-fallback.test.js` |
| JSON routing/auth observation and fresh reads | `extension/claude-fetch-main.js`, `extension/chatgpt-fetch-main.js`, `extension/network-fetch-main.js` | Corresponding JSON tests and reload/auth smoke modes |
| JSON serialization and page-to-extension bridges | `extension/claude-json-capture.js`, `extension/chatgpt-json-capture.js`, `extension/network-json-capture.js`; shared Gemini/Grok/DeepSeek formats in `extension/network-json-data.js` | `test/claude-json-capture.test.js`, `test/chatgpt-json-capture.test.js`, `test/network-json-capture.test.js` |
| Summary profiles, provider order and output policy; shared prompt/template | [api/summarize.js](api/summarize.js): `handleSummary`, `createSummaryWithFallback`, `createSummaryWithProvider`, `validateContextCarrySummary`; [api/summary-prompt.js](api/summary-prompt.js): `getSummarySystemPrompt`, `getContextCarryTemplate` | `test/summarize.test.js`, `test/summary-prompt.test.js`, routing/body-timeout tests, live evaluation for quality changes |
| Backend request boundaries | `api/request-security.js`, `api/request-validation.js` | `test/request-security.test.js` |
| Telemetry producer, queue, expiry and recovery | `extension/platform-content.js`, `extension/background.js`: `recordTransferTelemetry`, outbox and active-attempt helpers | `test/telemetry-delivery.test.js`, `test/telemetry.test.js` |
| Telemetry relay, rate limits, validation and HMAC verification | `api/telemetry.js`, `api/telemetry-validation.js`, `api/telemetry-rate-limit.js`; `supabase/functions/transfer-telemetry/`; `supabase/functions/_shared/summary-proof.mjs` | `test/telemetry-handler.test.js`, `test/verified-telemetry.test.js` and local database replay |
| Database identities, immutable outcomes, verified models and counters | [supabase/migrations/](supabase/migrations/), `record_transfer_event`; operations in [supabase/README.md](supabase/README.md) | `scripts/check-verified-telemetry-db.js`, backup/restore checks |
| Latest Run bridge and rendering | `extension/analysis-bridge.js`, `analysis/index.html`: `readLastTransferStats`, `renderStats` | `test/analysis.test.js`; open the matched analysis page with extension loaded |
| Installed-extension integration and live model quality | `scripts/run-extension-smoke.js`, `scripts/run-regression-eval.js`, `evaluation/`; CI in `.github/workflows/regression-gate.yml` | See [Verification](#verification-and-diagnosis) |

Capture, placement, paste and UI share the content script's mutable state and teardown lifecycle. Background code owns tab operations and worker persistence; MAIN-world hooks own native-session observations. Preserve those boundaries when extracting helpers.

## Transfer lifecycle

```text
orb click -> picker, preconnects and early JSON capture (saved chat + Speed)
destination selection -> attempt ID + started telemetry; pin source identity
empty-chat guard -> stop before handoff or destination work when no usable chat exists
prepare inactive destination while capture runs
reuse/await current picker JSON capture, or fresh JSON/DOM capture -> direct text carry or summarize once -> reuse/recover destination
paste and verify -> finish source cue -> activate according to platform policy
save Latest Run receipt and terminal telemetry
```

The extension-toolbar action skips the picker and always uses DOM capture. Its default destination is Claude for a ChatGPT source, otherwise ChatGPT.

After empty-chat admission, destination preparation starts during the picker-to-handoff bridge, overlapping its 190 ms of motion rather than waiting for it. It opens beside the source tab in that tab's current window, with the source as its opener. The worker resolves the browser-supplied sender tab again before creation, including fresh recovery, so focusing another window or moving the source does not redirect the destination. A closed source fails preparation instead of opening in an unrelated window. Tab creation starts navigation; its response is not proof that the page or composer has loaded.

### Capture selection and failure handling

- Speed is default-on in the picker. Opening a saved chat's picker starts JSON capture; destination selection reuses the completed result or awaits that same read, including the immediate handoff with reduced motion enabled. Route/query changes, away-and-back navigation or changes to rendered turn identity/text invalidate the snapshot before and after awaiting it, triggering a fresh read. Closing the picker, switching Speed off or teardown discards it; switching Speed on starts a new capture. Native reads are serialized so a discarded in-flight read cannot cause a busy fallback. Already-issued native reads finish within existing bridge bounds; discarded results are never submitted or persisted. Opting out or an unsaved chat uses DOM only after selection. The opt-out lasts for the current page instance and survives picker reopening, but resets on reload/reinjection.
- Discarding a picker capture immediately releases its cached result, rendered-history copy and navigation guard. A native read already issued may finish within its bridge timeout, but its late result cannot restore the discarded snapshot. Terminal attempts also discard their unconsumed picker capture, including cancellation during handoff.
- An empty unsaved chat fails before handoff, capture or destination preparation. An unsaved chat with rendered turns can use DOM. Saved JSON chats may be captured before their native history mounts.
- Picker JSON errors stay silent until destination selection. ChatGPT fast capture stays JSON-only: a missing bridge or failed/incomplete/oversized fresh read shows the capture error, releases the attempt lock and never enters DOM preparation/sweeping or scrolls the history sidebar. An already prepared destination may remain unused. Explicit Speed opt-out and unsaved-chat DOM capture remain available. Other platforms retain their announced JSON-to-DOM recovery within the same attempt and prepared destination. Navigation, identity or session cancellation aborts instead of capturing a different chat. Only completed capture is submitted for summarization.
- Picker and toolbar attempts pin the source route before their first await. A navigation latch follows preparation, DOM/attachment reads, JSON fallback and summary dispatch; away-and-back navigation cannot revive an attempt. Every capture result is checked before use, and terminal completion/teardown removes the guard's listeners and timer.
- Picker telemetry starts before empty-chat validation, so early exits are visible as safe metadata. A destination already prepared before a later failure may remain open unused.
- Source-local full-transcript recovery is available only after supported text was verified and captured. It handles summary-service failure, not missing/unverified capture.

### Paste and activation order

| Destination | Before paste | After paste |
| --- | --- | --- |
| Claude | Finish source completion cue, focus destination, settle 350 ms | Verify through 550 ms of stability, then schedule the post-activation recheck |
| ChatGPT | Finish source completion cue, focus destination, settle 350 ms | Verify with its longer paste/stability windows |
| Grok | Finish source completion cue, focus destination | Verify; run the post-activation stability recheck |
| Gemini, DeepSeek | May paste and verify while inactive | Finish source cue, revalidate/focus destination, schedule the stability recheck without delaying activation |

All five use verified retries and editor-remount recovery. Prepared-tab reuse and activation require a platform's new-chat landing route, never a saved conversation. Content delivery independently rejects existing conversation turns and pins the route when the composer mounts; navigation cancels insertion/recovery even after an away-and-back change. Initial landing redirects are allowed before that pin. Click/focus may replace a startup composer: reacquire it before writing and recheck identity/text after final focus. Preserve any draft restored in its replacement. A navigated or failed prepared tab gets at most one fresh destination; a closed transfer tab cancels instead of being recreated. Exhaustion offers one manual-copy fallback when a carry exists. Report clipboard success only after an actual successful copy.

After verified insertion, trusted Send/submission, editing, clearing or Undo relinquishes recovery across all five destinations, including editor replacements. The insertion remains delivered; it cannot trigger a fresh-tab retry or a copy modal because the user subsequently changed it. Extension-owned insertion events and cursor-only movement do not cancel hydration recovery. Delayed recovery stops when conversation turns appear, at the transfer deadline, on replacement by another paste or on teardown; hidden tabs also release their recovery listeners/timers at expiry.

Textarea/input draft checks and paste verification use their live `value`, including an empty string. Static child text/defaultValue may retain a cleared draft and cannot prove composer content; contenteditable editors continue using rendered text.

Focused delivery activates once before paste and does not activate again after verification; the user can switch away without being pulled back. Activation failure is reported, and a focus-required composer cannot receive an insertion after failed activation. A noninteractive, live-announced destination cue says `Pasting your context…`, then confirms verified insertion or directs the user back to source recovery. It never blocks composer controls or sends the message, and teardown removes it.

Source summary completion fills its line immediately; there is no one-second cosmetic hold for local or remote carries. The paste stage remains active before focused insertion and becomes complete only after verified inactive insertion. Visible source completion waits for two animation frames with a 120 ms fallback. Hidden sources skip that wait; hiding during it releases it immediately and cleans up frames/timers/listeners. Suspended painting must not block activation or receipt saving. The timeline includes handoff finish, final activation and transfer completion.

### Branch prototype: near-end destination reveal

On `codex/fast-transfer`, the remote-summary countdown requests a single early reveal when its display estimate reaches three seconds remaining. Capture has already completed; only the attempt's prepared new-chat tab can be revealed. Before switching, the worker waits for native tab loading to complete with no pending navigation, plus a complete document and a visible usable composer. Readiness checks mount no UI and never focus or reload the page. After switching, it shows one `Polishing your summary…` cue with `It will be pasted here when it’s ready.` while the real summary remains pending, then `Pasting your context…` when the existing paste message arrives, and the verified ready cue afterward. The cue mounts outside the page body so body replacement cannot erase it; duplicate status messages reuse the same node and expiry instead of redrawing it. All readiness work shares the six-second budget. These are display messages, not provider progress or a promise that completion is imminent. If the estimate runs out, the polishing cue stays until delivery, failure, cancellation, teardown or the attempt deadline.

Short/direct carries and remote results that arrive before the threshold follow the normal reveal sequence without an added wait. Early status readiness is bounded to six seconds and failure falls through to normal delivery. Summary completion or failure stops pending optional readiness immediately without cancelling actual delivery; source navigation and teardown also stop that presentation work. An already-submitted native activation finishes its window focus under the real transfer token. An in-flight reveal settles before paste to prevent a late cue/focus from replacing delivery. Destination completion/cancellation latches the attempt so a queued status message cannot recreate polishing after real paste or failure. The worker records the earlier focus so later paste/final activation does not pull the user back again; the existing native activation-settle minimum, source/destination checks, draft protection, cancellation and fresh-tab recovery remain. A recovery tab has its own normal activation. This prototype has not changed production `master` or the Web Store package. The standalone sample demo remains at `prototypes/near-end-handoff.html`.

### Deadlines and locks

The page-local `isRunning` lock has one six-minute absolute `deadlineAt`. The same deadline follows capture continuation, summary, destination preparation/activation, paste retries and delayed recovery. Expiry cancels the attempt, records `client_interrupted`, shows a timeout and releases the lock; late work cannot continue that attempt or unlock a newer one.

Closing the source or a tracked prepared/recovery destination revokes its transfer immediately in the worker, before optional telemetry I/O. Preparation, summary waits, delivery/retry and activation check the shared operation; `CANCEL_TRANSFER` stops source continuation and destination insertion/recovery. A surviving source releases its lock without offering summary fallback, manual copy or another tab. Destination checkpoints also ask `CHECK_TRANSFER_ACTIVE` to verify the source still exists, including after a lost cancellation notification or worker restart. Already-inserted text and already-received receipts remain; cancellation does not reverse an API action or provider work already submitted. A tab created by an API call already in flight is removed if that operation was cancelled before its response, without removing an existing draft/tab.

Paste messaging requires an explicit boolean `ok` acknowledgement. A timeout, missing/invalid reply or transport rejection other than a known missing receiver yields `paste_unconfirmed`: do not re-send the paste or open a fresh fallback tab when the original may already contain context. Only missing-receiver/connection-establishment failures retain injection retries; explicit destination `{ ok: false }` replies retain fresh-tab recovery. The source keeps the full carry available for manual copy and asks the user to check the existing destination first. Unconfirmed outcomes retain normal `paste_failed` telemetry rather than inventing success.

Operation tokens and destination associations remain in worker memory. A worker restart cannot restore complete delivery ownership/outcomes; a lost preparation response can leave an orphan prepared tab, and a lost transfer response can require manual recovery. Source-existence checks cover closure without claiming a persisted delivery protocol. Persisted restart/reconciliation work is deferred pending reproducible real-user impact; this does not restore or automatically resume an interrupted transfer.

Picker and toolbar admission share `beginTransferAttempt`. A click while an attempt is running creates no second attempt, telemetry failure or Latest Run receipt. An admitted empty-chat attempt remains visible as `no_conversation` and immediately releases its lock.

| Boundary | Limit | Source |
| --- | --- | --- |
| Whole transfer | 6 minutes | `platform-content.js` transfer trace/lock |
| Generated remote chain | 270 seconds, shared across providers and retries | `api/summarize.js` |
| Vercel summary function | 300 seconds | `vercel.json` |
| Extension summary transport | 320 seconds, reduced to remaining transfer time | `background.js` |
| Optional summary telemetry storage | 1 second per attribution/receipt wait, interrupted by the summary deadline | `background.js` |
| Source startup messaging | 12 seconds | `background.js` |
| Destination messaging | 30 seconds normally; 45 seconds for ChatGPT | `background.js` destination configuration |
| Destination warmup | 9 seconds normally; 12 seconds for ChatGPT | `background.js` |
| Missing receiver retry | Every 120 ms within the applicable deadline | `sendMessageWhenReady` |

The background may inject `platform-content.js` to repair a missing receiver. Each warmup/delivery loop stops repeating successful injection while the receiver mounts; failed injections can retry, and native navigation installs the manifest script in the next document. Pre/post-injection attempts share deadline and error policy; non-retryable errors stop immediately. MV3 summary work keeps the worker alive every 25 seconds. Backend whitespace heartbeats start after 15 seconds and repeat every 15 seconds; latency measurement must include the complete body, not just those headers/chunks.

The summary worker requests `Accept: application/x-ndjson` on its existing single POST. The backend streams `reset` events before each provider attempt, answer-only `delta` text as it arrives, and exactly one `result` containing the accepted carry, timing and signed receipts. OpenRouter/Mistral use SSE chat completions; Gemini uses `streamGenerateContent?alt=sse`. Provider parsing retains fatal UTF-8 decoding, complete-stream checks, usage attribution and the existing deadlines/retry/fallback budgets. Errors and reasoning fields are never forwarded as answer deltas. A failed attempt's previews are superseded by the next reset; only the final accepted result can be pasted or counted. The worker consumes previews without changing tab-reveal timing or adding incremental editor writes. EOF without a final result fails through ordinary source recovery, and transfer cancellation aborts the active body read. Clients without that Accept header retain JSON-safe heartbeats and the original JSON payload; new workers also accept older JSON-only backends.

### Cross-tab messages

| Message | Direction | Contract |
| --- | --- | --- |
| `START_CONTEXT_TRANSFER` | Background -> source | Toolbar start; optional destination |
| `CONTEXT_GENERATOR_PING` | Background -> content script | Readiness before retry/injection |
| `ENSURE_CLAUDE_JSON_HOOK`, `ENSURE_CHATGPT_JSON_HOOK`, `ENSURE_NETWORK_JSON_HOOK` | Matching top-frame bridge -> background | Bounded installation of the corresponding MAIN hook |
| `PREPARE_DESTINATION` | Source -> background | Open/warm an inactive destination |
| `SUMMARIZE_WITH_BACKEND` | Source -> background | Captured conversation -> carry and timing |
| `TRANSFER_TO_DESTINATION` | Source -> background | Reuse/recover tab, paste and apply activation policy |
| `PASTE_CONTEXT` | Background -> destination | Insert/verify prepared carry |
| `ACTIVATE_DESTINATION_TAB` | Source -> background | Revalidate/focus a destination that pasted inactive |
| `CANCEL_TRANSFER` | Background -> source/destination | Revoke the matching transfer after a participating tab closes |
| `CHECK_TRANSFER_ACTIVE` | Destination -> background | Check cancellation and live source ownership before insertion/recovery |
| `RECORD_TRANSFER_TELEMETRY` | Source -> background | Queue a closed-schema metadata snapshot |
| `CONTEXT_TRANSFER_ERROR` | Source -> background | Safe badge/log signal |
| `REQUEST_LAST_TRANSFER_STATS` | Analysis page -> bridge | Same-window `postMessage` request for local receipt |
| `BRIDGE_READY`, `LAST_TRANSFER_STATS` | Bridge -> analysis page | Readiness and receipt response |

Preparation, summary, transfer, paste and activation messages carry the same `deadlineAt`. JSON-hook installation is top-frame/platform scoped; an installation callback alone is not proof that the current hook is ready.

## Capture

### Supported hosts and DOM behavior

| Platform | Shipped host | DOM pasted cards | DOM identity/deduplication |
| --- | --- | --- | --- |
| Claude | `claude.ai` | Supported | Exact role+text |
| ChatGPT | `chatgpt.com` | Supported | Structural turn/message IDs; preserves repeated text in distinct turns |
| Gemini | `gemini.google.com` | Not supported | Exact role+text |
| Grok | `grok.com` | Not supported | Exact role+text |
| DeepSeek | `chat.deepseek.com` | Not supported | Exact role+text |

JavaScript recognizes exact legacy `chat.openai.com`, but the manifest does not grant/inject there. Supporting a host requires the manifest and all platform contracts, not just a URL resolver edit. JSON pasted-text support is separate from the DOM-card column above.

### Shared JSON contract

MAIN hooks installed at `document_start` observe allowlisted routing/auth requests without reading native response bodies. Explicit capture performs fresh native reads. Credentials and signed file URLs stay in MAIN memory; the backend receives a serialized transcript, not raw JSON, cookies, bearer headers or session data.

Each bridge pins the source identity when JSON capture starts and keeps navigation/session cancellation active from readiness through response delivery. Picker prefetch starts on opening; the selected transfer also pins its source before its first await. Away-and-back navigation still cancels. Concurrent native reads fail promptly; the content script serializes its own reads. Timers/listeners are removed on every exit. Extension startup/reload reinstalls hooks on matching already-open tabs. A working, correlated hook probe avoids a worker round-trip; missing/old/replaced hooks get bounded eight-second recovery and must prove actual readiness.

JSON serializers preserve original text, indentation, CRLF and NBSP through capture metrics. The summary boundary still trims outer transcript whitespace. Do not run the DOM cleanup pipeline over JSON strings.

Require complete supported transport and structure: HTTP 200, no `Content-Range`, valid payload, selected-chat identity and a valid active parent chain. Reject detectable partial/truncated/missing history, unfinished captured content and invalid completeness metadata before summary submission. Only typed structural reasons may be exposed; arbitrary fetch/parser/provider errors are masked. These checks cannot independently prove that a server omitted no unmarked, internally consistent content.

### Claude JSON

Files: `claude-fetch-main.js` observes routing and performs fresh reads; `claude-json-capture.js` serializes the active branch.

Routing and lifecycle:

- The hook retains a bounded exact-chat endpoint map across replacement, even after resource timing evicts the route. Late installation can recover routes from resource timing; a 1.5-second wait permits an initial/SPA request to expose a missing endpoint. Other-chat prefetches cannot replace the selected route. Never guess an organization when no matching route exists.
- Rebuild the observed URL with full-tree/message/all-tool/inline-comparison/strong-consistency parameters, removing pagination/window parameters. This asks for full history; it does not make unsupported tool content eligible.
- Current readiness uses hook v7 on channel `cap-context-claude-json-v2`; legacy v1 hooks are isolated. Installation is idempotent and replaces handlers rather than accumulating them. Fresh capture consumes its dedicated response once, without cloning an unread body; rejected transport cancels the unread body before fallback, retaining its safe reason even if cancellation rejects. Observed page responses remain untouched. MAIN reports bounded native failure categories, including its own 15-second timeout, without returning upstream/parser/cancellation error text.
- Fresh history allows at most 6,000,000 response-body bytes, including inactive branches and tool metadata, separately from transcript limits. Reject oversized advertised lengths before reading and check actual chunks even without a trustworthy `Content-Length`. Decode accepted chunks with one fatal UTF-8 [streaming decoder](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/decode), stripping the response's initial BOM while preserving original string whitespace/Unicode; flush at EOF to reject unfinished bytes. Excess or malformed encoding cancels the owned reader, releases its lock and reports `incomplete` for the existing DOM fallback, without clipping or returning partial history. Native buffering may prefetch beyond the last accepted chunk; this is a consumption bound, not an exact browser-memory cap.
- Navigation API changes and `popstate` cancel setup, fetching and response delivery. Recheck chat path/identity after parsing. Refresh is a recovery option when neither a route history nor a matching request exists.

Included content:

- Follow `current_leaf_message_uuid` through human/assistant parents to null or a recognized root marker. Accept both the all-zero UUID and `00000000-0000-4000-8000-000000000000`; malformed or false-like roots fail.
- Extract direct `text` and `thinking` block strings. Use legacy `message.text` only when structured content is absent/empty, never in addition to structured blocks. Skip empty turns; fail if the whole active branch has no supported text.
- Preserve each original block/legacy string, including its leading indentation and trailing whitespace. Trim only for emptiness and pasted-card matching; translate inline-card matches back to original block offsets before restoration.
- Human `message.attachments` qualify as pasted cards only for `file_type: "txt"`, empty `file_name`, and nonempty string `extracted_content`. Named uploads and other types remain excluded. Missing recognized pasted text fails; supplied `file_size` must match the untrimmed extracted UTF-8 byte count.
- Preserve cards in their owning turn, including pasted-only turns. Deduplicate repeated attachment IDs within that turn only. Distinct identical/overlapping cards remain distinct. One complete matching inline paragraph may represent one card with restored original whitespace. Paragraph boundaries accept LF, CRLF and mixed blank lines without normalizing source text or shifting offsets; substrings and single newlines do not represent a duplicate card.

Excluded content and completeness:

- Skip tools/results, search snippets, files, artifacts, images, sync sources and unsupported blocks without recursively searching their payloads. Filtering unsupported material is intentional, not a capture failure by itself.
- Check conversation/page/pagination metadata, active own-turn messages, captured direct blocks and recognized pasted attachments. Further-page cursors, advertised counts exceeding returned messages, unfinished own turns/blocks and malformed captured content fail. Do not apply these checks recursively to skipped tools/files.
- Empty hidden thinking with `truncated: true` is normal observed Claude metadata and stays skipped.
- Successful capture is labelled `claude-json` in Latest Run. Browser MAIN/Navigation API support and current native schema remain live compatibility boundaries; the DOM route remains available.

### ChatGPT JSON

Files: `chatgpt-fetch-main.js` owns fresh native/session/paste reads; `chatgpt-json-capture.js` serializes the selected tree and supported document text.

Auth and lifecycle:

- Current readiness probes the v10 MAIN hook on `cap-context-chatgpt-json-v2`. The hook responds only while it owns the current fetch wrapper. Replacement retains page-memory auth, and same-chat project path aliases remain valid.
- Observe only allowlisted auth/account headers on same-origin `/backend-api/` requests. Auth is session/account scoped: cached sidebar/project navigation need not emit a new conversation-specific request.
- Explicit capture fetches fresh `GET /backend-api/conversation/{id}` with browser cookies and the latest observed headers, without pagination parameters. Late installation obtains `accessToken` and account ID from `/api/auth/session` only during explicit capture.
- One HTTP 401 retry is shared across tree and paste-descriptor reads. Prefer newer same-workspace observed auth, otherwise refresh the session once; recheck navigation/account cancellation before retrying. Do not retry HTTP 403 or partial history, or redirect to a guessed workspace.
- Cancel discarded session/history/descriptor bodies on rejected transport and cancel an expired-token body before auth refresh/retry. These fresh responses belong to capture; observed page responses remain unread. Cancellation failures cannot replace the bounded capture error or leak upstream details.
- The native endpoint returns all branches. The 15-second capture therefore allows a separate 32,000,000-byte transport ceiling shared across accepted history, session refreshes, paste descriptors and original paste content; each session/descriptor JSON response retains its 6,000,000-byte ceiling. This download allowance does not increase the selected transcript's 500,000-character / 2,000,000-byte content limits. Check advertised JSON lengths before reading and actual byte chunks before decoding, including absent/understated `Content-Length`. One fatal UTF-8 streaming decoder per response preserves split codepoints/BOM state and flushes at EOF; malformed encoding/JSON or excess transport data fails without partial payloads. Cancel rejected readers/unread bodies and release locks on every exit. Exact-budget complete capture is allowed. Exceptionally large native trees can still hit the transport ceiling; native buffering can prefetch, so this is not an exact browser-memory cap.
- Tokens, session data and headers stay in MAIN memory and never enter bridge payloads, logs, storage or the summary backend. Account changes cancel capture. Signed paste-content reads carry no bearer headers.

Tree and text rules:

- Follow `mapping` from `current_node` to a null-parent root. Reject missing/malformed nodes/messages, mismatched IDs, invalid roots, cycles, previous/next/missing/partial/truncated indicators, malformed completeness metadata and advertised totals exceeding the returned tree.
- MAIN removes every mapping node outside that selected parent chain and filters its child references before sending the bridge payload or downloading selected paste files. Send the original node/message counts separately so the bridge still checks advertised totals against the complete native response. Alternate text never reaches the bridge transcript or its content-size guard. A genuinely oversized selected path still fails with the 500,000-character error; pruning never clips selected history.
- Reject in-progress/failed turns and active nonterminal assistant nodes with `end_turn: false`. A terminal `finished_partial` generation may retain its useful text when its own completeness metadata passes; stopped generation is distinct from partially loaded history.
- Include own user/assistant string parts, immediate multimodal `audio_transcription.text`, direct `code.text` and `thinking`, `reasoning_recap.content`, and `thoughts[].content` (or the visible own summary when bodies are empty). Full thought bodies take precedence over duplicate summaries/chunks. Voice transcription must be a complete string with passing metadata checks.
- Keep modern editable `:::writing` documents, which are already direct assistant text. Repeated content in separate turns remains repeated. This path does not depend on DOM message count or run DOM scrolling/pasted-card preparation.

Large pasted cards:

- Only active, visible user-turn `metadata.attachments` with `is_big_paste: true` and `mime_type: "text/plain"` qualify, including turns with empty `content.parts`.
- Before any descriptor/content request, validate every qualifying file ID and nonnegative safe-integer size and the 1,400,000-byte total across unique IDs. Duplicate IDs must declare the same size; one network read may supply repeated owning turns. A bad later entry rejects the complete manifest without downloading earlier valid files. Download order follows the existing active-branch scan; transcript order and per-turn deduplication remain the serializer's responsibility.
- Reject the complete paste manifest before file requests if its declared original bodies cannot fit the remaining raw allowance. Descriptor/session reads consume that allowance too; recheck each body's declared size before its signed download and enforce actual chunks in the paste reader.
- MAIN obtains the native authenticated `/backend-api/files/download/{id}` descriptor, then reads its signed same-origin `/backend-api/estuary/content?id={id}` URL without bearer headers or redirects. Require HTTP 200 plain text, valid UTF-8, no `Content-Range`, and matching descriptor/attachment/download byte counts. Qualifying pastes share a 1,400,000-byte declared total and the existing 15-second capture deadline. Each body copies chunks into one buffer capped at its declared size; reject and cancel the first excess chunk, including without `Content-Length`, and cancel unread bodies rejected by status/type/length headers. Short/invalid UTF-8 fails, BOM and whitespace remain exact, and reader locks are released before fallback/retry. Native prefetch can receive excess bytes before cancellation; the file buffer cap is not a whole-browser memory cap.
- Preserve distinct cards in their owning turn; deduplicate repeated file IDs only within that turn. Recognize full inline paragraph copies with LF or CRLF boundaries, restoring original whitespace without shifting other ranges. Arbitrary substrings do not count as copies. A recognized paste that cannot be read completely fails rather than dropping the user turn.
- Do not fetch inactive-branch, assistant/tool, ordinary upload or non-text paste attachments.

Python Analysis results:

- Preserve native `python` tool `execution_output.text` as a labelled `Assistant: Python result` on the active branch, only immediately after an assistant `python` code call. Both messages must be successfully finished and not marked visually hidden. This includes textual table values shown in the Analysis panel, even when the final assistant reply contains none of them.
- Require complete call/result metadata and a string result; preserve its original whitespace and enforce the existing transcript limits. Do not include the Python call's code, `aggregate_result`, `ada_visualizations`, file pointers or nested metadata. No additional tool/file requests run. Other tools and unpaired/failed output retain their existing exclusions; this does not establish generic interactive-chart capture.

Legacy canvas exception:

- Assistant `canmore.create_textdoc` / `canmore.update_textdoc` qualifies only when followed on the active branch by a successful tool acknowledgement with matching command and `metadata.canvas` identity/type. Both `code.text` and `text.parts` JSON envelopes are supported.
- Retain the created document's title/content or an edit's `updates[].replacement` text as assistant content, preserving whitespace and chronological placement. Document and `code/*` types qualify. Partial edits are labelled edits, not reconstructed into a guessed latest document.
- Do not fetch editor-only changes. Tool replies, patterns, operation parameters and unrelated tools remain excluded. Malformed/detectably incomplete acknowledged document content fails; document text counts toward transcript limits.

Outside the Python-result and Canvas exceptions, skip system/tool roles, tool-directed assistant messages, hidden messages, uploaded files, arbitrary artifacts, citation metadata, binary media/pointers and nested tool transcriptions. Do not recursively hunt for text in unsupported objects. Empty turns are skipped; wholly empty capture fails. Successful capture is labelled `chatgpt-json`.

Attachment-label contract: active user-turn uploads retain explicit Claude `file_name`, ChatGPT `metadata.attachments.name` (ordinary uploads), Grok `fileAttachmentsMetadata.fileName` and DeepSeek `FILE.files.file_name`. Names are JSON-quoted to keep embedded newlines/control characters inside the label. Preserve original names without clipping; final transcript size bounds still apply. Labels do not authorize reading unsupported bodies and remain absent from local diagnostics/telemetry. Unnamed pasted cards keep their existing complete-text handling. Gemini reads names only from `hNvQHb` user slot `[2][0][4]`, attachment-group descriptors at `[4]`, filename at `[2]`; no recursive metadata search. This shape is corroborated by the [HAR-derived exporter fixture](https://github.com/mauriziofonte/chat-dump-bookmarklet/blob/main/test/remote-gemini.js), not browser validation in this change.

### Gemini, Grok and DeepSeek JSON

`network-json-data.js` owns verified format adapters; `network-fetch-main.js` observes native routes/session envelopes and performs fresh reads; `network-json-capture.js` enforces readiness/current-chat ownership. Gemini and DeepSeek use native XHR as well as fetch, so installation/readiness must retain outgoing URL/body/header observation. Native response bodies remain unread until explicit capture.

Shared bounds: 25 seconds and 6 MB of raw-read data across history pages and original files. Check response-body byte chunks as they arrive, including responses without `Content-Length`; stop at the first chunk exceeding the remaining budget, cancel the reader and release its lock. An exact 6 MB total is allowed. Rejected status/type/length headers cancel the unread body too. Native stream/network buffering can prefetch beyond the last accepted chunk; this is a consumption bound, not an exact browser-memory cap. Reject non-200/ranged transport, malformed/incomplete history, zero supported text and oversized transcripts. The raw-size guard uses the character-limit error. Preserve original JSON strings through metrics. The bridge receives validated transcript and turn count, not raw JSON, auth, CSRF tokens or signed addresses.

Decode accepted chunks with one fatal UTF-8 [streaming decoder](https://developer.mozilla.org/en-US/docs/Web/API/TextDecoder/decode), preserving partial codepoints across reads and flushing at EOF so incomplete final bytes fail. History/RPC bodies strip their initial BOM; original file bodies preserve it. Retain decoded pieces for the final text/JSON parse rather than retaining all byte chunks and copying them into a second complete byte buffer. Invalid UTF-8 cancels immediately, with the existing safe error and fresh-capture cleanup. Byte budgets and file-size checks run before decoding each chunk.

| Adapter | Native read and selected branch | Required content/completeness rules |
| --- | --- | --- |
| Gemini | `hNvQHb` batchexecute RPC; ten turns per page, opaque cursor until null | Complete framed envelopes and final RPC marker; unique chat/turn IDs; uninterrupted linkage to a null root; selected response candidate. Native pages arrive newest-first; serialize oldest user/assistant pairs first. Preserve direct user and selected response strings, including code/documents; exclude presentation blocks, other candidates and nested tools. Assistant index 9 is optional, not an authoritative completeness guarantee. Nonadvancing pagination or missing roots/parents/candidates fails. |
| Grok | Fresh `response-node`, then bounded `load-responses` batches | Use native URL `rid`, otherwise require one unambiguous leaf. Only the first human node may link to an external synthetic root absent from the tree. Every other parent/body must match ID/role/parent. Preserve own human/assistant `message` strings; skip control turns and tools/search. Preserve explicit human `fileAttachmentsMetadata.fileName` labels. Blank human text with nonempty `fileAttachments` / `fileAttachmentsMetadata` still fails visibly; this adapter does not fetch attachment bodies. Pending/partial/error flags, missing bodies and ambiguous branches fail. Pin both chat and `rid`. |
| DeepSeek | Fresh authenticated `history_messages`, omitting native device/cache headers | Require `code: 0`, `biz_code: 0`, matching chat and `cache_control: "REPLACE"`; `MERGE` is not full history. Follow numeric `current_message_id` parents to null. Keep user `REQUEST` and assistant `THINK` / `RESPONSE` in order with terminal `FINISHED` and no pending/incomplete/continuing flags. Active `FILE` entries qualify only for the bounded plain-text/Markdown/code/web/structured-text extension list in `textFile`. |

Additional lifecycle and file rules:

- Gemini can recover its observed endpoint/template from resource timing. Without earlier RPC traffic, signed-in `WIZ_global_data.SNlM0e` permits an explicit fresh read at the native batchexecute endpoint; bootstrap `cfb2h` and `FdrFJe` supply build/session query values when present. The hook must own both fetch and XHR observation; repair replacement without losing the template or the page's newer network layer.
- Gemini's optional assistant selection slot `[3][3]` is not required. A newer turn's parent triple `[1][2]` selects the older response candidate across page boundaries; that linkage takes precedence over the older turn's local selection. For the newest response, use its explicit selection when present, otherwise the first native candidate. Require one matching candidate, a valid user string and complete parent linkage; never replace a missing named candidate with an abandoned one. The field layout and candidate order are corroborated by the [native-history exporter](https://github.com/mauriziofonte/chat-dump-bookmarklet/blob/main/src/Parsers/GeminiParser.js) and [Gemini client's history reader](https://github.com/HanaokaYuzu/Gemini-API/blob/master/src/gemini_webapi/components/chat_mixin.py); isolated fixtures do not certify every live account/build.
- Gemini's optional user metadata slot is not exclusively an upload manifest. Retain confirmed attachment names from the narrow descriptor shape and ignore null placeholders. Unrecognized metadata stays excluded as `other` when the turn has verified own user text; it must not reject that complete text history. Without own user text, unrecognized metadata still triggers `unsupported` DOM fallback because it may be the entire prompt. Never infer filenames or extract nested metadata text.
- Gemini readiness is v8, Grok v6 and DeepSeek v8. Advance hook readiness versions when adapter/ownership contracts change: old MAIN closures can survive extension reloads. DeepSeek verifies fetch and XHR prototype/open/send/header ownership, retaining observed session auth through replacement. A first late install without any authenticated DeepSeek observation needs a signed-in refresh; do not read arbitrary browser storage for tokens.
- DeepSeek qualifying text files use the original native signed `files.deepseeksvc.com/api/file` address with `ty=r`, without bearer/cookies. Require exact file ID, successful parse status, allowed text/octet-stream response, complete UTF-8 (including any BOM) and matching original bytes. Binary/Office/PDF/images/tool fragments remain excluded. Do not infer new fragment or `incomplete_message` semantics from hypothetical fields.
- DeepSeek validates all qualifying active-branch file descriptors before downloads, deduplicates network reads by ID and rejects more than 1,400,000 declared original bytes. At most four independent file downloads overlap; streamed bodies stop at their declared byte bound and retain the shared 6 MB raw-read budget. A failed file cancels all siblings and waits for them to settle before releasing the capture lock. The serializer follows source turn/fragment order regardless of download completion order. No response bodies or signed URLs are cached across captures.
- DeepSeek wraps every supported file body, including empty files, with its quoted attachment name, verified UTF-8 byte count and named end marker. Original body whitespace is preserved, and later request fragments stay outside that boundary. DeepSeek deduplicates repeated file IDs within their owning turn. Distinct files with identical content, matching authored request text and the same file in later turns remain distinct; downloaded bytes can still be reused by ID during that capture.
- Dedicated Gemini Canvas/Grok Build editor state outside verified conversation strings is not fetched. Successful captures are labelled `gemini-json`, `grok-json` or `deepseek-json`.

Historical schema corroboration is supporting evidence, not a current native-API guarantee: ChatGPT [export types](https://github.com/sanand0/openai-conversations/blob/main/conversation.ts) and [multimodal analysis](https://github.com/jd-d/chatgpt-export-viewer/blob/main/plans/MULTIMODAL.md), the [Grok exporter](https://greasyfork.org/en/scripts/559376-chatgpt-claude-grok-arena-conversation-chat-markdown-export-download/code), and DeepSeek [web-client documentation](https://github.com/pooraddyy/deepseek-free#supported-file-types), [package documentation](https://pypi.org/project/p2d-deepseek/0.2.2/) and [share-schema analysis](https://github.com/HeDaas-Code/fille_repository/blob/main/DeepSeek_Share_API.md#消息对象). Reinspect native state before extending these allowlists.

### DOM preparation and sweep

The supported DOM path runs on all five platforms, including toolbar transfers and the single announced JSON fallback:

1. Reset per-transfer pasted-card state and cached scroll roots.
2. Scroll the actual conversation root to the top instantly; wait for stable turn count, characters, height and scroll position.
3. Expand verified collapsed content and supported pasted cards. Never click popup/menu triggers, response actions or controls inside menus/dialogs. Gemini text expanders must belong to user-query or response-text content, rather than the whole response action area.
4. Capture a rendered window and advance through the conversation with ordered overlap.
5. Stop at bounded quiet/no-movement/stale conditions or the 480-advance ceiling. `scrollIntoView` is only a boundary fallback.
6. Sequence-align windows with the initial baseline. Fuller matching text may replace shorter text; partial text must not downgrade a turn.
7. Serialize `<Platform> conversation:` with `User:` / platform-role turns separated by blank lines.

Claude/ChatGPT preparation allows 4.5 seconds, other sites 1.8 seconds, normally requiring three stable samples. Standard sweep advances 60% of a viewport; proven ordered overlap can permit 90% steps.

Grok's adaptive profile uses two 40 ms preparation samples, two samples within a 100 ms fast settle, 70% steps until overlap is established then 90%, 10 ms change polling and a 160 ms terminal quiet check. A physical scroll with no immediate window change gets up to 220 ms for delayed virtualization. Preserve role validation, sequence alignment, deduplication and bounds when adjusting speed.

Turn selection and deduplication:

- Exclude nav/header/footer/aside/menu, active composer descendants/ancestors, prompt suggestions and Cap Context UI. Require role evidence from platform selectors, role attributes or semantic ancestors within eight levels; loose `you` / `me` labels do not qualify.
- Containment scoring keeps true message boundaries and rejects page/conversation wrappers. Claude message wrappers own their paragraph/code descendants as one turn.
- ChatGPT's scroll root is the nearest structural-turn ancestor with computed `overflow-y: auto|scroll`, not a generic large/scrollable element. Structural `conversation-turn-*` / `data-message-id` identities collapse duplicate copies while preserving repeated text in separate turns.
- Other DOM adapters deduplicate exact role+text. This avoids virtual-window inflation but can remove genuine repeated turns; a change needs paired repetition and overlap regressions.
- Tiny local captures retain explicit one-/two-character replies. Generated captures normally ignore turns shorter than three characters. Empty-state copy and unverified page text fail closed.
- Claude/ChatGPT pasted-card readers open recognized cards, collect normal or virtualized `[data-index]` rows in order, close the panel and reattach full payload to its owning user turn after remounts. State resets each transfer.

Long native ChatGPT DOM chats have historically under-captured. Simulated virtual windows verify the merge algorithm, not completeness of a currently rendered live chat.

## Summaries and backend

### Profiles and exact local carries

Input length selects output allowances, not the first generated model. Word targets are advisory; sections have no quotas and sparse long chats should remain short and factual.

| Profile | Input character range | Advisory target | OpenRouter/Mistral token cap | Gemini output + reasoning allowance | Advisory validator floor |
| --- | ---: | ---: | ---: | ---: | ---: |
| Tiny | 0–1,200 | Exact local carry | 0 | No provider | n/a |
| Small | 1,201–8,000 | ~350 words | 1,000 | 1,500 + 5,000 = 6,500 | 80 substantive words |
| Medium | 8,001–60,000 | ~700 words | 1,900 | 3,000 + 6,000 = 9,000 | 140 substantive words |
| Large | 60,001–210,000 | ~1,200 words | 4,200 | 6,000 + 8,000 = 14,000 | 200 substantive words |
| Extra-large | 210,001–350,000 | ~1,800 words | 7,000 | 10,000 + 10,000 = 20,000 | 200 substantive words |

Transfer routing uses the captured transcript's untrimmed JavaScript `String.length`, including platform/role labels: fewer than 10,000 characters or 350,001–500,000 characters produce a synchronous source-local text carry; 10,000–350,000 inclusive use the existing summary backend; above 500,000 retains the limit-exceeded error. Direct carries begin with a short instruction explaining that the conversation was transferred from another AI chat and should be used as previous history for continuing here. They place the exact captured transcript between plain `Conversation history:` and `Next step:` labels, separated by blank lines. Existing source/speaker labels, paragraphs, CRLF, whitespace, code and Unicode stay verbatim, without JSON escaping or guessed turn parsing. The trusted destination instruction follows the history. They make no summary-worker message, cache lookup or backend request and use no summary countdown or cosmetic wait. The bounded paint cue and existing destination preparation, paste, draft protection and recovery remain. Latest Run records source `local`, profile `direct`, model `local-direct` (displayed as Local carry), zero fetch/provider/token usage, an empty attempted-model chain and no fallback. The table above describes backend profiles, including its unchanged tiny path for older clients. Exhausted/no configured providers also return the full verified transcript as `local-direct`; this preserves context during outages but does not compress it. Attachment/download budgets remain separate from the transfer character limit.

Source-page recovery covers backend HTTP/network/parse failures, empty replies or unavailable worker messaging after verified capture. It retains the existing quoted full-transcript format, model `local-direct` and fixed fallback reason `summary_service_unavailable`. It carries no fresh server receipt. Do not conflate it with backend `local-direct`, which can be signed. Capture and size limits still apply.

### Configured provider order

```text
OpenRouter: inclusionai/ling-3.1-flash (display label: Space Bunny 2)
-> enabled paused candidates, in Qwen / Dots / Gemma order
-> Gemini: gemini-3.6-flash
-> Gemini: gemini-3.5-flash-lite
-> Mistral: ministral-14b-2512
-> exact local-direct carry
```

| Route | Key / switch | Default |
| --- | --- | --- |
| All OpenRouter routes | `OPENROUTER_API_KEY`; `OPENROUTER_ENABLED=false` bypasses all | Enabled when key exists |
| Ling `inclusionai/ling-3.1-flash` | `OPENROUTER_LING_ENABLED=false` pauses | Enabled; no `:free` suffix |
| Qwen `qwen/qwen3.8-27b:free` | `OPENROUTER_QWEN_ENABLED=true` | Paused |
| Dots `dots-studio/dots-3-note-preview:free` | `OPENROUTER_DOTS_ENABLED=true` | Paused |
| Gemma `google/gemma-4-26b-a4b-it:free` | `OPENROUTER_GEMMA_ENABLED=true` | Paused |
| Both Google routes | `GEMINI_API_KEY` | Configured when key exists |
| Ministral | `MISTRAL_API_KEY`; `MISTRAL_ENABLED=false` pauses | Enabled when key exists |

Paused OpenRouter candidates require exact `true`; inspect current availability/data policy before enabling one. These are pinned model IDs, not the random free router or an automatic provider `models` fallback list. Missing keys and explicit pauses are not attempted routes. Every request tries its configured order afresh; there are no health counters or daily skips.

Budgets and retries:

- First configured remote route: at most 90 seconds. Remaining routes divide the other 180 seconds evenly, capped at 90 seconds each, under the shared 270-second deadline. Default Ling + two Google routes + Ministral is 90/60/60/60; without OpenRouter the three slots are 90/90/90. A single route still gets only 90 seconds. Enabling routes redistributes time, not the total deadline.
- Temporary network/server failures and provider overload get one retry of the same model, with the existing 450 ms delay and a 90-second per-attempt ceiling reduced by remaining model time. HTTP 500/502/503/504/529 and matching temporary error envelopes inside HTTP 200 qualify; rate limits, credentials/auth, billing, permissions and other API errors advance immediately. Numeric error statuses take precedence over symbolic overload labels. Timeouts remain active through successful response-body parsing; elapsed time and the attempt signal are rechecked before fetch, at headers, after parsing and on errors, so delayed timer tasks cannot accept an expired result or renew a retry's model budget. Expired headers abort without starting a body read. Non-OK HTTP responses route by status without parsing their unused bodies; owned-body cancellation starts without awaiting cleanup. Cancellation exceptions/rejections/stalls retain status handling. Attempt timeouts and caller cancellation retain their existing immediate-abort behavior.
- Before each funded Gemini/Mistral HTTP attempt, including retries, atomically reserve both IP and global UTC-day allowances in shared Redis. Work units are the serialized UTF-8 provider request bytes plus its maximum output-token allowance (including Gemini reasoning); they bound work, not a dollar invoice. `FUNDED_SUMMARY_IP_DAILY_UNITS` defaults to 2,000,000 and `FUNDED_SUMMARY_GLOBAL_DAILY_UNITS` to 10,000,000; zero disables funded work. Invalid limits, missing Redis settings, exhausted allowances, store errors or a 450 ms store deadline stop funded fallback and return the existing exact `local-direct` carry. Store elapsed time and the combined abort signal are checked before fetch, at headers and after parsing; an overdue timer cannot admit a late result, and expired headers abort without reading their body. Non-OK store responses also abort their owned fetch before returning rejection, leaving their unused private body unread and the caller's signal intact. Reservations are not refunded after failures/disconnects. Use `KV_REST_API_URL`/`KV_REST_API_TOKEN` or the existing `UPSTASH_REDIS_REST_*` aliases; keys hash IPs and expire after the day. Zero-price OpenRouter calls are exempt. This applies to every caller without adding an extension credential or changing its request/response format.
- Closing an unfinished HTTP response aborts the provider fetch/body read, shared reservation and retry wait, and prevents further retries/fallbacks or a final response. Normal request-body completion does not cancel work. Cancellation cannot reverse charges for work already accepted upstream.
- OpenRouter 401/402 skips the remaining OpenRouter routes because they share credentials/account. Model-specific failures and 429 keep the ordinary order; free-limit availability may be shared across models.
- The first provider returning actual context wins. There is no expansion or semantic retry loop merely because its text is short, imperfectly structured or token-limited.

Provider-specific constraints:

- Successful provider JSON is decoded as strict UTF-8 before parsing. Malformed byte sequences fail through the existing invalid-response fallback instead of silently replacing characters in names or facts. A leading UTF-8 BOM and valid Unicode, including literal replacement characters, remain supported. The owned body read and decoding/parsing retain the same attempt deadline and caller cancellation.
- OpenRouter uses the shared untrusted-transcript envelope, system prompt and OpenRouter/Mistral profile caps. Disable context compression and hidden reasoning; require endpoint support for supplied parameters; enforce zero prompt/completion/request prices and `data_collection: deny`. If no endpoint qualifies, fall through without relaxing policy or using a paid route.
- OpenRouter HTTP-200 error envelopes, errored/filtered choices, invalid JSON, empty/refusal-only text and unfinished thinking blocks fail safely. Never copy separate reasoning fields into the carry. Logs use fixed messages/numeric status, not arbitrary upstream error strings.
- Gemini Flash uses `thinkingLevel: MEDIUM`; Flash-Lite uses `MINIMAL`, with existing generation allowances and hidden-thought filtering.
- Mistral streamed answer deltas accept both strings and arrays of typed content blocks, including mixed formats within one response. Concatenate only `type: "text"` blocks in order; thinking and other block types never enter previews or the accepted carry.
- Mistral prompt-cache keys use `capcontext-summary-v19-<profile>-<model>`. The namespace lives beside the prompt in `api/summary-prompt.js`; bump it when prompt wording changes.

Receipts preserve the actual served provider/model, attempted chain, token usage and `openrouterMs` / `geminiMs` / `mistralMs`; OpenRouter attempts also populate `openrouterModelsTried`. `Space Bunny 2` changes display text only. Identical concurrent conversations share a background promise; up to eight exact completed results remain in worker memory for two minutes, preserving original provider metadata on cache hits.

### Prompt and output policy

`getSummarySystemPrompt()` and `getContextCarryTemplate()` in `api/summary-prompt.js` define the full prompt, canonical title and trusted destination instruction. `api/summarize.js` imports those definitions for provider requests, normalization and local recovery. The backend does not read `legacy/SKILL.md`. Providers receive a system prompt and a user JSON envelope with schema `cap-context-conversation-v1`, data type `untrusted-conversation-transcript`.

The requested title is `CONTEXT CARRY — READY TO PASTE`, followed once and in order by WHO I AM, WHAT WE WERE DOING, WHERE WE LEFT OFF, DECISIONS MADE, OPEN QUESTIONS, KEY CONTEXT, NEXT STEP. Shared grounding hints distinguish reported facts, user identity, named owners, accepted choices, proposals/rejections/deferred alternatives and prohibitions. Named owners are not assumed to be the user; observed integrity remains a fact, not a newly invented requirement. The current prompt retains the fuller fact/source/status collection and final coverage checks after the shorter v15-v17 contract failed repeated grounding checks. It contains no fictional worked transcript or illustrative facts: live experiments exposed example facts leaking into unrelated handoffs. It preserves the pending request and necessary current work product, and distinguishes inspection/proposal from permission to implement. Not-started states and undecided options must not become invented action gates. New arithmetic, diagnosis, recommendations, drafts and plans are explicitly excluded from factual archiving. Important prohibitions are requested verbatim, with a final source/coverage check. These are instructions to the model, not semantic verification; each provider attempt still uses one generation call. The earlier v15 comparison did not justify a production merge; its retained findings remain in `docs/handoff-quality-v15-comparison.md`.

The v19 prompt adapts four principles from the imported `HANDOFF_SKILL.md`: accepted decisions keep explicitly stated reasons, failed attempts keep observed results and stated abandonment reasons, implementation/test/deployment states stay separate, and artifact pointers include their stated purpose. Reasons and status labels are omitted when unsupported; missing evidence stays unknown rather than becoming NOT STARTED. Results keep their original scope, including the distinction between local checks and external verification. Pointers supplement the essential draft/code/evidence because the destination assistant may lack artifact access. The latest task remains a pending request rather than an answer or a newly invented evidence checklist. The imported reference and historical `legacy/SKILL.md` remain separate from this backend prompt. See `docs/handoff-quality-adaptations.md` for the retained comparisons and their limits.

Separate two decisions:

Continuity takes priority over incidental history: WHERE WE LEFT OFF carries the latest user request and stopping point; KEY CONTEXT preserves the current draft/code/formula or exact reproduction needed to act on it, verbatim where wording matters. The fixed NEXT STEP confirmation is separate from the user's pending task. These preservation instructions do not perform that task or authorize proposals. Live improvement must be established against the baseline rather than inferred from passing structural tests.

1. **Deliverability:** an independent content check rejects only refusal-only or substantively empty output after recognized scaffolding/placeholders/trusted instructions are removed. Quoted refusals, contextual inability to connect/build, useful content alongside refusal, short useful text and useful token-limited text remain deliverable. Rejection advances the normal route chain.
2. **Structure/quality diagnostics:** missing/duplicate/malformed headings, shortness and finish reasons produce advisory flags. They do not reject useful provider text. `validateContextCarrySummary()` does not receive the source transcript and cannot establish factual grounding or detect fluent hallucinations.

Strictly structured output gets existing normalization: remove fences/legacy footers, canonicalize headings, add the Unicode box and replace NEXT STEP. Other deliverable output receives the trusted NEXT STEP, then keeps only the first NEXT STEP section for each identical body (ignoring outer whitespace and line-ending differences). Headings inside quotes, indented examples or fenced code are content and are excluded from deduplication. Different NEXT STEP bodies and all other provider text remain intact; do not invent missing sections. Quality diagnostics still describe the original provider output.

Response diagnostics are bounded `validationReason` and `qualityFlags`: `bad_structure`, `missing_section`, `duplicate_section`, `token_limit`, `too_short`, `refusal_like`. Logs include only these and word count. Tiny/emergency backend local-direct results use empty flags/null reason. The advisory floor is 20% of target, clamped to 80–200 substantive words; the separate large-profile `minWords` / `qualityFloorMet` diagnostic is not a prompt minimum or rejection threshold. These diagnostics are not Supabase telemetry. See [docs/summary-validation.md](docs/summary-validation.md) for exact policy/heuristic limits and [docs/summary-accuracy-pass.md](docs/summary-accuracy-pass.md) for historical quality evidence.

### HTTP boundary and release evidence

`POST /api/summarize` requires JSON and `{ "conversation": <nonempty string>, "telemetry"?: <validated started-attempt metadata> }`. The public marker is `X-Cap-Context-Client: cap-context-extension/1`; it is not an authentication secret.

- Accept Chromium/Firefox extension origins. Firefox may omit Origin when the marker is present. A valid extension Origin can omit the marker for already-running worker compatibility.
- Enforce transcript/envelope limits from [Invariants](#invariants), 8 requests/minute and 40/hour per forwarded IP, and 8 concurrent jobs per warm server instance. Summary limiter state is process-local, not durable/global.
- Responses are `no-store`; return bounded user-safe errors, never raw provider bodies. Both Vercel endpoints share bounded JSON parsing and case-insensitive headers through `api/request-validation.js`.
- Vercel/Supabase telemetry validators remain separate deployment bundles; parity tests enforce their shared closed schema.
- Backend release claims require the production alias to resolve to the intended source commit with production environment settings and a real summary receipt. A ready branch preview or successful push alone is insufficient. Extension distribution still requires its own package/store release.

## Telemetry and local receipts

### Storage and Latest Run

| Key/alarm | Scope and purpose |
| --- | --- |
| `context-generator-onboarding-dismissed-v2` | Local onboarding dismissal |
| `context-generator-last-transfer-stats-v1` | One local Latest Run receipt; raw transcript expires after 24 hours |
| `context-generator-install-id-v1` | Random install UUID, not an account/person |
| `context-generator-telemetry-outbox-v1` | Durable metadata queue; 500 entries / seven days |
| `context-generator-telemetry-diagnostics-v1` | Bounded delivery/drop counters and 100 recent metadata-only diagnostics |
| `context-generator-active-transfers-v1` | Six-minute active-attempt snapshots; session storage preferred, local fallback |
| `expire-latest-run-raw-transcript` | Remove only raw transcript fields |
| `retry-transfer-telemetry` | Persisted backoff, Retry-After and startup recovery |

Receipts/outbox persist in `chrome.storage.local`. Active snapshots prefer `chrome.storage.session` to survive worker restarts without crossing a browser restart; older runtimes fall back to local storage. Expired snapshots record unknown outcome, never fabricated failure. Cache/in-flight deduplication and page `isRunning` remain memory-only.

Identical summary requests may share the initiating transfer's network promise. Each waiter has its own cancellation/deadline; expiry returns `transfer_timeout` without accepting its late success/error, and tab closure returns `user_cancelled`. Leaving does not abort/evict shared work while another waiter needs it. The last departing waiter aborts an unsettled request; cancelled results cannot enter the cache. Check elapsed time again when a queued result settles, and clear the wait timer on every outcome. Completed cache entries remain usable. The shared network operation retains the initiating transfer's transport deadline; joining does not extend that operation. Already-received authenticated receipts stay queued for persistence and cancellation failures remain reported; an aborted response is not consumed as new success.

Latest Run persistence is optional: synchronous storage exceptions and rejected writes cannot block terminal telemetry or transfer-lock release.

Latest Run records transfer/capture timings, counts, sizes, profile, actual serving/attempted models, fallback/finish reason, token usage, status and exact captured text. It does not store generated summary text. The matched analysis bridge, not the page directly, reads extension storage; both background and bridge strip expired raw text. The serving model is excluded from the failed portion of the fallback log, and cache reuse preserves provider timing/attempt metadata. Current labels cover four configured OpenRouter models, both Google routes, Ministral and local-direct; unsupported paths ask for a new transfer instead of showing retired routes.

Local destination timings distinguish `openMs` (preparation tab API), `pageLoadMs` (navigation start to DOMContentLoaded, not complete SPA hydration) and `composerWaitMs` (delivery start to the first usable composer). Null means unavailable. These fields stay in the local receipt, separate from telemetry, and the analysis paste card shows page/composer timing. Parallel warmup can make delivery-time waiting zero even when earlier page loading took time.

Capture notes retain local-only observed exclusion categories (`uploads`, `media`, `tools`, `artifacts`, `other`) and a bounded JSON-to-DOM fallback reason. Uploaded-file labels are hidden in the displayed notes. They contain no filenames, IDs, URLs or raw errors and are not added to backend requests or telemetry. A fallback reason records the attempt; the notes say normal capture was used only after a capture completed. No recorded exclusions means none were identified by that adapter, not proof that every native/editor-only item was captured; DOM paths and older receipts can leave exclusions unrecorded.

**Copy all details** copies displayed receipt cards/timeline as label/value text, excluding raw chat. It is disabled without a receipt and reports actual clipboard success/failure with accessible status. A selection-based fallback supports clipboard restrictions/local files.

### Payload, proof and serving-model trust

Delivery: `content script -> background outbox -> Vercel /api/telemetry -> Supabase Edge -> record_transfer_event`.

Every layer rejects unknown fields. Allowed payload fields are `install_id`, `attempt_id`, `attempted_at`, `source_platform`, `destination_platform`, `character_count`, `status`, `last_stage`, `failure_reason`, `extension_version`, and optional `completed_at`, `summary_proof`, `summary_confirmed_at`, `model`, `reported_model`, `diagnostics`. Client completion time is accepted for compatibility but not stored. `reported_model` is limited to the serving-route catalog and post-summary stages; it reports an observed result without claiming a server receipt.

Statuses are `started`, `succeeded`, `failed`. A succeeded terminal transfer requires stage `completed`; summary verification is independent of paste status.

Stages: `intent_started`, `capture_started`, `capture_completed`, `summary_request_started`, `summary_response_started`, `summary_completed`, `paste_started`, `completed`.

Failure reasons: `no_conversation`, `conversation_too_large`, `capture_failed`, `summary_rate_limited`, `summary_service_busy`, `summary_access_denied`, `summary_failed`, `destination_open_failed`, `paste_failed`, `extension_reloaded`, `client_interrupted`, `user_cancelled`, `unknown_failure`.

`transfers.diagnostics` is optional versioned JSONB; legacy absence stays NULL. The closed contract in `extension/transfer-diagnostics.js` records the actual failing branch, last operation, capture/summary sizes and methods, timings, bounded component timelines, retry/recovery and editor/message observations. `prepared_diagnostics` retains the first destination failure alongside the final attempt. Fresh recovery clears the first destination's top-level editor/paste fields; unobserved fields cannot inherit its draft or editor state. Unknown exceptions remain `unknown_error`; never infer a historic cause from route/size alone. Missing fields are unobserved, not false/zero. Source, worker and paste timelines have separate elapsed clocks. Producers cap compact metadata at 12 KiB; relay/Edge bound requests at 24 KiB UTF-8 and SQL independently validates the schema/size. Arbitrary text is rejected at every boundary. Diagnostics remain client reports outside receipt trust. Progress cannot regress observations; first terminal diagnostics are immutable, with one same-outcome fill allowed only for NULL. Counters and proof/model upgrades remain independent. Deploy compatible migration/Edge/Vercel support before clients emit diagnostics. See [the diagnostic contract and investigation procedure](docs/transfer-diagnostics.md).

| Receipt | Authenticated meaning |
| --- | --- |
| v1 `summaryProof` | Summary work bound to attempt/install IDs, attempt start time, source/destination and extension version; summary completion day unknown |
| v2 `summaryProofV2` + `summaryConfirmedAt` | Adds server summary completion time |
| v3 `summaryProofV3` + `summaryConfirmedAt` + `summaryModel` | Also binds the canonical model that actually served |

These camelCase fields belong to the summary response; the worker converts them to the snake_case telemetry fields above. Current workers prefer v3 and persist proof/time/model/authenticated version together through retry/restart. Published Web Store 1.4.8 workers forward only `summaryProofV2` and `summaryConfirmedAt`, omitting model. The backend therefore aliases the v3 proof into `summaryProofV2`. When model is absent, Edge first verifies genuine v1/v2 receipts, then checks the v3 HMAC against the bounded `LEGACY_RECEIPT_MODELS` catalog to recover its authenticated model. Explicit models must verify exactly; no route/date guess or client update is required. Keep that catalog aligned with serving routes and deploy the compatible Edge verifier before the backend. Genuine queued v1/v2 receipts remain accepted without invented model attribution. Unsigned reports remain diagnostics, not proof of completed summary work.

A proof authenticates server summary work and the fields listed for its version. It does not attest capture completeness, reported `character_count`, paste outcome or a person's identity. Those require their own capture/delivery evidence; do not treat a verified receipt as end-to-end correctness.

`transfers.model` follows `character_count` and retains the actual serving result from authenticated v3 attribution or a bounded client `reported_model`, including fallback models and `local-direct`. `model_verified` is true only for model-bound server attribution. A client report can fill missing attribution but never grants summary verification or a signed completion time. A new successful local-direct transfer also increments the existing users counters under the prospective local-counting rule below. A later authentic model may correct a report; the first authenticated attribution remains immutable. A v3 receipt may fill a v2 row only at the identical signed completion time; unknown v1 completion times cannot be inferred. Genuine historical unknowns and attempts with no produced/reported model retain NULL. Never substitute the first requested provider for the actual result.

After producing a summary, the content script reports `timing.backend.model` as `reportedModel` on `summary_completed` and later snapshots. This includes the final fallback provider, the original serving model on cache reuse, and `local-direct` for tiny/offline recovery carries. It does not depend on Latest Run storage or a signed receipt. The worker converts it to `reported_model`, allows only the eight configured serving routes at post-summary stages, and retains the first observation through delayed progress, terminal outcomes, retry and worker restart. Signed proof/time/model remain a separate unit and always take precedence on the server. Optional telemetry storage still has its one-second wait; reporting never delays summary generation or manufactures a receipt.

`record_transfer_event` retains 10–15-argument compatibility; optional sixteenth `p_diagnostics` and fifteenth `p_reported_model` default to NULL, and fourteenth `p_model` remains authenticated attribution. Migration `20261003124307_add_served_model_to_transfers.sql` achieved column order with a locked atomic copy/swap that refuses unexpected schema/dependencies and preserves rows, indexes, constraints, triggers and private access without counter replay. Migration `20261007090336_add_reported_model_attribution.sql` adds `model_verified`, marks previously authenticated models and retains identity/outcome/receipt/counter invariants. Deploy the migration and compatible Edge/Vercel validators before clients emit `reported_model`. Future schema changes must preserve those contracts, not edit applied migration history.

Database model naming: the transfer guard converts authenticated `inclusionai/ling-3.1-flash` to the exact stored label `space bunny 2`. Provider requests, HMAC receipts and their recovery catalog continue using the real provider ID. This normalization applies to old/new workers, retries and existing attributed Ling rows; other models and NULL remain unchanged. The naming migration preserves the first-model guard by comparing the two Ling names as the same model, without allowing replacement by another provider.

### Outbox and ingress availability

- Queue writes are independent of network delivery. Optional summary attribution/receipt waits stop after one second or summary abort, including when Chrome storage never settles. Unavailable preflight storage omits attribution; queued reads/writes remain serialized and can finish later without resending the summary. Signed-receipt persistence tries session storage when local outbox writes reject. Elapsed transfer/transport time and abort state are checked before a backend request and before accepting its result, so storage cannot extend either deadline or cache late success. If storage stays unavailable or the worker stops before persistence, telemetry may be lost while the summary remains usable.
- Per-attempt compaction keeps monotonic progress, first terminal outcome and the first signed receipt paired with its authenticated version. An in-flight acknowledgement removes only the revision actually sent.
- Active-transfer restoration still rereads storage and rebuilds current identities/receipts, but writes only when expiry or sanitization changes the stored records. Progress and receipt persistence keep their existing durable writes and expiry refreshes. Clean restores add no redundant write to the serialized queue the optional summary snapshot waits on.
- Permanent malformed/proof/identity failures are removed with bounded diagnostics so later reports drain. Network/429/5xx failures retry with persisted jittered backoff from 30 seconds to one hour; configuration failures start at five minutes. Retry-After is capped at one hour.
- Capacity pruning retains terminal reports/receipts ahead of ordinary progress and diagnoses every drop. Appends sanitize, compact and enforce the 500-record limit before one outbox write, using the same rules as repair of stored legacy queues. A stop or failed later write cannot leave a newly oversized snapshot; revision IDs and acknowledgement ownership stay intact. Diagnostics contain neither proof bytes nor recoverable rejected payloads. Delivery is best effort, not an audit-complete ledger.
- Edge ingress requires private `TELEMETRY_RELAY_SECRET`; a publishable key is not writer authentication. Matching `TELEMETRY_SIGNING_KEY` values authenticate summary receipts on Vercel/Edge. Fixed errors distinguish permanent, transient and configuration problems.
- Worker delivery deadline: eight seconds; relay upstream deadline: five seconds. Edge body bound: 4 KiB/one second; RPC deadline: four seconds. Upstash budgets are per-install 180/minute and 2,000/hour; per-IP 3,000/minute and 30,000/hour; global 20,000/minute, 60,000/hour and 200,000/day. Redis IDs are keyed hashes with short TTLs. A 450 ms store failure falls back to bounded process-local limits and an enum-only warning. These limits are separate from summary admission limits.

### Database and counters

Project: `cap-context-telemetry` (`iqkzynzxbmemhtiupwwu`). Migrations define expected schema/access; live engine version and deployed migration/function state require a fresh check, not a dated documentation claim. Operational checks, encrypted backups/restores and rollout details are in [supabase/README.md](supabase/README.md).

- `transfers` has one mutable row per `attempt_id`, preserving immutable core identity, first terminal outcome/stage/reason, signed completion and first authenticated model attribution. A signed model can correct an earlier unverified report. `received_at` is initial receipt time, not a complete progress timeline. Historical failure/progress/completion timestamps deliberately are not retained. Compatible `p_completed_at` is ignored.
- `transfers.user_no` and `username` display the current `users.user_no` and `users.name` joined through `install_id`. The transfer RPC allocates a missing user before writing the first transfer and assigning labels, including local carries, empty attempts and unfinished work. RPC retries use the same allocation path. Existing unmatched installs are backfilled with zero counters. Labels follow renames and clear on explicit user deletion/reset; label-only UPDATE never recreates a deleted user. These are anonymous install labels, not account/person identities, and clients cannot choose them.
- Use `users` for current counters and `transfers` for history; removed reporting views and generated duplicate `id` are not runtime interfaces. Signed summary days can be grouped in Asia/Kolkata. For chronological results, request an explicit `ORDER BY attempted_at`; physical/table-editor row order is not a database guarantee.
- A `started` row means no terminal outcome was received. Never infer failure or backfill verification from it. Extension-local `outcome_unknown` diagnostics are separate. There is no automatic event deletion or retroactive failure/verification backfill.
- Both tables keep RLS enabled without public policies. `anon` / `authenticated` have no table/view/RPC access. Service-role writes have SELECT/INSERT/UPDATE and required sequence/RPC rights, not DELETE/TRUNCATE. Database constraints/guards also protect direct service writes. New application objects owned by `postgres` default private; hosted application migrations cannot change managed `supabase_admin` defaults.
- The original first-observed extension version remains stored, though a later RPC caller may legitimately use an upgraded version. This differs from the authenticated version paired with a proof during worker retries.

User counters retain their existing names. Verified backend summaries count once even when paste fails. Successful `local-direct` transfers first received after the local-counting deployment also count once in `lifetime_summaries` and `today_summaries`, using the terminal/model-report transaction day in IST. These combined totals measure authenticated backend work plus client-reported local delivery; they are not exclusively verified-summary counts. Failed/pending local carries and unsigned remote successes do not count as summaries. A later genuine receipt cannot double-count a local success. The deployment cutoff is frozen in `record_user_summary` and survives migration replay; old local attempts are not backfilled or counted by delayed retries. Local reports remain unverified. Failure accounting, the original users-reset cutoff and both IST daily-reset paths retain their existing behavior.

User allocation:

- Column order is `install_id`, `user_no`, `name`, `lifetime_summaries`, `today_summaries`, `today_failed_attempts`, then internal `today_date`. Installs are not unique people.
- The first received transfer attempt creates a row independently of verified-summary/failure accounting. Identity allocation does not increment any counters. The authorized users-only reset retained transfer history; attempts recorded before its cutoff still cannot restore cleared counts, including delayed completions. Historical identity backfill does not replay accounting.
- New installs use a short advisory lock and transactional max+1 numbering. Duplicate/rolled-back inserts do not leave visible numbering gaps. Names prefer random unused values from the 40-name predefined Naruto pool; once exhausted, reuse a random pool name. Names are cosmetic and may repeat; `install_id` and `user_no` remain unique identities. User No. 1 additionally permits exact lowercase `naruto`, outside automatic allocation.
- Exhausting the name pool cannot block a transfer identity/counter write. Failure reports/install IDs remain client-supplied diagnostics, not authenticated identities; receipt signing authenticates summary work and rate limits only bound anonymous abuse.

Counter rules:

| Counter | Countable event | Time attribution |
| --- | --- | --- |
| Lifetime summaries | First verified summary, even if paste failed | Once per attempt; independent of transfer success |
| Today's summaries | First verified summary with known signed day | Server signed occurrence time in Asia/Kolkata; delayed earlier-day and unknown-day v1 proofs do not inflate today |
| Today's failed attempts | First received failed terminal outcome, excluding `no_conversation` | Transaction-start calendar day in IST, ignoring client clocks |

Empty/unknown/started activity receives a user identity but never creates a counted failure. Empty-only telemetry is filtered before counter triggers run. Current day is sampled with `clock_timestamp()` after existing-user or new-allocation locks; failure occurrence uses stable `transaction_timestamp()`. This prevents a midnight lock wait from restoring yesterday's counters or moving yesterday's failure into today.

Both daily counters reset at 00:00 IST via the existing GMT cron `30 18 * * *`; ingestion resets them if the job is late. Reconciliation preserves lifetime totals and the users-reset cutoff. Keep old RPC defaults, sticky outcomes and signed-day behavior when changing counters.

For telemetry rollout, preserve compatibility across queued receipts: backup/restore and migration dry run -> additive schema -> matching secrets -> Edge -> Vercel -> extension. Keep signing keys valid while seven-day queues may hold old receipts; rotation needs verifier overlap or a drained queue. Roll back code while retaining compatible schema/validators, not by dropping new fields or rewriting migration history.

## Composer UI and paste

### Shared lifecycle and visual ownership

- Each content instance publishes teardown before monitoring. A new `CONTENT_SCRIPT_LOAD_ID` invokes the previous teardown, removes owned runtime/DOM listeners, disconnects observers, cancels timers/frames, restores reservations and removes only owned UI. Same-version duplicate injection is a no-op. Read the current constant in `extension/platform-content.js` rather than copying a stale value here.
- Reuse/move one owned orb across editor remounts. All inline slots use a non-shrinking 36px button with 32px artwork; native control groups may wrap rather than overlap. Preserve native hiding and remove marker attributes on replacement/teardown.
- Composer-orb hover retains its enlargement/glow. A click ends any in-flight hover transition and gives the artwork a 110 ms acknowledgment: 3% compression with slight dimming, returning directly to its original size. It runs alongside picker opening/closing with no delay, extra enlargement or overshoot. Repeated clicks replace the pulse; reduced motion skips it. The next hover restores hover motion.
- Picker opening uses a 160 ms translation-only entrance with 120 ms opacity and a 6px lift; reduced motion disables sheet/backdrop transitions. Focus is available on the opening frame. Speculative preconnect/JSON capture waits only for the entrance's remaining animation time, keeping rendered-history snapshotting out of its frames. Selection starts capture immediately if prefetch has not started; reduced motion adds no wait. Dismissal cancels queued work and a prior Speed-triggered capture is reused. The opaque picker panel has no redundant backdrop filter; the page scrim retains its blur.
- Validate visible controls belonging to the active editor, excluding hidden copies, other composers and popup/menu/listbox/dialog controls unless the dialog contains the actual composer. A native popover may `aria-hidden` the background without removing it: retain only an already verified, connected, geometrically visible editor. Newly mounted modal/settings editors cannot replace it.
- Document child-list, focus/visibility/resize and SPA monitoring remount the orb. Scoped control mutation observers cover attribute-only visibility/mode/label changes while ignoring ordinary editor character-data. Stable ownership reuses observers; remount/release/teardown replaces or disconnects them.
- Claude's open destination picker belongs to its chat pathname. Compute and lock its coordinates once on opening; native editor/toolbar/host replacement, attribute changes, viewport resize and temporary composer loss must not reposition or close it. Preserve focus and Speed state while reconnecting the same orb. Only the backdrop cutout follows the orb; remove that hole while no visible orb owns the slot. Explicit dismissal and a different chat pathname close the picker without reopening from queued work; a selected transfer keeps the same geometry until its handoff takes ownership. Reopening computes placement for the current viewport. Other inline providers retain editor/wrapper ownership and dismiss on replacement, route change or resize. Reset the retained orb's expanded state and active visuals even if its old composer already detached it when dismissal is required.

### Platform placement contracts

**Claude — inline only:**

- Expanded layouts locate sibling `ChatComposerActions` within the input's nearest `ChatComposer`, validate owned attachment/model controls and distinct rows, then mount before the persistent mic/Voice/Send branch. The hidden Send node still identifies that branch in Voice mode; keep the orb outside animated layers.
- A model-only chin variant still mounts in the editor's Send row. A Reply layout with both attachment and model in `ChatComposerChin` instead validates their separate flex groups in the same chin row and mounts before the model branch.
- Expanded toolbar CSS moves absolute groups into wrapping normal flow and resets that editor's leading/trailing/float/bottom-padding reservations. Reply-chin CSS changes only the chin flow: preserve the native editor Send position and trailing inset. Do not reparent/translate native controls.
- During sending/docking gaps, retain the validated inline row only while its connected input still owns it. Detached/replaced ownership hides until valid discovery returns; an unmatched connected input keeps attribute monitoring on its named composer. No fixed-placement switch, grace timer or placement ResizeObserver is active. Retained legacy helpers are inactive; reservation cleanup still handles older injected instances.

**ChatGPT — inline first, validated geometry backup:**

- Responsive layouts validate `[data-composer-input]` and its closest `[data-composer-footer-responsive]` inside the input's own `[data-composer-body]`, using the owned `add-context` navigation control.
- Free transition grids validate `[data-composer-body][data-composer-grid]`, `composer-plus-btn` and direct `leading` / `trailing` slots. They have no required responsive-footer/input markers.
- Mount before the owned `reasoning` or visible Think/Thinking branch, outside its tooltip wrappers. If Think is hidden on a narrow layout, anchor before visible mic/Send controls without revealing Think. Do not require a paid model selector or assume a child index.
- Scoped CSS gives native control tracks intrinsic widths and wrapping while preserving editor row switching and `display:none`, `hidden` and `.hidden` states. The orb sits 6px before the model branch. Identity includes the body, native rows/common control group and model branch, even if child nodes are reused.
- Failure to validate inline uses the existing GPT geometry backup. Returning inline clears backup reservations/placement observers while retaining hover/picker effects. Both inline and backup observe attribute-only native visibility changes, including `hidden`.

**Gemini, Grok, DeepSeek — platform-specific inline adapters with geometry backups:**

| Platform | Validated inline slot | Fragile behavior to preserve |
| --- | --- | --- |
| Gemini | Active `.text-input-field` trailing actions, before visible `bard-mode-menu-button`; mobile mic/send when model picker is hidden | Select an owned visible wrapper; keep model slot horizontal/nonwrapping even when native wrapper uses a column |
| Grok | Active `.query-bar`, named input and attachment, before owned `model-select-trigger` | Convert the matching absolute toolbar to normal flow and replace only its editor bottom-padding reservation; picker ownership includes that editor container |
| DeepSeek | Textarea sibling action row, file-input candidate paired with its preceding native upload control, plus visible native circle action | Allow non-control spacers and hidden upload; mount before visible upload or direct native-action branch; do not rely on hashed classes |

For these three backups, score/cap composer candidates and reject page-sized/misaligned surfaces; never accept an unvalidated editor parent. Only backup geometry reserves an outer composer and runs placement ResizeObservers. Temporary discovery loss retains last verified viewport placement at page root for at most 700 ms; a valid composer reclaims it, persistent loss hides. Inline validation clears geometry/grace state. Keep the validated native ancestor observer when fallback selects a narrower surface so an outer identification-class restoration can recover without resize/child changes. Restore previous inline styles when reservations change. Fallback pickers retain their existing lifecycle without inventing an inline owner.

### Picker, handoff and motion

- Extension-owned constructed stylesheets protect layout from page CSP. Dark Reader handling uses ignored/scoped styles and priority colors for the picker, progress overlay, errors and recovery dialog while progress remains state-driven. Recovery copy success/failure/reset and focus colors retain inline priority so their live states override the initial palette snapshot. Teardown removes only extension-owned styles/reservations.
- The picker backdrop has a small opening matched to solid orb artwork so the real composer orb stays sharp/clickable despite native ancestor stacking. Measure the image rather than the larger button: the solid artwork spans 75% of `bubble-icon.png`'s transparent canvas. The button's background, border and box shadow stay transparent/absent even under native page overrides. The orb stays in its slot; adjacent composer background remains blurred. The opening tracks scroll/resize and each frame of the orb's transform transition, including dismissal after `aria-expanded` becomes false while the backdrop still fades. Tracking stops when motion or the visible backdrop finishes; teardown cancels its owned frames. Clear the opening when backdrop closing finishes. Do not clone the orb or raise neighboring controls to solve stacking.
- Tab/Shift+Tab skip both composer and header orbs. The custom picker cycle includes enabled destinations and Speed only. Header orb is a pointer link to the website with `noopener noreferrer`; it never starts capture. Its hover mirrors the composer's 14% enlargement, 1px lift and glow; reduced motion skips the transition.
- Outside-click/lifecycle dismissal preserves native focus. Explicit keyboard/backdrop dismissal may restore the composer only while focus still belongs to picker/orb. Delayed dismissal cannot steal focus from a reopened picker or another page control.
- Handoff starts at the measured picker position, which stays locked through the picker-to-handoff animation. Progress completes from actual capture/summary/paste events, not decorative motion.
- Summary countdown is display-only: 20 seconds through 60,000 captured characters, rising to 65 seconds at 110,000 and capped there. It starts only after capture size is known and stops when summary is ready. Overrun says `Taking a little longer—still working.`; the line stays at 90% until real completion. The tip pulses during waiting; reduced motion disables movement. Estimates never alter provider budgets.
- Speed's three backward gold trails follow the bolt's sloped left edge in a staggered 420 ms loop; off hides them and reduced motion retains static trails. They are decorative, track `aria-pressed` and reserve header space at narrow widths.
- Orb hover retains 14% enlargement over 260 ms, 1px lift and artwork-shaped purple glow. Click feedback uses the small artwork pulse described above, without another picker-open enlargement or glow change. Hover cannot override picker/handoff state or change toolbar geometry. Dismissal resets active effects independently of focus; the preserved-backdrop handoff bridge retains them until handoff ownership. Reduced motion skips the pulse and changes hover size/lift immediately.
- Empty-chat errors remain bottom-right; pending error reveals/dismissals are cancelled when picker/handoff state changes.

### Paste verification and draft recovery

`pasteIntoPlatform` uses native setters/events and stability checks. Rank writable/enabled candidates so a disabled/read-only high-scoring node cannot mask an available editor. Retain an already verified composer through temporary disabled/`aria-hidden` state, but readiness must still pass before insertion.

- Firefox alone converts contenteditable line breaks to escaped HTML `<br>` elements. ChatGPT has longer insert/verify/stability windows.
- Require at least 95% of expected normalized words in order across the whole editor text, not three samples. Normalize whitespace/newlines/punctuation/bullets and rendered Markdown differences (link targets, code-fence labels, ordered/task markers). A linear scan handles normal matches; bounded insertion/deletion matching handles small omissions/repeated words.
- This tolerates up to 5% missing words; it is not byte-for-byte completeness proof. Detached editors cannot complete verification after remount.
- Initial insertion, retries and post-activation recovery preserve nonempty drafts, including focus-restored drafts. Already verified text is accepted without replacement.
- ChatGPT retains its in-paste 550 ms stability check. The other four recheck 550 ms after activation. If empty, paste once more, verify immediately and after another 550 ms. Still-empty/unavailable or nonempty changed draft opens the destination manual-copy modal; never replace changed user text.

## Changes that must stay aligned

| Change | Coupled contracts |
| --- | --- |
| Platform/host support | Manifest matches/permissions, content `PLATFORMS`, background `DESTINATIONS` / `DESTINATION_HOST_RULES`, telemetry platform lists, tests and smoke fixtures |
| Transcript limits | Capture/source-local recovery, request-security character/byte/envelope bounds, analysis display and tests |
| Model/profile routing | Provider constants/flags/budgets, prompts/cache namespace, Latest Run labels, served-model validation/signing and evaluation expectations |
| JSON capture contract | MAIN hook, serializer/bridge, readiness versions, manifest/on-demand installation and identity/transport/content fixtures |
| Telemetry field/outcome | Client sanitizer/producer, worker compaction/persistence, Vercel validator, Edge validator/proof verification, SQL constraints/functions and parity/replay tests |
| Local receipt | Producer, background retention, bridge, analysis renderer and tests |
| Content-script runtime change | Advance `CONTENT_SCRIPT_LOAD_ID`; preserve teardown and stale-node/reservation cleanup. Documentation-only changes do not need a runtime ID bump. |
| Extension release | Manifest version, ZIP rooted at `manifest.json`, hash comparison against extension source and a fresh unpacked Brave check; Web Store upload/publication is separate |

Do not weaken an adjacent privacy/ownership/compatibility guard to make one new layout or payload pass. Update the matching fixture to represent the observed variant and retain the existing variants.

## Verification and diagnosis

On Windows use `npm.cmd` for npm scripts when PowerShell shim policy blocks `npm`. Select checks by behavior changed; a documentation edit needs source/link/consistency review, not provider calls or a release smoke solely to validate prose.

Fresh checkout: use Node 22, install Brave, then run `npm ci` and `npm run gate`. The lockfile supplies PGlite as a development dependency; no special database install or environment variable is needed. Browser fixtures launch a separate disposable profile/window. Linux browser checks need a display; use `xvfb-run -a npm run gate` on a headless machine with Xvfb installed. `BRAVE_PATH` can point to a nonstandard Brave installation.

### Check selection

Keep shared deadline/decoding boundary checks once, plus each provider's distinct routing policy and each platform's capture wiring. Prefer observable failures and recovery over source-text assertions. Native socket cancellation, privacy, SQL replay and installed-browser integration establish separate behavior and remain required where applicable.

Fold basic formatting, delivery and retry assertions into stronger contract fixtures when they exercise the same path. Keep distinct outcomes in those fixtures, including cancellation before and after a signed summary receipt, malformed-response recovery, and exact text preservation. Test counts describe the Node suite separately from database replay and browser checks; counts alone do not measure coverage.

JSON reader rejection matrices run once per implementation: Claude, ChatGPT and the shared Gemini/Grok/DeepSeek reader. ChatGPT retains session/history/paste-descriptor wiring checks; each network adapter retains exact Unicode capture and rejected-transport cancellation. Combine overlapping success fixtures while keeping platform-specific parsing, attachment, identity, deadline and fallback regressions.

DOM remains active for other platforms' JSON failures, unsaved chats, Speed opt-out and toolbar transfers. ChatGPT fast-read failures stop before DOM capture. Keep a compact suite for verified roles, deduplication, virtual scrolling, delayed history, pasted content, source identity and privacy. Full repeated-turn/delayed-render sweeps can replace overlapping basic/helper fixtures; retain the separate slow physical-scroll regression.

For branch prompt experiments, `scripts/compare-summary-prompts.js` compares a pinned baseline Git commit and the working-tree backend on the same synthetic `evaluation/handoff-quality-cases.json` inputs. It alternates order, retains every repeat and full synthetic model output, records prompt/input hashes and token usage, and never grades exact local fallback as model success. Credentials/account/route/rate-limit failures stop the experiment. Lexical coverage is advisory: review full handoffs against the fixture's continuation criteria. The seven cases cover corrected decisions, current drafts, unbooked plans, tutoring preferences, exact debugging evidence, hostile/unrelated content and review-only budget scope. Optional `--long-history` variants preserve complete source turns with corrections between unrelated history blocks at 90k/280k characters; `--case-id` selects one case. Reports record selected cases and the runner hash. This separate suite does not expand the scheduled production monitor.

Owner-authorized live comparisons use `scripts/compare-summary-with-test-key.ps1` and the two Windows-user-encrypted test credentials outside the repository under `%LOCALAPPDATA%\CapContext\testing`. It selects Ling, Dots or Qwen, never borrows a production key, and preloads the test-only zero-price/private-route and 50-request-per-key rolling-24-hour guard. Failed requests count; spacing and a private locked ledger persist between runs. Reports expose only slots/counts, not credentials. See `docs/handoff-quality.md` for usage. This is local evaluation policy, separate from production credentials, routing and funded-budget enforcement.

`evaluation/capcontext-bench/` is the opt-in CapContextBench v1 workflow, outside ordinary tests and CI. Six source-grounded synthetic cases cover preservation, grounding and 90k-history recall. Its offline CLI prepares frozen fixtures, creates source-review sheets and scores every reviewed repeat from the existing guarded comparison runner. Continuity, fidelity, grounding and delivered structure remain separate; a handoff passes only if all four pass. Literal checks apply only to explicitly exact payloads. Unavailable/local-fallback, unreached and unreviewed results have no final quality score. Model tables require matching dataset/prompt/runner/repeat cohorts and observed profile/output allowances; matched per-dimension failures inform investigation without claiming pure model-only causality. Latency and completion tokens are reported separately. No push hook, npm script, production route or scheduled monitor invokes this benchmark. See its README for manual commands and attribution limits.

The manual `export-ranking.cjs` and `render-ranking-dark.py` scripts in that directory reproduce a dated minimal rank-versus-time PNG from archived comparison data, without provider calls. Space Bunny 2 is the display name for the archived Ling 3.1 Flash results; its provider ID remains explicit in the export. The historical qualitative model order and exported newer v1 handoff percentages remain separate cohorts; the export retains unavailable attempts and records source hashes. Historical ranks are not current v1 accuracy scores.

| Change | Focused check | Additional evidence when relevant |
| --- | --- | --- |
| DOM capture, pasted cards, placement, picker/handoff, paste | `node --test --test-skip-pattern="^slow/release:" test/platform-content.test.js` | `npm run test:slow` for capture changes; installed Brave smoke for meaningful extension/UI changes |
| Background messages/recovery/cache | `node --test test/background.test.js` | `npm test`; installed smoke if cross-tab behavior changes |
| Prompts/routing/output policy | `node --test test/summarize.test.js test/request-security.test.js`; applicable routing/body-timeout tests | `npm run eval` probes deployed production, so a local prompt change needs a matching test deployment to assess its quality |
| Telemetry/schema/counters | Telemetry delivery/handler/verified-receipt tests; `node scripts/check-verified-telemetry-db.js` | Backup restore/bounded upgrade, hosted grants/proof/counters when changing deployment, installed database smoke |
| Latest Run | `node --test test/analysis.test.js` | `https://spreadz.in/analysis/` with extension loaded in the same browser |
| Release/package | `npm test`, `npm run test:slow`, `npm run test:extension-smoke` | Appropriate live evaluation and ZIP hash/resource checks |

Commands and evidence boundaries:

- Provider-specific regressions live in `test/openrouter.test.js`, `test/flash-chain-budget.test.js`, `test/flash-lite-fallback.test.js` and `test/provider-body-timeout.test.js`. Select them when changing those routes or budgets; use `--test-timeout=30000` for focused deterministic runs too.
- `npm test` selects `test/**/*.test.js` with a 30-second hang limit, excluding `slow/release:`. Shared setup lives in `test/helpers/`; the explicit file pattern keeps helpers and data fixtures from running as standalone test files. `npm run test:slow` runs the simulated-time physical-scroll regression with a 60-second limit. Retry tests may schedule the retry immediately while asserting the requested delay and advancing Date by that delay; native HTTP timers stay real. Deadline-race tests deliberately advance Date before overdue timers run. Restore clocks/timers after each test. Unicode streaming fixtures must force and assert a multibyte split rather than generate thousands of tiny chunks through the entire large paste.
- `npm run test:extension-smoke` uses a disposable Brave profile, unpacked extension, controlled five-platform placement/picker fixtures and a stub backend. Default transfer is ChatGPT -> Claude. It covers exact capture/paste without Send, drafts, 760/390/320px layouts, remounts, free ChatGPT transition slots, Claude Reply-chin transitions, focus and reduced motion. It establishes integration against those fixtures, not current native-account capture completeness or provider quality. Use a separate browser window/profile for live checks too.
- The copied smoke extension exposes ChatGPT inline mount readiness to its isolated test context. After synthetic project-route navigation, await a connected composer/orb mounted for that pathname before picker checks; opening during the route poll can trigger the product's intended owner-change dismissal. Failure diagnostics include picker/orb state and only visible handoff text.
- For a recovery-dialog palette change, `CAP_CONTEXT_RECOVERY_PALETTE_SMOKE=1 npm run test:extension-smoke` runs only the installed dialog with synthetic text and simulated Dark Reader overrides. It checks the gradient, borders, shadows, text, focus and copy success/failure/reset without writing to the real clipboard or starting a transfer. The ordinary smoke also covers the palette after delivery.
- `CAP_CONTEXT_TELEMETRY_SMOKE=1` adds installed-worker -> local relay/Edge -> real migration replay, checking verified count/outbox drain. PGlite is pinned to `0.5.8` in development dependencies/lockfile; `PGLITE_MODULE_PATH` remains an optional external-module override. The application still has no runtime npm dependency.
- `npm run eval` sends requests to the deployed production endpoint, consuming provider quota. Each case allows one retry for quality/transient/malformed-JSON failure; a second failure still fails. Both attempts retain quality/error/latency/model/token metadata, with a warning on recovery. Case and evaluation totals include failed requests, body reads and retry delays. All cases are evaluated even if an earlier endpoint fails. Optional `EVAL_REPORT_PATH` saves the report without chat/summary text; absent token usage stays unknown. Curated English contradiction patterns reject denial of critical fixture facts even when their required phrases are present. These checks and structural scores cannot establish general semantic grounding.
- `npm run gate` is entirely offline: deterministic tests + slow capture + `npm run test:db` migration replay + installed Brave smoke. Run `npm ci` first and install Brave; live evaluation remains the separate, explicit `npm run eval` command.
- `CAP_CONTEXT_SMOKE_ARTIFACT_DIR` saves screenshots and bounded console/browser diagnostics when a browser fixture fails. Placement tabs are captured before closing; destination connections are retained while waiting for exact paste, including recovery tabs, so a timeout can capture their state. Disconnected pages and artifact failures preserve the original assertion. CI also saves each browser command's complete log and uploads failure artifacts for seven days. Screenshots are only captured on failure, from isolated synthetic fixtures.

JSON smoke modes (run with `npm run test:extension-smoke`):

| Source | Focused tests | `CAP_CONTEXT_JSON_SMOKE` |
| --- | --- | --- |
| Claude | `node --test test/claude-json-capture.test.js` | `1` |
| ChatGPT | `node --test test/chatgpt-json-capture.test.js test/background.test.js` | `chatgpt` |
| Gemini / Grok / DeepSeek | `node --test test/network-json-capture.test.js test/background.test.js` | `gemini` / `grok` / `deepseek` |

Optional scenarios: `CAP_CONTEXT_CLAUDE_RELOAD_SMOKE=1`, `CAP_CONTEXT_CLAUDE_PARTIAL_SMOKE=1|oversize`, `CAP_CONTEXT_CHATGPT_RELOAD_SMOKE=1`, `CAP_CONTEXT_CHATGPT_AUTH_SMOKE=paste401`, `CAP_CONTEXT_CHATGPT_FAILURE_SMOKE=partial|streaming|ranged|paste-oversize|history-oversize`, `CAP_CONTEXT_NETWORK_FAILURE_SMOKE=partial`, Grok's `file-only` or DeepSeek's `oversize`. Oversized history/paste and expired-token cases reuse one paced 20 MB tail helper without `Content-Length`. Claude's oversized response applies only to the fresh strong-consistency capture read; its page-owned routing read stays untouched. History/paste excess requires native cancellation; ChatGPT must stop without DOM scrolling or a backend request, while other platforms retain DOM recovery and exact delivery; expired-token cancellation requires one auth refresh and exact full JSON capture. Rejected history must start no file download or ChatGPT paste descriptor; an oversized paste must be downloaded only once. Clear scenario environment variables before a normal success run. Fixtures cover history absent from DOM, auth/identity recovery, pasted/doc text, announced fallback and exact backend/paste behavior. Await the fixture's initial page-owned request before counting reload/picker activity, the picker's exit animation before independent checks and its color transition before measuring disabled appearance.

CI in `.github/workflows/regression-gate.yml` separates three kinds of evidence:

- Pushes to `master` / `codex/**`, PRs into `master` and manual dispatch always run the required **Offline checks** job on Node 22 / Ubuntu 24.04. `scripts/ci-scope.js` compares default-branch pushes against their before snapshot and PRs against their base. Every feature-branch push compares its entire tree against the default branch, so a later docs-only push cannot hide unmerged code. Only the necessary base snapshot is fetched. Missing/unknown history, force pushes and manual runs select full checks; mixed changes never use only the latest commit to qualify for the shortcut. No workflow path filters skip the required status.
- Lightweight checks apply only to the root README/LOGIC/CHANGELOG/PRIVACY/LICENSE/CNAME files, Markdown under `docs/`, public raster images/videos under `brag/`, and existing homepage/privacy HTML text/comments/CSS edits with identical scripts, tags and wiring attributes. Symlinks, executable file modes, added/deleted HTML, links, handlers, markup and all other paths select full checks. The light path checks Git whitespace plus the CI-scope and public-license/image-reference tests, without npm dependency installation, database replay or Brave setup.
- Full checks retain locked/cached npm development dependencies, deterministic + slow capture, real migration replay and eleven sequential Brave fixture cases under Xvfb. Brave setup has a two-minute step limit and bounded connection/download retries so an external installation stall fails promptly. The DOM case owns the full placement suite and local relay/Edge/database telemetry path; focused ChatGPT fast capture exercises extension reload and expired-token body cancellation/recovery. One Claude step verifies exact successful capture of a CRLF inline pasted card, then partial JSON with announced DOM fallback. DeepSeek requires four overlapping original-file reads with exact source-order output, and separate Claude/DeepSeek oversized-history cases require native cancellation and successful DOM fallback. ChatGPT oversized-history/paste cases require native cancellation and a capture error, no summary request and an unchanged history sidebar; successful ChatGPT JSON capture also preserves that sidebar. Gemini bootstrap capture and partial-history fallback use its matching native composer, with an absent optional candidate-selection slot, cross-page parent-candidate selection and zero response-menu clicks; DeepSeek also serves its matching composer instead of ChatGPT markup. These representative cases add no AI requests. One checkout/runtime setup and one eight-minute job own cancellation of superseded-ref work; database and each browser step retain five/three-minute limits. Bash pipe failure propagation keeps logged browser failures red. Repository permissions are read-only. This job is the required status check for master integration.
- Daily 06:17 UTC (11:47 IST) schedule runs **Live production summary check**, not branch code validation. Manual `evaluate_production` can add it, default off. It is serialized, has a 25-minute allowance for bounded case retries, and uses deployed production's accuracy/structure/contradiction/latency thresholds. Attempt-level reports, including available token usage, are retained as a 14-day Actions artifact.
- A failed live check remains a real failure but does not establish that the checked-out code regressed, or gate automatic Pages/Vercel deployment. Green offline checks do not establish deployed provider quality. Branch workflow edits affect scheduled/default behavior only after landing on `master`. Master protection requires the GitHub Actions **Offline checks** result before accepting integration, including administrator pushes.

Browser fixture failures save screenshots and logs under `.test-artifacts/browser-smoke/`; CI uploads them for seven days. This ignored diagnostic output is independent of local development tools.

### Diagnosis starting points

| Symptom | First place to inspect | Do not infer |
| --- | --- | --- |
| Orb missing/misplaced after sending, account/layout change or resize | Current visible composer DOM; platform `find*InlineToolbar`, ownership/markers, observer scope and picker invalidation | A free plan necessarily lacks controls, or a generic/fixed anchor is safe for Claude |
| JSON capture falls back or captures the wrong branch | Hook readiness/ownership, pinned chat/account, route/auth observation, serializer completeness and cancellation | A worker installation acknowledgement proves MAIN readiness |
| DOM capture loses/duplicates turns | Actual scroll root, virtual overlap, role boundaries and stable IDs | Simulated window tests prove full live-chat history |
| Pasted carry disappears or user draft changes | Ready editor identity, pre-focus draft, verification and post-activation recovery | A successful insert event proves stable delivery |
| Useful summary has quality flags | Content gate versus advisory validator, finish reason and actual deployed model | Bad structure should discard useful context, or good structure proves grounded facts |
| Latest Run model differs from telemetry model/NULL | Display alias, actual response model, v3 receipt, source-local/cache/legacy path | The requested primary model served, or NULL is always an ingestion defect |
| `transfers` stays started or counts look low | Outbox/revision delivery, terminal report and signed receipt/counter eligibility | Started means failed, or successful paste necessarily proves summary work |
| Local checks pass, live evaluation fails | Exact subcommand, deployment commit/alias/environment and provider output | All validation modes check the same artifact or failure category |

Current limits worth preserving in assessments: JSON checks cannot prove absence of unmarked server omissions; DOM role+text can lose real repetitions; summary validation cannot establish semantic grounding; paste verification allows 5% missing normalized words; telemetry can drop bounded old/capacity reports; automated browser evidence is Brave/fixture based. Report those practical boundaries when they affect a conclusion, rather than promoting a test pass into a broader product guarantee.
