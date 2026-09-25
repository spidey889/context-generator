# Changelog

- 2026-09-25: Fixed Dark Reader washing out the destination picker on ChatGPT. Protected the existing palette with an ignored picker stylesheet, scoped fallback colors, and priority-preserving hover/selection styles. A new Brave window showed matching computed picker colors on ChatGPT with Dark Reader active and Grok without it; the isolated extension smoke runner was blocked by a GPU process crash.

- 2026-09-25: Fixed two failing placement tests by giving the fake DOM element `querySelector` and making the inner-wrapper fixture return only nodes matching its composer selectors. The production extension is unchanged. The full test suite and isolated Brave extension smoke passed; live Gemini, Grok, and DeepSeek placement was not checked.

- 2026-09-25: Pruned four low-signal tests that only matched handoff animation/microcopy or Latest Run receipt wording in source text. Kept behavioral coverage and source checks that guard transfer safety, privacy, and paste recovery.

- 2026-09-25: Prepared extension source version 1.4.6 and a versioned, file-compared ZIP for the summary paste fix. The direct-download link now points to that archive; this does not establish a Chrome Web Store update or a live browser verification.

- 2026-09-25: Hardened summary pasting after production telemetry recorded failures at the paste stage. Paste discovery now skips disabled/read-only editors when another writable composer is available, retains a verified composer through temporary disabled native-overlay states, and retries after an editor remount. Verification now requires summary content from the beginning, middle, and end while tolerating punctuation and line-break changes, preventing partial inserts from being reported as complete. Advanced the content-script load identity so the updated paste logic replaces an older instance on open tabs when reinjected.

- 2026-09-20: Added a Grok-only adaptive capture profile: shorter normal stability polling, overlap-proven 70%/90% viewport advances, and a delayed-render guard that waits only when a physical scroll has not produced a new virtualized window. Claude, ChatGPT, Gemini, and DeepSeek retain their existing capture timing. Focused regression coverage proves complete 40-turn fast capture and complete 24-turn capture when Grok renders each window 140 ms late.

- 2026-09-18: Resumed Ministral 3 14B after the owner confirmed Flash-Lite handled a large conversation. Production `MISTRAL_ENABLED=true` restores Flash 3.6 -> Mistral -> Flash-Lite without changing 90-second budgets or the other provider pauses.

- 2026-09-18: Added the approved one-time apology notice for one privately configured install, with atomic server claiming, local duplicate protection, near-orb placement, OK/30-second dismissal, and durable acknowledgement retry. Added a small Redis receipt tracker distinguishing claim, display, OK, and timeout. Bumped extension to 1.4.5; existing users need that update before delivery. Automated tests were intentionally deferred at the owner's request.

- 2026-09-18: Added a standalone apology-notice preview near a mock AI composer orb, with human wording, OK dismissal, and a 30-second timeout. This is for design approval only; no targeted message or production delivery feature has been activated.

- 2026-09-18: Added `MISTRAL_ENABLED=false` as a reversible production pause for testing Flash-Lite after Flash 3.6. Mistral's key, route, and 90-second budget remain; remove the variable or set it to `true` and redeploy to resume.

- 2026-09-18: Switched the primary Google model from Flash 3.8 to Flash 3.6 at the owner's request. Retained Flash 3.8 in the paused fallback list; the active Mistral/Flash-Lite order, daily health handling, and 90-second budgets are unchanged.

- 2026-09-18: Confirmed Fluid Compute is enabled on Hobby and raised server/client limits to 300/320 seconds. Replaced the short four-Flash attempts with three active 90-second routes: Flash 3.8, Ministral 14B, and Flash-Lite. Paused other Flash models and Groq behind reversible switches; Orca remains paused. Re-enabling Orca/Groq consumes the terminal allowance rather than increasing total remote time beyond 270 seconds.

- 2026-09-18: Reserved time for each remaining Gemini Flash model within the existing 60-second family deadline so slow 3.8/3.7 attempts cannot consume the entire allowance before 3.6/3.5. Retained daily health skips and the overall provider timeout.

