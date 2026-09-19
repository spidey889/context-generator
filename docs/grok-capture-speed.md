# Grok Capture Speed

Grok uses a dedicated fast capture profile. The optimization is intentionally limited to `grok.com`; other providers keep their existing conservative sweep timing.

## What changed

- Initial top-of-chat stability: two 50 ms stable samples, bounded by 700 ms.
- Per-scroll stability: two stable samples inside a 160 ms window.
- Scroll advance: 90% of the detected conversation viewport on every step.
- Render-change polling: every 12 ms.
- Final quiet check: 160 ms before concluding no additional rendered window exists.

Previously, Grok inherited three 140 ms preparation samples, 360 ms sweep windows, conservative 60% starting advances, 16 ms polling, and a 360 ms final quiet check.

## Safety retained

The change does not bypass the shared capture engine. Grok still:

- verifies user and assistant roles;
- captures and sequence-aligns every rendered window;
- keeps 10% viewport overlap between advances;
- deduplicates exact role-and-text copies;
- performs bounded terminal and no-movement checks;
- rejects captures above the existing 350,000-character limit;
- never sends text merely because the destination picker opened.

## Verification

`test/platform-content.test.js` includes a 40-turn virtualized Grok fixture. It verifies that all 40 turns survive the faster sweep, the first and last turns remain present, the fixture completes within seven scroll advances, and ChatGPT's pacing remains unchanged.

This is automated fixture evidence, not live Grok timing. Real speed still depends on Grok's DOM size, virtualization behavior, machine load, and network-delivered rendering.
