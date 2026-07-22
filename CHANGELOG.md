# Changelog

- 2026-07-22: Corrected the final handoff timing to match the intended visual sequence exactly. When verified paste arrives mid-connector, the remaining line now glides continuously to the destination over one full second, paints the completed destination tick, and activates the destination immediately afterward. Connector fill and progress-head movement now use compositor transforms to avoid layout-driven stutter. Per explicit request, no automated or browser tests were run.

- 2026-07-22: Corrected the final handoff ordering so the user stays on the source AI throughout capture, summary, and verified paste. Removed the destination-side completion-card workaround from the previous pass: ChatGPT, Grok, and every other destination now remain inactive until the source connector finishes, the completed tick is shown, and the destination tab is revalidated and activated. Post-paste stability checks, recovery, and no-auto-send behavior remain unchanged.

- 2026-07-22: Synchronized the handoff card's final progress with real paste success. Any remaining connector distance now finishes smoothly over 700 ms, the completed tick stays visible for 300 ms, and only then is the verified destination revealed. Connector motion is linear to remove the previous stop-and-go easing. ChatGPT and Grok retain their required pre-paste activation and stability behavior, but the completion card covers the destination until the tick so the page is revealed in the same order; capture, summary, paste, recovery, and no-auto-send behavior are unchanged.

- 2026-07-22: Replaced Gemini 3.5 Flash with the newly released stable `gemini-3.6-flash` as the first generated-summary provider. The native `generateContent` request keeps `MEDIUM` thinking, default sampling without deprecated sampling parameters, explicit non-storage, the existing reasoning allowance, and the complete Mistral/Groq fallback chain; tiny `local-direct` carries remain provider-free.

- 2026-07-22: Moved metadata-only transfer telemetry from direct extension-to-Supabase delivery to `Extension -> Vercel -> Supabase`. The extension no longer contains the Supabase URL or publishable key and no longer requests Supabase host access. The new Vercel route repeats the strict closed-schema validation before forwarding with server-only environment variables; the existing install UUID, ordered outbox, retry behavior, Supabase Edge Function, database aggregation, summary flow, and analysis tool remain unchanged.

- 2026-07-22: Changed the protected `users` aggregate counter from insert-first `ON CONFLICT` behavior to a concurrency-safe update-first path. Existing installs now update their row without consuming `user_no` identity values; only a genuinely new `install_id` inserts a row. Existing rows and sequence state are preserved, and deterministic coverage now verifies the same locally stored install UUID survives summaries, browser/service-worker restarts, and extension updates.

- 2026-07-22: Fixed tiny `local-direct` carries dropping one- or two-character messages such as `hi`. Tiny provider-free transfers now preserve both explicit sides of the exchange in `CONVERSATION SO FAR`; generated-summary profiles and their capture filtering remain unchanged.

- 2026-07-22: Increased the handoff card countdown from 30 to 40 seconds and made its numbers easier to notice with a brighter neutral-white treatment. A briefly tried purple highlight was removed because it looked too decorative; transfer behavior remains unchanged.

- 2026-07-21: Enforced destination message deadlines across already-delivered content-script requests instead of checking the clock only between connection attempts, preventing a hung paste listener from outliving the 30-second default or 45-second ChatGPT wait. Added a focused pending-response timeout regression. The isolated Brave smoke now checks every controlled destination tab for the exact pasted summary, so prepared-tab recovery cannot leave it attached to an earlier empty tab and produce a false 45-second failure.

- 2026-07-21: Reduced extension permissions without changing supported sites or transfer behavior. Removed redundant `activeTab` and `tabs` grants, relying on existing supported-site host access for matching tab URLs while retaining normal tab creation, activation, messaging, and removal events. Removed the duplicate exact `chatgpt.com` patterns because the wildcard already covers the root and subdomains, and removed the GitHub analysis page from `host_permissions` while keeping its narrow static content-script match.

- 2026-07-21: Slowed only the handoff card's display-only `Summarizing` connector from 12 to 20 seconds so it does not visually rush toward the paste step. Capture still follows real sweep geometry, summary completion still comes only from the backend's real completion mark, and the animation never delays a faster transfer.

