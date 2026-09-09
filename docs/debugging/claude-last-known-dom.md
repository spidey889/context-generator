# Claude Last-Known Composer DOM

Last verified live on Claude in Brave: **2026-09-09**.

This is a dated DOM field note, not a selector contract. Claude can change its markup at any time. Production placement must continue to use semantic labels, containment, visibility, and geometry rather than copying the class names below. See [`claude-placement-logs.md`](claude-placement-logs.md) for the incident and diagnostic history.

## Observed structure

The relevant hierarchy was approximately:

```text
body
└─ Claude composer surface
   └─ div.relative.w-full.min-w-0
      ├─ [contenteditable="true"][role="textbox"]
      │  └─ aria-label="Write your prompt to Claude"
      └─ div.grid.shrink-0.items-center.justify-items-end
         ├─ Send branch
         │  └─ button "Send message"
         └─ Voice branch
            ├─ button "Dictate"
            ├─ button "Voice input"
            └─ button "Use voice mode"
```

Claude kept both state branches mounted in the observed composer. Visibility changed between them when editor content changed. The individual Send, Dictate, Voice input, and Voice mode nodes were transient state controls; the compact shared grid remained the useful reservation owner during the swap.

The model selector was also inside the verified composer, but outside the switch grid. At narrower/crowded layouts it received its separate existing model-label nudge.

## What was stable and what was not

| DOM part | Observed stability | Placement use |
| --- | --- | --- |
| Page/body root | Stable across composer remounts | Owns the fixed orb so composer replacement does not move its coordinate system |
| Active editor | Stable while one composer is mounted; disappears during `/new` send navigation | Required to identify a real composer |
| Verified composer surface | Stable during typing; can resize or remount during hydration/navigation/refresh | Geometry boundary and observer root |
| Compact `display: grid` switch cluster | Stable across Send/Mic/Voice swaps inside one mounted composer | Owns the shared side-control reservation |
| Send/Mic/Voice buttons | Visibility changes and nodes may remount | Measurement candidates only; not the preferred reservation owner |
| Model selector | Present in the composer but layout-dependent | Separate bounded left nudge when its row would collide or clip |
| Claude class names | Not a supported contract | Evidence only; do not hard-code as the primary selector |

## Latest live geometry

Refreshed existing `/chat/...` at the final verified desktop viewport:

```text
editor:         x=556.0  y=646.6  w=712.0  h=22.0
switch cluster: x=1133.0 y=641.6  w=83.0   h=32.0  translate=-52px
Dictate:        x=1133.0 y=641.6  w=32.0   h=32.0  visible
Voice input:    x=1160.0 y=641.6  w=20.0   h=32.0  visible
Voice mode:     x=1184.0 y=641.6  w=32.0   h=32.0  visible
Send:           x=1184.0 y=641.6  w=32.0   h=32.0  hidden
orb:            x=1230.0 y=637.0  w=42.0   h=42.0
```

Fresh `/new` at the same final verification:

```text
editor:         x=589.2  y=336.9  w=616.0  h=33.0
model selector: x=957.7  y=382.9  w=108.5  h=32.0  translate=-48px
switch cluster: x=1070.2 y=382.9  w=83.0   h=32.0  translate=-52px
orb:            x=1159.0 y=377.0  w=42.0   h=42.0
```

The exact numbers are viewport-specific. The durable evidence is that the orb remained centered beside the native row, the switch cluster owned the shared translation, and the individual state buttons had no Cap Context inline translation.

## Negative-route check

On `/projects`, where no composer editor existed:

```text
editor:              absent
Cap Context orb:     absent/not visible
translate markers:   0
transform markers:   0
```

This confirmed that reservations were released and the orb did not attach to unrelated Claude buttons outside a composer.

## Discovery and validation boundaries

Production code intentionally avoids depending on the observed class strings:

1. Find the active Claude editor semantically.
2. Consider only composer candidates that contain that editor and stay horizontally close to its geometry.
3. Require a visible, composer-local Send/Mic/Voice-style control whose rectangle fits the candidate surface.
4. Select the voice-mode control semantically when possible, with a small rightmost-control fallback inside the verified surface.
5. Find the shared reservation owner by walking upward from the selected side controls. It must contain every selected side control, use `display: grid`, remain compact, and stop before any ancestor containing the editor.
6. If no trustworthy anchor exists, retain the last valid fixed position only during the bounded hydration grace period; otherwise hide the orb.

## Events that revalidate placement

- Document child-list mutations.
- Claude composer child-list and `class`, `style`, `aria-hidden`, `hidden`, or `data-state` mutations.
- Editor or composer `ResizeObserver` notifications.
- Window resize, visibility change, and composer focus.
- Navigation API events, `popstate`, and the pathname polling fallback for SPA route changes.

The composer mutation observer reapplies the existing reservation in its mutation microtask before the full animation-frame placement update. This is what prevents a newly mounted state control from painting once beneath the orb.

## Verification performed

- Existing `/chat/...` empty state.
- Empty → Send → delete → Mic/Voice swap.
- Existing-chat refresh.
- Fresh `/new` empty, typing, and deletion.
- Composer route to `/projects` with no editor.
- Reservation-marker ownership audit for unrelated sidebar and message-action buttons.
- Claude-focused unit/regression tests and the isolated Brave extension smoke.

When Claude's DOM changes, capture a fresh hierarchy and geometry sample, compare it with this dated note, update the production logic and regressions if needed, and replace this document's observed DOM rather than accumulating conflicting snapshots.
