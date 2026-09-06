# Cap Context: back-after-15-days audit backlog

Audit date: 2026-09-07  
Repository: `C:\Users\vinit\Desktop\context-generator`  
Baseline inspected: `master` at `3d1b962` before this backlog file was added  
Extension release inspected: `1.4.2` (`extension/` last changed on 2026-07-24)

This is an investigation backlog, not a fix plan. No production behavior was changed during this audit. “Suggested direction” means the next evidence or design work to consider; it is not a product decision.

## Severity guide

- **High:** can lose context, fail a transfer, return materially wrong context, or leave releases without trustworthy coverage.
- **Medium:** visible UX/reliability problem, incomplete observability, or a credible regression risk that needs a focused reproduction.
- **Low:** documentation, metadata, or maintainability inconsistency with limited immediate user harm.

## Audit evidence and limitations

- `npm test`: **passed 150/150** on a sequential rerun. An earlier run under concurrent machine load failed only the fixture-latency assertion at **549.7 ms > 250 ms**; the same test passed alone at **19.5 ms** and in the final suite at **4.4 ms**.
- `npm run test:slow`: **passed**. The 78-turn / 62,177-character fixture took **20,699 ms** for capture, used **61** scroll steps, and finished in **21,191 ms**.
- `npm run test:extension-smoke`: **failed twice before the extension flow ran**. Brave's GPU process repeatedly crashed with exit code `-1073741790`; one run ended with `Target crashed`, and the other timed out waiting for the extension service worker. Brave also reported a locked `GPUPersistentCache\DawnGraphiteCache` file.
- `npm run eval`: not completed in this audit. The sandboxed request failed with `EACCES`, and permission to send the synthetic incident transcripts to the production endpoint was not granted. This is an audit coverage gap, not evidence that production summarization failed.
- `node --check` passed for `extension/platform-content.js`, `extension/background.js`, `api/summarize.js`, `api/telemetry.js`, and both test runners.
- The packaged `cap-context-extension.zip` matches the current contents of `extension/` byte-for-byte.
- The deployed homepage at `https://context-generator-five.vercel.app/` looked coherent at desktop size; no obvious clipping or broken section was found in that view.
- Cap Context's bubble rendered on a fresh ChatGPT page. Browser automation then lost its debugger attachment while trying to open the picker, so that interaction is inconclusive rather than a confirmed product failure.
- The handoff panel/connector could not be inspected in a successful live transfer because the isolated Brave smoke failed before startup. Connector and flicker entries below are therefore based on the reported symptom plus concrete rendering/timing risks in the current code.

## Backlog

### CC-001 — Long ChatGPT conversations are known to lose turns

**Issue**  
ChatGPT capture can return an incomplete transcript even after visibly sweeping through the conversation.

**Evidence / reproduction**  
The current owner tracker records a 40-turn live chat producing only 27 captured turns and a second 120+ turn chat with an unconfirmed captured count. The deterministic 40-turn virtualized fixture currently passes, which means the fixture does not reproduce the live ChatGPT DOM failure.

**Likely cause**  
Not proven. The strongest candidates are a current ChatGPT scroll-root/virtual-window shape missing from the fixture, a stale/quiet exit condition firing too early, or rendered-turn identity changing during virtualization.

**Files involved**  
`extension/platform-content.js`; `test/platform-content.test.js`; `evaluation/cases.json`; `todo.md`

**Severity**  
**High** — the core promise fails silently when missing turns still produce a plausible summary.

**Suggested direction**  
Capture a current real-page DOM/Latest Run trace from the failing 40-turn case, identify exactly which turn IDs disappear and at which sweep step, then encode that DOM shape as a regression fixture before changing the scraper.

### CC-002 — The six-minute transfer lock can expire during a valid transfer

**Issue**  
The source lock and handoff overlay can reset while the original async transfer is still legitimately running. A second transfer can then start alongside the first.

