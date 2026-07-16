# Context Generator

Move a long AI conversation into another AI without rebuilding the context by hand.

Context Generator is a Chrome/Brave extension that reads the chat you are currently in, creates a compact "Context Carry" summary, opens the AI destination you choose, and pastes the summary into the destination input box for you to review and send.

## What It Does

- Adds a Cap-Context button inside supported AI chat pages.
- Lets you pick where to continue: Claude, ChatGPT, Gemini, Grok, or DeepSeek.
- Captures only role-verified chat turns after you choose a destination; extension UI and unrelated page text are excluded.
- Sends up to 210,000 captured conversation characters to one backend summary job.
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

## Install

Install Cap Context from the [Chrome Web Store](https://chromewebstore.google.com/detail/cap-context/lpkaciijlhckkdhbgidbjfkldigghnjf). The same listing works in Chrome and Brave and receives normal browser-managed updates.

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

The extension calls the Vercel API endpoint in `api/summarize.js`. Tiny chats are carried locally by the backend without a provider call. Generated summaries use Gemini 3.5 Flash first, then the fixed Mistral model chain and optional Groq fallback. Provider output must pass deterministic Context Carry validation before it is returned to the extension.

For deployment, configure:

```text
GEMINI_API_KEY
MISTRAL_API_KEY
```

Optionally configure `GROQ_API_KEY` for the final fallback provider.

## Development

Run the regression tests:

```bash
npm test
```

Run the complete release gate, including live summary accuracy and latency:

```bash
npm run gate
```

The versioned cases in `evaluation/cases.json` require at least 90% expected-fact recall, zero forbidden/incorrect facts, valid Context Carry structure, complete DOM capture, and per-case plus total latency budgets. `npm test` runs the deterministic capture gate; `npm run eval` sends the same cases to `EVAL_ENDPOINT` or the production endpoint by default. GitHub Actions also runs the complete gate after pushes to `master`, daily, and on demand.

The test suite covers the core pieces most likely to regress:

- Endpoint security, limits, prompt isolation, and provider fallback
- Summary profiles, validation, normalization, and timeout budgets
- Conversation capture, role detection, virtualized chats, and privacy boundaries
- Background job deduplication, paste verification, and analysis receipts

## Project Layout

| Path | Purpose |
| --- | --- |
| `extension/manifest.json` | Extension manifest, host permissions, and MV3 service worker config |
| `extension/background.js` | Tab orchestration, backend summary requests, and destination messaging |
| `extension/platform-content.js` | In-page button, picker, scraping, paste behavior, and fallback UI |
| `extension/README.md` | Extension-specific usage notes |
| `api/summarize.js` | Vercel summarization endpoint |
| `api/request-security.js` | Endpoint CORS, schema, size, rate, and concurrency controls |
| `test/` | Minimal Node regression tests |
| `evaluation/cases.json` | Versioned accuracy, capture, and latency evaluation set |
| `scripts/run-regression-eval.js` | Live summary regression scorer |
| `LOGIC.md` | Current production architecture and behavior |
| `CHANGELOG.md` | Historical decisions and replaced approaches |
| `PRIVACY.md` | Current data handling and privacy policy |
| `OLD_README.md` | Archived README for the earlier manual prompt/skill version |

## Privacy Notes

Opening or cancelling the picker does not capture or upload chat text. Conversation text is sent only after you select a destination, and generated summaries may be processed by Gemini, Mistral, or the configured Groq fallback. The extension does not send messages on your behalf, click the destination send button, or submit the pasted summary automatically. See [PRIVACY.md](PRIVACY.md) for details.

## Contributing

Issues and PRs are welcome. Keep changes scoped, test the transfer flow when touching extension behavior, and avoid automatic-send behavior.

Made by [@spidey889](https://github.com/spidey889).
