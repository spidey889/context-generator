# Marauder's Map: Cap Context

A navigation guide to the source in this checkout. Cap Context carries chats between Claude, ChatGPT, Gemini, Grok and DeepSeek. The browser extension is plain JavaScript with no build step; Vercel runs the Node/CommonJS backend, and a Supabase Edge function runs on Deno.

## Read first

- [AGENTS.md](AGENTS.md): working rules, commits, browser testing and documentation requirements.
- [LOGIC.md](LOGIC.md): current behavior, architecture contracts, limits and verification commands. Use it for details this map deliberately leaves with their owners.
- [CHANGELOG.md](CHANGELOG.md): decisions, investigations and replaced approaches. [README.md](README.md) is the user-facing introduction.
- `To-do.md`: local, Git-ignored pending work. Read it when present; do not publish it or treat its contents as authorization.

## Where things live

| Path | Purpose |
| --- | --- |
| [extension/](extension/) | Unpacked extension: page scripts, background worker, icons, platform logos and fonts. Load this directory in Brave. |
| [api/](api/) | Vercel HTTP handlers and backend helpers: summaries, request boundaries and telemetry ingress. |
| [backend/](backend/), [lib/](lib/) | Backend modules outside Vercel's API-function directory: user notices and safe provider-error handling. |
| [supabase/](supabase/) | Database migrations, private telemetry Edge function, shared validation/proof contracts and operations docs. |
| [analysis/index.html](analysis/index.html) | Self-contained Latest Run page, including its CSS and JavaScript. |
| [test/](test/) | Node test-runner regressions, synthetic page/API fixtures and shared helpers. |
| [scripts/](scripts/) | Browser smoke runners, database checks/backups, packaging, diagnostics and evaluation tools. |
| [evaluation/](evaluation/) | Summary-quality cases, comparison prompts, retained results, manual benchmark and capacity experiments. |
| [docs/](docs/) | Focused behavior, diagnostics, provider, database, notices and Firefox release guides. |
| [brag/](brag/) | Editable launch-video composition, render/verification tools and captured UI assets; start with its [README](brag/README.md). |
| [.github/workflows/regression-gate.yml](.github/workflows/regression-gate.yml) | Offline checks and separate scheduled/optional live production-summary evaluation. |
| [legacy/](legacy/), [HANDOFF_SKILL.md](HANDOFF_SKILL.md) | Archived manual context skill/model-health notes, and an agent handoff template. These are outside the extension runtime. |

