# Cap Context — keep going

A fresh launch-video draft built after studying the owner's local Claude Cowork reference. The story is a Kyoto itinerary interrupted by Claude's limit, carried through Cap Context, and continued in ChatGPT. Marketing copy appears only after the work leaves the frame.

- `brag.mp4`: final 1920 × 1080, 60 fps, 62-second H.264/AAC video.
- `brag.jpg`: settled message card; replaces frame zero without shifting audio.
- `share-copy.txt`: postable copy.
- `verification.json`: final export, browser playback, source provenance, click positions/sync and story checks.
- `credits.md`: CC0 piano sample sources and staged-chat disclosure.
- `work/film.html`: editable pure-time composition; `work/timeline.json` is the shared click/typing/audio clock.
- `work/native/ui.json`: fresh production DOM/CSS, not old video screenshots. Preview PNGs document the original native states.

Claude and ChatGPT surroundings are authored sample chats. Cap Context's picker, hover, selection, orb and handoff markup/styles are exported from the current production content script through a local fixture. The destination acknowledgement comes from the backend's exact instruction. Both Send clicks are user actions. The film condenses transfer timing and omits its estimated countdown. It does not claim a real private account recording or measured live transfer latency.

## Recreate locally

Use Node and Python from the Codex bundled runtime, Playwright, Pillow, NumPy, FFmpeg, and the installed Brave browser. Scripts open a separate isolated Brave process. Run from this output directory:

```powershell
node work/capture-native.cjs
python work/prepare-timeline.py
python work/score.py
node work/render.cjs --preview
node work/render.cjs --motion-study
python work/review-stills.py
node work/render.cjs
node work/verify.cjs
```

On this machine the runtime executables are under `C:/Users/vinit/.cache/codex-runtimes/codex-primary-runtime/dependencies/`. `score.py` downloads three CC0 piano recordings when absent. Render frames, audio caches and the owner's reference footage are ignored. No private account data is accessed.

Keep `will-change` disabled in this composition: retained low-resolution Chromium textures softened macro text and made snapshots depend on earlier camera positions. Removing the hint fixed both, verified by identical pixel snapshots after unrelated seeks.
