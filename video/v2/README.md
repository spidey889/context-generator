# Cap Context V2 — Keep your context. Keep going.

Final deliverable: `../cap-context-launch-v2.mp4`. 29.5 seconds, 1920 × 1080, 60 fps, H.264/AAC stereo. V1 is retained alongside it.

## Direction and story

Reviewed the owner's local `Claude_-_Introducing_Cowork_Claude_Code_for_the_rest_of_your_work._Cowork_le_lahVE0.mp4` (68.63 seconds, 4K/24 fps), with an overview and contiguous frame sequences. V2 takes its warm canvas, generous spacing, close UI framing, smooth cursor focus and restrained push/pull camera motion as inspiration. Its footage, soundtrack and copy are not included in the export. The owner's reference stays local and is not staged for Git.

| Time | Story and visual evidence |
| --- | --- |
| 0–2.8 | Existing ChatGPT conversation scrolls to the agreed plan: freelancers, October launch, free trial. |
| 2.8–5.7 | Send stops; a large amber `Message limit reached` notice and disabled control make the problem explicit. Camera pushes toward the blocked composer. |
| 5.7–7.4 | Cursor moves to the active Cap Context orb and clicks it. |
| 7.4–10.1 | Real destination picker opens; camera follows it. Cursor hovers and selects Claude using the actual production hover treatment. |
| 10.1–14.2 | Real capture, summary, paste and completion UI. Condensed timing is labelled. |
| 14.2–19.2 | A Claude chat opens in the same framing; Context Carry appears in its composer. Camera pushes in so the preserved project details can be read. |
| 19.2–22.3 | User explicitly sends the context; Claude acknowledges with the exact product instruction. User types and sends the next question. |
| 22.3–25.2 | Claude continues the launch email. The same audience, month and trial offer reappear; chat scrolls to reveal the reply. |
| 25.2–29.5 | Warm brand finish with Cap Context, a plain product explanation, five supported platforms and install copy. |

## Fidelity and editorial boundaries

`assets/` contains new 3× captures of production `extension/platform-content.js`: orb, picker, real Claude hover styling and all four handoff states. Source commit and fixture provenance are recorded in `assets/provenance.json`. Only runtime/host/placement are adapted for the local capture fixture. No product source, provider configuration, live account or private conversation is modified.

AI surroundings are authored browser illustrations. The usage-limit card is an illustrative state, not a claim about today's exact ChatGPT limit wording, quota or plan. It makes the reason for moving visually explicit. Cap Context transfers the context to another AI; it does not remove a provider's usage limit.

The sample project is invented. Pasted context includes all seven production Context Carry headings and the exact destination confirmation instruction. Transfer and assistant response timing are editorially compressed; no measured latency claim is made. Both destination sends are shown as cursor clicks by the user. V2 uses actual product controls and a sample conversation, not a live-account performance recording.

## Rebuild and verify

Uses the same local Node.js 22+, Python 3, Playwright, Brave and FFmpeg/FFprobe requirements as V1. Install `video/package.json` dependencies if the Codex runtime is unavailable. All browser work uses a new automation profile.

From the repo root:

```powershell
node video/capture-ui.cjs --v2
python video/v2/score.py
node video/v2/render.cjs --preview
node video/v2/render.cjs
node video/v2/verify.cjs
Copy-Item video/v2/output/cap-context-launch-v2.mp4 video/cap-context-launch-v2.mp4
```

`film.html` is the editable, deterministic composition. Every camera move, cursor arc, text reveal, progress crossfade, composer resize and chat scroll is computed by `setTime(seconds)`; no animation depends on screenshot wall-clock time. The renderer exports all 1,770 frames at 60 fps, uses JPEG quality 98 only for frame transport, and encodes the delivery MP4 at H.264 CRF 17 with fast start. It fails on missing artwork and browser script errors.

`score.py` creates a new original stereo score with soft keys, restrained pulse and click/transition cues. No reference audio or samples are reused.

Verification covers exact duration/frame count/streams, strict full decoding, audio clipping, actual Brave playback and seeking, plus exported story and motion sample frames. The results are saved in `verification.json`. Output WAVs, working exports, storyboard/reference-analysis frames and intermediate clips are ignored under `output/`.
