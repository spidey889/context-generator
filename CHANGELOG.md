# Changelog

- 2026-09-28: Verified the Grok read-only hypotheses against the full JSON flow. Reproduced and fixed wrong-chat/wrong-branch handoff, away-and-back navigation gaps during readiness/queued response delivery, and source NBSP/code whitespace rewriting through DOM cleanup. The picker now pins the full source URL including `rid`; bridge listeners latch both identities; Grok JSON bypasses DOM cleanup at capture metrics. File-only human turns with known attachment ID/metadata arrays now fail visibly instead of disappearing while their answers transfer; attachment bodies remain unsupported. Grok v2 readiness replaces older MAIN adapter closures. Empty/control-turn loss and unmarked tree pagination were not established and remain unchanged. Four focused regressions cover these fixes and hook replacement; initial targeted reproductions failed before changes. All 54 focused checks, 336 main-suite tests and the one slow/release test passed (337 total). Isolated Brave verified the exact 48-turn code/whitespace transcript, exact stub-summary paste/no Send, incomplete-history refusal and file-only refusal with zero backend submissions. The Grok-only smoke now skips unrelated Claude geometry after that check blocked one run; production DOM behavior is unchanged. Attachment shapes were corroborated against published exporter source; no fresh signed-in native-account inspection or production model call was made. LOGIC.md and docs/debugging/grok-json-audit.md record behavior, evidence and deferred hypotheses.

- 2026-09-28: Verified DeepSeek read-only findings as hypotheses. Reproduced and fixed wrong-chat capture during handoff, away-and-back gaps during readiness/queued response delivery, and loss of legitimate original code/data uploads through the five-extension whitelist. Also reproduced source NBSP rewriting at the metrics boundary and preserved DeepSeek JSON strings there. Destination-click identity and bridge navigation are now pinned; v2 readiness replaces older MAIN adapter closures while retaining auth; supported plain-text/source/config/data extensions retain signed URL, ID, MIME, UTF-8, original byte-count and size checks. Unknown role/fragment loss was not confirmed for normal current use, and complete `incomplete_message: false` values were not established; their existing handling remains. No pagination, attachment-timeout, signed-URL drift, other-source, DOM, summary, destination or toggle changes. Initial targeted tests failed before fixes; four new regressions cover routing, uploads, transfer whitespace and old-hook recovery. All 50 focused checks, 332 main-suite tests and one slow/release test passed (333 total). Isolated Brave verified the exact 48-turn `.py` upload/whitespace transcript, exact stub-summary paste/no Send, and visible incomplete-history rejection with zero backend requests. No fresh signed-in native-account inspection or production model call was made. Updated LOGIC.md and recorded evidence and deferred hypotheses in docs/debugging/deepseek-json-audit.md.

- 2026-09-28: Short Gemini-only JSON audit fixed three confirmed groups: wrong-chat handoff/navigation gaps, stale fetch/XHR observers falsely answering readiness, and DOM cleanup rewriting original code/paste whitespace. Gemini now pins destination-click identity, latches navigation through setup/response delivery, and verifies v2 hook ownership of both fetch and XHR before capture; its JSON metrics boundary preserves source strings. Added three focused regression tests (all failed before fixes) and Gemini-only whitespace fixtures shared with the Brave smoke. Inspected routing/session observation, framed paging, selected candidates, ordering, transport, installation, bridge and transfer consumers without expanding into Canvas internals or theoretical completeness. Other source behavior, DOM capture, summarization, destination and toggles remain unchanged. All 46 focused tests, 328 main-suite tests and the one slow/release test passed (329 total). Isolated Brave verified the exact 48-turn Gemini transcript, original whitespace, exact stub-summary paste/no Send, and visible incomplete-history rejection with zero backend requests. Browser evidence used fixtures; no fresh native-account inspection or production model call was made.

- 2026-09-28: Short test-suite cleanup removed three redundant cases: the Gemini Pro placement fixture duplicated the retained Flash geometry test (selection is label-independent, with a separate non-English regression retained); an obsolete Mistral 20k threshold helper check duplicated retained small/medium/350k backend routing and environment-override coverage; standalone footer stripping duplicated the summary-normalization path. The retained normalization test now checks both legacy footer lines. Removed two unused test imports; production code and test architecture are unchanged. All 325 main-suite tests and the one slow/release test passed, for 326 total tests.

- 2026-09-28: Audited only ChatGPT network JSON capture and fixed eight failure groups: wrong-chat handoff, navigation gaps during readiness/response delivery, obsolete fetch-hook readiness, lost/duplicated big-paste cards, rewritten source whitespace, dropped voice transcription parts, stale paste authentication, and false streaming refusal for stopped responses. v5 readiness verifies current fetch ownership; the picker pins chat identity; bridge navigation is latched throughout capture; authenticated reads share one bounded 401 retry; attachment identity and complete inline ranges preserve distinct cards. ChatGPT JSON bypasses DOM text cleanup, and explicit own voice transcription parts retain their text. Added 17 regressions (54 ChatGPT tests); initial targeted cases failed before their fixes. All 71 focused tests, 328 full-suite tests and the existing slow/release test passed. Isolated Brave verified reload without page refresh, session recovery, paste-descriptor 401 recovery, exact ordered 127-turn backend text and exact stub-summary paste/no Send; partial, streaming and ranged histories failed visibly with zero backend submissions. Voice shape was checked against primary export schema evidence; no fresh signed-in native ChatGPT inspection or production model call was made. Updated LOGIC.md and added docs/debugging/chatgpt-json-audit.md with root causes, coverage, rerun instructions and limits. Other source behavior, DOM capture, summarization, destination and toggles remain unchanged.

