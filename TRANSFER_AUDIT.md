# CapContext transfer audit

Date: 2026-10-05. Audited source: `c609165a8fd0fa972467c73907c78434ad87f643`, the refreshed remote `master` used to create `codex/transfer-audit` in a separate worktree.

Status rechecked on 2026-10-07 against current source: **4 of 7 findings are fixed (T01, T02, T06, T07); 3 remain open (T03, T04, T05).** Destination/source conversation guards, source-window placement and activation-error propagation are implemented. Delivery cancellation, respecting deliberate composer clearing and lost-response reconciliation still need follow-up. This status refresh used source inspection; the original reproductions were not rerun. See [LOGIC.md](LOGIC.md) for the current production behavior.

The finding descriptions, evidence line numbers, likelihood estimates and reproductions below preserve the original 2026-10-05 audit. They describe audit-time behavior unless a current status note says otherwise.

This is a source audit of work after transfer selection: the page lock, cancellation, worker restart, destination preparation, delivery and activation. No application code or existing documentation was changed. No browser was opened, automated or used for execution. Evidence comes from source inspection, existing Node tests and additional in-memory Node/VM fixtures using the repository's actual functions. Chrome API documentation was read to verify window selection. No live accounts, providers, deployment or production telemetry were queried.

Likelihood estimates are qualitative judgments about ordinary use, not measured failure rates. “Confirmed” means the implementation permits the described result and, where stated, a local fixture reproduced it; it does not mean every live platform exhibits it routinely. Pasting never automatically presses Send.

## Findings at a glance

| ID | Current status | Original problem | Audit-time normal-user likelihood | Original impact |
| --- | --- | --- | --- | --- |
| T01 | Fixed | A prepared destination can become another chat and still receive the carry | Occasional when the user uses the prepared tab; low when they wait in the source | High: private context placed in an unintended conversation |
| T02 | Fixed | Direct DOM capture can combine two source chats after navigation | Low overall with Fast capture on; plausible during toolbar/normal capture of long chats | High: unselected conversation text sent to the summary service and destination |
| T03 | Open | Closing a tab does not reliably cancel delivery already in progress | Low overall; predictable when trying to abort by closing tabs | Moderate: unwanted paste, recreated tabs or focus changes after cancellation |
| T04 | Open | Paste recovery can undo an intentional clear or reinsert a carry after Send | Occasional for immediate keyboard Send/clear; otherwise low | Moderate: an unwanted duplicate draft or recovery modal |
| T05 | Open | Lost acknowledgements leave ambiguous delivery; timeouts can create duplicate pastes | Low in healthy sessions; plausible with slow/suspended destinations or worker failure | Moderate: two copies, orphan tabs, apparent failure after successful paste |
| T06 | Fixed | Recovery can open the destination in a different browser window | Occasional for multiple-window users when fresh-tab recovery runs | Low to moderate: context appears in another window and focus is taken there |
| T07 | Fixed | Activation failure is swallowed and reported as success | Very low: a narrow tab-close race or a window/tab API failure | Moderate: the destination is missing or remains hidden despite reported completion |

## T01 — Destination ownership stops at the hostname

**Current status: fixed.** Delivery requires guarded new-chat routes; conversation/navigation guards also cover insertion and delayed recovery.

**Trigger:** Start a transfer, open its inactive prepared destination, and navigate within that site to another chat or start a conversation there before the summary arrives. Leave that conversation's composer empty. A similar change can happen between initial paste and delayed recovery.

**What happens:** The background reuses the same tab because it still belongs to the selected platform. It does not require the original new-chat route, document, conversation or account/workspace state. The content script then selects the currently ready empty composer. Delayed recovery also searches the current page without checking the original conversation or editor ownership.

**Evidence:** `extension/background.js:1089–1102,1170–1175,1260–1268`; `extension/platform-content.js:2253–2272,2283–2295,2382–2433`. `isPreparedDestinationTabUsable()` compares only the platform resolved from `pendingUrl || url`. `transferId` is passed into paste but is not used to bind its editor or route.

**Local reproduction:** A prepared Claude tab at `/chat/different` was reused without creating a fresh tab. Actual content-script paste accepted an empty composer at `/chat/unrelated`. Changing `/new` to `/chat/different-conversation` before the delayed check caused the carry to be inserted there too.