- 2026-09-18: Replaced the terminal Google Gemma 4 31B attempt with stable Gemini 3.5 Flash-Lite after the owner verified Gemma had only 16k input tokens/minute, while Flash-Lite showed 250k on the same project. Retained the existing Google key, minimal thinking, timeout allowance, relaxed output handling, and Orca pause switch. Gemma is no longer in the active chain.

- 2026-09-18: Paused OrcaRouter by default while retaining its key and route behind `ORCAROUTER_ENABLED=true`. Added Google Gemma 4 31B via the existing Google key as the final remote attempt after Groq and before full-transcript local carry, with minimal thinking and a 60-second allowance shared with Orca when unpaused. Documented restoration in `docs/provider-fallbacks.md`.

- 2026-09-18: Temporarily made generated-summary validation advisory so non-empty provider output is delivered even when the requested header, seven-section structure, or quality checks fail. Valid output keeps canonical normalization; imperfect text is preserved with the destination-confirmation instruction appended. Empty output and service failures still fall back. Retained the strict validator and documented restoration in `docs/summary-validation.md`.

- 2026-09-13: Added explicit content-script instance teardown for reinjection. A new version now retires the previous instance before startup by removing its runtime and DOM listeners, disconnecting owned observers, cancelling timers, intervals, and animation frames, restoring reservations, and removing owned UI.

- 2026-09-13: Made Gemini, Grok, and DeepSeek placement react to composer control mutations that do not resize the composer. Their anchors now follow the left edge of the visible right-side control row, removing Grok/Gemini English-name matching and DeepSeek's penultimate-button assumption.

- 2026-09-13: Removed the unvalidated input-parent composer fallback. Surface discovery now fails closed when no scored and validated ancestor or form qualifies, preventing inner editor wrappers from becoming placement or retained-reservation roots.

- 2026-09-13: Prevented settings and native modal textareas/contenteditables from replacing the verified chat composer. Shared input discovery now excludes new dialog-owned editors while preserving the already verified composer through native overlay states.

- 2026-09-13: Stabilized Gemini, Grok, and DeepSeek placement across transient composer remounts. Their composer-owned orb now holds its last verified viewport position through a bounded 700 ms discovery gap, then immediately reattaches and recalculates when the live composer returns; persistent loss still hides it normally.

- 2026-09-13: Prevented F11 fullscreen resize/reflow from focusing the Cap Context orb. Composer-lifecycle cleanup now closes stale picker UI without trigger-focus restoration, while explicit keyboard, backdrop, and orb dismissals retain their intended focus behavior.

- 2026-09-13: Fixed Grok Build and Heavy mode placement by recognizing the complete visible mode set and reusing the existing correct Fast-mode anchor path instead of falling back onto the active control.

- 2026-09-13: Kept Cap Context visible when native menus or popovers temporarily mark the still-visible composer subtree `aria-hidden`. The shared placement path now retains only its last verified connected input, while removed or visually hidden composers continue to hide the orb.

- 2026-09-13: Fixed ChatGPT free-plan placement so Cap Context anchors before the complete visible right-side control row instead of occupying the mic slot when the paid reasoning control is absent. Paid placement remains anchored to the reasoning control.

- 2026-09-13: Fixed Cap Context stealing focus from native controls and composers across ChatGPT, Gemini, Grok, and DeepSeek. Their shared outside-click path now dismisses an open destination picker without refocusing the Cap Context button, while keyboard and backdrop dismissal retain trigger-focus restoration. Updated the content-script load identity so the corrected shared behavior is loaded consistently.

- 2026-09-13: Raised OrcaRouter's request budget from 45 to 60 seconds and confirmed its current free GLM route displays as `Orca / GLM 5.3 Flash`.

- 2026-09-13: Latest Run now records and displays OrcaRouter's concrete resolved model from `X-Orca-Resolved-Model`, including readable Orca / DeepSeek and Orca / GLM names, instead of presenting the `orcarouter/free` request alias as the serving model.

- 2026-09-13: Added OrcaRouter's strictly free `orcarouter/free` route between Gemini and Mistral. The integration uses a dedicated Vercel secret, a 45-second budget, immediate fallback on free-tier 429 responses, complete Latest Run provider/model reporting, and no path to OrcaRouter's paid automatic models. The full remote-provider allowance remains 175 seconds inside the extension deadline.

