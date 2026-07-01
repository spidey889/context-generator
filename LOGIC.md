# Extension Logic

This document explains how the Chrome extension works right now. It is written for future Codex sessions so the existing behavior can be understood without rebuilding it from scratch.

## Files Involved

- `extension/manifest.json` registers the extension, host permissions, the background service worker, and the shared platform content script on all supported AI sites.
- `extension/background.js` coordinates tab creation, content script injection, backend summarization, badge state, and messages between pages.
- `extension/platform-content.js` owns the Cap Context button, destination picker, conversation scraping, backend summary request, and destination paste behavior for every supported platform.
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

The browser action uses a default destination because it does not open the destination picker. If the source tab is ChatGPT, it sends to Claude. Otherwise it sends to ChatGPT. The in-page Cap Context button is the normal way to choose any of the other four destinations.

When the extension service worker starts, installs, or reloads, it attempts to inject `platform-content.js` into already-open supported AI tabs. This helps unpacked-extension development reloads replace stale content scripts without requiring every AI tab to be manually refreshed.

The platform content script guards against double loading with `window.__contextGeneratorPlatformLoaded`. It also has an `isRunning` lock and a 60 second auto-reset timer so two transfers do not run at the same time forever.

Because unpacked extension reloads can leave an old content script running in already-open AI tabs, the guard uses a versioned load id instead of a plain boolean. A fresh script can replace stale extension UI nodes instead of being blocked by the old page-level flag. Extension asset URLs are cached at startup, so delayed UI creation does not call `chrome.runtime.getURL()` after Chrome has invalidated the old extension context. Placement monitoring no longer attaches listeners directly to the chat input; the MutationObserver, resize, visibility, and focus listeners are enough to keep the button positioned without leaving input listeners from stale scripts behind.

When button placement behavior changes, bump `CONTENT_SCRIPT_LOAD_ID`. Otherwise an already-open AI tab can keep the old injected script and continue showing the old placement bug even though the file on disk has been fixed.

## How The Button Is Placed

`platform-content.js` uses one placement system for Claude and Gemini, with platform-specific placement for ChatGPT, Grok, and DeepSeek. Each platform has input selectors for its editor.

The script watches the page with a `MutationObserver`, plus listeners for resize, visibility changes, and focus changes. When the AI page changes its DOM, the script schedules one `requestAnimationFrame` update. It ignores mutations caused by the extension's own button, overlay, fallback modal, and destination sheet so it does not chase itself.

To find the input, the script uses the current platform's editor selectors first, then fallback selectors. Candidates are scored by whether they are textarea/input/contenteditable elements, whether they are inside a form, whether their labels mention message/prompt/chat/write/ask/input, whether they are wide enough, and whether they are near the bottom of the viewport. Top-of-page candidates are penalized.

After it finds the input, it searches for a composer surface: a parent element that wraps the input and has a reasonable composer-like size. ChatGPT, Gemini, and DeepSeek also have platform-specific composer selectors so the button anchors to their rounded input bars instead of a page-wide app container. Oversized ancestors are rejected before placement. If no good parent is found, it falls back to the form or the direct parent.

The floating button is a 42px button with `bubble-icon.png` inside it. For Claude, Gemini, Grok, and DeepSeek, the script appends the button inside the composer surface. If the composer surface has static positioning, the script temporarily changes it to `position: relative` and remembers the original inline position value so it can restore it later.

ChatGPT is the exception. Its Cap Context button is mounted on the page root and uses `position: fixed`, because ChatGPT's composer wrappers re-render, clip unknown children, and sometimes do not expose a stable composer surface during hydration.

For Claude and Gemini, the button sits on the right side of the composer. The script tries to find the platform's right-side action button cluster by scanning visible buttons inside or near the composer. If it finds that cluster, it shifts the cluster left by the bubble slot width so the Cap Context button has room. It only shifts a real control cluster or button, never the whole composer. It remembers the original transform on the shifted cluster and restores it if the input disappears or the anchor changes.

Clicking the button opens a destination picker titled `Where to continue?`. The picker lists all supported platforms except the current one, and its helper line is always `Context goes straight into the input box`. Destination tiles keep neutral edges at rest with only a tiny static platform-color glow tucked behind the logo, extending just past it; hover/focus expands that accent into the real platform-colored border, haze, and shine. Opening the picker also starts a silent warm summary after the sheet has rendered. It does not show the handoff popup and does not inject any prompt into the source AI. The warm summary is only reused if the user clicks a tile soon after and the current scraped chat still matches; otherwise it is discarded and the transfer falls back to a fresh summary. Each tile immediately opens and warms the selected platform tab in the background, shows a compact centered source-page handoff popup, starts or reuses the backend summary flow in parallel, then pastes the summary into the already-open destination input. After paste succeeds, the background worker focuses the destination tab. The user manually reviews and sends it.

