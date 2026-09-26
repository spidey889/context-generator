# Conversation Scraping Audit

Audit date: 2026-09-26  
Scope: The source-page capture path in `extension/platform-content.js`, from transfer intent through the exact transcript handed to `extension/background.js`.  
Mode: Read-only audit. No runtime code was changed.

## Executive summary

The scraper is conservative by design: it scrolls to the top, waits for older history to settle, expands supported hidden content, sweeps the entire rendered conversation from top to bottom, sequence-aligns overlapping virtual windows, verifies user/assistant roles, removes duplicates, and only then serializes the transcript. This is much safer than a one-shot `innerText` scrape and it has substantial deterministic regression coverage.

Its main weakness is that correctness still depends on timing guesses about third-party DOMs. Except for Grok, a physical scroll gets at most a 360 ms settle window before the scraper may advance again. If ChatGPT, Claude, Gemini, or DeepSeek mounts the next virtual window later than that, the scraper can move past content it never observed. This is the strongest code-level explanation for the documented live ChatGPT case that visibly swept a 40-turn chat but captured only 27 turns, but it is not proven without a current failing DOM trace.

The other confirmed high-risk mechanism is pasted-content remount handling on Claude and ChatGPT. Captures are tracked by temporary DOM identity. When a logical paste card remounts as a new element, progressively richer versions can be appended as separate payloads instead of replacing the earlier version. The current test covers one Claude remount, not repeated remounts; a prior diagnostic reproduced severe inflation from repeated versions.

Most ordinary capture time is intentional waiting, not text serialization. The current slow fixture spends 20.4 seconds sweeping a 78-turn Claude chat because 61 advances are separated by roughly 306 ms. Grok is faster because it has a dedicated 40/100/160/220 ms adaptive timing profile. Real pages can cost more because every stability sample rescans broad selectors, performs layout reads, clones candidate subtrees, rebuilds containment maps, and runs sequence alignment.

The best path forward is not globally reducing waits. Reliability should first be made observable and event-driven: record why a sweep ended, identify one authoritative scroll root, wait for confirmed window change/stability rather than aggregate count/character equality, and require overlap or backtracking before advancing past a window. Once those guarantees exist, redundant rescans and fixed sleeps can be removed safely.

## Evidence reviewed

- Production source of truth: `LOGIC.md`, especially Capture Engine and Known Current Risks.
- Current implementation: `extension/platform-content.js`.
- Deterministic coverage: `test/platform-content.test.js` and `evaluation/cases.json`.
- Browser harness: `scripts/run-extension-smoke.js`.
- Historical context: `CHANGELOG.md`, `backafter15day.md`, `docs/grok-capture-speed.md`, and Git history for the capture code.
- Current verification: `npm test` passed 198/198; `npm run test:slow` passed 1/1.
- Current measured slow fixture: 78 turns, 62,177 characters, 61 advances, 20,398 ms inside capture, 306 ms average gap.
- Current measured Grok fixtures: 40-turn normal capture about 982 ms; delayed-render capture about 1,434 ms.

No logged-in live-site browser run was performed for this audit. Findings about present production DOM behavior are therefore separated from confirmed code behavior and historical reports.

## End-to-end flow as implemented

```text
Destination chosen or toolbar action received
  -> reject if no role-verified message is currently visible
  -> start destination-tab warmup in parallel
  -> reset capture caches and pasted-card state
  -> scroll the source conversation to the top
  -> wait for top-of-chat readiness
  -> expand collapsed text and Claude/ChatGPT pasted-content panels
  -> take an initial structured capture
  -> sweep from top to bottom in viewport-sized steps
       -> capture the currently rendered window
       -> merge it into the accumulated ordered sequence
       -> advance the conversation scroll root
       -> wait for the rendered window to settle
       -> adapt from 60/70% to 90% steps only after overlap is proven
       -> stop on no movement plus a final quiet check, or at 480 advances
  -> merge the sweep with the initial capture
  -> filter to explicit user/assistant turns
  -> remove exact duplicates
  -> serialize "<Platform> conversation:" plus role-prefixed turns
  -> enforce the 350,000 JavaScript-character limit
  -> send the exact transcript to the background worker
  -> background trims it, checks in-flight/cache entries, and POSTs it to `/api/summarize`
```

