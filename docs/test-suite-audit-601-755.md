# Tests 601–755: redundancy and runtime audit

Reviewed on 2026-10-24 on branch `test`, starting from `50a4edb`. Numbers refer to the original 755 regular tests in Node's reported pass order, including nested tests; they are not permanent IDs or the order tests were added. Slow/release, database and browser suites are outside this range.

Five standalone tests were removed: one exact duplicate and four consolidated into broader fixtures, preserving their useful assertions. The regular suite goes from 755 to 750; the other original 150 tests in this range remain.

| Original range | File under test/ | Decision |
| --- | --- | --- |
| 601–602 | request-security.test.js | Keep public-provider burst and concurrency boundaries. |
| 603 | smoke-failure-artifacts.test.js | Keep failure recovery, including disconnected pages. |
| 604–629 | summarize.test.js | Keep 25; fold 626 into 605. Preserve provider input, fallbacks, acceptance and prompt boundaries. |
| 630 | summary-prompt.test.js | Keep profile/template invariants and empty-template rejection. |
| 631–655 | summary-stream.test.js | Keep all 25; reduce aligned clock ticks and concentrate tiny transport chunks on the four-provider decoder matrix. |
| 656–702 | telemetry-delivery.test.js | Keep all 47; seed full append queues after empty-worker startup. Restore/expiry and single-write bounds stay separate. |
| 703–709 | telemetry-handler.test.js | Keep all seven; simulate body, SQL, relay and Redis timeouts. |
| 710–717 | telemetry.test.js | Keep seven; fold 711 into 712 with explicit expectations for both validators. Compile worker code once, with fresh contexts/storage. |
| 718–737 | tokenharbor.test.js | Keep 19; remove duplicate 737. Preserve both request formats, key recovery, budgets and cancellation stages. |
| 738–745 | transfer-diagnostics.test.js | Keep privacy, generated bundle parity, unknown-cause handling and event/size bounds. |
| 746–755 | verified-telemetry.test.js | Keep eight; consolidate 749/750 into unsigned-attribution and real relay/Edge fixtures. Preserve HMAC versions, tampering and old-store recovery. |

## Removed standalone tests

| Original number | Test | Coverage retained in |
| --- | --- | --- |
| 626 | normalizer safely replaces provider-written NEXT STEP wording | 605 supplies custom wording and requires the trusted instruction at the end, with the old wording removed. |
| 711 | Supabase payload validation rejects content, unknown stages, and arbitrary failures | 712 checks both validators against explicit expected rejection/acceptance, as well as parity. |
| 737 | caller cancellation during TokenHarbor stops all retries and fallbacks | 725 already cancels at the same point with a backup key available and requires no backup request. |
| 749 | direct edge calls cannot promote fake successes or externally supplied verification booleans | 746 retains forbidden boolean fields and forged-proof rejection before SQL; unsigned successes already pass through Edge. |
| 750 | originless forged successes remain unverified through Vercel and the actual edge handler | 714 omits Origin on its unsigned success and verifies the actual relay→Edge→RPC path remains unverified. |

## Runtime changes and measurement

- Append fixtures still contain 500 entries. The restore fixture still covers 601 terminal entries, expiry, priority and the 100-entry diagnostic cap. Canonical field order avoids an incidental cleanup write before the append under test.
- Streaming silence/completion tests use one-second simulated steps only at aligned deadlines with no retries. Exact deadlines, aborts, route order and timer cleanup remain asserted. Retry and overdue-timer regressions keep their own clocks.
- Three-byte UTF-8/CRLF/JSON fragmentation remains tested for all four providers. Other streaming scenarios use ordinary chunks; thinking tags still span distinct delta frames.
- Relay timeouts exercise the actual five-second setting in simulated time instead of shortening it to a real 20 ms wait. Body/SQL/Redis waits use the scoped clock helper; native HTTP integration keeps real I/O.
- Three paired timing runs used Node 24.22.1 on this Windows host, the same 11 files and sequential file execution, with alternating version order. Those files include eight adjacent request-security tests outside the range, so benchmark counts are 163→158. Median wall time was 6.738→5.800 seconds (about 14% lower). Runs varied substantially, including runs where the updated version was slower; this is a local observation, not a CI or full-suite speed guarantee.

Validation: all 750 regular tests passed; no skipped or failed tests. Production code, timeout values and the separate browser/database suites were unchanged.