- 2026-09-13: Removed `mistral-large-2512` from the active route after production repeatedly returned HTTP 403 code 1910, confirming the Free-tier key cannot access it even though the Limits page displays a theoretical rate limit. `ministral-14b-2512` is now the sole Mistral model, avoiding a failed request on every transfer.

- 2026-09-13: Replaced the Mistral route with the user-selected two-model chain: `mistral-large-2512` first, then `ministral-14b-2512`. Medium 3.5 and Ministral 3B are no longer active models.

- 2026-09-13: Removed Mistral Large 3 from the active fallback chain after production proved the API key consistently receives HTTP 403 for it. Mistral 429 responses now move immediately from Medium 3.5 to Ministral 3 3B instead of waiting on a same-model retry, and safe error-code parsing now supports Mistral's root-level error format.

- 2026-09-13: Corrected the Mistral fallback API IDs and made model-specific HTTP 429 responses advance to the next Mistral model instead of incorrectly skipping the whole provider.

- 2026-09-12: Fixed provider rate-limit retries to honor `Retry-After`, with a one-second minimum for HTTP 429 responses, instead of retrying Mistral inside its one-request-per-second window.

- 2026-09-12: Stopped rejecting otherwise valid Groq summaries solely because the model paraphrased NEXT STEP; normalization still replaces that section with the trusted exact destination instruction.

- 2026-09-12: Replaced the retired Groq Llama 3.1 fallback with Groq Compound Mini for its larger free-tier token allowance and active production availability.

- 2026-09-12: Replaced the unreadable one-line fallback log with a vertical model path that separates daily skips from models tried in the current run and formats provider model names for people instead of internal IDs.

- 2026-09-12: Replaced the analysis page's blue treatment with a two-tone plum-and-gold upper atmosphere that fades into black, and reduced lower metrics to a restrained warm palette without using a green/red combination.

- 2026-09-12: Reworked the analysis page for readability with a neutral blue-gray background, wider receipt column, brighter supporting text, calmer metric colors, and accessible 44px controls while preserving the roomy layout.

- 2026-09-12: Restored the spacious Latest Run hero height after receipt cleanup and distributed the remaining receipt details evenly instead of shrinking both cards.

- 2026-09-12: Simplified the analysis receipt by removing duplicate route, summary-source, capture-path, and expansion rows; renamed backend match to the clearer input check.

- 2026-09-12: Polished the analysis Latest Run layout with a more balanced two-column receipt, clearer fallback emphasis, and calmer card hierarchy without changing receipt behavior.

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

## Extension 1.4.4 candidate on `master`

### 2026-09-13

- Advanced the extension manifest version to 1.4.4. This source version does not by itself confirm that the release archive or Web Store listing has been updated.
- Tried and removed an isolated idle-orb shimmer after the visual treatment did not read naturally. Production retains the existing orb appearance and animations.

### 2026-09-12

- Added shared daily Gemini model health for Vercel deployments. With Upstash Redis connected through its current `KV_REST_API_*` variables or older `UPSTASH_REDIS_REST_*` aliases, each model is skipped until the next Pacific day after 20 successful summaries, three consecutive failed attempts, or an explicit daily-quota response. Gemini rate limits now move directly to the next model instead of retrying the same one. The store contains model-only counters and timestamps, fails open to the existing provider chain, and has a documented Vercel setup and off switch.
- Corrected Latest Run model reporting: the main card now identifies the model that actually served, the fallback log no longer marks that model as both failed and successful, and Gemini models skipped by daily health state now pass through the local receipt.

### 2026-09-09

- Reworked the orb-to-picker-to-handoff motion as one continuous interaction: the picker now has clearer open/close state and focus behavior, destination selection holds while alternatives recede, the handoff surface expands from the picker's measured position, the detached orb leaves during transfer, and handoff/error exits animate instead of disappearing abruptly. Follow-up micro-polish clarified review-before-send behavior, made wait estimates deliberately approximate, kept stage headlines readable through transitions, and removed duplicate assistive announcements. Reduced-motion behavior remains immediate.