- 2026-09-28: Audited only Claude network JSON capture and fixed seven failure groups: rendered-history gating, false hook-readiness timeouts, wrong-chat capture during handoff/setup, navigation away-and-back during response delivery, lost routes after hook replacement, distinct pasted-card loss through substring deduplication, and trimmed pasted indentation/outer whitespace. Claude JSON now pins the destination-click chat, verifies the v3 MAIN hook directly with bounded recovery, carries forward known route URLs, and preserves original pasted strings with attachment identity and one-to-one inline range matching. Existing completeness/branch/size checks and other source/DOM/summary/destination/toggle behavior remain. Expanded Claude regressions to 44 tests; the initial expanded 43-test file failed 13 checks against pre-fix source. All 311 deterministic tests and the 78-turn slow/release test passed. Isolated Brave checks passed for ordinary transfer, API-only Claude JSON history, extension reload without page refresh, exact ordered paste/no Send, and incomplete-response rejection before backend submission. Browser evidence uses fixtures and a stub backend, not a fresh native Claude schema inspection or production model call. Added `docs/debugging/claude-json-audit.md` with root causes, audit method, exclusions, and the remaining server-completeness limitation for future source audits.

- 2026-09-28: Added a narrow handoff stylesheet fallback for strict page CSP, addressing Grok's plain inline stage numbers/labels. It adopts the existing handoff CSS only when the style tag is blocked and removes it on teardown; the design and transfer behavior are unchanged. Browser checks and tests skipped at the owner's request; syntax and diff checks only.

- 2026-09-28: Added default-off network capture for Gemini, Grok and DeepSeek alongside their existing DOM paths. Native inspection established Gemini's framed/paginated XHR RPC and selected candidates, Grok's response tree/body requests and synthetic root, and DeepSeek's full REPLACE snapshots, own fragments and signed plain-text uploads. Both Gemini and DeepSeek use native XHR; outgoing URL/body/header observation prevents a fetch-only DeepSeek auth miss. Adapters preserve complete own text, long pasted/code/document strings and supported DeepSeek text uploads in chronological user/assistant order; detected gaps, deltas, incomplete frames/bodies, unfinished turns and partial transport fail visibly. Session/routing envelopes stay in MAIN, the bridge receives only validated transcript/count, and navigation/session changes cancel reads. Existing Claude/ChatGPT capture modules, summarization and destination behavior are unchanged. Added focused format/lifecycle/completeness regressions and per-source installed-Brave success/failure tests against a stub backend, including exact ordered text and no Send click. The full suite passed 297 tests; final focused rechecks passed 43 after XHR and private-error hardening. Live capture-only comparisons matched Gemini's six-turn 36,369-character history, Grok's four-turn history and 37,887-character original user paste, and DeepSeek's 17,076-character history including all 3,318 original uploaded text bytes. A native DeepSeek sidebar navigation also automatically recovered auth and captured a 14,100-character chat with an 11,661-character user paste. Dedicated editor state outside conversation strings remains unsupported; a native Gemini Canvas generation attempt failed before a usable document was created.

- 2026-09-28: Fixed ChatGPT JSON dropping attachment-only user pastes, which made the owner's captured conversation start with the assistant. Live inspection found empty user `text.parts` plus `is_big_paste: true` / `text/plain` metadata and verified the native descriptor/content download routes. Capture now retrieves only active visible user big pastes, checks complete UTF-8 byte counts, and attaches the original text to the correct user turn before assistant content. Ordinary uploads, tool text, images and inactive branches remain excluded. Unreadable or partial pastes fail visibly; auth and signed download URLs stay in MAIN, and v4 readiness upgrades older hooks before capture. Added ordering, multiple-paste, exclusions, incomplete transport, size, navigation and hook-upgrade regressions. A capture-only check of the real chat matched the expected 27,040-character transcript exactly, including all 13,530 original user bytes; no production summary request was sent. All 270 tests and the isolated Brave JSON transfer smoke passed, with an exact ordered backend transcript containing the attachment-only first user turn. Corrected a download-URL variable typo in the new smoke fixture before its successful run.

- 2026-09-28: ChatGPT JSON capture now preserves legacy canvas document bodies and authored edit/rewrite text in their assistant turns. Live conversation JSON established the narrow canmore create/update fields and successful acknowledgement markers; operation wrappers, tool replies, patterns, uploaded files and unrelated tool text remain excluded. The owner's new editable writing-block example already stores its complete document directly in assistant text, including its beginning/middle/end markers; added regression coverage for that format too. Editor-only state outside conversation messages is not reconstructed or fetched. Added long document, rewrite/partial edit, ownership, exclusion, malformed-content and size-limit regressions, plus exact canvas-text assertions in the isolated ChatGPT Brave transfer smoke. All 263 tests and that smoke passed using a stub backend with no production model calls. Claude, DOM capture, toggles and summarization are unchanged.