### 1. Transfer entry and privacy boundary

The destination picker itself does not scrape. Capture starts only after a destination tile is chosen (`startDestinationTransfer()`, around lines 5325-5368), or after the toolbar sends `START_CONTEXT_TRANSFER` into `runContextFlow()` (around lines 798-879).

Both paths first call `getDetectedConversationMessageCount()`. That function already performs a complete candidate scan and role filter. Empty chats fail before capture and before transcript transmission. Destination warmup may start in parallel, but the warmup message contains no conversation text.

The picker path performs preparation and scraping itself, then passes the completed transcript into `runContextFlow()` so it is not scraped twice. The toolbar path lets `runContextFlow()` perform the same preparation and scrape.

### 2. Capture preparation

`prepareSourceForCapture()` (lines 989-1001) clears cached scroll roots and per-transfer pasted-card state, scrolls to the top, waits for readiness, expands hidden content, and waits once more if anything was expanded.

Top readiness is based on repeated snapshots from `getConversationReadinessSnapshot()`:

- role-verified rendered turn count;
- total rendered turn characters;
- aggregate scroll height;
- aggregate scroll top;
- a full turn signature is calculated but is not used by the readiness comparison.

The page is considered stable after three matching samples for every platform except Grok, which uses two. Claude and ChatGPT can wait up to 4.5 seconds, Gemini and DeepSeek up to 1.8 seconds, and Grok up to 700 ms. The normal sample interval is 140 ms; Grok uses 40 ms.

Preparation repeatedly forces the discovered source roots back to scroll position zero. This is intended to trigger older-history hydration before the downward sweep begins.

### 3. Scroll-root discovery

ChatGPT has a special path. The code finds the first structural turn and chooses its nearest ancestor whose computed `overflow-y` is `auto` or `scroll` (`getChatGptConversationScrollRoot()`, lines 1715-1762). That root is cached for the transfer.

Other platforms use `getSourceScrollTargets()` (lines 1676-1713). It starts with the document scroll roots, adds large scrollable elements whose labels look conversation-related, and walks upward from every message-like element to collect scrollable ancestors. It can return several roots. Top resets and forward advances are then applied to every returned root plus the window.

The cached list is invalidated only when a cached element becomes disconnected. A connected but no-longer-authoritative root can remain cached for the rest of the transfer.

### 4. Hidden and pasted-content expansion

`expandCollapsedConversationContent()` (lines 1238-1258) runs before capture and again at the start of every sweep iteration. It:

- searches visible buttons, button roles, and summaries for English labels such as “show more,” “read full,” or “expand”;
- excludes known actions such as send, regenerate, voice, and settings;
- clicks up to 30 matches per round for up to three rounds;
- waits 80 ms after each round.

On Claude and ChatGPT it also calls `capturePastedConversationCards()` (lines 1260-1304). For each detected paste card it opens the detail panel, waits up to one second for it, extracts the payload, closes the panel, and remembers the payload for later attachment to the owning user turn.

Virtualized paste panels get a nested sweep of their own (`scrapeVirtualizedPastedContentPanel()`, lines 1492-1536): rows are keyed by `data-index`, the panel advances by 80% of its viewport, each window may wait up to 600 ms, and the loop is capped at 250 advances.

### 5. Candidate discovery and role verification

`getConversationTurns()` (lines 3142-3200) queries the platform-specific message selectors plus broad generic selectors such as message-like test IDs/classes, `.markdown`, and `article`.

For every matched element it:

1. Rejects extension UI, invisible nodes, inputs/buttons/contenteditables, nav/header/footer/aside/menu content, the selected composer subtree, and obvious prompt-suggestion containers.
2. Clones the entire candidate subtree, removes Cap Context nodes, and reads visible text.
3. Determines a role by walking up to eight ancestors, preferring role attributes and platform selectors, then semantic words in IDs, classes, labels, and tag names.
4. Records ChatGPT structural turn/message IDs when available.
5. Builds a candidate containment tree and rejects broad wrappers in favor of message boundaries.
6. Preserves Claude's role-bearing message wrapper as one turn rather than treating its Markdown paragraphs and code blocks as separate turns.
7. Reattaches any captured pasted-content payloads.

