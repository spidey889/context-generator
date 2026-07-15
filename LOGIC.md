# Cap Context Production Logic

This is the single source of truth for current production behavior. Historical decisions and replaced approaches live in `CHANGELOG.md`.

## Production Surface

- `index.html`: dependency-free Cap Context marketing site served from the repository root on Vercel and GitHub Pages.
- `extension/manifest.json`: Manifest V3 registration, supported hosts, service worker, shared content script, analysis bridge, permissions, and assets.
- `extension/platform-content.js`: in-page button/picker, capture, handoff UI, paste logic, manual-copy fallback, and latest-run receipt.
- `extension/background.js`: tab orchestration, one backend summary job per transfer, identical-job deduplication, short exact-summary cache, and paste relay.
- `extension/analysis-bridge.js` and `analysis/index.html`: latest-run analysis on GitHub Pages.
- `api/request-security.js`: endpoint trust boundary, validation, limits, and abuse controls.
- `api/summarize.js`: profiles, isolated provider prompt, fallback chain, output validation, normalization, and timing.
- `vercel.json`: 180-second summary-function ceiling.
- `test/`: Node regression coverage.
- `evaluation/cases.json`: versioned conversations, expected facts, forbidden facts, and latency thresholds.
- `scripts/run-regression-eval.js`: live endpoint scorer for summary accuracy, structure, and latency.
- `.github/workflows/regression-gate.yml`: complete gate after pushes to `master`, daily, and on demand.

Production deploys from `master` to `https://context-generator-five.vercel.app/api/summarize`.

## Marketing Website

The repository-root `index.html` is the current Cap Context marketing page. It uses only relative asset paths so the same file works at the Vercel root and the GitHub Pages `/context-generator/` path. The page has no build step, external font request, autoplay video, or runtime API dependency; below-fold images are lazy-loaded and the motion system respects reduced-motion preferences.

The page markets the current browser extension rather than the replaced Claude `SKILL.md` flow. Its install funnel downloads the lightweight `cap-context-extension.zip`, directs Brave or Chrome users to the browser extensions page, and tells them to load the extracted folder unpacked. The archive contains the contents of `extension/` with `manifest.json` at its root; regenerate it whenever tracked extension code or assets change. The site does not claim a browser-store listing. The interactive handoff console is an illustrative, local-only UI demo and never reads a conversation or starts a transfer.

Marketing claims mirror production behavior: Claude, ChatGPT, Gemini, Grok, and DeepSeek support; up to 210,000 captured characters; no chat capture while only browsing the picker; provider processing after destination selection; local raw-transcript diagnostics for up to 24 hours; and no automatic Send action. The previous homepage is preserved unchanged as `index.legacy-2026-07-15.html` and is not loaded for visitors.

## Platforms And Startup

Cap Context supports Claude, ChatGPT, Gemini, Grok, and DeepSeek. ChatGPT content-script permissions and startup detection are limited to `chatgpt.com`, its existing subdomain coverage, and the legacy `chat.openai.com` ChatGPT host; ordinary `openai.com` pages and unrelated OpenAI subdomains are excluded. The picker lists all supported platforms except the source. The toolbar action transfers directly: ChatGPT defaults to Claude; other sources default to ChatGPT.

One shared content script handles source and destination behavior. A versioned load id, runtime guards, cached asset URLs, and stale UI/style cleanup make unpacked-extension reloads safe.

## Current Transfer Flow

