# Deferred improvement ideas

Recorded on October 6, 2026 after the capture/backend improvement pass. Work is paused at the owner's request. These are investigation candidates, not promises or confirmed production incidents.

## Successful provider response size

`fetchWithRetry` in [api/summarize.js](../api/summarize.js) reads successful responses with `arrayBuffer()` before strict UTF-8 decoding and JSON parsing. Deadlines bound elapsed time, but this path has no response-byte ceiling. A provider's extra metadata can exceed the requested output-token allowance.

Before changing it, measure realistic response sizes and reproduce an excessive successful body with a local fixture. Choose a limit from that evidence; if a stream reader is justified, retain strict Unicode/BOM handling, caller cancellation, deadline checks and prompt cleanup. Do not pick an arbitrary small cap that rejects useful output.

## Summary quality and model comparison

The current validator detects some empty, refusal-like and structural failures; it cannot prove that every factual claim or important constraint survives. Use the existing [evaluation cases](../evaluation/) and [accuracy findings](summary-accuracy-pass.md) to compare the configured model with a stronger candidate on the same inputs. Check names, prohibitions, rejected proposals, undecided alternatives and current state, alongside latency and cost.

Verify current model availability before selecting a candidate. Keep a strict request budget, use a freshly authorized temporary credential and keep credentials out of source, reports and logs. Offline tests establish behavior, not comparative live-model quality.

Useful short or token-limited output is intentionally delivered with advisory flags. Changing that policy needs evidence of a better quality/latency tradeoff; it is not a cleanup task.

## Handoff state

The final code fix is `793cc27` on `codex/capture-first-principles`: rejected accounting responses abort their owned request and leave the caller's signal intact. Validation passed 518 regular tests on Node 22 and [full CI](https://github.com/spidey889/context-generator/actions/runs/37468023061), including database replay and Brave fixtures. See [LOGIC.md](../LOGIC.md) for current contracts and [CHANGELOG.md](../CHANGELOG.md) for completed changes. Master integration and release remain separate from this branch push.