- 2026-09-28: Fixed a reproducible false ChatGPT JSON setup timeout: a working MAIN hook was blocked by an unanswered worker reinstall request after three seconds. Capture now checks the live v3 hook directly and only requests installation when needed, with bounded eight-second recovery that accepts actual hook readiness independently of a delayed worker callback. Added installed-hook/stalled-worker, delayed installation, invalid readiness replies, missing-hook cleanup and navigation-during-setup regressions. Full-tree validation, DOM capture and other platforms are unchanged. All 257 tests and the isolated Brave ChatGPT extension-reload/late-hook/session-recovery transfer smoke passed.

- 2026-09-28: Extended the destination picker's Dark Reader palette protection to the handoff, its progress states, and status/error notifications. Preserved the existing colors with an ignored, scoped stylesheet generated from static inline styles, and protected the handoff's state-driven stylesheet. No capture or transfer behavior changed. Tests and browser checks were skipped at the owner's request; static syntax and diff checks only.

- 2026-09-28: Completed the default-off ChatGPT JSON experiment with session/account auth reuse, on-demand late-install/session recovery, one expired-token retry, startup/on-demand MAIN readiness, idempotent replacement, account/navigation cancellation, and prompt concurrent-request failures. Full-tree validation now rejects partial/ranged transport, incomplete metadata, malformed active branches and unfinished turns. Own recap/thought/code fields and full pasted strings are preserved; tools/files/images/canvas remain excluded. JSON capture no longer depends on virtualized DOM mounting. Added long-tree nonce-CSP Brave transfer, reload/session-recovery, and visible partial/streaming/ranged failure scenarios; kept DOM capture, Claude, other platforms, summarization and destination behavior intact.

- 2026-09-27: Made fast capture icon-only at rest: only the lightning turns yellow when enabled; the subtle box appears on hover. Keyboard focus remains visible.

- 2026-09-27: Changed the enabled fast-capture lightning button to yellow, with subtle matching background and border accents. Toggle behavior is unchanged.

- 2026-09-27: Hardened Claude JSON hook lifecycle: reinstall MAIN/bridge scripts on existing Claude tabs, ensure MAIN readiness before explicit capture, recover exact-chat routing from resource timing, and keep bounded per-chat endpoints instead of a single prefetch-sensitive URL. Added idempotent hook replacement, a bounded initial-load routing wait, prompt concurrent-request rejection, navigation cancellation, and fixed private-error masking. Default DOM capture, picker behavior, ChatGPT and summarization remain unchanged. Added lifecycle and background installation regressions.

- 2026-09-27: Hardened Claude-only JSON completeness: always request the native full tree, reject partial/ranged HTTP JSON, explicit incomplete/pagination/count signals, invalid active-branch root markers, truncated or unfinished captured text, and missing/size-mismatched pasted text. Live inspection distinguished normal empty hidden-thinking `truncated: true` metadata from truncated captured text. Added regressions without changing DOM capture, ChatGPT, the picker, or summarization; documented the absence of an authoritative server completeness guarantee.

- 2026-09-27: Polished the fast-capture button with an outlined vector lightning icon, compact placement in the picker header, subtle neutral/lilac states, and keyboard-focus feedback. Capture behavior is unchanged.

- 2026-09-27: Claude JSON capture now includes complete `extracted_content` from human-turn pasted cards, identified in live JSON as unnamed `txt` attachments. Named uploads and other attachment/file/tool types remain ignored. Pasted text stays in its owning user turn, avoids duplicate inclusion within that turn, and counts toward the existing size limit. Added focused regressions and a Claude-only large-paste backend assertion to the isolated Brave JSON smoke.

- 2026-09-27: Replaced Claude and ChatGPT's experimental JSON toggle wording with an icon-only ⚡ fast-capture button, retaining default-off behavior and adding a highlighted enabled state, tooltip, and accessible label.

- 2026-09-27: Added ChatGPT source JSON capture on `codex/chatgpt-json-capture`, branched from the Claude experiment. The default-off picker toggle uses an early MAIN-world fetch hook, in-page auth reuse, a fresh full-tree conversation request, and `current_node` branch traversal. Explicit missing/previous-page/incomplete indicators and broken active branches fail before backend submission. Only own user/assistant text/thinking strings are retained; tools/files/images/artifacts are skipped. Added focused regressions and a nonce-CSP Brave smoke mode for the authenticated full-tree-to-backend-to-paste path.

- 2026-09-27: Replaced Claude JSON's per-type rejection and bash-pair exception with own-turn text extraction: only direct user/assistant `text` and `thinking` blocks are included. Tools of every kind, nested tool text/search snippets, files, attachments, images, artifacts, and sync sources are ignored. Empty turns are skipped; content filtering fails only for a wholly empty transcript. Branch/identity and transport checks remain. Replaced obsolete rejection tests with extraction-boundary and whole-conversation-empty regressions.

