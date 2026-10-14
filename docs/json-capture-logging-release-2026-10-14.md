# JSON logging deployment and package

Version remains **1.4.18**, as requested. Limits, messages and capture/fallback
behavior are unchanged. New records contain numbers and closed labels only.

- Database migrations: `20261014075318_json_capture_attempt_diagnostics` and
  `20261014080744_json_capture_transport_check_labels`. Local filenames match the
  timestamps allocated by Supabase. Legacy diagnostics and private-field rejection
  were checked against the deployed validator.
- Edge: `transfer-telemetry` version **19**, project `iqkzynzxbmemhtiupwwu`.
- Production relay: `dpl_DLRqCmiUKGvRDXLLYVZLve6V6TMG`, backend source
  `8bc185ca946a8a0c9d85a35aefb0a108d4920145`, alias
  `https://context-generator-five.vercel.app`. All stages deployed before client emission.
- Legacy synthetic 1.4.16 report: `13529b6e-754d-47c4-9eee-eed889d49c99`, HTTP 204.
- Live installed-worker → production relay → Edge → database:
  `e523a26b-b46f-4036-a252-9cb6b304ed74` (synthetic ChatGPT → Claude failed capture).
  Database `json_attempts[0]` has `raw_response_stream_limit`, `reader_bytes`,
  measured **33,554,432**, limit **32,000,000**, stage `history`, status 200.
  This verifies ChatGPT's existing raw guard and incomplete outcome; its original
  no-scraping/no-summary behavior was preserved. No model call or receipt was invented.

Validation: 661 offline tests, release scroll check, 41 migrations / 1,414 database
checks, source/destination handoff matrix, retry/outbox persistence, all five installed
Brave JSON flows, DeepSeek/Claude size-to-DOM recovery with original copy and exact
paste/no Send. Ordinary browser telemetry stayed local. The explicit live smoke
used a disposable profile and mirrored only telemetry/status for local assertions.

Build the generated MAIN metrics bundle with `node scripts/build-json-capture-metrics.js`
before packaging. Include tracked extension files only, with `manifest.json` at the
ZIP root. The Chrome package removes Firefox-only manifest settings and
`background.scripts`, retaining the MV3 service worker and existing permissions.
Compare every other ZIP entry to its Git blob; do not package secrets, other
archives, smoke modifications or test data. Chrome's service-worker format is
documented in [the official migration guide](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers).

Package: `extension/chrome-1.4.18-json-logging.zip`. Upload/publication has not been performed.