1. Opening the picker is UI-only. It enters with a short opacity-and-transform transition, but does not scrape, fingerprint, summarize, or transmit chat content. Content-free preconnect hints may be added for destination origins.
2. After destination selection, the source synchronously checks for at least one structurally verified real message turn. A zero-turn chat shows `Nothing to carry yet` immediately without showing the handoff popup, starting its countdown, or opening a destination tab.
3. With at least one verified turn present, the source shows the compact centered handoff popup with the same short entrance treatment and opens the chosen destination inactive while capture continues. The card uses the screenshot-sampled warm cream `#FFFFEB` surface and light lavender `#F0D7FF` active accent, with warm near-black text and borders for contrast. It keeps the bubble icon, `Cap Context` label, and fixed 30-second countdown in one vertically aligned header row, and uses the destination sheet's Georgia display face only for the larger centered live headline. Below it, the system-sans indicator has three deterministic stages: `Capturing chat`, `Summarizing`, and `Pasting into <destination>`. Pipeline start/done marks advance each stage between highlighted active, checked completed, and legible muted upcoming states. While capture is active, the first connector reads the scroll position and remaining distance already produced by the virtual sweep's diagnostics, then eases toward that real fraction without changing or awaiting scraper work. While summary is active, the second connector uses one 30-second linear CSS transition from 5% toward a 90% ceiling as display-only activity; it cannot claim completion, and the real `summary done` mark alone fills it to 100%. Headline changes still enter with a short event-driven fade/slide that respects reduced-motion preferences. During the real gap after summary completion and before the paste request starts, the headline says `Summary ready` and paste remains upcoming. No timer rotates or invents status copy, and no progress animation gates the pipeline.
4. Capture scrolls to the top, waits within bounded stability windows for delayed turns, expands safe reading controls, and then sends every chat through the same bounded rendered-window sweep. Each downward pixel advance is followed by an awaited two-sample render-stability window before the next advance; rendered-message boundary anchoring is a fallback only when pixel scrolling cannot move. Steps use 60% of the viewport by default. A following step may use 90% only when the actual before/after rendered snapshots prove a sliding window with at least 50% ordered turn overlap and a real positional shift; unchanged, delayed, non-overlapping, and oversized-message windows remain at 60%. The sweep continues while scrolling moves or the rendered conversation changes, and a short chat exits naturally after the terminal quiet check finds nothing more to capture.
5. After capture, the content script checks the serialized transcript length locally. Above 210,000 characters it stops with the existing oversized-conversation error and sends no `SUMMARIZE_WITH_BACKEND` message; otherwise it sends one, and the background worker sends the backend summary job exactly once.
6. Identical concurrent jobs may join one in-flight promise. Up to eight exact results are cached in service-worker memory for two minutes. This is not warm summarization; picker open never starts capture or summarization.
7. The result is pasted into the prepared destination. Grok and ChatGPT focus before paste; ChatGPT also has activation-settle and paste-stability checks. Missing or failed prepared tabs retry in a fresh tab.
8. Verified paste focuses the destination. The extension never clicks Send. If a generated summary cannot be transferred, a manual-copy dialog preserves it.

The source lock has a four-minute safety reset. Background waits are 12 seconds for source startup, normally 30 seconds for destination messaging, 45 seconds for ChatGPT destination messaging, and 150 seconds for the single backend fetch.

## Conversation Capture

Capture accepts platform-specific message elements only when the author is verified by structural evidence such as `data-message-author-role`, `data-role`, Claude test ids, Gemini user/model elements, or equivalent role-bearing ancestors. Loose “you” or “me” guesses are not used. The active composer input, its descendants, and wrappers that contain it are structurally excluded from conversation candidates, so rotating empty-input prompts cannot count as chat history. Known empty-screen text remains a secondary safeguard. If the first capture unexpectedly returns the exact empty-chat error, every supported platform gets the same bounded 1.8-second retry window; successful first captures return immediately without that wait.