Only explicit `User` or current-platform roles survive the final useful-turn filter. Unverified page text fails closed rather than being sent as conversation history.

### 6. Initial capture and universal sweep

`scrapeConversationTextForTransfer()` (lines 2545-2550) first builds a valid transcript from the currently rendered turns. It then always enters `scrapeVirtualConversation()`, even if the first snapshot appears complete or the chat is short.

The sweep starts at the top after preparation. Every iteration:

1. Re-runs hidden/pasted-content expansion.
2. Rebuilds the current rendered snapshot through `getConversationTurns()`.
3. Merges that window into `collectedTurns`.
4. Chooses a step of 60% of the viewport; Grok starts at 70%.
5. Uses 90% only after ordered overlap of at least 50% has been observed with a positional shift.
6. Scrolls instantly.
7. If pixels moved, waits for two stable rendered-window samples.
8. If no pixels moved, tries `scrollIntoView()` on the last rendered turn, waits again, then performs one final quiet check.
9. Stops at confirmed no movement/quiet or after 480 advances.

Non-Grok per-scroll settling is capped at 360 ms and sampled every 140 ms, which produces a practical minimum of about 280 ms for two stable samples. Grok is capped at 100 ms and sampled every 40 ms, producing about 80 ms on the fast path.

Grok alone has an additional delayed-render guard: if pixels moved but the rendered signature did not change, it waits up to another 220 ms for a late window, then confirms stability before advancing.

Claude has a longer 1.4-second terminal quiet check, but that longer wait applies only when no physical scroll movement occurred. It does not protect an ordinary moving step whose virtual DOM update arrives after the 360 ms settle window.

### 7. Sequence alignment and deduplication

Each rendered window is merged with the accumulated sequence using longest common subsequence matching (`getConversationSequenceMatches()`, lines 2815-2866).

Two turns are compatible when:

- their roles match and both ChatGPT source IDs match; or
- their cleaned texts are exactly equal; or
- the shorter text is at least 24 characters and appears as a whole rendered turn inside the longer text.

Unmatched turns are inserted around ordered anchors. A matching collected turn is replaced only when the rendered version is longer, so a later partial rendering cannot shorten already collected text.

The initial top snapshot is then merged with the completed sweep. Finally, `removeExactDuplicateConversationTurns()` keeps the first occurrence of each identity. ChatGPT identities use stable structural IDs; every other platform falls back to exact role plus text.

### 8. Serialization and handoff

Useful turns are serialized as:

```text
<Platform> conversation:

User: ...

<Platform>: ...
```

Generated captures normally ignore explicit turns shorter than three characters. Tiny conversations preserve one- and two-character turns so provider-free direct carries such as “hi” are not lost.

The scraper never truncates. It records local capture metrics and the exact transcript in Latest Run storage for 24 hours. The content script rejects more than 350,000 JavaScript characters immediately before asking the background worker to summarize. The backend separately rejects more than 1.4 MB of UTF-8 transcript data.

## Where time is actually spent

### Fixed and bounded waits

| Phase | Normal platforms | Grok | Notes |
| --- | ---: | ---: | --- |
| Top-of-chat stable samples | about 420 ms minimum; 1.8 or 4.5 s cap | about 80 ms minimum; 700 ms cap | Every sample performs a complete turn scan; async paste-panel work can extend wall time beyond the nominal loop cap. |
| Second readiness wait after expansion | up to 1.2 s | up to 700 ms | Runs only when expansion reports activity. |
| Collapsed-content rounds | up to 240 ms per call | same | Excludes panel-opening and extraction time. Called before capture and on every sweep iteration. |
| Per moving sweep step | about 280-360 ms | about 80-100 ms | Grok may add 220 ms plus another stability confirmation when rendering is late. |
| Final unchanged boundary probe | about 280-360 ms | about 80-100 ms | Usually followed by terminal quiet. |
| Terminal quiet | 360 ms; Claude 1.4 s | 160 ms | Only used after no physical movement. |
| Empty-capture retry window | up to 1.8 s | same | Retries only the exact “no conversation” error, not transient role-verification failure. |
| Pasted panel open | up to 1 s per card | n/a | Claude and ChatGPT only. |
| Pasted virtual row settle | up to 600 ms per panel step, 250-step cap | n/a | Theoretical ceiling is very large when multiple cards exist. |

