# Extension Logic

This document explains how the Chrome extension works right now. It is written for future Codex sessions so the existing behavior can be understood without rebuilding it from scratch.

## Files Involved

- `extension/manifest.json` registers the extension, host permissions, background service worker, Claude content script, ChatGPT content script, and generic destination content script.
- `extension/background.js` coordinates tab creation, content script injection, backend summarization, badge state, and messages between pages.
- `extension/claude-content.js` owns the Claude-side floating button, destination picker, Claude prompt flow, page scraping, context-limit fallback, and forced backend test mode.
- `extension/chatgpt-content.js` pastes the generated context into ChatGPT.
- `extension/ai-destination-content.js` pastes the generated context into Gemini, Grok, and DeepSeek.
- `api/summarize.js` is the Vercel serverless endpoint that calls Mistral.

## Startup And Extension Icon Flow

The manifest loads `claude-content.js` on `claude.ai`, `chatgpt-content.js` on ChatGPT/OpenAI hosts, and `ai-destination-content.js` on Gemini, Grok, and DeepSeek.

The background service worker also handles the browser action icon. When the user clicks the extension icon, the background worker checks that the active tab is a Claude tab. It injects `claude-content.js` again just in case the content script is not already present, then sends `START_CONTEXT_TRANSFER` to that tab. The icon flow always targets ChatGPT.

The Claude content script guards against double loading with `window.__contextGeneratorClaudeLoaded`. It also has an `isRunning` lock and a 60 second auto-reset timer so two transfers do not run at the same time forever.

## How The Button Is Placed In Claude

The Claude content script does not rely on one fixed Claude DOM selector. It continuously watches the page and recomputes placement.

It starts a `MutationObserver` on the document body, plus listeners for resize, visibility changes, and focus changes. When Claude's DOM changes, it schedules one `requestAnimationFrame` update. It ignores mutations caused by the extension's own button, overlay, and sheet so it does not chase itself.

To find the Claude input, it searches for visible textareas and contenteditable elements. Each candidate gets a score:

- Textareas and inputs get points.
- Elements inside a form get points.
- Labels/placeholders/classes mentioning message, prompt, chat, write, or ask get points.
- Wide elements near the lower half of the viewport get points.
- Elements near the top of the page are penalized.

After it finds the best input, it searches upward for the composer surface: a parent element that is wide enough, wraps the input, and has a reasonable composer-like height. If no good parent is found, it falls back to the form or direct parent.

The floating button is a 42px absolute-positioned button with `bubble-icon.png` inside it. The script appends the button inside the composer surface, not directly to `body`. If the composer surface has static positioning, the script temporarily changes it to `position: relative` and remembers the original inline position value so it can restore it later.

The button is placed on the right side of the composer. The script tries to find the right-side Claude action button cluster by scanning visible buttons inside or near the composer. If it finds that cluster, it shifts the cluster left by the bubble slot width so the extension button has room. It remembers the original transform on the shifted cluster and restores it if the input disappears or the anchor changes.

If a right-side action button is found, the bubble vertically aligns with that button. Otherwise it sits near the bottom-right of the composer. The destination picker sheet is a fixed-position panel that opens above the bubble when there is room, otherwise below it. The sheet position is locked while open so its animation does not jump during DOM updates.

Clicking the bubble opens a destination picker with ChatGPT, Gemini, Grok, and DeepSeek tiles. Shift-clicking a tile forces backend summarization for that one transfer.

## How The Conversation Is Scraped

The scraper lives in `claude-content.js` and is used by the Vercel/Mistral backend path. It runs before the extension injects the context-generator prompt, so the prompt and overlay are not included in the backend input.

The main scrape path looks for likely Claude message elements:

- Elements whose `data-testid` contains `user-message`.
- Elements whose `data-testid` contains `assistant-message`.
- Elements with `data-message-author-role`.
- Elements with Claude response class `.font-claude-response`.

It skips extension-owned nodes and skips the literal context-generator prompt. For each candidate it reads `innerText` or `textContent`, cleans non-breaking spaces and trailing whitespace, and assigns a rough role:

- `User` if metadata mentions user or human.
- `Claude` if metadata mentions assistant or Claude, or the element has `.font-claude-response`.
- `Message` otherwise.

Candidates are sorted in document order. Nested duplicates are removed, and identical text duplicates are skipped. If the result includes at least one user turn, the transcript becomes blocks like:

