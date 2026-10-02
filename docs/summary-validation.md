# Summary acceptance and local recovery

Output acceptance favors retaining useful context over enforcing an output shape. On 2026-09-18 strict formatting checks became advisory; on 2026-09-30 a separate content-only gate replaced unconditional acceptance of nonempty provider text.

## Provider acceptance

`createSummaryWithProvider()` uses `getSummaryContentRejectionReason()` before structural diagnostics. Only refusal-only and substantively empty output advance to another provider:

- Empty output includes whitespace/decorations or recognized headings, fixed destination instructions, exact profile-template placeholders, and empty markers (`None`, `N/A`, `[Not provided]`, `[No context]`, `[Insert context here]`, `[Insert summary here]`) with no actual content.
- Refusal-only output consists entirely of task-refusal/apology sentences and narrowly recognized retry/provide-transcript courtesies. Known refusal prefixes must concern summarizing, helping, assisting, complying, providing, or fulfilling. This conservative English heuristic cannot identify every refusal or prove semantic usefulness.
- The check scans every line, preserving inline bodies and content from repeated sections; section parsing must not erase useful text before acceptance.
- Quoted refusals, a user's inability to connect/build, and useful content alongside refusal wording are retained. There is no minimum accepted word count.

Bad structure or formatting NEVER causes rejection. Token-limit finish reasons (`length`, `MAX_TOKENS`, `MAX_OUTPUT_TOKENS`) NEVER cause rejection of useful content. Short, incomplete, missing-heading and duplicate-heading results remain usable.

`validateContextCarrySummary()` and quality flags remain diagnostics. Strictly valid output receives existing normalization (fences/footer removal, canonical headings/box, trusted NEXT STEP). Other useful output retains its full provider text with the trusted confirmation instruction appended. No sections or missing facts are invented.

## Fallback and source-local recovery

Provider HTTP/network/timeout/JSON failures retain the existing bounded retry and fallback behavior. Mistral failure returns the complete captured transcript through backend `local-direct`. Other configured routes precede Mistral.

If backend HTTP/network/parse errors, empty replies, or unavailable worker messaging prevent a summary from reaching the source, `extension/platform-content.js` builds a quoted full-transcript carry from the verified capture already held in page memory. Latest Run identifies `local-direct` with a fixed `summary_service_unavailable` reason; raw errors are not copied into the receipt. The normal paste flow continues, and destination failures offer the existing manual-copy modal.

Recovery applies after successful supported capture. Capture errors, unverified content and the 350,000-character boundary remain enforced; the extension cannot manufacture a complete transcript when capture itself fails.

## Verification

`test/summarize.test.js` covers refusal/empty Mistral-to-local fallback, exact retained transcript, short/code/mixed/contextual content, template-only output, and useful token-limited delivery without fallback. `test/platform-content.test.js` covers source-local recovery for backend rejection/empty replies/missing worker and the retained size boundary. Run the focused tests, deterministic suite and isolated Brave extension smoke after related changes. Production deployment and live-provider behavior require separate verification.