### Measured current fixtures

- Claude 78-turn / 62,177-character slow fixture: 61 advances and 20,398 ms inside the sweep; average advance gap 306 ms. The whole test took about 20.9 seconds.
- Grok 40-turn fast fixture: about 982 ms including preparation and capture.
- Grok 24-turn fixture with 140 ms delayed renders: about 1,434 ms.
- Delayed older-history preparation fixture: about 776 ms.

These are fake-DOM fixture timings. They demonstrate that fixed waits dominate controlled runs, but they understate real DOM costs.

### Synchronous CPU and layout cost

Every readiness or settle sample can do all of the following:

- run several broad `querySelectorAll()` calls across the page;
- locate and score the composer again;
- call `getBoundingClientRect()` and `getComputedStyle()` for many candidates;
- deep-clone every candidate subtree and read its text;
- rebuild the containment tree;
- repeatedly inspect descendant sets while scoring broad wrappers;
- run an LCS matrix between the accumulated sequence and the current window.

The fake DOM does not model layout/style calculation, subtree-clone cost, browser rendering contention, or the size of real AI application trees. On a long real page, these synchronous costs can become comparable to or larger than the configured sleeps.

The candidate-selection phase contains several quadratic patterns over the number of matching elements. LCS matching itself is O(accumulated turns × rendered turns) in time and matrix memory. This is acceptable for ordinary windows, but becomes expensive if selectors expose hundreds of fragments or near-duplicate merging inflates the accumulated list.

## Fragility and likely failure modes

### S-01 — Moving-scroll delayed renders can be skipped (high)

Confirmed behavior: ChatGPT, Claude, Gemini, and DeepSeek can advance again after a moving step's 360 ms settle window even if the rendered signature never changed. Only Grok waits specifically for a late post-scroll window.

Why it matters: a slow virtualizer can leave the old window mounted while the scroll position advances. Repeating that sequence can jump over unseen turns. This is the leading code-level hypothesis for the documented ChatGPT 40-to-27 under-capture, but a live failing trace is still required to prove causality.

### S-02 — Stability ignores text identity (high)

`isConversationReadinessStable()` and `isConversationWindowStable()` compare turn count, total characters, height, and position, but not the already-computed turn signature. A virtual window can replace content with different same-length turns and still be called stable. Conversely, harmless height or scroll-top jitter can consume the entire timeout.

Why it matters: aggregate equality is not proof that the same conversation window survived multiple frames.

### S-03 — Multi-root scrolling can move the wrong surfaces (high)

Outside ChatGPT, discovery may cache and advance several nested scrollables, document roots, and the window together. A movement in any one makes `pixelMoved` true, even if the actual conversation root did not advance.

Why it matters: unrelated movement can suppress terminal checking and make the loop believe it is progressing through conversation history. Simultaneously moving nested roots can also skip or reorder virtual windows.

### S-04 — Scroll-root remounts are only partially handled (medium-high)

The cache refreshes when a node disconnects, but not when a connected node ceases to own the active conversation. ChatGPT chooses a root from the first currently structural turn and also caches it.

Why it matters: SPA transitions and virtualizer remounts can leave the sweep attached to a stale but connected container.

### S-05 — Repeated pasted-card remounts can inflate the transcript (high, confirmed mechanism)

Pasted-card attempts and captures are keyed by DOM element identity. `reconcileCapturedPastedContent()` appends every captured `fullText` not already contained verbatim in a selected turn. A remounted logical card is a new element, and progressively richer payload versions are not recognized as replacements.

Why it matters: one pasted payload can be accumulated many times, potentially pushing an otherwise valid conversation over the 350,000-character limit. Existing coverage proves one remount but not a chain of repeated remounts.

### S-06 — Exact deduplication deletes genuine repeats outside ChatGPT (medium-high)

Claude, Gemini, Grok, and DeepSeek have no stable source ID in the current implementation. Final deduplication therefore removes every later turn with the same role and exact text.

Why it matters: legitimate repeated prompts or answers silently disappear. Weakening this blindly would reintroduce DOM-copy inflation, so both cases need paired evidence.

### S-07 — Near-duplicate partial renderings can inflate or misorder turns (high)

