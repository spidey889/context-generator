# Context Generator Relay Extension

This Chrome extension automates the handoff from Claude to ChatGPT:

1. Click the extension icon while a `claude.ai` chat is open.
2. The extension injects the context-generator prompt into Claude and sends it.
3. It waits exactly 10 seconds.
4. It grabs whatever text is in Claude's last response at that point.
5. It opens `chatgpt.com` in a new tab.
6. It pastes Claude's response into the ChatGPT message input.

It does not auto-send the ChatGPT message.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this `extension` folder.

You need to be signed in to both Claude and ChatGPT before using it.
