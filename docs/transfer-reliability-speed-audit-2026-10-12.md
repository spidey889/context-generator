# Transfer failures and speed audit

Read-only investigation, October 12, 2026, Asia/Kolkata. Only this report was created. No application code, configuration, database rows, extension installation, deployment, Git commit or push was changed.

## What is causing the trouble

The strongest findings are a release gap, repeated Claude destination rejection, and expensive DOM capture after JSON recovery. Some reported failures are intentional empty-chat/draft/navigation protection. Older diagnostics cannot establish the underlying cause of several JSON failures.

1. **The public extension is behind the checkout despite the same version number.** Google's actual download contains content script `v131`; this checkout contains `v142`. Several recently implemented reliability improvements have therefore not reached that public package.
2. **Claude delivery is a repeated failure point.** Seven attempts explicitly ended with `destination_not_new_chat`, all targeting Claude. Fresh-tab recovery also failed. The exact rejected page was not recorded, so a native redirect, route incompatibility or message-detection issue remains unproven.
3. **DOM scrolling consumes minutes and can exhaust the transfer deadline.** Six attempts timed out during DOM capture. Three successful DeepSeek sweeps took 203–337 seconds and stopped at the 480-advance cap.
4. **Repeated sequence matching can make those sweeps expensive.** The current algorithm performs a full quadratic comparison for large rendered windows. An isolated 1,000-by-1,000 comparison took approximately 1–1.4 seconds on this machine, before browser DOM work or settling waits.
5. **A capped sweep can continue without proving capture completion.** A controlled probe reached 480 advances with unchanged turns and remaining scroll distance, then returned the initial text instead of rejecting an incomplete capture. This is a reproduced integrity boundary, not proof that a particular historical transfer lost text.

The first practical priorities are distributing the reviewed client changes, tracing Claude's actual rejected landing state, and fixing DOM capture cost/completeness together. Switching summary models alone would leave the largest observed capture and delivery problems intact.

## Scope and evidence

Evidence labels used below:

- **Recorded:** fresh aggregate queries against production metadata.
- **Verified artifact:** the public extension downloaded from Google's update service and inspected in memory; never installed or executed.
- **Reproduced:** current source executed in an isolated Node VM with controlled inputs.
- **Code rule:** behavior directly visible in the inspected source.
- **Hypothesis:** plausible explanation requiring a live trace or matched experiment.

Source snapshot: `b48b792f88b948f4b95c1e5e7e239cf1e82e3de5`, branch `codex/json-transient-retry`. The local `origin/master` ref resolves to the same commit. Vercel's production alias independently reported that commit as READY, deployment `dpl_AzA7d6Y8czWEzyjEyGTKGHMiQokh`, region `iad1`. This verifies backend deployment metadata; it does not certify browser behavior.

Database: `cap-context-telemetry`, project `iqkzynzxbmemhtiupwwu`, `public.transfers`. The schema was checked before querying. Queries were SELECT-only and returned aggregates; no chat text, raw URLs, install IDs or account identifiers were collected in this report.

Final inventory check: **October 12, 18:51:35 IST**. The retained attempt range was **October 9, 21:39:02 through October 12, 18:28:02 IST**. Inventory stayed at 46 rows across the investigation. The earlier JSON audit's 82-row snapshot is historical and was not reused as the current inventory. Retention/selection can change; these rows are not a complete usage history or a representative reliability sample.

## Fresh transfer totals

**46 retained attempts: 14 succeeded, 32 failed, zero still marked started.** Forty-one have nonempty diagnostics. Five have `diagnostics_revision = 2`; those five contain four successes and one navigation-related delivery failure. The remaining records do not establish which newer client changes were running. Version `1.4.16` alone cannot distinguish the public package from newer unpacked code.

| IST date | Attempts | Succeeded | Failed |
| --- | ---: | ---: | ---: |
| October 9 | 3 | 2 | 1 |
| October 10 | 5 | 2 | 3 |
| October 11 | 21 | 6 | 15 |
| October 12, through snapshot | 17 | 4 | 13 |
| Total | 46 | 14 | 32 |

