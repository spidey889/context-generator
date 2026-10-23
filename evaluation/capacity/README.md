# Manual Dots 500k experiment

Run only when the owner authorizes live testing:

```powershell
node evaluation/capacity/dots-500k.cjs --prepare-only
.\evaluation\capacity\run-dots-500k.ps1 -TestKey test-a -Repeats 2 -Output evaluation/results/2026-10-23-dots-500k.json
```

The first command generates the deterministic synthetic fixture without calling a provider. The second decrypts only the selected local testing credential, reuses the existing free/private-route and rolling request guard, and restores its environment afterward. It never loads a production key or environment file. Credentials and usage ledgers remain outside Git. Do not overwrite an existing result when making another run; select a new output filename.

The fixture has exactly 500,000 JavaScript string units, including platform and speaker labels, across 853 structured turns. It places incident facts, corrections, exact code, undecided options and permission boundaries at different positions, ending with a pending proposal request. Most history consists of generated reference discussions. Repetition and synthetic text make this easier than some dense real conversations; two repeats of one fixture are not a broad reliability benchmark.

Generation invokes the current backend's `createSummaryWithFallback` directly with structured turns and the current prompt. It retains the extra-large profile, 7,000-token output allowance, disabled Dots reasoning, SSE parser, 30-second first-answer watchdog, retries, output validation and normalization. Only Dots receives a key. Its single-provider code budget is 90 seconds; an outer 45-second deadline bounds each run to the production dual-gateway OpenRouter stage. This is a deadline approximation, not the complete production fallback graph.

The existing extension/HTTP 350k admission, capture, destination paste and telemetry persistence are not exercised. No production limit or prompt changes are made. Each actual outbound request is checked against the complete fixture and recorded by hash, with timings, usage, complete synthetic output, validation and failure observations. Local carry is never counted as model success. Lexical checks are only diagnostics; read every output for meaning.

The initial run's request guard was accidentally nested, reserving four local ledger entries for two actual HTTP requests. This was conservative: it sent no extra requests and never exceeded the cap. The runner was fixed after the run; the retained report keeps the original runner hash and notes the accounting issue. The ledger was not reset or reduced. The initial hostile-marker lexical check also flagged a harmless quotation; the manual review distinguishes quotation from obeying an instruction.

See [the 2026-10-23 review](../results/2026-10-23-dots-500k-review.md) and its retained JSON for results and limitations. These tools are separate from ordinary tests, CI and production.
