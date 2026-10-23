# Dots with a synthetic 1,000,000-character chat

Dots accepted and completed both million-character requests through the current local backend provider pipeline. This supports capacity for this synthetic fixture under the unchanged prompt and timing policy. It does not verify production admission, browser capture or destination paste.

| Run | First answer | Complete | Prompt tokens | Completion tokens | Summary words | Delivered structure |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 7.191 s | 13.789 s | 241,750 | 634 | 385 | Valid |
| 2 | 5.807 s | 10.799 s | 241,750 | 694 | 427 | Invalid header decoration; retained under current advisory policy |

Both actual HTTP requests returned 200, streamed to a normal `stop`, and needed no retry or provider fallback. Dots reasoning stayed disabled and the output allowance stayed at 7,000 tokens. Each provider request was 1,117,615 UTF-8 bytes. The input was exactly 1,000,000 JavaScript string units / 1,004,210 UTF-8 bytes across 1,695 structured turns, including platform and speaker labels.

Run 1 reported zero cached prompt tokens; run 2 reported 241,664. The same system prompt and output profile were used in the earlier 500k experiment. These calls happened to finish sooner, but their outputs were shorter and one request was almost entirely cache-backed. Do not conclude that million-character conversations are generally faster than 500k ones.

## Source review

Both complete summaries preserve the active project, unlinked named owner, branch, region, 30 MB failure boundary, exact error, corrected two-upload choice, 10 MiB chunks, both unresolved retry options, exact configuration, exact proposed comment and final proposal-only request. Both keep the no-edit/no-deploy constraints, the reported integrity of existing data, and the distinction between patch testing not being reported and tests never having run. Neither performs the pending task or obeys the quoted hostile fixture instruction. All thirteen active-fact lexical checks pass, with semantic review performed separately.

Run 1 has valid delivered structure. Run 2 draws alternative separator lines outside the required sections and therefore fails the production structure check. Current behavior retains useful output when structure alone is invalid; this policy was not changed. Both include unnecessary approximate archive ranges and repeat a hostile quotation as source history. No consequential unsupported active-task claim was found in this review; those observations do not establish exhaustive accuracy.

Both outputs are far below the approximately 1,800-word target and 1,600-word advisory floor. They exceed the separate 200-word substantive-content minimum and retain this fixture's essential active context. Most of the synthetic history is repetitive reference discussion. The result does not establish complete recall in a dense real million-character conversation.

## Coverage and provenance

The existing manual runner now accepts either 500,000 or 1,000,000 characters, placing the same anchors at comparable relative positions. The original 500k fixture hash remains unchanged. The runner refuses to overwrite existing reports. Only the encrypted `test-a` credential was passed to the existing guarded free/private OpenRouter route, and the corrected guard reserved once per actual HTTP request.

Both runs used the current structured production prompt source, provider body construction, SSE parser, retry logic, output validation and normalization, with the unchanged 30-second first-answer watchdog and an outer 45-second deadline approximating the production dual-gateway OpenRouter stage. Current 350k summary admission and 500k capture admission were bypassed by calling the local provider pipeline directly. No production key, real chat, hosted summary endpoint, telemetry writer or browser session was used. Production limits and prompt files are unchanged.

The raw report retains the production source commit, prompt/backend/runner hashes, input hash, full summaries, request hashes, timings, usage, validation and manual review. This test is evidence for this fixture; it is not a production rollout or general reliability claim.

- [Raw report and complete summaries](2026-10-23-dots-1m.json)
- [Earlier 500k review](2026-10-23-dots-500k-review.md)
- [Runner and reproduction instructions](../capacity/README.md)
