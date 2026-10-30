# Project instructions

## Start here

- Always work from `C:\Users\vinit\Desktop\context-generator`. Do not use older OneDrive copies or `C:\Users\vinit\Desktop\coding projects\context-generator` unless the user explicitly asks.
- At the beginning of every new chat, always read `AGENTS.md`, `LOGIC.md`, `CHANGELOG.md` and `To-do.md` when they exist. Create missing `LOGIC.md` or `CHANGELOG.md` when needed.
- `To-do.md` is the local source of truth for pending tasks. When the owner asks "What's next?", including at the start of a new session, answer from this file. If it is empty, say no tasks are listed; if missing, create an empty list. Do not repopulate it from old trackers or remembered tasks unless asked. Reading the list does not authorize automatically executing its tasks. Keep this file local and Git-ignored; never commit or push its contents.
- Keep work lean: inspect the relevant files, use focused checks and avoid unrelated changes. Preserve other work already present in the checkout.
- Do not use subagents without the owner's explicit permission.
- Unless the owner explicitly specifies another base, always create new branches from up-to-date `master`, never from the current feature branch.
- Ask the owner before making a major design decision, such as adding/removing database tables or columns, changing the architecture, or replacing an existing approach. Explain the proposed change simply and wait for approval. Routine work within an already approved decision can proceed.

## Skills

- Use relevant available skills without asking for permission, including GStack skills, when they help investigate, implement or review the work. Choose skills for the task rather than running unrelated workflows.
- For bug fixes, normally use GStack's `investigate` skill to trace the root cause before editing. When the owner explicitly asks for a fast, short or minimal change, keep the workflow lean. Skill instructions never override the owner's limits on scope, checks, Computer Use, commits or pushes.

## Communication

- When the owner explicitly asks for a simple answer, keep it short, use everyday words and make it clear on the first read. Include only the details needed to answer the question. For a bug, plainly explain what went wrong and how it was fixed. Use technical terms only when helpful, with a brief plain-language explanation. Match this level: "We counted the welcome text as a message, so pasting stopped. We fixed it by ignoring the welcome screen." Apply this extra-simple style only when requested; otherwise use the detail the task needs.

## Documentation

- `LOGIC.md` is the source of truth for current production architecture and behavior. Update it after meaningful behavior changes and remove descriptions of dead, replaced or disabled behavior.
- Update `CHANGELOG.md` only when a change has lasting historical value: a meaningful new capability, an important bug fix, a security/privacy or compatibility change, or a significant decision future work needs to understand. A task, commit or file edit does not automatically need an entry.
- Skip routine UI/cosmetic changes, wording tweaks, version-only bumps, refactoring, test cleanup, documentation edits and command transcripts. A UI fix that resolves a significant functional or accessibility bug follows the important-bug rule below.
- For significant or hard-to-diagnose bug fixes, write at least five to six substantive lines, with more when useful. Explain the symptom and impact, root cause, key investigation findings, what fixed it, how it was verified, and any remaining uncertainty or limitation. Preserve a failed/replaced approach only when its reason could prevent repeating the mistake. Use short paragraphs or supporting bullets; visual line wrapping does not count, and do not pad entries with filler.
- Other worthwhile changes can use a short entry proportional to their importance. Combine related follow-up fixes into the existing entry instead of logging every iteration. Keep detailed command output and routine implementation history in Git or a linked investigation document.
- Add comments or notes when they explain non-obvious logic, fragile behavior, important tradeoffs or information useful in a later session. Do not comment everything.

## Tests and checks

- When fixing a confirmed bug or adding meaningful new behavior, add a regression test.
- After a change, run focused tests or checks for the affected behavior. Do not run the full suite automatically after every change.
- Run the full suite only when the change is large, affects several components, or focused checks are not enough to verify it. Run slow, database and browser checks when the affected behavior needs them.
- For documentation-only changes, a diff/format check is usually enough. Required CI and branch-protection checks still apply.

## Browser testing

- Use Computer Use proactively when seeing or interacting with the real app would help investigate, implement or verify a task. Use it early; do not wait for the owner to ask again. Follow any explicit instruction limiting browser or Computer Use.
- For UI issues, inspect the real page, reproduce the problem and confirm its cause before changing code. Verify the fix through the actual user flow and use what you observe to improve the regression fixtures. The Gemini welcome-screen bug is a reminder: a fixture can pass while missing the real page element that causes the failure.
- Use Brave unless another browser is specifically required. Open a new window for testing; do not take over the owner's main window. Automated fixtures should use their isolated profiles.
- Load the Brave unpacked extension from `C:\Users\vinit\Desktop\context-generator\extension`.
- If Brave is blocked, use Zen or Chrome. Zen has the owner's signed-in sessions.
- Use `LOGIC.md` for the relevant test commands and verification boundaries. Run the smallest appropriate checks; browser checks are useful when behavior depends on the real browser.

## Vercel cleanup

- For Vercel deletion requests, always use the Vercel CLI. Delete explicit deployment IDs or URLs in bulk, using parallel independent batches when possible to finish quickly.
- Check the team, project and exact keep/delete lists first. Preserve the requested production/preview counts and the current live deployment unless its deletion is explicitly requested. Verify the remaining counts and live alias after cleanup.

## ZIP files

- Ask the owner before creating any ZIP archive.

## Commit and push

- After a coding task, commit the intended files and always push to the branch being worked on. Do not ask for confirmation. Stage only the task's files.
- This repository pushes to `https://github.com/spidey889/context-generator.git`.
- `master` requires the GitHub Actions **Offline checks** result before accepting a commit. If working on `master`, validate the exact commit on a temporary `codex/` verification branch first, push that same commit to `master` after it passes, then remove the temporary branch. Do not bypass protection.
- A Git push, a ready backend deployment and a Chrome Web Store release are separate states. Verify the relevant deployed artifact before claiming a production release.