Compatibility requires exact text or a 24-character whole-boundary containment relationship. Streaming rewrites, citation changes, formatting changes, short turns, or middle-only fragments may not match. A no-anchor window is appended; ambiguous repeated text can give LCS the wrong anchors.

Why it matters: the final exact dedupe removes only identical identities, so near-duplicates can survive as extra turns and windows can be inserted in the wrong location.

### S-08 — Streaming is inferred, not explicitly controlled (high)

There is no check for a visible generation/stop control or provider streaming state. Growth in count, characters, or height usually delays preparation, and longer renderings can replace shorter ones, but same-length rewrites and updates after the sweep has passed are not protected.

Why it matters: a transfer started while the source AI is still responding can capture a partial or internally inconsistent answer.

### S-09 — Broad selectors and semantic role guessing are DOM-sensitive (high)

Generic selectors include message-like classes, `.markdown`, and `article`; role detection can infer from semantic words in eight levels of ancestors. Containment scoring then tries to recover the true boundary.

Why it matters: site redesigns can turn UI panels, citations, tool results, nested Markdown, or wrapper text into false turns—or remove the role evidence and make capture fail. Failing closed is safer than broad page text, but it still produces user-visible breakage.

### S-10 — Visible text is not the full conversation payload (medium-high)

The scraper reads rendered text, not message data. It does not preserve link destinations when only link labels are shown, image meaning beyond visible text, canvas output, downloadable artifacts, hidden code, rich table structure, or provider-side metadata. Message controls and citation chrome can be included when they are inside the chosen boundary.

Why it matters: Cap Context is coding-focused, and exact URLs, file paths, code formatting, tool outputs, and attachment contents are often the most valuable context.

### S-11 — Expansion clicks are broad, English-only, and repeated (medium)

The scraper clicks controls whose labels match general English phrases inside main/conversation-like areas. The same scan runs every sweep iteration and can click a persistent control more than once.

Why it matters: localized expanders are missed; unrelated “show more” controls may be activated; toggle-style controls could be reopened or collapsed; repeated full-page scanning costs time.

### S-12 — Capture limits are enforced late and differ by unit (medium-high)

The 350,000-character check happens after the full sweep. The 1.4 MB UTF-8 limit exists only on the backend. A CJK/emoji-heavy transcript may pass the local character check, be transmitted, and then fail encoded-size validation.

Why it matters: known-doomed captures can spend minutes and memory before failing, and local behavior does not fully match the server boundary. Any improvement must still fail explicitly rather than truncate.

### S-13 — Capture has no independent end-to-end deadline or cancellation signal (high)

The loop is bounded by 480 advances, but each advance can wait, scan, expand, and open nested panels. The page's six-minute running reset does not abort capture.

Why it matters: a pathological page or several virtualized paste panels can outlive the visible transfer lock, after which a second transfer may start while the first is still scraping.

### S-14 — Stale-limit logic is effectively bypassed (medium)

The code increments `staleScrolls` only when there was no window change, no new turn, and no pixel movement. But the preceding no-movement/unchanged branch already performs the quiet check and breaks when still unchanged. In ordinary control flow, the three-scroll and Claude ten-scroll stale limits therefore do not provide the advertised safety boundary.

Why it matters: constants, comments, and metrics suggest a protection that does not materially govern the current loop.

### S-15 — Empty retry is narrower than transient capture failure (medium)

`scrapeConversationTextWhenReady()` retries only the exact empty-chat error. If message-shaped nodes exist but role attributes or wrappers are half-mounted, capture throws a role-verification error immediately.

Why it matters: the system waits for “nothing rendered” but not for “rendered halfway,” even though both are normal SPA states.

### S-16 — Diagnostic data cannot explain a real miss (high observability gap)

The sweep computes scroll count, sweep duration, turn count, stale count, and terminal quiet count. These appear in the local trace detail, but `exitReason` is never included. There is no record of selected scroll-root identity, per-window turn ranges, overlap ratios, delayed-render waits, merge insertions, dedupe removals, pasted-card versions, or where an expected turn disappeared.

Why it matters: final turn/character counts cannot distinguish early exit, wrong root, late rendering, role rejection, merge loss, or deduplication. That is why the live ChatGPT miss remains unexplained despite many deterministic tests.

### S-17 — Capture mutates the source page without restoring it (low-medium)