- 2026-07-21: Simplified the tiny `local-direct` handoff. Chats at or below 1,200 characters now show only `CONVERSATION SO FAR`, the exact quoted exchange, and the destination confirmation instead of seven mostly empty generated-summary sections or backend/template wording. Tiny chats still make no provider call, while all generated-summary profiles remain unchanged.

- 2026-07-21: Regenerated `cap-context-extension.zip` from the current version 1.4.0 extension and removed the stray nested `extension/chrome(3).zip` archive. The release ZIP keeps `manifest.json` at its root and contains no nested ZIP files.

- 2026-07-19: Consolidated the five platform-specific floating-button fixes into durable placement invariants in `LOGIC.md`: Claude voice-control sensitivity, ChatGPT's verified-button fixed-position and style-reflow monitoring, Gemini `Pro`/`Flash` anchoring, Grok expanded-composer retention, and DeepSeek expanded-composer retention. Future placement changes must remain scoped to the named platform rather than copying one provider's placement architecture onto another.

- 2026-07-19: Fixed the ChatGPT large-paste button remaining at stale coordinates until a later click. Trigger diagnostics confirmed that ChatGPT's composer reflowed through style/class and text-only mutations that the global child-list observer deliberately ignored; because the observed boxes did not necessarily resize, no final recalculation followed the intermediate placement. ChatGPT now observes those mutations inside only its verified composer/form root and schedules the existing coalesced fixed-position update. Removed all temporary placement-trigger logging. Other platforms are unchanged. Per explicit request, no automated or browser tests were run.

- 2026-07-19: Instrumented the remaining ChatGPT large-paste stale-position path without changing placement behavior. Current scheduling reacts to document child-list mutations, observed input/surface size changes, window/visibility events, and focus changes, but not directly to paste/input events, character-data streaming, attribute/transform reflow, scrolling, transitions, or pure positional movement. Temporary ChatGPT-only logs now correlate every scheduling request and applied position with those observed and explicitly non-scheduling signals, including the click/focus sequence that causes the delayed correction. No fix or browser/test run was included in this investigation pass; other platforms are unchanged.

- 2026-07-19: Fixed ChatGPT's streaming-reply placement jumps at the anchor-selection source. The previous live-row lookup scanned the whole document and promoted spans, tabindex wrappers, and other loose text containing `Instant`, `Medium`, or `High`, so words entering the streamed answer could become higher-scoring anchors on each DOM mutation. ChatGPT now considers only actual buttons sharing the editor's form or verified composer surface, while retaining its fixed-position geometry and existing bounded fallbacks. Removed the temporary placement console diagnostics after they confirmed the cause. Other platforms are unchanged. Per explicit request, no automated or browser tests were run.

- 2026-07-19: Added temporary ChatGPT-only placement diagnostics after repeated large-paste fixes did not resolve the visible jump. Each fixed-position update now logs the input and retained surface, placement-rectangle source, bounded model-selector candidates with scores/eligibility, selected anchor or exact fallback path, and final applied coordinates. Placement behavior is intentionally unchanged while live evidence is collected. Per explicit request, no automated tests were run.

- 2026-07-19: Fixed the still-visible ChatGPT `High` misplacement by correcting control discovery, not geometry. Current ChatGPT can expose the model control through tabindex/labeled wrappers or nested text rather than a plain button/role button, so earlier lookups missed it and continued falling back beside the microphone. ChatGPT now recognizes those structures and maps nested `High` text to its nearest compact enclosing control, aligning Cap Context to the full control rectangle instead of the text baseline. Other platforms are unchanged. Per explicit request, no automated tests were run.

- 2026-07-19: Corrected the remaining ChatGPT large-paste misplacement after a screenshot showed Cap Context beside the microphone instead of left of `High`. The first ChatGPT stabilization could retain an inner composer whose bounds excluded the model control, causing the action-button fallback. ChatGPT now searches for `Instant`, `Medium`, or `High` in a tight row derived from the live input geometry before consulting composer-scoped legacy fallback, so wrapper reflow cannot redirect the button to the microphone cluster. Other platforms are unchanged. Per explicit request, no automated tests were run.

