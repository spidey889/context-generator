# Extension Logic

This document explains how the Chrome extension works right now. It is written for future Codex sessions so the existing behavior can be understood without rebuilding it from scratch.

## Files Involved

- `extension/manifest.json` registers the extension, host permissions, the background service worker, and the shared platform content script on all supported AI sites.
- `extension/background.js` coordinates tab creation, content script injection, backend summarization, badge state, and messages between pages.
- `extension/platform-content.js` owns the Cap-Context button, destination picker, conversation scraping, backend summary request, and destination paste behavior for every supported platform.
- `extension/analysis-bridge.js` runs only on the GitHub Pages analysis route and exposes the latest saved transfer metrics from extension storage to the page.
- `analysis/index.html` is the GitHub Pages analysis UI at `/context-generator/analysis`.
- `api/summarize.js` is the Vercel serverless endpoint that calls Mistral.

The old split content scripts were removed. There is no longer a separate Claude launcher script, ChatGPT paste script, or generic AI destination paste script.

## Supported Platforms

The supported platforms are:

- Claude at `claude.ai`
- ChatGPT at `chatgpt.com` and OpenAI-hosted ChatGPT pages
- Gemini at `gemini.google.com`
- Grok at `grok.com`
- DeepSeek at `chat.deepseek.com`

The extension button appears on all five platforms. From any one platform, the user can send context to any of the other four platforms.

## Startup And Extension Icon Flow

The manifest loads `platform-content.js` on every supported AI platform. It also makes the bubble icon and platform logos available to all supported hosts.

The background service worker handles the browser action icon. When the user clicks the extension icon, the background worker checks that the active tab is one of the supported AI sites. It injects `platform-content.js` just in case the content script is not already present, then sends `START_CONTEXT_TRANSFER` to that tab.

The browser action uses a default destination because it does not open the destination picker. If the source tab is ChatGPT, it sends to Claude. Otherwise it sends to ChatGPT. The in-page Cap-Context button is the normal way to choose any of the other four destinations.

When the extension service worker starts, installs, or reloads, it attempts to inject `platform-content.js` into already-open supported AI tabs. This helps unpacked-extension development reloads replace stale content scripts without requiring every AI tab to be manually refreshed.

The platform content script guards against double loading with `window.__contextGeneratorPlatformLoaded`. It also has an `isRunning` lock and a 60 second auto-reset timer so two transfers do not run at the same time forever.

Because unpacked extension reloads can leave an old content script running in already-open AI tabs, the guard uses a versioned load id instead of a plain boolean. A fresh script can replace stale extension UI nodes instead of being blocked by the old page-level flag. Before registering message listeners, `platform-content.js` verifies that `chrome.runtime`, `runtime.onMessage.addListener`, and `runtime.sendMessage` exist; stale/reloaded tab contexts skip startup instead of throwing. Extension asset URLs are cached at startup, so delayed UI creation does not call `chrome.runtime.getURL()` after Chrome has invalidated the old extension context. Placement monitoring no longer attaches listeners directly to the chat input; the MutationObserver, resize, visibility, and focus listeners are enough to keep the button positioned without leaving input listeners from stale scripts behind.

When button placement behavior changes, bump `CONTENT_SCRIPT_LOAD_ID`. Otherwise an already-open AI tab can keep the old injected script and continue showing the old placement bug even though the file on disk has been fixed.

## How The Button Is Placed

`platform-content.js` uses platform-specific placement for Claude, ChatGPT, Gemini, Grok, and DeepSeek. Each platform has input selectors for its editor.

The script watches the page with a `MutationObserver`, plus listeners for resize, visibility changes, and focus changes. When the AI page changes its DOM, the script schedules one `requestAnimationFrame` update. It ignores mutations caused by the extension's own button, overlay, fallback modal, and destination sheet so it does not chase itself.

To find the input, the script uses the current platform's editor selectors first, then fallback selectors. Candidates are scored by whether they are textarea/input/contenteditable elements, whether they are inside a form, whether their labels mention message/prompt/chat/write/ask/input, whether they are wide enough, and whether they are near the bottom of the viewport. Top-of-page candidates are penalized.

After it finds the input, it searches for a composer surface: a parent element that wraps the input and has a reasonable composer-like size. ChatGPT, Gemini, and DeepSeek also have platform-specific composer selectors so the button anchors to their rounded input bars instead of a page-wide app container. Oversized ancestors are rejected before placement. If no good parent is found, it falls back to the form or the direct parent.

The floating button is a clean 42px button with `bubble-icon.png` inside it and no always-on border ring. For Claude, Gemini, Grok, and DeepSeek, the script appends the button inside the composer surface. If the composer surface has static positioning, the script temporarily changes it to `position: relative` and remembers the original inline position value so it can restore it later.

ChatGPT is the exception. Its Cap-Context button is mounted on the page root and uses `position: fixed`, because ChatGPT's composer wrappers re-render, clip unknown children, and sometimes do not expose a stable composer surface during hydration.

For Claude, the button sits inside the composer as a composer-relative overlay aligned with the bottom button row. The script tries to anchor Cap-Context to the right side of Claude's voice mode control when that control is detectable, and otherwise uses the rightmost small composer control as the row anchor. Claude is the one platform-specific exception where the row gets visual nudges: the model selector moves 48px left, and mic/voice/send-side controls move 52px right before any overflow correction. The model nudge also temporarily makes the model control and its immediate wrappers `overflow: visible` so the first letters of `Sonnet` do not clip. On startup, the content script also restores any old `data-context-generator-original-transform` and `data-context-generator-original-overflow` reservations left by a stale injected script.

Clicking the button opens a destination picker titled `Where to continue?`. The picker lists all supported platforms except the current one, and its helper line is always `Context goes straight into the input box`. The `Cap-Context` pill in the sheet header keeps the subtle light border hidden at rest and shows it only on hover/focus. Destination tiles keep neutral edges at rest with only a tiny static platform-color glow tucked behind the logo, extending just past it; hover/focus keeps the small scale-up motion but no longer adds platform-color border lighting, haze, or shine. Opening the picker does not scrape the chat or call the backend. After the user clicks a destination tile, the extension opens and warms only that selected platform tab, shows the source-page handoff popup, captures the full conversation, summarizes it once, and pastes the result into the already-open destination input. After paste succeeds, the background worker focuses the destination tab. The user manually reviews and sends it.

