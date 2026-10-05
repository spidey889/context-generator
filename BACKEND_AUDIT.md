# Cap Context backend abuse audit

Date: 2026-10-05 (IST). Audited source: `42f4457b4d5a5add5a9d756b693011df3afa95cf`.
Branch: `codex/backend-abuse-audit`, in a separate worktree created from the canonical Desktop repository.

This is a read-only source audit of someone deliberately calling the public backend without the extension. Only this report was added. No application code, tests, browser, live API requests, provider calls, database queries or deployment changes were run. The known weakness of rate limiting across serverless instances is excluded. Findings describe this source snapshot; they do not certify the current deployment or account settings.

## Findings at a glance

| ID | Problem | Severity | How easy | Practical damage |
| --- | --- | --- | --- | --- |
| B01 | Public headers allow account-funded summary work | High, when funded fallbacks are configured and reached | Very easy: one ordinary HTTP POST; no secret or installation required | Consume Gemini/Mistral quota or paid credits and occupy summary capacity |
| B02 | Fake failures exhaust the required user-name pool | Medium | Very easy: at most 40 successful small requests for fresh installs | Persistent failure of counted telemetry for new legitimate installs |
| B03 | Unsigned outcomes and install identities can be fabricated | Medium | Very easy: one schema-valid telemetry POST | False transfer history and daily failures; storage and ingestion-budget pollution |

Confidence is high in all three source traces. Deployment configuration and actual billing exposure were not checked. B02 and B03 share an entry point but have different broken controls: a cosmetic name must not gate ingestion, and anonymous diagnostics must not become authoritative statistics.

## B01 — Anyone can reach configured Gemini/Mistral work

**The gate does not authenticate the extension.** `isTrustedExtensionRequest()` accepts an absent or `null` Origin when the caller supplies the public `X-Cap-Context-Client: cap-context-extension/1` marker. It also accepts any syntactically valid Chrome/Firefox extension Origin, including without the marker. A script or command-line HTTP client controls these headers. CORS rejects ordinary webpage origins but cannot establish the identity of a deliberate HTTP caller.

After this gate, `/api/summarize` validates the body and applies request/concurrency limits. It does not require an account, registered installation, authenticated session, entitlement or application spending allowance. `telemetry` is optional. Any nonempty conversation longer than 1,200 characters enters the configured remote chain.

**Minimal trigger, described only:** POST `/api/summarize` with `Content-Type: application/json`, the public client marker, no Origin, and a JSON `conversation` containing 1,201–350,000 characters. No telemetry or receipt is needed. Repeat within the enforced allowance. Identical requests are not deduplicated by the backend; the extension's in-memory cache does not protect direct callers.

**How bad:** a caller can make your configured provider accounts process arbitrary text. Gemini and Mistral can consume quota or money under the account's billing arrangement when earlier routes fail, become unavailable or exhaust their free quota. Large accepted inputs receive the largest output allowances. Provider retries and fallback can add work. Client disconnection only stops response heartbeats; it does not cancel the remote chain or immediately release its slot, so abandoned requests can still spend quota.

**Existing limits matter:** an individual request is finite: 350,000 JavaScript string units, 1,400,000 transcript UTF-8 bytes, a 2,200,000-byte JSON envelope, 8 requests/minute and 40/hour per IP, 8 active jobs per warm instance, a 270-second chain deadline and at most two transport attempts per route. Largest output caps are 7,000 tokens for Mistral/OpenRouter and 20,000 tokens including Gemini reasoning. This finding does not rely on the excluded cross-instance weakness.

**Provider qualification:** Groq is absent from this snapshot. OpenRouter is first by default and requires zero prompt/completion/request prices; this audit does not claim paid OpenRouter routing. Gemini/Mistral require configured keys, and Mistral can be disabled. An attacker cannot select an arbitrary provider, model, URL or output budget through the exact request schema, or guarantee that every request reaches a funded fallback. No exact bill estimate is justified without account and usage data.