```text
User: ...

Claude: ...
```

If the structured scrape does not produce a useful transcript, the fallback reads visible text from `main`, then a conversation-looking element, then `document.body`.

The backend conversation input is capped at 180,000 characters. If the page text is longer than that, the script keeps the first 40,000 characters and the last 140,000 characters, with an omission marker in the middle.

## How Summary Generation Works

There are two summary paths.

### Old Claude Prompt Path

This is still the normal path unless forced backend mode is enabled or Claude appears to hit a limit.

The script finds Claude's input, remembers how many Claude response elements already exist, and remembers the current last response text. This matters because older versions could accidentally reuse a previous response if the new prompt never generated.

Then it writes `CONTEXT_GENERATOR_PROMPT` into Claude's composer. For textarea/input elements it uses the native value setter and dispatches input/change events. For contenteditable elements it selects the contents and uses `document.execCommand("insertText")`; if that fails, it assigns `textContent` and dispatches an input event.

The prompt asks Claude to produce a portable "context carry" block with these sections: who the user is, what the conversation was doing, where it left off, decisions, open questions, key context, and next step.

After inserting the prompt, the script finds a visible Send button. It looks inside the form first and then the whole page. A button matches if its aria-label, title, test id, or text mentions send or submit. The script clicks that Claude Send button.

### Stop To Send Button Flow

After clicking Claude Send, the script watches Claude's button state instead of waiting a fixed amount of time.

It polls every 500ms for up to 30 seconds. While Claude is generating, the Send button usually changes into a Stop button. The script detects Stop by scanning visible buttons and checking aria-label, title, data-testid, and text for the word `stop`.

The logic is:

- Start polling after clicking Send.
- If a Stop button appears, mark that generation has started.
- Once Stop disappears after being seen, treat generation as finished.
- If Stop never appears, give Claude about 2 seconds of grace, then stop waiting.
- Sleep 500ms more so the final response text can settle.

Then it reads the newest `.font-claude-response` after the previously remembered response count. If there is no new response, or if the text looks like a context-limit message, the script switches to the backend path.

### Automatic Backend Fallback

The backend fallback is used when Claude cannot produce the summary because of context/input limits.

The content script checks for limit indicators before clicking Send, during generation polling, and after response capture. It looks for alert/live/error-looking DOM nodes and also walks up from the input's form for a few parent levels. The text is matched against patterns like context limit/window/length, conversation too long, prompt too long, maximum tokens/context/length, reduce message, shorten prompt, and too many tokens.

If any of those checks trigger, or if no fresh Claude response is available, the script sends `SUMMARIZE_WITH_BACKEND` to the background worker with the scraped conversation text.

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

### Forced Backend Test Mode

There are two ways to force the backend path without actually hitting Claude's context limit:

- Shift-click any destination tile in the Claude picker. That one transfer uses Mistral instead of asking Claude.
- Set this in Claude DevTools:

```js
localStorage.setItem("contextGeneratorForceBackend", "true")
```

With that flag set, the normal extension-icon flow also skips Claude summarization and uses the backend. Remove it with:

```js
localStorage.removeItem("contextGeneratorForceBackend")
```

When the backend path runs, the overlay text changes to `Summarizing with Mistral...`.

## How The Vercel/Mistral Backend Works

`api/summarize.js` is a Vercel serverless function. It allows CORS from any origin, handles `OPTIONS`, only accepts `POST`, and requires `MISTRAL_API_KEY` from the environment.

It accepts either an already-parsed body or a string body. Bad JSON returns 400. Missing or non-string `conversation` returns 400. Missing `MISTRAL_API_KEY` returns 500.

For valid requests, it calls Mistral's chat completions endpoint:

```text
https://api.mistral.ai/v1/chat/completions
```

The model is `mistral-small-latest` and temperature is `0.2`.

The system prompt tells Mistral to summarize the conversation for another AI assistant and to return exactly the same context-carry structure used by the Claude prompt path. The user message contains the scraped conversation text.

The function returns the first choice message content as:

```json
{ "summary": "..." }
```

Mistral API failures return 502. Empty Mistral summaries return 502. Unexpected server errors return 500.

## How Context Is Transferred To ChatGPT

After either summary path returns text, `claude-content.js` sends it to the background worker:

