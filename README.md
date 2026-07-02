# Context Generator

Move a long AI conversation into another AI without rebuilding the context by hand.

Context Generator is a Chrome/Brave extension that reads the chat you are currently in, creates a compact "Context Carry" summary, opens the AI destination you choose, and pastes the summary into the destination input box for you to review and send.

## What It Does

- Adds a Cap-Context button inside supported AI chat pages.
- Lets you pick where to continue: Claude, ChatGPT, Gemini, Grok, or DeepSeek.
- Scrapes the current conversation before any extension UI is shown, so extension text is not included.
- Sends the conversation to the backend summarizer.
- Opens the destination AI and pastes the generated context into its composer.
- Leaves the final send action to you.

## Current Flow

1. Open a supported AI chat.
2. Click the Cap-Context bubble near the chat input.
3. Pick the destination AI from the picker.
4. The extension generates a portable context summary.
5. The destination tab opens and the summary is pasted into the input box.
6. Review the pasted context, then send it manually.

If auto-paste fails, the extension shows a manual copy fallback with the generated context so you can still paste it yourself.

## Supported Sites

- Claude: `https://claude.ai`
- ChatGPT: `https://chatgpt.com` and OpenAI-hosted ChatGPT pages
- Gemini: `https://gemini.google.com`
- Grok: `https://grok.com`
- DeepSeek: `https://chat.deepseek.com`

## Install For Local Development

1. Clone this repo.
2. Open Brave or Chrome and go to `chrome://extensions`.
3. Enable Developer mode.
4. Click "Load unpacked".
5. Select the `extension` folder from this repo.
6. Open a supported AI chat page and refresh it if it was already open.

The unpacked extension should be loaded from:

```text
extension/
```

## Backend

The extension calls the Vercel API endpoint in `api/summarize.js`. That endpoint uses Mistral to normalize the conversation into the Context Carry format before returning it to the extension.

For deployment, configure:

```text
MISTRAL_API_KEY
```

## Development

Run the regression tests:

```bash
npm test
```

The test suite covers the core pieces most likely to regress:

- Summary normalization
- Conversation scraping edge cases
- Paste verification logic

## Project Layout

| Path | Purpose |
| --- | --- |
| `extension/manifest.json` | Extension manifest, host permissions, and MV3 service worker config |
| `extension/background.js` | Tab orchestration, backend summary requests, and destination messaging |
| `extension/platform-content.js` | In-page button, picker, scraping, paste behavior, and fallback UI |
| `extension/README.md` | Extension-specific usage notes |
| `api/summarize.js` | Vercel summarization endpoint |
| `test/` | Minimal Node regression tests |
| `OLD_README.md` | Archived README for the earlier manual prompt/skill version |

## Privacy Notes

Conversation text is sent to the configured backend only when you start a transfer. The extension does not send messages on your behalf, does not click the destination send button, and does not submit the pasted summary automatically.

## Contributing

Issues and PRs are welcome. Keep changes scoped, test the transfer flow when touching extension behavior, and avoid automatic-send behavior.

Made by [@spidey889](https://github.com/spidey889).
