# Summary acceptance and local recovery

Output acceptance favors retaining useful context over enforcing an output shape. On 2026-09-18 strict formatting checks became advisory; on 2026-09-30 a separate content-only gate replaced unconditional acceptance of nonempty provider text.

Word targets are advisory allowances and diagnostic metadata; generated sections have no word or bullet quotas. The shared prompt in `api/summary-prompt.js` separates reported state, explicit constraints, accepted/rejected proposals and unresolved choices; it asks for operational prohibitions verbatim and forbids owner/user identity inference. It preserves pending requests and essential current work without performing the task. Fictional worked examples were removed after live comparisons exposed their facts leaking into unrelated handoffs. These instructions do not prove grounding: structural validation cannot detect invented facts or missing constraints. See [handoff adaptations](handoff-quality-adaptations.md) and the [historical accuracy pass](https://github.com/spidey889/context-generator/blob/25e856e/docs/summary-accuracy-pass.md).

## Provider acceptance

`createSummaryWithProvider()` uses `getSummaryContentRejectionReason()` before structural diagnostics. Only refusal-only and substantively empty output advance to another provider:

- Empty output includes whitespace/decorations or recognized headings, fixed destination instructions, exact profile-template placeholders, and empty markers (`None`, `N/A`, `[Not provided]`, `[No context]`, `[Insert context here]`, `[Insert summary here]`) with no actual content.
- Refusal-only output consists entirely of task-refusal/apology sentences and narrowly recognized retry/provide-transcript courtesies. Known refusal prefixes must concern summarizing, helping, assisting, complying, providing, or fulfilling. This conservative English heuristic cannot identify every refusal or prove semantic usefulness.
- The check scans every line, preserving inline bodies and content from repeated sections; section parsing must not erase useful text before acceptance.
- Quoted refusals, a user's inability to connect/build, and useful content alongside refusal wording are retained. There is no minimum accepted word count.

Bad structure or formatting NEVER causes rejection. Token-limit finish reasons (`length`, `MAX_TOKENS`, `MAX_OUTPUT_TOKENS`) NEVER cause rejection of useful content. Short, incomplete, missing-heading and duplicate-heading results remain usable.

`validateContextCarrySummary()` and quality flags remain diagnostics. Strictly valid output receives existing normalization (fences/footer removal, canonical headings/box, trusted NEXT STEP). Other useful output receives the trusted confirmation instruction, then removes repeated NEXT STEP sections only when their bodies match, ignoring outer whitespace and line-ending differences. Quoted/indented examples and fenced code are excluded from heading recognition for deduplication. The first matching section, different NEXT STEP bodies and all other provider text are preserved. Diagnostics retain flags from the original output; no sections or missing facts are invented. The diagnostic word floor is 20% of the profile target, clamped to 80–200 substantive words; it is not a rejection threshold.

## Fallback and source-local recovery

Provider HTTP/network/timeout/JSON failures retain the existing bounded retry and fallback behavior. When the applicable configured routes are exhausted or unavailable, the backend returns the complete verified transcript through `local-direct`. Larger chats have a shorter route list and do not use Mistral. See [provider fallbacks](provider-fallbacks.md) for the current order and deadlines.

If backend HTTP/network/parse errors, empty replies, or unavailable worker messaging prevent a summary from reaching the source, `extension/platform-content.js` builds a quoted full-transcript carry from the verified capture already held in page memory. Latest Run identifies `local-direct` with a fixed `summary_service_unavailable` reason; raw errors are not copied into the receipt. The normal paste flow continues, and destination failures offer the existing manual-copy modal. Cancellation, extension reload and `request_too_large` do not use this recovery. A network `TypeError` while reading a started summary response gets one fresh request within the original deadline before source recovery.

Recovery applies after successful supported capture. The extension uses exact local carries below 10,000 characters and requests summaries for 10,000–1,000,000 characters. Above 1,000,000 characters or 4,000,000 UTF-8 bytes, capture/transfer rejects without clipping. The serialized summary request also has a separate 4,400,000-byte limit; `request_too_large` remains an error. The 350,000-character boundary changes provider routing, not the maximum supported transcript. Capture errors and unverified content remain enforced; recovery cannot manufacture missing history.

## Verification

`test/summarize.test.js` covers refusal/empty Mistral-to-local fallback, exact retained transcript, short/code/mixed/contextual content, template-only output, and useful token-limited delivery without fallback. `test/platform-content.test.js` covers source-local recovery for backend rejection/empty replies/missing worker and the retained size boundary. Run the focused tests, deterministic suite and isolated Brave extension smoke after related changes. Production deployment and live-provider behavior require separate verification.