- `TRANSFER_TO_CHATGPT` for ChatGPT.
- `TRANSFER_TO_DESTINATION` with a destination id for Gemini, Grok, or DeepSeek.

The background worker validates that text exists, opens the destination URL in a new active tab, waits for the tab's status to become complete, injects the right destination content script, and sends that tab a `PASTE_CONTEXT` message.

For ChatGPT, `chatgpt-content.js` waits up to 10 seconds for an input. It prefers these contenteditable targets:

- `#prompt-textarea[contenteditable='true']`
- `[data-testid='prompt-textarea'][contenteditable='true']`
- `.ProseMirror[contenteditable='true']`
- `div[contenteditable='true'][role='textbox']`
- placeholder or aria-label message contenteditables
- any visible contenteditable

If none is found, it falls back to `#prompt-textarea`, `[data-testid='prompt-textarea']`, placeholder textareas, or any textarea.

Once it has an editor, it pastes by focusing the editor and then:

- For textarea/input: uses the native value setter, then dispatches `InputEvent("input")` and `change`.
- For contenteditable: targets the first `p` child if present, otherwise the editor itself. It selects the current contents, calls `document.execCommand("insertText", false, text)`, and verifies the first 20 characters appeared.
- If the first contenteditable insert did not work, it focuses again, selects all, tries `execCommand("insertText")` again, and checks again.
- If that still fails, it assigns `element.textContent = text`.
- Finally it dispatches input events so ChatGPT's React/ProseMirror state notices the change.

After pasting, it verifies that the first 20 characters of the summary are present in the editor. If not, it shows an "Auto-paste failed" modal with a copy button and returns an error to the background worker.

Important current behavior: the extension does not auto-click ChatGPT's Send button. It only fills the ChatGPT input and verifies the paste. The same is true for Gemini, Grok, and DeepSeek. The only Send button the code clicks today is Claude's Send button during the old Claude prompt path.

## Other Destination Paste Logic

`ai-destination-content.js` handles Gemini, Grok, and DeepSeek with the same broad paste strategy as ChatGPT, but destination-specific selectors.

It determines the destination either from the message destination id or from the current hostname. It waits up to 10 seconds for a visible contenteditable or textarea, writes the text, checks the first 20 characters, and shows the same manual copy fallback modal if paste verification fails.

## Badges, Overlays, And Error Handling

The background worker sets the extension badge to:

- `RUN` when the extension icon successfully starts a transfer.
- `OK` after a destination paste succeeds.
- `ERR` for transfer errors.

The Claude page shows a small overlay above the floating bubble while work is running. In Claude prompt mode it displays `Generating context...` with a countdown. In backend mode it displays `Summarizing with Mistral...`.

If the Claude-side flow throws, the script resets the running flag, hides the overlay, shows a red "Transfer Failed" overlay on Claude, and notifies the background worker.

## Tricky Parts That Were Hard To Get Working

- Claude's DOM is not stable, so the input, composer, action cluster, and message turns are found with scoring and heuristics instead of one brittle selector.
- The floating bubble has to live inside Claude's composer so it tracks the input, but it also has to reserve space by shifting Claude's own action cluster left. The script stores original inline styles so it can restore them.
- The MutationObserver would loop forever if it reacted to its own UI. The script marks owned nodes and ignores mutations that are only caused by the extension.
- Claude generation is detected through the Stop button appearing and disappearing. This is more reliable than a fixed timeout, but the code still has a short grace period for cases where Stop never appears.
- The old Claude summary path must avoid reusing a stale response. The code remembers the previous response count and previous response text, then requires a fresh response after the prompt.
- Context-limit fallback is heuristic. Claude can surface limit errors in different places, so the code checks alert/live/error nodes and nearby composer ancestors with several text patterns.
- The backend scraper tries structured message turns first, then falls back to page text. This makes it resilient, but the fallback can include extra Claude UI text if Claude changes its markup.
- Programmatic pasting into modern AI editors is finicky. The scripts use native setters for real inputs, `execCommand("insertText")` for contenteditables, retries with select-all, direct `textContent` as a last resort, and input/change events for framework state.
- Pasting is verified by checking a short sample of the inserted text. If verification fails, the user gets a manual copy modal instead of silently losing the summary.
- Forced backend test mode intentionally happens before the overlay is shown, so the overlay text is not scraped into the conversation sent to Mistral.