- 2026-09-27: Added a narrow Claude JSON exception for uniquely matched `bash_tool` call/result pairs within a message, preserving surrounding text and dropping command/output payloads. Other tools and unmatched/ambiguous bash pairs still fail. Added regressions for bash pairing and continued web-search/memory rejection; updated architecture notes to reflect the previously added image-file exception.

- 2026-09-27: Made Claude JSON validation failures identify the first blocking field or content type and its active-branch message/block position, without including message text, filenames, or tool payloads. Capture acceptance rules remain unchanged. Documented the previously added support for Claude's actual root-parent marker.

- 2026-09-27: Allowed Claude JSON capture to skip `image` content blocks while retaining surrounding text. All other unsupported-content and empty-message checks remain unchanged; regressions cover mixed image/text and images alongside tools, artifacts, files, and sync sources.

- 2026-09-27: Added the opt-in Claude JSON capture experiment on `codex/claude-json-capture`. A MAIN-world fetch wrapper remembers only the endpoint; a destination-picker toggle triggers a fresh cookie-authenticated read and active-branch transcript conversion through the existing summary/paste pipeline. DOM capture remains the default. The initial text/pasted-text scope rejects tools, uploaded files, incomplete branches, and truncation rather than silently omitting them. Added bridge/serializer regressions and an isolated Brave JSON smoke mode; repaired the smoke fixture's content-script selection after adding manifest entries and its generated-script newline escaping.

- 2026-09-27: Moved the archived homepage, social preview image, and standalone skill into legacy/, updated the archived page asset links, and removed both checked-in extension ZIPs. Local installation now uses the unpacked xtension/ folder.

- 2026-09-27: Prevented Dark Reader from recoloring the website by adding its official static page lock to the public HTML pages. The homepage also declares its intended light color scheme, so GitHub Pages matches the local design without requiring visitors to change extension settings.

- 2026-09-27: Tightened the transition from the homepage actions to the product diagram, reducing the empty band below the hero while preserving the requested internal hero spacing and leaving the diagram unchanged.

- 2026-09-27: Changed the hero support line to `Install once and continue anywhere.`, restored its lighter original styling, and increased its spacing below the headline.

- 2026-09-27: Simplified the extension homepage hero after visual review. Removed the added eyebrow pill, long explanatory paragraph, and five-platform row; replaced them with `One click. Full context. Keep going.` Restored the install CTA to black, made Privacy details a solid high-contrast secondary action, and aligned the header privacy link with the install button. The diagram and video section remain unchanged.

- 2026-09-27: Updated the restored homepage header and hero for the browser extension: Chrome Web Store install links replace skill-copy/download actions, privacy links use the rendered policy, and the hero now describes conversation transfers across all five supported AI platforms. Tightened spacing and introduced a purple primary button while retaining the headline and slow shimmer. The diagram and lower skill/video sections remain unchanged by owner request. Desktop and mobile checks passed in isolated Brave.

- 2026-09-27: Restored the older landing page as the main website by swapping index.html with index.legacy-2026-07-15.html. The legacy filename now preserves the replaced newer design; the main page retains its original skill download and demo video.

- 2026-09-26: Removed the Cap Context orb from normal page Tab order so keyboard navigation reaches the native composer without stopping on the extension button. The destination picker's intentional tile cycling and programmatic focus restoration remain unchanged.

- 2026-09-25: Fixed Dark Reader washing out the destination picker on ChatGPT. Protected the existing palette with an ignored picker stylesheet, scoped fallback colors, and priority-preserving hover/selection styles. A new Brave window showed matching computed picker colors on ChatGPT with Dark Reader active and Grok without it; the isolated extension smoke runner was blocked by a GPU process crash.

- 2026-09-25: Fixed two failing placement tests by giving the fake DOM element `querySelector` and making the inner-wrapper fixture return only nodes matching its composer selectors. The production extension is unchanged. The full test suite and isolated Brave extension smoke passed; live Gemini, Grok, and DeepSeek placement was not checked.

- 2026-09-25: Pruned four low-signal tests that only matched handoff animation/microcopy or Latest Run receipt wording in source text. Kept behavioral coverage and source checks that guard transfer safety, privacy, and paste recovery.

- 2026-09-25: Prepared extension source version 1.4.6 and a versioned, file-compared ZIP for the summary paste fix. The direct-download link now points to that archive; this does not establish a Chrome Web Store update or a live browser verification.

- 2026-09-25: Hardened summary pasting after production telemetry recorded failures at the paste stage. Paste discovery now skips disabled/read-only editors when another writable composer is available, retains a verified composer through temporary disabled native-overlay states, and retries after an editor remount. Verification now requires summary content from the beginning, middle, and end while tolerating punctuation and line-break changes, preventing partial inserts from being reported as complete. Advanced the content-script load identity so the updated paste logic replaces an older instance on open tabs when reinjected.