The public homepage and finished videos belong to the separate [context-generator-website repository](https://github.com/spidey889/context-generator-website). This repository owns the extension, backend, privacy page, Latest Run and video-making sources.

## Main connections

```text
Source AI page
  MAIN-world *-fetch-main.js <-> isolated-world *-json-capture.js
                                        |
                                platform-content.js
                                        | chrome.runtime messages
                                  background.js
                                    /         \
                   /api/summarize or           destination tab
                   /api/large-summary         platform-content.js
                          |                   verifies paste into composer
                      AI providers            (user presses Send)

Transfer metadata -> background outbox -> /api/telemetry
  -> Supabase transfer-telemetry Edge function -> database RPCs

Local Latest Run -> chrome.storage.local -> analysis-bridge.js
  -> analysis/index.html via window.postMessage
```

Opening the picker can prefetch native history into source-page memory. Destination selection starts the transfer, destination preparation and any summarization. Short chats use a local carry; ordinary summaries use `/api/summarize`; chats above its 1M-character boundary use the separate part/combine route. Read the exact thresholds, recovery rules and deadlines in `LOGIC.md` and source constants.

## Extension ownership

| Files / search anchors | What they own |
| --- | --- |
| [manifest.json](extension/manifest.json) | Source version, permissions, supported hosts, script order/worlds and worker entry. There is no popup entry; toolbar clicks go through the worker. |
| [platform-content.js](extension/platform-content.js): `PLATFORMS`, `ensureFloatingButton` | Platform selectors, composer placement, observers and page lifecycle. UI markup, styles and motion also live in this file. |
| Same file: `startDestinationTransfer`, `runContextFlow`, `summarizeWithBackend`, `createLocalContextCarry` | Picker capture ownership, transfer progress, summary requests, local carries and source-side recovery. |
| Same file: `getConversationTurns`, `scrapeVirtualConversation` | Structured DOM capture and virtual-history scrolling fallback. |
| Same file: `pasteIntoPlatform`, `pasteIntoPlatformObserved`, `showFallbackModal` | Destination draft protection, insertion/verification, sign-in and manual-copy recovery. |
| [background.js](extension/background.js): `summarizeWithBackend`, `prepareDestination`, `transferToDestination`, `sendMessageWhenReady` | Cross-tab messaging, destination creation/activation/retry, cancellation, backend transport and in-memory summary caching. Also owns durable telemetry delivery, Firefox consent and uninstall-survey registration. |
| [claude-fetch-main.js](extension/claude-fetch-main.js) + [claude-json-capture.js](extension/claude-json-capture.js) | Claude's native history/auth reader and isolated bridge/serializer. |
| [chatgpt-fetch-main.js](extension/chatgpt-fetch-main.js) + [chatgpt-json-capture.js](extension/chatgpt-json-capture.js) | ChatGPT's native tree/auth/pasted-file reader and active-branch serialization. |
| [network-fetch-main.js](extension/network-fetch-main.js) + [network-json-capture.js](extension/network-json-capture.js) + [network-json-data.js](extension/network-json-data.js) | Gemini/Grok/DeepSeek native readers, bridge and shared platform-specific parsing/serialization. |
| [large-transfer.js](extension/large-transfer.js) | Worker helper that partitions large transcripts, summarizes parts and requests their final combination. |
| [transfer-diagnostics.js](extension/transfer-diagnostics.js), [json-capture-metrics.js](extension/json-capture-metrics.js) | Closed diagnostic schema/sanitizers and numeric capture measurements. |
| [user-notices.js](extension/user-notices.js) | Worker-side notice cache, serialization across tabs and persistent seen history; `platform-content.js` gates and renders delivery. |
| [analysis-bridge.js](extension/analysis-bridge.js) | Restricted bridge from local extension storage to the Latest Run page on manifest-listed analysis URLs. |

MAIN scripts can use the site's native authentication; credentials stay in page memory. Bridges return validated capture data to the isolated content world. Preserve this boundary when changing capture, rather than passing auth through runtime messages.

## Backend, persistence and notices

| Files | What they own |
| --- | --- |
| [api/summarize.js](api/summarize.js) | Ordinary summary endpoint: `handleSummary`, `createSummaryWithFallback`, `createSummaryWithProvider`, profiles, provider/model routing, retries, output validation and local fallback. |
| [api/summary-prompt.js](api/summary-prompt.js) | Shared system prompt, carry template, prompt cache version and destination confirmation instruction. |
| [api/large-summary.js](api/large-summary.js), [api/large-summary-protocol.js](api/large-summary-protocol.js) | Part/final summary endpoint, provider policy, strict request validation and signed part receipts binding the final combination to the complete input. Reuses summary-provider helpers from `summarize.js`. |
| [api/request-security.js](api/request-security.js), [api/request-validation.js](api/request-validation.js) | CORS/client checks, bounded request parsing, ordinary summary validation, rate limits and concurrency slots. |
| [api/provider-stream.js](api/provider-stream.js), [api/funded-summary-budget.js](api/funded-summary-budget.js) | Provider SSE decoding/completion checks and shared Redis budgets for funded requests. |
| [api/provider-failure-log.js](api/provider-failure-log.js), [lib/provider-error-diagnostics.js](lib/provider-error-diagnostics.js) | Bounded provider observations, route skips and translation of upstream errors into approved metadata. |
| [api/telemetry.js](api/telemetry.js), [api/telemetry-validation.js](api/telemetry-validation.js), [api/telemetry-rate-limit.js](api/telemetry-rate-limit.js) | Public extension ingress: validate/rate-limit reports, add bounded server observations and forward through the private relay. |
| [supabase/functions/transfer-telemetry/](supabase/functions/transfer-telemetry/) | `index.ts` wires Deno/Supabase; `handler.mjs` authenticates the relay, verifies summary receipts and calls `record_transfer_event` / `record_provider_failure`; `validation.mjs` validates incoming metadata. |
| [supabase/functions/_shared/](supabase/functions/_shared/) | Summary HMAC proofs, diagnostic schema, provider-failure and request-location contracts shared with the Node backend. |
| [supabase/migrations/](supabase/migrations/) | Ordered schema/RPC/trigger history for transfers, users/counters, provider failures and user notices. Replay the chain to understand current SQL; early table names/definitions have been replaced. [supabase/archive/](supabase/archive/) is outside the active chain. |
| [backend/user-notices.js](backend/user-notices.js), [supabase/functions/transfer-telemetry/user-notices.mjs](supabase/functions/transfer-telemetry/user-notices.mjs) | Read-only targeted notice lookup. `/api/user-notices` is rewritten through the telemetry entry, then Edge resolves the installation's user number and reads `user_notices`. Operations: [docs/user-notices.md](docs/user-notices.md). |

Hosted transfer telemetry excludes chat and summary text. The exact Latest Run transcript is retained locally with a 24-hour expiry when storage permits. Database counters distinguish verified summary work from final paste success; start with [supabase/README.md](supabase/README.md) before touching persistence or reporting.

## Checks and tooling

Use Node 22 and [package.json](package.json) for commands; the only root npm dependency is the PGlite development dependency for local SQL replay.

- **Focused regressions:** `node --test --test-timeout=30000 test/background.test.js` is a typical invocation. Match the component: `platform-content.test.js`, `*-json-capture.test.js`, `json-transfer-fallback.test.js`, `summarize.test.js`, `large-{transfer,summary}.test.js`, `telemetry*.test.js`, `user-notices.test.js`, `analysis.test.js` or `extension-packaging.test.js`. `test/helpers/` contains shared clocks, transfer fixtures and provider-budget helpers.
- **Test tiers:** `npm test` runs ordinary deterministic tests; `npm run test:slow` selects slow/release regressions; `npm run test:db` replays migrations locally through [scripts/check-verified-telemetry-db.js](scripts/check-verified-telemetry-db.js). `npm run gate` combines these with extension smoke. Choose the smallest relevant check per `AGENTS.md`.
- **Browser fixtures:** `npm run test:extension-smoke` loads the unpacked extension in isolated Brave. Other `scripts/run-*-smoke.js` runners cover large transfers, many files, copy, sign-in, notices and Firefox. [run-ci-browser-checks.js](scripts/run-ci-browser-checks.js) selects CI browser runs; [smoke-failure-artifacts.js](scripts/smoke-failure-artifacts.js) collects failure evidence. Fixtures do not establish compatibility with every signed-in native account.
- **CI selection:** [scripts/ci-scope.js](scripts/ci-scope.js) classifies the complete change for the workflow's lightweight or full Offline checks. Live production evaluation is a separate workflow job.
- **Summary quality:** `npm run eval` uses [evaluation/cases.json](evaluation/cases.json) through [run-regression-eval.js](scripts/run-regression-eval.js) and calls the deployed API by default. Prompt comparisons use `compare-summary-prompts.js`; manual [CapContextBench](evaluation/capcontext-bench/README.md), [capacity experiments](evaluation/capacity/README.md), `prompts/` and `results/` live under `evaluation/`.
- **Database operations:** `scripts/check-*-db.js` checks specific contracts; [backup-telemetry.ps1](scripts/backup-telemetry.ps1) and [check-telemetry-backup.js](scripts/check-telemetry-backup.js) back up and restore-check data. Read [supabase/README.md](supabase/README.md) and [docs/database-check-audit.md](docs/database-check-audit.md) to distinguish local replay from hosted probes.

## Coupled files and generated output

- Diagnostic changes cross the client, Node/Edge validators and SQL. Keep `extension/transfer-diagnostics.js` equal to `supabase/functions/_shared/transfer-diagnostics.js`; regenerate `extension/json-capture-metrics-main.js` with `node scripts/build-json-capture-metrics.js` after editing its canonical diagnostics/metrics inputs. Do not hand-edit that bundle.
- Capture changes can require both MAIN and isolated bridges, manifest/injection order, hook readiness versions and corresponding fixture tests. Backend receipt/model changes must stay compatible with the worker, Edge verifier and SQL contracts; see `LOGIC.md`'s alignment section.
- `npm run package:firefox` and `npm run package:firefox-submission` generate ignored `dist/firefox/` and `dist/firefox-source/` from `extension/`. Start with [scripts/prepare-firefox-extension.js](scripts/prepare-firefox-extension.js), [prepare-firefox-submission.js](scripts/prepare-firefox-submission.js) and the [Firefox release guide](docs/firefox-release-1.4.36.md). Ask before creating ZIPs.
- [vercel.json](vercel.json) owns function durations, the notice rewrite and legacy homepage/media redirects. [privacy.html](privacy.html) is the served policy; [PRIVACY.md](PRIVACY.md) is its Markdown counterpart. `CNAME` / `_config.yml` retain Pages configuration; `.vercelignore` controls deployment exclusions.
- `dist/`, `node_modules/`, `.test-artifacts/`, `.vercel/` and `.env*` are local/generated state, not source entry points. Preview tools are `scripts/set-local-preview-backend.js` and `check-local-preview-backend.js`; never commit their local auth file or credentials.

A source push, backend deployment, Edge/database rollout and extension-store publication are separate delivery steps. Check the relevant artifact before claiming a production change.
