# Cap-Context Extension

Cap-Context carries the useful parts of one AI chat into another AI without sending the message for you.

## How It Works

1. Open a supported AI chat on Claude, ChatGPT, Gemini, Grok, or DeepSeek.
2. Click the Cap-Context bubble in the message composer.
3. Pick where you want to continue from the destination picker.
4. Cap-Context captures role-verified turns and sends one summary job to the Vercel backend. Tiny chats are carried locally; generated summaries use Gemini 3.5 Flash first, then Mistral and optional Groq fallbacks.
5. It opens or prepares the destination tab, pastes the context into the message box, and focuses that tab.
6. Review the pasted context, then send it manually when you are ready.

If auto-paste fails, Cap-Context shows a manual copy dialog with the generated context so you can still paste it yourself.

Opening or cancelling the picker does not capture or upload conversation text. The backend accepts conversations up to 210,000 characters; larger captures are rejected rather than silently truncated.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `extension` folder.

Sign in to both the source and destination AI sites before using the handoff.