- 2026-07-19: Stabilized ChatGPT placement during large-paste composer reflow while preserving its page-root fixed-position architecture. ChatGPT now accepts a placement surface up to 720px tall, retains the last verified surface through temporary editor/container geometry mismatch, and observes ChatGPT input/surface resizing before recalculating the fixed coordinates. It still does not mount into or reserve the composer, and its model-selector/control scoring is unchanged. Claude, Gemini, Grok, and DeepSeek behavior is unchanged. Per explicit request, no automated tests were run for this pass.

- 2026-07-19: Applied large-paste composer stabilization to Claude without changing its sensitive voice/model-control placement calculations. Claude now accepts its expanded composer up to 720px, retains the already-verified outer surface during temporary editor/container geometry mismatch, and observes only Claude's input/composer resizing during staged reflow. ChatGPT, Gemini, Grok, and DeepSeek placement behavior is unchanged. Per explicit request, no automated tests were run for this pass.

- 2026-07-19: Updated Gemini-only placement for the current composer. Cap Context now recognizes the in-composer `Pro` model selector as well as `Flash` and anchors immediately to its left, instead of falling back beside the microphone. Gemini also receives the proven 720px expanded-composer limit, retained outer surface during staged paste reflow, and Gemini-only resize monitoring. Grok and DeepSeek remain unchanged, while Claude and ChatGPT retain their existing placement paths; deterministic tests cover Pro anchoring plus settled and transient expanded Gemini composers.

- 2026-07-19: Applied the proven large-paste placement stabilization to DeepSeek only. DeepSeek now accepts its expanded composer up to 720px, retains the verified outer surface while editor/container geometry is briefly out of sync, and observes DeepSeek input/composer resizing during reflow. Grok's existing stabilization is unchanged, and Claude, ChatGPT, and Gemini retain their previous limits and monitoring paths; deterministic regressions cover both settled-tall and transient DeepSeek states.

- 2026-07-19: Removed the remaining Grok-only floating-button jump during staged large-paste reflow. Grok now retains its previously verified outer composer while the editor and container geometry are briefly out of sync, and a Grok-only resize observer keeps placement aligned as the composer settles. Other platforms retain their existing composer selection and monitoring behavior; the regression simulates the transient inner-first reflow rather than only the final expanded state.

- 2026-07-19: Fixed Grok-only floating-button placement after large pastes. Grok's expanded composer may now remain the placement surface up to 720px tall instead of being rejected by the shared 260px candidate limit and falling back to an inner editor. Claude, ChatGPT, Gemini, and DeepSeek retain their existing height boundary; a deterministic tall-composer regression now verifies Grok stays anchored beside its speed selector.

- 2026-07-18: Added the closed telemetry failure reason `user_cancelled`. Closing the source AI tab during an active transfer now finalizes that attempt with this reason and preserves its last pipeline stage, separating a clear user-side cancellation from provider, timeout, reload, and other technical failures. No raw error or conversation data is added.

- 2026-07-18: Changed future Cap Context source releases from the previous permissive license to proprietary, all-rights-reserved distribution. Removed public-source, repository-stars, and contribution messaging from the current site, archived site, and repository documentation; marked the package unlicensed for npm reuse. Copies already received under the earlier license keep the permissions previously granted to those copies.

- 2026-07-20: Removed the obsolete ChatGPT rendered-anchor sweep regression that modeled a conversation without the required overflow scroll-root ancestor. Moved the valuable but expensive 78-turn Claude pacing regression out of regular `npm test` into `npm run test:slow`; the release gate still runs both suites before live evaluation.

