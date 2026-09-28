# Claude network JSON audit — 2026-09-28

Scope: `claude-fetch-main.js`, `claude-json-capture.js`, their manifest/background installation, and the Claude JSON branch of the picker transfer. DOM capture, other sources, summarization, destination behavior, and toggle behavior are outside the audit.

## Confirmed fixes

1. **Rendered-history gate:** the picker rejected Claude JSON with zero mounted turns even when the API tree was available. Claude JSON now lets JSON validation decide whether history is usable. Its installed-Brave fixture intentionally has no rendered turns.
2. **False readiness timeout:** every capture depended on a worker callback within three seconds, despite a working MAIN hook. A versioned correlated ping proves readiness directly; missing/older/replaced hooks get bounded recovery and can become ready before the callback arrives.
3. **Wrong chat during setup/handoff:** chat identity was read after worker setup and picker animation. The picker now passes its destination-click path, and the bridge pins identity before setup. Navigation cannot redirect the capture to a newly selected chat.
4. **Navigation delivery gap:** MAIN removed navigation listeners before posting its response. An away-and-back navigation during response delivery could evade a final pathname comparison. Bridge listeners now span setup through response processing and retain any observed chat change.
5. **Lost routing on hook replacement:** reinstalling around a new page fetch wrapper discarded known routes that had disappeared from resource timing. The v3 hook carries forward its bounded route map without retaining bodies or credentials.
6. **Pasted-card loss:** substring/content deduplication suppressed distinct identical cards and shorter cards contained in another paste or prompt. Deduplication now uses attachment IDs and one complete inline paragraph representation per card; distinct cards remain ordered.
7. **Pasted whitespace loss:** trimming removed initial indentation and outer whitespace from original code/text cards. The original extracted string is preserved, including when it replaces an inline representation; byte validation still happens before serialization.

## Investigation method for later source audits

- Trace native hook observation, routing, readiness/reinstallation, explicit request, transport, active branch, own text/paste extraction, transcript limits, and transfer integration in that order.
- Read current code and existing schema evidence before forming a hypothesis. Use native inspection or a narrow web lookup when a fix needs facts the code/fixtures cannot establish.
- Reproduce failures with production scripts in a VM harness. Stub only browser/relay boundaries and assert exact transcript/order, request counts, refusal to transfer, and listener cleanup.
- Test new regressions against pre-fix source in an external temporary checkout. This audit's initial expanded 43-test file produced 13 failures against pre-fix source and passed all 43 after fixes; two pre-existing assertions were updated for preserved whitespace and clearer navigation errors. A further regression checks multiple inline ranges and offset-safe whitespace restoration, bringing the final Claude file to 44 tests.
- Continue after each fix. Review the final task diff for races, privacy boundaries, enum/version consumers, side effects, and stale documentation. Keep unrelated local changes out of staging.
- Verify installed-extension success/reload and incomplete-response rejection with a stub backend, then the full deterministic suite and release/slow capture test. Browser fixtures prove integration; they do not establish a fresh native Claude schema or production provider behavior.

## Checks retained after review

Full-tree request parameters discard observed pagination/windows. Exact conversation identity, duplicate message IDs, missing parents, cycles, root markers, explicit completeness/page/count metadata, unfinished captured turns/blocks, pasted byte counts, and transcript size limits remain enforced. Parent traversal determines ordering and excludes inactive branches. Tools/files/images/artifacts are intentionally excluded and cannot contribute nested text. Capture remains explicit and has no silent DOM fallback. Existing background sender/frame validation, startup injection, local receipt method, summary/paste pipeline, and no-auto-send contract were traced without changing them.

Completeness limitation: a server omission with no marker, no count discrepancy, and an internally consistent active tree cannot be independently detected. This audit does not claim otherwise.

## Final verification

- `npm test`: 311/311, including all 44 Claude JSON tests.
- `npm run test:slow`: 1/1, a 78-turn Claude sweep preserving 62,177 characters.
- Isolated Brave ordinary smoke: exact summary pasted, no Send click.
- Claude JSON smoke with no rendered history: complete ordered API history and pasted card reached the stub backend once; exact summary pasted, no Send click.
- Claude extension-reload smoke: open source page was not refreshed; no automatic body capture; explicit transfer succeeded.
- Claude partial-response smoke: visible refusal with zero summary backend requests.
- Task-owned syntax/diff checks passed. Unrelated `todo.md` and `extension/crisp orb.png` were preserved and excluded from the commit.
