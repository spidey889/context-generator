# Manual capacity experiments

## Single-request versus chunked large-chat summaries

Compare saved Harbor Atlas runs offline; this makes no API calls:

```powershell
node evaluation/capacity/compare-large-chat.cjs .test-artifacts/comparison-3p5m/direct-report.json .test-artifacts/key-two-chunks-3p5m-authorized/chunks-report.json
```

Each `*-report.json` needs its matching `*-summary.txt`. An optional third argument saves a new JSON comparison without overwriting previous results. Both methods receive the same 13 content checks plus explicit checks for proposal-only scope, undecided retries, unreported testing, owner identity, the first pending step and no deployment. Separate review flags identify archive references promoted into open questions, unsupported testing-approval claims, the observed damaged curl JSON quotes and possible identity/testing-state mistakes. These are targeted lexical checks for this synthetic fixture, not a semantic judge; read the summaries too. A quoted hostile marker alone is not a failure.

Reports must confirm completion and matching input hashes, character counts and models before the tool labels the pair comparable; failed runs never receive scores from leftover summary files. Missing hashes remain unverified. Exit code 1 means the pair cannot be compared; content omissions and review flags remain visible in the JSON for review. Compare timing with attention to cache state and different deadlines. Run focused checks with `node --test --test-timeout=30000 test/large-chat-benchmark.test.js`.

## Existing Dots 500k and 1M experiments

Run only when the owner authorizes live testing:

```powershell
node evaluation/capacity/dots-500k.cjs --prepare-only
.\evaluation\capacity\run-dots-500k.ps1 -TestKey test-a -Repeats 2 -Output evaluation/results/2026-10-23-dots-500k.json
node evaluation/capacity/dots-500k.cjs --chars 1000000 --prepare-only
.\evaluation\capacity\run-dots-500k.ps1 -TestKey test-a -InputChars 1000000 -Repeats 2 -Output evaluation/results/2026-10-23-dots-1m.json
```

The preparation commands generate deterministic synthetic fixtures without calling a provider. The wrappers decrypt only the selected local testing credential, reuse the existing free/private-route and rolling request guard, and restore their environment afterward. They never load a production key or environment file. Credentials and usage ledgers remain outside Git. The runner refuses to overwrite an existing report; select a new output filename for another run.

The fixtures have exactly 500,000 or 1,000,000 JavaScript string units, including platform and speaker labels, across 853 or 1,695 structured turns respectively. They place the same incident facts, corrections, exact code, undecided options and permission boundaries at comparable relative positions, ending with a pending proposal request. The original 500k fixture remains byte-for-byte reproducible. Most history consists of generated reference discussions. Repetition and synthetic text make this easier than some dense real conversations; two repeats of one fixture are not a broad reliability benchmark.

Generation invokes the current backend's `createSummaryWithFallback` with structured turns and its current prompt/profile. Current branch runs validate the request against the backend admission checks before generation, use the 10,000-token larger-chat allowance, disabled Dots reasoning and one 90-second gateway attempt/first-answer budget. Only the encrypted Dots testing key is supplied. Select `-DeadlineSeconds 90` to match the larger-chat stage; the historical 45-second outer deadline remains available for comparison. No TokenHarbor, funded provider or production key is used.

These local runs exercise input validation, provider request construction, SSE parsing and output validation/normalization. They do not exercise a deployed HTTP endpoint, browser capture/paste or telemetry persistence. Each outbound request is checked against the complete fixture and recorded by hash, with full outputs and timings. Local carry is never counted as model success. The runner never edits production source files. Retained earlier reports record their original 7,000-token / 30-second-first-answer / 45-second-stage settings; a new run must use a new filename.

The initial run's request guard was accidentally nested, reserving four local ledger entries for two actual HTTP requests. This was conservative: it sent no extra requests and never exceeded the cap. The runner was fixed after the run; the retained report keeps the original runner hash and notes the accounting issue. The ledger was not reset or reduced. The initial hostile-marker lexical check also flagged a harmless quotation; the manual review distinguishes quotation from obeying an instruction.

See the [500k review](../results/2026-10-23-dots-500k-review.md) and [1M review](../results/2026-10-23-dots-1m-review.md), with their retained JSON, for results and limitations. These tools are separate from ordinary tests, CI and production.

## Output-length diagnostics at 500k

The `dense` fixture preserves the existing active incident and adds 80 active cancellation evidence records, including exact paths, logs, ordering observations and scope. It removes complete unrelated archive turns and keeps exactly 500,000 characters. This gives the summary actual evidence to retain instead of forcing repetition of the sparse fixture. The same dense input is used for the control and both length treatments.

```powershell
node evaluation/capacity/dots-500k.cjs --fixture dense --prepare-only
.\evaluation\capacity\run-dots-500k.ps1 -TestKey test-a -Fixture dense -LengthMode current -DeadlineSeconds 90 -Repeats 1 -Output evaluation/results/2026-10-23-dots-500k-length-control.json
.\evaluation\capacity\run-dots-500k.ps1 -TestKey test-a -Fixture dense -LengthMode 3000 -DeadlineSeconds 90 -Repeats 1 -Output evaluation/results/2026-10-23-dots-500k-length-3000.json
.\evaluation\capacity\run-dots-500k.ps1 -TestKey test-a -Fixture dense -LengthMode 6000 -DeadlineSeconds 180 -Repeats 1 -Output evaluation/results/2026-10-23-dots-500k-length-6000.json
.\evaluation\capacity\run-dots-500k.ps1 -TestKey test-a -Fixture dense -LengthMode detail-first -DeadlineSeconds 180 -Repeats 1 -Output evaluation/results/2026-10-23-dots-500k-length-detail-first.json
```

The control uses the current prompt/profile. The retained original control report used the then-current 7,000-token ceiling; current larger-chat runs use 10,000. The 3,000-word treatment uses a required 3,000–4,000-word instruction with a 10,000-token ceiling; the 6,000-word treatment requests 6,000–7,000 words with a 16,000-token ceiling. The final `detail-first` treatment retains the 16,000-token ceiling but asks for all relevant evidence without a mandatory word floor. Overrides affect only the experiment process before loading the backend, and cloned profiles; production files and cache versions are untouched. These are combined instruction/allowance experiments, not statistical model rankings or isolated token-ceiling comparisons.

The retained output-length diagnostics were compared with the former 45-second OpenRouter stage. The larger-chat branch now uses 90 seconds; 180 seconds remains an experiment-only override. Above 90 seconds, the runner compiles a backend copy in memory with only its provider-attempt timeout changed, recording a separate diagnostic-source hash. It never edits production API files. Current larger-chat first-answer timeout is 90 seconds (180 only in the in-memory extended diagnostic); historical reports retain their original watchdog values. Reports mark whether each completed result also fits 45 seconds. They retain partial streamed answers after a timeout, but partial output, token-truncated answers and local fallback are never model-completion successes. The CLI returns a failure exit code for an abnormal finish or unmet requested minimum; a zero exit code still does not establish semantic quality. Exact evidence checks and a separate required-word-count check accompany the ordinary advisory validation. More words alone are not a quality pass. Do not call the largest observed result the model's absolute maximum. See the [retained output-length review](../results/2026-10-23-dots-500k-length-review.md) for all four attempts and their fidelity failures.

See [the implemented-policy check](../results/2026-10-23-large-chat-policy-review.md) for the fresh 500k/1M calls with the unchanged prompt and larger output cap.
