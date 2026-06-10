const CLAUDE_ORIGIN = "https://claude.ai";
const CHATGPT_URL = "https://chatgpt.com/";

chrome.action.onClicked.addListener(async (tab) => {
  try {
    clearBadge();

    if (!tab.id || !tab.url?.startsWith(CLAUDE_ORIGIN)) {
      throw new Error("Open a claude.ai chat, then click the extension icon.");
    }

    await ensureContentScript(tab.id, "claude-content.js");
    const claudeResult = await sendMessage(tab.id, { type: "RUN_CONTEXT_GENERATOR" });

    if (!claudeResult?.ok || !claudeResult.text) {
      throw new Error(claudeResult?.error || "Claude did not return response text.");
    }

    const chatGptTab = await chrome.tabs.create({ url: CHATGPT_URL, active: true });
    await waitForTabLoaded(chatGptTab.id);
    await ensureContentScript(chatGptTab.id, "chatgpt-content.js");

    const pasteResult = await sendMessage(chatGptTab.id, {
      type: "PASTE_CONTEXT",
      text: claudeResult.text
    });

    if (!pasteResult?.ok) {
      throw new Error(pasteResult?.error || "Could not paste into ChatGPT.");
    }

    await setBadge("OK", "#1f8f4d", 2500);
  } catch (error) {
    console.error("[Context Generator Relay]", error);
    await setBadge("ERR", "#b42318", 5000);
  }
});

async function ensureContentScript(tabId, file) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: [file] });
  } catch (error) {
    const message = String(error?.message || error);
    if (!message.includes("Cannot access") && !message.includes("No tab with id")) {
      console.debug("[Context Generator Relay] Content script injection skipped:", message);
    }
  }
}

function sendMessage(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

function waitForTabLoaded(tabId) {
  return new Promise((resolve, reject) => {
    if (!tabId) {
      reject(new Error("Missing tab id."));
      return;
    }

    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Timed out waiting for ChatGPT to load."));
    }, 30000);

    const listener = (updatedTabId, info) => {
      if (updatedTabId === tabId && info.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };

    chrome.tabs.onUpdated.addListener(listener);

    chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === "complete") {
        clearTimeout(timeout);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch((error) => {
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      reject(error);
    });
  });
}

async function setBadge(text, color, timeoutMs) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });

  if (timeoutMs) {
    setTimeout(clearBadge, timeoutMs);
  }
}

function clearBadge() {
  chrome.action.setBadgeText({ text: "" });
}
