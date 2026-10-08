# Claude paste failure: published extension gap

Inspected October 6, 2026. The owner confirmed user 3 uses the Chrome Web Store extension.

## October 8 release audit

Google's update service now downloads version 1.4.10. Both that CRX and the existing local `extension/chrome.zip` contain `platform-content-2026-10-05-tab-ux-speed-v109`, while current source contains `v119`. Their `platform-content.js` and `background.js` differ from source. The downloaded files lack the current `CANCEL_TRANSFER` handling/paste guards and `paste_unconfirmed` guard. Matching manifest versions alone therefore do not prove that recent cancellation and duplicate-paste fixes reached installed users. The cached listing page still reports an older version; the downloaded CRX is the artifact evidence.

Source version 1.4.11 prepares the existing fixes for a distinct update. The owner deleted the previously verified `extension/chrome-1.4.11.zip` and will build a fresh package; its old hash no longer describes current source, which now also supports streamed summary responses. Package the current tracked extension files with `manifest.json` at the archive root. The old generic `chrome.zip` is retained unchanged; do not use it for this release. Store upload/publication remains separate from GitHub publication. Verify the downloaded package and an installed-version transfer after the Store update.

## October 6 evidence

- The current telemetry row for user 3 is DeepSeek → Claude, attempted at 09:47 IST on October 6, with 296,359 captured characters. Summary work is verified; the outcome is `failed`, reason `paste_failed`, stage `paste_started`, extension version `1.4.8`.
- The current database contains one attempt for this user. It cannot establish the frequency of earlier failures or recover the native editor error. Source character count is not pasted-summary length.
- Downloaded the public Chrome Web Store CRX for extension `lpkaciijlhckkdhbgidbjfkldigghnjf` from Google's extension update service. Its manifest is 1.4.8 and its content-script ID is `platform-content-2026-10-03-tight-orb-cutout-v101`.
- That published worker does not set `focusBeforePaste` or `activationSettleMs` for Claude. Its content script lacks Claude's initial stability check, connected-editor checks after click/focus, and verification after final focus.
- The corresponding fixes already exist in repository commit `b64381b` and later handoff changes. The manifest remained 1.4.8, so the repository version number did not distinguish the corrected source from the installed store build.

## Reproduction

Ran the repository's existing tests against the actual published `platform-content.js` and `background.js`, without changing their behavior. All four fail:

1. `paste reacquires a composer replaced by click or focus before writing`: writes to the detached composer.
2. `paste cannot report success when final focus replaces the verified composer`: reports success while the replacement editor is empty.
3. `Claude verifies a settled paste and preserves a draft restored on remount`: misses text cleared by the native app after insertion.
4. `Claude focuses and settles both prepared and fresh composers before paste`: does not focus Claude before delivery.

These prove defects in the shipped path and explain why the repository fixes cannot help an unchanged installed copy. They do not identify which editor transition occurred on user 3's device. Avoid adding speculative large-paste workarounds from source size alone.

## Delivery

Source version 1.4.9 and later carry the existing fixes: focus Claude and settle before paste, reacquire replaced editors, preserve restored drafts, verify stability, and retain one fresh-tab recovery plus manual copy. No new paste algorithm or backend/database change is needed for this release gap.

A Git push or backend deployment does not update Web Store installations. The package must be uploaded and published through the Chrome Web Store; users must receive that update before source fixes affect them. The October 8 section above records the newly verified artifact gap and current release candidate. Existing failed telemetry rows remain unchanged.

## Local validation

- `npm test`: 376 passed, including all four regressions that failed against the published build.
- `npm run test:slow`: the long-capture regression passed.
- Focused installed-Brave DeepSeek JSON → Claude transfer: full fixture capture, one stub-summary request, exact pasted summary, untouched Send, destination-window ownership, pending/ready cues and local telemetry/outbox checks passed. A temporary diagnostic runner omitted the unrelated picker/layout suite; application and transfer assertions were unchanged. These synthetic fixtures do not reproduce user 3's account or chat.
- Broader browser coverage is unverified: the original DeepSeek smoke timed out during picker closure on resize; the default full smoke later timed out in the free ChatGPT layout checks. Both stopped before their intended transfer. Do not describe this package as having passed the complete browser/release gate.
- `chrome-1.4.9.zip` contains all 22 extension source files, byte-verified against this checkout, with `manifest.json` at its root. SHA-256: `91A664830F6FC8ECF51D8CEB51CEC2D74D6CE988663BBB0F7E92E4AE84CBE933`. The archive is local and ignored by Git.