The first time the Cap-Context bubble appears on a supported platform, the content script can show a small onboarding nudge near the bubble. It uses a CSS-only full-body puppet with matched arms/hands, legs, shoes, shaped hair strands, brows, eye highlights, face detail, premium graphite/silver shading, and a pointing-arm animation aimed at the button. The copy stays short: `Transfer chat context` and `From this button.` The nudge is marked as extension-owned DOM, is excluded from scraping, hides when the picker opens, and stores a `localStorage` dismissed flag after the user clicks the bubble or the nudge's `OK` button.

On Claude only, the content script also watches visible alert/banner-style page text for message-limit language. When Claude itself shows the user has hit the limit, a small Cap-Context-connected nudge appears next to the bubble and opens the destination picker when tapped. The nudge intentionally says `Claude's also broke by message 20`. After the user clicks the nudge, clicks the Cap-Context bubble, or focuses Claude's composer while the limit banner is visible, the nudge stays dismissed until Claude's limit banner disappears and later returns.

## Composer Placement Strategy

Claude, ChatGPT, Gemini, Grok, and DeepSeek intentionally do not use the shared native-control shifting path. Their composers re-render and resize often, so moving their native action clusters with `transform` can cause flicker, jumping, or broken-looking UI.

For Claude, `updateFloatingButtonPosition()` calls the Claude-specific branch before the old shared placement path. It keeps Cap-Context mounted on the composer surface with absolute coordinates, anchors to the bottom-row voice mode control when possible, and places Cap-Context just to the right of that control with tight row spacing. The current fine-tuned spacing uses a 46px post-anchor bubble gap, a 4px right clamp, a 48px left nudge for the model selector, and equal 52px right nudges for mic/voice/send-side controls. If that natural slot would overflow the composer, it subtracts the overflow from the small-control right nudge, capped to the Claude inline width. The model label overflow is made visible only while the Claude row reservation is active.

For ChatGPT, `ensureFloatingButton()` and `updateFloatingButtonPosition()` take the ChatGPT-specific branch before the normal composer-surface path. That branch releases any old reserved action slot, releases any old reserved composer surface, appends the button to the page root, and switches it to fixed positioning. It then scans the page for the bottom-right intelligence/model selector (`Instant`, `Medium`, or `High`) and places Cap-Context immediately to the left of that selector. If the selector cannot be detected yet, it falls back to the composer/form/input rectangle and clamps the button inside the viewport. This means the button still appears while ChatGPT is hydrating or reshuffling its composer DOM.

For Grok, `updateFloatingButtonPosition()` also takes a platform-specific branch before the shared placement path. It first looks for Grok's speed/mode selector (`Fast`, `Auto`, `Expert`, `Think`, or similar) and places Cap-Context immediately to the left of that selector, matching the ChatGPT-style model-selector placement. It explicitly avoids send, mic, microphone, and voice controls so the button does not land on top of Grok's audio buttons. If the selector cannot be detected, it falls back to a safe slot farther left inside the composer. It always releases any reserved action slot and never shifts Grok's native controls, because transforming Grok's action row can trigger visible flicker.

For Gemini, `updateFloatingButtonPosition()` takes a Gemini-specific branch before the shared placement path. It keeps Cap-Context anchored to the bottom action row with `bottom`/`right` coordinates and now prefers the visible `Flash` model selector as the anchor, so Cap-Context sits to the left of `Flash` instead of between `Flash` and the mic. If the model selector is not detectable, it falls back to the older safe right-side action button anchor. It releases any reserved action slot and does not transform Gemini's native controls, because Gemini can resize the composer upward during large pastes and the shared transform path makes the button flicker.

For DeepSeek, `updateFloatingButtonPosition()` calls the DeepSeek-specific branch before the shared placement path. It scans the bottom-right action row using `button`, `[role='button']`, and `[tabindex='0']` candidates, places Cap-Context to the left of the pin/attachment control, and falls back to a fixed bottom-right action-row slot if DeepSeek's controls are not detectable. It never falls back to the old top-right shared placement.

Composer scoring also gives ChatGPT and DeepSeek a bonus for candidates that include the lower action row and penalizes tiny inner text-area wrappers. This keeps the bubble anchored to the full rounded composer instead of a smaller editor child.

## Claude Voice-Mode Overlay Rule, July 2 2026

Claude placement should stay Claude-only, composer-surface mounted, and absolute-positioned. Do not append Cap-Context to Claude's action row. The preferred visual order is model controls, mic, voice mode, then Cap-Context on the same horizontal line. Keep nudges tiny and visual-only: model/sonnet/opus/haiku controls get the small left nudge, while mic/voice/send-side controls get the same small right nudge so their spacing stays even. To make room only when needed, the Claude branch subtracts overflow from the small-control right nudge instead of using a fixed wide lane or shifting a parent wrapper. If the voice mode button cannot be detected by label, use the rightmost small composer-row control as the baseline instead of moving the bubble above the row.

## ChatGPT Button Fix, June 29 2026

The broken behavior was that the ChatGPT button stopped appearing after several placement changes. Earlier fixes were still trying to make the button live inside, or depend on, ChatGPT's composer surface. That was fragile for three reasons:

- ChatGPT's current UI can render the `Instant`/`High` model selector in a wrapper that is not always inside the composer surface candidate chosen by our scorer.
- If `findComposerSurfaceElement()` returned no good surface, the old code hid the button before the ChatGPT-specific fallback logic had a chance to run.
- During unpacked-extension development, stale already-injected scripts could leave old Cap-Context DOM behind or keep an old page-level load flag, so the new script needed to fully replace old extension-owned nodes on load.

The working fix is:

