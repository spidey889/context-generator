# ChatGPT network JSON audit — 2026-09-28

Pre-merge update: the refusal results below describe the audit-time behavior. JSON validation still rejects those responses, but the picker now announces fast-capture failure and falls back to DOM capture once in the same transfer. Use the failure smoke modes to verify DOM fallback, one summary/paste, and no Send click.

Scope: ChatGPT MAIN observation/readiness/auth/tree/file reads, bridge validation/extraction, installation and the ChatGPT JSON picker/metrics boundaries. Other sources, DOM capture, summarization, destination and toggle behavior were traced only where needed and retain their behavior.

## Confirmed fixes

1. **Wrong chat during handoff:** the picker selected chat identity after its asynchronous animation. It now passes the destination-click path to the bridge, which pins the chat ID before readiness. The real picker function is tested with zero rendered turns and a navigation during handoff.
2. **Navigation gaps:** away-and-back changes during readiness or after MAIN finished its read escaped the final chat-ID comparison. A bridge navigation latch spans setup through response delivery and is always removed. Project path aliases for the same chat remain valid.
3. **Stale observation after fetch replacement:** an obsolete hook answered readiness even when a newer page fetch wrapper bypassed it. v5 answers only while it owns the current fetch function; bounded installation repairs observation while preserving cached auth and the page's fetch layer.
4. **Lost or duplicated pasted cards:** substring matching dropped distinct identical/overlapping pastes and mistook prompt words for copies; changed outer whitespace could also duplicate an inline card. File IDs and one-to-one complete inline ranges determine duplication, retaining each distinct card and original bytes in its own turn. LF/CRLF boundaries and multiple replacements are covered.
5. **Altered source code/document whitespace:** serializer trimming removed initial indentation. Downstream DOM cleanup also rewrote NBSP inside string literals and removed line whitespace from code, pastes and canvas documents. Own strings now retain their original whitespace and the ChatGPT JSON metrics boundary bypasses that cleanup. The existing summary pipeline's outer-transcript trim remains unchanged.
6. **Lost voice turns:** immediate own multimodal `audio_transcription.text` objects were discarded with generic objects, dropping user/assistant voice text. Narrow typed extraction preserves them in order and rejects malformed/incomplete transcript parts. Audio pointers, media, pointer metadata and nested tool transcripts remain excluded.
7. **Stale paste authentication:** pasted-file descriptors used the tree's old header snapshot and never recovered a 401, even after the page observed newer same-workspace auth. All authenticated reads now use current observed headers and share one bounded 401 retry. Newer observed auth takes precedence; otherwise session refresh is used. Cancellation is rechecked before retrying. Signed content never receives bearer headers.
8. **Stopped response refused:** a terminal `finished_partial` response with a stale `end_turn: false` flag was treated as streaming. Terminal stop status now takes precedence, while explicit completeness failures and actual streaming still fail.

## Evidence and verification

- The initial ten targeted new regressions all failed against the original source. Later stop-state and transfer-whitespace regressions also failed before their fixes. Each passed after its corresponding change.
- `node --test test/chatgpt-json-capture.test.js test/background.test.js`: 71/71, including 54 ChatGPT tests.
- `npm test`: 328/328. `npm run test:slow`: 1/1, the existing 78-turn release capture.
- Isolated Brave ChatGPT JSON smoke combines extension reload without source refresh, late-hook/session recovery and a paste-descriptor 401. The exact 127-turn backend transcript includes the original attachment-only user paste, own recap/thoughts, canvas body/edit, voice user/assistant text, and code containing NBSP/line whitespace. One summary request, exact stub-summary paste, no Send click.
- Installed-Brave partial, streaming and ranged-response cases each fail visibly with zero summary requests. Ordinary DOM extension smoke also passes.
- Syntax checks and task-owned diff checks pass. Unrelated `todo.md` and `extension/crisp orb.png` remain excluded from staging.

Voice schema evidence came from primary exported-conversation types and a parser project's own export analysis, rather than guessed object traversal: [conversation types](https://github.com/sanand0/openai-conversations/blob/main/conversation.ts) and [export analysis](https://github.com/jd-d/chatgpt-export-viewer/blob/main/plans/MULTIMODAL.md). These identify `audio_transcription` parts with text and input/output direction. No fresh signed-in native ChatGPT conversation was inspected in this audit; browser evidence uses controlled fixtures and a stub backend.

To rerun combined recovery in PowerShell, set `CAP_CONTEXT_JSON_SMOKE=chatgpt`, `CAP_CONTEXT_CHATGPT_RELOAD_SMOKE=1` and `CAP_CONTEXT_CHATGPT_AUTH_SMOKE=paste401` through `$env:` variables, then run `npm run test:extension-smoke`. For refusal checks, clear the recovery variables and set `CAP_CONTEXT_CHATGPT_FAILURE_SMOKE` to `partial`, `streaming` or `ranged` individually. Clear all smoke-mode variables before the ordinary extension smoke.

## Final audit coverage

Re-read the complete hook and bridge after the fixes, then review their final diff and every integration consumer: manifest/document-start injection, startup/on-demand background installation and sender/frame validation, picker routing, capture metrics, backend request boundary and receipt method. Verify own-role/hidden/recipient filtering, parent ordering and inactive branches, duplicate/mismatched IDs, cycles and real roots, page/count/completeness markers, streaming/stopped turns, text/thought/code/writing-block/canvas extraction, paste ownership/UTF-8/BOM/size validation, signed URL restrictions, deadlines, concurrency, hook replacement and listener cleanup. Authentication values and parser/body snippets remain out of bridge/error/backend output. No further meaningful non-rare bug was found after this pass.

Use the same evidence-first sequence for future source audits: trace the full path; reproduce a specific hypothesis before editing; add exact-output/failure-side-effect regressions; continue after every fix; verify installed success/refusal paths and the full suite; record only meaningful findings. Use a narrow primary-source lookup or native inspection when schema facts are missing, keeping live transcripts local.

Limits: internally consistent server omissions without flags/count discrepancies cannot be independently proven absent. Canvas editor state outside conversation messages is not reconstructed. Binary media and ordinary uploads remain outside own-text capture. Browser fixtures prove integration and the modeled schema, not a new production/provider or native-account compatibility check.