**Evidence / reproduction**  
`RUNNING_AUTO_RESET_MS` is 360,000 ms and starts at transfer intent. The same flow can spend up to 210 seconds waiting for the summary, up to 45 seconds on each prepared/fresh ChatGPT paste attempt, and substantial time capturing first. The capture loop permits 480 scrolls; the slow fixture already measured 20.7 seconds for only 61 steps. `resetRunningFlag()` sets `isRunning = false` and hides the overlay but does not cancel the still-running capture, fetch, or paste work.

**Likely cause**  
The safety timer was sized around summary plus paste and does not represent the full capture-to-completion lifetime. The timer is also not coupled to an abort signal or transfer identity.

**Files involved**  
`extension/platform-content.js`; `extension/background.js`; `test/platform-content.test.js`; `test/background.test.js`

**Severity**  
**High** — creates a real race, can make the bottom handoff UI disappear mid-run, and can allow overlapping destination tabs/requests.

**Suggested direction**  
Define one end-to-end transfer deadline and cancellation contract, keep the lock tied to the active transfer ID, and add a fake-timer test that combines maximum capture, summary, prepared paste, and recovery durations.

### CC-003 — Backend fallback time can exceed the extension's client deadline

**Issue**  
The backend is allowed to continue through a provider chain that the extension may stop waiting for first.

**Evidence / reproduction**  
Provider budgets total **225 seconds** (`45 + 45 + 55 + 40 + 25 + 15`), while `extension/background.js` aborts the summary fetch at **210 seconds**. The regression test asserts only that 225 seconds is below Vercel's 240-second ceiling; it does not assert that the backend finishes before the client abort. A late fallback result can therefore be generated after the user has already received a failure.

**Likely cause**  
Vercel, provider, and extension deadlines were maintained independently.

**Files involved**  
`api/summarize.js`; `extension/background.js`; `test/summarize.test.js`; `test/background.test.js`; `vercel.json`

**Severity**  
**High** — false user-visible failures, wasted provider work, and a hard-to-diagnose timing edge.

**Suggested direction**  
Create one shared deadline budget with explicit overhead for response parsing and network latency, then test the complete worst-case fallback path from the extension's point of view.

### CC-004 — The content-script reload guard is stale

**Issue**  
Reloading/updating the unpacked extension can leave an already-open AI tab running old content-script logic instead of the current code.

**Evidence / reproduction**  
`CONTENT_SCRIPT_LOAD_ID` is still `platform-content-2026-07-19-chatgpt-model-control-anchor`. Git blame dates it to 2026-07-19, but `platform-content.js` received many later changes through 2026-07-24, including pasted-content and handoff UI work. Startup returns immediately when the old page-world value matches, before stale-node cleanup. There is no reload regression test.

**Likely cause**  
The manually versioned sentinel was not advanced when later content-script changes shipped.

**Files involved**  
`extension/platform-content.js`; `extension/background.js`; `test/platform-content.test.js`; `scripts/run-extension-smoke.js`

**Severity**  
**High** — can preserve stale selectors, UI, and handlers until the user refreshes every open AI tab.

**Suggested direction**  
Make the load identity release-derived or otherwise impossible to forget, and add a smoke scenario that injects an older instance followed by the current one into the same open tab.

### CC-005 — The isolated Brave extension smoke is currently unusable on this machine

**Issue**  
The only real installed-extension smoke test crashes before it can validate the bubble, capture, backend request, or destination paste.

**Evidence / reproduction**  
Two sequential `npm run test:extension-smoke` runs failed. Brave repeatedly terminated its GPU process with exit code `-1073741790` and reported a locked Dawn Graphite cache file inside the test's temporary profile. The failures surfaced as `Target crashed` and `Timed out waiting for the installed extension service worker`.

**Likely cause**  
The harness launches a normal GPU-enabled Brave process in a fresh profile, but has no startup fallback or diagnostic distinction for GPU/cache failure versus extension failure.

**Files involved**  
`scripts/run-extension-smoke.js`; `extension/manifest.json`

**Severity**  
**High** — removes the strongest release-confidence check and blocks reliable reproduction of the reported UI problems.

