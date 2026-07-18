# Cap Context

Switch models. Keep the thread.

Cap Context is a Chrome and Brave extension that carries the useful context from one AI conversation into another. It captures the current chat after you choose a destination, creates a structured Context Carry, opens the destination AI, and pastes the handoff for you to review. It never presses Send.

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/cap-context/lpkaciijlhckkdhbgidbjfkldigghnjf) · [Visit the website](https://context-generator-five.vercel.app/) · [Read the privacy policy](PRIVACY.md)

## Supported AI Platforms

- Claude: `https://claude.ai`
- ChatGPT: `https://chatgpt.com` and the legacy `https://chat.openai.com` host
- Gemini: `https://gemini.google.com`
- Grok: `https://grok.com`
- DeepSeek: `https://chat.deepseek.com`

## How It Works

1. Open a supported AI conversation.
2. Click the Cap Context bubble near the composer.
3. Choose where you want to continue.
4. Cap Context captures the role-verified conversation and creates one portable summary.
5. The destination opens with the Context Carry pasted into its composer.
6. Review it and press Send yourself.

Opening or closing the destination picker is UI-only. Capture and provider processing begin only after a destination is selected. If automatic paste fails, the generated Context Carry remains available in a manual-copy dialog.

## Current Behavior

- Captures role-verified user and assistant turns while excluding extension UI, composers, empty-state prompts, and unrelated page content.
- Handles virtualized long conversations without silently removing the middle.
- Accepts up to 350,000 captured JavaScript characters; larger conversations stop with a visible error before a summary request is sent.
- Runs one backend summary job per transfer, with short exact-result deduplication and caching in the extension service worker.
- Shows real Capturing, Summarizing, and Pasting stages during a handoff. Display-only progress never gates the actual transfer.
- Focuses the destination after verified paste but never submits the message automatically.
- Stores one latest-run diagnostic receipt locally. Its raw captured transcript expires after 24 hours while non-transcript diagnostics remain until the next transfer.

## Summary Pipeline

Chats at or below 1,200 characters use the exact local-direct Context Carry path without calling an AI provider. Generated summaries use this fallback order:

1. Gemini `gemini-3.5-flash`, when `GEMINI_API_KEY` is configured
2. Mistral `mistral-medium-3-5`
3. Mistral `mistral-large-2512`
4. Mistral `ministral-3b-2512`
5. Groq `llama-3.1-8b-instant`, when `GROQ_API_KEY` is configured

Conversations above 210,000 characters use the extra-large profile, targeting about 1,800 words with a 7,000-token visible output cap.

Every generated result must pass deterministic validation for the complete seven-section Context Carry contract before it can be pasted. Invalid or failed output advances through the existing fallback chain.

## Install

Install the current release from the [Chrome Web Store](https://chromewebstore.google.com/detail/cap-context/lpkaciijlhckkdhbgidbjfkldigghnjf). The same listing works in Chrome and Brave and receives browser-managed updates.

### Authorized development

1. Use an authorized checkout of this repository.
2. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
3. Enable Developer mode.
4. Click **Load unpacked**.
5. Select this repository's `extension` folder.
6. Open or refresh a supported AI chat.

The unpacked extension folder is:

```text
extension/
```

## Backend Configuration

The extension calls the Vercel endpoint implemented in `api/summarize.js`. Configure:

```text
GEMINI_API_KEY
MISTRAL_API_KEY
```

`GROQ_API_KEY` is optional and enables the final provider fallback.

## Development

Run deterministic regression coverage:

```bash
npm test
```

Run the real installed-extension handoff smoke in a new isolated Brave window:

```bash
npm run test:extension-smoke
```

The smoke uses controlled local ChatGPT and Claude fixtures plus a stub summary endpoint. It loads the actual Manifest V3 extension and verifies capture, exactly one backend request, destination paste, and the no-auto-send boundary without using live accounts or production APIs. Set `BRAVE_PATH` only when Brave is installed outside its normal system location.

Run the complete gate, including live summary accuracy and latency evaluation:

```bash
npm run gate
```

The versioned cases in `evaluation/cases.json` enforce expected-fact recall, zero forbidden facts, valid Context Carry structure, complete DOM capture, and latency budgets. GitHub Actions runs the complete gate after pushes to `master`, daily, and on demand.

## Project Layout

| Path | Purpose |
| --- | --- |
| `index.html` | Current dependency-free marketing site |
| `extension/manifest.json` | Manifest V3 registration, permissions, scripts, and assets |
| `extension/platform-content.js` | Picker, capture, handoff UI, paste behavior, and manual fallback |
| `extension/background.js` | Tab orchestration, summary jobs, caching, receipts, and paste relay |
| `extension/analysis-bridge.js` | Secure bridge to the latest-run analysis page |
| `analysis/index.html` | Local latest-run diagnostics UI |
| `api/summarize.js` | Summary profiles, provider chain, validation, and normalization |
| `api/request-security.js` | Endpoint method, origin, schema, size, rate, and concurrency controls |
| `test/` | Deterministic Node regression coverage |
| `evaluation/cases.json` | Versioned summary, capture, accuracy, and latency cases |
| `scripts/run-regression-eval.js` | Live endpoint regression scorer |
| `scripts/run-extension-smoke.js` | Installed Brave extension end-to-end handoff smoke |
| `LOGIC.md` | Source of truth for current production architecture and behavior |
| `CHANGELOG.md` | Meaningful historical decisions and replaced approaches |
| `PRIVACY.md` | Current data-handling and privacy policy |

## Privacy

Chat text leaves the source page only after you select a destination. The backend does not intentionally log or permanently store transcripts. Generated summaries may be processed by Gemini, Mistral, or the configured Groq fallback. Metadata-only transfer analytics records a random install ID, route, timestamp, character count, outcome, last closed-list pipeline stage, safe failure category, and extension version; it never includes chat text, generated summaries, URLs, stack traces, or provider response bodies. Pasted text is never submitted automatically. See [PRIVACY.md](PRIVACY.md) for the full details.

## License

Cap Context is proprietary software. No permission is granted to copy, modify, redistribute, sublicense, sell, or create derivative works without prior written permission. See [LICENSE](LICENSE).

Copyright © 2026 Vinit Rajpurohit. All rights reserved.
