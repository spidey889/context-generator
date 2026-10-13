# JSON capture failures: what to keep and what to remove

Updated: **2026-10-13, Asia/Kolkata**. Current capture source inspected: `8d8b6e82abd5b6aa3dc5ad805cab4ee7ae43769c` on `codex/json-capture-failures`. Original audit: 2026-10-12, source `1cf75964fbe710ecaca7e2c661149ad6a154dd7b`.

**Goal: keep complete, supported conversations on fast JSON capture whenever possible.** Remove unnecessary rejection and missed recovery before spending time on faster DOM scrolling. A faster capture is useful only if it preserves the selected conversation.

“JSON failed” here means the extension could not finish native-history capture. It does **not** necessarily mean `JSON.parse` failed: authentication, routing, transport, branch selection, files and size checks can stop capture too.

This is an investigation and work queue. Implementation follow-up on `codex/json-capture-failures`: interrupted ChatGPT/Claude body reads now use the existing fresh JSON retry; this is a source fix, not an installed-client release. [LOGIC.md](../LOGIC.md#capture) owns current behavior; [CHANGELOG.md](../CHANGELOG.md) owns implementation history. Source fixes do not establish which build an installed extension runs.

## Completed fixes and checked behavior

| Item | Current status | Evidence |
| --- | --- | --- |
| Interrupted ChatGPT/Claude JSON body downloads | **Fixed and pushed** in [8d8b6e8](https://github.com/spidey889/context-generator/commit/8d8b6e82abd5b6aa3dc5ad805cab4ee7ae43769c). Discard partial data and retry the whole read once. Invalid content, limits and cancellation remain protected. | Four regressions failed before the fix; 159 focused tests and [exact-commit Offline checks](https://github.com/spidey889/context-generator/actions/runs/38424329550) passed. |
| Regenerated reply selection | **Already works; no new code fix needed.** Keep the selected new reply, skip the unused old alternative and retain earlier selected history. | Six targeted tests and controlled Grok/DeepSeek captures passed. The user also reported regeneration followed by successful JSON capture; platform/build were not recorded. |
| JSON size-limit tuning | **Deferred: needs a real failure example.** Keep the current raw-download, file and final-transcript limits. | Historical size labels do not identify the boundary or prove metadata caused rejection. ChatGPT already has a larger allowance for unused reply branches. See section 4. |
| Broken metadata on an unused reply | **Deferred, not an active fix priority.** Only reproduced after deliberately corrupting unused reply data. | No failing native response or real-user incident has confirmed this cause. See section 4. |

The pushed fix remains on the worktree branch. These statuses do not establish a production merge or extension-store release. Earlier completed compatibility fixes are listed in section 5 and the changelog.

## Read this first

| Finding | Assessment | Next action |
| --- | --- | --- |
| A connection drops **after** ChatGPT/Claude response headers arrive. | **Fixed in source:** a rejected native body read is `request_failed` / `network_error` and qualifies for the existing one fresh retry. Invalid bytes/JSON/limits still reject. | Completed; reload/distribute the updated extension. |
| An unused Grok/DeepSeek reply has broken structural metadata. | **Deferred synthetic case:** damaged unused nodes can cause rejection; normal regeneration checks and a user trial succeeded. | Await a real failing native response before prioritizing a change. |
| Older telemetry records size, incomplete and unavailable failures without the underlying detail. | **Recorded failures, unresolved causes.** They cannot identify a particular validator or justify removing it. | Use fresh, specific capture diagnostics before tuning budgets/auth/deadlines. |
| The actual selected text, transport or supported file is incomplete, wrong or too large. | **Keep the rejection.** Accepting the readable prefix would hide lost context. | Explain the specific limit/cause; do not clip or guess. |

Evidence labels used below:

- **Confirmed code behavior:** traced in source and, where stated, reproduced using the actual adapters in isolated test harnesses. This does not establish live frequency.
- **Recorded:** retained historical telemetry or a previously documented native sample; its date and limits remain explicit.
- **Needs evidence:** plausible explanation of a recorded category, not a diagnosed incident.
- **Policy:** a deliberate boundary. Changing it is a product decision, not an automatic bug fix.

## 1. Legitimate reasons JSON should fail

These protect the conversation or the user's session. Keep them even when reducing failure rates.

| Reason | Why rejection is correct | Boundary that must remain |
| --- | --- | --- |
| The source chat, selected Grok `rid`, account or session changes during capture. | The result could belong to another conversation or user. | Cancel the pinned attempt, including navigation away and back. Do not recover by reading the newly opened chat. |
| The native endpoint denies access or rate limits the read. | HTTP 401/403/429 is not complete history. | Keep access checks. ChatGPT already has one internal 401 auth recovery; the outer temporary-error retry does not loop on these statuses. |
| Transport is explicitly partial or invalid. | HTTP 206, `Content-Range`, invalid JSON/UTF-8 or a rejected response type cannot prove an intact response. | Discard the body/prefix. A connection interruption now qualifies for the existing one fresh read; invalid decoded content does not automatically qualify. |
| Selected history has a missing ancestor, cycle, wrong identity, ambiguous selected node, remaining page or explicit truncation. | A readable suffix is not the whole selected history. | Validate the selected chain and authoritative history/page completeness. An explicit count showing omitted messages must still fail. |
| A recognized supported pasted card/text file is unavailable, unfinished or byte-inconsistent. | Silently skipping it can remove the main user prompt. | Keep parse status, signed-address, file identity and exact original-byte checks. Temporary file HTTP failures can already qualify for the one outer retry. |
| No supported conversation text remains. | There is no verified text to transfer. | Do not substitute broad page text, suggestions, drafts or nested tool payloads. Empty pending assistant content can be skipped when earlier supported text exists. |
| The prompt is entirely unsupported content that cannot be represented by the current adapter. | An answer-only history can conceal the missing prompt. | Grok file-only user turns and Gemini blank prompts with unrecognized metadata deliberately fall back. Named ordinary uploads accompanying supported text can retain labels without fetching their bodies. |
| The selected serialized transcript exceeds the transfer limits. | This is an actual content limit. | Maximum **500,000 JavaScript string units** and **2,000,000 UTF-8 bytes**, including labels/wrappers. Reject without clipping. |

Resource limits also deliberately stop a read, but they are **not evidence that the selected conversation is too large**:

| Resource boundary | Current allowance | Interpretation |
| --- | --- | --- |
| ChatGPT native reads | **32,000,000 bytes total** across history, session, descriptors and paste bodies; session/descriptor JSON additionally has a **6,000,000-byte per-response** cap. | All branches arrive before MAIN prunes to the selected path. Extra metadata/alternatives can exhaust transport while selected text fits. |
| Claude native history | **6,000,000 bytes**. | Includes inactive branches and tool metadata. |
| Gemini/Grok/DeepSeek native reads | **6,000,000 bytes total**. | Includes pages/message bodies and DeepSeek supported file downloads. |
| ChatGPT/DeepSeek supported text files | **2,100,000 declared original bytes across unique file IDs**. | Separate from raw transport and final serialized-text bounds. Passing this allowance does not guarantee the final transcript fits. |
| Native capture deadline | **15 seconds** for ChatGPT/Claude; **25 seconds** for Gemini/Grok/DeepSeek. | Shared by the native capture's work, not renewed for each page/file. A timeout proves that this read did not complete in time, not that its history is malformed. |

Keep bounded downloads and cancellation. Consider reducing native payload or changing a budget only after identifying which boundary a real supported conversation hits. Do not raise every ceiling or remove stream byte checks.

Sources: [ChatGPT MAIN](../extension/chatgpt-fetch-main.js), [Claude MAIN](../extension/claude-fetch-main.js), [network MAIN](../extension/network-fetch-main.js), the serializers and [current capture contracts](../LOGIC.md#shared-json-contract).

## 2. Avoidable failures still needing implementation

The first prioritized fix, interrupted-body retry classification, is complete. Use fresh capture diagnostics to select the next useful implementation.

Normal regeneration is working behavior. Size-limit tuning and the corrupted-unused-reply case are retained under section 4 pending real failure evidence, outside the active fix queue.

## 3. High-cost failures and correctness risks

### A broad failure label can lead to the wrong fix

The same label can mean very different work:

- `incomplete` can mean missing selected history, malformed text, invalid bytes or a raw-byte ceiling. Older builds also misclassified body-network interruptions this way.
- `unavailable` can mean hook readiness, missing native routing/auth observation or access denial.
- `size_limit`/`attachment_size_limit` must be read with the stage; they are not interchangeable with final transcript size.

**Current diagnostic gap, reproduced:** a ChatGPT response advertising more than its raw allowance reports `incomplete` / `partial_response`. Claude's equivalent reports `incomplete` / `size_limit`. Thus not every raw limit has an explicit size detail, and the final “too long” path cannot be inferred from the broad failure category alone. This is a classification finding, not a reason to prioritize exceptionally large trees.

Future work should distinguish raw-response, file and final-transcript exhaustion without storing private content. The user message should describe the boundary that actually failed. Removing a safety check because its label looked unnecessary could replace a visible failure with silently missing text.

### Falling back can be much more expensive than one safe fresh read

Historical size fallbacks reached DOM captures of **50,691**, **64,947**, **128,367** and **205,041 characters**. This shows that JSON resource rejection and DOM transcript size were different; it does not prove the DOM transcript was complete or equal to the JSON-selected text.

Current recognized hard-size failures stop the attempt instead of starting the former expensive sweep. Preserve that behavior. For non-size failures, Claude/Gemini/Grok/DeepSeek can still use one normal DOM recovery after eligible JSON retry; ordinary ChatGPT failures remain terminal except its malformed-text and active-reply exceptions. The interrupted-body fix can avoid both terminal ChatGPT failure and unnecessary Claude scrolling.

An active-reply DOM snapshot contains only verified rendered text and does not sweep earlier virtualized history. It is an intentional recovery boundary, not independent proof that every earlier turn was present.

### Successful JSON must not conceal missing history

Grok permits an omitted starting marker with a specific UUIDv5 shape. Previously documented user-provided samples support that compatibility rule; the longer sample contained 44 linked selected message bodies and the recognized original opening. They did **not** demonstrate lost history.

A shortened response retaining a plausible UUIDv5 boundary and no contradictory count/partial metadata can still resemble a valid omitted root. **This is an unresolved completeness assumption, not an observed incident.** Independent native root/count evidence would be needed to distinguish them. Keep it visible, but do not spend the first implementation pass building extra requests for this unobserved case.

Source: [network-json-data.js](../extension/network-json-data.js), external-root handling; [transfer lifecycle](../LOGIC.md#capture-selection-and-failure-handling).

## 4. Recorded failures whose actual causes are still unknown

The original aggregate query covered retained attempts from **October 9, 18:17:47 to October 12, 11:56:56 IST**: **82 rows**, **77 with diagnostics**. These counts have **not** been refreshed in this update. They are historical evidence, not today's failure rate.

| Recorded JSON fallback category | Attempts | Final transfer succeeded | Final transfer failed |
| --- | ---: | ---: | ---: |
| `size_limit` | 7 | 2 | 5 |
| `incomplete` | 5 | 2 | 3 |
| `unavailable` | 3 | 1 | 2 |
| `request_failed` | 1 | 0 | 1 |
| **Total** | **16** | **5** | **11** |

DeepSeek supplied four size, four incomplete and three unavailable events; Gemini supplied three size events; ChatGPT supplied one incomplete and one request-failure event. Separately, six ChatGPT attempts ended `capture_failed` with JSON attempted. These sets are not an exhaustive or necessarily disjoint JSON-failure census.

The inspected historical groups lack specific capture detail/stage/error observations. A recovered JSON error followed by a paste/summary/cancellation failure does **not** establish that JSON caused the final outcome. Rows still `started` are not terminal failures.

| Question worth checking | Current mechanism | Evidence needed before changing behavior |
| --- | --- | --- |
| Is DeepSeek's unavailable capture a late-hook/auth problem? | Without an observed authorization header, it cannot issue the authenticated history read. One outer retry cannot create missing credentials by itself; signed-in refresh is the current recovery. | Fresh `auth_missing` versus `hook_unavailable` versus HTTP status, hook version, and whether native authenticated traffic occurred. Do not read arbitrary storage for tokens. |
| Is Claude routing unavailable despite the chat being usable? | Needs the selected chat's observed organization endpoint; retained routes/resource timing and a 1.5-second observation wait recover it when available. | Fresh `routing_unavailable`, current hook ownership, and whether a matching route was observed. Do not guess another organization. |
| Is a raw budget rejecting otherwise transferable history? | **Deferred; keep current limits.** Raw trees/pages/files and final selected text have separate bounds. | A real failing capture identifying the boundary, native byte consumption and exact complete selected-text size. A small DOM result alone is insufficient. |
| Is a supported file temporarily inaccessible? | Signed-body HTTP error, processing status and byte mismatch can share attachment failure categories. | Descriptor/body stage and actual HTTP status or bounded validation detail. Distinguish supported-file corruption from unsupported-file exclusion. |
| Is valid history simply too slow? | Native deadlines cover auth, pages and files together. | Which stage consumed the time, total bytes/pages/files and result of the existing retry. Do not lengthen all deadlines without measurements. |

Gemini's newest unmarked candidate uses native first-candidate order; older selections follow parent links. A displayed-candidate mismatch has not been demonstrated. Validate it only if a real capture/display disagreement appears.

### Deferred: changing JSON size limits

**Decision, 2026-10-13: skip size-limit changes for now.** Keep the existing raw-download, supported-file and final-transcript limits. This is an investigation awaiting evidence, not a confirmed remaining size bug.

The possible failure is a complete selected conversation that fits the final transcript limit while the whole native download exceeds its separate budget. No inspected real failure establishes this cause. The historical `size_limit` rows do not identify the boundary, and metadata has not been demonstrated as the reason for those failures.

ChatGPT's earlier 6 MB full-tree bottleneck was already replaced by a 32 MB total allowance before this investigation. A controlled regression covers unused replies totaling over 7 MB while the selected chat is small; it does not prove that exactly 32 MB is necessary in real usage. See the recorded branch-pruning change in [CHANGELOG.md](../CHANGELOG.md).

Reopen this item only when a real failing capture identifies the platform/build, failing stage and boundary, native bytes consumed, and complete selected-text size. Distinguish raw-download, supported-file and final-transcript rejection before choosing a fix. Retain safe counts and bounded diagnostics without logging private conversation text or signed addresses.

Move to the next common failure supported by real diagnostics. Do not raise or remove limits based on the old broad labels.

### Deferred: malformed unused replies

Follow-up on 2026-10-13: controlled Grok/DeepSeek captures with a regenerated reply kept only the selected new answer, skipped its old alternative and preserved all six selected turns. Grok requested only selected-path bodies. Six existing targeted tests covering reply selection/regeneration passed. The user then reported that regeneration and JSON capture worked; the platform and installed build were not recorded.

The failure appeared only after deliberately damaging an unused reply: Grok pointed it to an absent ordinary parent, or DeepSeek omitted its parent field. These inputs still produce `parent_missing` / `invalid_branch`, respectively. This establishes validation behavior, not a demonstrated native incident.

Keep this case **pending evidence**. Promote it only when a real failing native response proves that the selected history is complete and the unrelated malformed node caused rejection. Preserve selected-path ambiguity, root, identity and completeness safeguards. Selected-answer capture already keeps the chosen new reply; no new selection behavior is needed.

Source: [network-json-data.js](../extension/network-json-data.js), `chain`, `grokBranch`, `deepseekBranch`.

## 5. Things that should not create new JSON failures

These are already supported or intentional bypasses. Keep them out of the open bug queue:

- **An answer is regenerated and the new answer is selected.** Capture follows selected history and skips unused alternatives. Targeted checks and a user regeneration trial passed; deliberately corrupted unused nodes remain pending native evidence in section 4.
- **A ChatGPT/Claude native JSON body read rejects after headers arrive.** The current source discards the partial response and preserves a retryable network cause, including ChatGPT session and paste-descriptor reads. One existing serialized fresh retry starts from the beginning. Four reader regressions failed before this fix and pass afterward; invalid content, limits and cancellation retain their rejection.
- **A reply is still generating or was stopped.** Capture supported current own text without waiting. Generation markers alone are not missing-history proof.
- **An unknown optional Gemini metadata block accompanies verified user text.** Exclude unknown metadata; keep the text. A blank prompt remains a separate case.
- **JSON MIME casing/parameters and ChatGPT pasted-text MIME parameters.** Current supported base-type matching handles them.
- **Shuffled Grok node/body arrays.** Parent links determine chronology.
- **Malformed unused Claude IDs; an unused Grok reply merely lacking its parent field.** The recent narrow fixes already handle these. Section 4 retains corrupted unused nodes pending native evidence.
- **Different complete Claude pasted bodies share an attachment ID.** Preserve each distinct body; only exact repeats are deduplicated within the turn.
- **DeepSeek `FILE.files` is one object instead of a list.** Current descriptor discovery and serialization normalize both.
- **Picker JSON failed temporarily before selection.** Selection can already make one serialized fresh read for recognized temporary errors.
- **Speed off, toolbar transfer or an unsaved chat.** These select DOM intentionally; they are not failed JSON attempts.
- **Excluded tools, binary/media and separate editor state.** Exclusion is not itself a capture failure. Do not recursively collect unrelated payloads just to increase captured characters.

ChatGPT malformed plain-text parts currently get announced normal DOM recovery rather than accepting a readable prefix. That compatibility case is not fixed JSON serialization and should not be described as silent JSON success.

See [CHANGELOG.md](../CHANGELOG.md) for the completed changes. Source handling still needs the updated client to reach an installed user.

## 6. Practical work order

1. **Verify the interrupted-body fix in the updated client when this failure recurs.** The source fix and four regressions are complete; a Git push does not update installed scripts.
2. **Choose the next fix from real failure detail.** Keep size-limit changes and malformed unused replies deferred until a real failing capture confirms their impact; normal regeneration needs no new selection behavior.
3. **Use fresh detail to rank auth/routing, resource and timeout failures.** Tune the observed bottleneck rather than replaying the historical broad labels. Keep raw/file/transcript limits distinguishable.
4. **Check the installed build when source-supported cases recur.** Compare relevant hook/script build evidence; a manifest version or Git push alone does not prove client parity.

Measure **first-read JSON success**, **JSON success after retry**, **DOM recovery**, **terminal capture failure** and **intentional bypass** separately, by source platform and client build when known. Compare capture timing on similar complete inputs. A recovered JSON error is useful diagnosis, but should not be counted as failed final JSON capture. Picker-prefetch completion can make post-selection timing very small without reducing the full native-read time.

For one new incident, retain existing safe metadata: `json_fallback_code`, `capture_detail`, `capture_request_stage`, `capture_http_status`, `capture_error_code`, `capture_failure_site`, capture method/retry/timing and the final outcome. Missing fields mean **unobserved**, not zero. Keep chats, credentials, account identifiers, raw URLs/signed addresses and arbitrary exception messages out of telemetry. See [transfer diagnostics](transfer-diagnostics.md).

Defer speculative malformed-count/array-metadata permutations and broad private-API rewrites. They lack demonstrated user impact and do not explain the recorded failure groups. Add them to this queue only when native evidence or repeat incidents make them relevant.

## Verification and scope of this update

The first three items below describe the original report update before the interrupted-body implementation; the implementation verification is listed separately.

- Traced current MAIN readers, serializers, bridges, outer retry and fallback handling, and recent capture changes.
- **Six controlled probes passed:** ChatGPT/Claude interrupted body reads and healthy fresh reads; Grok/DeepSeek intact selected paths rejected by unused nodes; ChatGPT/Claude raw-limit classification. Probes reused the real source and existing harnesses in memory; no runtime/test/fixture files were changed.
- The existing four-file JSON capture/transfer suite completed successfully, **222 tests, exit code 0**:

  ```powershell
  node --test --test-timeout=30000 --test-reporter=dot test/chatgpt-json-capture.test.js test/claude-json-capture.test.js test/network-json-capture.test.js test/json-transfer-fallback.test.js
  ```

- No fresh database query, agent-run live-account capture or installed-build inspection was performed. Historical counts remain dated. The user reported successful regeneration/JSON capture, with platform/build unrecorded. Interrupted-body retry is fixed in source; corrupted unused-node rejection is deferred with no confirmed native incident.
- Implementation follow-up: all **159 focused ChatGPT/Claude capture and transfer-fallback tests passed** after the interrupted-body fix, including the four new regressions. Command: `node --test --test-timeout=30000 --test-reporter=spec test/chatgpt-json-capture.test.js test/claude-json-capture.test.js test/json-transfer-fallback.test.js`. Extension publication/deployment are separate. Keep completed items in the changelog and require exact complete selected-text evidence before declaring a speed fix successful.

- Regeneration follow-up: six targeted tests and four controlled Grok/DeepSeek checks passed (normal regenerated capture, then deliberately corrupted unused-node rejection on each adapter). This investigation changed no runtime/test files.
- Size-limit follow-up: rechecked current reader constants, the recorded ChatGPT branch-pruning change and its controlled large-unused-branch coverage. Deferred tuning until a real failure identifies its boundary. This documentation-only decision changes no limits or capture behavior; no new live payload or telemetry query was inspected.
