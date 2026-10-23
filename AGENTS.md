# Project instructions

## Start here

- Always work from `C:\Users\vinit\Desktop\context-generator`. Do not use older OneDrive copies or `C:\Users\vinit\Desktop\coding projects\context-generator` unless the user explicitly asks.
- At the beginning of every new chat, read `AGENTS.md`, `LOGIC.md` and `CHANGELOG.md` when they exist. Create missing `LOGIC.md` or `CHANGELOG.md` when needed.
- Keep work lean: inspect the relevant files, use focused checks and avoid unrelated changes. Preserve other work already present in the checkout.
- Ask the owner before making a major design decision, such as adding/removing database tables or columns, changing the architecture, or replacing an existing approach. Explain the proposed change simply and wait for approval. Routine work within an already approved decision can proceed.

## Documentation

- `LOGIC.md` is the source of truth for current production architecture and behavior. Update it after meaningful behavior changes and remove descriptions of dead, replaced or disabled behavior.
- Record meaningful decisions, changes, replaced approaches and useful historical context in `CHANGELOG.md`. Skip insignificant changes and routine command transcripts.
- Add comments or notes when they explain non-obvious logic, fragile behavior, important tradeoffs or information useful in a later session. Do not comment everything.

## Browser testing

- Use Brave unless another browser is specifically required. Open a new window for testing; do not take over the owner's main window. Automated fixtures should use their isolated profiles.
- Load the Brave unpacked extension from `C:\Users\vinit\Desktop\context-generator\extension`.
- If Brave is blocked, use Zen or Chrome. Zen has the owner's signed-in sessions.
- Use `LOGIC.md` for the relevant test commands and verification boundaries. Run the smallest appropriate checks; browser checks are useful when behavior depends on the real browser.

## Commit and push

- After a coding task, commit the intended files and always push to the branch being worked on. Do not ask for confirmation. Stage only the task's files.
- This repository pushes to `https://github.com/spidey889/context-generator.git`.
- `master` requires the GitHub Actions **Offline checks** result before accepting a commit. If working on `master`, validate the exact commit on a temporary `codex/` verification branch first, push that same commit to `master` after it passes, then remove the temporary branch. Do not bypass protection.
- A Git push, a ready backend deployment and a Chrome Web Store release are separate states. Verify the relevant deployed artifact before claiming a production release.
