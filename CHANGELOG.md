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

- Retained the standalone skill, legacy homepage, and its dated demo video as non-production reference artifacts by owner request; the legacy page now reuses the extension's canonical logo assets instead of restoring duplicate logo files.
- Removed verified dead code and duplicate artifacts, consolidated the public site onto the extension's canonical logo assets, centralized duplicate Vercel request parsing without changing endpoint contracts, and brought the Brave smoke's placement-diagnostic assertions back in sync with the production diagnostic schema. The separately deployed Vercel and Supabase telemetry validators remain intentionally duplicated and parity-tested.
- Restored transfer reliability during Gemini-family congestion and provider-wide outages: corrected the two dated Mistral fallback IDs to their documented forms, reduced the shared Gemini window so the complete 195-second provider allowance stays 15 seconds inside the extension's 210-second deadline, and added a terminal provider-free fallback that carries the complete untruncated transcript when every remote model fails.
- Refocused public and project documentation on cross-AI continuity, structured context, and preserved decisions instead of foregrounding a secondary interaction detail.
- Strengthened exact-fact handoffs with a full-transcript checklist and final omission check for protected integrity, implementation-state, ownership, region, identifier, rejected-action, and unresolved-option facts. Bumped the Mistral prompt-cache version so the stronger contract takes effect immediately, and made the live gate's existing single retry cover transient endpoint/provider failures as well as low-quality responses.
- Replaced Claude's null-anchor bottom-right fallback with anchored, lifecycle-stable placement. The orb now uses a page-stable fixed root, accepts only surfaces geometrically matched to a visible native control, retains the last valid position through bounded hydration/remount gaps, and reserves hidden mounted Voice/Send controls before visibility swaps. Existing optical tuning remains limited to successfully anchored placements.
- Removed the remaining Claude transition artifacts: SPA pathname changes now refresh route-specific vertical alignment after `/new` sends, the docked chat optical adjustment is applied after composer-local bounds so Claude's 48 px surface cannot erase it, and newly visible or remounted Mic/Send controls snap into their reserved slot before paint without inheriting Claude's transform animation.
- Expanded opt-in Claude placement diagnostics for the remaining Send-to-Mic/Voice overlap. Mutation records now correlate each mounted control across before/after snapshots and expose geometry, visibility, transforms, transitions, and reservation ownership without changing placement behavior.
- Fixed the persistent Claude Mic/Voice overlap exposed by those diagnostics. Claude updates editor emptiness and the control DOM in separate commits; the prior reservation held `transition: none` on native controls and could strand Claude's outgoing visual layer. Reservations now use the independent CSS `translate` property with the same offsets, preserving Claude's own transform/transition lifecycle and the validated final placement geometry.
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
- Replaced the earlier automatic-submission experiment with the current user-reviewed composer handoff.
- Added prepared-destination recovery, instant empty-chat rejection, user-facing failure overlays, and a manual-copy fallback.
- Added the local Latest Run analysis page with provider chain, timing, turn count, and captured-transcript diagnostics.
- Established `master` as the canonical production branch and kept local credentials, MCP configuration, memory notes, and personal task tracking out of shipped source.

## Product origin — 2026-04-17 to 2026-05-15

- Began as a `SKILL.md`-based Context Generator that instructed an AI to produce portable conversation summaries.
- Added the first static landing page, installation flow, downloadable skill, product visuals, and responsive mobile behavior.
- Renamed the original `/generate-context` presentation to `/context-generator` before the browser-extension workflow became the primary product direction.