- Use a versioned content-script load id and always remove old Cap-Context UI nodes before a fresh script starts.
- Keep the existing input detection, because it already finds ChatGPT's message editor.
- For ChatGPT only, stop mounting the button inside the composer. Mount it on `document.body`/the page root.
- Use `position: fixed` for the ChatGPT button, so ChatGPT cannot drag it around or clip it with composer wrappers.
- First anchor to the real model selector button by finding visible buttons whose text contains `Instant`, `Medium`, or `High`.
- If that selector is not ready, calculate a safe fallback from the composer, form, or input rectangle and clamp the coordinates to the viewport.

Future rule: do not move the ChatGPT button back into ChatGPT's composer DOM and do not rely on `findComposerSurfaceElement()` before showing it. ChatGPT placement should remain page-root mounted, fixed-positioned, and anchored visually to the model selector.

## How Conversation Scraping Works

For picker-started transfers, the handoff popup is shown before capture, then the source page is instantly scrolled to the top. After the scroll, the script samples the detected message-turn count until it stops increasing for a short bounded window, so older messages loaded by the top-scroll are included before scraping starts. The scraper still removes extension-owned DOM before reading text, so popup text is not included in the backend input.

July 5 2026: The virtualized long-chat sweep must trigger when only eight turns are visible, because ChatGPT can render long conversations in eight-turn windows. The transfer path starts from the top-rendered window, collects it, then scrolls downward with overlapping half-viewport steps until the rendered window stops changing or the bounded safety limit is hit. If a platform's scroll root does not expose the next batch, the sweep uses the last rendered message as an instant `scrollIntoView` anchor and waits for the next virtualized window before collecting again. Keep the threshold at or below eight unless the ChatGPT regression is updated with new real evidence.

July 5 2026 later note: Claude long-message chats can need far more scroll movements than short-message chats with the same turn count, because each virtualized window advances by less conversation content. The sweep safety cap is intentionally high but still bounded at 480 attempts so very long Claude chats can reach the bottom without making short chats slower.

July 5 2026 stale-retry note: If Claude appears to stop around the same character count even with a high sweep cap, check the stale-window exit before raising the cap again. Claude now gets 10 stale retries and a longer 1.4 second slow-window wait. Normal successful sweep moves are faster because the loop waits only until the rendered message window changes instead of always waiting for a full settle window.

July 6 2026 speed note: After accurate Claude sweeps still took too long on 200+ turn chats, the successful-move path was made more aggressive without removing the bounded sweep. The pixel step moved from a half viewport to 0.6 viewport, window-change polling is shorter, and collapsed "show more" expansion no longer runs inside every poll tick. Claude also tries to advance from the last rendered message boundary before falling back to the pixel step, so virtualized chats can move by rendered batches when the site exposes the next window that way. Keep the slow Claude stale retry as the safety path for delayed batches.

July 10 2026 measured speed pass: Brave receipts showed Claude sweep capture taking 17-121 seconds and a deterministic 17.6-second no-progress tail after the last virtualized batch. The sweep now reuses one rendered snapshot per observation, caches scroll-root discovery for the capture, polls boundary changes on a frame-sized interval, keeps the multi-retry path while scrolling is still advancing, and stops after one full quiet-window check when neither boundary nor pixel scrolling can move. The existing delayed-batch and full-turn regression fixtures still pass. Sweep receipts now include `sweepMs`, stale-attempt count, and terminal quiet-check count.

Each platform has its own likely conversation selectors. Examples include Claude response/user-message selectors, ChatGPT `data-message-author-role` conversation turns, Gemini user/model response elements, Grok message elements, and DeepSeek markdown/message elements. The scraper also keeps a generic fallback selector set for message/conversation/chat/article/markdown containers so minor platform DOM renames are less likely to produce a false "no text" error.

For each candidate element, the script skips extension-owned nodes, reads `innerText` or `textContent`, cleans whitespace, and assigns a rough role:

- `User` when metadata mentions user, human, you, me, or query.
- The current platform name when metadata mentions assistant, model, response, Claude, ChatGPT, Gemini, Grok, DeepSeek, or bot.
- `Message` otherwise.

Candidates are sorted in document order. Nested duplicates and identical text duplicates are removed. A transcript is accepted when it has explicit user/assistant role evidence, or when multiple generic turns survive the empty-screen filters. It becomes blocks like:

```text
User: ...

Claude: ...
```

The transcript is prefixed with the source platform name, such as `Gemini conversation:`.

Conversation text is accepted only from message elements whose author can be verified from platform-specific DOM structure or explicit role attributes such as `data-message-author-role`, `data-role`, Claude user/assistant test ids, Gemini `user-query`/`model-response`, or an equivalent role-bearing ancestor. Loose `you`/`me` label guesses are not used. The old fallback that copied visible text from broad `main`, conversation, chat, or thread containers was removed so sidebar, navigation, settings, and other page chrome cannot be sent as conversation context.

When no role-verified message turns exist, user-triggered transfers stop before calling the backend instead of guessing from unrelated page text. A normal empty chat shows the polished `Nothing to carry yet` error; visible message-like elements whose roles cannot be verified produce a specific role-verification error so selector drift is visible rather than silently corrupting the context.

The extension does not truncate captured conversations. The complete cleaned transcript, including its middle, is forwarded to the backend. If a provider or deployment limit is reached, the transfer must fail visibly rather than silently deleting conversation history.

## How Summary Generation Works

There is one summary path: Vercel/Mistral backend summarization. The extension never asks the source AI to summarize. It does not inject prompts into Claude, ChatGPT, Gemini, Grok, or DeepSeek.

Opening the destination picker is UI-only. It does not scrape, fingerprint, summarize, or transmit conversation text. The transfer trace begins only when the user selects a destination tile.

When a transfer starts, `platform-content.js` shows a compact centered handoff popup on the source page with a randomized short line, an animated status line, and a subtle 20 second countdown pill. The handoff copy is intentionally patient and context-focused, such as `I don't like waiting 20 seconds either` and `This is for better context`, instead of destination-prep labels. After full capture, it makes one normal `SUMMARIZE_WITH_BACKEND` request. The background worker still dedupes in-flight exact conversation summaries and keeps a tiny two-minute in-memory cache for repeated exact transfers before reporting an error to the source page.