### 2026-09-08

- Retained the standalone skill, legacy homepage, and its dated demo video as non-production reference artifacts by owner request; the legacy page now reuses the extension's canonical logo assets instead of restoring duplicate logo files.
- Removed verified dead code and duplicate artifacts, consolidated the public site onto the extension's canonical logo assets, centralized duplicate Vercel request parsing without changing endpoint contracts, and brought the Brave smoke's placement-diagnostic assertions back in sync with the production diagnostic schema. The separately deployed Vercel and Supabase telemetry validators remain intentionally duplicated and parity-tested.
- Restored transfer reliability during Gemini-family congestion and provider-wide outages: corrected the two dated Mistral fallback IDs to their documented forms, reduced the shared Gemini window so the complete 195-second provider allowance stays 15 seconds inside the extension's 210-second deadline, and added a terminal provider-free fallback that carries the complete untruncated transcript when every remote model fails.
- Refocused public and project documentation on cross-AI continuity, structured context, and preserved decisions instead of foregrounding a secondary interaction detail.
- Strengthened exact-fact handoffs with a full-transcript checklist and final omission check for protected integrity, implementation-state, ownership, region, identifier, rejected-action, and unresolved-option facts. Bumped the Mistral prompt-cache version so the stronger contract takes effect immediately, and made the live gate's existing single retry cover transient endpoint/provider failures as well as low-quality responses.
- Replaced Claude's null-anchor bottom-right fallback with anchored, lifecycle-stable placement. The orb now uses a page-stable fixed root, accepts only surfaces geometrically matched to a visible native control, retains the last valid position through bounded hydration/remount gaps, and reserves hidden mounted Voice/Send controls before visibility swaps. Existing optical tuning remains limited to successfully anchored placements.
- Removed the remaining Claude transition artifacts: SPA pathname changes now refresh route-specific vertical alignment after `/new` sends, the docked chat optical adjustment is applied after composer-local bounds so Claude's 48 px surface cannot erase it, and newly visible or remounted Mic/Send controls snap into their reserved slot before paint without inheriting Claude's transform animation.
- Fixed the persistent Claude Mic/Voice overlap exposed by those diagnostics. Claude updates editor emptiness and the control DOM in separate commits; the prior reservation held `transition: none` on native controls and could strand Claude's outgoing visual layer. Reservations now use the independent CSS `translate` property with the same offsets, preserving Claude's own transform/transition lifecycle and the validated final placement geometry.
- Moved Claude's side-control reservation from each transient button to the persistent grid that owns both Send and Mic/Voice branches. Newly mounted controls now inherit the already-reserved position while Claude completes its multi-commit swap, eliminating the visible Mic-on-Voice reflow without changing final offsets or orb geometry. Removed the temporary placement/control console instrumentation after verification; the Brave smoke now checks geometry and reservation state directly.
- Rebuilt `LOGIC.md` as the agent-facing production guide, including evidence priority, invariants, runtime ownership, platform and message contracts, capture and summary behavior, verification commands, current risks, and a definition of done. Corrected the provider description in the extension README.

### 2026-09-06 to 2026-09-07

- Added Gemini 3.8 Flash and Gemini 3.7 Flash ahead of the retained Gemini fallbacks under one bounded Gemini-family deadline.
- Reworked the destination picker and handoff card into their current compact dark-glass presentation while keeping progress tied to real capture, summary, and paste events. A proposed animated-mist treatment was reverted and is not part of the final design.
- Restored the minimal three-section static homepage, added a responsive HTML privacy page, and improved keyboard, touch, narrow-screen, and reduced-motion behavior.
- Strengthened summary fidelity for explicitly retained alternatives, numbers, integrity statements, and implementation state. Updated CI action runtimes, narrowed workflow permissions, preserved clean-checkout license coverage, and normalized typographic ranges in live evaluation.

The manifest reports 1.4.4. These source changes must not be described as published until the extension is packaged and verified against the release archive and Web Store; see `LOGIC.md` for the current release warning.

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
