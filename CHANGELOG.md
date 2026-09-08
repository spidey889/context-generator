# Changelog

This file records durable product, architecture, security, release, and workflow changes. It is historical context, not the source of truth for current behavior; agents must use `LOGIC.md` for the current production contract and Git history for commit-level detail.

## How agents should maintain this file

Add an entry when a change does at least one of these:

- Adds, removes, or materially changes user-visible behavior.
- Changes capture, summarization, provider routing, paste, storage, telemetry, security, privacy, or another cross-file contract.
- Fixes a meaningful reliability problem and adds evidence that prevents regression.
- Changes release state, extension version, packaging, deployment, CI, or the required verification workflow.
- Establishes a durable technical decision or replaces an approach a future agent might otherwise restore by mistake.

Do not add entries for:

- Branch creation, deletion, merging, or renaming; checkpoint branches are labels, not product changes.
- Small visual nudges, temporary diagnostics, exploratory attempts, or reverted experiments. Consolidate a sequence of iterations into its final shipped outcome.
- Routine documentation wording, personal notes, local files, generated artifacts, or test-only cleanup that does not change how the project is operated.
- Duplicate descriptions of the same outcome across several commits.

Write entries in past tense and describe the resulting behavior, not every implementation step. When a later change replaces an older approach, make the final state explicit and remove wording that falsely implies the replaced behavior is still current. Never infer that a change was published from its presence on `master`; verify the manifest, release archive, Web Store version, and deployment separately.

## Unreleased on `master` after extension 1.4.2

### 2026-09-08

- Strengthened exact-fact handoffs with a full-transcript checklist and final omission check for protected integrity, implementation-state, ownership, region, identifier, rejected-action, and unresolved-option facts. Bumped the Mistral prompt-cache version so the stronger contract takes effect immediately, and made the live gate's existing single retry cover transient endpoint/provider failures as well as low-quality responses.
- Stabilized Claude composer placement across fresh and existing chats. The final implementation rejects page-sized false composer surfaces, keeps native mic/voice controls inside the real composer, reacts to Voice/Send visibility swaps, and applies separate optical tuning for `/new` and `/chat/...` layouts. Added focused placement tests, opt-in geometry diagnostics, and an installed-extension smoke assertion.
- Rebuilt `LOGIC.md` as the agent-facing production guide, including evidence priority, invariants, runtime ownership, platform and message contracts, capture and summary behavior, verification commands, current risks, and a definition of done. Corrected the provider description in the extension README.

### 2026-09-06 to 2026-09-07

- Added Gemini 3.8 Flash and Gemini 3.7 Flash ahead of the retained Gemini fallbacks under one bounded Gemini-family deadline.
- Reworked the destination picker and handoff card into their current compact dark-glass presentation while keeping progress tied to real capture, summary, and paste events. A proposed animated-mist treatment was reverted and is not part of the final design.
- Restored the minimal three-section static homepage, added a responsive HTML privacy page, and improved keyboard, touch, narrow-screen, and reduced-motion behavior.
- Strengthened summary fidelity for explicitly retained alternatives, numbers, integrity statements, and implementation state. Updated CI action runtimes, narrowed workflow permissions, preserved clean-checkout license coverage, and normalized typographic ranges in live evaluation.

The manifest still reports 1.4.2. These post-release source changes must not be described as published until the extension is deliberately versioned, packaged, and verified; see `LOGIC.md` for the current release warning.

## Extension 1.4.2 — 2026-07-24

- Released a smoother picker-to-handoff experience with backdrop blur, press and selection feedback, crossfades, staged status entry, and reduced-motion support.
- Completed Claude and ChatGPT pasted-content capture, including nested and standalone cards, virtualized rows, DOM remount survival, ordered extraction, and per-transfer state reset.
- Increased Gemini output budgets, tightened boxed-title validation, clarified the embedded Context Carry template, and removed obsolete production diagnostics.
- Added Gemini 3.5 Flash as a fallback before Mistral.