**Evidence:** [public marker gate](api/request-security.js#L67-L84); [summary admission](api/summarize.js#L156-L209); [tiny/local threshold](api/summarize.js#L59-L75); [configured routes and deadline](api/summarize.js#L420-L495); [provider request and price/output controls](api/summarize.js#L626-L701); [disconnect cleanup](api/summarize.js#L338-L390).

**Suggested direction:** require a server-verifiable identity/entitlement before funded work; enforce token and spending allowances, with provider account hard caps. A bundled extension secret or stricter Origin regex would remain copyable. Propagate client cancellation to provider calls as an additional cost control.

## B02 — At most 40 fake failures can block new-install counted telemetry

**A small number of requests can consume a persistent prerequisite.** An unsigned `failed` event with a reason other than `no_conversation` increments the failure counter. If its caller-selected `install_id` has no users row, the counter trigger inserts one. The identity trigger requires a unique unused name from `naruto_user_names()`, whose current pool contains exactly 40 entries. With no free name, it raises `P0001` inside the transfer/counter transaction.

**Minimal trigger:** submit the example below to `/api/telemetry`, changing both UUIDs for each request. No summary call, provider key, receipt, actual extension or real failed transfer is required. At most 40 additional successful new-install allocations consume all remaining pool entries; fewer suffice when entries are already used. The special lowercase first-user name can exist outside the pool, but the allocator still has only 40 candidate names.

Forty small requests are comfortably below the configured single-IP and global telemetry budgets, even when shared Redis enforcement works correctly. Rotating install UUIDs trivially creates new per-install identities. This is not the excluded serverless-instance limiter issue.

**How bad:** subsequent counted events for a new legitimate installation — a verified summary or a non-empty-chat failure — cannot allocate its user row. The entire RPC transaction rolls back, and Edge maps the exception to `503 telemetry_upstream_unavailable`. Names remain occupied across daily counter resets; waiting for a rate window does not repair the outage. Client retries also consume ingestion resources.

**Scope of damage:** summaries and pasting still work. Existing-install counters and unsigned events that do not trigger user creation can continue. This is a persistent outage of new-install counted telemetry, not every API operation or all telemetry. The actual remaining name count was not queried.

**Evidence:** [optional proof and RPC forwarding](supabase/functions/transfer-telemetry/handler.mjs#L33-L81); [current failure counter and users insertion](supabase/migrations/20261002221512_remove_transfer_reporting_timestamps.sql#L115-L144); [name allocation and exception](supabase/migrations/20261002100017_minimal_users_and_reset.sql#L61-L80); [40-name pool](supabase/migrations/20261002104015_format_users_and_famous_names.sql#L10-L22). Later migrations preserve this allocator; [the model migration](supabase/migrations/20261003124307_add_served_model_to_transfers.sql#L94-L159) still invokes the same transfer/counter path. `supabase/README.md` already documents pool exhaustion; this finding establishes the deliberate external-abuse path.

**Suggested direction:** make cosmetic names incapable of rejecting ingestion: reuse names, add unique suffixes or provide a safe fallback. Prevent anonymous diagnostics from allocating scarce durable identities. Merely enlarging the pool increases the request count needed for the same attack.

## B03 — Transfer diagnostics and failure counters can be forged

**Schema validity is not authenticity.** `/api/telemetry` uses the same public client gate. Its validators require allowed fields, UUID syntax, enum values and calendar-valid timestamps, but do not prove an installation or event happened. `summary_proof` is optional. Edge deliberately stores unsigned events with `summary_verified=false`; non-empty-chat failures independently increase daily failure counters.

An attacker can create false `started`, `succeeded` or `failed` rows, invent platform pairs/version/timestamps and choose diagnostic character counts up to 2,147,483,647. There is no required earlier started event for a new terminal attempt. Fresh attempt UUIDs bypass duplicate suppression because they represent new rows. Knowing a real user's UUID or guessing an existing attempt is not required for this pollution attack.

**Example valid attack payload, not executed:** send with `Content-Type: application/json` and `X-Cap-Context-Client: cap-context-extension/1`, omitting Origin and proof.

```json
{
  "attempt_id": "11111111-1111-4111-8111-111111111111",
  "install_id": "22222222-2222-4222-8222-222222222222",
  "attempted_at": "2026-10-05T08:00:00.000Z",
  "source_platform": "chatgpt",
  "destination_platform": "claude",
  "character_count": 0,
  "status": "failed",
  "last_stage": "capture_started",
  "failure_reason": "capture_failed",
  "extension_version": "1.4.8"
}
```

**How bad:** one accepted request produces false failure statistics; repeated requests contaminate transfer history, fabricate installations and consume retained storage plus relay/Redis/Edge/database work. Shared limits do not establish authenticity: they allow 180 events/minute and 2,000/hour per claimed install; IP budgets are 3,000/minute and 30,000/hour; global budgets are 20,000/minute, 60,000/hour and 200,000/day. Flooding is bounded by those controls, but valid false writes within them still cause damage. The separate pool consequence is B02.

**What the HMAC does protect:** unsigned `succeeded/completed` reports do not increase `lifetime_summaries`. Invalid supplied proofs are rejected. Valid receipts bind attempt/install/time/platform/version, with v2 confirmation time and v3 model; sticky SQL identities prevent ordinary replay from multiplying verified counts. The receipt intentionally does not sign paste status or character count. A public caller can obtain a genuine receipt by asking the backend to complete a tiny local-direct summary, but that proves real backend work, not a real installation, paid generation or successful paste. It is not HMAC forgery.

**Evidence:** [relay entry and forwarding](api/telemetry.js#L25-L61); [optional proof and diagnostic fields](api/telemetry-validation.js#L68-L118); [Edge optional verification](supabase/functions/transfer-telemetry/handler.mjs#L33-L69); [failure counting](supabase/migrations/20261002221512_remove_transfer_reporting_timestamps.sql#L112-L144); [shared budgets](api/telemetry-rate-limit.js#L30-L40); [receipt binding](supabase/functions/_shared/summary-proof.mjs#L5-L38); [receipt issuance](api/summarize.js#L186-L205); [SQL replay/ownership controls](supabase/migrations/20261003124307_add_served_model_to_transfers.sql#L116-L184).

**Suggested direction:** retain useful anonymous diagnostics as explicitly untrusted data, separated from authoritative counters. Require server-issued identity/attempt evidence where event authenticity matters, and give untrusted events deliberate retention and ingestion budgets. A proof of summary completion cannot independently authenticate a paste or a pre-summary capture failure.

## Controls that held up in source review

- **Request validation:** both handlers reject wrong methods, non-JSON bodies, unknown fields and malformed values. Summary text and envelope sizes are checked independently; telemetry envelopes are limited to 4 KB. Missing or false Content-Length does not bypass the application body-size check. Vercel parsing occurs before these handlers, so this is not a certification of the platform's raw-stream behavior.
- **Bounded upstream work:** fixed provider URLs/models, finite output allowances, retries and deadlines; no caller-supplied fetch URL, shell execution, database SQL or model tool execution. Telemetry relay timeout is 5 seconds; Edge bounds body reading to 1 second and RPC work to 4 seconds.
- **Direct Edge/database access:** Edge has `verify_jwt=false`, but requires the private `TELEMETRY_RELAY_SECRET` before privileged work. A public Supabase key alone does not authorize it. Table/RPC grants deny public, anon and authenticated roles; the service-role RPC enforces immutable attempt identity and sticky outcomes/confirmations/models. The vulnerable path is the public Vercel relay, which supplies its own private credential.
- **Errors/log privacy:** application responses and logs use fixed messages, bounded codes, model IDs and numeric diagnostics. Provider keys stay in backend request headers; telemetry stores closed-schema metadata. No inspected error path returns raw provider/database bodies, stack traces, transcript text or server credentials. Responses are no-store. Existing tests contain leak-rejection fixtures; they were inspected, not run.

Reviewed all six tracked `api/*.js` files, all four telemetry Edge/proof modules, deployment configuration and the relevant migration/counter/grant definitions and tests. No additional source-backed error/log leak was found. Actual Vercel/Supabase platform logging, historical Git secrets, live permissions/deployment parity, billing settings and external WAF/provider spending caps remain unverified. Forwarded-IP trust depends on deployment handling; no unverified header-spoofing claim is included.

Priority at audit time: first close or explicitly budget funded public work (B01); then remove name allocation as an ingestion prerequisite (B02); then separate anonymous diagnostics from authoritative statistics (B03). No fixes were made during the original audit.

## Follow-up fixes — 2026-10-05

- **B01 mitigated in source:** shared atomic IP/global UTC-day work budgets precede every Gemini/Mistral attempt, including retries. Missing/unavailable accounting or exhaustion returns the existing exact local carry; zero-price OpenRouter remains available. An unfinished response closing cancels pending fetch/body/reservation/retry work and stops fallback. Existing extension request and receipt contracts remain compatible. Public headers still do not authenticate callers; a stranger can consume the bounded shared allowance and deny others paid summaries. Already accepted provider charges cannot be reversed. Defaults/configuration are documented in `LOGIC.md`. This is a local source fix, not a deployment or a verified monetary cap.
- **B02 fixed by local migration:** `20261005092255_reuse_exhausted_user_names.sql` keeps unused-name allocation until exhaustion, then reuses a pool name. Only cosmetic name uniqueness is removed; install IDs/user numbers, existing rows/counters, name allowlist, RLS and RPC grants are retained. It has not been applied to the hosted database. B03 remains unchanged at the owner's request.

Initial validation: one end-of-task automated run, without browser or production calls. Node passed 333/334 tests; the new retry-delay case was blocked by the existing warm-instance limiter because its fixture omitted `x-forwarded-for`. Local replay reached all 26 migrations and passed the new exhaustion, signed/legacy/duplicate counting and access/preservation assertions, then failed its final fixture cleanup comparison because PostgreSQL sequences do not rewind on rollback. Corrected the test IPs and restored only the local fixture's sequence state after rollback. These fixture corrections were not rerun during that initial task, per the owner's single-run instruction.

Authorized follow-up verification on 2026-10-05: all 334 regular Node tests, the long-capture regression and 400 local database checks across all 26 real migrations passed on the first full run. No further code correction or second run was needed. The database engine was local PGlite 0.5.8; no browser, production provider call or hosted migration was run. This verifies source and local fixtures, not production deployment or hosted scheduling.
