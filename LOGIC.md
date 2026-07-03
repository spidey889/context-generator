# Extension Logic

This document explains how the Chrome extension works right now. It is written for future Codex sessions so the existing behavior can be understood without rebuilding it from scratch.

## Files Involved

- `extension/manifest.json` registers the extension, host permissions, the background service worker, and the shared platform content script on all supported AI sites.
- `extension/background.js` coordinates tab creation, content script injection, backend summarization, badge state, and messages between pages.
- `extension/platform-content.js` owns the Cap-Context button, destination picker, conversation scraping, backend summary request, and destination paste behavior for every supported platform.
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

Clicking the button opens a destination picker titled `Where to continue?`. The picker lists all supported platforms except the current one, and its helper line is always `Context goes straight into the input box`. The `Cap-Context` pill in the sheet header keeps the subtle light border hidden at rest and shows it only on hover/focus. Destination tiles keep neutral edges at rest with only a tiny static platform-color glow tucked behind the logo, extending just past it; hover/focus keeps the small scale-up motion but no longer adds platform-color border lighting, haze, or shine. The same click that opens the picker immediately starts a silent warm summary before the sheet is built or animated. It does not show the handoff popup and does not inject any prompt into the source AI. The warm summary is only reused if the user clicks a tile soon after and the current scraped chat still matches; otherwise it is discarded and the transfer falls back to a fresh summary. Each tile immediately opens and warms the selected platform tab in the background, shows a compact centered source-page handoff popup, starts or reuses the backend summary flow in parallel, then pastes the summary into the already-open destination input. After paste succeeds, the background worker focuses the destination tab. The user manually reviews and sends it.

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

The scraper runs before the overlay is shown, so extension UI text is not included in the backend input.

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

If structured message scraping does not produce a useful transcript, the fallback reads visible text from `main`, role-main, conversation/chat/thread/message-list containers, and finally a combined set of detected message turns. The fallback only runs after at least one explicit role-backed turn was detected, so broad start-screen text cannot trigger a transfer by itself. It removes extension-owned UI text before measuring fallback content. Empty start screens are rejected so the extension does not send sidebar, placeholder, or landing-page text to Mistral.

When no detected message turns exist, user-triggered transfers now show the empty-chat error immediately instead of waiting through a DOM retry window. The empty-chat error is only for a detected message list length of 0; if message turns exist but the stricter transcript heuristics are uncertain, the scraper falls back to the detected turns instead of calling the chat empty. If no message turns are present, the transfer stops before opening/preparing a destination tab or calling the backend and shows a polished in-page error: `Nothing to carry yet`. The message nudges the user to send something first.

The backend conversation input is capped at 80,000 characters to keep handoffs fast. If the page text is longer than that, the script keeps the first 16,000 characters and the recent tail, with an omission marker in the middle.

## How Summary Generation Works

There is one summary path: Vercel/Mistral backend summarization. The extension never asks the source AI to summarize. It does not inject prompts into Claude, ChatGPT, Gemini, Grok, or DeepSeek.

When the destination picker opens, `platform-content.js` checks whether the click is opening or closing the sheet. For opening clicks, `scheduleWarmSummary()` immediately starts a silent warm summary before creating or animating the picker DOM. The warm result is short-lived and keyed to a lightweight conversation fingerprint, so chat changes or time passing make it unusable. The sheet-open click creates a transfer trace id used by the source page, service worker, and destination page so console logs can show the full timeline from click to paste.

When a transfer starts, `platform-content.js` shows a compact centered handoff popup on the source page with a randomized short line, an animated status line, and a subtle 20 second countdown pill. The handoff copy is intentionally patient and context-focused, such as `I don't like waiting 20 seconds either` and `This is for better context`, instead of destination-prep labels. It uses the warm summary only if its fingerprint still matches. If the warm summary is missing, stale, failed, or not ready, the transfer uses the normal fresh `SUMMARIZE_WITH_BACKEND` path. The background worker dedupes in-flight exact conversation summaries and keeps a tiny two-minute in-memory cache for repeated exact transfers before reporting an error to the source page.

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

`api/summarize.js` is a Vercel serverless function. It allows CORS from any origin, handles `OPTIONS`, only accepts `POST`, and requires `MISTRAL_API_KEY` from the environment.

It accepts either an already-parsed body or a string body. Bad JSON returns 400. Missing or non-string `conversation` returns 400. Missing `MISTRAL_API_KEY` returns 500.

For valid requests, it calls Mistral's chat completions endpoint with a short timeout and limited retry/backoff for transient rate-limit, server, and network failures:

```text
https://api.mistral.ai/v1/chat/completions
```

