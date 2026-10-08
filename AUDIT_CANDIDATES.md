# Audit Candidates

Updated 2026-10-08 against current master (`e7a18e2`). This is a shortlist for future investigation, not a list of confirmed bugs or instructions to implement every item. [LOGIC.md](LOGIC.md) is the current behavior contract; [CHANGELOG.md](CHANGELOG.md) records completed work.

## Scope

**Exclude legacy DOM capture and placement work:** scroll sweeps, virtualized DOM history, DOM turn identity/deduplication, card expansion and orb/legacy placement. Do not reopen those audits or refactor the large content script merely to make it smaller.

Current JSON capture, summary transport and destination editor insertion remain eligible. Destination paste necessarily interacts with the site's editor; that does not authorize legacy source-capture or placement work.

Before fixing a candidate, establish a concrete normal-user failure or a reproducible current-source gap. Explain any behavior tradeoff, preserve useful recovery and normal database failure reporting, and prefer a small fix. A hypothetical rare case alone does not justify a new subsystem.

## Current candidates

- **JSON capture completeness and attachment ownership** — `extension/claude-json-capture.js`, `extension/chatgpt-json-capture.js`, `extension/network-json-data.js` and their MAIN hooks. Check current response shapes, selected branches, supported user/assistant text, attachment boundaries, auth/navigation cancellation and completeness. Attachment labels and DeepSeek file boundaries are already implemented. Tool/render exclusions need evidence of useful missing context before expanding capture; never recursively dump arbitrary JSON strings or use legacy DOM parity as the goal.
- **Summary factual quality** — `api/summarize.js`, `evaluation/` and `docs/summary-accuracy-pass.md`. Compare captured facts with the carry: names, prohibitions, accepted/rejected choices and the actual next step. Current acceptance rejects empty/refusal-only output and treats structure/length as advisory; it is not unconditional nonempty acceptance. Propose a policy/model change only with evidence of a better quality, latency and cost tradeoff.
- **Summary routing and provider transport** — `api/summarize.js`, `extension/background.js`, `vercel.json`. Investigate a demonstrated timeout, cancellation, response-shape or fallback error while preserving the configured route order and budgets. Retries already distinguish temporary failures from account/auth/rate errors. Successful-response byte limits are a deferred measurement idea in `docs/improvement-followups.md`, not a reason to add an arbitrary cap.
- **Large exact local carries** — `api/summarize.js` and destination insertion in `extension/platform-content.js`. Verify practical destination limits and complete insertion when provider failure preserves a large transcript. Keep the exact transcript and manual-copy recovery unless a demonstrated limit supports a better approach.
- **Content-script reload and resource ownership** — `extension/platform-content.js`, JSON bridges/MAIN hooks and `extension/background.js`. Investigate only current-instance reinjection, stale hook/readiness or listener/timer leaks with a fixture or user report. Keep legacy placement and DOM capture out of this work.
- **Telemetry delivery and Latest Run accuracy/privacy** — `extension/background.js`, `api/telemetry.js`, `extension/analysis-bridge.js`, `analysis/index.html`. Focus on lost normal-user reports, incorrect displayed outcome/model or raw-transcript expiry/bridge problems. The outbox is bounded to 500 entries/seven days; existing persistence, retry, proof and schema-parity tests are the baseline. Preserve ordinary failure visibility and separate server-summary proof from paste success.
- **Browser and release coverage** — `extension/manifest.json`, `scripts/run-extension-smoke.js`, CI and extension packages. Brave smoke is part of the main gate and covers all five provider fixtures plus JSON/reload/fallback modes. Fixtures do not certify current authenticated native sites or Firefox. Check source/package/installed-version mismatch before adding code for an already-fixed report; add a browser case when a specific uncovered behavior warrants it.
- **Public site privacy and accessibility** — `index.html`, `privacy.html`, `PRIVACY.md`. Check current public copy and user-visible navigation, responsive layout, focus, contrast and reduced motion. This candidate excludes extension orb/legacy placement and does not authorize redesign or publication.

## Already covered; reopen only with new evidence

- Source/destination conversation ownership, source-window tab placement and activation failure propagation.
- Closing transfer tabs cancels work. Trusted Send/edit/clear/Undo prevent paste recovery from reintroducing context.
- Unconfirmed paste replies stop automatic re-send/fresh-tab fallback; explicit editor failures retain normal recovery.
- Live textarea values, tiny exact local carries, summary waiter cancellation, receipt persistence and normal failure attribution have regression coverage.

These safeguards have source/fixture evidence; they are not a claim that every live platform state is proven correct.

## Deferred

- Full worker-restart delivery reconciliation and orphan prepared-tab recovery remain documented limits in LOGIC.md. Do not build a persisted resume protocol without reproducible real-user impact.
- Anonymous telemetry forgery/abuse concerns do not justify removing ordinary failures from the database or changing user accounting merely to close an audit entry.
- Live model comparisons and provider-response size measurements in `docs/improvement-followups.md` remain paused; this inventory refresh does not resume them or authorize live quota/credential use.
