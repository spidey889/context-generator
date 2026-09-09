# Claude Placement Logs and Debugging History

This is a historical debugging record, not production logic or code to restore verbatim. The current behavior belongs in [`LOGIC.md`](../../LOGIC.md); verify this note against current code before reusing any technique. The latest verified composer hierarchy is recorded separately in [`claude-last-known-dom.md`](claude-last-known-dom.md).

## Incident summary

Claude orb placement was tested across fresh `/new`, typing, Send/Mic swaps, `/new` to `/chat/...` navigation, existing-chat refresh, resize, hydration, and DOM remounts.

The worst failure occurred after refreshing an existing `/chat/...`: a visible mic existed, but anchor selection returned `null`. The old null-anchor fallback still reported `placed` and positioned the orb from the selected surface's bottom-right corner, producing the visibly low/right result.

After anchored placement was fixed, a second issue remained during deletion. Claude updated editor emptiness and its control DOM in separate React commits. Diagnostics captured both transient disagreements:

```text
editor state: empty      visible controls: Send
editor state: populated  visible controls: Mic + Voice + Voice mode
```

Translating each transient button allowed a newly mounted control to paint before its reservation was applied. Overriding Claude's `transform` or `transition` also interfered with its outgoing visual layer.

## Decisive geometry

Broken refreshed-chat sample:

```text
surface: x=316 y=668 w=584 h=48
voice anchor: x=820 y=676 w=20 h=32
mic: x=793 y=676 w=32 h=32
orb: x=854 y=676 w=42 h=42

native control center Y: 692
orb box center Y:        697
surface bottom:          716
orb bottom:              718
```

This showed that the shallow composer clamp could erase the intended docked-chat optical adjustment. The adjustment now runs after the local bound and the result remains viewport-clamped.

## Final architecture

- Claude placement requires an editor-containing composer surface geometrically matched to a visible native control.
- A missing anchor never produces a synthetic bottom-right placement. The last valid fixed position is retained only through a bounded hydration/remount gap; otherwise the orb hides.
- `/new` and docked `/chat/...` alignment are route-aware.
- Side-control space is reserved on Claude's persistent compact `display: grid` switch cluster, which owns both Send and Mic/Voice branches.
- The reservation uses the independent CSS `translate` property. Claude continues to own child layout, `transform`, transitions, and state animations.
- Individual-button translation exists only as a bounded hydration fallback when the stable switch cluster is unavailable.
- Reservation candidates remain inside the verified composer; unrelated page controls are excluded.

## Diagnostics that were removed

Temporary opt-in diagnostics previously used:

```text
?__cap_context_debug_placement=1
[Cap Context][Claude placement]
[Cap Context][Claude controls]
```

They logged only placement evidence: pathname, recalculation reason, editor/composer/control/orb rectangles, selected anchor/surface, connected/visible state, reservation ownership, and mutation summaries. Logs were session-scoped and deduplicated.

The production logger, query handling, debug IDs, snapshots, and logger-specific tests were removed in commit `15b0ee7`.

## If instrumentation is needed again

Add temporary diagnostics around these boundaries rather than inside unrelated platform code:

1. `ensureFloatingButton` and `updateFloatingButtonPosition` for the recalculation reason and outcome.
2. `getClaudeBubblePlacement` for surface, candidates, selected anchor, and final local/fixed geometry.
3. `syncClaudePlacementMutationMonitoring` for the control-swap mutation batch.
4. `reserveClaudeInlineControls` for reservation target ownership and offsets.

Keep logs content-free, opt-in, concise, and deduplicated. Remove them after the reproduction is understood, update this note with durable findings, and make browser smoke assert DOM geometry/reservation state directly instead of depending on console output.

## Relevant commits

```text
4179a45  Polish Claude orb transitions
4889499  Align Claude docked chat orb
e0d9b29  Fix Claude chat optical clamp
d82247b  Prevent Claude mic remount flicker
13ac66e  Snap Claude control reservations without animation
5990064  Trace Claude control swap reservations
1e49402  Isolate Claude control reservation from native animation
069162d  Reserve Claude controls at stable switch cluster
15b0ee7  Remove Claude placement diagnostics
```

## Regression coverage

Claude placement regressions live in `test/platform-content.test.js`. The installed-extension smoke in `scripts/run-extension-smoke.js` verifies bounds, docked-chat alignment, and the Voice-to-Send reservation directly without production logs.
