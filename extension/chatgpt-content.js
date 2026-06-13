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

    const input = await findChatGptInput();
    if (!input) {
      showFallbackModal(text.trim());
      throw new Error("ChatGPT message input element could not be found.");
    }

    setEditorText(input, text.trim());

    // Check if the paste actually succeeded by verifying the element's content
    const sampleText = text.trim().slice(0, 20);
    const textContent = input.value || input.innerText || input.textContent || "";
    if (!textContent.includes(sampleText)) {
      showFallbackModal(text.trim());
      throw new Error("Paste operation failed to populate the ChatGPT editor.");
    }
  }

  async function findChatGptInput() {
    const contenteditableSelectors = [
      "#prompt-textarea[contenteditable='true']",
      "[data-testid='prompt-textarea'][contenteditable='true']",
      ".ProseMirror[contenteditable='true']",
      "div[contenteditable='true'][role='textbox']",
      "[contenteditable='true'][data-placeholder]",
      "[contenteditable='true'][aria-label*='message' i]",
      "[contenteditable='true']"
    ];

    const fallbackSelectors = [
      "#prompt-textarea",
      "[data-testid='prompt-textarea']",
      "textarea[placeholder]",
      "textarea"
    ];

    const findElement = (selectors) => {
      return selectors
        .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
        .find((element) => isVisible(element) && !element.closest("[aria-hidden='true']"));
    };

    const startTime = Date.now();
    while (Date.now() - startTime < 10000) {
      const ceElement = findElement(contenteditableSelectors);
      if (ceElement) {
        return ceElement;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return findElement(fallbackSelectors);
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

    const target = element.querySelector("p") || element;

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);

    let inserted = document.execCommand("insertText", false, text);
    
    const sampleText = text.slice(0, 20);
    let hasText = (element.innerText || element.textContent || "").includes(sampleText);
    
    if (!inserted || !hasText) {
      element.focus();
      document.execCommand("selectAll", false, null);
      inserted = document.execCommand("insertText", false, text);
      hasText = (element.innerText || element.textContent || "").includes(sampleText);
    }

    if (!hasText) {
      element.textContent = text;
    }

    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function showFallbackModal(text) {
    let modal = document.getElementById("context-generator-fallback-modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "context-generator-fallback-modal";
      modal.style.position = "fixed";
      modal.style.zIndex = "99999999";
      modal.style.top = "0";
      modal.style.left = "0";
      modal.style.width = "100%";
      modal.style.height = "100%";
      modal.style.backgroundColor = "rgba(0, 0, 0, 0.6)";
      modal.style.display = "flex";
      modal.style.alignItems = "center";
      modal.style.justifyContent = "center";
      modal.style.fontFamily = "-apple-system, BlinkMacSystemFont, sans-serif";

      const content = document.createElement("div");
      content.style.backgroundColor = "#2f2f2f";
      content.style.color = "#ffffff";
      content.style.padding = "24px";
      content.style.borderRadius = "12px";
      content.style.maxWidth = "500px";
      content.style.width = "90%";
      content.style.boxShadow = "0 8px 32px rgba(0, 0, 0, 0.4)";
      content.style.display = "flex";
      content.style.flexDirection = "column";
      content.style.gap = "16px";

      const title = document.createElement("div");
      title.style.fontSize = "18px";
      title.style.fontWeight = "bold";
      title.textContent = "Auto-paste failed";

      const desc = document.createElement("div");
      desc.style.fontSize = "14px";
      desc.style.color = "#c5c5c5";
      desc.textContent = "We couldn't automatically paste the context into ChatGPT. Please copy it below and paste it manually:";

      const textarea = document.createElement("textarea");
      textarea.id = "context-generator-fallback-text";
      textarea.readOnly = true;
      textarea.style.height = "150px";
      textarea.style.backgroundColor = "#1e1e1e";
      textarea.style.color = "#d4d4d4";
      textarea.style.border = "1px solid #4f4f4f";
      textarea.style.borderRadius = "6px";
      textarea.style.padding = "10px";
      textarea.style.fontFamily = "monospace";
      textarea.style.fontSize = "12px";
      textarea.style.resize = "none";

      const buttonContainer = document.createElement("div");
      buttonContainer.style.display = "flex";
      buttonContainer.style.justifyContent = "flex-end";
      buttonContainer.style.gap = "10px";

      const copyBtn = document.createElement("button");
      copyBtn.textContent = "Copy Context";
      copyBtn.style.padding = "8px 16px";
      copyBtn.style.borderRadius = "6px";
      copyBtn.style.border = "none";
      copyBtn.style.backgroundColor = "#d97706";
      copyBtn.style.color = "#ffffff";
      copyBtn.style.cursor = "pointer";
      copyBtn.style.fontWeight = "bold";

      const dismissBtn = document.createElement("button");
      dismissBtn.textContent = "Dismiss";
      dismissBtn.style.padding = "8px 16px";
      dismissBtn.style.borderRadius = "6px";
      dismissBtn.style.border = "1px solid #5f5f5f";
      dismissBtn.style.backgroundColor = "transparent";
      dismissBtn.style.color = "#ffffff";
      dismissBtn.style.cursor = "pointer";

      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = "Copied!";
          copyBtn.style.backgroundColor = "#10b981";
          setTimeout(() => {
            copyBtn.textContent = "Copy Context";
            copyBtn.style.backgroundColor = "#d97706";
          }, 2000);
        } catch (err) {
          textarea.select();
          document.execCommand("copy");
          copyBtn.textContent = "Copied!";
          copyBtn.style.backgroundColor = "#10b981";
        }
      });

      dismissBtn.addEventListener("click", () => {
        modal.remove();
      });

      buttonContainer.appendChild(dismissBtn);
      buttonContainer.appendChild(copyBtn);

      content.appendChild(title);
      content.appendChild(desc);
      content.appendChild(textarea);
      content.appendChild(buttonContainer);
      modal.appendChild(content);
      
      document.body.appendChild(modal);
    }

    const textarea = document.getElementById("context-generator-fallback-text");
    if (textarea) {
      textarea.value = text;
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
