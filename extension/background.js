const CHATGPT_URL = "https://chatgpt.com/";
const SUMMARY_BACKEND_URL = "https://context-generator-five.vercel.app/api/summarize";
const PLATFORM_CONTENT_SCRIPT = "platform-content.js";
const DESTINATIONS = {
  claude: {
    name: "Claude",
    url: "https://claude.ai/",
    contentScript: PLATFORM_CONTENT_SCRIPT
  },
  chatgpt: {
    name: "ChatGPT",
    url: CHATGPT_URL,
    contentScript: PLATFORM_CONTENT_SCRIPT
  },
  gemini: {
    name: "Gemini",
    url: "https://gemini.google.com/",
    contentScript: PLATFORM_CONTENT_SCRIPT
  },
  grok: {
    name: "Grok",
    url: "https://grok.com/",
    contentScript: PLATFORM_CONTENT_SCRIPT
  },
  deepseek: {
    name: "DeepSeek",
    url: "https://chat.deepseek.com/",
    contentScript: PLATFORM_CONTENT_SCRIPT
  }
};
const DESTINATION_HOSTS = {
  claude: ["claude.ai"],
  chatgpt: ["chatgpt.com", "openai.com"],
  gemini: ["gemini.google.com"],
  grok: ["grok.com"],
  deepseek: ["chat.deepseek.com"]
};

chrome.action.onClicked.addListener(async (tab) => {
  try {
    clearBadge();

    const platform = getPlatformFromUrl(tab.url);
    if (!tab.id || !platform) {
      throw new Error("Open a supported AI chat, then click the extension icon.");
    }

    await ensureContentScript(tab.id, PLATFORM_CONTENT_SCRIPT);
    const startResult = await sendMessage(tab.id, { type: "START_CONTEXT_TRANSFER" });

    if (!startResult?.ok) {
      throw new Error(startResult?.error || "Could not start context transfer.");
    }

    await setBadge("RUN", "#565add");
  } catch (error) {
    console.error("[Context Generator Relay]", error);
    await setBadge("ERR", "#b42318", 5000);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "SUMMARIZE_WITH_BACKEND") {
    summarizeWithBackend(message.conversation)
      .then((summary) => sendResponse({ ok: true, summary }))
      .catch((error) => {
        console.error("[Context Generator Relay]", error);
        setBadge("ERR", "#b42318", 5000);
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === "TRANSFER_TO_DESTINATION") {
    transferToDestination(message.destination, message.text)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("[Context Generator Relay]", error);
        setBadge("ERR", "#b42318", 5000);
        sendResponse({ ok: false, error: error.message });
      });

    return true;
  }

  if (message?.type === "CONTEXT_TRANSFER_ERROR") {
    console.error("[Context Generator Relay]", message.error);
    setBadge("ERR", "#b42318", 5000);
  }

  return false;
});

async function summarizeWithBackend(conversation) {
  if (!conversation?.trim()) {
    throw new Error("AI conversation text could not be captured.");
  }

  const response = await fetch(SUMMARY_BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ conversation: conversation.trim() })
  });

  if (!response.ok) {
    throw new Error("Backup summarizer failed.");
  }

  const data = await response.json();
  if (!data.summary?.trim()) {
    throw new Error("Backup summarizer returned no summary.");
  }

  return data.summary.trim();
}

async function transferToDestination(destinationId, text) {
  if (!text?.trim()) {
    throw new Error("Context summary text was not available.");
  }

  const destination = DESTINATIONS[destinationId];
  if (!destination) {
    throw new Error("Unknown AI destination.");
  }

  const destinationTab = await chrome.tabs.create({ url: destination.url, active: true });
  await waitForTabLoaded(destinationTab.id, destination.name);
  await ensureContentScript(destinationTab.id, destination.contentScript);

  const pasteResult = await sendMessage(destinationTab.id, {
    type: "PASTE_CONTEXT",
    destination: destinationId,
    text: text.trim()
  });

  if (!pasteResult?.ok) {
    throw new Error(pasteResult?.error || `Could not paste into ${destination.name}.`);
  }

  await setBadge("OK", "#1f8f4d", 2500);
}

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

function getPlatformFromUrl(url) {
  if (!url) return null;

  try {
    const hostname = new URL(url).hostname;
    return Object.entries(DESTINATION_HOSTS).find(([, hosts]) => {
      return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    })?.[0] || null;
  } catch {
    return null;
  }
}

function waitForTabLoaded(tabId, name = "destination") {
  return new Promise((resolve, reject) => {
    if (!tabId) {
      reject(new Error("Missing tab id."));
      return;
    }

    const timeout = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Timed out waiting for ${name} to load.`));
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