The background worker calls:

```text
https://context-generator-five.vercel.app/api/summarize
```

It sends a POST body:

```json
{ "conversation": "..." }
```

It expects:

```json
{ "summary": "..." }
```

If the backend request fails or returns no summary, the transfer stops before paste and shows a calm retry message: `Try again right now. We might have made a mistake. It almost never happens the second time.` There is no manual copy box in this case because no summary exists yet.

## How The Vercel/Mistral Backend Works

`api/summarize.js` is a Vercel serverless function. It reflects CORS only for `chrome-extension://` and `moz-extension://` origins, accepts only `POST` plus valid extension preflight `OPTIONS`, and requires JSON with the public `X-Cap-Context-Client` compatibility marker. Firefox extension requests may suppress the Origin header or send `Origin: null`, so a marked POST remains compatible with that behavior; ordinary web origins are always rejected. The marker is intentionally public and is not authentication or a secret. It provides browser/client filtering, while server-side rate limiting and strict validation provide the practical abuse boundary.

The endpoint accepts exactly one `conversation` string. It rejects malformed types, extra fields, non-JSON content, request bodies above 1,000,000 bytes, and conversations above the canonical 160,000-character limit before any provider is called. It also caps each observed client IP at 8 requests per minute and 40 per hour, plus 8 concurrent jobs across one live function instance. Vercel overwrites the forwarded client-IP header used by this limiter. The limiter is deliberately dependency-free and therefore instance-local: it reduces automated abuse and protects each warm instance, but it is not a globally durable quota across every serverless instance. Strong global quotas would require shared storage or authenticated users.

It accepts either an already-parsed body or a string body. Bad JSON returns 400. Missing or non-string `conversation` returns 400. Missing `MISTRAL_API_KEY` returns 500 unless `GROQ_API_KEY` is present and can serve the fallback summary.

For valid requests, it calls Mistral's chat completions endpoint with a short timeout and limited retry/backoff for transient rate-limit, server, and network failures:

```text
https://api.mistral.ai/v1/chat/completions
```

The summarizer uses two separate decisions: summary profile and Mistral model. Temperature is `0.1` for Mistral calls. `tiny` inputs up to 1,200 characters use a local direct Context Carry that preserves the exact source text without calling Mistral, because short chats do not need a generated summary. Summary size is adaptive instead of one-size-fits-all: `tiny` targets about 120 words with zero output tokens because it is local; `small` inputs up to 8,000 characters target about 350 words with 1,000 output tokens; `medium` inputs up to 60,000 characters target about 700 words with 1,900 output tokens; and `large` inputs above 60,000 characters target about 1,200 words with 4,200 output tokens. Every generated profile uses one provider request only. The prompt and required template use the selected profile's section budgets so short chats do not duplicate themselves just to fill a giant 1,200-word template.

For every generated (non-tiny) summary, the backend uses one fixed Mistral priority chain: `mistral-medium-2604`, then `mistral-large-2512`, then `ministral-3b-2512`. The old 20,000-character routing and `MISTRAL_MODEL` override no longer choose the primary model. Summary profiles remain based on input size, so model fallback does not change the small/medium/large output budgets. The backend logs the selected and serving model and returns the attempted model chain in timing metadata.

If the initial Mistral summary cannot be served because the Mistral request exhausts retryable rate-limit/server attempts, times out, throws, returns an error response, returns invalid JSON, or normalizes to an empty summary, the backend retries the same initial system/user messages against Groq at:

```text
https://api.groq.com/openai/v1/chat/completions
```

The Groq fallback uses `GROQ_API_KEY` and `llama-3.1-8b-instant`. A provider-wide Mistral 429 uses the primary model's bounded retry and then moves directly to Groq instead of repeating the same rate limit across every Mistral model. Timing metadata includes `servedBy`/`provider`, `primaryModel`, `providerMs`, `initialMs`, `mistralMs`, `groqMs`, `providerPasses`, `finishReason`, `qualityFloorMet`, and fallback details. Word count and the 1,100-word large-profile quality floor remain passive diagnostics only; they never trigger another provider request. Same-model retries remain available for fast transient errors but must fit inside that model's total request budget: 55 seconds for `mistral-medium-2604`, 40 seconds for `mistral-large-2512`, 25 seconds for `ministral-3b-2512`, and 15 seconds for Groq. The complete worst-case chain is therefore budgeted to about 135 seconds, leaving roughly 45 seconds below Vercel's 180-second function ceiling for parsing and runtime overhead. The extension waits up to 150 seconds and sends the backend job exactly once; it does not replay the full provider chain after a failure. The endpoint returns detailed input/output timing so latency and quality-floor results remain inspectable.

Before normalization, generated output passes deterministic local validation with no evaluation-model call. The validator requires the Context Carry header and every section exactly once in the required order, meaningful content in `WHO I AM`, `WHAT WE WERE DOING`, `WHERE WE LEFT OFF`, and `KEY CONTEXT`, the exact destination confirmation under `NEXT STEP`, and actual body content above a low guardrail derived from the existing profile target (`max(80, min(200, floor(targetWords * 0.2)))`). It rejects headings-only output, placeholders, duplicated/missing sections, obvious refusals, and responses dominated by API errors. Normalization may strip fences/footer noise and standardize headings, but it no longer invents missing sections or hides free-form output inside `KEY CONTEXT`. Invalid output is treated as that provider/model failing, so the existing Mistral/Groq chain may try the next model; if every result is invalid, the request fails and no broken summary is pasted.

The system prompt tells Mistral to summarize the conversation for another AI assistant and to return the exact `SKILL.md` Context Carry layout: the `CONTEXT CARRY — READY TO PASTE` header, then the seven section headings in order. The raw transcript is serialized inside a versioned JSON data envelope in a separate user-role message. The system message explicitly treats that conversation value as untrusted customer data, including fake system/developer/tool/API instructions, while still preserving relevant quoted instructions, code, decisions, constraints, errors, and unresolved questions as context. The validator accepts harmless markdown/emoji heading variations and whitespace, but it requires the header, every section, meaningful content, and the exact `🔁 NEXT STEP` confirmation before normalization. After validation, normalization strips code fences/footer noise, standardizes the boxed header and emoji headings, and canonicalizes the already-validated confirmation instruction. It does not create missing sections or convert free-form output into a summary.