**Likelihood and harm:** Occasional for users who begin using the prepared tab during a long summary; low for users who simply wait. High impact because unrelated chats can receive private context. This is an unintended draft insertion; submitting that draft remains the user's action. Navigation to a different platform before the reuse check is already rejected, so this finding concerns same-platform state changes and later races.

## T02 — Direct DOM capture has no source-conversation guard

**Current status: fixed.** Source identity is pinned before capture and checked through DOM capture, attachment work, JSON fallback and dispatch; navigation cancels capture.

**Trigger:** Use the toolbar transfer or disable Fast capture, then switch source chats through the site's SPA navigation while capture is settling or scrolling through history.

**What happens:** The normal capture path checks the transfer deadline, but does not compare source identity. Its accumulated turns can survive the navigation while later snapshots come from another conversation. Those turns are summarized and delivered as one transcript.

**Evidence:** `extension/platform-content.js:820–860,1074–1089,2722–2727,2770–2792,2882–2914,6807–6817,6872–6895`. The picker records `sourceUrl`, but its comparisons apply only inside the JSON-failure fallback. The direct DOM branch and toolbar flow lack that guard. The navigation handlers at `9263–9272` update placement, not transfer cancellation.

**Local reproduction:** The actual DOM sweep began with a uniquely marked turn from chat A. The scroll fixture changed the pathname and mounted a uniquely marked turn from chat B. The returned transcript contained both A and B. A separate orchestrator fixture changed the source URL during direct DOM capture and still dispatched the captured B transcript without a cancellation error.

**Likelihood and harm:** Low across all transfers because saved-chat Fast capture is default-on. Plausible for normal/toolbar capture of a long history while the user navigates away. High impact: text from an unselected chat can leave the source for the backend and destination. The JSON bridges' navigation cancellation and the JSON fallback's final URL check are existing protections; they do not cover this direct DOM path. The fallback's final comparison also cannot detect a DOM-phase away-and-back change.

## T03 — Cancellation changes telemetry, not the running delivery

**Trigger:** Close the source after it has sent `TRANSFER_TO_DESTINATION`, while destination readiness/paste is pending. Alternatively, close the prepared destination while leaving the source transfer running.

**What happens:** Source removal records `failed/user_cancelled`, but does not abort the pending destination operation, revoke the attempt or notify its content script. Background delivery can still finish and, depending on the destination's activation policy, take focus. A missing prepared destination is deliberately replaced by one fresh tab, so closing that tab also does not stop the transfer. Reloading the source creates a new page-local lock while previously dispatched delivery can still run.

**Evidence:** `extension/background.js:107–109,342–359,769–803,1089–1155`; `extension/platform-content.js:879–887,9312–9323`. There is no transfer-cancel message or shared delivery cancellation token. Escape at `6470–6475` only dismisses an open picker.

**Local reproduction:** Held a destination response pending, invoked the actual source-tab removal handler, and verified `user_cancelled` was persisted. Releasing the destination still completed delivery to the prepared tab. The missing-prepared-tab fixture opened a replacement tab successfully.

**Likelihood and harm:** Low overall, but the result is predictable when a user tries to abort by closing tabs. Moderate impact: an unwanted carry or tab can appear after cancellation, and the recorded outcome can disagree with actual delivery. Closing the source during capture or summary, before delivery is dispatched, does **not** by itself cause a later paste; its source continuation is gone. The summary request may continue, which is a separate already-submitted operation.

## T04 — Empty does not distinguish app failure from user intent

**Trigger:** Immediately send the pasted carry, select all and clear it, or undo the paste during verification/recovery.

**What happens:** Recovery treats an empty composer as lost paste and inserts the carry again. It does not observe trusted Send, input, clear or undo actions. Claude, Gemini, DeepSeek and Grok run a check 550 ms after reveal; ChatGPT checks stability inside its retry loop and can reinsert during that loop. If sending temporarily removes/disables the input, the delayed path can show a misleading manual-copy modal instead.

**Evidence:** `extension/platform-content.js:2275–2315,2382–2433`. The delayed check preserves nonempty changed drafts, but its empty-editor branch cannot tell why the editor became empty. The ChatGPT stability branch continues retrying when its inserted text disappears.

