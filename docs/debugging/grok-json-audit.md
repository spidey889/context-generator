# Grok JSON audit - 2026-09-28

Scope: Grok network JSON only, from destination-click identity through MAIN transport,
active-branch selection, serialization, bridge delivery and capture metrics.

## Confirmed and reproduced

- Chat/branch identity was chosen after asynchronous handoff. The picker now passes
  the clicked full URL (including `rid`), and the bridge rejects a different identity
  before any network request. Existing branch selection still follows that exact leaf.
- The bridge had no Grok navigation latch. Away-and-back changes during the readiness
  pong or queued response delivery succeeded after MAIN's listeners were absent.
  Bridge listeners now span both phases, latch chat and branch changes, and clean up.
- Capture metrics sent Grok JSON through `cleanText`, rewriting NBSP inside code.
  Grok now joins the existing source-string bypass; DOM cleanup itself is unchanged.
- Blank human messages with file attachments became zero user turns while their
  assistant answers still transferred. Known nonempty attachment ID/metadata arrays
  now cause a visible unsupported-file-only error. No guessed downloads or placeholder
  text are added. Grok's v2 readiness replaces old MAIN closures after reload.

The three initial regression cases failed before fixes. The routing case independently
reproduced six timing/identity combinations, and picker and whitespace failures were
also isolated. Four added tests cover those failures and old-hook replacement. Shared
Grok-only fixtures preserve CRLF, trailing whitespace and NBSP through the installed
extension's exact backend transcript comparison.

## Left unchanged

- Empty text without attachments contains no authored text to preserve. No evidence
  established that `isControl` marks ordinary visible conversation turns. Empty/control
  exclusion stays in place, with a focused compatibility assertion.
- No current evidence established an unmarked truncated/paginated response tree.
  Existing explicit completeness flags/counts, missing bodies and parent validation
  remain; no speculative pagination requests or completeness heuristics were added.
- Ordinary attachments accompanying own text remain outside this text-only adapter.
  This pass prevents a known entire-turn omission; it does not claim file extraction.
- No editor/Build internals, other-source behavior, DOM capture, summary, destination
  or toggle changes were made.

## Evidence and verification

Repository/native sanitized history fixtures establish response IDs/parents and direct
own `message` strings. Attachment field support was cross-checked against the published
[Grok exporter source](https://greasyfork.org/en/scripts/559376-chatgpt-claude-grok-arena-conversation-chat-markdown-export-download/code),
which renders `fileAttachmentsMetadata`/legacy `fileAttachments` independently of message
text and follows URL `rid`. This is schema corroboration, not fresh signed-in native QA.
No production model requests or fresh native-account inspection were made.

Rerun:

```powershell
node --test test/network-json-capture.test.js test/background.test.js
npm test
npm run test:slow
$env:CAP_CONTEXT_JSON_SMOKE = 'grok'
npm run test:extension-smoke
$env:CAP_CONTEXT_NETWORK_FAILURE_SMOKE = 'partial'
npm run test:extension-smoke
$env:CAP_CONTEXT_NETWORK_FAILURE_SMOKE = 'file-only'
npm run test:extension-smoke
```

Results are recorded in CHANGELOG.md after verification.
