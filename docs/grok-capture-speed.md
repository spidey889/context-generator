# Grok Capture Speed

Grok uses a dedicated fast capture profile. The optimization is intentionally limited to `grok.com`; other providers keep their existing conservative sweep timing.

## What changed

- Initial top-of-chat stability: two 40 ms stable samples, bounded by 700 ms.
- Per-scroll stability: two stable samples inside a 100 ms fast window.
- Scroll advance: 70% of the viewport until ordered overlap is proven, then 90%.
- Render-change polling: every 10 ms.
- Final quiet check: 160 ms before concluding no additional rendered window exists.
- Delayed-render guard: after real scroll movement with no immediate window change, wait up to 220 ms and confirm the late window is stable before advancing again.

Previously, Grok inherited three 140 ms preparation samples, 360 ms sweep windows, conservative 60% starting advances, 16 ms polling, and a 360 ms final quiet check. The first fast profile used fixed 90% advances and a 160 ms settle window; the adaptive profile replaces that with a quicker normal path plus a targeted slow-render guard.

## Safety retained

The change does not bypass the shared capture engine. Grok still:

- verifies user and assistant roles;
- captures and sequence-aligns every rendered window;
- requires a safer 30% overlap until ordered window overlap is observed, then keeps 10% overlap;
- deduplicates exact role-and-text copies;
- performs bounded terminal and no-movement checks;
- rejects captures above the existing 350,000-character limit;
- never sends text merely because the destination picker opened.

## Verification

`test/platform-content.test.js` includes a 40-turn virtualized Grok fixture and a 24-turn fixture whose windows render 140 ms late. They verify that all turns survive both the normal and delayed paths, the first and last turns remain present, the normal fixture completes within eight scroll advances, and ChatGPT's pacing remains unchanged.

This is automated fixture evidence, not live Grok timing. Real speed still depends on Grok's DOM size, virtualization behavior, machine load, and network-delivered rendering.
