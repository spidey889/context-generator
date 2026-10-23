# Manual Dots 500k and 1M experiments

Run only when the owner authorizes live testing:

```powershell
node evaluation/capacity/dots-500k.cjs --prepare-only
.\evaluation\capacity\run-dots-500k.ps1 -TestKey test-a -Repeats 2 -Output evaluation/results/2026-10-23-dots-500k.json
node evaluation/capacity/dots-500k.cjs --chars 1000000 --prepare-only
.\evaluation\capacity\run-dots-500k.ps1 -TestKey test-a -InputChars 1000000 -Repeats 2 -Output evaluation/results/2026-10-23-dots-1m.json
```

The preparation commands generate deterministic synthetic fixtures without calling a provider. The wrappers decrypt only the selected local testing credential, reuse the existing free/private-route and rolling request guard, and restore their environment afterward. They never load a production key or environment file. Credentials and usage ledgers remain outside Git. The runner refuses to overwrite an existing report; select a new output filename for another run.

The fixtures have exactly 500,000 or 1,000,000 JavaScript string units, including platform and speaker labels, across 853 or 1,695 structured turns respectively. They place the same incident facts, corrections, exact code, undecided options and permission boundaries at comparable relative positions, ending with a pending proposal request. The original 500k fixture remains byte-for-byte reproducible. Most history consists of generated reference discussions. Repetition and synthetic text make this easier than some dense real conversations; two repeats of one fixture are not a broad reliability benchmark.

Generation invokes the current backend's `createSummaryWithFallback` directly with structured turns and the current prompt. It retains the extra-large profile, 7,000-token output allowance, disabled Dots reasoning, SSE parser, 30-second first-answer watchdog, retries, output validation and normalization. Only Dots receives a key. Its single-provider code budget is 90 seconds; an outer 45-second deadline bounds each run to the production dual-gateway OpenRouter stage. This is a deadline approximation, not the complete production fallback graph.

The existing 350k summary admission, 500k capture admission, destination paste and telemetry persistence are not exercised. No production limit or prompt changes are made. Each actual outbound request is checked against the complete fixture and recorded by hash, with timings, usage, complete synthetic output, validation and failure observations. Local carry is never counted as model success. Lexical checks are only diagnostics; read every output for meaning.

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

The control retains the current prompt and 7,000-token ceiling. The 3,000-word treatment uses a required 3,000–4,000-word instruction with a 10,000-token ceiling; the 6,000-word treatment requests 6,000–7,000 words with a 16,000-token ceiling. The final `detail-first` treatment retains the 16,000-token ceiling but asks for all relevant evidence without a mandatory word floor. Overrides affect only the experiment process before loading the backend, and cloned profiles; production files and cache versions are untouched. These are combined instruction/allowance experiments, not statistical model rankings or isolated token-ceiling comparisons.

The diagnostic 90/180-second deadlines deliberately exceed the production dual-gateway 45-second OpenRouter stage. Above 90 seconds, the runner compiles a backend copy in memory with only its provider-attempt timeout changed, recording a separate diagnostic-source hash. It never edits production API files. First-answer timeout remains 30 seconds. Reports mark whether each completed result also fits 45 seconds. They retain partial streamed answers after a timeout, but partial output, token-truncated answers and local fallback are never model-completion successes. The CLI returns a failure exit code for an abnormal finish or unmet requested minimum; a zero exit code still does not establish semantic quality. Exact evidence checks and a separate required-word-count check accompany the ordinary advisory validation. More words alone are not a quality pass. Do not call the largest observed result the model's absolute maximum. See the [retained output-length review](../results/2026-10-23-dots-500k-length-review.md) for all four attempts and their fidelity failures.
