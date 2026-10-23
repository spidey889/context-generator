# Dots output-length experiments at 500k

Dots completed one 6,178-word output using a 16,000-token ceiling. That answer took 134.999 seconds and used 14,258 completion tokens. This establishes longer-output capacity on the supplied synthetic input, not a production-ready prompt or the model's absolute maximum.

All four requests used the same exact 500,000-character / 501,925-byte structured input, across 863 turns. Unlike the earlier sparse capacity fixture, this input includes 80 CURRENT cancellation evidence cases whose exact details the source explicitly asks to preserve. Complete unrelated archive turns are removed to keep the input size unchanged. Four actual requests used only the encrypted `test-a` key and existing free/private-route guard; no production key, hosted endpoint, real telemetry or browser session was used.

| Treatment | Token ceiling | Diagnostic window | Model words | Time | Result |
| --- | --- | --- | --- | --- | --- |
| Current prompt | 7,000 | 90 s | 933 | 34.691 s | Normal stop; groups cases without preserving their paths/logs |
| Require 3,000–4,000 words | 10,000 | 90 s | 5,008 partial | 90.050 s | Interrupted by diagnostic deadline; no complete answer |
| Require 6,000–7,000 words | 16,000 | 180 s | 5,772 | 154.380 s | Token limit; answer incomplete and padded with archive IDs |
| Detail-first, no mandatory floor | 16,000 | 180 s | 6,178 | 134.999 s | Normal stop with all 80 exact records; semantic/relevance failures remain |

Counts use the existing backend whitespace counter, including paths, codes and headings. The third run's backend delivered 5,792 words after appending the trusted confirmation to 5,772 model words; this does not make a token-truncated answer a complete model response. The 90-second interrupted run has no final completion-token usage. Partial streaming output is retained, never counted as a complete generation success. No result above the current prompt's control fits the production dual-gateway 45-second OpenRouter stage.

## What changed in the experiment

The production prompt explicitly calls its approximately 1,800-word allowance guidance rather than a minimum and says a long chat may need a short handoff. The two hard-floor treatments replace only that instruction in the child process, with cloned profiles and higher output ceilings. They ask for each active case's exact IDs, paths, logs, triggers, ordering and scope. The final treatment asks for complete evidence, excludes archive IDs, and instructs the model to stop after the evidence rather than fill a word quota.

The default production source remains untouched. For 180-second diagnostics, an in-memory copy of the backend changes only its provider-attempt constant from 90 to 180 seconds, retaining a separate hash. The existing 30-second first-answer watchdog remains active. This isolates output capacity from current production timing; it is not evidence that the same long answer fits existing release budgets. Test settings are not shipping changes.

## Evidence and quality review

The current-prompt control preserved the core active-task facts but reduced the 80 evidence cases to a range and general description. It retained none of their exact fixture paths, test paths or log lines, despite the source request. It also enumerated 386 irrelevant archive IDs. Its 3,157 completion tokens were well below the 7,000-token ceiling, so the short answer did not result from exhausting that ceiling.

The 3,000-word treatment produced substantially more text but timed out after 62 case paths/logs. The raw text names 63 case IDs because a range reference also names the last case. Coverage is measured by actual exact paths/logs, not ID count alone.

The hard 6,000-word treatment retained all 80 case paths/logs, then enumerated 755 archive IDs, 369 of which do not occur in the source after normalizing zero padding. It ignored the archive exclusion and ran out of the full 16,000-token allowance before a normal end. It therefore fails both the requested minimum and semantic/relevance review, even though useful text is preserved by current backend policy. The backend's appended confirmation can yield a valid delivered structure while original quality flags correctly retain `bad_structure`, `missing_section`, and `token_limit`.

The final detail-first answer preserves all 80 exact fixture paths, test paths and log lines. Per-case checks also match all checkpoint values, observed ordering, cleanup markers and diagnostic markers, with samples from the first, middle and last cases read in full. It preserves the pending proposal request and all thirteen active-fact lexical checks. However, it still enumerates all 386 unrelated archive IDs despite explicit exclusion. It also changes testing "not reported" into "The proposal has not been implemented, tested, or deployed," and invents the open question "Whether the proposed patch should be implemented or tested is not yet decided." Those are substantive fidelity failures; an empty structural-quality flag list is not a semantic pass.

Longer output is possible. Hard word floors alone do not establish useful detail, and the tested long variants are not ready to replace the production prompt. A useful future target must combine evidence coverage, fidelity, output allowance and measured latency rather than maximizing words alone. No 1M input was sent in this output-length experiment, and no production prompt, limit, cache version, provider route or deadline was changed.

- [Control output](2026-10-23-dots-500k-length-control.json)
- [3,000-word instruction and partial output](2026-10-23-dots-500k-length-3000.json)
- [6,000-word instruction and token-limited output](2026-10-23-dots-500k-length-6000.json)
- [Completed detail-first output](2026-10-23-dots-500k-length-detail-first.json)
- [Runner and reproduction instructions](../capacity/README.md)