Before returning the summary to the extension, the backend strips any closing instructional footer that starts with `PASTE THIS AT THE TOP OF YOUR NEW CHAT` or `Continue from where we left off`, so the destination input only receives the clean context carry content.

The function returns the first choice message content as:

```json
{ "summary": "..." }
```

Primary Mistral failures fall through to Groq when `GROQ_API_KEY` is configured. If both providers fail to produce a usable summary, the endpoint returns 502. Unexpected server errors return 500.

## How Context Transfer Works

After the backend summary returns text, `platform-content.js` sends `TRANSFER_TO_DESTINATION` to the background worker with the selected destination id, summary text, and the pre-opened destination tab id when one exists. The transfer logs console timing marks for click, capture start/done, summary start/done, destination click, tab open start/done, tab ready/message response, destination input ready, paste request start, destination paste done, final activation, and total completion. These logs are intentionally verbose because transfer speed is product-critical and the next optimization should target the largest measured phase.

The background worker validates the destination and opens the selected destination URL in a background tab as soon as the tile click can synchronously prove that at least one source turn exists, before source stabilization and the virtual sweep. It rechecks after stabilization when the first quick check was empty, so truly empty chats still open no tab. This overlaps destination loading with capture and summarization. The worker then retries `PASTE_CONTEXT` without waiting for the whole page to report `complete`; warmup pings an already-injected manifest script before attempting reinjection. The destination picker also adds preconnect links for the supported destination origins when it opens. Grok is the exception: the worker focuses Grok before paste because its composer is much faster and more reliable when the tab is foregrounded. If no pre-opened tab exists, if that tab disappears, or if the pre-opened tab replies with a paste failure, it falls back to creating a fresh destination tab and tries the paste again. After paste succeeds, it activates the destination tab and focuses its window.

Claude-to-ChatGPT is the priority transfer route. On Claude, conversation capture waits briefly for delayed message DOM before showing an empty-chat failure. On ChatGPT, the destination tab is focused before paste, gets a longer message/paste window, and uses a ChatGPT-specific paste path with paste-like events, `execCommand`, and direct DOM fallback. Paste verification uses stable text anchors such as `CONTEXT CARRY`, `WHO I AM`, and `WHAT WE WERE DOING`, so the transfer is not marked failed just because box drawing characters render differently in the editor.

The first ChatGPT paste after opening or reloading the extension is treated as unstable. ChatGPT can briefly expose a composer, accept inserted text, then clear that DOM during hydration. The background worker gives ChatGPT a tiny focus-settle delay before paste, and the destination content script requires pasted context to remain present for a short stability window before returning success. If the text is wiped, the same transfer retries paste instead of making the first user attempt look blank.

The destination tab receives `PASTE_CONTEXT`, finds the destination input with that platform's input selectors, and writes the summary into the editor.

For textarea/input editors, it uses the native value setter and dispatches input/change events.

For contenteditable editors, it targets the first paragraph if one exists, otherwise the editor itself. It selects the current contents, calls `document.execCommand("insertText")`, retries with select-all if needed, and falls back to assigning `textContent` if insertion still fails. It dispatches beforeinput, input, and change events afterward so React/ProseMirror-style editors notice the update.

After pasting, it verifies that a normalized leading sample of the summary is present in the editor. If verification fails, it shows an "Auto-paste failed" modal with a copy button and returns an error to the background worker. The source page also keeps the generated summary in scope during the transfer, so any destination/open/paste failure after summarization shows the same manual copy modal instead of only a generic transfer error.

Once paste verification passes, the flow stops. It does not search for Send buttons, click Send, submit forms, or press Enter on any destination platform. The pasted summary stays in the input box for the user to review and send manually.

## Latest Run Analysis Page

The extension saves one latest transfer receipt in `chrome.storage.local` under `context-generator-last-transfer-stats-v1` when a transfer trace finishes. This receipt intentionally stores only metrics and labels, not the scraped conversation text or generated summary. It includes source/destination, status, detected/captured message turn counts, full sent characters, backend-received characters, summary output characters, model/profile, word count, Mistral pass count, token usage when the backend returns it, paste timing, total timing, and sanitized timeline marks.

The public GitHub Pages UI lives at `analysis/index.html`, published as `https://spidey889.github.io/context-generator/analysis`. Because a normal web page cannot read extension storage directly, `extension/analysis-bridge.js` is registered only for that GitHub Pages route. The page sends a `postMessage` request, the bridge reads `chrome.storage.local`, and the bridge posts the latest metrics back. The page has a demo-only `?demo=1` mode for visual smoke checks, but the normal route shows only real saved extension data or an empty state.

The backend includes Mistral `usage` metadata in its timing payload. Tiny local-direct summaries report zero API tokens. Generated summaries report prompt, completion, total, and cached tokens for their single provider request when available.

## Badges, Overlays, And Error Handling

The background worker sets the extension badge to:

- `RUN` when the extension icon successfully starts a transfer.
- `OK` after a destination paste succeeds.
- `ERR` for transfer errors.

The source page shows the compact centered handoff popup while picker-started transfer work is running. The popup cycles through short status lines so the wait feels active without prompting the source AI.

If the source-side flow throws before a summary exists, the script resets the running flag, hides the overlay, and shows either the empty-chat nudge or the friendly summarizer retry message. If the failure happens after a summary exists, it shows the manual copy modal with the current summary so the user can still paste it by hand. Error popups auto-hide after 8 seconds and slide/fade back to the right.

If destination paste fails, the destination page shows a manual copy modal with the summary.

## Tricky Parts