**Suggested direction**  
First make browser startup deterministic on the supported Windows/Brave setup and classify startup failures separately. Only after the harness is trustworthy should failures be treated as extension regressions.

### CC-006 — The release gate does not exercise the real extension or the supported-site matrix

**Issue**  
A green push gate can ship without loading the extension in a browser, and the existing manual smoke covers only one synthetic route.

**Evidence / reproduction**  
`npm run gate` runs deterministic tests, the slow fixture, and live evaluation, but omits `test:extension-smoke`. `.github/workflows/regression-gate.yml` only invokes `npm run gate`. Even when the smoke works, it uses controlled fixtures for **ChatGPT source → Claude destination**. Gemini, Grok, DeepSeek, Claude-as-source, ChatGPT-as-destination, real authentication states, SPA navigation, and recovery paths do not get installed-extension coverage. The extension code itself has not changed since 2026-07-24 while all supported sites can change independently.

**Likely cause**  
Unit fixtures grew around known regressions, but browser coverage remained a single happy path and was kept outside the actual gate.

**Files involved**  
`package.json`; `.github/workflows/regression-gate.yml`; `scripts/run-extension-smoke.js`; `test/platform-content.test.js`; `extension/platform-content.js`

**Severity**  
**High** — a selector or paste break on four of five supported sites can pass CI.

**Suggested direction**  
After CC-005, define a small source/destination contract matrix, put at least one installed-extension path for every site behind a dependable gate, and keep real-site checks separate from deterministic fixtures so failures are diagnosable.

### CC-007 — The DOM handoff connector has subpixel and transition discontinuity risks

**Issue**  
The three-stage connector can look jagged, uneven, or jump when a stage completes.

**Evidence / reproduction**  
The rail uses three fractional grid columns, connector bounds based on `calc(50% + 19px)` / `calc(-50% + 19px)`, a 2 px line, a `scaleX()` fill, and a separate full-width head translated by a percentage. At common odd panel widths and non-integer device-pixel ratios, those layers can land on different subpixels. Completion measures transformed widths with `getBoundingClientRect()`, switches duration to `0ms`, forces layout, then starts a new transition. Tests assert CSS strings and state labels but never render or screenshot the connector. The reported jagged connector is therefore consistent with the implementation, although the failed smoke prevented a clean live capture in this audit.

**Likely cause**  
Multiple independently transformed layers derive their endpoints from fractional grid geometry, and stage retargeting forces a synchronous transition reset.

**Files involved**  
`extension/platform-content.js`; `test/platform-content.test.js`; `scripts/run-extension-smoke.js`

**Severity**  
**Medium** — highly visible polish regression, but it does not by itself corrupt a transfer.

**Suggested direction**  
Build a rendered overlay fixture at representative panel widths and 1x/1.25x/1.5x/2x DPR, record the exact bad frame, then reduce the connector to one pixel-aligned geometry/progress source and protect it with visual snapshots.

### CC-008 — The bottom bubble can blink during SPA composer remounts

**Issue**  
The bottom Cap Context control can briefly disappear/reappear or jump when an AI site re-renders its composer.

**Evidence / reproduction**  
A document-wide `MutationObserver` schedules placement work on nearly every non-extension child-list mutation. On non-ChatGPT sites, a transiently missing composer surface, a momentary width below 280 px, or an offscreen intermediate rectangle immediately sets `bubble.style.display = "none"`; the next mutation can reparent it and set `display = "flex"`. This is exactly the kind of intermediate DOM state produced by SPA hydration, model changes, focus changes, and large-paste reflow. Existing tests call placement helpers with static fake rectangles; they do not simulate a real remount frame-by-frame.

**Likely cause**  
Placement treats one transient invalid measurement as a final absence and combines discovery, DOM reparenting, reservation, and visibility in the same animation-frame callback.

**Files involved**  
`extension/platform-content.js`; `test/platform-content.test.js`

**Severity**  
**Medium** — visible flicker and click instability around the primary control.