The first time the Cap Context bubble appears on a supported platform, the content script can show a small onboarding nudge near the bubble. It uses CSS-only animated helper art that points at the button and explains that the bubble carries the useful context into another AI's input for review. The nudge is marked as extension-owned DOM, is excluded from scraping, hides when the picker opens, and stores a `localStorage` dismissed flag after the user clicks the bubble or the nudge's `OK` button.

## Composer Placement Strategy

ChatGPT, Grok, and DeepSeek intentionally do not use the shared native-control shifting path. Their composers re-render and resize often, so moving their native action clusters with `transform` can cause flicker, jumping, or broken-looking UI.

For ChatGPT, `ensureFloatingButton()` and `updateFloatingButtonPosition()` take the ChatGPT-specific branch before the normal composer-surface path. That branch releases any old reserved action slot, releases any old reserved composer surface, appends the button to the page root, and switches it to fixed positioning. It then scans the page for the bottom-right intelligence/model selector (`Instant`, `Medium`, or `High`) and places Cap Context immediately to the left of that selector. If the selector cannot be detected yet, it falls back to the composer/form/input rectangle and clamps the button inside the viewport. This means the button still appears while ChatGPT is hydrating or reshuffling its composer DOM.

For Grok, `updateFloatingButtonPosition()` also takes a platform-specific branch before the shared placement path. It first looks for Grok's speed/mode selector (`Fast`, `Auto`, `Expert`, `Think`, or similar) and places Cap Context immediately to the left of that selector, matching the ChatGPT-style model-selector placement. It explicitly avoids send, mic, microphone, and voice controls so the button does not land on top of Grok's audio buttons. If the selector cannot be detected, it falls back to a safe slot farther left inside the composer. It always releases any reserved action slot and never shifts Grok's native controls, because transforming Grok's action row can trigger visible flicker.

For DeepSeek, `updateFloatingButtonPosition()` calls the DeepSeek-specific branch before the shared placement path. It scans the bottom-right action row using `button`, `[role='button']`, and `[tabindex='0']` candidates, places Cap Context to the left of the pin/attachment control, and falls back to a fixed bottom-right action-row slot if DeepSeek's controls are not detectable. It never falls back to the old top-right shared placement.

Composer scoring also gives ChatGPT and DeepSeek a bonus for candidates that include the lower action row and penalizes tiny inner text-area wrappers. This keeps the bubble anchored to the full rounded composer instead of a smaller editor child.

## ChatGPT Button Fix, June 29 2026

The broken behavior was that the ChatGPT button stopped appearing after several placement changes. Earlier fixes were still trying to make the button live inside, or depend on, ChatGPT's composer surface. That was fragile for three reasons:

- ChatGPT's current UI can render the `Instant`/`High` model selector in a wrapper that is not always inside the composer surface candidate chosen by our scorer.
- If `findComposerSurfaceElement()` returned no good surface, the old code hid the button before the ChatGPT-specific fallback logic had a chance to run.
- During unpacked-extension development, stale already-injected scripts could leave old Cap Context DOM behind or keep an old page-level load flag, so the new script needed to fully replace old extension-owned nodes on load.

The working fix is:

- Use a versioned content-script load id and always remove old Cap Context UI nodes before a fresh script starts.
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

When no useful chat text exists, the transfer stops before opening/preparing a destination tab or calling the backend and shows a polished in-page error: `Nothing to carry yet`. The message nudges the user to send something first.

The backend conversation input is capped at 80,000 characters to keep handoffs fast. If the page text is longer than that, the script keeps the first 16,000 characters and the recent tail, with an omission marker in the middle.

## How Summary Generation Works

There is one summary path: Vercel/Mistral backend summarization. The extension never asks the source AI to summarize. It does not inject prompts into Claude, ChatGPT, Gemini, Grok, or DeepSeek.

When the destination picker opens, `platform-content.js` lets the sheet render, then immediately starts a silent warm summary request on the next timer tick. The warm result is short-lived and keyed to a lightweight conversation fingerprint, so chat changes or time passing make it unusable.

When a transfer starts, `platform-content.js` shows a compact centered handoff popup on the source page with a randomized short line and an animated status line such as `Summarizing context`, `Compacting the useful bits`, and `Preparing ChatGPT`. It uses the warm summary only if its fingerprint still matches. If the warm summary is missing, stale, failed, or not ready, the transfer uses the normal fresh `SUMMARIZE_WITH_BACKEND` path. The background worker retries transient backend failures before reporting an error to the source page.

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