**Local reproduction:** After a successful paste, deliberately cleared the fixture composer before its activation check. The actual content script restored the carry and clicked the editor a second time. Source inspection confirms there is no user-action listener that cancels this recovery.

**Likelihood and harm:** Occasional for a quick Enter-to-send or immediate clear; low when the user pauses to review the carry. Moderate impact: the sent carry can reappear as a second draft, intentional deletion is undone, or a failure modal interrupts a successful send. There is no automatic second submission, and nonempty replacement drafts are protected.

## T05 — A missing response is treated as failed delivery without reconciliation

**Trigger:** The original destination inserts text but its acknowledgement is delayed/lost, or the worker is terminated while preparation/delivery is in flight.

**What happens:** The messaging timeout uses `Promise.race()`; it stops waiting without cancelling the destination handler. Only the six-minute transfer deadline is sent to that handler, not the shorter 30/45-second response budget. A failed prepared attempt causes a fresh destination to receive the same carry, although the original may already contain it or still be working.

Worker startup restores telemetry/proofs and reinjects scripts, but has no persisted destination tab ID, delivery phase/acknowledgement or summary with which to resume or inspect delivery. If the source survives an interrupted response channel, it can report failure/manual copy without knowing whether the original tab pasted. Retrying starts another attempt. A lost preparation response similarly leaves an orphan prepared tab because its ID was held only in the lost response.

**Evidence:** `extension/background.js:59–62,126–130,278–302,321–325,1103–1143,1280–1288,1434–1448`; `extension/platform-content.js:865–918,1007–1021`. `pasteWithRetry()` does not use its `transferId` to deduplicate execution.

**Local reproduction:** Shortened only the response budget in memory to 25 ms and delayed the prepared tab's acknowledgement to 90 ms after simulated insertion. Both tabs 41 and 100 received the carry; the result identified only 100. A fresh worker sharing the original telemetry storage restored `started` and source tab 42, but had no destination tab/summary and sent no delivery-reconciliation message. This models state loss, not a real browser crash.

Production response budgets are 30/45 seconds, exceeding normal content retry budgets of 22/32 seconds. The duplicate-delivery scenario requires transport loss or suspended/late execution; a promptly failing editor normally returns within the response budget. The scaled fixture demonstrates the missing cancellation/reconciliation, not a measured live timeout.

**Likelihood and harm:** Low in a healthy active session; plausible with a suspended/slow destination or an actual worker failure. Moderate impact: duplicate carries, leftover tabs, or an apparent failure after successful insertion. The 25-second summary keepalive lowers ordinary idle-termination exposure; a routine worker wake between completed steps is not automatically a failed transfer. No restart frequency was measured.

## T06 — New tabs belong to the last active window, not the source window

**Current status: fixed.** `createDestinationTab()` resolves the source tab's current window and position, then supplies `windowId`, `index` and `openerTabId` for preparation and fresh recovery. A closed source fails instead of opening in an unrelated window.

**Trigger:** Start in window A, switch to window B during the transfer, and encounter fresh-tab recovery later. Initial preparation has a smaller version of the same race during the picker transition.