- 2026-09-20: Added a Grok-only adaptive capture profile: shorter normal stability polling, overlap-proven 70%/90% viewport advances, and a delayed-render guard that waits only when a physical scroll has not produced a new virtualized window. Claude, ChatGPT, Gemini, and DeepSeek retain their existing capture timing. Focused regression coverage proves complete 40-turn fast capture and complete 24-turn capture when Grok renders each window 140 ms late.

- 2026-09-18: Resumed Ministral 3 14B after the owner confirmed Flash-Lite handled a large conversation. Production `MISTRAL_ENABLED=true` restores Flash 3.6 -> Mistral -> Flash-Lite without changing 90-second budgets or the other provider pauses.

- 2026-09-18: Added the approved one-time apology notice for one privately configured install, with atomic server claiming, local duplicate protection, near-orb placement, OK/30-second dismissal, and durable acknowledgement retry. Added a small Redis receipt tracker distinguishing claim, display, OK, and timeout. Bumped extension to 1.4.5; existing users need that update before delivery. Automated tests were intentionally deferred at the owner's request.

- 2026-09-18: Added a standalone apology-notice preview near a mock AI composer orb, with human wording, OK dismissal, and a 30-second timeout. This is for design approval only; no targeted message or production delivery feature has been activated.

- 2026-09-18: Added `MISTRAL_ENABLED=false` as a reversible production pause for testing Flash-Lite after Flash 3.6. Mistral's key, route, and 90-second budget remain; remove the variable or set it to `true` and redeploy to resume.

- 2026-09-18: Switched the primary Google model from Flash 3.8 to Flash 3.6 at the owner's request. Retained Flash 3.8 in the paused fallback list; the active Mistral/Flash-Lite order, daily health handling, and 90-second budgets are unchanged.

- 2026-09-18: Confirmed Fluid Compute is enabled on Hobby and raised server/client limits to 300/320 seconds. Replaced the short four-Flash attempts with three active 90-second routes: Flash 3.8, Ministral 14B, and Flash-Lite. Paused other Flash models and Groq behind reversible switches; Orca remains paused. Re-enabling Orca/Groq consumes the terminal allowance rather than increasing total remote time beyond 270 seconds.

- 2026-09-18: Reserved time for each remaining Gemini Flash model within the existing 60-second family deadline so slow 3.8/3.7 attempts cannot consume the entire allowance before 3.6/3.5. Retained daily health skips and the overall provider timeout.

- 2026-09-18: Replaced the terminal Google Gemma 4 31B attempt with stable Gemini 3.5 Flash-Lite after the owner verified Gemma had only 16k input tokens/minute, while Flash-Lite showed 250k on the same project. Retained the existing Google key, minimal thinking, timeout allowance, relaxed output handling, and Orca pause switch. Gemma is no longer in the active chain.

- 2026-09-18: Paused OrcaRouter by default while retaining its key and route behind `ORCAROUTER_ENABLED=true`. Added Google Gemma 4 31B via the existing Google key as the final remote attempt after Groq and before full-transcript local carry, with minimal thinking and a 60-second allowance shared with Orca when unpaused. Documented restoration in `docs/provider-fallbacks.md`.

- 2026-09-18: Temporarily made generated-summary validation advisory so non-empty provider output is delivered even when the requested header, seven-section structure, or quality checks fail. Valid output keeps canonical normalization; imperfect text is preserved with the destination-confirmation instruction appended. Empty output and service failures still fall back. Retained the strict validator and documented restoration in `docs/summary-validation.md`.

- 2026-09-13: Added explicit content-script instance teardown for reinjection. A new version now retires the previous instance before startup by removing its runtime and DOM listeners, disconnecting owned observers, cancelling timers, intervals, and animation frames, restoring reservations, and removing owned UI.

- 2026-09-13: Made Gemini, Grok, and DeepSeek placement react to composer control mutations that do not resize the composer. Their anchors now follow the left edge of the visible right-side control row, removing Grok/Gemini English-name matching and DeepSeek's penultimate-button assumption.

- 2026-09-13: Removed the unvalidated input-parent composer fallback. Surface discovery now fails closed when no scored and validated ancestor or form qualifies, preventing inner editor wrappers from becoming placement or retained-reservation roots.

- 2026-09-13: Prevented settings and native modal textareas/contenteditables from replacing the verified chat composer. Shared input discovery now excludes new dialog-owned editors while preserving the already verified composer through native overlay states.

- 2026-09-13: Stabilized Gemini, Grok, and DeepSeek placement across transient composer remounts. Their composer-owned orb now holds its last verified viewport position through a bounded 700 ms discovery gap, then immediately reattaches and recalculates when the live composer returns; persistent loss still hides it normally.

- 2026-09-13: Prevented F11 fullscreen resize/reflow from focusing the Cap Context orb. Composer-lifecycle cleanup now closes stale picker UI without trigger-focus restoration, while explicit keyboard, backdrop, and orb dismissals retain their intended focus behavior.

- 2026-09-13: Fixed Grok Build and Heavy mode placement by recognizing the complete visible mode set and reusing the existing correct Fast-mode anchor path instead of falling back onto the active control.