**Suggested direction**  
Reproduce with a scripted composer remount/resize timeline, measure which condition hides the bubble, and define a short stability/grace rule that preserves the last known valid placement without covering native controls.

### CC-009 — Structurally valid summaries are not checked against the transcript

**Issue**  
A fluent Context Carry can invent names, numbers, URLs, commands, files, decisions, or project state and still pass validation.

**Evidence / reproduction**  
`createSummaryWithProvider()` calls `validateContextCarrySummary(rawSummary, profile)` without the source conversation. Validation checks headers, section order, minimal content, refusal/error shapes, the fixed NEXT STEP, and word count only. The owner tracker independently records this exact limitation. Current live evaluation contains only two synthetic cases and was not executable in this audit.

**Likely cause**  
The validator was designed as a format/sanity gate, while factual grounding remains prompt guidance rather than an enforced invariant.

**Files involved**  
`api/summarize.js`; `test/summarize.test.js`; `evaluation/cases.json`; `scripts/run-regression-eval.js`; `todo.md`

**Severity**  
**High** — incorrect context can be more damaging than an explicit failure because the destination AI treats it as authoritative state.

**Suggested direction**  
Define a transcript-grounding evaluation set first, especially for exact identifiers and user-confirmed decisions, then compare lightweight deterministic checks with a bounded semantic judge before selecting any production approach.

### CC-010 — Summary quality rules are internally inconsistent and too weak for large chats

**Issue**  
The first structurally acceptable output wins even when it is far below the intended size or was cut off for length, and the prompt gives conflicting NEXT STEP guidance.

**Evidence / reproduction**  
Large and extra-large profiles declare 1,100- and 1,600-word minimums, but validation caps the real acceptance floor at 200 words. `qualityFloorMet` is returned as metadata only. `finishReason` is recorded but a structurally complete token-limit result is not rejected. The hard rule requires one exact destination-confirmation sentence while the embedded template asks for “one clear sentence” describing what the user should do next; the validator enforces the hard rule. Recorded real attempts for the same large chat ranged from roughly 728 to 1,069 words, with another failure.

**Likely cause**  
Prompt targets, validation thresholds, provider finish state, and fallback behavior evolved as separate contracts after the former expansion pass was removed.

**Files involved**  
`api/summarize.js`; `test/summarize.test.js`; `evaluation/cases.json`; `todo.md`

**Severity**  
**High** — large chats are where users most need reliable compression, and weak acceptance can silently omit important state.

**Suggested direction**  
Write one explicit acceptance contract for completeness, truncation, grounding, and NEXT STEP; expand evaluation cases before changing thresholds or adding more provider calls.

### CC-011 — Exact deduplication can delete legitimate repeated turns outside ChatGPT

**Issue**  
On platforms without stable source IDs, later turns with the same role and exact text are removed even when the user or assistant genuinely repeated them.

**Evidence / reproduction**  
`removeExactDuplicateConversationTurns()` falls back to `role + text` as the identity whenever `sourceId` is absent. ChatGPT has a regression proving distinct stable IDs preserve repeated text, but other platforms retain the conservative global exact-text pass. The owner tracker already calls out this tradeoff.

**Likely cause**  
The dedup safety pass was introduced to control virtualized DOM inflation before equivalent per-turn identity was available on every platform.

**Files involved**  
`extension/platform-content.js`; `test/platform-content.test.js`; `todo.md`

**Severity**  
**Medium** — content loss is possible, but the repeated text must be exact and the safer replacement is not yet established.

**Suggested direction**  
Add paired fixtures for genuine repetition and duplicated DOM snapshots on Claude, Gemini, Grok, and DeepSeek, then look for platform-specific structural identity before weakening the safety pass.

### CC-012 — Telemetry delivery is unbounded and cancellation state is not restart-durable

**Issue**  
An extended telemetry outage can grow local storage indefinitely, while a service-worker restart can erase the state needed to label an in-flight transfer as user-cancelled.