- 2026-07-20: Replaced the previous view-based anonymous usage layer with one protected `users` table, matching the schema already applied directly to production. A row is created when an install's first summary succeeds; `user_no` preserves that first-success order, while `total_summaries`, `today_summaries`, and `today_date` maintain lifetime and current UTC-day success counts. Follow-up hardening granted the `security invoker` trigger its required service-role insert/update access, removed the remaining old activity-view dependency from clean replays, and added a 00:00 UTC Cron reset so inactive users cannot retain yesterday's displayed daily count. The table remains unavailable to public clients and stores no conversation content or per-transfer activity.

- 2026-07-18: Expanded centralized transfer telemetry with a closed, monotonic `last_stage` diagnostic across intent, capture, summary request/response/completion, paste, and final completion. The streamed-summary heartbeat now records `summary_response_started` as soon as response headers arrive; an atomic Postgres upsert retains the furthest stored stage even if a stale terminal update arrives later. Both Supabase migrations and Edge Function v5 were deployed, strict validation rejects unknown stages or content fields, and a metadata-only live synthetic sequence confirmed the terminal failure kept `summary_response_started` before its row was removed.

Durable production decisions and regression history live here. Current behavior is documented only in `LOGIC.md`; Git history retains cosmetic iterations, temporary experiments, and superseded measurements.

Keep an entry only when it explains the current architecture, a safety boundary, a likely regression, a deliberate reversal, or an operational requirement.

## Durable History

- 2026-07-18: Hardened destination recovery end to end. A prepared tab is now reused only if its current or pending URL still matches the selected AI; otherwise Cap Context opens one fresh correct destination without touching the navigated-away tab. Prepared failures can create at most one fresh retry, and ChatGPT recovery now receives the same activation settle as its normal paste path. Premature destination-side copy dialogs were removed so one source-side manual-copy fallback appears only after recovery is exhausted, failed clipboard fallbacks no longer claim success, picker capture-preparation errors release the transfer lock immediately, the safety lock covers six minutes, and background ChatGPT detection no longer treats ordinary `openai.com` pages as chats.

- 2026-07-18: Raised the canonical conversation capacity from 210,000 to 350,000 JavaScript characters without transcript truncation. The extension and backend enforce the same character limit; backend guards now allow up to 1,400,000 UTF-8 transcript bytes and 2,200,000 JSON request bytes. Chats from 210,001 through 350,000 characters use a new `extra-large` profile targeting about 1,800 words with a 7,000-token visible output cap, while existing profiles, provider routing, retries, and time budgets remain unchanged.

- 2026-07-18: Hardened long generated summaries against Chromium Manifest V3 worker suspension. The backend now emits JSON-safe whitespace heartbeats after 15 seconds and every 15 seconds thereafter, while the worker makes a harmless runtime API call every 25 seconds until the response finishes. Streamed failures preserve their real status in the JSON body and still map to the existing public error path. The Mistral primary fallback was also corrected from the nonexistent `mistral-medium-2604` alias to the official `mistral-medium-3-5` API model; provider budgets, the explicit 240-second Vercel maximum, the 210-second client abort, capture, and paste behavior remain unchanged.

- 2026-07-18: Added centralized metadata-only transfer telemetry. Every icon or picker attempt queues a Supabase `started` event before early guards and later upserts the same UUID as succeeded or failed with a closed-list safe reason. A persistent random install UUID and ordered local outbox provide install-level aggregation and startup retry without blocking transfer work. The Edge Function rejects extra fields, so raw chats, summaries, URLs, timelines, and full JavaScript errors never enter telemetry; direct anonymous Data API access to `transfer_events` was removed.

- 2026-07-17: The two-minute extension summary cache now retains the complete original summary result instead of text alone. Cache hits report zero current summary latency but preserve provider, model, fallback chain, provider timing, and token usage as explicitly labeled original-generation metadata in Latest Run, preventing repeated transfers from replacing those fields with dashes.

- 2026-07-17: Finalized the ChatGPT-only scroll-root rule confirmed from a 300-turn conversation: walk upward from a structural conversation turn and select the nearest ancestor whose computed `overflow-y` is `auto` or `scroll`. Selection does not use generic candidates, `scrollHeight`, `clientHeight`, or element size, and large `overflow-y: visible` ancestors are ignored. The superseded broad-selector and size-heuristic regressions were removed in favor of one deterministic suite covering both allowed overflow values and the nearest-ancestor rule. Claude and every shared platform path remain unchanged.

