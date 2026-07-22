# Cap-Context Extension

Cap-Context carries the useful parts of one AI chat into another AI without sending the message for you.

## How It Works

1. Open a supported AI chat on Claude, ChatGPT, Gemini, Grok, or DeepSeek.
2. Click the Cap-Context bubble in the message composer.
3. Pick where you want to continue from the destination picker.
4. Cap-Context captures role-verified turns and sends one summary job to the Vercel backend. Tiny chats are carried locally; generated summaries use Gemini 3.6 Flash first, then Mistral and optional Groq fallbacks.
5. It opens or prepares the destination tab, pastes the context into the message box, and focuses that tab.
6. Review the pasted context, then send it manually when you are ready.

If auto-paste fails, Cap-Context shows a manual copy dialog with the generated context so you can still paste it yourself.

Opening or cancelling the picker does not capture or upload conversation text. The backend accepts conversations up to 350,000 characters; larger captures are rejected rather than silently truncated.

Each transfer attempt also sends metadata-only operational telemetry: random install/attempt IDs, time, route, character count when known, outcome, last predefined pipeline stage, a predefined safe failure category, and extension version. It never sends chat text, generated summaries, URLs, stack traces, arbitrary JavaScript errors, or provider response bodies. Each stage update is queued locally and retried without blocking the transfer.

After an install's first successful summary, a protected internal `users` row tracks only its sequential user number, lifetime successful-summary count, current UTC-day successful-summary count, and the UTC date for that daily count. It contains no conversation content or per-transfer activity.

Closing the source AI tab during an active transfer records the safe failure category `user_cancelled`, so it is distinguishable from provider or extension failures without adding content.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `extension` folder.

Sign in to both the source and destination AI sites before using the handoff.

## License

Cap Context is proprietary software. All rights are reserved; see the repository `LICENSE` file.
