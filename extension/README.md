# Context Generator Relay Extension

This Chrome extension automates the handoff from Claude to ChatGPT:

1. Click the extension icon while a `claude.ai` chat is open.
2. The extension scrapes the current Claude conversation from the page.
3. It sends the conversation to the Vercel/Mistral summarization backend.
4. It opens `chatgpt.com` in a new tab.
5. It pastes the summary into the ChatGPT message input.
6. It auto-clicks Send.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `extension` folder.

You need to be signed in to both Claude and ChatGPT before using it.