If the backend request fails or returns no summary, the transfer fails and the extension shows an error.

## How The Vercel/Mistral Backend Works

`api/summarize.js` is a Vercel serverless function. It allows CORS from any origin, handles `OPTIONS`, only accepts `POST`, and requires `MISTRAL_API_KEY` from the environment.

It accepts either an already-parsed body or a string body. Bad JSON returns 400. Missing or non-string `conversation` returns 400. Missing `MISTRAL_API_KEY` returns 500.

For valid requests, it calls Mistral's chat completions endpoint with a short timeout and limited retry/backoff for transient rate-limit, server, and network failures:

```text
https://api.mistral.ai/v1/chat/completions
```

The model is `mistral-small-latest`, temperature is `0.2`, and output is capped so long generations do not make the handoff feel stuck.

The system prompt tells Mistral to summarize the conversation for another AI assistant and to return the context-carry structure. The user message contains the scraped conversation text.

The function returns the first choice message content as:

```json
{ "summary": "..." }
```

Mistral API failures return 502 after retryable attempts are exhausted. Empty Mistral summaries return 502. Unexpected server errors return 500.

## How Context Transfer Works

After the backend summary returns text, `platform-content.js` sends `TRANSFER_TO_DESTINATION` to the background worker with the selected destination id, summary text, and the pre-opened destination tab id when one exists.

The background worker validates the destination, opens the destination URL immediately in a background tab for destination-picker clicks, then starts injecting `platform-content.js` and retrying the `PASTE_CONTEXT` message without waiting for the whole page to report `complete`. Grok is the exception: the worker focuses Grok before paste because its composer is much faster and more reliable when the tab is foregrounded. If no pre-opened tab exists, if that tab disappears, or if the pre-opened tab replies with a paste failure, it falls back to creating a fresh destination tab and tries the paste again. After paste succeeds, it activates the destination tab and focuses its window. The same retry delivery helper is used when the extension icon starts a source-side transfer, so a hydrated page that has not attached the content-script listener yet does not fail immediately.

The destination tab receives `PASTE_CONTEXT`, finds the destination input with that platform's input selectors, and writes the summary into the editor.

For textarea/input editors, it uses the native value setter and dispatches input/change events.

For contenteditable editors, it targets the first paragraph if one exists, otherwise the editor itself. It selects the current contents, calls `document.execCommand("insertText")`, retries with select-all if needed, and falls back to assigning `textContent` if insertion still fails. It dispatches beforeinput, input, and change events afterward so React/ProseMirror-style editors notice the update.

After pasting, it verifies that a normalized leading sample of the summary is present in the editor. If verification fails, it shows an "Auto-paste failed" modal with a copy button and returns an error to the background worker.

Once paste verification passes, the flow stops. It does not search for Send buttons, click Send, submit forms, or press Enter on any destination platform. The pasted summary stays in the input box for the user to review and send manually.

## Badges, Overlays, And Error Handling

The background worker sets the extension badge to:

- `RUN` when the extension icon successfully starts a transfer.
- `OK` after a destination paste succeeds.
- `ERR` for transfer errors.

The source page shows the compact centered handoff popup while picker-started transfer work is running. The popup cycles through short status lines so the wait feels active without prompting the source AI.

If the source-side flow throws, the script resets the running flag, hides the overlay, shows a red "Transfer Failed" overlay on the source page, and notifies the background worker.

If destination paste fails, the destination page shows a manual copy modal with the summary.

## Tricky Parts

- Each AI platform has a different editor DOM, so input detection is platform-specific but still scored generically.
- The floating button has to live inside each platform's composer so it tracks the input, but it also has to reserve space by shifting the native action cluster left.
- The MutationObserver would loop forever if it reacted to its own UI. The script marks owned nodes and ignores mutations that are only caused by the extension.
- Conversation scraping is best-effort. It tries structured message turns first, then falls back to page text when a platform changes its markup.
- Programmatic pasting into modern AI editors is finicky. The script uses native setters, `execCommand("insertText")`, retries, direct `textContent` fallback, and synthetic beforeinput/input/change events.
- Destination transfer is paste-only. The script intentionally avoids all automatic send/submit/Enter behavior after the summary reaches the input box.
- Scraping intentionally happens before the overlay is shown, so extension overlay text is not sent to Mistral.
- After reloading the unpacked extension, already-open AI tabs may still have a stale content script. The script avoids crashing on delayed asset URL lookups and shows a refresh-this-tab error if a runtime message hits an invalidated extension context.