**What happens:** `createDestinationTab()` supplies URL and activation but no `windowId` or opener. The message handlers do not carry the source window through orchestration. Chrome documents that omitted `tabs.create.windowId` defaults to the current window, which for a service worker falls back to the last active window. The carry can therefore arrive in B, and final activation focuses B. [Tabs creation contract](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-create), [service-worker current-window rule](https://developer.chrome.com/docs/extensions/reference/api/windows#the-current-window).

**Evidence:** `extension/background.js:769–803,1123–1134,1224–1238,1246–1253`.

**Local reproduction:** With source window 1 and the stub browser's current window 2, actual recovery passed no `windowId`; its new destination was created in 2. The fixture's window choice follows the documented API default, not a live-window test.

**Likelihood and harm:** Occasional among multiple-window users when recovery runs, low for single-window users. Low to moderate impact: surprising focus changes and context appearing in another workspace window. This opens a new destination there; it does not select an arbitrary existing tab or overwrite an existing draft.

## T07 — Failed activation is reported as completed

**Current status: fixed.** `activateDestinationTab()` propagates activation/focus failures as `destination_open_failed` and preserves timeout errors. Failed activation cannot silently continue a focused paste or report successful switching.

**Trigger:** The destination disappears after its validation but before `tabs.update()`, or activation/window focus fails after a successful paste.

**What happens:** `activateDestinationTab()` catches every error except `transfer_timeout` and resolves normally. The verified activation handler consequently returns `{ ok: true }`; the source marks completion and releases the lock. The user can be left in the source while the destination is hidden, or with no destination at all.

**Evidence:** `extension/background.js:1246–1268,788–792,1152–1159`; `extension/platform-content.js:892–907`.

**Local reproduction:** Returned a valid Claude destination from `tabs.get()`, then made `tabs.update()` reject with “No tab with id: 41”. `ACTIVATE_DESTINATION_TAB` still returned success.

**Likelihood and harm:** Very low for ordinary use because the validation/activation race is narrow; also possible during an API failure. Moderate impact when it occurs: misleading success and a missing/unrevealed carry. The source copy modal is created before deferred activation, so that path retains manual recovery.

## Transfer lock and restart boundaries observed in the original audit

- The page-local `isRunning` check is set before the first transfer await. Repeated starts in the same document are rejected. Both picker and toolbar starts install the six-minute deadline. Deadline expiry marks the trace expired, finishes it and releases the source lock (`platform-content.js:733–745,1025–1043,6821–6839,9312–9323`). No permanent lock leak was confirmed in the reviewed active-page paths.
- Continuations check their own trace after asynchronous work; the expired-trace catch paths return before resetting a newer attempt. Expired destination requests reject before initial insertion. This deadline protection does not supply the cancellation/ownership missing in T01–T05.
- A same-version injection on worker startup exits before teardown (`platform-content.js:54–55`). Ordinary worker restart therefore does not itself reset a surviving source's lock. Reload/navigation into a new document does create a new lock; there is no background transfer lock to coordinate with older delivery.
- Missing/other-platform prepared tabs get at most one fresh-tab recovery. Nonempty drafts, including drafts restored synchronously on focus, are protected (`platform-content.js:2288–2293,2465–2471`). Those safeguards do not establish conversation ownership for an empty editor.
- Hidden-source paint waits have a bounded fallback and visibility cleanup. They are not an indefinite activation blocker (`platform-content.js:7817–7846`).

### What a worker restart can lose at each stage

| Stage when interrupted | Audit-time recovery boundary |
| --- | --- |
| Source capture | Source-page capture/lock can survive; a lost preparation response can orphan its tab. |
| Summary request | In-memory request/cache is lost. On response-channel failure, the surviving source has explicit full-transcript local recovery; it does not resume the remote request (`platform-content.js:965–1004`). |
| Destination delivery | Destination content work can outlive its sender. No persisted destination ownership or acknowledgement exists to reconcile it; see T05. |
| Paste complete, activation/response pending | Already-inserted text can remain, but completion/focus can be lost or falsely acknowledged; see T05/T07. |
| Telemetry delivery only | The outbox, active source metadata and signed receipts have durable restart coverage. This is telemetry recovery, not resumption of a transfer. |

## Original audit validation

Existing focused tests passed: **63/63** across `test/background.test.js`, `test/json-transfer-fallback.test.js` and `test/telemetry-delivery.test.js`; **8/8** selected paste/draft/expiry/paint cases from `test/platform-content.test.js`.

Commands used:

```text
node --test --test-timeout=30000 test/background.test.js test/json-transfer-fallback.test.js test/telemetry-delivery.test.js
node --test --test-timeout=30000 --test-name-pattern="expired destination paste|initial paste never|delayed paste recovery|restore a draft cleared|handoff finish" test/platform-content.test.js
```

The additional reproductions evaluated existing source and test helpers in memory, with fake DOM/tab/storage boundaries. They created no repository test files and made no backend requests. Their reported outcomes are described under each finding. Passing existing tests establishes the covered safeguards; it does not invalidate the demonstrated races or estimate their production frequency.

Remaining follow-up order: make cancellation revoke delivery and recovery (T03), preserve trusted user intent during paste recovery (T04), then reconcile delivery outcomes across lost responses/restarts (T05). T01/T02/T06/T07 are already fixed. This report's status update changes documentation only.
