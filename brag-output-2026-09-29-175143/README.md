# Cap Context — second Kyoto cut

This 52-second launch film follows one task across Claude's usage limit: Cap Context carries an existing Kyoto conversation into ChatGPT, and the user continues with the same short follow-up. The first 62-second Kyoto film remains intact at `../brag-output-2026-09-29-153657/brag.mp4`.

- `brag.mp4`: final 1920 × 1080, 60 fps H.264/AAC video.
- `brag.jpg`: settled message frame, also baked into video frame zero without extending the runtime.
- `share-copy.txt`: short caption ready to post.
- `brag-plan.md` and `reference-study.md`: story, timings and reference-derived motion decisions.
- `creative-review.md`, `sound-review.json`, `verification.json` and `playback-review.json`: visual review, objective audio measurements, export checks and separate visible-window playback.
- `credits.md`: soundtrack sample license, UI provenance and staging disclosure.
- `work/film.html`: editable pure-time composition; `work/timeline.json` keeps picture, cursor, typing and sound on one clock.

The real production Cap Context orb, picker, ChatGPT hover/selection and transfer card are exported from `extension/platform-content.js` into `work/native/ui.json`. Claude and ChatGPT shells are authored sample conversations. The native transfer card is shown inside Claude's chat and its camera view is enlarged for the film. Film-only suppression of the card's backdrop blur and shadow avoids a rectangular compositor artifact over chat text. The transfer is condensed, not a measured live latency claim. The carried context preserves all seven production headings and the backend's exact acknowledgement instruction; both destination Send clicks remain user actions.

## Reproduce locally

Use Node.js with Playwright, Python with NumPy/Pillow, FFmpeg and Brave. The scripts launch a separate isolated Brave process. From this output directory:

```powershell
node work/capture-native.cjs
python work/prepare-timeline.py
python work/retime.py
python work/score.py
python work/sound-review.py
node work/render.cjs --preview
node work/render.cjs --motion-study
python work/review-stills.py
node work/render.cjs
node work/verify.cjs
node work/playback-check.cjs --headed
```

On the owner's machine, Node and Python came from `C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/`. The score generator obtains the three credited CC0 upright samples when absent. `work/audio/`, rendered frames, reference samples and host-research images are ignored by Git. The output media and scripts are retained as a new edition, separate from the previous cut.
