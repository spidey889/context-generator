# Cap Context — Keep going

The current version is [polished V2](v2/README.md), delivered as `cap-context-launch-v2-polished.mp4`: 29.5 seconds, 1080p/60 fps. It retains V2's limit/transfer/continuation sequence with fuller chat UI, refined cursor/camera motion and a simpler ending. The previous `cap-context-launch-v2.mp4` remains for comparison. This document describes the retained V1.

27-second launch film, 1920 × 1080, 30 fps, H.264/AAC MP4. The final deliverable is `cap-context-launch.mp4`. Editable animation, UI captures and original synthesized stereo music are included here. No stock footage, remote fonts, recordings or third-party music are used.

## Story

| Time | Beat |
| --- | --- |
| 0–3 s | Hours of thinking. Keep the momentum. |
| 3–6.6 s | Scroll through an existing ChatGPT project conversation. |
| 6.6–10.5 s | Click the Cap Context orb, then choose Claude in the real picker. |
| 10.5–14.3 s | Real capture, summary and paste progress states. |
| 14.3–17.5 s | Show the decisions, constraints and next step that travel. |
| 17.5–22.3 s | Context pasted into Claude; user clicks Send, then continues the project. |
| 22.3–27 s | Brand lockup, five supported AI logos and install call to action. |

## Product fidelity

Inspected `LOGIC.md`, `CHANGELOG.md`, `extension/platform-content.js`, `extension/manifest.json`, `api/summarize.js`, and the existing isolated Brave smoke runner before authoring. Production source reference is recorded in `assets/provenance.json`.

- `assets/picker.png`, `orb.png`, and the four handoff states are raster captures of the actual production UI functions, styles, bundled EB Garamond font and artwork. They are rendered at 3× in an isolated Brave automation instance.
- `capture-ui.cjs` adapts the host and runtime boundary in memory for a local, data-free fixture. It does not alter extension source, perform a real transfer, contact a provider or access the owner's chats.
- ChatGPT/Claude surroundings and conversations are authored motion-design illustrations, not live-account recordings. They use an invented notes-app launch project so no private conversations appear.
- The Context Carry graphic is an editorial excerpt, not an additional product screen. The pasted fixture includes all seven real section headings and the exact destination confirmation instruction.
- The film shows explicit cursor clicks for both destination submissions. Cap Context itself pastes and focuses the input; it never sends the message automatically.
- Progress is deliberately edited down, labelled `Transfer sequence condensed`. The film makes no measured latency claim. The progress card's countdown is the actual product estimate.
- The five logo assets correspond to ChatGPT, Claude, Gemini, Grok and DeepSeek. Existing landing-page video embeds are not replaced by this work.

## Rebuild

Requires Node.js 22+, Python 3, FFmpeg on PATH, and Brave. Install this folder's development dependency with `npm install` if Playwright is not already available. No Chromium download is necessary; the scripts launch Brave directly in a separate automation profile.

From the repository root:

```powershell
node video/capture-ui.cjs
python video/score.py
node video/render.cjs --preview
node video/render.cjs
node video/verify.cjs
Copy-Item video/output/cap-context-launch.mp4 video/cap-context-launch.mp4
```

Override `BRAVE_PATH`, `CAP_VIDEO_NODE_MODULES`, `FFMPEG_PATH` or `FFPROBE_PATH` if needed. The scripts first look for locally installed Playwright, then the bundled Codex dependency runtime. `output/` holds temporary storyboard frames, WAV audio and the working export and is ignored by Git. The finished MP4 and UI source captures are tracked.

`film.html` is the editable composition. Its `setTime(seconds)` function drives every animated state deterministically. `render.cjs` captures 810 frames and pipes them to FFmpeg, checks every image loaded, and fails on browser script errors. Re-run the capture only when intentionally refreshing product UI; the checked-in PNGs make the current film repeatable after product code changes.

## Verification

Storyboard frames were visually reviewed in isolated Brave for composition, text, real picker art, progress stages, context paste, user-controlled Send and the closing brand frame. Export verification includes FFprobe stream/duration metadata, a full FFmpeg decode, actual Brave playback/seeking, final-file sample frames and audio level checks. `verification.json` records export evidence. This verifies the film, not live provider latency or a live-account product transfer.
