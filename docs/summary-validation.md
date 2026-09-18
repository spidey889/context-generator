# Temporary summary validation relaxation

On 2026-09-18, production Mistral returned text that CAP rejected because it recognized only one of seven required sections. The owner chose availability over strict output shape temporarily.

## Current behavior

In `api/summarize.js`, `summarizeWithProvider()` still rejects empty provider text and provider/network errors. It calls `validateContextCarrySummary()` as an advisory check. Passing output uses `normalizeContextCarrySummary()` as before. Failing output retains the complete provider text (only outer whitespace is trimmed) and appends `DESTINATION_CONFIRMATION_INSTRUCTION` under NEXT STEP.

The prompt, provider chain, time budgets, request security, and transcript limits are unchanged. The relaxation applies to every generated-summary provider. It also accepts short, refusal-like, or error-like text when the provider returns it as non-empty successful output; the retained validator does not block delivery. This does not guarantee summary completeness or factual accuracy.

## Where strictness existed

- `summarizeWithProvider()` rejected `!validation.ok` with a provider error, triggering fallback. Its normalization-failure guard rejected output that could not be canonicalized.
- `validateContextCarrySummary()` checks the Context Carry header, seven sections exactly once and in order, content outside sections, meaningful core sections, refusal/error patterns, and a minimum substantive word count. This function remains unchanged.
- `normalizeContextCarrySummary()` calls `normalizeContextCarrySections()`, which returns an empty string when sections are missing, duplicated, or out of order. Both remain unchanged; imperfect responses now bypass normalization to preserve their text.

## Restore strict enforcement

In `summarizeWithProvider()`, replace the temporary-policy comment and conditional `summary` assignment following `const validation = ...` with:

```js
if (!validation.ok) {
  const finishDetail = finishReason ? `; finish reason ${finishReason}` : "";
  throw createProviderError(
    provider,
    `${provider.label} returned an invalid summary: ${validation.reason}${finishDetail}`,
    502
  );
}

const summary = normalizeContextCarrySummary(rawSummary);
if (!summary) {
  throw createProviderError(provider, `${provider.label} returned an invalid summary: normalization failed`, 502);
}
```

Update `test/summarize.test.js` so incomplete Ministral output expects fallback instead of delivery. The existing strict validator tests remain active and cover the original rules. Keep the empty-response fallback coverage. Update `LOGIC.md`, record restoration in `CHANGELOG.md`, and run `npm test` and `git diff --check` before committing and pushing. Verify the Vercel production deployment separately; a source push alone does not prove the new policy is live.
