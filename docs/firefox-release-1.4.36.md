# Firefox 1.4.36 submission

Prepared on 2026-10-29. No Mozilla login, submission, signing, ZIP creation or publication was performed.

## Owner steps

1. Zip the **contents** of `dist/firefox/`. `manifest.json` must be at the archive root, beside `background.js`; do not zip the containing `firefox` directory or the Chrome `extension/` directory.
2. Zip the contents of `dist/firefox-source/` separately for Mozilla's source upload. It contains readable extension sources, the manifest-preparation script and reproducible build instructions. Do not upload the whole repository, `.env` files, test artifacts or `node_modules`.
3. Sign in to [the existing Cap Context Developer Hub entry](https://addons.mozilla.org/en-US/developers/addon/cap-context/versions). Choose **Upload a New Version**, not a new add-on. The GUID must remain `{8f4d7c20-9f3b-4b7e-9c11-2f4cbe2d41a9}`. Public AMO currently reports 1.3.0; the owner's reported 1.4.2 may be pending or unlisted. Check the dashboard's version history before uploading; this preparation cannot inspect unpublished versions.
4. Upload the first ZIP as version **1.4.36**. Keep desktop Firefox compatibility at **153.0 and later**, with no upper bound; do not add Android. If 1.4.36 already exists in the dashboard, stop and resolve that version rather than uploading a duplicate or changing the Gecko ID.
5. Supply the second ZIP when providing source. Explain that only the manifest is generated; JavaScript is neither minified nor bundled. Use the reviewer notes below. Use `https://spreadz.in/privacy.html` as the privacy policy and `https://spreadz.in/` as the homepage/support site. Keep the existing support email and license.
6. Paste the release notes below, review Mozilla's validation/data declarations, and submit the version. Mozilla controls signing, review and distribution. Existing users may need to approve changed site access; the public older package has a different permission set.
7. When Mozilla publishes it, install/update the signed AMO version and do one real short-chat transfer plus one AI-summary transfer in Firefox. Confirm no Send, preserved destination drafts, and that the diagnostics switch can be disabled while transfers still work. Local fixtures and lint cannot prove the signed update or today's signed-in AI pages.

## Release notes — paste into Mozilla

Bring Firefox up to date with Cap Context 1.4.36: improved conversation capture across Claude, ChatGPT, Gemini, Grok and DeepSeek; more reliable context transfer and draft protection; support for larger chats; clearer recovery when a destination needs sign-in; and improved local Latest Run diagnostics. Messages are placed in the destination composer for you to review, without sending automatically.

Requires desktop Firefox 153 or later. Private windows are not supported. Usage and reliability diagnostics are optional and can be disabled in Firefox's add-on permissions.

## Notes for reviewers — paste into Mozilla

This is an update to the existing Cap Context add-on; its Gecko ID is unchanged. The package is Manifest V3 with Firefox background scripts rather than Chromium's service worker. Minimum Firefox 153 is needed for content-script access to document.adoptedStyleSheets. Private-window execution is disabled to prevent local persistence of private chat content.

Purpose: the user chooses a destination to carry a conversation between five AI websites. Opening the picker may read the current site's own conversation API in the user's current session; session credentials remain in the page world and are not sent to our backend. Selecting a destination starts the transfer. Very short chats stay local. AI summaries use https://context-generator-five.vercel.app/api/summarize; chats above one million characters use bounded parts through /api/large-summary. Model responses are data and never executed. No remotely hosted executable code is loaded.

Required data declaration: personalCommunications (the selected conversation). Optional: technicalAndInteraction (metadata-only usage and reliability diagnostics). The optional Firefox data permission is checked before telemetry delivery and before attaching diagnostic identity to summary requests. Declining it preserves summary and paste functionality, drops queued diagnostics and prevents new diagnostic reports. Revocation aborts pending telemetry POSTs. Local Latest Run is independent: it stores one receipt and, when quota permits, the captured chat text for 24 hours. No generated summary is persisted there. Raw transcript retention is documented in the privacy policy.

The provided source folder contains original readable JavaScript, assets and scripts/prepare-firefox-extension.js. Using Node 22 or later, run `node scripts/prepare-firefox-extension.js` from that source folder; dist/firefox/ reproduces the submitted files without installing dependencies. The preparation changes only manifest.json. No build credentials or private keys are required.

To test, open a supported chat website, create a harmless short exchange, click the in-page orb or browser action, and choose another supported platform. Sign in to those AI services using your own test accounts if required; Cap Context has no separate account or Mozilla-specific login. Check that the text is inserted without pressing Send and an existing destination draft is preserved. A destination requiring sign-in offers manual recovery. Disable optional diagnostics in about:addons and repeat; transfer functionality remains available.

## Readiness and validation

Known audit limitations at integration: revoking optional diagnostics during an above-1M transfer changes the receipt identity and the final merge rejects it as `invalid_parts`, leaving full-text local recovery. Opt-out cleanup clears local storage but leaves session-backed active reports; these can be restored and sent after consent is granted again. Both were reproduced with the real receipt protocol/worker fixtures and remain unresolved in this branch. Existing consent tests use synthetic part receipts and do not establish mid-transfer receipt compatibility.

- The original packaging lacked a minimum Firefox version, optional diagnostics consent and a private-window restriction. These were corrected for the owner-approved desktop 153+ scope.
- Regular offline tests: 969 passed. Slow release checks: 3 passed.
- Mozilla web-ext 10.8.0 lint: zero errors, warnings or notices for the generated 1.4.36 package.
- Source preparation verifies all 26 upload files reproduce byte for byte. No archive has been made or checked; the owner makes the ZIPs.
- Installed Firefox 159 fixture: native optional-data permission, toolbar/picker/constructed stylesheets, exact MAIN-world ChatGPT JSON capture, summary, cross-tab paste, no Send and local Latest Run passed. Diagnostics were declined: one summary request, zero telemetry requests, two native-history fixture reads. This is synthetic integration evidence, not live provider/model or oldest-supported-version certification.
- Canonical Brave ChatGPT JSON release fixture passed, including exact paste/no Send and signed fixture telemetry. The older default DOM smoke stopped at its synthetic source's empty-chat guard; its cause was not established or changed in this Firefox task. Do not describe that default check or all DOM fallback flows as passing.

## Recreate and verify

```sh
npm run package:firefox-submission
npx --yes web-ext@10.8.0 lint --source-dir dist/firefox
npx --yes --package=web-ext@10.8.0 -- node scripts/run-firefox-smoke.js
```

The Firefox smoke uses an installed Firefox and disposable local fixtures, synthetic chat data and a stub backend. Set `FIREFOX_PATH` for a nonstandard executable. The Windows default is `C:/Program Files/Mozilla Firefox/firefox.exe`. It never accesses real chats or spends AI quota. The submitted upload folder contains no test hooks or fixture permissions.

References: [Firefox 153 stylesheet support](https://blog.mozilla.org/addons/2026/07/23/firefox-153-webextensions-api-updates/), [Firefox data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/), [source submission](https://extensionworkshop.com/documentation/publish/source-code-submission/), [updating an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/).
