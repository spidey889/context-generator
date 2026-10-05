# October 6 handoff review

The user benefit is continuation: preserve the pending request, its usable work product, constraints and decision status. A fluent recap is insufficient if it authorizes implementation instead of inspection, invents progress, or loses the text to edit. Fine-tuning is premature until these errors are measured on representative examples.

## Evidence and changes

All inputs here are synthetic. The comparison pins baseline `7652aa84bc239e550d32de31bcd8fdc00219e0c0`, uses identical inputs/output allowances for baseline and candidate, alternates request order, and retains every attempt. Model: the existing zero-price `dots-studio/dots-3-note-preview:free` route, with existing privacy restrictions. Other attempted routes failed; their reports remain ungraded.

- [v12 suite](../evaluation/results/2026-10-06-handoff-v12-dots-suite.json): eight pairs including 90k/280k histories. The candidate copied the prompt example's intact-backup claim into the Cedar case and duplicate-detection rejection into both long cases, despite those facts being absent from the transcripts. Keyword coverage missed the contamination. This invalidated the worked-example approach.
- [v13 repeated export](../evaluation/results/2026-10-06-handoff-v13-dots-long-export.json): removing the example eliminated those particular foreign claims in two candidate repeats while preserving the active design, request and constraints. The [v13 suite](../evaluation/results/2026-10-06-handoff-v13-dots-suite.json) nevertheless exposed an invented patch-after-inspection gate and an inspection request broadened to implementation. These findings motivated explicit action-scope/state distinctions in v14.
- [v14 suite](../evaluation/results/2026-10-06-handoff-v14-dots-suite.json): eight pairs. The candidate preserved current work products and pending tasks in the reviewed outputs, with no previous worked-example facts. Remaining issues below prevent treating this as a universal quality win.
- [Fresh v14 review-only case](../evaluation/results/2026-10-06-handoff-v14-dots-held-out.json): two pairs on a quote-review case added after the prompt was fixed, with no subsequent prompt tuning against its output. Both candidate repeats preserved the exact draft, corrected price, contact/order prohibitions and quote-expiry meaning. However, the first described the stopping point as completion of the review, and both computed new budget figures. The second also introduced potential extra expenses. Those are inappropriate additions for a factual handoff, despite zero lexical errors. Baseline outputs also preserved the useful information, so this is not a demonstrated candidate advantage.

## Remaining candidate limitations

| v14 case | Full-output observation |
| --- | --- |
| Corrected export design | Retains two uploads, chunk size, both retry options, proposal request and noncompletion; sometimes calls nonapproval a rejection and places nonchoices in decisions. |
| Current newsletter draft | Preserves the exact paragraph and second-paragraph scope; repeats event facts across sections. |
| Travel plan | Preserves dates, budget, wheelchair access requirement, pending comparison and unbooked state; header sometimes missing. |
| Algebra hints | Preserves corrected equation, current factorization and staged hint request without solving it; explicit user learning preference still appears outside WHO I AM. |
| CSV debugging | Preserves exact input, expected/actual rows, command and inspection request; adds an unstated backslash-escape example. |
| Hostile quotation | Keeps hostile claims labelled as quotation and projects separate; invents unresolved questions from unknown cause/mobile status. |
| Long newsletter | Preserves the full draft and pending request; retains unrelated archive details and incorrectly describes rejected v1 as containing invented quotes. |
| Long export | Preserves design, proposal and noncompletion; wastes space on archived references. |

Missing headers are existing advisory-format behavior, not repaired by this prompt change. Runtime acceptance remains unchanged. Lexical diagnostics also misclassify rejected/negated phrases as errors and miss equivalent paraphrases, typography and invented implications; they are not semantic scores.

Across the same eight cases, v14 used 87,986 prompt tokens versus baseline's 86,442 (about 1.8% more); output tokens were 4,245 versus 3,952 (about 7.4% more). Longer handoffs are not necessarily better. This comparison covers one working free model and artificial distraction, not all cheap models or real production conversations.

The concrete improvement is removing a demonstrated source of foreign facts and explicitly carrying pending work and usable evidence. The branch remains an experiment, not evidence for a broad quality claim. Next work should reduce competing prompt instructions and measure unsupported additions on fresh cases before merging or considering fine-tuning.
