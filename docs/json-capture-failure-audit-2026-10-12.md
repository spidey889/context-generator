# JSON capture failure audit

Date: 2026-10-12 (Asia/Kolkata). Source snapshot: `1cf75964fbe710ecaca7e2c661149ad6a154dd7b` on `codex/capture-progress-diagnostics`.

The investigation used read-only source inspection, aggregate database queries and in-memory reproductions. No runtime fixes, database changes or live-account browser checks were made. This report records the failure paths found; it does not establish that every synthetic case occurs in production or exhaust every possible native API change.

Evidence labels:

- **Recorded:** aggregate telemetry contains the event, but may not identify its exact cause.
- **Reproduced:** current code exhibits the behavior with a controlled synthetic input.
- **Rule:** an intentional boundary visible in current code.
- **Unverified:** a compatibility assumption whose live behavior was not checked.

The original snapshot, findings and aggregate counts below remain historical evidence, not a current database inventory. See [current capture behavior](../LOGIC.md#capture-selection-and-failure-handling).

## Most useful findings first

| Priority | Finding | Evidence and effect |
| --- | --- | --- |
| 1 | Grok can accept a truncated oldest boundary | **Reproduced blind spot.** Remove the oldest user/assistant pair without adding partial/count metadata. The suffix can still have one human boundary whose missing real parent looks like an omitted synthetic root. Capture succeeds with only the suffix. Distinguishing an actual synthetic root requires stronger native evidence; the ordering fix does not resolve this ambiguity. |

Source pointers:

- Grok root exception: [network-json-data.js](../extension/network-json-data.js), `chain` and `grokBranch`.

## Recorded database evidence

This is a snapshot of the retained `public.transfers` rows, not today's activity or a complete installation history. The observed attempt range was **October 9, 18:17:47 through October 12, 11:56:56 IST**. There were **82 rows**, of which **77** had nonempty diagnostics.

| Recorded `json_fallback_code` | Attempts | Final transfer succeeded | Final transfer failed |
| --- | ---: | ---: | ---: |
| `size_limit` | 7 | 2 | 5 |
| `incomplete` | 5 | 2 | 3 |
| `unavailable` | 3 | 1 | 2 |
| `request_failed` | 1 | 0 | 1 |
| **Total** | **16** | **5** | **11** |

- DeepSeek accounts for four size incidents, four incomplete incidents and three unavailable incidents. Gemini accounts for three size incidents. ChatGPT accounts for one incomplete and one request-failure incident.
- Two DeepSeek size incidents completed through DOM sweeping with **50,691 captured characters**. Two other DeepSeek size incidents reached DOM captures of **64,947** and **128,367** characters before a later transfer failure. One Gemini size incident reached a DOM capture of **205,041** characters. These observations show the JSON rejection did not establish an oversized DOM transcript; they do not identify which raw/file limit fired or prove equivalent capture completeness.
- Separately, six ChatGPT attempts ended as `capture_failed` with JSON attempted. Their missing diagnostic detail does not establish the exact JSON failure. DeepSeek and Gemini each have one `capture_failed` attempt; the Gemini attempt records JSON attempted, while the DeepSeek attempt lacks that observation.
- The inspected failure/fallback groups lack `capture_detail`, `capture_request_stage`, `capture_error_code` and `capture_failure_site`. Old omissions cannot be reconstructed from later instrumentation.
- `json_fallback_code` is not a census of all JSON failures. Terminal ChatGPT failures need not enter fallback. A recovered JSON error also does not establish the cause of a later paste, summary or cancellation failure. Rows still marked `started` are not counted as terminal failures.

Detailed per-transfer telemetry was blocked by automatic approval review because it included potentially sensitive identifiers and diagnostics. The evidence above uses permitted aggregate queries only; no private chat text, credentials or user identifiers are included.

## Shared ways JSON capture can fail

| Boundary | Failure trigger or rule | Practical consequence |
| --- | --- | --- |
| Capture entry | JSON is used for supported saved-chat picker transfers with Speed enabled. Toolbar transfers, unsaved chats and explicit Speed opt-out use DOM. | These are JSON bypasses, not JSON errors. An empty unsaved chat fails admission. |
| Hook readiness | Missing/old/replaced MAIN hooks; unavailable runtime messaging; installation failure; no correlated versioned readiness response within bounded recovery. | Capture reports unavailable. Hook recovery has an eight-second bound after the initial short probe. |
| Native observation | Native fetch/XHR replacement can invalidate observation ownership. | Missing routing or authentication can prevent a read even when the page remains usable. |
| Concurrent reads | A MAIN hook already owns another native read. | It reports busy. The content script serializes its own reads, but direct/other callers can still encounter this rule. |
| Timeout | Fifteen seconds for ChatGPT/Claude native capture; twenty-five for Gemini/Grok/DeepSeek. | Slow history, pagination, session refresh or attachment work can exhaust the shared native time budget. Bridge response waits are also bounded. |
| Navigation/session | Wrong selected chat, navigation away and back, changed Grok `rid`, changed account or observed DeepSeek credential. | Capture can be cancelled. Picker snapshots also expire on route/query/rendered-history changes, causing a fresh read. |
| HTTP transport | Non-200 status, partial/ranged response, unavailable or expired signed file, rejected redirect or unsupported content type. | Whole JSON capture fails instead of accepting partial content. |
| Body integrity | Malformed JSON, invalid UTF-8 or unfinished final UTF-8 bytes. | Reader is cancelled; partial text is not accepted. |
| Raw download size | Native tree/session/descriptors/pages/files exceed the relevant shared byte allowance. | JSON fails even if selected text would fit. Budget checks apply to advertised and consumed bytes. |
| Transcript size | Serialized transcript exceeds 500,000 JavaScript string units or 2,000,000 UTF-8 bytes. | Transfer rejects rather than clipping. Platform/speaker labels count toward size. |
| Structural completeness | Missing current leaf, parent, valid root or required message fields; cycles, duplicates, wrong IDs, invalid counts, partial/truncated flags or remaining cursors. | Full JSON capture is rejected. Checks differ by adapter. |
| Supported content | No usable own user/assistant text remains after filtering. | Capture fails; nested tool/file text is not guessed as conversation text. |
| Attachment integrity | Invalid manifest, ID, declared size, byte mismatch, parse status, allowed file type, signed address, body or completeness flags. | A recognized unreadable attachment can invalidate the whole capture. |
| Native schema drift | Provider changes private endpoints, fields, route patterns, RPC framing or candidate semantics. | Strict recognized shapes may reject valid native history or leave new content excluded. These are compatibility risks, not observed current changes. |

## Provider-specific rules and content exclusions

| Provider | Useful boundaries |
| --- | --- |
| ChatGPT | Missing observed auth can trigger explicit `/api/auth/session` recovery. There is one shared 401 retry across history and paste descriptors; 403 and partial history are not retried. Ordinary failed JSON capture is terminal; an active reply can use the rendered snapshot exception. Hidden turns and ordinary tools/media are excluded. User big pastes require exact `is_big_paste: true` / `mime_type: "text/plain"`, valid file IDs and verified original bytes. Other uploads generally retain labels, not bodies. Python output and legacy Canvas have narrow completed, adjacent call/result exceptions. |
| Claude | Needs an observed exact-chat organization endpoint or matching resource timing; gives routing observation 1.5 seconds and does not guess an organization. Full-tree download includes inactive/tool metadata within 6 MB. Pasted cards require unnamed `txt` attachments with complete `extracted_content` and matching supplied byte size. Named uploads retain labels; tools, artifacts, media and sync sources are excluded. Malformed message IDs anywhere in the returned array can reject a healthy selected branch. |
| Gemini | Needs observed RPC auth or native `WIZ_global_data.SNlM0e` bootstrap auth. Requires exact complete `hNvQHb` framing, advancing cursors, unique linked turns and a supported selected candidate. Pagination uses ten turns per read under the shared time/byte budget. Unknown optional user metadata is excluded when verified prompt text exists, but a blank prompt with unknown metadata causes unsupported fallback. Attachment names can survive; arbitrary bodies and separate Canvas state are not fetched. |
| Grok | Needs one unambiguous leaf unless the URL provides `rid`. Regenerated branches without `rid` can fail selection. Loads selected bodies in batches; requires matching ID/sender/parent. File-only human input fails even with a named attachment. Ordinary file bodies, tools and search payloads are excluded. Missing/invalid fields on an inactive node can reject the selected branch. |
| DeepSeek | A late hook without an observed authorization header fails before any native read; it does not recover credentials from arbitrary browser storage. History must match the chat, return successful envelope codes and use `REPLACE`, not `MERGE`. Supported file bodies require the allowlisted text/source extension, explicit non-image metadata, successful status, allowed signed host/path/ID, exact UTF-8 bytes and the 1.4 MB allowance. At most four file reads overlap under the shared 6 MB budget. One failed file cancels the siblings. Binary, Office, PDF, image and unsupported tool content stay excluded. |

Source: the three MAIN hooks and [chatgpt-json-capture.js](../extension/chatgpt-json-capture.js), [claude-json-capture.js](../extension/claude-json-capture.js), [network-json-data.js](../extension/network-json-data.js), [network-json-capture.js](../extension/network-json-capture.js). [LOGIC.md](../LOGIC.md#capture) remains the production-behavior authority.

Available text during ordinary generation is supported by the current serializers. Generation status, `end_turn: false`, unfinished own thoughts and WIP/continuation markers alone are not reasons to reject supported current text. Empty pending assistant blocks can be skipped. Structural truncation and the completed Python/legacy Canvas exceptions remain separate rules. Older installed builds may differ; no installed live-account build was inspected here.

## Additional reproduced validation gaps and assumptions

These synthetic cases demonstrate current behavior. Their frequency and presence in real native traffic remain unknown.

| Case | Observed behavior | Assessment |
| --- | --- | --- |
| ChatGPT paste-only user turn uses `text/plain; charset=utf-8` rather than exact `text/plain` | Original paste is not downloaded or serialized; its label is also skipped because `is_big_paste` is true. An assistant-only transcript can succeed. | Silent-loss compatibility gap if a native MIME shape changes. |
| ChatGPT ordinary text parts contain strings plus malformed nonstring entries | Supported strings are kept and malformed entries are discarded. | Validation gap; no proof those entries contain legitimate current own text. |
| Claude thinking block has a numeric body | Block is silently skipped alongside otherwise valid text. | Malformed supported-block validation gap. |
| Claude two pasted attachments share an ID but contain different valid bodies | First body survives; second is deduplicated without rejecting the conflict. | Identity-conflict validation gap. |
| DeepSeek a `FILE` fragment has an object instead of an array in `files` | File data is silently excluded while other prompt/answer text can succeed. | Malformed attachment-container validation gap. |
| Shared network completeness has `complete: "false"` or an array-shaped value | Literal-false checks do not reject these shapes. | Validation gap; differs from the stricter ChatGPT/Claude object/boolean checks. |
| Grok advertised total is negative | Negative count passes the current safe-integer / greater-than-returned-count check. | Malformed count validation gap. |
| Gemini newest reply has two candidates and no explicit selection | First native candidate is selected. | Intentional assumption. A mismatch with the displayed candidate was not demonstrated on a live account. |
| Supported own turn carries a completeness marker such as `complete: false` | Claude/ChatGPT reject it even if the direct text looks complete. | Intentional fail-closed rule; the marker's scope matters. |
| Skipped Claude tool block carries `truncated: true` | Supported direct text still succeeds. | Intended exclusion, not a whole-capture failure. |

There is also a fallback completeness boundary: an active-reply DOM snapshot captures only verified rendered text, without a history sweep. If the native read fails in a virtualized long chat, that exception does not independently prove the full earlier history was captured.

## Checks and suggested order

The existing focused suite passed **191 tests**:

```powershell
node --test --test-reporter=dot test/chatgpt-json-capture.test.js test/claude-json-capture.test.js test/network-json-capture.test.js test/json-transfer-fallback.test.js
```

Additional probes reused the test fixtures/harnesses and exposed serializers only inside isolated in-memory VM contexts. They did not modify source, add test files, submit conversations or perform live provider requests. Existing passing tests do not cover every additional probe.

Suggested follow-up order, subject to separate implementation authorization:

1. Verify Grok root identity against current native evidence to distinguish an omitted synthetic root from a truncated prefix.
2. Add targeted malformed-content/conflicting-attachment checks where silently accepting the remaining text can hide a supported-content loss.

No fix is claimed by this report. Source changes, installed extension distribution and backend deployment remain separate.