- 2026-09-13: Kept Cap Context visible when native menus or popovers temporarily mark the still-visible composer subtree `aria-hidden`. The shared placement path now retains only its last verified connected input, while removed or visually hidden composers continue to hide the orb.

- 2026-09-13: Fixed ChatGPT free-plan placement so Cap Context anchors before the complete visible right-side control row instead of occupying the mic slot when the paid reasoning control is absent. Paid placement remains anchored to the reasoning control.

- 2026-09-13: Fixed Cap Context stealing focus from native controls and composers across ChatGPT, Gemini, Grok, and DeepSeek. Their shared outside-click path now dismisses an open destination picker without refocusing the Cap Context button, while keyboard and backdrop dismissal retain trigger-focus restoration. Updated the content-script load identity so the corrected shared behavior is loaded consistently.

- 2026-09-13: Raised OrcaRouter's request budget from 45 to 60 seconds and confirmed its current free GLM route displays as `Orca / GLM 5.3 Flash`.

- 2026-09-13: Latest Run now records and displays OrcaRouter's concrete resolved model from `X-Orca-Resolved-Model`, including readable Orca / DeepSeek and Orca / GLM names, instead of presenting the `orcarouter/free` request alias as the serving model.

- 2026-09-13: Added OrcaRouter's strictly free `orcarouter/free` route between Gemini and Mistral. The integration uses a dedicated Vercel secret, a 45-second budget, immediate fallback on free-tier 429 responses, complete Latest Run provider/model reporting, and no path to OrcaRouter's paid automatic models. The full remote-provider allowance remains 175 seconds inside the extension deadline.

- 2026-09-13: Removed `mistral-large-2512` from the active route after production repeatedly returned HTTP 403 code 1910, confirming the Free-tier key cannot access it even though the Limits page displays a theoretical rate limit. `ministral-14b-2512` is now the sole Mistral model, avoiding a failed request on every transfer.

- 2026-09-13: Replaced the Mistral route with the user-selected two-model chain: `mistral-large-2512` first, then `ministral-14b-2512`. Medium 3.5 and Ministral 3B are no longer active models.

- 2026-09-13: Removed Mistral Large 3 from the active fallback chain after production proved the API key consistently receives HTTP 403 for it. Mistral 429 responses now move immediately from Medium 3.5 to Ministral 3 3B instead of waiting on a same-model retry, and safe error-code parsing now supports Mistral's root-level error format.

- 2026-09-13: Corrected the Mistral fallback API IDs and made model-specific HTTP 429 responses advance to the next Mistral model instead of incorrectly skipping the whole provider.

- 2026-09-12: Fixed provider rate-limit retries to honor `Retry-After`, with a one-second minimum for HTTP 429 responses, instead of retrying Mistral inside its one-request-per-second window.

- 2026-09-12: Stopped rejecting otherwise valid Groq summaries solely because the model paraphrased NEXT STEP; normalization still replaces that section with the trusted exact destination instruction.

- 2026-09-12: Replaced the retired Groq Llama 3.1 fallback with Groq Compound Mini for its larger free-tier token allowance and active production availability.

- 2026-09-12: Replaced the unreadable one-line fallback log with a vertical model path that separates daily skips from models tried in the current run and formats provider model names for people instead of internal IDs.

- 2026-09-12: Replaced the analysis page's blue treatment with a two-tone plum-and-gold upper atmosphere that fades into black, and reduced lower metrics to a restrained warm palette without using a green/red combination.

- 2026-09-12: Reworked the analysis page for readability with a neutral blue-gray background, wider receipt column, brighter supporting text, calmer metric colors, and accessible 44px controls while preserving the roomy layout.

- 2026-09-12: Restored the spacious Latest Run hero height after receipt cleanup and distributed the remaining receipt details evenly instead of shrinking both cards.

- 2026-09-12: Simplified the analysis receipt by removing duplicate route, summary-source, capture-path, and expansion rows; renamed backend match to the clearer input check.

- 2026-09-12: Polished the analysis Latest Run layout with a more balanced two-column receipt, clearer fallback emphasis, and calmer card hierarchy without changing receipt behavior.

This file records durable product, architecture, security, release, and workflow changes. It is historical context, not the source of truth for current behavior; agents must use `LOGIC.md` for the current production contract and Git history for commit-level detail.

## How agents should maintain this file

Add an entry when a change does at least one of these:

- Adds, removes, or materially changes user-visible behavior.
- Changes capture, summarization, provider routing, paste, storage, telemetry, security, privacy, or another cross-file contract.
- Fixes a meaningful reliability problem and adds evidence that prevents regression.
- Changes release state, extension version, packaging, deployment, CI, or the required verification workflow.
- Establishes a durable technical decision or replaces an approach a future agent might otherwise restore by mistake.

Do not add entries for:

- Branch creation, deletion, merging, or renaming; checkpoint branches are labels, not product changes.
- Small visual nudges, temporary diagnostics, exploratory attempts, or reverted experiments. Consolidate a sequence of iterations into its final shipped outcome.
- Routine documentation wording, personal notes, local files, generated artifacts, or test-only cleanup that does not change how the project is operated.
- Duplicate descriptions of the same outcome across several commits.

