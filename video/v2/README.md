# Cap Context V2 — Switch AIs without re-explaining everything.

Final deliverable: `../cap-context-launch-v2-polished.mp4`. **Current polished V2**, 29.5 seconds, 1920 × 1080, 60 fps, H.264/AAC stereo. The previous export remains at `../cap-context-launch-v2.mp4` for comparison; its source is recoverable from commit `0c28aae`. V1 is also retained.

This pass preserves V2's story, beat order, studio framing, real dark picker/handoff, warm brand finish and original soundtrack. It adds fuller host chat details, normal long-message context preview, streamed continuation, shorter cursor paths with target dwell and native arrow/hand changes, gentler camera moves, and four headlines instead of eight. Floating context packets, invented file cards, proof chips, sidebar slogans, route labels and editorial footers are removed. The ending uses only the three requested core messages, alongside the brand.

## Direction and story

Reviewed the owner's local `Claude_-_Introducing_Cowork_Claude_Code_for_the_rest_of_your_work._Cowork_le_lahVE0.mp4` (68.63 seconds, 4K/24 fps), with an overview and contiguous frame sequences. V2 takes its warm canvas, generous spacing, close UI framing, smooth cursor focus and restrained push/pull camera motion as inspiration. Its footage, soundtrack and copy are not included in the export. The owner's reference stays local and is not staged for Git.

| Time | Story and visual evidence |
| --- | --- |
| 0–2.8 | Existing ChatGPT conversation scrolls to the agreed plan: freelancers, October launch, free trial. |
| 2.8–5.7 | Send stops; a large amber `Message limit reached` notice and disabled control make the problem explicit. Camera pushes toward the blocked composer. |
| 5.7–7.4 | Cursor moves to the active Cap Context orb and clicks it. |
| 7.4–10.1 | Real destination picker opens; camera follows it. Cursor hovers and selects Claude using the actual production hover treatment. |
| 10.1–14.8 | Real capture, summary, paste and completion UI, with a subtle scrim and controlled settling motion. |
| 14.2–19.2 | A Claude chat opens in the same framing; Context Carry appears in its composer at 14.9 seconds. Camera pushes in so the preserved project details can be read. |
| 19.2–22.3 | User explicitly sends the context; Claude acknowledges with the exact product instruction. User types and sends the next question. |
| 22.3–25.2 | Claude continues the launch email. The same audience, month and trial offer reappear; chat scrolls to reveal the reply. |
| 25.2–29.5 | Warm brand finish: “Switch AIs without re-explaining everything.” / “Install once. Pick up where you left off.” / “Available on the Chrome Web Store.” |

## Fidelity and editorial boundaries

`assets/` contains 3× captures of production `extension/platform-content.js`: orb, picker, real Claude hover styling and all four handoff states. Source commit and fixture provenance are recorded in `assets/provenance.json`. Runtime/host/placement are adapted for the local capture fixture. This polish also omits the estimated countdown in that fixture: a fixed estimate would distract and imply timing that an edited transfer cannot substantiate. The rest of the production surfaces retain their native controls, styling and copy. No product source, provider configuration, live account or private conversation is modified.

AI surroundings are authored browser illustrations. The usage-limit card is an illustrative state, not a claim about today's exact ChatGPT limit wording, quota or plan. It makes the reason for moving visually explicit. Cap Context transfers the context to another AI; it does not remove a provider's usage limit.

The [Chrome Web Store listing](https://chromewebstore.google.com/detail/cap-context/lpkaciijlhckkdhbgidbjfkldigghnjf) supports the availability message and the five-platform context-transfer purpose. UI captures represent the current repository source recorded in provenance, independently of the listing's published extension version.

The sample project is invented. Pasted context includes all seven production Context Carry headings and the exact destination confirmation instruction. The sent summary uses an authored, normal long-message preview with a disclosure; its complete text remains in the composition. Camera framing and the preview keep template instructions below the fold. Transfer and assistant response timing are editorially compressed; no measured latency claim is made. That boundary is documented here, without onscreen production notes. Both destination sends are shown as cursor clicks by the user. V2 uses actual product controls and a sample conversation, not a live-account performance recording. Public host inspection was attempted in an isolated Brave profile; an empty ChatGPT response and Claude's verification page did not establish current live-account UI fidelity. Host surroundings remain explicit illustrations.

## Rebuild and verify

Uses the same local Node.js 22+, Python 3, Playwright, Brave and FFmpeg/FFprobe requirements as V1. Install `video/package.json` dependencies if the Codex runtime is unavailable. All browser work uses a new automation profile.

From the repo root:

```powershell
node video/capture-ui.cjs --v2 --clean
python video/v2/score.py
node video/v2/render.cjs --preview
node video/v2/render.cjs
node video/v2/verify.cjs
Copy-Item video/v2/output/cap-context-launch-v2.mp4 video/cap-context-launch-v2-polished.mp4
```

`film.html` is the editable, deterministic composition. Every camera move, cursor path, text reveal, progress crossfade, composer resize, streamed reply and chat scroll is computed by `setTime(seconds)`; no animation depends on screenshot wall-clock time. Quintic timing gives focus moves zero endpoint velocity and acceleration; short Bezier cursor paths preserve exact target locations. Normal-message history scrolling follows the visible content height. The renderer exports all 1,770 frames at 60 fps, uses JPEG quality 98 only for frame transport, and encodes the delivery MP4 at H.264 CRF 17 with fast start. It fails on missing artwork and browser script errors.

JPEG transport carries full-range BT.601 samples. The exporter explicitly converts to limited-range BT.709 and sets the matching H.264 color metadata. Setting tags alone can produce washed-out colors in browser playback even when FFmpeg decoding succeeds. Verification checks decoded browser pixels against the warm source canvas and end card, in addition to range/format metadata.

`score.py` creates a new original stereo score with soft keys, restrained pulse and click/transition cues. No reference audio or samples are reused.

Verification covers exact duration/frame count/streams, strict full decoding, audio clipping, actual Brave playback and seeking, plus exported story and motion sample frames. The results are saved in `verification.json`. Output WAVs, working exports, storyboard/reference-analysis frames and intermediate clips are ignored under `output/`.