**Evidence / reproduction**  
Every telemetry stage appends another outbox entry; `appendTelemetryOutbox()` has no maximum length, age limit, or compaction. Failed delivery retries every five minutes and leaves the whole queue in `chrome.storage.local`. Active attempts and their source tab IDs exist only in two in-memory `Map`s, but `tabs.onRemoved` depends on those maps to emit `user_cancelled`. A Manifest V3 worker restart clears them. The Vercel telemetry proxy also has no timeout on its Supabase `fetch`, even though the extension stops waiting after eight seconds.

**Likely cause**  
Durability was added for delivery, but queue lifecycle, in-flight attempt persistence, and the proxy's own deadline were not part of the original boundary.

**Files involved**  
`extension/background.js`; `api/telemetry.js`; `test/telemetry.test.js`; `supabase/functions/transfer-telemetry/index.ts`

**Severity**  
**Medium** — transfers keep working, but usage/failure counts can become incomplete and local telemetry can eventually hit storage pressure.

**Suggested direction**  
Specify retention/compaction and restart semantics for telemetry, add worker-restart/outage tests, and give each network hop a bounded timeout while preserving attempt-ID idempotency.

### CC-013 — Failed capture or summary can leave an unused destination tab open

**Issue**  
Cap Context opens the selected destination in the background before capture completes, but does not clean it up when capture or summary later fails.

**Evidence / reproduction**  
`runContextFlow()` calls `prepareDestinationTab()` as soon as a non-empty conversation is detected. Its catch path resets the source UI and reports the error but has no prepared-tab close message. `prepareDestinationTab()` also converts preparation errors to `null`, so ownership of a successfully created-but-unused tab is not retained by the source failure path.

**Likely cause**  
Destination warmup was optimized to overlap with capture/summary, but no lifecycle/ownership contract was added for early failure.

**Files involved**  
`extension/platform-content.js`; `extension/background.js`; `test/background.test.js`; `test/platform-content.test.js`

**Severity**  
**Medium** — confusing browser clutter and a visible reminder of failed transfers.

**Suggested direction**  
Trace prepared-tab ownership through every terminal path and decide, with an explicit test, when Cap Context may close only the untouched tab that it created.

### CC-014 — A wall-clock unit assertion is load-sensitive and already flaked

**Issue**  
The deterministic suite can fail because the machine is busy, even when the capture output is correct.

**Evidence / reproduction**  
The evaluation fixture measures real process time around fake-DOM capture and requires `captureMs <= 250`. During a concurrent audit run it measured 549.7 ms and failed; the same test immediately passed alone at 19.5 ms and later passed in the full sequential suite at 4.4 ms. No behavior or fixture changed between runs.

**Likely cause**  
A strict microbenchmark threshold is embedded in a functional test and uses wall-clock time on an uncontrolled shared runner.

**Files involved**  
`test/platform-content.test.js`; `evaluation/cases.json`; `.github/workflows/regression-gate.yml`

**Severity**  
**Medium** — produces false red builds and can hide genuine regressions in rerun noise.

**Suggested direction**  
Separate correctness from performance, measure performance in a controlled benchmark or use a much more robust regression signal, and retain the exact capture-completeness assertions in the deterministic gate.

### CC-015 — Public install and canonical URL documentation disagree

**Issue**  
The public surfaces give mixed signals about the preferred install artifact and canonical website.

**Evidence / reproduction**  
`README.md` prominently links and documents the developer ZIP, while `LOGIC.md` says the public install path is the Chrome Web Store and the ZIP is only a release/developer artifact. `index.html` links users to the Vercel site/store but sets canonical, Open Graph, and Twitter image URLs to the GitHub Pages deployment. The ZIP itself is current, so this is a distribution/metadata inconsistency rather than a stale archive.

**Likely cause**  
Website, README, release artifact, and deployment metadata were updated in separate passes.

**Files involved**  
`README.md`; `index.html`; `LOGIC.md`; `cap-context-extension.zip`

**Severity**  
**Medium** — can steer normal users toward sideloading and split search/share identity between deployments.