The raw failed share is 69.6% **of this retained set**. It includes four empty-chat attempts, three cancellations and three protected-draft outcomes, along with real faults and unknowns. Do not publish it as the product's population failure rate or reinterpret an acknowledged copy dialog as successful paste.

| Recorded terminal reason | Count | What the evidence establishes |
| --- | ---: | --- |
| `paste_failed` | 15 | Seven Claude new-chat rejections; three draft rejections; one navigation rejection; four without an observed detailed cause. |
| `capture_failed` | 5 | Three ChatGPT JSON failures with `unknown_error`; two DOM deadline expirations. |
| `client_interrupted` | 4 | All four explicitly record `transfer_timeout` during DOM capture. The broad label does not establish browser shutdown. |
| `no_conversation` | 4 | Admission rejected empty/unusable source history almost immediately. |
| `user_cancelled` | 3 | Two destination-tab closures and one source capture cancellation. |
| `summary_failed` | 1 | A transfer deadline error after long DOM capture and local summary recovery; not proof the model itself failed. |

Destination totals describe where an attempt was headed, not where its defect originated: Claude 3 successes/17 failures; ChatGPT 4/6; Gemini 2/5; DeepSeek 0/4; Grok 4/0; Clipboard 1/0. The small samples and shared source failures prevent a destination-quality ranking.

## 1. Same version, different shipped client

**Verified artifact, high confidence.** At October 12, 18:50:42 IST, Google's update endpoint returned a 1,697,856-byte CRX for extension `lpkaciijlhckkdhbgidbjfkldigghnjf`.

| Item | Public CRX | Inspected checkout |
| --- | --- | --- |
| Manifest version | `1.4.16` | `1.4.16` |
| Content script ID | `platform-content-2026-10-10-paste-deadline-recovery-v131` | `platform-content-2026-10-12-json-transient-retry-v142` |
| One fresh retry for temporary JSON failures | Absent | Present |
| Detailed capture failure/progress reporting | Absent | Present |
| First protected draft prevents another destination | Absent | Present |
| Acknowledged source draft-copy recovery | Absent | Present |
| Active-reply snapshot helper | Absent | Present |
| Native structured message handoff | Absent | Present |
| `SUMMARY_NEAR_END` early reveal | Absent | Present |
| NDJSON summary transport | Present | Present |

The public worker actually sends `Accept: application/x-ndjson`; streaming is already shipped. The live backend's newer first-answer watchdog can therefore benefit that client. Do not incorrectly attribute the release gap to missing streamed transport.

Repeated artifact reads returned matching script hashes:

- Public `platform-content.js` SHA-256: `9321e15adae4debea02c2a94c1ceb9f7757994b9f4f95ce60f7b983c0fdba205`.
- Public `background.js` SHA-256: `6b77a8411807f2e78a46e08049bbec1f9bd0bc515919d5ec307787e3b71dd48d`.

**Effect:** a backend deploy or matching version label cannot deliver these client improvements. Missing new diagnostics are consistent with older scripts, but do not prove an individual install's build. The exact browser build was not inspected.

**Recommended direction:** package the reviewed source under a distinct release version; validate the resulting CRX's script IDs/hashes and intended capabilities, then distribute through the normal release process. For future diagnostics, record a bounded client build identifier alongside the manifest version. No packaging/publication was performed here.

