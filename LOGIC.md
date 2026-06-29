# Extension Logic

This document explains how the Chrome extension works right now. It is written for future Codex sessions so the existing behavior can be understood without rebuilding it from scratch.

## Files Involved

- `extension/manifest.json` registers the extension, host permissions, the background service worker, and the shared platform content script on all supported AI sites.
- `extension/background.js` coordinates tab creation, content script injection, backend summarization, badge state, and messages between pages.
- `extension/platform-content.js` owns the Cap Context button, destination picker, conversation scraping, backend summary request, destination paste, and destination auto-send behavior for every supported platform.
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

The platform content script guards against double loading with `window.__contextGeneratorPlatformLoaded`. It also has an `isRunning` lock and a 60 second auto-reset timer so two transfers do not run at the same time forever.

## How The Button Is Placed

`platform-content.js` uses one placement system for Claude, Gemini, and Grok, with platform-specific stable composer-row placement for ChatGPT and DeepSeek. Each platform has input selectors for its editor.

The script watches the page with a `MutationObserver`, plus listeners for resize, visibility changes, and focus changes. When the AI page changes its DOM, the script schedules one `requestAnimationFrame` update. It ignores mutations caused by the extension's own button, overlay, fallback modal, and destination sheet so it does not chase itself.

To find the input, the script uses the current platform's editor selectors first, then fallback selectors. Candidates are scored by whether they are textarea/input/contenteditable elements, whether they are inside a form, whether their labels mention message/prompt/chat/write/ask/input, whether they are wide enough, and whether they are near the bottom of the viewport. Top-of-page candidates are penalized.

After it finds the input, it searches for a composer surface: a parent element that wraps the input and has a reasonable composer-like size. ChatGPT, Gemini, and DeepSeek also have platform-specific composer selectors so the button anchors to their rounded input bars instead of a page-wide app container. Oversized ancestors are rejected before placement. If no good parent is found, it falls back to the form or the direct parent.

The floating button is a 42px absolute-positioned button with `bubble-icon.png` inside it. The script appends the button inside the composer surface, not directly to `body`. If the composer surface has static positioning, the script temporarily changes it to `position: relative` and remembers the original inline position value so it can restore it later.

For Claude, Gemini, and Grok, the button sits on the right side of the composer. The script tries to find the platform's right-side action button cluster by scanning visible buttons inside or near the composer. If it finds that cluster, it shifts the cluster left by the bubble slot width so the Cap Context button has room. It only shifts a real control cluster or button, never the whole composer. It remembers the original transform on the shifted cluster and restores it if the input disappears or the anchor changes.

Clicking the button opens a destination picker titled `Where to continue?`. The picker lists all supported platforms except the current one, and its helper line is always `Context goes straight into the input box`. Each tile starts the same backend summary flow, then opens the selected platform, pastes the summary, and auto-clicks Send.

## Composer Placement Strategy

ChatGPT and DeepSeek intentionally do not use the shared native-control shifting path. Their composers re-render and resize often, so moving their native action clusters with `transform` can cause flicker, jumping, or broken-looking UI.

For ChatGPT, `updateFloatingButtonPosition()` calls the ChatGPT-specific placement branch before `findComposerActionButton()`. That branch releases any old reserved action slot, finds the bottom-right composer row's intelligence/model selector (`Instant`, `Medium`, or `High`), and mounts the Cap Context button as an inline sibling immediately to the left of that selector. The inline mount must land in a real visible control row; if it is clipped or cannot be verified, the script falls back to absolute placement beside the same selector. It never shifts ChatGPT's own controls.

For DeepSeek, `updateFloatingButtonPosition()` calls the DeepSeek-specific branch before the shared placement path. It scans the bottom-right action row using `button`, `[role='button']`, and `[tabindex='0']` candidates, places Cap Context to the left of the pin/attachment control, and falls back to a fixed bottom-right action-row slot if DeepSeek's controls are not detectable. It never falls back to the old top-right shared placement.

Composer scoring also gives ChatGPT and DeepSeek a bonus for candidates that include the lower action row and penalizes tiny inner text-area wrappers. This keeps the bubble anchored to the full rounded composer instead of a smaller editor child.

## How Conversation Scraping Works

The scraper runs before the overlay is shown, so extension UI text is not included in the backend input.

Each platform has its own likely conversation selectors. Examples include Claude response/user-message selectors, ChatGPT `data-message-author-role` conversation turns, Gemini user/model response elements, Grok message elements, and DeepSeek markdown/message elements.

For each candidate element, the script skips extension-owned nodes, reads `innerText` or `textContent`, cleans whitespace, and assigns a rough role:

