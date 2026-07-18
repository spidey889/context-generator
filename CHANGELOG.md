# Changelog

- 2026-07-18: Added a deliberately small PMF-era usage layer on top of metadata-only telemetry. Each anonymous extension install is automatically assigned a stable internal `User N` label, and a protected UTC daily view shows only transfer-attempt count, per-chat character counts, and total characters. There is still no login, user profile, first-seen/last-seen tracking, or public analytics access.

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