- Each AI platform has a different editor DOM, so input detection is platform-specific but still scored generically.
- The floating button has to track each platform's composer without breaking native controls. Claude is the deliberate exception that visually nudges detected row controls to create a stable inline slot; ChatGPT, Gemini, Grok, and DeepSeek should keep their native action rows in place.
- The MutationObserver would loop forever if it reacted to its own UI. The script marks owned nodes and ignores mutations that are only caused by the extension.
- Conversation scraping is best-effort. It tries structured message turns first, then falls back to page text when a platform changes its markup.
- Programmatic pasting into modern AI editors is finicky. The script uses native setters, `execCommand("insertText")`, retries, direct `textContent` fallback, and synthetic beforeinput/input/change events.
- Destination transfer is paste-only. The script intentionally avoids all automatic send/submit/Enter behavior after the summary reaches the input box.
- Picker-started transfers show the overlay before capture, but scraping removes extension-owned DOM so overlay text is still not sent to Mistral.
- After reloading the unpacked extension, already-open AI tabs may still have a stale content script. The script avoids crashing on delayed asset URL lookups and shows a refresh-this-tab error if a runtime message hits an invalidated extension context.

## Past Decisions

[Codex: keep adding short entries here after major changes, fixes, reversions, or model/prompt decisions. Write what changed, what worked, and what got replaced. Keep it short.]