References: [Store listing](https://chromewebstore.google.com/detail/cap-context/lpkaciijlhckkdhbgidbjfkldigghnjf), [Google update request](https://clients2.google.com/service/update2/crx?response=redirect&prodversion=142.0.0.0&acceptformat=crx2,crx3&x=id%3Dlpkaciijlhckkdhbgidbjfkldigghnjf%26uc), [earlier release-gap report](claude-paste-release-gap.md), `extension/platform-content.js:2`.

## 2. Claude new-chat rejection survives recovery

**Recorded plus code rule, high confidence about the rejection; underlying native cause unknown.** Seven detailed paste failures recorded `destination_not_new_chat`: five DeepSeek→Claude and two ChatGPT→Claude. All seven record fresh recovery, and none record `claude_page`.

The worker opens `https://claude.ai/`. Both worker and content script allow only `/` and `/new` as Claude landing paths. Content delivery also rejects detected existing messages before insertion. These protections are intentional. A native login/other redirect, unrecognized legitimate landing route, or false message detection could produce the same historical error; no retained observation distinguishes them.

Some affected transfers already finished capture and remote summarization. Three DeepSeek JSON attempts spent an average 39.9 seconds summarizing before Claude delivery failed. Source work/model success does not establish successful transfer.

**Recommended direction:** use a failing live build to observe the current closed page label, platform/route booleans and detected-message count in both prepared and recovery tabs. If an unsupported but genuinely empty native route is confirmed, adjust that exact adapter. If auth is required, surface that actionable state promptly. Preserve saved-chat and draft guards; broadening the allowlist without evidence risks placing context in an existing conversation.

Source: `extension/background.js:1594`, `extension/platform-content.js:2751`, `extension/platform-content.js:2880`. Current redacted instrumentation is documented in [transfer diagnostics](transfer-diagnostics.md).

## 3. JSON rejection sends the transfer into a costly sweep

**Recorded, high confidence about the slow path; original JSON causes often unknown.** Fourteen retained attempts have a JSON fallback category: seven `size_limit`, four `incomplete`, three `unavailable`. Five finally succeeded and nine failed. A recovered capture error is not automatically the cause of a later paste failure.

- DeepSeek size fallbacks captured 50,691 characters in two successes, and 64,947/128,367 characters before two Claude delivery failures.
- One Gemini size fallback captured 205,041 characters before a draft rejection; two others timed out during capture.
- All fourteen lack `capture_detail`. Three terminal ChatGPT JSON failures also lack specific cause evidence and report `unknown_error` after roughly 13–14 seconds.

The network MAIN adapter shares a **6,000,000-byte raw response budget** and **25-second native deadline**. DeepSeek qualifying attachments additionally share **1,400,000 bytes**. ChatGPT permits 32,000,000 raw bytes under a 15-second native deadline; Claude permits 6,000,000 under 15 seconds. These allowances differ from the final 500,000-character/2,000,000-byte transfer bounds. Metadata, branches, pages and qualifying file work can exhaust JSON limits while transferable text would fit.

**Recommended direction:** first distinguish raw-response, attachment and selected-transcript limits in fresh diagnostics. Then inspect the relevant native response shape, byte consumption and authentication/readiness state before changing budgets. Prefer reducing unnecessary native payload when the endpoint supports it; evaluate a larger bounded allowance with memory/latency evidence. Merely raising every ceiling can increase download time and memory while retaining incomplete-history problems.

Current source already retries recognized temporary failures once. The public package lacks that retry. Hard limits, invalid history, access/rate limits and navigation are deliberately not retried. ChatGPT's ordinary failed fast capture remains terminal; the active-reply snapshot exception and explicit Speed opt-out are separate paths.

Source: `extension/network-fetch-main.js:98`, `extension/network-fetch-main.js:125`, `extension/network-fetch-main.js:227`, `extension/platform-content.js:7741`, `extension/platform-content.js:7756`, `extension/platform-content.js:7796`. The [earlier JSON audit](json-capture-failure-audit-2026-10-12.md) contains additional synthetic MIME/root/attachment findings; their historical production frequency remains unknown.

## 4. DOM capture has both a CPU cost and a completion boundary

**Recorded and reproduced.** Three successful DeepSeek attempts recorded `max-advances-reached` at 480 scrolls. Capture times were 203.1 seconds for 121,370 characters and approximately 334.6/336.8 seconds for two 50,691-character captures. A fourth capped DeepSeek capture took 344.3 seconds and later failed.

Six other attempts expired during DOM capture around 360 seconds. Gemini reached a 329.8-second successful capture before a later draft rejection. These are minute-scale source costs; the normal 350 ms activation and 550 ms stability waits cannot explain them.

The sweep calls `collectRenderedConversationTurns` repeatedly. `getConversationSequenceMatches` allocates an `(accumulated turns + 1) × (rendered turns + 1)` matrix and performs comparisons across it. Comparisons normalize text repeatedly. A nonvirtualized page that leaves most history mounted can therefore cost much more than a small virtual window.

Controlled source-function measurements, synthetic ~200-character turns:

| Accumulated turns | Rendered turns | Matrix comparisons | Measured time |
| ---: | ---: | ---: | ---: |
| 100 | 100 | 10,000 | 17 ms |
| 500 | 500 | 250,000 | 242 ms |
| 1,000 | 1,000 | 1,000,000 | 1,008 ms; separate run 1,404 ms |
| 1,000 | 20 | 20,000 | 61 ms in the separate run |

These are isolated CPU probes, not browser benchmarks or an attribution of each historical second. DOM selection, visible-text extraction, expansion and settling add other work. `waitForConversationWindowToSettle` normally requires two 140 ms samples for these platforms, and each sample inspects the rendered conversation again. CPU work and wait costs accumulate over hundreds of advances.

A second probe executed the actual sweep function with controlled browser helpers: unchanged rendered turns, physical movement on each advance, positive remaining distance, and no active reply. After 480 advances it returned `INITIAL_ONLY` with `sweep_exit = max-advances-reached`. The cap stops the loop; it does not prove the history ended. The public package also contains the same 480 cap and LCS helper.

**Recommended direction:** avoid realignment when the verified window is unchanged; pre-normalize identities/text; use stable native IDs where available and inexpensive exact-window/ordered-tail cases before general LCS. Keep the general alignment path for ambiguous overlap. Give the chat one validated scroll owner, and distinguish chat progress from scrolling another nested container. Only ChatGPT currently has a dedicated nearest structural-turn scroll root; the other path scans multiple potential roots. Extra-root movement is a plausible contributor, not an observed cause in these rows.

Reaching an advance/time budget with remaining unverified history needs an explicit incomplete outcome or an explicitly described partial-capture choice. Do not gain speed by silently accepting a prefix, removing overlap validation or indiscriminately shortening all settle waits. Preserve taller-than-viewport responses and delayed virtual mounting in regression coverage.

Source: `extension/platform-content.js:3513`, `extension/platform-content.js:3748`, `extension/platform-content.js:1714`, `extension/platform-content.js:1597`, `extension/platform-content.js:2203`.

## 5. The deadline leaves little delivery time after a long sweep

**Recorded plus code rule.** The overall client deadline is 360 seconds. It covers capture, summary and delivery together. One failed attempt records 344.3 seconds capturing, then 8.9 seconds of local summary recovery, and eventually a 489.6-second diagnostic duration with `transfer_timeout` at `summary_complete`. That overrun does not establish its exact cause.

Current synchronous DOM/sequence work cannot be preempted by a JavaScript timeout callback. Deadline checks at operation boundaries can reject after expensive work, but cannot interrupt a running comparison. Hidden-tab scheduling is another possible contributor; no browser scheduling trace was collected.

**Recommended direction:** make expensive capture work yield and check its deadline in bounded chunks, and reserve enough remaining time for summary/delivery. Make the capture budget/completeness outcome explicit. Finish with the already verified carry when policy permits, preserving source recovery. A bigger global timeout alone prolongs the wait and does not repair capture or landing compatibility.

Source: `extension/platform-content.js:1361`, `extension/platform-content.js:3748`, `extension/platform-content.js:2455`; summary chain in `api/summarize.js:465`.

## 6. Drafts, empty chats and cancellation inflate the failed count

**Recorded plus intentional rules.** Three paste failures record `editor_has_draft`; all three older outcomes opened fresh recovery. A fresh site tab can restore its native draft, so opening another tab does not reliably produce an empty editor.

Current source already returns the first draft rejection without fresh-tab recovery and offers the exact carry in source/destination copy dialogs. An acknowledged source dialog is handled `text_box`, not successful paste or confirmed clipboard copy. The public package lacks this client acknowledgement and early stop, so the newer database interpretation cannot relabel those historical outcomes.

Four empty-chat admissions finished in 1–3 ms. Three attempts were cancelled. These should remain visible operational outcomes, with suitable denominators. The `conversation_changed` delivery failure also records the guard's observation, not necessarily a code defect; it requires a native navigation trace to establish why it fired.

**Recommended direction:** distribute the existing draft recovery and report success, copy-ready, cancellation, empty admission and technical failure separately. Do not overwrite drafts or weaken the navigation latch to improve a success metric.

Source: `extension/background.js:1508`, `extension/platform-content.js:7796`, `extension/platform-content.js:2455`, [current lifecycle](../LOGIC.md#paste-and-activation-order).

## 7. Summary speed is a secondary but measurable opportunity

**Recorded plus code rule.** Sixteen attempts record remote summary mode. Observed summary times span approximately 6.1–53.9 seconds, including transfers that later failed in delivery. Two successfully recovered summaries record OpenRouter HTTP 429; a successful Gemini fallback and its cached reuse retain a prior Gemini 503. These establish recovered provider errors, not total provider-error frequency.

The current backend gives the first route up to 90 seconds, shares at most 270 seconds across the chain, and advances a streamed route after 30 seconds without meaningful answer text. Once answer text starts, the completion deadline remains. Route retries and reasoning/output caps affect latency. The public worker already uses streamed requests.

The one row classified `summary_failed` records a transfer deadline after slow capture. No retained terminal `summary_rate_limited`, `summary_service_busy` or `summary_access_denied` row was found. This does not establish provider uptime: missing reports and successful recovery hide individual provider failures.

**Recommended direction:** measure dispatch-to-first-answer, first-answer-to-valid-result and each failed route, stratified by input/profile/build. Compare provider/model configurations on matched inputs with fact recall and accepted-output quality. This sample is too small and unbalanced to select a faster primary model. Shorter output/reasoning budgets or earlier local recovery are product tradeoffs, not free speed gains.

The worker already shares in-flight identical summaries and caches eight exact results for two minutes. Only one retained attempt records cache mode. A longer cache is not the first fix for several-minute capture or Claude rejection; any change must preserve exact structured boundaries, model/prompt namespace and local privacy.

Source: `api/summarize.js:24`, `api/summarize.js:33`, `api/summarize.js:465`, `api/summarize.js:1021`, `extension/background.js:12`.

## Speed priorities and acceptance evidence

| Priority | Proposed work | Expected benefit | Evidence needed before calling it fixed |
| --- | --- | --- | --- |
| 1 | Release the reviewed client under a distinguishable version/build. | Existing recovery/diagnostics reach public users. | Downloaded CRX IDs/hashes and isolated installed-client checks. |
| 2 | Reproduce Claude's rejected fresh landing state. | Address the largest specifically diagnosed paste-failure group. | Both tab attempts' page label, route checks, message count, auth/composer state. |
| 3 | Repair JSON rejection paths supported by fresh detail. | Avoid minute-scale DOM recovery where complete JSON is available. | Native byte/structure/auth cause and equivalent complete captured history. |
| 4 | Remove repeated full-window DOM/LCS work; validate scroll ownership and capped completion. | Reduce capture CPU/waits without losing history. | Long/virtual/nonvirtual/tall-response trials with exact turn/text comparison and capture CPU time. |
| 5 | Bound capture work and reserve completion time. | Prevent an entire six-minute allowance being spent before delivery. | Deadline checks under CPU-heavy and delayed-timer cases; usable recovery content. |
| 6 | Tune remote summaries using matched quality and latency measurements. | Reduce the remaining seconds after capture becomes reliable. | First-answer/complete-result timings plus fact/constraint preservation; provider error history. |
| 7 | Examine destination readiness where timing proves it matters. | Reduce waits on slow native hydration. | Native tab load/composer/focus timings, with restored drafts preserved. |

For successful samples, DeepSeek JSON capture averaged 34 ms after selection (n=2), Claude JSON 56 ms (n=1), and ChatGPT JSON 2.95 seconds (n=3). Picker prefetch can finish before selection, so these are not complete native-fetch costs. Successful DOM sweeps averaged 291.5 seconds (n=3). Those samples differ in input size and are not a matched speed ratio.

Destination load/composer waits can also matter: recorded successful Claude page load reached 15.2 seconds and composer waiting 6.7 seconds, with sparse timing coverage. Preparation already overlaps source work. Source, worker and destination timing clocks differ and may overlap; adding their averages does not reconstruct total latency. Keep 350 ms focus settling, 550 ms retained-text checks, draft protection and lost-acknowledgement safeguards until targeted evidence justifies a change.

## Verification and limits

- Existing focused source tests completed successfully (exit code 0), command below. These verify tested current-source behavior; they do not certify the public artifact or current logged-in native UI.
- Two isolated in-memory source probes measured LCS scaling and reproduced acceptance at the sweep cap. No test/helper/source files were added or changed.
- The actual public CRX was inspected in memory; downloaded code was never executed. Both inspected script hashes differed from current source.
- Vercel production metadata matched the inspected commit. A one-hour runtime-log query was rejected by the retention boundary; a corrected 30-minute error/warning query returned no matching logs. The grouped runtime-error query failed to return a usable response. No claim of historical backend health follows from those checks.
- No live-account transfer, native payload capture, clipboard write, browser installation or paid provider evaluation was performed. The missing Claude page labels, old JSON details and CPU/browser traces remain unresolved evidence gaps.
- The checkout was clean at the start. At final verification, unrelated edits appeared in `scripts/run-extension-smoke.js` and `test/json-transfer-fallback.test.js`; this audit did not author or alter them. Test results above apply to the files as tested, before those later workspace edits. They were left untouched.
- Investigating the specific gaps above is more useful than repeating broad tests or polling unchanged telemetry. Work stopped after the main patterns, artifact gap and speed risks had concrete evidence, as requested.

```powershell
node --test --test-timeout=30000 --test-skip-pattern='^slow/release:' --test-reporter=dot test/background.test.js test/platform-content.test.js test/json-transfer-fallback.test.js test/transfer-diagnostics.test.js
```

## Read-only queries for refreshing the report

Refresh counts before reuse. Use an explicit cutoff for comparisons, and preserve started as its own outcome. This audit includes all currently retained installs; it does not inherit filters from previous chats.

```sql
SELECT (attempted_at AT TIME ZONE 'Asia/Kolkata')::date AS day_ist,
       status, count(*) AS attempts
FROM public.transfers
GROUP BY 1, 2 ORDER BY 1, 2;

SELECT status, failure_reason, last_stage,
       diagnostics->>'error_code' AS error_code,
       diagnostics->>'json_fallback_code' AS json_fallback_code,
       count(*) AS attempts
FROM public.transfers
GROUP BY 1, 2, 3, 4, 5 ORDER BY attempts DESC;

SELECT source_platform, status, diagnostics->>'capture_method' AS method,
       count(*) AS attempts,
       count(diagnostics->>'capture_ms') AS with_capture_timing,
       round(avg((diagnostics->>'capture_ms')::numeric)) AS avg_capture_ms,
       max((diagnostics->>'sweep_scrolls')::numeric) AS max_scrolls
FROM public.transfers
GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;
```

For an IST-day comparison add `attempted_at >= timestamptz '2026-10-12 00:00:00+05:30' AND attempted_at < timestamptz '2026-10-13 00:00:00+05:30'`. An absent diagnostic or timing stays unobserved; never substitute zero or infer a past native cause from a newer patch.