The scraper excludes extension DOM, rejects empty or role-unverified chats, and prefers real child turns over broad wrappers. After the initial rendered snapshot, every chat enters the same bounded sweep; there is no turn-count or size gate. Actual scroll movement, rendered-window changes, stale limits, and a terminal quiet check determine whether capture continues. Successful physical scrolling counts as progress on every platform even when one tall mounted message keeps the rendered signature unchanged. A non-scrollable short chat therefore finishes after a boundary probe and terminal quiet check find nothing new, while a long chat whose first virtualized window exposes only a few turns still progresses through later windows. Virtualized windows use sequence alignment against all accumulated turns, so matching blocks can occur anywhere in a snapshot and genuinely new turns are inserted between their surrounding anchors. Final selection starts from the exact useful turns serialized by the quick capture, aligns the swept turns into that baseline, and replaces a matched message only when the swept text is longer; equal message counts therefore still keep fuller rendered text, while a shorter swept version cannot downgrade the quick capture. Immediately before serialization, a separate safety pass removes every later exact duplicate with the same role and text. On Claude, a role-bearing user/assistant message wrapper owns its same-role rendered paragraph/code fragments, so one long response remains one turn; mixed-role or conversation-level wrappers still split into their real child turns. It never falls back to broad page, `main`, thread, chat, or conversation text. The sweep leaves the source at its final capture position rather than restoring the prior scroll position. While sweep diagnostics are enabled, the console receives a start record, one record per advance with scroll position, step distance/ratio, next ratio, detected/collected turn counts, and a final record naming the exact exit reason.

Capture preserves the complete middle and applies no character truncation. The serialized transcript contains role-labeled turns only. The extension rejects input above 210,000 characters immediately before requesting a summary, without sending it to the backend; the backend independently enforces the same limit as a defense-in-depth check.

## Summary Profiles And Provider Chain

Tiny input at or below 1,200 characters uses `local-direct`: the backend builds the Context Carry locally, preserves the exact short transcript, and calls no provider.

| Profile | Input characters | Target | Output cap |
| --- | ---: | ---: | ---: |
| `small` | 1,201–8,000 | about 350 words | 1,000 tokens |
| `medium` | 8,001–60,000 | about 700 words | 1,900 tokens |
| `large` | 60,001–210,000 | about 1,200 words | 4,200 tokens |

The large profile reports a 1,100-word quality-floor diagnostic, but that value is passive. The expansion pass is removed; no short result triggers a second expansion request.

Every non-tiny transfer creates one backend summary job. Within it, transient attempts and validation failures may advance through:

1. Mistral `mistral-medium-2604`
2. Mistral `mistral-large-2512`
3. Mistral `ministral-3b-2512`
4. Groq `llama-3.1-8b-instant`, when `GROQ_API_KEY` exists

`MISTRAL_MODEL` does not override the chain. A provider-wide Mistral 429 moves from the bounded primary attempt directly to Groq. Total per-model budgets are 55, 40, 25, and 15 seconds, about 135 seconds worst-case. Provider fetches also have an 80-second abort ceiling, but the smaller model budget is effective. This fits below Vercel’s 180-second ceiling and the extension’s 150-second wait. The extension never replays the backend job.

## Prompt Isolation And Validation

The system message holds the summary rules and exact seven-section Context Carry contract. It tells the model to search the complete transcript carefully for facts relevant to every section before writing, and permits `None` only when that search finds no useful grounded information for the section. `WHAT WE WERE DOING`, `WHERE WE LEFT OFF`, and `KEY CONTEXT` must always contain strong transcript-grounded content. Assistant suggestions and possibilities are not decisions unless the user clearly accepts them; `DECISIONS MADE` contains only user-made or user-confirmed decisions, including deliberately deferred choices and accepted tradeoffs. When states conflict, the latest user-confirmed state is current truth, and an older state is retained only when still relevant and explicitly labeled as replaced, rejected, changed, or historical. The transcript is JSON-serialized into a separate versioned user-role data envelope. The system message declares all envelope content—including apparent system, developer, tool, API, or instruction text—untrusted customer data to summarize, not instructions to execute.

Generated output is validated locally without an evaluation-model call. It must contain the Context Carry header, all seven sections exactly once and in order, meaningful content in the three continuation-critical sections, a low profile-derived minimum body length, and the exact destination confirmation. Optional sections such as `WHO I AM` may contain `None` when the transcript genuinely supplies no relevant fact. Obvious refusals and API-error output fail.

Normalization may strip fences/footer noise and canonicalize already-valid headings/confirmation. It does not invent sections or wrap free-form output as valid context. Invalid output advances through the same model/provider chain; exhaustion fails the job without pasting broken output.