## Extension 1.4.1 — 2026-07-22

- Finalized transfer ordering: the source remains visible until real capture, summary, and paste stages complete; ChatGPT and Grok retain focus-before-paste behavior, while already-pasted inactive destinations are revalidated before activation.
- Made Gemini 3.6 Flash the primary generated-summary model at that time and restored reliable provider-free tiny handoffs, including one- and two-character replies.
- Moved metadata-only telemetry behind the Vercel relay before Supabase, narrowed extension host permissions, and hardened the protected per-install user counter.
- Added an enforced destination-transfer timeout and reduced extension permissions.

## Extension 1.4 reliability and telemetry — 2026-07-18 to 2026-07-21

- Hardened destination recovery with platform revalidation, one bounded fresh-tab retry, stable ChatGPT paste, one truthful manual-copy fallback, and a six-minute page-local transfer lock.
- Raised the supported conversation limit to 350,000 JavaScript characters and added the extra-large summary profile.
- Added backend and extension-worker heartbeats for long summaries, bounded provider deadlines, centralized metadata-only transfer telemetry, a durable retry outbox, closed progress/failure schemas, and explicit user-cancelled status.
- Added protected anonymous usage counters in Supabase and fixed transaction ordering so concurrent first-use events do not create numbering gaps.
- Stabilized platform-specific composer placement during reflow for Claude, ChatGPT, Gemini, Grok, and DeepSeek.

## Capture, summary, and verification hardening — 2026-07-11 to 2026-07-17

- Replaced broad scraping fallbacks with role-verified capture, sequence-aligned virtual-window merging, complete-middle preservation, composer exclusion, structural empty-chat rejection, and explicit oversized-capture failure. Repeated ChatGPT turns became distinguishable through stable structural IDs.
- Removed picker-time warm summarization and the large-profile expansion pass. A destination choice now starts one summary job, concurrent identical work is deduplicated, invalid provider output falls through the bounded provider chain, and the first structurally valid result wins.
- Treated captured conversations as untrusted provider input and hardened the summary endpoint with schema, origin, size, rate, and concurrency controls. Restored compatibility for already-running extension workers without weakening that boundary.
- Added strict seven-section Context Carry validation, accepted the boxed header providers actually return, grounded current state in user-confirmed facts, and limited raw Latest Run transcript retention to 24 hours.
- Added the deterministic quality/latency gate, a separate paced long-capture regression, an isolated Brave installed-extension smoke test, Firefox-safe contenteditable line breaks, and Firefox background-script support.
- Added the dependency-free Cap Context marketing site and made the Chrome Web Store the public installation path.

## Multi-platform transfer foundation — 2026-06-10 to 2026-07-10

- Evolved the original Claude-to-ChatGPT relay into destination selection across Claude, ChatGPT, Gemini, Grok, and DeepSeek, with platform-specific composer discovery, placement, paste activation, and retry behavior.
- Added the Vercel summarization backend, exact Context Carry normalization and destination-confirmation instruction, size-based model routing, Groq fallback, and the Mistral fallback chain used before Gemini became primary.
- Stopped automatic submission on 2026-06-30. Since then, Cap Context has pasted and focused the destination composer but has not pressed Send; do not restore the earlier auto-send experiment.
- Added prepared-destination recovery, instant empty-chat rejection, user-facing failure overlays, and a manual-copy fallback.
- Added the local Latest Run analysis page with provider chain, timing, turn count, and captured-transcript diagnostics.
- Established `master` as the canonical production branch and kept local credentials, MCP configuration, memory notes, and personal task tracking out of shipped source.

## Product origin — 2026-04-17 to 2026-05-15

- Began as a `SKILL.md`-based Context Generator that instructed an AI to produce portable conversation summaries.
- Added the first static landing page, installation flow, downloadable skill, product visuals, and responsive mobile behavior.
- Renamed the original `/generate-context` presentation to `/context-generator` before the browser-extension workflow became the primary product direction.
