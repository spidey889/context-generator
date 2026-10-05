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
- [Interactive architecture](architecture/README.md): isolated Astro diagram with source links, editable Archify data and regeneration notes.

Runtime and packaging:

- Node 22 for backend/scripts/CI. The extension has no build step or runtime npm dependencies; browser checks load `extension/` directly.
- [extension/manifest.json](extension/manifest.json) is the version and shipped-host authority. It currently declares version `1.4.8`, Chromium service-worker and Firefox background-script variants. Automation uses Brave; that does not certify Firefox compatibility.
- The extension's backend alias is `https://context-generator-five.vercel.app`. Its Latest Run bridge is injected on `https://spidey889.github.io/context-generator/analysis*`, not on arbitrary copies of the analysis page.
- No release ZIP is tracked. Packaging and Web Store publication are separate from repository changes. Product-film sources, reproduction instructions and credits remain in [brag/README.md](brag/README.md).

## Invariants

1. Opening, browsing, toggling Speed, closing or cancelling the picker never captures or transmits chat text. Readiness probes, destination warmup and preconnects contain no conversation data.
2. Capture starts only after destination selection or an explicit extension-toolbar transfer. Pasting and focusing never submit the destination message; Send remains the user's action.
3. Reject oversized transcripts without clipping: maximum 350,000 JavaScript `String.length` units and 1,400,000 UTF-8 bytes. The 2,200,000-byte JSON request limit is a separate envelope bound.
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
| Summary profiles, prompts, provider order and output policy | [api/summarize.js](api/summarize.js): `handleSummary`, `createSummaryWithFallback`, `createSummaryWithProvider`, `validateContextCarrySummary` | `test/summarize.test.js`, routing/body-timeout tests, live evaluation for quality changes |
| Backend request boundaries | `api/request-security.js`, `api/request-validation.js` | `test/request-security.test.js` |
| Telemetry producer, queue, expiry and recovery | `extension/platform-content.js`, `extension/background.js`: `recordTransferTelemetry`, outbox and active-attempt helpers | `test/telemetry-delivery.test.js`, `test/telemetry.test.js` |
| Telemetry relay, rate limits, validation and HMAC verification | `api/telemetry.js`, `api/telemetry-validation.js`, `api/telemetry-rate-limit.js`; `supabase/functions/transfer-telemetry/`; `supabase/functions/_shared/summary-proof.mjs` | `test/telemetry-handler.test.js`, `test/verified-telemetry.test.js` and local database replay |
| Database identities, immutable outcomes, verified models and counters | [supabase/migrations/](supabase/migrations/), `record_transfer_event`; operations in [supabase/README.md](supabase/README.md) | `scripts/check-verified-telemetry-db.js`, backup/restore checks |
| Latest Run bridge and rendering | `extension/analysis-bridge.js`, `analysis/index.html`: `readLastTransferStats`, `renderStats` | `test/analysis.test.js`; open the matched analysis page with extension loaded |
| Installed-extension integration and live model quality | `scripts/run-extension-smoke.js`, `scripts/run-regression-eval.js`, `evaluation/`; CI in `.github/workflows/regression-gate.yml` | See [Verification](#verification-and-diagnosis) |

Capture, placement, paste and UI share the content script's mutable state and teardown lifecycle. Background code owns tab operations and worker persistence; MAIN-world hooks own native-session observations. Preserve those boundaries when extracting helpers.

## Transfer lifecycle

```text
orb click -> picker and preconnects only
destination selection -> attempt ID + started telemetry; pin source identity
empty-chat guard -> stop before handoff or destination work when no usable chat exists
prepare inactive destination while capture runs
capture JSON or DOM -> summarize once -> reuse/recover destination
paste and verify -> finish source cue -> activate according to platform policy
save Latest Run receipt and terminal telemetry
```

The extension-toolbar action skips the picker and always uses DOM capture. Its default destination is Claude for a ChatGPT source, otherwise ChatGPT.

After empty-chat admission, destination preparation starts during the picker-to-handoff bridge, overlapping its 190 ms of motion rather than waiting for it. It opens beside the source tab in that tab's current window, with the source as its opener. The worker resolves the browser-supplied sender tab again before creation, including fresh recovery, so focusing another window or moving the source does not redirect the destination. A closed source fails preparation instead of opening in an unrelated window. Tab creation starts navigation; its response is not proof that the page or composer has loaded.

### Capture selection and failure handling

- Speed is default-on in the picker. A saved chat uses fresh JSON; opting out or an unsaved chat uses DOM. The opt-out lasts for the current page instance and survives picker reopening, but resets on reload/reinjection.
- An empty unsaved chat fails before handoff, capture or destination preparation. An unsaved chat with rendered turns can use DOM. Saved JSON chats may be captured before their native history mounts.
- JSON failure announces `Fast capture failed. Using normal capture instead.` and runs DOM preparation/sweep once within the same attempt and prepared destination. Navigation, identity or session cancellation aborts instead of capturing a different chat. Only the completed capture is submitted for summarization.
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

All five use verified retries and editor-remount recovery. Prepared-tab reuse and activation require a platform's new-chat landing route, never a saved conversation. Content delivery independently rejects existing conversation turns and pins the route when the composer mounts; navigation cancels insertion/recovery even after an away-and-back change. Initial landing redirects are allowed before that pin. Click/focus may replace a startup composer: reacquire it before writing and recheck identity/text after final focus. Preserve any draft restored in its replacement. A missing, navigated or failed prepared tab gets at most one fresh destination. Exhaustion offers one manual-copy fallback when a carry exists. Report clipboard success only after an actual successful copy.

Focused delivery activates once before paste and does not activate again after verification; the user can switch away without being pulled back. Activation failure is reported, and a focus-required composer cannot receive an insertion after failed activation. A noninteractive, live-announced destination cue says `Adding your context…`, then confirms verified insertion or directs the user back to source recovery. It never blocks composer controls or sends the message, and teardown removes it.

Source summary completion fills its line immediately; there is no one-second cosmetic hold for local or remote carries. The paste stage remains active before focused insertion and becomes complete only after verified inactive insertion. Visible source completion waits for two animation frames with a 120 ms fallback. Hidden sources skip that wait; hiding during it releases it immediately and cleans up frames/timers/listeners. Suspended painting must not block activation or receipt saving. The timeline includes handoff finish, final activation and transfer completion.

### Deadlines and locks

The page-local `isRunning` lock has one six-minute absolute `deadlineAt`. The same deadline follows capture continuation, summary, destination preparation/activation, paste retries and delayed recovery. Expiry cancels the attempt, records `client_interrupted`, shows a timeout and releases the lock; late work cannot continue that attempt or unlock a newer one.

Picker and toolbar admission share `beginTransferAttempt`. A click while an attempt is running creates no second attempt, telemetry failure or Latest Run receipt. An admitted empty-chat attempt remains visible as `no_conversation` and immediately releases its lock.

| Boundary | Limit | Source |
| --- | --- | --- |
| Whole transfer | 6 minutes | `platform-content.js` transfer trace/lock |
| Generated remote chain | 270 seconds, shared across providers and retries | `api/summarize.js` |
| Vercel summary function | 300 seconds | `vercel.json` |
| Extension summary transport | 320 seconds, reduced to remaining transfer time | `background.js` |
| Source startup messaging | 12 seconds | `background.js` |
| Destination messaging | 30 seconds normally; 45 seconds for ChatGPT | `background.js` destination configuration |
| Destination warmup | 9 seconds normally; 12 seconds for ChatGPT | `background.js` |
| Missing receiver retry | Every 120 ms within the applicable deadline | `sendMessageWhenReady` |

The background may inject `platform-content.js` to repair a missing receiver. Each warmup/delivery loop stops repeating successful injection while the receiver mounts; failed injections can retry, and native navigation installs the manifest script in the next document. Pre/post-injection attempts share deadline and error policy; non-retryable errors stop immediately. MV3 summary work keeps the worker alive every 25 seconds. Backend whitespace heartbeats start after 15 seconds and repeat every 15 seconds; latency measurement must include the complete body, not just those headers/chunks.

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

Each bridge pins the source identity at destination selection and keeps navigation/session cancellation active from readiness through response delivery. Away-and-back navigation still cancels. Concurrent reads fail promptly; timers/listeners are removed on every exit. Extension startup/reload reinstalls hooks on matching already-open tabs. A working, correlated hook probe avoids a worker round-trip; missing/old/replaced hooks get bounded eight-second recovery and must prove actual readiness.

JSON serializers preserve original text, indentation, CRLF and NBSP through capture metrics. The summary boundary still trims outer transcript whitespace. Do not run the DOM cleanup pipeline over JSON strings.

Require complete supported transport and structure: HTTP 200, no `Content-Range`, valid payload, selected-chat identity and a valid active parent chain. Reject detectable partial/truncated/missing history, unfinished captured content and invalid completeness metadata before summary submission. Only typed structural reasons may be exposed; arbitrary fetch/parser/provider errors are masked. These checks cannot independently prove that a server omitted no unmarked, internally consistent content.

### Claude JSON

Files: `claude-fetch-main.js` observes routing and performs fresh reads; `claude-json-capture.js` serializes the active branch.

Routing and lifecycle:

- The hook retains a bounded exact-chat endpoint map across replacement, even after resource timing evicts the route. Late installation can recover routes from resource timing; a 1.5-second wait permits an initial/SPA request to expose a missing endpoint. Other-chat prefetches cannot replace the selected route. Never guess an organization when no matching route exists.
- Rebuild the observed URL with full-tree/message/all-tool/inline-comparison/strong-consistency parameters, removing pagination/window parameters. This asks for full history; it does not make unsupported tool content eligible.
- Current readiness uses hook v4 on channel `cap-context-claude-json-v2`; legacy v1 hooks are isolated. Installation is idempotent and replaces handlers rather than accumulating them. MAIN reports bounded native failure categories, including its own 15-second timeout, without returning upstream/parser error text.
- Navigation API changes and `popstate` cancel setup, fetching and response delivery. Recheck chat path/identity after parsing. Refresh is a recovery option when neither a route history nor a matching request exists.

Included content:

- Follow `current_leaf_message_uuid` through human/assistant parents to null or a recognized root marker. Accept both the all-zero UUID and `00000000-0000-4000-8000-000000000000`; malformed or false-like roots fail.
- Extract direct `text` and `thinking` block strings. Use legacy `message.text` only when structured content is absent/empty, never in addition to structured blocks. Skip empty turns; fail if the whole active branch has no supported text.
- Preserve each original block/legacy string, including its leading indentation and trailing whitespace. Trim only for emptiness and pasted-card matching; translate inline-card matches back to original block offsets before restoration.
- Human `message.attachments` qualify as pasted cards only for `file_type: "txt"`, empty `file_name`, and nonempty string `extracted_content`. Named uploads and other types remain excluded. Missing recognized pasted text fails; supplied `file_size` must match the untrimmed extracted UTF-8 byte count.
- Preserve cards in their owning turn, including pasted-only turns. Deduplicate repeated attachment IDs within that turn only. Distinct identical/overlapping cards remain distinct. One complete matching inline paragraph may represent one card with restored original whitespace; a substring of the prompt is not a duplicate.

Excluded content and completeness:

- Skip tools/results, search snippets, files, artifacts, images, sync sources and unsupported blocks without recursively searching their payloads. Filtering unsupported material is intentional, not a capture failure by itself.
- Check conversation/page/pagination metadata, active own-turn messages, captured direct blocks and recognized pasted attachments. Further-page cursors, advertised counts exceeding returned messages, unfinished own turns/blocks and malformed captured content fail. Do not apply these checks recursively to skipped tools/files.
- Empty hidden thinking with `truncated: true` is normal observed Claude metadata and stays skipped.
- Successful capture is labelled `claude-json` in Latest Run. Browser MAIN/Navigation API support and current native schema remain live compatibility boundaries; the DOM route remains available.

### ChatGPT JSON

Files: `chatgpt-fetch-main.js` owns fresh native/session/paste reads; `chatgpt-json-capture.js` serializes the selected tree and supported document text.

Auth and lifecycle:

- Current readiness probes the v5 MAIN hook on `cap-context-chatgpt-json-v2`. The hook responds only while it owns the current fetch wrapper. Replacement retains page-memory auth, and same-chat project path aliases remain valid.
- Observe only allowlisted auth/account headers on same-origin `/backend-api/` requests. Auth is session/account scoped: cached sidebar/project navigation need not emit a new conversation-specific request.
- Explicit capture fetches fresh `GET /backend-api/conversation/{id}` with browser cookies and the latest observed headers, without pagination parameters. Late installation obtains `accessToken` and account ID from `/api/auth/session` only during explicit capture.
- One HTTP 401 retry is shared across tree and paste-descriptor reads. Prefer newer same-workspace observed auth, otherwise refresh the session once; recheck navigation/account cancellation before retrying. Do not retry HTTP 403 or partial history, or redirect to a guessed workspace.
- Tokens, session data and headers stay in MAIN memory and never enter bridge payloads, logs, storage or the summary backend. Account changes cancel capture. Signed paste-content reads carry no bearer headers.

Tree and text rules:

- Follow `mapping` from `current_node` to a null-parent root. Reject missing/malformed nodes/messages, mismatched IDs, invalid roots, cycles, previous/next/missing/partial/truncated indicators, malformed completeness metadata and advertised totals exceeding the returned tree.
- Reject in-progress/failed turns and active nonterminal assistant nodes with `end_turn: false`. A terminal `finished_partial` generation may retain its useful text when its own completeness metadata passes; stopped generation is distinct from partially loaded history.
- Include own user/assistant string parts, immediate multimodal `audio_transcription.text`, direct `code.text` and `thinking`, `reasoning_recap.content`, and `thoughts[].content` (or the visible own summary when bodies are empty). Full thought bodies take precedence over duplicate summaries/chunks. Voice transcription must be a complete string with passing metadata checks.
- Keep modern editable `:::writing` documents, which are already direct assistant text. Repeated content in separate turns remains repeated. This path does not depend on DOM message count or run DOM scrolling/pasted-card preparation.

Large pasted cards:

- Only active, visible user-turn `metadata.attachments` with `is_big_paste: true` and `mime_type: "text/plain"` qualify, including turns with empty `content.parts`.
- MAIN obtains the native authenticated `/backend-api/files/download/{id}` descriptor, then reads its signed same-origin `/backend-api/estuary/content?id={id}` URL without bearer headers or redirects. Require HTTP 200 plain text, valid UTF-8, no `Content-Range`, and matching descriptor/attachment/download byte counts within the shared read/time budget.
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

Shared bounds: 25 seconds and 6 MB of raw-read data. Reject non-200/ranged transport, malformed/incomplete history, zero supported text and oversized transcripts. The raw-size guard uses the character-limit error. Preserve original JSON strings through metrics. The bridge receives validated transcript and turn count, not raw JSON, auth, CSRF tokens or signed addresses.

| Adapter | Native read and selected branch | Required content/completeness rules |
| --- | --- | --- |
| Gemini | `hNvQHb` batchexecute RPC; ten turns per page, opaque cursor until null | Complete framed envelopes and final RPC marker; unique chat/turn IDs; uninterrupted linkage to a null root; selected response candidate. Native pages arrive newest-first; serialize oldest user/assistant pairs first. Preserve direct user and selected response strings, including code/documents; exclude presentation blocks, other candidates and nested tools. Assistant index 9 is optional, not an authoritative completeness guarantee. Nonadvancing pagination or missing roots/parents/candidates fails. |
| Grok | Fresh `response-node`, then bounded `load-responses` batches | Use native URL `rid`, otherwise require one unambiguous leaf. Only the first human node may link to an external synthetic root absent from the tree. Every other parent/body must match ID/role/parent. Preserve own human/assistant `message` strings; skip control turns and tools/search. Preserve explicit human `fileAttachmentsMetadata.fileName` labels. Blank human text with nonempty `fileAttachments` / `fileAttachmentsMetadata` still fails visibly; this adapter does not fetch attachment bodies. Pending/partial/error flags, missing bodies and ambiguous branches fail. Pin both chat and `rid`. |
| DeepSeek | Fresh authenticated `history_messages`, omitting native device/cache headers | Require `code: 0`, `biz_code: 0`, matching chat and `cache_control: "REPLACE"`; `MERGE` is not full history. Follow numeric `current_message_id` parents to null. Keep user `REQUEST` and assistant `THINK` / `RESPONSE` in order with terminal `FINISHED` and no pending/incomplete/continuing flags. Active `FILE` entries qualify only for the bounded plain-text/Markdown/code/web/structured-text extension list in `textFile`. |

Additional lifecycle and file rules:

- Gemini can recover its observed endpoint/template from resource timing and matching `WIZ_global_data.SNlM0e`. The hook must own both fetch and XHR observation; repair replacement without losing the template or the page's newer network layer.
- Gemini/Grok readiness is v4; DeepSeek is v5. Advance hook readiness versions when adapter/ownership contracts change: old MAIN closures can survive extension reloads. DeepSeek verifies fetch and XHR prototype/open/send/header ownership, retaining observed session auth through replacement. A first late install without any authenticated DeepSeek observation needs a signed-in refresh; do not read arbitrary browser storage for tokens.
- DeepSeek qualifying text files use the original native signed `files.deepseeksvc.com/api/file` address with `ty=r`, without bearer/cookies. Require exact file ID, successful parse status, allowed text/octet-stream response, complete UTF-8 (including any BOM) and matching original bytes. Binary/Office/PDF/images/tool fragments remain excluded. Do not infer new fragment or `incomplete_message` semantics from hypothetical fields.
- DeepSeek wraps every supported file body, including empty files, with its quoted attachment name, verified UTF-8 byte count and named end marker. Original body whitespace is preserved, and later request fragments stay outside that boundary. DeepSeek deduplicates repeated file IDs within their owning turn. Distinct files with identical content, matching authored request text and the same file in later turns remain distinct; downloaded bytes can still be reused by ID during that capture.
- Dedicated Gemini Canvas/Grok Build editor state outside verified conversation strings is not fetched. Successful captures are labelled `gemini-json`, `grok-json` or `deepseek-json`.

Historical schema corroboration is supporting evidence, not a current native-API guarantee: ChatGPT [export types](https://github.com/sanand0/openai-conversations/blob/main/conversation.ts) and [multimodal analysis](https://github.com/jd-d/chatgpt-export-viewer/blob/main/plans/MULTIMODAL.md), the [Grok exporter](https://greasyfork.org/en/scripts/559376-chatgpt-claude-grok-arena-conversation-chat-markdown-export-download/code), and DeepSeek [web-client documentation](https://github.com/pooraddyy/deepseek-free#supported-file-types), [package documentation](https://pypi.org/project/p2d-deepseek/0.2.2/) and [share-schema analysis](https://github.com/HeDaas-Code/fille_repository/blob/main/DeepSeek_Share_API.md#消息对象). Reinspect native state before extending these allowlists.

### DOM preparation and sweep

The supported DOM path runs on all five platforms, including toolbar transfers and the single announced JSON fallback:

1. Reset per-transfer pasted-card state and cached scroll roots.
2. Scroll the actual conversation root to the top instantly; wait for stable turn count, characters, height and scroll position.
3. Expand verified collapsed content and supported pasted cards.
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

Tiny carries are built synchronously in the source content script before any summary-worker message, cache lookup or backend request. The inclusive 1,200-character boundary uses the captured transcript's trimmed JavaScript `String.length` (including platform/role labels), matching backend validation. They use the canonical header, quoted `CONVERSATION SO FAR` and trusted `NEXT STEP`, with no provider work, summary countdown, capture-to-summary animation wait or final one-second summary-line wait. The bounded paint cue remains. Latest Run records source `local`, profile `tiny`, model `local-direct` (displayed as Local carry), zero fetch/provider/token usage, an empty attempted-model chain and no fallback. Capture completeness and destination preparation/paste still apply, so total transfer time also depends on those stages. Older clients calling the backend retain its provider-free tiny path. Exhausted/no configured providers also return the full verified transcript as `local-direct`; this preserves context during outages but does not compress it.

Source-page recovery covers backend HTTP/network/parse failures, empty replies or unavailable worker messaging after verified capture. It uses the same quoted full-transcript format, model `local-direct` and fixed fallback reason `summary_service_unavailable`. It carries no fresh server receipt. Do not conflate it with backend `local-direct`, which can be signed. Capture and size limits still apply.

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
- Retryable calls get at most two attempts, with a 450 ms ordinary retry delay and a 90-second per-attempt ceiling reduced by remaining model time. Timeouts remain active through response-body parsing. HTTP 429 advances immediately.
- Before each funded Gemini/Mistral HTTP attempt, including retries, atomically reserve both IP and global UTC-day allowances in shared Redis. Work units are the serialized UTF-8 provider request bytes plus its maximum output-token allowance (including Gemini reasoning); they bound work, not a dollar invoice. `FUNDED_SUMMARY_IP_DAILY_UNITS` defaults to 2,000,000 and `FUNDED_SUMMARY_GLOBAL_DAILY_UNITS` to 10,000,000; zero disables funded work. Invalid limits, missing Redis settings, exhausted allowances, store errors or a 450 ms store deadline stop funded fallback and return the existing exact `local-direct` carry. Reservations are not refunded after failures/disconnects. Use `KV_REST_API_URL`/`KV_REST_API_TOKEN` or the existing `UPSTASH_REDIS_REST_*` aliases; keys hash IPs and expire after the day. Zero-price OpenRouter calls are exempt. This applies to every caller without adding an extension credential or changing its request/response format.
- Closing an unfinished HTTP response aborts the provider fetch/body read, shared reservation and retry wait, and prevents further retries/fallbacks or a final response. Normal request-body completion does not cancel work. Cancellation cannot reverse charges for work already accepted upstream.
- OpenRouter 401/402 skips the remaining OpenRouter routes because they share credentials/account. Model-specific failures and 429 keep the ordinary order; free-limit availability may be shared across models.
- The first provider returning actual context wins. There is no expansion or semantic retry loop merely because its text is short, imperfectly structured or token-limited.

Provider-specific constraints:

- OpenRouter uses the shared untrusted-transcript envelope, system prompt and OpenRouter/Mistral profile caps. Disable context compression and hidden reasoning; require endpoint support for supplied parameters; enforce zero prompt/completion/request prices and `data_collection: deny`. If no endpoint qualifies, fall through without relaxing policy or using a paid route.
- OpenRouter HTTP-200 error envelopes, errored/filtered choices, invalid JSON, empty/refusal-only text and unfinished thinking blocks fail safely. Never copy separate reasoning fields into the carry. Logs use fixed messages/numeric status, not arbitrary upstream error strings.
- Gemini Flash uses `thinkingLevel: MEDIUM`; Flash-Lite uses `MINIMAL`, with existing generation allowances and hidden-thought filtering.
- Mistral prompt-cache keys use `capcontext-summary-v10-<profile>-<model>`. Prompt changes must consider that namespace.

Receipts preserve the actual served provider/model, attempted chain, token usage and `openrouterMs` / `geminiMs` / `mistralMs`; OpenRouter attempts also populate `openrouterModelsTried`. `Space Bunny 2` changes display text only. Identical concurrent conversations share a background promise; up to eight exact completed results remain in worker memory for two minutes, preserving original provider metadata on cache hits.

### Prompt and output policy

`getSummarySystemPrompt()` and `getContextCarryTemplate()` in `api/summarize.js` define the full prompt. The backend does not read `legacy/SKILL.md`. Providers receive a system prompt and a user JSON envelope with schema `cap-context-conversation-v1`, data type `untrusted-conversation-transcript`.

The requested title is `CONTEXT CARRY — READY TO PASTE`, followed once and in order by WHO I AM, WHAT WE WERE DOING, WHERE WE LEFT OFF, DECISIONS MADE, OPEN QUESTIONS, KEY CONTEXT, NEXT STEP. Shared grounding hints distinguish reported facts, user identity, named owners, accepted choices, proposals/rejections/deferred alternatives and prohibitions. Named owners are not assumed to be the user; observed integrity remains a fact, not a newly invented requirement. Important prohibitions are requested verbatim, with generic grounding examples and a silent constraint/exact-fact check. These are instructions to the model, not semantic verification.

Separate two decisions:

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

Latest Run persistence is optional: synchronous storage exceptions and rejected writes cannot block terminal telemetry or transfer-lock release.

Latest Run records transfer/capture timings, counts, sizes, profile, actual serving/attempted models, fallback/finish reason, token usage, status and exact captured text. It does not store generated summary text. The matched analysis bridge, not the page directly, reads extension storage; both background and bridge strip expired raw text. The serving model is excluded from the failed portion of the fallback log, and cache reuse preserves provider timing/attempt metadata. Current labels cover four configured OpenRouter models, both Google routes, Ministral and local-direct; unsupported paths ask for a new transfer instead of showing retired routes.

Local destination timings distinguish `openMs` (preparation tab API), `pageLoadMs` (navigation start to DOMContentLoaded, not complete SPA hydration) and `composerWaitMs` (delivery start to the first usable composer). Null means unavailable. These fields stay in the local receipt, separate from telemetry, and the analysis paste card shows page/composer timing. Parallel warmup can make delivery-time waiting zero even when earlier page loading took time.

Capture notes retain local-only observed exclusion categories (`uploads`, `media`, `tools`, `artifacts`, `other`) and a bounded JSON-to-DOM fallback reason. Uploaded-file labels are hidden in the displayed notes. They contain no filenames, IDs, URLs or raw errors and are not added to backend requests or telemetry. A fallback reason records the attempt; the notes say normal capture was used only after a capture completed. No recorded exclusions means none were identified by that adapter, not proof that every native/editor-only item was captured; DOM paths and older receipts can leave exclusions unrecorded.

**Copy all details** copies displayed receipt cards/timeline as label/value text, excluding raw chat. It is disabled without a receipt and reports actual clipboard success/failure with accessible status. A selection-based fallback supports clipboard restrictions/local files.

### Payload, proof and serving-model trust

Delivery: `content script -> background outbox -> Vercel /api/telemetry -> Supabase Edge -> record_transfer_event`.

Every layer rejects unknown fields. Allowed payload fields are `install_id`, `attempt_id`, `attempted_at`, `source_platform`, `destination_platform`, `character_count`, `status`, `last_stage`, `failure_reason`, `extension_version`, and optional `completed_at`, `summary_proof`, `summary_confirmed_at`, `model`. Client completion time is accepted for compatibility but not stored.

Statuses are `started`, `succeeded`, `failed`. A succeeded terminal transfer requires stage `completed`; summary verification is independent of paste status.

Stages: `intent_started`, `capture_started`, `capture_completed`, `summary_request_started`, `summary_response_started`, `summary_completed`, `paste_started`, `completed`.

Failure reasons: `no_conversation`, `conversation_too_large`, `capture_failed`, `summary_rate_limited`, `summary_service_busy`, `summary_access_denied`, `summary_failed`, `destination_open_failed`, `paste_failed`, `extension_reloaded`, `client_interrupted`, `user_cancelled`, `unknown_failure`.

| Receipt | Authenticated meaning |
| --- | --- |
| v1 `summaryProof` | Summary work bound to attempt/install IDs, attempt start time, source/destination and extension version; summary completion day unknown |
| v2 `summaryProofV2` + `summaryConfirmedAt` | Adds server summary completion time |
| v3 `summaryProofV3` + `summaryConfirmedAt` + `summaryModel` | Also binds the canonical model that actually served |

The backend returns compatible legacy proofs alongside v3. These camelCase fields belong to the summary response; the worker converts them to the snake_case telemetry fields above. It prefers v3 and persists proof/time/model/authenticated version together through retry/restart. Edge verifies all supported versions and rejects model tampering before SQL. Unsigned reports remain diagnostics, not proof of completed summary work.

A proof authenticates server summary work and the fields listed for its version. It does not attest capture completeness, reported `character_count`, paste outcome or a person's identity. Those require their own capture/delivery evidence; do not treat a verified receipt as end-to-end correctness.

`transfers.model` follows `character_count` and is populated only by verified v3 attribution, including actual fallback models and backend `local-direct`. First attribution is immutable. A v3 receipt may fill a v2 row only at the identical signed completion time; unknown v1 completion times cannot be inferred. Historical/older-client rows, source-local tiny carries/recovery and cross-attempt cache reuse without a fresh server receipt retain NULL. Source-local tiny transfers report unsigned completion metadata and do not increment verified-summary counters. Never fill NULL with the first requested model as a guess.

`record_transfer_event` retains 10–13-argument compatibility; optional fourteenth `p_model` defaults to NULL. Migration `20261003124307_add_served_model_to_transfers.sql` achieved column order with a locked atomic copy/swap that refuses unexpected schema/dependencies and preserves rows, indexes, constraints, triggers and private access without counter replay. Future schema changes must preserve those contracts, not edit applied migration history.

### Outbox and ingress availability

- Queue writes are independent of network delivery. Optional telemetry-storage failures cannot prevent generation or discard a successful summary; unavailable preflight storage omits attribution, and signed-receipt persistence tries session storage when local outbox writes fail. If both stores fail, telemetry may be lost while the summary remains usable.
- Per-attempt compaction keeps monotonic progress, first terminal outcome and the first signed receipt paired with its authenticated version. An in-flight acknowledgement removes only the revision actually sent.
- Permanent malformed/proof/identity failures are removed with bounded diagnostics so later reports drain. Network/429/5xx failures retry with persisted jittered backoff from 30 seconds to one hour; configuration failures start at five minutes. Retry-After is capped at one hour.
- Capacity pruning retains terminal reports/receipts ahead of ordinary progress and diagnoses every drop. Diagnostics contain neither proof bytes nor recoverable rejected payloads. Delivery is best effort, not an audit-complete ledger.
- Edge ingress requires private `TELEMETRY_RELAY_SECRET`; a publishable key is not writer authentication. Matching `TELEMETRY_SIGNING_KEY` values authenticate summary receipts on Vercel/Edge. Fixed errors distinguish permanent, transient and configuration problems.
- Worker delivery deadline: eight seconds; relay upstream deadline: five seconds. Edge body bound: 4 KiB/one second; RPC deadline: four seconds. Upstash budgets are per-install 180/minute and 2,000/hour; per-IP 3,000/minute and 30,000/hour; global 20,000/minute, 60,000/hour and 200,000/day. Redis IDs are keyed hashes with short TTLs. A 450 ms store failure falls back to bounded process-local limits and an enum-only warning. These limits are separate from summary admission limits.

### Database and counters

Project: `cap-context-telemetry` (`iqkzynzxbmemhtiupwwu`). Migrations define expected schema/access; live engine version and deployed migration/function state require a fresh check, not a dated documentation claim. Operational checks, encrypted backups/restores and rollout details are in [supabase/README.md](supabase/README.md).

- `transfers` has one mutable row per `attempt_id`, preserving immutable core identity, first terminal outcome/stage/reason, signed completion and first model attribution. `received_at` is initial receipt time, not a complete progress timeline. Historical failure/progress/completion timestamps deliberately are not retained. Compatible `p_completed_at` is ignored.
- Use `users` for current counters and `transfers` for history; removed reporting views and generated duplicate `id` are not runtime interfaces. Signed summary days can be grouped in Asia/Kolkata. For chronological results, request an explicit `ORDER BY attempted_at`; physical/table-editor row order is not a database guarantee.
- A `started` row means no terminal outcome was received. Never infer failure or backfill verification from it. Extension-local `outcome_unknown` diagnostics are separate. There is no automatic event deletion or retroactive failure/verification backfill.
- Both tables keep RLS enabled without public policies. `anon` / `authenticated` have no table/view/RPC access. Service-role writes have SELECT/INSERT/UPDATE and required sequence/RPC rights, not DELETE/TRUNCATE. Database constraints/guards also protect direct service writes. New application objects owned by `postgres` default private; hosted application migrations cannot change managed `supabase_admin` defaults.
- The original first-observed extension version remains stored, though a later RPC caller may legitimately use an upgraded version. This differs from the authenticated version paired with a proof during worker retries.

User allocation:

- Column order is `install_id`, `user_no`, `name`, `lifetime_summaries`, `today_summaries`, `today_failed_attempts`, then internal `today_date`. Installs are not unique people.
- The first countable verified summary or reported failure creates a row; unsigned successful paste alone does not. The authorized users-only reset retained transfer history. Attempts recorded before its cutoff cannot restore cleared counts, including delayed completions.
- New installs use a short advisory lock and transactional max+1 numbering. Duplicate/rolled-back inserts do not leave visible numbering gaps. Names prefer random unused values from the 40-name predefined Naruto pool; once exhausted, reuse a random pool name. Names are cosmetic and may repeat; `install_id` and `user_no` remain unique identities. User No. 1 additionally permits exact lowercase `naruto`, outside automatic allocation.
- Exhausting the name pool cannot block a counted transfer/counter write. Failure reports/install IDs remain client-supplied diagnostics, not authenticated identities; receipt signing authenticates summary work and rate limits only bound anonymous abuse.

Counter rules:

| Counter | Countable event | Time attribution |
| --- | --- | --- |
| Lifetime summaries | First verified summary, even if paste failed | Once per attempt; independent of transfer success |
| Today's summaries | First verified summary with known signed day | Server signed occurrence time in Asia/Kolkata; delayed earlier-day and unknown-day v1 proofs do not inflate today |
| Today's failed attempts | First received failed terminal outcome, excluding `no_conversation` | Transaction-start calendar day in IST, ignoring client clocks |

Empty/unknown/started activity never creates a counted user failure. Empty-only telemetry is filtered before counter triggers/locks. Current day is sampled with `clock_timestamp()` after existing-user or new-allocation locks; failure occurrence uses stable `transaction_timestamp()`. This prevents a midnight lock wait from restoring yesterday's counters or moving yesterday's failure into today.

Both daily counters reset at 00:00 IST via the existing GMT cron `30 18 * * *`; ingestion resets them if the job is late. Reconciliation preserves lifetime totals and the users-reset cutoff. Keep old RPC defaults, sticky outcomes and signed-day behavior when changing counters.

For telemetry rollout, preserve compatibility across queued receipts: backup/restore and migration dry run -> additive schema -> matching secrets -> Edge -> Vercel -> extension. Keep signing keys valid while seven-day queues may hold old receipts; rotation needs verifier overlap or a drained queue. Roll back code while retaining compatible schema/validators, not by dropping new fields or rewriting migration history.

## Composer UI and paste

### Shared lifecycle and visual ownership

- Each content instance publishes teardown before monitoring. A new `CONTENT_SCRIPT_LOAD_ID` invokes the previous teardown, removes owned runtime/DOM listeners, disconnects observers, cancels timers/frames, restores reservations and removes only owned UI. Same-version duplicate injection is a no-op. Read the current constant in `extension/platform-content.js` rather than copying a stale value here.
- Reuse/move one owned orb across editor remounts. All inline slots use a non-shrinking 36px button with 32px artwork; native control groups may wrap rather than overlap. Preserve native hiding and remove marker attributes on replacement/teardown.
- Validate visible controls belonging to the active editor, excluding hidden copies, other composers and popup/menu/listbox/dialog controls unless the dialog contains the actual composer. A native popover may `aria-hidden` the background without removing it: retain only an already verified, connected, geometrically visible editor. Newly mounted modal/settings editors cannot replace it.
- Document child-list, focus/visibility/resize and SPA monitoring remount the orb. Scoped control mutation observers cover attribute-only visibility/mode/label changes while ignoring ordinary editor character-data. Stable ownership reuses observers; remount/release/teardown replaces or disconnects them.
- Picker ownership includes the editor and native host/rows/anchor wrappers. Replacement, route change or viewport resize closes an inline picker without restoring focus, then remounts. Reset the retained orb's expanded state and active visuals even if its old composer already detached it.

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

- Extension-owned constructed stylesheets protect layout from page CSP. Dark Reader handling uses ignored/scoped styles and priority colors while progress remains state-driven. Teardown removes only extension-owned styles/reservations.
- The picker backdrop has a small opening matched to solid orb artwork so the real composer orb stays sharp/clickable despite native ancestor stacking. It stays in its slot; adjacent composer background remains blurred. The opening tracks scroll/resize and clears when backdrop closing finishes. Do not clone the orb or raise neighboring controls to solve stacking.
- Tab/Shift+Tab skip both composer and header orbs. The custom picker cycle includes enabled destinations and Speed only. Header orb is a pointer link to the website with `noopener noreferrer`; it never starts capture.
- Outside-click/lifecycle dismissal preserves native focus. Explicit keyboard/backdrop dismissal may restore the composer only while focus still belongs to picker/orb. Delayed dismissal cannot steal focus from a reopened picker or another page control.
- Handoff starts at the measured picker position, which stays locked through the picker-to-handoff animation. Progress completes from actual capture/summary/paste events, not decorative motion.
- Summary countdown is display-only: 20 seconds through 60,000 captured characters, rising to 65 seconds at 110,000 and capped there. It starts only after capture size is known and stops when summary is ready. Overrun says `Taking a little longer—still working.`; the line stays at 90% until real completion. The tip pulses during waiting; reduced motion disables movement. Estimates never alter provider budgets.
- Speed's three backward gold trails follow the bolt's sloped left edge in a staggered 420 ms loop; off hides them and reduced motion retains static trails. They are decorative, track `aria-pressed` and reserve header space at narrow widths.
- Orb hover: 14% enlargement over 260 ms, 1px lift and artwork-shaped purple glow; press scale 0.95. Open-picker effect: 8% enlargement, 1px lift and soft glow. Hover must not override picker/handoff state or change toolbar geometry. Dismissal resets active effects independently of focus; the preserved-backdrop handoff bridge retains them until handoff ownership. Reduced motion changes size/lift immediately.
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

| Change | Focused check | Additional evidence when relevant |
| --- | --- | --- |
| DOM capture, pasted cards, placement, picker/handoff, paste | `node --test --test-skip-pattern="^slow/release:" test/platform-content.test.js` | `npm run test:slow` for capture changes; installed Brave smoke for meaningful extension/UI changes |
| Background messages/recovery/cache | `node --test test/background.test.js` | `npm test`; installed smoke if cross-tab behavior changes |
| Prompts/routing/output policy | `node --test test/summarize.test.js test/request-security.test.js`; applicable routing/body-timeout tests | `npm run eval` probes deployed production, so a local prompt change needs a matching test deployment to assess its quality |
| Telemetry/schema/counters | Telemetry delivery/handler/verified-receipt tests; `node scripts/check-verified-telemetry-db.js` | Backup restore/bounded upgrade, hosted grants/proof/counters when changing deployment, installed database smoke |
| Latest Run | `node --test test/analysis.test.js` | Matched GitHub Pages analysis with extension loaded |
| Release/package | `npm test`, `npm run test:slow`, `npm run test:extension-smoke` | Appropriate live evaluation and ZIP hash/resource checks |

Commands and evidence boundaries:

- Provider-specific regressions live in `test/openrouter.test.js`, `test/flash-chain-budget.test.js`, `test/flash-lite-fallback.test.js` and `test/provider-body-timeout.test.js`. Select them when changing those routes or budgets; use `--test-timeout=30000` for focused deterministic runs too.
- `npm test` selects `test/**/*.test.js` with a 30-second hang limit, excluding `slow/release:`. Shared setup lives in `test/helpers/`; the explicit file pattern keeps helpers and data fixtures from running as standalone test files. `npm run test:slow` runs the simulated-time physical-scroll regression with a 60-second limit. Scoped clocks must advance Date/timers together, preserve native response-body reads and clean up leftover timers; do not remove delays/assertions to claim faster validation.
- `npm run test:extension-smoke` uses a disposable Brave profile, unpacked extension, controlled five-platform placement/picker fixtures and a stub backend. Default transfer is ChatGPT -> Claude. It covers exact capture/paste without Send, drafts, 760/390/320px layouts, remounts, free ChatGPT transition slots, Claude Reply-chin transitions, focus and reduced motion. It establishes integration against those fixtures, not current native-account capture completeness or provider quality. Use a separate browser window/profile for live checks too.
- `CAP_CONTEXT_TELEMETRY_SMOKE=1` adds installed-worker -> local relay/Edge -> real migration replay, checking verified count/outbox drain. PGlite is pinned to `0.5.8` in development dependencies/lockfile; `PGLITE_MODULE_PATH` remains an optional external-module override. The application still has no runtime npm dependency.
- `npm run eval` sends requests to the deployed production endpoint, consuming provider quota. Each case allows one retry for quality/transient/malformed-JSON failure; a second failure still fails. Both attempts retain quality/error/latency/model/token metadata, with a warning on recovery. Case and evaluation totals include failed requests, body reads and retry delays. All cases are evaluated even if an earlier endpoint fails. Optional `EVAL_REPORT_PATH` saves the report without chat/summary text; absent token usage stays unknown. Curated English contradiction patterns reject denial of critical fixture facts even when their required phrases are present. These checks and structural scores cannot establish general semantic grounding.
- `npm run gate` is entirely offline: deterministic tests + slow capture + `npm run test:db` migration replay + installed Brave smoke. Run `npm ci` first and install Brave; live evaluation remains the separate, explicit `npm run eval` command.
- `CAP_CONTEXT_SMOKE_ARTIFACT_DIR` saves screenshots and bounded console/browser diagnostics when a browser fixture fails. Placement tabs are captured before closing; disconnected pages and artifact failures preserve the original assertion. CI also saves each browser command's complete log and uploads failure artifacts for seven days. Screenshots are only captured on failure, from isolated synthetic fixtures.

JSON smoke modes (run with `npm run test:extension-smoke`):

| Source | Focused tests | `CAP_CONTEXT_JSON_SMOKE` |
| --- | --- | --- |
| Claude | `node --test test/claude-json-capture.test.js` | `1` |
| ChatGPT | `node --test test/chatgpt-json-capture.test.js test/background.test.js` | `chatgpt` |
| Gemini / Grok / DeepSeek | `node --test test/network-json-capture.test.js test/background.test.js` | `gemini` / `grok` / `deepseek` |

Optional scenarios: `CAP_CONTEXT_CLAUDE_RELOAD_SMOKE=1`, `CAP_CONTEXT_CLAUDE_PARTIAL_SMOKE=1`, `CAP_CONTEXT_CHATGPT_RELOAD_SMOKE=1`, `CAP_CONTEXT_CHATGPT_AUTH_SMOKE=paste401`, `CAP_CONTEXT_CHATGPT_FAILURE_SMOKE=partial|streaming|ranged`, `CAP_CONTEXT_NETWORK_FAILURE_SMOKE=partial` or Grok's `file-only`. Clear scenario environment variables before a normal success run. Fixtures cover history absent from DOM, auth/identity recovery, pasted/doc text, announced fallback and exact backend/paste behavior.

CI in `.github/workflows/regression-gate.yml` separates three kinds of evidence:

- Pushes to `master` / `codex/**`, PRs into `master` and manual dispatch run **Offline checks** on Node 22 / Ubuntu 24.04: locked/cached npm development dependencies, deterministic + slow capture, real migration replay and three sequential Brave fixture cases under Xvfb. The DOM case owns the full placement suite and local relay/Edge/database telemetry path; focused ChatGPT fast capture exercises extension reload, and Claude partial JSON exercises announced DOM fallback without repeating unrelated layout checks. These representative cases add no AI requests. One checkout/runtime setup and one eight-minute job own cancellation of superseded-ref work; database and each browser step retain five/three-minute limits. Bash pipe failure propagation keeps logged browser failures red. Repository permissions are read-only. This job is the required status check for master integration.
- Daily 06:17 UTC (11:47 IST) schedule runs **Live production summary check**, not branch code validation. Manual `evaluate_production` can add it, default off. It is serialized, has a 25-minute allowance for bounded case retries, and uses deployed production's accuracy/structure/contradiction/latency thresholds. Attempt-level reports, including available token usage, are retained as a 14-day Actions artifact.
- A failed live check remains a real failure but does not establish that the checked-out code regressed, or gate automatic Pages/Vercel deployment. Green offline checks do not establish deployed provider quality. Branch workflow edits affect scheduled/default behavior only after landing on `master`. Master protection requires the GitHub Actions **Offline checks** result before accepting integration, including administrator pushes.

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
