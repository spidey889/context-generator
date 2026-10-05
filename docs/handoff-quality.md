# Handoff quality experiments

A good handoff lets the next assistant address the latest user request without asking for information the conversation already supplied. Fluent prose and correct headings are insufficient if the actual draft, corrected equation, failing CSV row or unselected options disappear.

The v12 candidate preserves the pending request in WHERE WE LEFT OFF and the current work product/exact evidence in KEY CONTEXT. Existing constraints, decision status, user identity boundaries and one-generation-per-attempt policy remain. This is a hypothesis about better continuation, not a measured quality win.

`evaluation/handoff-quality-cases.json` covers six synthetic user tasks. Its critical facts include exact draft text and reproduction evidence, not just names/numbers. Manually review every generated handoff for unsupported implications and whether the next assistant can actually continue. Lexical checks can miss paraphrases or count quoted/rejected text as present; never use them alone as semantic proof.

Run a paired comparison from the summary-quality worktree with an explicitly selected development key in the process environment:

```powershell
node scripts/compare-summary-prompts.js --baseline-ref 7652aa84bc239e550d32de31bcd8fdc00219e0c0 --repeats 2 --output evaluation/results/handoff-comparison.json
```

Node's `--env-file` does not replace inherited variables. Clear a stale `OPENROUTER_API_KEY` in that command's process before loading a selected environment file. Never print keys or commit environment files. Keep the same model, fixture bytes and output limits for both variants. Review each repeat rather than selecting the best response. The default model is the existing free Ling route; an optional configured Qwen experiment leaves runtime routing unchanged. Short fixtures now exceed the production tiny boundary; exact local carry still handles chats up to 1,200 characters.

The October 6 experiments produced no model summaries: the inherited key returned 401, the development key reached Ling 429, and the configured Qwen route returned 404 under the existing free/private routing policy. Retained reports record these as unavailable, with null model assessments. A first diagnostic run incorrectly assessed exact local carry; its misleading artifact was discarded after fixing the runner. No paid routing or provider filter relaxation was used.

Before merging for quality, obtain generated baseline/candidate pairs, inspect full outputs against all five continuation criteria and repeat failure-prone cases. Add a long distributed-history variant so short examples do not substitute for long-chat recall. If the candidate loses constraints, invents work or drops the current work product, revise or remove it. Passing code tests establishes compatibility, not summary quality.