Write entries in past tense and describe the resulting behavior, not every implementation step. When a later change replaces an older approach, make the final state explicit and remove wording that falsely implies the replaced behavior is still current. Never infer that a change was published from its presence on `master`; verify the manifest, release archive, Web Store version, and deployment separately.

## Extension 1.4.4 candidate on `master`

### 2026-09-13

- Advanced the extension manifest version to 1.4.4. This source version does not by itself confirm that the release archive or Web Store listing has been updated.
- Tried and removed an isolated idle-orb shimmer after the visual treatment did not read naturally. Production retains the existing orb appearance and animations.

### 2026-09-12

- Added shared daily Gemini model health for Vercel deployments. With Upstash Redis connected through its current `KV_REST_API_*` variables or older `UPSTASH_REDIS_REST_*` aliases, each model is skipped until the next Pacific day after 20 successful summaries, three consecutive failed attempts, or an explicit daily-quota response. Gemini rate limits now move directly to the next model instead of retrying the same one. The store contains model-only counters and timestamps, fails open to the existing provider chain, and has a documented Vercel setup and off switch.
- Corrected Latest Run model reporting: the main card now identifies the model that actually served, the fallback log no longer marks that model as both failed and successful, and Gemini models skipped by daily health state now pass through the local receipt.

### 2026-09-09

- Reworked the orb-to-picker-to-handoff motion as one continuous interaction: the picker now has clearer open/close state and focus behavior, destination selection holds while alternatives recede, the handoff surface expands from the picker's measured position, the detached orb leaves during transfer, and handoff/error exits animate instead of disappearing abruptly. Follow-up micro-polish clarified review-before-send behavior, made wait estimates deliberately approximate, kept stage headlines readable through transitions, and removed duplicate assistive announcements. Reduced-motion behavior remains immediate.

### 2026-09-08

- Retained the standalone skill, legacy homepage, and its dated demo video as non-production reference artifacts by owner request; the legacy page now reuses the extension's canonical logo assets instead of restoring duplicate logo files.
- Removed verified dead code and duplicate artifacts, consolidated the public site onto the extension's canonical logo assets, centralized duplicate Vercel request parsing without changing endpoint contracts, and brought the Brave smoke's placement-diagnostic assertions back in sync with the production diagnostic schema. The separately deployed Vercel and Supabase telemetry validators remain intentionally duplicated and parity-tested.
- Restored transfer reliability during Gemini-family congestion and provider-wide outages: corrected the two dated Mistral fallback IDs to their documented forms, reduced the shared Gemini window so the complete 195-second provider allowance stays 15 seconds inside the extension's 210-second deadline, and added a terminal provider-free fallback that carries the complete untruncated transcript when every remote model fails.
- Refocused public and project documentation on cross-AI continuity, structured context, and preserved decisions instead of foregrounding a secondary interaction detail.
- Strengthened exact-fact handoffs with a full-transcript checklist and final omission check for protected integrity, implementation-state, ownership, region, identifier, rejected-action, and unresolved-option facts. Bumped the Mistral prompt-cache version so the stronger contract takes effect immediately, and made the live gate's existing single retry cover transient endpoint/provider failures as well as low-quality responses.
- Replaced Claude's null-anchor bottom-right fallback with anchored, lifecycle-stable placement. The orb now uses a page-stable fixed root, accepts only surfaces geometrically matched to a visible native control, retains the last valid position through bounded hydration/remount gaps, and reserves hidden mounted Voice/Send controls before visibility swaps. Existing optical tuning remains limited to successfully anchored placements.
- Removed the remaining Claude transition artifacts: SPA pathname changes now refresh route-specific vertical alignment after `/new` sends, the docked chat optical adjustment is applied after composer-local bounds so Claude's 48 px surface cannot erase it, and newly visible or remounted Mic/Send controls snap into their reserved slot before paint without inheriting Claude's transform animation.
- Fixed the persistent Claude Mic/Voice overlap exposed by those diagnostics. Claude updates editor emptiness and the control DOM in separate commits; the prior reservation held `transition: none` on native controls and could strand Claude's outgoing visual layer. Reservations now use the independent CSS `translate` property with the same offsets, preserving Claude's own transform/transition lifecycle and the validated final placement geometry.
- Moved Claude's side-control reservation from each transient button to the persistent grid that owns both Send and Mic/Voice branches. Newly mounted controls now inherit the already-reserved position while Claude completes its multi-commit swap, eliminating the visible Mic-on-Voice reflow without changing final offsets or orb geometry. Removed the temporary placement/control console instrumentation after verification; the Brave smoke now checks geometry and reservation state directly.
- Rebuilt `LOGIC.md` as the agent-facing production guide, including evidence priority, invariants, runtime ownership, platform and message contracts, capture and summary behavior, verification commands, current risks, and a definition of done. Corrected the provider description in the extension README.

### 2026-09-06 to 2026-09-07

