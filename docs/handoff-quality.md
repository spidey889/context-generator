# Handoff quality experiments

A good handoff lets the next assistant address the latest user request without asking for information the conversation already supplied. Fluent prose and correct headings are insufficient if the actual draft, corrected equation, failing CSV row or unselected options disappear.

The v15 candidate preserves the pending request in WHERE WE LEFT OFF and the current work product/exact evidence in KEY CONTEXT. It retains v14's removal of the fictional worked example, then shortens the competing instructions into a source/record/section contract. It explicitly forbids new arithmetic or performing the pending task after v14's fresh review case added unsupported budget analysis. Existing constraints, decision status, user identity boundaries and one-generation-per-attempt policy remain. V15 has no generated comparison yet: Dots returned 429 and the experiment stopped. General quality improvement across models is not established by a small synthetic experiment.

`evaluation/handoff-quality-cases.json` covers six development tasks plus a fresh review-only case introduced after v14 was fixed. Its critical facts include exact draft text and reproduction evidence, not just names/numbers. Manually review every generated handoff for unsupported implications and whether the next assistant can actually continue. Lexical checks can miss paraphrases or count quoted/rejected text as present; never use them alone as semantic proof. See the [full-output review](handoff-quality-review.md) for observed failures, replaced approaches and remaining limits.

Run a paired comparison from the summary-quality worktree with an explicitly selected development key in the process environment:

```powershell
node scripts/compare-summary-prompts.js --baseline-ref 7652aa84bc239e550d32de31bcd8fdc00219e0c0 --repeats 2 --output evaluation/results/handoff-comparison.json
```

Node's `--env-file` does not replace inherited variables. Clear a stale `OPENROUTER_API_KEY` in that command's process before loading a selected environment file. Never print keys or commit environment files. Keep the same model, fixture bytes and output limits for both variants. Review each repeat rather than selecting the best response. The default model is the existing free Ling route; `--model` also accepts the configured Qwen, Dots and Gemma routes without changing runtime routing. Short fixtures now exceed the production tiny boundary; exact local carry still handles chats up to 1,200 characters.

The initial October 6 experiments produced no model summaries: the inherited key returned 401, the development key reached Ling 429, and the configured Qwen route returned 404 under the existing free/private routing policy. Gemma also returned 429. Retained reports record these as unavailable, with null model assessments. Dots subsequently generated actual baseline/candidate pairs. A first diagnostic run incorrectly assessed exact local carry; its misleading artifact was discarded after fixing the runner. No paid routing or provider filter relaxation was used.

Use `--long-history` to include deterministic 90,000-character draft and 280,000-character corrected-design variants. Complete original turns stay in order, with the correction between two blocks of unrelated synthetic history. These exercise the large and extra-large profiles. Use `--case-id corrected-export-design-long-280000 --long-history` to isolate a costly case; reports record the selection and runner hash. This exercises recall under distraction, but does not reproduce every real conversation.

Before merging for quality, obtain generated baseline/candidate pairs, inspect full outputs against all five continuation criteria and repeat failure-prone cases. If the candidate loses constraints, invents work or drops the current work product, revise or remove it. Passing code tests establishes compatibility, not summary quality.

Availability checks found a valid development key and listed zero-price Ling, Dots and Gemma models; Qwen was absent from the catalog. Ling's diagnostic error indicated an upstream rate limit. Vercel production pulls returned sensitive-value placeholders, so they cannot supply a usable local comparison key. These are availability observations, not quality results.
