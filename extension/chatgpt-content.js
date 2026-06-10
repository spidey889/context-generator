(() => {
  if (window.__contextGeneratorChatGptLoaded) {
    return;
  }

  window.__contextGeneratorChatGptLoaded = true;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "PASTE_CONTEXT") {
      return false;
    }

    pasteIntoChatGpt(message.text)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  });

  async function pasteIntoChatGpt(text) {
    if (!text?.trim()) {
      throw new Error("No text was provided for ChatGPT.");
    }

    const input = await waitForElement(findChatGptInput, 30000, "ChatGPT message input");
    setEditorText(input, text.trim());
  }

  function findChatGptInput() {
    const selectors = [
      "#prompt-textarea",
      "[data-testid='prompt-textarea']",
      "textarea[placeholder]",
      "textarea",
      "[contenteditable='true'][data-placeholder]",
      "[contenteditable='true'][aria-label*='message' i]",
      "[contenteditable='true']"
    ];

    return selectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .find((element) => isVisible(element) && !element.closest("[aria-hidden='true']"));
  }

  function setEditorText(element, text) {
    element.focus();

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const valueSetter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set;
      valueSetter?.call(element, text);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    const inserted = document.execCommand("insertText", false, text);
    if (!inserted || !(element.innerText || "").includes(text.slice(0, 20))) {
      element.textContent = text;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    }
  }

  function waitForElement(getElement, timeoutMs, name) {
    const startedAt = Date.now();

    return new Promise((resolve, reject) => {
      const tick = () => {
        const element = getElement();
        if (element) {
          resolve(element);
          return;
        }

        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error(`Timed out waiting for ${name}.`));
          return;
        }

        setTimeout(tick, 250);
      };

      tick();
    });
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }
})();
