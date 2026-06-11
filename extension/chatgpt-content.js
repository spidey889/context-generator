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

    console.log("[Context Generator ChatGPT] Waiting for ChatGPT message input element...");
    const input = await waitForElement(findChatGptInput, 30000, "ChatGPT message input");
    console.log("[Context Generator ChatGPT] Found input element:", input);
    setEditorText(input, text.trim());
  }

  function findChatGptInput() {
    const contenteditableSelectors = [
      "#prompt-textarea[contenteditable='true']",
      "[data-testid='prompt-textarea'][contenteditable='true']",
      ".ProseMirror[contenteditable='true']",
      "div[contenteditable='true'][role='textbox']",
      "[contenteditable='true'][data-placeholder]",
      "[contenteditable='true'][aria-label*='message' i]",
      "[contenteditable='true']"
    ];

    let found = contenteditableSelectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .find((element) => isVisible(element) && !element.closest("[aria-hidden='true']"));

    if (found) {
      console.log("[Context Generator ChatGPT] findChatGptInput successfully found contenteditable element:", found);
      return found;
    }

    const fallbackSelectors = [
      "#prompt-textarea",
      "[data-testid='prompt-textarea']",
      "textarea[placeholder]",
      "textarea"
    ];

    found = fallbackSelectors
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .find((element) => isVisible(element) && !element.closest("[aria-hidden='true']"));

    if (found) {
      console.log("[Context Generator ChatGPT] findChatGptInput found fallback element:", found);
    }
    return found;
  }

  function setEditorText(element, text) {
    console.log("[Context Generator ChatGPT] setEditorText focusing element...");
    element.focus();

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      console.log("[Context Generator ChatGPT] Element is a standard textarea/input.");
      const valueSetter = Object.getOwnPropertyDescriptor(element.constructor.prototype, "value")?.set;
      valueSetter?.call(element, text);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      console.log("[Context Generator ChatGPT] Text inserted successfully into textarea/input.");
      return;
    }

    console.log("[Context Generator ChatGPT] Element is contenteditable. Attempting text insertion...");
    
    // Find inner paragraph or text container if it exists, to select the precise editing node
    const target = element.querySelector("p") || element;
    console.log("[Context Generator ChatGPT] Targeting inner node for selection:", target);

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = document.execCommand("insertText", false, text);
    
    // Validate insertion
    const sampleText = text.slice(0, 20);
    let hasText = (element.innerText || element.textContent || "").includes(sampleText);
    
    if (!inserted || !hasText) {
      console.log("[Context Generator ChatGPT] execCommand('insertText') failed or text not found. Trying selectAll fallback...");
      element.focus();
      document.execCommand("selectAll", false, null);
      inserted = document.execCommand("insertText", false, text);
      hasText = (element.innerText || element.textContent || "").includes(sampleText);
    }

    if (!hasText) {
      console.warn("[Context Generator ChatGPT] execCommand failed completely. Falling back to direct textContent assignment.");
      element.textContent = text;
    } else {
      console.log("[Context Generator ChatGPT] Text successfully inserted via execCommand.");
    }

    // Always dispatch input events to ensure frameworks (ProseMirror, React) sync state
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    element.dispatchEvent(new Event("input", { bubbles: true }));
    console.log("[Context Generator ChatGPT] Dispatched input events.");
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
