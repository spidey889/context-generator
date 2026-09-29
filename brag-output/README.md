# Cap Context launch draft — Claude → ChatGPT

`brag.mp4` is the first draft requested with `/brag-slim`: a deep Claude conversation reaches its limit, the user chooses ChatGPT in Cap Context, the context is carried over, and the same launch email continues. 24 seconds, 1920 × 1080, 60 fps, H.264/AAC stereo. `brag.jpg` is the settled poster and replaces frame 0 without changing duration. `share-copy.txt` is ready to post.

The extension's real orb, Claude-source destination picker, ChatGPT hover treatment and ChatGPT handoff states are freshly captured from `extension/platform-content.js`. `work/assets/provenance.json` records the production source commit/hash and exact picker hit point. This capture fixture changes only host/runtime boundaries and local test exports. It omits the estimated countdown because this is an edited sequence.

The host chats are authored native-looking illustrations, not recordings of private accounts. Claude retains its cream canvas, serif assistant copy, orange mark, sidebar and Sonnet composer; ChatGPT uses its distinct white canvas, gray user messages, sans-serif replies and black Send control. The sample conversation is invented. The blocking Claude notice follows the [official usage-limit wording](https://support.claude.com/en/articles/12466728-troubleshoot-claude-error-messages), with an illustrative reset time. The full seven-section sample Context Carry and exact confirmation instruction are present. Both destination sends are explicitly performed by the cursor. Transfer and generation timing are condensed and do not claim measured latency.

All audio is newly synthesized. No stock footage, private chat material, reference-video clips or third-party music are used. The existing V1/V2 videos and website remain available separately.

Rebuild from the project root with Node 22+, Python, FFmpeg and the bundled Playwright runtime:

```powershell
node brag-output/work/capture.cjs
python brag-output/work/score.py
node brag-output/work/render.cjs --preview
node brag-output/work/render.cjs
node brag-output/work/verify.cjs
```

`work/film.html` is the editable deterministic composition. Preview/export frames, the intermediate WAV and host reference images stay inside ignored working folders. The renderer waits for all fonts and images, uses two isolated Brave pages with ordered frame batches, and converts actual JPEG samples to limited-range BT.709 before encoding. `verification.json` records media metadata, strict full decoding, audio level, browser playback/seeking, color checks and file hashes.