- 2026-07-17: Added a ChatGPT-only diagnostic that logs the complete DOM ancestor chain from one structural conversation turn through `<html>`, including `tagName`, `className`, `scrollHeight`, `clientHeight`, and computed `overflowY`. Capture behavior is unchanged.

- 2026-07-17: Added ChatGPT-only before/after console diagnostics around the existing scroll-to-top call. Each log records the selected root element plus `scrollHeight`, `clientHeight`, and `scrollTop`; scrolling and scraping behavior are unchanged.

- 2026-07-17: Fixed the remaining ChatGPT long-chat under-capture after stored production receipts proved final deduplication was deleting turns after the sweep found them. ChatGPT now carries stable `conversation-turn-*` ids through virtual-window alignment and final serialization, preserving intentionally repeated text from distinct messages while still collapsing repeated DOM copies of the same message. The regression covers a virtualized 40-turn repeated-text chat and keeps the existing 315-entry inflation safety behavior for platforms without stable ids.

- 2026-07-16: Fixed Firefox contenteditable paste collapsing Context Carry line breaks by inserting escaped HTML with explicit `<br>` elements only on Firefox. Chrome/Brave contenteditable paste and textarea/input paste remain unchanged.

- 2026-07-16: Added the isolated Brave installed-extension smoke test. It exercises the real Manifest V3 worker and content scripts against controlled ChatGPT and Claude fixtures, requires one backend request and exact destination paste, and verifies that Send is never clicked.

- 2026-07-16: The live regression evaluator now retries a case once after a failed accuracy, structure, incorrect-fact, or latency gate, then evaluates the stronger attempt. Persistent failures still block the gate.

- 2026-07-16: The Chrome Web Store became the public install path for Chrome and Brave. The root site and README no longer advertise the developer ZIP; `cap-context-extension.zip` remains a tracked release artifact and must match `extension/`.

- 2026-07-16: Gemini `gemini-3.5-flash` became the first generated-summary provider. Its native request uses `MEDIUM` thinking, a provider-specific plain title, and an extra 4,000-token reasoning allowance; normalization restores the boxed title. The preserved fallback chain remains Mistral Medium, Mistral Large, Ministral 3B, then optional Groq.

- 2026-07-16: Conversation candidate containment moved from repeated pairwise DOM checks to a cached parent-to-child index. Wrapper selection, ordering, role rules, and final exact-deduplication behavior were deliberately preserved.

- 2026-07-15: The handoff popup replaced random/filler presentation with three deterministic stages driven only by real capture, summary, and paste events. Display-only progress cannot complete a stage or gate transfer work.

- 2026-07-15: Rebuilt the repository-root marketing site as a dependency-free extension landing page. The previous site remains archived as `index.legacy-2026-07-15.html`; the current page uses relative assets and has no runtime API dependency.

- 2026-07-14: Summary decisions and current state became strictly user-grounded. Unaccepted or rejected assistant proposals are not decisions, the latest user-confirmed state wins conflicts, and older states are retained only when still relevant and labeled as historical or replaced.

- 2026-07-14: Latest Run raw transcript retention was limited to 24 hours. An extension alarm and analysis-bridge read guard remove only the raw transcript and expiry marker; diagnostic metadata remains until the next transfer replaces it.

- 2026-07-14: Summary validation now permits `None` only when a section genuinely lacks useful transcript facts. `WHAT WE WERE DOING`, `WHERE WE LEFT OFF`, and `KEY CONTEXT` remain mandatory and meaningful.

- 2026-07-14: Added the client-side 210,000-character guard before `SUMMARIZE_WITH_BACKEND`; the backend independently enforces the same limit. Oversized text is never sent to the backend.

- 2026-07-14: Empty-chat handling became structural. The active composer and containing wrappers are excluded from conversation candidates, every platform shares the bounded empty-capture retry, and zero-turn transfers stop before handoff UI or destination-tab creation.