- `User` when metadata mentions user, human, you, me, or query.
- The current platform name when metadata mentions assistant, model, response, Claude, ChatGPT, Gemini, Grok, DeepSeek, or bot.
- `Message` otherwise.

Candidates are sorted in document order. Nested duplicates and identical text duplicates are removed. If at least two useful turns are found, the transcript becomes blocks like:

```text
User: ...

Claude: ...
```

The transcript is prefixed with the source platform name, such as `Gemini conversation:`.

If structured message scraping does not produce a useful transcript, the fallback reads visible text from `main`, then conversation-looking containers, then chat-looking containers. Empty start screens are rejected so the extension does not send sidebar, placeholder, or landing-page text to Mistral.

When no useful chat text exists, the transfer stops before calling the backend and shows a polished in-page error: `No text to summarize yet`. The message tells the user the chat is still a blank canvas and to send a message first.

The backend conversation input is capped at 180,000 characters. If the page text is longer than that, the script keeps the first 40,000 characters and the last 140,000 characters, with an omission marker in the middle.

## How Summary Generation Works

There is one summary path: Vercel/Mistral backend summarization. The extension never asks the source AI to summarize. It does not inject prompts into Claude, ChatGPT, Gemini, Grok, or DeepSeek.

When a transfer starts, `platform-content.js` scrapes the current platform conversation, shows the `Summarizing with Mistral...` overlay, and sends `SUMMARIZE_WITH_BACKEND` to the background worker with the scraped conversation text.

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

For valid requests, it calls Mistral's chat completions endpoint:

```text
https://api.mistral.ai/v1/chat/completions
```

The model is `mistral-small-latest` and temperature is `0.2`.

The system prompt tells Mistral to summarize the conversation for another AI assistant and to return the context-carry structure. The user message contains the scraped conversation text.

The function returns the first choice message content as:

```json
{ "summary": "..." }
```

Mistral API failures return 502. Empty Mistral summaries return 502. Unexpected server errors return 500.

## How Context Transfer Works

After the backend summary returns text, `platform-content.js` sends `TRANSFER_TO_DESTINATION` to the background worker with the selected destination id and summary text.

The background worker validates the destination, opens the destination URL in a new active tab, waits for the tab status to become complete, injects `platform-content.js`, and sends that tab a `PASTE_CONTEXT` message.

The destination tab receives `PASTE_CONTEXT`, finds the destination input with that platform's input selectors, and writes the summary into the editor.

For textarea/input editors, it uses the native value setter and dispatches input/change events.

For contenteditable editors, it targets the first paragraph if one exists, otherwise the editor itself. It selects the current contents, calls `document.execCommand("insertText")`, retries with select-all if needed, and falls back to assigning `textContent` if insertion still fails. It dispatches input and change events afterward so React/ProseMirror-style editors notice the update.

After pasting, it verifies that the first 20 characters of the summary are present in the editor. If verification fails, it shows an "Auto-paste failed" modal with a copy button and returns an error to the background worker.

Once paste verification passes, it waits up to 10 seconds for an enabled Send button. It searches platform-specific send selectors, then buttons in the input/composer area, then visible page buttons. It ignores disabled buttons and obvious non-send controls such as Stop, Cancel, Attach, Upload, Voice, Mic, New, and Menu. It accepts buttons whose metadata mentions send/submit or enabled submit buttons.

When it finds the send button, it clicks it automatically. This auto-send behavior applies to all five platforms as destinations.

## Badges, Overlays, And Error Handling

The background worker sets the extension badge to:

- `RUN` when the extension icon successfully starts a transfer.
- `OK` after a destination paste/send succeeds.
- `ERR` for transfer errors.

The source page shows a small overlay above the floating button while work is running. It displays `Summarizing with Mistral...`.

If the source-side flow throws, the script resets the running flag, hides the overlay, shows a red "Transfer Failed" overlay on the source page, and notifies the background worker.

If destination paste or send fails, the destination page shows a manual copy modal with the summary.

## Tricky Parts

- Each AI platform has a different editor DOM, so input detection is platform-specific but still scored generically.
- The floating button has to live inside each platform's composer so it tracks the input, but it also has to reserve space by shifting the native action cluster left.
- The MutationObserver would loop forever if it reacted to its own UI. The script marks owned nodes and ignores mutations that are only caused by the extension.
- Conversation scraping is best-effort. It tries structured message turns first, then falls back to page text when a platform changes its markup.
- Programmatic pasting into modern AI editors is finicky. The script uses native setters, `execCommand("insertText")`, retries, direct `textContent` fallback, and synthetic input/change events.
- Auto-send is also heuristic. The script waits for an enabled send/submit control and avoids obvious non-send controls, but platform UI changes can still require selector updates.
- Scraping intentionally happens before the overlay is shown, so extension overlay text is not sent to Mistral.
