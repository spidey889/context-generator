# Implemented larger-chat policy: synthetic checks

One fresh OpenRouter test-a request each used the existing deterministic 500k and 1M fixtures, unchanged production prompt, 10,000-token output cap and 90-second larger-chat attempt policy. The encrypted test key and existing free/private-route quota guard were used; no production key or TokenHarbor key was supplied. Backend source/prompt/request hashes and full outputs are retained in the reports.

| Input characters | First answer | Completion | Answer tokens | Words | Result |
| ---: | ---: | ---: | ---: | ---: | --- |
| 500,000 | 4.322 s | 12.172 s | 824 | 534 | Normal stop, one request |
| 1,000,000 | 7.724 s | 14.827 s | 680 | 437 | Normal stop, one request |

Both passed current backend input validation before invoking the provider pipeline. No retry/fallback occurred; neither request used cached prompt tokens. The larger allowance did not force extra output. Both were below the advisory word target, which is intentionally not a rejection or expansion trigger.

Manual review: both retained the corrected two-upload configuration, exact code/comment, branch/region/failure boundary, both undecided retry options and the pending proposal-only request. They kept the product owner separate from user identity and preserved the distinction between unreported testing and a claim that testing never happened. The hostile marker was quoted as untrusted history, not obeyed. Both included unnecessary reference/hostile-note background; the 500k answer also repeated some state. These two sparse synthetic histories establish request capacity and observed behavior, not general summary fidelity or TokenHarbor capacity.

Separate isolated Brave fixtures exercised exact 500k and 1M Unicode captures, original text-file downloads, worker transport, the actual backend admission validator, one stub summary request, exact summary paste, no Send click and local signed telemetry delivery. The 1M browser case is now part of the regular offline CI gate. These checks use a stub model response, not live hosted generation. Unit tests cover 350k/350k+1 routing, independent 90-second gateway deadlines, one attempt per gateway, missing/disabled keys, provider failure recovery, wire-size rejection and all five capture adapters. Local migration replay checks the widened diagnostic bounds and preserves rows, counters and privileges.

Reports: [500k](2026-10-23-dots-500k-large-policy.json), [1M](2026-10-23-dots-1m-large-policy.json). The recorded commit is the pre-change branch HEAD; source hashes identify the working-tree implementation under test. No hosted deployment, database/Edge deployment or extension publication was performed by these checks.