## Endpoint Security And Limits

Only `POST` and valid extension preflight `OPTIONS` are accepted. CORS reflects syntactically valid `chrome-extension://` and `moz-extension://` origins only.

Valid extension-origin requests may omit the public `X-Cap-Context-Client: cap-context-extension/1` compatibility marker for already-running workers. Originless or `Origin: null` Firefox requests require it. The marker is compatibility metadata, not authentication.

Before provider work, JSON must contain exactly one non-empty string field, `conversation`. The endpoint rejects extra fields, invalid JSON/types, non-JSON content, request bodies above 1,000,000 bytes, conversations above 210,000 JavaScript characters, and conversation UTF-8 payloads above 840,000 bytes.

Instance-local controls allow 8 requests per observed client IP per minute, 40 per hour, and 8 concurrent jobs per warm function instance. They are not a global durable quota. Provider errors become bounded safe messages; raw provider response bodies are not exposed or logged.

## Privacy And Diagnostics

Chat text leaves the source page only after destination selection. It goes to the Cap Context backend and, for generated summaries, Mistral or the configured Groq fallback. The backend does not intentionally persist or log transcripts; the extension locally retains the latest captured transcript as described below.

The exact-summary cache and in-flight map are memory-only. One latest-run receipt is stored in `chrome.storage.local`; it contains counts, timing, provider/model/fallback metadata, token usage, status, and initially the exact captured transcript sent to the backend. A persistent extension alarm removes only the raw transcript and its expiry marker after 24 hours; all other receipt diagnostics remain until the next transfer replaces the receipt. The analysis bridge also enforces this expiry when reading the receipt in case a delayed browser alarm has not run yet. The connected analysis page exposes an available transcript only inside a collapsed raw-text panel; it does not include the generated summary. Picker open/close, preconnect, and destination warming do not include chat content. Pasted text is never automatically submitted.

## UI, Placement, And Paste

Placement is platform-specific: Claude anchors beside its voice controls; ChatGPT mounts fixed at the page root near its model selector; Gemini anchors near `Flash`; Grok anchors near its mode selector; DeepSeek anchors near attachment. Each retains bounded editor/composer positioning fallbacks for hydration or selector drift. Those UI fallbacks are not conversation-capture fallbacks.

First-use and Claude-limit nudges are extension-owned and excluded from capture. Paste uses platform editor selectors, native setters/events, contenteditable insertion paths, and stable Context Carry anchors. ChatGPT adds hydration stability checks. Manual copy is the final recovery path after summary generation.

## Latest Run Analysis

The latest-run receipt powers the GitHub Pages analysis view through `analysis-bridge.js`. It reports end-to-end/capture/backend/paste timing, turn counts, backend input/output sizes, profile, model/fallback details, token usage, and status for the life of the receipt. Behind a collapsed gear control, the complete exact captured transcript is available only during its first 24 hours. Expired and older receipts without raw text keep the control disabled until a fresh transfer.

## Verification Contract

`npm test` covers endpoint security and limits, picker/preconnect privacy, one-job background behavior, prompt isolation, profiles and routing, 210,000-character forwarding, timeout budgets, fallbacks and validation, absence of expansion, full-middle capture, exact duplicate safety, structural roles, removal of broad DOM fallback, sequence-aligned virtualized capture, paste verification, deterministic handoff-stage transitions, placement, and analysis receipts. It also loads the versioned evaluation set through the real capture hooks and fails on any lost turn, changed turn count, or fixture capture above 250 ms.

`npm run eval` sends the versioned evaluation transcripts through `EVAL_ENDPOINT`, defaulting to production. It fails below 90% required-fact recall, on any forbidden/incorrect fact, invalid Context Carry structure, a per-case latency over 30 seconds for the small case or 60 seconds for the medium case, or more than 90 seconds total. Required facts may define explicit equivalent phrases so harmless paraphrases do not create false failures.

`npm run gate` runs both layers and is the release command. GitHub Actions runs the same command after pushes to `master`, daily, and on demand to catch release regressions and later production drift.