The process scrolls the chat to the top, sweeps to the bottom, clicks expanders, and opens/closes paste panels. There is no restoration of the original source scroll position on failure.

Why it matters: when capture fails and the user remains on the source tab, their reading position and expanded UI state may have changed.

## Test coverage: strong areas and gaps

### What is covered well

- Empty-chat rejection and no broad page-text fallback.
- Composer and prompt-suggestion exclusion.
- Structural role detection and Claude wrapper/fragment selection.
- ChatGPT stable IDs preserving genuine repeated text while collapsing duplicate DOM copies.
- LCS merge behavior for overlap, richer turns, interior insertion, and exact duplicates.
- Delayed older-history loading and character growth during top preparation.
- Tall-message movement, boundary `scrollIntoView()`, and slow Claude terminal loading.
- Grok fast capture plus a 140 ms delayed-render case.
- Collapsed content and one Claude/ChatGPT pasted-content-panel path.
- More than 160,000 characters surviving without middle truncation.
- A 78-turn, 62,177-character slow Claude fixture.

### What remains under-tested

- Current logged-in DOMs for all five platforms.
- The documented ChatGPT 40-to-27 miss and the separate 120+ turn report.
- Post-scroll render delays beyond 360 ms on ChatGPT, Claude, Gemini, and DeepSeek.
- Different windows with equal turn count and equal total character count.
- Actual conversation-root remounts or ownership changes while the old root remains connected.
- Multiple candidate scroll roots where only one owns the virtualizer.
- Repeated Claude paste-card remounts with progressively richer versions.
- Genuine repeated identical turns on Claude, Gemini, Grok, and DeepSeek.
- Streaming responses, same-length rewrites, citations arriving late, and generation ending mid-sweep.
- Localized expanders and toggle-style “show more” controls.
- Attachments, images, tool cards, tables, code canvases, links, and other non-plain-text message content.
- UTF-8 byte overflow below the JavaScript-character cap.
- Capture cancellation, the 480-step limit, and interaction with the six-minute running reset.
- Performance against a real large application DOM rather than the custom `FakeElement` implementation.

The installed Brave smoke proves only a two-turn controlled ChatGPT-like source reaches a stub backend and pastes into a controlled Claude-like destination. It does not exercise virtualization, real selectors, a logged-in site, large history, pasted cards, streaming, or the other source platforms. `npm run gate` does not include that smoke.

## Realistic ways to improve reliability

These are design directions, not approved fixes.

### 1. Make each advance evidence-based

After a physical scroll, wait for one of three explicit outcomes: a changed rendered-window identity that becomes stable, a proven same-turn tall-content traversal, or a bounded failure to observe progress. Do not treat pixel movement alone as proof that a virtualized batch was captured.

If a new window has insufficient ordered overlap, reduce the step or backtrack until overlap is recovered. This turns completeness from a timing assumption into a checked invariant.

### 2. Include identity in stability

Use the ordered turn signature, or an equivalent DOM-generation counter, alongside count/characters/geometry. Stability should mean “the same window persisted,” not merely “two different windows have the same totals.”

An observer on the authoritative conversation root can wake the check immediately; a timeout should remain as a safety ceiling.

### 3. Select one authoritative scroll root per platform

Discover and validate the root using message ownership, overflow, geometry, and observed response to a tiny probe. Revalidate when it remounts or stops affecting the rendered turn window. Avoid moving every plausible root and the window together.

ChatGPT's structural path is a useful starting pattern, but it also needs live validation that the nearest overflow ancestor is the actual scrolling owner.

### 4. Add delayed-render protection to every platform adaptively

Grok's fast path demonstrates the right shape: a short normal settle plus a targeted delayed-render guard only when the expected window change is absent. Generalize the principle using observed mutations and overlap, not one global longer sleep.

This can improve both reliability and speed: fast pages return as soon as confirmed stable, while slow pages wait only when evidence says they are late.

### 5. Give pasted content logical identity

Track a paste by owning turn identity plus stable card metadata and a content fingerprint, not DOM node identity alone. When a later capture is a richer version of the same logical payload, replace the earlier version; do not append it. Preserve multiple genuinely distinct paste cards and add hard non-truncating size checks during accumulation.

### 6. Separate genuine repetition from duplicate rendering