- Added Gemini 3.8 Flash and Gemini 3.7 Flash ahead of the retained Gemini fallbacks under one bounded Gemini-family deadline.
- Reworked the destination picker and handoff card into their current compact dark-glass presentation while keeping progress tied to real capture, summary, and paste events. A proposed animated-mist treatment was reverted and is not part of the final design.
- Restored the minimal three-section static homepage, added a responsive HTML privacy page, and improved keyboard, touch, narrow-screen, and reduced-motion behavior.
- Strengthened summary fidelity for explicitly retained alternatives, numbers, integrity statements, and implementation state. Updated CI action runtimes, narrowed workflow permissions, preserved clean-checkout license coverage, and normalized typographic ranges in live evaluation.

The manifest reports 1.4.4. These source changes must not be described as published until the extension is packaged and verified against the release archive and Web Store; see `LOGIC.md` for the current release warning.

## Extension 1.4.2 — 2026-07-24

- Released a smoother picker-to-handoff experience with backdrop blur, press and selection feedback, crossfades, staged status entry, and reduced-motion support.
- Completed Claude and ChatGPT pasted-content capture, including nested and standalone cards, virtualized rows, DOM remount survival, ordered extraction, and per-transfer state reset.
- Increased Gemini output budgets, tightened boxed-title validation, clarified the embedded Context Carry template, and removed obsolete production diagnostics.
- Added Gemini 3.5 Flash as a fallback before Mistral.

## Extension 1.4.1 — 2026-07-22

- Finalized transfer ordering: the source remains visible until real capture, summary, and paste stages complete; ChatGPT and Grok retain focus-before-paste behavior, while already-pasted inactive destinations are revalidated before activation.
- Made Gemini 3.6 Flash the primary generated-summary model at that time and restored reliable provider-free tiny handoffs, including one- and two-character replies.
- Moved metadata-only telemetry behind the Vercel relay before Supabase, narrowed extension host permissions, and hardened the protected per-install user counter.
- Added an enforced destination-transfer timeout and reduced extension permissions.

## Extension 1.4 reliability and telemetry — 2026-07-18 to 2026-07-21

- Hardened destination recovery with platform revalidation, one bounded fresh-tab retry, stable ChatGPT paste, one truthful manual-copy fallback, and a six-minute page-local transfer lock.
- Raised the supported conversation limit to 350,000 JavaScript characters and added the extra-large summary profile.
- Added backend and extension-worker heartbeats for long summaries, bounded provider deadlines, centralized metadata-only transfer telemetry, a durable retry outbox, closed progress/failure schemas, and explicit user-cancelled status.
- Added protected anonymous usage counters in Supabase and fixed transaction ordering so concurrent first-use events do not create numbering gaps.
- Stabilized platform-specific composer placement during reflow for Claude, ChatGPT, Gemini, Grok, and DeepSeek.

## Capture, summary, and verification hardening — 2026-07-11 to 2026-07-17

- Replaced broad scraping fallbacks with role-verified capture, sequence-aligned virtual-window merging, complete-middle preservation, composer exclusion, structural empty-chat rejection, and explicit oversized-capture failure. Repeated ChatGPT turns became distinguishable through stable structural IDs.
- Removed picker-time warm summarization and the large-profile expansion pass. A destination choice now starts one summary job, concurrent identical work is deduplicated, invalid provider output falls through the bounded provider chain, and the first structurally valid result wins.
- Treated captured conversations as untrusted provider input and hardened the summary endpoint with schema, origin, size, rate, and concurrency controls. Restored compatibility for already-running extension workers without weakening that boundary.
- Added strict seven-section Context Carry validation, accepted the boxed header providers actually return, grounded current state in user-confirmed facts, and limited raw Latest Run transcript retention to 24 hours.
- Added the deterministic quality/latency gate, a separate paced long-capture regression, an isolated Brave installed-extension smoke test, Firefox-safe contenteditable line breaks, and Firefox background-script support.
- Added the dependency-free Cap Context marketing site and made the Chrome Web Store the public installation path.

## Multi-platform transfer foundation — 2026-06-10 to 2026-07-10

- Evolved the original Claude-to-ChatGPT relay into destination selection across Claude, ChatGPT, Gemini, Grok, and DeepSeek, with platform-specific composer discovery, placement, paste activation, and retry behavior.
- Added the Vercel summarization backend, exact Context Carry normalization and destination-confirmation instruction, size-based model routing, Groq fallback, and the Mistral fallback chain used before Gemini became primary.
- Replaced the earlier automatic-submission experiment with the current user-reviewed composer handoff.
- Added prepared-destination recovery, instant empty-chat rejection, user-facing failure overlays, and a manual-copy fallback.
- Added the local Latest Run analysis page with provider chain, timing, turn count, and captured-transcript diagnostics.
- Established `master` as the canonical production branch and kept local credentials, MCP configuration, memory notes, and personal task tracking out of shipped source.

## Product origin — 2026-04-17 to 2026-05-15

- Began as a `SKILL.md`-based Context Generator that instructed an AI to produce portable conversation summaries.
- Added the first static landing page, installation flow, downloadable skill, product visuals, and responsive mobile behavior.
- Renamed the original `/generate-context` presentation to `/context-generator` before the browser-extension workflow became the primary product direction.