The summarizer model is fixed to `mistral-large-2512`. Temperature is `0.1`, and output is capped at `900` tokens by default through `MISTRAL_MAX_TOKENS` so the Context Carry block can preserve richer continuation details. The prompt now aims for about 650-750 useful words when the source conversation has enough real context, while still staying shorter for simple chats. The Mistral request timeout is 30 seconds and the extension backend timeout is 35 seconds so the larger model has room to finish instead of being cut off by the old speed-focused limits. The endpoint returns timing metadata with the summary, including total backend time, Mistral time, model, max tokens, input characters, and output characters.

The system prompt tells Mistral to summarize the conversation for another AI assistant and to return the exact `SKILL.md` Context Carry layout: the boxed `CONTEXT CARRY — READY TO PASTE` header, then the seven emoji section headings in order. The backend normalizes every returned summary into that boxed template, even if Mistral omits the box, uses plain headings, wraps the answer in a code fence, or drifts into free-form text. After parsing Mistral's output, the backend always overwrites the `🔁 NEXT STEP` section with `Reply only: "Context loaded. Let's pick up right where you left off." Then wait for the user.` so the destination AI briefly confirms context instead of giving a long response right away. The user message contains the scraped conversation text.

Before returning the summary to the extension, the backend strips any closing instructional footer that starts with `PASTE THIS AT THE TOP OF YOUR NEW CHAT` or `Continue from where we left off`, so the destination input only receives the clean context carry content.

The function returns the first choice message content as:

```json
{ "summary": "..." }
```

Mistral API failures return 502 after retryable attempts are exhausted. Empty Mistral summaries return 502. Unexpected server errors return 500.

## How Context Transfer Works

After the backend summary returns text, `platform-content.js` sends `TRANSFER_TO_DESTINATION` to the background worker with the selected destination id, summary text, and the pre-opened destination tab id when one exists. The transfer logs console timing marks for click, capture start/done, summary start/done, destination click, tab open start/done, tab ready/message response, destination input ready, paste request start, destination paste done, final activation, and total completion. These logs are intentionally verbose because transfer speed is product-critical and the next optimization should target the largest measured phase.

The background worker validates the destination, opens the destination URL immediately in a background tab for destination-picker clicks, then starts injecting `platform-content.js` and retrying the `PASTE_CONTEXT` message without waiting for the whole page to report `complete`. Extension-icon transfers also pre-open the default destination after capture succeeds, so destination loading overlaps backend summarization instead of waiting for the summary to finish. The destination picker adds preconnect links for the supported destination origins when it opens. Grok is the exception: the worker focuses Grok before paste because its composer is much faster and more reliable when the tab is foregrounded. If no pre-opened tab exists, if that tab disappears, or if the pre-opened tab replies with a paste failure, it falls back to creating a fresh destination tab and tries the paste again. After paste succeeds, it activates the destination tab and focuses its window. The same retry delivery helper is used when the extension icon starts a source-side transfer, so a hydrated page that has not attached the content-script listener yet does not fail immediately. The helper tries the tab message before reinjecting and uses a shorter retry interval, which avoids unnecessary script injection on tabs that are already ready.

Claude-to-ChatGPT is the priority transfer route. On Claude, conversation capture waits briefly for delayed message DOM before showing an empty-chat failure. On ChatGPT, the destination tab is focused before paste, gets a longer message/paste window, and uses a ChatGPT-specific paste path with paste-like events, `execCommand`, and direct DOM fallback. Paste verification uses stable text anchors such as `CONTEXT CARRY`, `WHO I AM`, and `WHAT WE WERE DOING`, so the transfer is not marked failed just because box drawing characters render differently in the editor.

The first ChatGPT paste after opening or reloading the extension is treated as unstable. ChatGPT can briefly expose a composer, accept inserted text, then clear that DOM during hydration. The background worker gives ChatGPT a tiny focus-settle delay before paste, and the destination content script requires pasted context to remain present for a short stability window before returning success. If the text is wiped, the same transfer retries paste instead of making the first user attempt look blank.

The destination tab receives `PASTE_CONTEXT`, finds the destination input with that platform's input selectors, and writes the summary into the editor.

For textarea/input editors, it uses the native value setter and dispatches input/change events.

For contenteditable editors, it targets the first paragraph if one exists, otherwise the editor itself. It selects the current contents, calls `document.execCommand("insertText")`, retries with select-all if needed, and falls back to assigning `textContent` if insertion still fails. It dispatches beforeinput, input, and change events afterward so React/ProseMirror-style editors notice the update.

After pasting, it verifies that a normalized leading sample of the summary is present in the editor. If verification fails, it shows an "Auto-paste failed" modal with a copy button and returns an error to the background worker. The source page also keeps the generated summary in scope during the transfer, so any destination/open/paste failure after summarization shows the same manual copy modal instead of only a generic transfer error.

Once paste verification passes, the flow stops. It does not search for Send buttons, click Send, submit forms, or press Enter on any destination platform. The pasted summary stays in the input box for the user to review and send manually.

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
- Scraping intentionally happens before the overlay is shown, so extension overlay text is not sent to Mistral.
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
