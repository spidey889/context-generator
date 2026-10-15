# October 15 small screen

Four generation requests total: one per model, no retries or judge calls. Every model received the same existing `corrected-export-design` synthetic conversation (1,341 characters) and current v21 system prompt (7,823 characters). Temperature was 0.1, with non-streaming responses and no output-token cap. TokenHarbor retained native model defaults; Dots used the existing free/private OpenRouter policy and dedicated test-key ledger. Model identities are gateway-reported labels, not independently authenticated upstream identities.

| Model | Reviewed rank | Continuity | Fidelity | Grounding | Delivered structure | Response |
| --- | --- | --- | --- | --- | --- | --- |
| DeepSeek V4.1 Flash | 1, tied | Pass | Pass | Pass | Pass | 7.044 s |
| MiMo V2.6 Flash | 1, tied | Pass | Pass | Pass | Pass | 27.095 s |
| Haiku 5.5 | 3 | Pass | Pass | Pass | Fail | 5.668 s |
| Dots3 Note Preview | 4 | Pass | Fail | Fail | Fail | 7.944 s |

Haiku changed `WHERE WE LEFT OFF` to `WHERE LEFT OFF`. Dots emitted `<Boxed Header>` and called an unapproved rollback rejected. Dots' fidelity/grounding failures describe that single decision-state error. The production useful-output path retains malformed headers/headings; the review does not silently repair them. DeepSeek and MiMo have minor wording cautions recorded in [review.json](review.json); the single reviewer's judgments remain open to owner review.

These qualitative competition ranks preserve the first-place tie. They are not percentages, full v1 level scores, or general model reliability. No long-history case was run. Response time is one complete HTTP/JSON observation per model, including gateway/network overhead, before offline delivery processing; it is not a median or pure inference time. Haiku, DeepSeek and MiMo used TokenHarbor; Dots used OpenRouter. Cache usage is unavailable for TokenHarbor; Dots reported zero cached prompt tokens.

[generations.json](generations.json) retains the frozen source, shared prompt, hashes, every output, gateway labels, timings and usage. [review.json](review.json) binds the manual source review and existing deterministic structure/exact-text checks to that report's hash. The request runner records attempts before sending and skips previously attempted models. Its `postprocess` mode and the renderer are offline. No credential was written to these files.

Re-render without requests:

```powershell
python evaluation/capcontext-bench/render-screen-2026-10-15.py
```

The [new image](../../model-ranking-dark-2026-10-15.png) reuses the retained dark image's dimensions, typography, colors, marks and layout. The October 3 archive stays separate because its inputs, prompt and review differ.