**Suggested direction**  
Confirm one public install path and one canonical web origin, then add a small documentation/metadata regression check so these surfaces cannot drift independently.

### CC-016 — Recent website changes have no visual regression coverage

**Issue**  
Desktop looked good in this audit, but mobile/responsive regressions and future visual drift are not protected by tests.

**Evidence / reproduction**  
The homepage and privacy page received many visual commits on 2026-09-06 and 2026-09-07. The current automated website check validates source-license wording, not layout, overflow, contrast, focus states, or responsive behavior. Only one desktop production view was inspected here; no trustworthy automated mobile snapshot exists.

**Likely cause**  
The site is dependency-free and intentionally simple, so validation stayed source-based while the design began changing more frequently.

**Files involved**  
`index.html`; `privacy.html`; `test/license.test.js`; `.github/workflows/regression-gate.yml`

**Severity**  
**Medium** — no current desktop break was found, but visual regressions can ship unnoticed.

**Suggested direction**  
Define a tiny desktop/mobile visual checklist or screenshot smoke for the deployed pages, covering overflow, CTA visibility, keyboard focus, reduced motion, and the narrowest supported viewport.

### CC-017 — Cross-browser packaging and Firefox behavior are not gated

**Issue**  
One manifest mixes Chromium and Firefox background declarations, but all current browser automation targets Brave.

**Evidence / reproduction**  
`extension/manifest.json` contains both `background.service_worker` and `background.scripts` plus Gecko-specific settings. There is no Firefox packaging validation, installed-extension smoke, or paste/capture run in the current gate. The owner tracker already flags separate Chromium/Firefox manifests as future work.

**Likely cause**  
The project kept one distributable manifest for convenience while Firefox support accumulated browser-specific behavior.

**Files involved**  
`extension/manifest.json`; `extension/platform-content.js`; `package.json`; `scripts/run-extension-smoke.js`; `todo.md`

**Severity**  
**Medium** — Firefox breakage or store-manifest rejection could remain invisible until release time.

**Suggested direction**  
Validate the current package against both browsers first, then decide whether generated browser-specific manifests or one compatibility-tested manifest has the lower maintenance risk.

### CC-018 — Core extension behavior is concentrated in one fragile content script

**Issue**  
Capture, five platform adapters, picker UI, handoff animation, placement, pasted-content extraction, paste verification, telemetry tracing, and recovery UI all share one 7,657-line file and mutable page-level state.

**Evidence / reproduction**  
`extension/platform-content.js` is 7,657 lines and contains platform selectors, global caches, multiple observers, timers, animation frames, transfer state, and test hooks. A stale load sentinel, global mutation observer, fixed safety timer, and platform-specific layout reservations all interact in this single lifecycle. Most tests use a custom fake DOM, so browser-only coupling can remain hidden.

**Likely cause**  
Incremental fixes were added to the shared script to preserve a single content-script distribution path, increasing coupling between previously independent behaviors.

**Files involved**  
`extension/platform-content.js`; `test/platform-content.test.js`; `extension/manifest.json`

**Severity**  
**Medium** — not a user-visible defect by itself, but it raises the probability and blast radius of UI, timing, and site-specific regressions.

**Suggested direction**  
Before any broad refactor, map stable boundaries and add browser-level characterization tests. If later changes justify extraction, separate by behavior contract (platform adapter, capture engine, transfer state, UI) in small verified steps.

## Top 3 issues to attack first

1. **CC-001 — Long ChatGPT capture loses turns.** This is direct silent context loss in the primary product path and already has two live reports that the fake-DOM suite does not explain.
2. **CC-002 + CC-003 — Fix the end-to-end timeout contract.** The source lock can expire while real work continues, and the client can abort before the backend's allowed fallback chain finishes. These two timing gaps can create flicker, false failures, overlapping transfers, and wasted provider work.
3. **CC-005 + CC-006 — Restore trustworthy real-browser release coverage.** Until the Brave smoke starts reliably and the supported-site matrix is represented, visual work on the connector/bottom UI and site-specific fixes cannot be verified with confidence.