- 2026-07-14: ChatGPT extension access was restricted to `chatgpt.com`, its subdomains, and the exact legacy `chat.openai.com` host. Ordinary `openai.com` pages are intentionally excluded.

- 2026-07-14: Virtual sweep steps remain 60% of the viewport unless consecutive settled snapshots prove at least 50% ordered overlap and a positional shift, in which case the next step may use 90%. Every real pixel advance still awaits render stability; boundary anchoring is fallback-only.

- 2026-07-14: Final capture selection now starts from the quick capture and merges richer swept text even when turn counts are equal. A shorter swept rendering cannot downgrade the baseline.

- 2026-07-12: Replaced edge-only virtual-window merging with sequence alignment across accumulated turns after real Claude traces inflated 38 turns into hundreds of candidates. Claude same-role fragments are owned by their message boundary, and a final exact role-and-text safety pass prevents repeated rendered snapshots from reaching the backend.

- 2026-07-12: Raised the canonical conversation limit to 210,000 JavaScript characters and 840,000 UTF-8 bytes. Capture does not head/tail truncate the transcript.

- 2026-07-12: Added the versioned regression evaluation set and release gate for capture completeness, required-fact recall, forbidden facts, Context Carry structure, and latency. GitHub Actions runs it after pushes to `master`, daily, and on demand.

- 2026-07-11: Capture hardening removed broad page-text fallback and loose `you`/`me` role guessing, preserved the complete middle of conversations, and required structural role evidence.

- 2026-07-11: Removed warm summarization. Picker open is UI-only; capture and the single backend summary job start only after destination selection. In-flight deduplication and the short exact-result cache remain.

- 2026-07-11: Removed the large-profile expansion pass. The first structurally valid provider result wins; the 1,100-word large-profile quality floor remains diagnostic only.

- 2026-07-11: Added deterministic seven-section Context Carry validation before normalization. Invalid output advances through the provider chain; normalization cannot fabricate missing sections or disguise free-form text as valid context.

- 2026-07-11: Hardened the summary endpoint with extension-scheme CORS, strict method/content-type/schema and size validation, instance-local rate/concurrency limits, bounded public errors, and an explicitly untrusted transcript envelope. Valid extension-origin requests remain compatible without the client marker; originless Firefox requests require it.

- 2026-07-11: Fixed canonical boxed-header validation after valid provider output was rejected as missing the Context Carry title. Keep regression coverage for the exact Unicode box line.

- 2026-07-10: Standardized the Mistral fallback order as Medium 2604, Large 2512, then Ministral 3B, independent of input size and `MISTRAL_MODEL`. Gemini now precedes this chain when configured; optional Groq remains last.

- 2026-07-10: `master` became the sole canonical production branch and the Vercel Git integration was reconnected to it. Pushes to `master` are expected to deploy production.

- 2026-07-10: Reverted the destination-sheet redesign and restored the compact picker. Preserve that boundary unless a later task explicitly reopens the design.

- 2026-07-05: Added the Latest Run analysis page and bridge, including capture/backend/paste timing, turn counts, sizes, provider/model/fallback metadata, usage, status, and the time-limited raw transcript panel.

- 2026-07-05: Long-chat capture began waiting for turn count, character count, and scroll height to stabilize, expanding safe in-chat reading controls, and preferring real child turns over broad wrappers.

- 2026-07-02: Post-summary destination or paste failures preserve the generated context in a manual-copy dialog. ChatGPT paste also verifies stability after hydration and retries when the editor clears an initial insert.

- 2026-07-02: Destination confirmation became a backend-enforced contract rather than provider-authored next-step text, preventing a pasted handoff from instructing the destination model to answer immediately.

- 2026-07-01: Unpacked-extension reload safety added runtime guards, cached asset URLs, a versioned content-script load id, and stale extension UI/style cleanup.

- 2026-06-29: ChatGPT button placement moved from fragile composer mounting to a page-root fixed position near the model selector. Platform-specific placement remains intentional.