Use provider stable IDs wherever available. Where they are absent, investigate structural turn indexes, accessibility position metadata, stable React/DOM attributes, or sequence position plus neighboring anchors. Any change must be tested against both genuine identical repeats and duplicated virtual DOM snapshots.

### 7. Detect active generation explicitly

Before capture, detect provider-specific streaming state or require the last rendered turn to remain stable through a longer confirmation window. The product can either wait, present a clear “finish generating first” failure, or capture an explicitly marked partial response; silently racing the stream is the weakest option.

### 8. Fail early on both size limits

Track approximate serialized characters and exact UTF-8 bytes while turns and paste payloads accumulate. Once a complete, non-truncated capture is guaranteed to exceed the supported limit, stop work and return the existing explicit oversized error. Do not silently discard middle content.

### 9. Preserve source-page state

Record the authoritative root and original scroll offset. Restore it on capture failure, and decide explicitly whether successful handoff should leave the source at the bottom or restore the original reading position. Expansion-panel restoration should be limited to UI Cap Context itself opened.

## Realistic ways to improve speed

### 1. Replace polling rescans with mutation-driven snapshots

Observe the conversation root and recompute only when relevant descendants change. A two-animation-frame quiet period after a real mutation is usually cheaper than rescanning the entire page every 40/140 ms.

### 2. Narrow candidate extraction before optimizing waits

Prefer platform message boundaries and query generic selectors only as a fail-closed fallback. Cache the selected composer and authoritative root for the capture generation. Extract text once per newly seen/changed message node instead of cloning all candidate subtrees on every sample.

### 3. Scan expanders only in newly rendered windows

Track controls already attempted and inspect the current message window, not every button in the document on every advance. Keep retries only for nodes whose content or identity actually changed.

### 4. Replace full LCS where stable IDs exist

With stable turn IDs, merge by ID and order directly. Without IDs, use bounded suffix/prefix overlap first and reserve full LCS for ambiguous windows. This reduces repeated O(accumulated × rendered) matrices without weakening the hard cases.

### 5. Add a provable short-chat fast path

A fast path is safe only when the scraper can prove the conversation is non-virtualized and fully mounted—for example, one validated root, no remaining scroll range, stable message identity, no active generation, and no collapsed/pasted content pending. A simple turn-count threshold is not proof.

### 6. Keep platform-specific timing profiles evidence-based

The Grok optimization is a good precedent because it retained delayed-render coverage. Similar tuning for other platforms should start from logged per-step traces and real DOM fixtures, not blanket reductions to 140/360 ms constants.

### 7. Consider incremental background capture only as a larger architecture project

Observing turns as the user chats could make final transfer nearly instant, but it introduces long-lived state, SPA/chat identity, edited/deleted messages, virtualization reconciliation, privacy expectations, extension restarts, and stale-cache risk. It is realistic only after the one-shot capture contract is fully characterized; it is not a small speed patch.

## Recommended evidence before any implementation

1. Add local-only capture diagnostics for sweep exit reason, selected root, per-step scroll position, rendered turn IDs/count, window-change latency, overlap, merge/dedupe counts, and pasted-card versions. Do not send text-derived diagnostics to telemetry.
2. Reproduce the known long ChatGPT miss and record which exact turn IDs disappear and at which step.
3. Capture sanitized DOM-shape fixtures from current ChatGPT, Claude, Gemini, Grok, and DeepSeek pages.
4. Add adversarial timing fixtures for equal-length window swaps, 400-1,500 ms delayed renders, root remounts, multiple roots, active streaming, and repeated pasted-card remounts.
5. Establish correctness invariants first: every expected source turn appears once and in order; richer renderings replace partial versions; genuine repeats survive; DOM duplicates do not; oversized input fails explicitly.
6. Only then compare alternative settle/merge strategies on completeness, wall time, DOM scans, layout reads, and memory.

## Bottom line

The scraper has strong safety intent and a solid deterministic foundation, but it is still a polling-and-heuristics system operating against unstable third-party virtual DOMs. The current speed is mostly the price of fixed stability waits, while the remaining data-loss risk comes from advancing without proof that the new rendered window was observed. The first improvement should be better evidence and stronger per-step invariants; once those exist, the same work can safely remove much of the waiting and repeated DOM work.