- 2026-06-29: ChatGPT button moved to a page-root fixed position anchored near the model selector. This replaced fragile composer-DOM mounting that made the button disappear or get clipped.
- 2026-06-29: Destination tile glass/shape experiments were reverted. Keep the restrained tile styling and avoid collateral edits to Grok placement helpers when changing visuals.
- 2026-07-01: Stale-tab crashes after unpacked-extension reloads were handled with runtime guards, cached asset URLs, and a versioned content-script load id. This replaced the plain loaded flag that blocked fresh scripts.
- 2026-07-01: Transfer speed work added trace logs, destination pre-open/warmup, warm-summary reuse, in-flight dedupe, and short summary cache. This replaced the slower serial handoff path.
- 2026-07-02: Empty chats now stop immediately with `Nothing to carry yet`, before opening a destination tab or calling the backend. This replaced waiting/retrying on truly empty start screens.
- 2026-07-02: Post-summary transfer/open/paste failures show the manual copy modal with the generated context. This replaced the generic source-page `Transfer failed` path when the summary already exists.
- 2026-07-02: The backend now forces the exact `SKILL.md` boxed Context Carry template and strips the old paste-instruction footer. This replaced the simplified/free-form Mistral prompt.
- 2026-07-02: The summarizer model is fixed to `ministral-3b-2512`. This replaced the `MISTRAL_MODEL` environment override so deployments cannot silently switch models.
- 2026-07-02: Free-form live summaries after the template fix were Vercel deployment drift, not prompt drift. The live alias `context-generator-five.vercel.app` belongs to the Vercel project `context-generator`; relink/deploy that project and verify with a direct POST before editing the prompt again.
- 2026-07-02: The destination confirmation is now enforced by backend normalization, not just by the Mistral prompt. This replaced preserving Mistral's generated `NEXT STEP`, which could still make the destination AI start answering immediately.
- 2026-07-02: Claude-to-ChatGPT reliability became the main transfer priority. Claude capture now has a short DOM retry, ChatGPT focuses before paste, and ChatGPT paste verification uses stable context anchors instead of only leading box characters.
- 2026-07-02: Added a minimal Node test runner with focused coverage for summary normalization, conversation scraping, and paste verification. The manual copy fallback modal was polished with clearer copy, Escape/backdrop close, focus restore, and initial focus on the copy action.
- 2026-07-02: First-run ChatGPT paste can be wiped by page hydration after a quick successful insert. ChatGPT now has a small activation settle and paste-stability check that retries if the editor clears the context.
- 2026-07-02: Root README now describes the extension-first product flow, while the old manual prompt/skill README is archived in `OLD_README.md`.
- 2026-07-02: Claude button placement no longer shifts native action clusters. It now restores old transform reservations on startup and places Cap-Context beside Claude's action row, so the attach plus and sidebar/project controls stay untouched.
- 2026-07-02: Claude placement now anchors Cap-Context to the right side of the voice mode control when safe, then falls back to a collision-checked composer overlay slot. This replaces the generic rightmost action-row anchor that could crowd the mic and voice controls.
- 2026-07-02: Claude placement now deliberately creates an inline row slot by shifting the right-side composer controls left and placing Cap-Context after voice mode. This replaces the above-row collision fallback that made the bubble float near the upper-right of the composer.
- 2026-07-05: Long-chat scraping now avoids broad conversation wrappers swallowing their child message turns. Source capture also waits for turn count, character count, and scroll height to stabilize, and safely clicks in-chat `Show more`/reading expanders before final scrape. This replaced count-only stabilization, which could stop while older messages or hidden characters were still loading.
- 2026-07-05: Claude long-chat scraping had a second wrapper bug: explicit-looking wrapper chunks, such as assistant/message-labeled containers, could still beat their many loaded child turns. The wrapper detector now treats explicit containers as broad when they contain multiple nested real turns, so a 12-wrapper/78-child-turn DOM captures all 78 loaded turns.
- 2026-07-05: Claude virtualized long-chat capture now runs a bounded instant-scroll sweep only when the rendered Claude window already looks long. It collects each rendered window, dedupes overlapping turns, stops after fixed scroll/stale limits, and starts destination prep as soon as real source turns exist so destination loading overlaps the longer scrape. Short Claude chats keep the fast one-shot path.
- 2026-07-05: The bounded virtualized-chat sweep now applies to ChatGPT, Gemini, Grok, and DeepSeek too, using the same long-rendered-chat gate as Claude. Short chats on every supported platform still skip the sweep and use the fast one-shot scraper.
- 2026-07-05: ChatGPT scraping needed broader scroll-root discovery. The sweep now also considers large visible main/chat/overflow scroll containers, not only scrollable ancestors of message nodes, so ChatGPT-style app scroll roots can move even when rendered turns sit in a separate subtree.
- 2026-07-02: Claude's limit nudge is now dismissed for the current visible limit banner after the user clicks the bubble/nudge or focuses the composer. This replaces the repeated re-show behavior caused by Claude's own limit banner remaining visible.
- 2026-07-02: Claude inline placement is now model-safe and adaptive. The normal row uses no native shift, keeping `Sonnet 5 Medium` visible; only crowded mic/voice/send-side controls shift by the exact overflow amount. This replaces the fixed 140px lane that could collapse or hide Claude's model selector.
- 2026-07-02: Claude row spacing got a tiny rightward tune: the post-voice bubble gap is 28px and the right clamp is 4px. This keeps the model-safe adaptive behavior but makes the mic, voice mode, and Cap-Context bubble breathe a little more like the accepted screenshot.
- 2026-07-02: Claude row spacing now adds tiny visual row nudges: model selector 34px left, mic/voice/send-side controls 20px right equally. This is a surgical spacing tweak on top of the existing composer-relative overlay, not a new placement strategy.
- 2026-07-03: Claude model-label clipping from the left nudge is fixed by temporarily setting overflow visible on the model control and its nearby wrappers, with stale overflow reservations restored on reload. This keeps the Sonnet text visible while the nudge amount is tuned.
- 2026-07-03: Claude mic/voice spacing was balanced by increasing their equal right nudge to 20px and reducing the voice-to-bubble gap to 20px. This keeps Cap-Context in the same general slot while making the row spacing more even.
- 2026-07-03: Claude mic/voice controls now move 44px right while the voice-to-Cap-Context gap tightens to 4px. This uses the empty space before the purple button so the mic no longer sits on top of the Sonnet model label.
- 2026-07-03: Claude final row balance moved Cap-Context 8px right by using a 12px post-voice gap, and moved the model selector 8px left with a 42px model nudge. Mic and voice stayed at the accepted 44px right nudge.
- 2026-07-03: Claude mic, voice, and Cap-Context were all nudged right again: mic/voice now use a 52px right nudge and Cap-Context uses a 20px post-voice gap. The model selector stays at the 42px left nudge.
- 2026-07-03: Claude final-small nudge moved only Cap-Context 6px right and the model selector 6px left. The accepted mic/voice 52px right nudge stayed unchanged.
- 2026-07-03: Claude purple-only correction moved Cap-Context 4px left by reducing the post-voice gap to 22px. Sonnet, mic, and voice placement stayed unchanged.
- 2026-07-03: Claude purple-only final correction moved Cap-Context 2px right to a 24px post-voice gap. Sonnet, mic, and voice stayed unchanged.
- 2026-07-03: Claude purple-only plus-four correction moved Cap-Context 4px right to a 28px post-voice gap. Sonnet, mic, and voice stayed unchanged.
- 2026-07-03: Claude purple-only plus-six correction moved Cap-Context 6px right to a 34px post-voice gap. Sonnet, mic, and voice stayed unchanged.
- 2026-07-03: Claude purple-only plus-twelve correction moved Cap-Context 12px right to a 46px post-voice gap. Sonnet, mic, and voice stayed unchanged.
- 2026-07-03: Gemini placement now anchors Cap-Context to the left of the visible `Flash` model selector before falling back to the old rightmost-action anchor. This replaces the mic-based placement that put the bubble between `Flash` and the mic.
- 2026-07-03: Summarization quality was upgraded from `ministral-3b-2512`/650 tokens to `mistral-large-2512`/900 tokens, with prompt guidance targeting 650-750 useful words and longer backend timeouts. This intentionally favors richer transported context over the previous tiny-model speed setting.
- 2026-07-03: Single-transfer quality became the priority over repeated fast transfers. The source conversation cap increased from 80k to 160k characters, default output increased from 900 to 1200 tokens, and the backend prompt now demands a dense continuation handoff with concrete implementation details instead of a thin generic summary.
- 2026-07-03: Follow-up quality pass changed the summary target from short/rich to explicitly 1200 words. Default output rose from 1200 to 2200 tokens, Mistral timeout rose to 50 seconds, extension backend timeout rose to 60 seconds, Vercel maxDuration was set to 60 seconds, and tests now verify that a 160k-character conversation is forwarded to Mistral and reported as `inputChars: 160000`.
- 2026-07-03: Live production probes after manual Vercel deploy confirmed the full 160k input reached Mistral, but prompt-only/template-budget fixes still produced only about 713-763 words. The backend now enforces quality with a second expansion pass when substantial summaries are under 1100 words, default output rose to 4200 tokens, extension backend timeout rose to 150 seconds, and Vercel maxDuration rose to 180 seconds.
- 2026-07-03: Final production probe after the expansion-pass deploy used a 160,000-character synthetic conversation and returned `inputChars: 160000`, `mistralPasses: 2`, `expansion.used: true`, `summaryWordCount: 1604`, `outputChars: 12066`, `mistralMs: 86217`, and about 88 seconds wall time. This proves the live endpoint can receive the full 160k payload and now expands short substantial summaries past the 1100-word floor.
- 2026-07-03: Long handoffs appeared to stall for about two minutes because the picker-open warm summary could take longer than its old 30 second freshness window. The destination click then awaited that in-flight warm summary, discarded it as expired after it finally returned, and started a second full backend summary before paste. Warm summaries now stay usable while in flight, resolved warm results are accepted once a destination click has claimed them, the completed warm-summary TTL is 180 seconds, the source overlay auto-reset is 240 seconds, and the background backend timeout is 190 seconds so it no longer aborts before the 180 second Vercel function ceiling.
- 2026-07-03: Summary speed was improved with adaptive backend profiles. Tiny chats now use a local direct Context Carry with the exact source text and no Mistral call. Small/medium chats use smaller output caps, one Mistral pass, and `ministral-3b-2512`; the `mistral-large-2512` 1,200-word plus expansion path is reserved for large conversations over 60k characters.
- 2026-07-03: Live production probe after the tiny direct-carry deploy returned `profile: tiny`, `model: local-direct`, `mistralMs: 0`, `mistralPasses: 0`, `summaryWordCount: 148`, and 969ms wall time for a 284-character chat. The same probe shape for a 14,220-character medium chat returned `model: ministral-3b-2512`, `summaryWordCount: 462`, `mistralMs: 7074`, and 7.6 seconds wall time.
- 2026-07-05: Added the latest-run analysis page at `/analysis`, backed by one privacy-safe `chrome.storage.local` transfer receipt and a GitHub Pages bridge content script. Backend timing now forwards Mistral token usage, including aggregate usage across expansion passes.
- 2026-07-05: Picker-started transfers now show the handoff popup, instantly scroll the source chat to the top, and then scrape using the existing retry window. The analysis page also shows detected vs captured/sent message turns from the existing scrape metrics.
- 2026-07-05: Reused warm summaries now carry their saved backend timing into the final transfer trace before `summary reused` is logged. This keeps Last Run model/profile/backend input/output/word-count fields populated for completed warm-summary reuse transfers.
- 2026-07-05: Source top-scroll now waits for detected message-turn count to stabilize before scraping. A real extension long-chat check with delayed older-message loading captured 24/24 turns in Last Run after the scroll.
- 2026-07-06: Mistral model selection is now routed by sent conversation size when `MISTRAL_MODEL` is unset: `ministral-3b-2512` at or below 20,000 characters and `mistral-large-2512` above 20,000. The summary profile thresholds stayed unchanged, so medium chats over 20,000 characters keep medium token/evaluation settings while using the stronger model.
- 2026-07-06: Groq is now a backup provider for generated summaries. If the primary Mistral attempt errors, times out, rate-limits through retries, returns invalid JSON, or normalizes to an empty summary, the backend retries the same prompt/profile with Groq `llama-3.1-8b-instant` when `GROQ_API_KEY` is configured and records `servedBy` plus fallback metadata.
- 2026-07-07: Production was still serving the old medium-profile `ministral-3b-2512` code even after the 20,000-character routing patch was pushed. A clean Vercel production deploy of commit `4f922b1` re-aliased `context-generator-five.vercel.app`; a live 20,001-character probe then returned `model: mistral-large-2512`, `servedBy: mistral`, and `modelReason: inputChars 20001 > threshold 20000`.
- 2026-07-10: Generated summaries now use one fixed Mistral priority chain for every non-tiny transfer: `mistral-medium-2604`, then `mistral-large-2512`, then `ministral-3b-2512`, then the existing Groq `llama-3.1-8b-instant` fallback. This replaces size-based routing and takes precedence over `MISTRAL_MODEL`; the tiny local-direct path and all summary profiles remain unchanged.
- 2026-07-10: The latest-run receipt now preserves `mistralModelsTried`, and the analysis page shows a `Fallback log` with the failed model chain and the model that served. The obsolete 20,000-character model-route display and backend threshold metadata were removed; old saved receipts show a prompt to run a fresh transfer instead.
- 2026-07-10: `master` is the sole canonical production branch. The stale `main` branch had no unique commits and was deleted, then the Vercel `context-generator` Git integration was reconnected so its production branch changed from `main` to `master`. Future pushes should deploy directly to production instead of creating master-only previews.
- 2026-07-10: The analysis page displays `mistral-medium-2604` as its public model name, `mistral-medium-3-5`, in the Model card, Primary model receipt row, and fallback log. Backend requests and stored diagnostics keep the exact API snapshot ID.
- 2026-07-10: The destination-sheet visual redesign was reverted at the user's request, restoring the exact compact picker UI from before `971827f` while leaving transfer behavior and all unrelated work unchanged. `extension/chrome.zip` remains available locally but is no longer tracked or deployed.
- 2026-07-10: Measured whole-flow speed work targeted the actual bottlenecks from Brave receipts. Claude sweep termination changed from eleven repeated 1.6-second no-progress waits to one full terminal quiet check while retaining moving/delayed-batch retries; scroll roots and rendered snapshots are reused during capture; destination loading starts before source stabilization; sweep-eligible picker captures no longer launch a partial summary that will be discarded; Mistral expansion now reuses an identical cached prompt prefix plus predicted draft output; timeout/rate-limit retries are bounded. The full platform fixture runtime fell from about 120 seconds to 44 seconds with all captured-turn assertions intact.
- 2026-07-11: Capture accuracy hardening removed the 160,000-character head/tail truncation, preserves separate identical turns, replaces loose `you`/`me` author guessing with platform/DOM role evidence, merges virtualized windows by positional overlap instead of global text identity, and removes broad page-text fallback capture. Regression tests cover full middle preservation, duplicate turns, role-bearing ancestors, and exclusion of unrelated `main` content.
- 2026-07-11: Removed warm summary completely. Opening the picker is now UI-only and cannot scrape or call the backend; capture and the single summary request start only after the user selects a destination. Destination-tab preloading, full capture, provider fallback, handoff UI, background request dedupe, and the short exact-summary cache remain unchanged.
- 2026-07-11: Removed the large-profile expansion pass. Large summaries still target about 1,200 words with the same 4,200-token first-pass budget, but a short first result is returned immediately instead of sending the full conversation and draft through a second provider request. Word-count and quality-floor metadata remain passive diagnostics for analysis compatibility.
- 2026-07-11: Added deterministic Context Carry validation before normalization. It checks required ordered sections, meaningful important-section content, the exact confirmation step, profile-derived low minimum length, real body content, and obvious API-error/refusal output without a separate evaluation-model request. Invalid output now advances through the existing fallback chain, while the normalizer no longer fabricates missing sections or disguises free-form text as valid context.
- 2026-07-11: Bounded the full Medium -> Large -> Ministral -> Groq provider chain to about 135 seconds using per-model total budgets, so later fallbacks remain reachable below Vercel's 180-second ceiling even when earlier providers stall. The extension now makes one 150-second backend request instead of replaying the entire expensive job. `memory.md` remains local but is ignored and removed from current Git tracking.
- 2026-07-11: Hardened the public summary endpoint with extension-scheme-only CORS, a public compatibility marker, strict method/content-type/schema checks, a 160,000-character canonical backend limit, instance-local IP burst/hour/concurrency limits, bounded safe errors, and no raw provider-response logging. Captured transcripts now reach providers only inside an explicitly untrusted JSON data envelope. Privacy tests confirm picker open/close and destination preconnection never include chat content; obsolete warm-summary and fingerprint paths remain absent.
