# Changelog

This is a condensed record of meaningful product and architecture changes. Git history contains the detailed implementation trail.

## 2026-09-07

- Restored and polished the minimal three-section homepage: centered the core story, simplified its copy, added a restrained shimmer to `everything`, improved link and touch behavior, and gave How it works a distinct low-glare plum surface.
- Added a responsive HTML privacy experience and refined its typography, contact action, narrow-screen behavior, and public links.
- Updated the regression workflow to current checkout/setup actions with read-only permissions. Fixed clean-checkout licensing coverage and typographic-dash matching in live evaluation.
- Strengthened prompt fidelity for explicitly retained alternatives, numbers, integrity statements, and implementation state.
- Compressed `LOGIC.md` and this changelog so current behavior and meaningful history remain easy to scan.

## 2026-07-24

- Released extension 1.4.2 with a smoother picker-to-handoff sequence, soft backdrop blur, press/selection feedback, crossfades, staged status entry, and reduced-motion support.
- Increased Gemini profile budgets while preserving Mistral/Groq caps, tightened Context Carry title validation, clarified prompt wording, and removed obsolete production diagnostics.

## 2026-07-23

- Completed Claude and ChatGPT pasted-content capture. The final implementation recognizes real Claude labels, resolves nested or standalone cards, sweeps virtualized rows, extracts meaningful descendants, survives DOM remounts, preserves ordering, and resets state between transfers.
- Added `gemini-3.5-flash` between Gemini 3.6 and Mistral. Renamed the retained merged pasted-content branch to `pasted-content-fix`.

## 2026-07-22

- Finalized handoff ordering and motion: progress follows real capture/summary/paste states, connectors finish smoothly, completion ticks appear before destination reveal, and ChatGPT/Grok keep their focus-before-paste requirement.
- Refined the compact near-black handoff card and destination picker without changing transfer logic.
- Made `gemini-3.6-flash` the first generated-summary provider.
- Moved metadata-only telemetry behind Vercel before Supabase and hardened the protected per-install success counter. Released extension 1.4.1.

## 2026-07-18

- Hardened destination recovery with tab revalidation, one bounded fresh retry, stable ChatGPT paste, one truthful manual-copy fallback, and a six-minute source lock.
- Raised the conversation limit to 350,000 characters and added the extra-large summary profile.
- Added backend and worker heartbeats for long summary requests, corrected the Mistral Medium model ID, and introduced the durable metadata-only telemetry outbox.

## 2026-07-17

- Preserved complete provider metadata on two-minute summary-cache hits.
- Finalized ChatGPT scroll-root selection around the nearest eligible turn ancestor and preserved repeated messages through stable turn IDs.

## 2026-07-16

- Added Firefox-safe contenteditable line breaks and the isolated Brave installed-extension smoke test.
- Added one retry to live evaluation, made the Chrome Web Store the public install path, introduced Gemini as the primary provider, and indexed capture containment for better performance.

## 2026-07-14 to 2026-07-15

- Rebuilt the dependency-free root marketing site and replaced filler handoff animation with three real pipeline-driven stages.
- Grounded decisions and current state strictly in user-confirmed transcript facts. Tightened meaningful-section validation and limited raw Latest Run transcript retention to 24 hours.
- Added structural empty-chat handling, restricted ChatGPT host access, and stabilized virtual-window stepping and final baseline merging.

## 2026-07-11 to 2026-07-12

- Hardened capture around structural role evidence, sequence-aligned virtual windows, complete-middle preservation, and no transcript truncation.
- Removed warm summarization and the large-profile expansion pass so destination choice starts one backend job and the first valid provider result wins.
- Added the versioned quality/latency gate, strict seven-section output validation, prompt isolation, endpoint schema/origin/size/rate controls, and boxed-title regression coverage.

## 2026-07-10 and earlier

- Made `master` the canonical production branch, restored the compact destination picker, and standardized the provider fallback chain.
- Added Latest Run analysis, stable long-chat capture, post-summary manual-copy recovery, destination confirmation enforcement, reload-safe content scripts, and platform-specific button placement.
