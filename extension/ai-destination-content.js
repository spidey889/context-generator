(() => {
  if (window.__contextGeneratorAiDestinationLoaded) {
    return;
  }

  window.__contextGeneratorAiDestinationLoaded = true;

  const DESTINATIONS = {
    gemini: {
      name: "Gemini",
      host: "gemini.google.com",
      contenteditableSelectors: [
        ".ql-editor[contenteditable='true']",
        "rich-textarea [contenteditable='true']",
        "div[contenteditable='true'][aria-label*='prompt' i]",
        "div[contenteditable='true'][role='textbox']",
        "[contenteditable='true'][data-placeholder]",
        "[contenteditable='true']"
      ],
      fallbackSelectors: [
        "rich-textarea textarea",
        "textarea[aria-label*='prompt' i]",
        "textarea[placeholder]",
        "textarea"
      ]
    },
    grok: {
      name: "Grok",
      host: "grok.com",
      contenteditableSelectors: [
        "[data-testid='grokInput'][contenteditable='true']",
        "[data-testid='grok-input'][contenteditable='true']",
        "div[contenteditable='true'][aria-label*='ask' i]",
        "div[contenteditable='true'][role='textbox']",
        "[contenteditable='true'][data-placeholder]",
        "[contenteditable='true']"
      ],
      fallbackSelectors: [
        "[data-testid='grokInput'] textarea",
        "[data-testid='grok-input'] textarea",
        "textarea[data-testid='grokInput']",
        "textarea[data-testid='grok-input']",
        "textarea[placeholder*='ask' i]",
        "textarea[aria-label*='ask' i]",
        "textarea[placeholder]",
        "textarea"
      ]
    },
    deepseek: {
      name: "DeepSeek",
      host: "chat.deepseek.com",
      contenteditableSelectors: [
        "#chat-input[contenteditable='true']",
        "div[contenteditable='true'][aria-label*='message' i]",
        "div[contenteditable='true'][role='textbox']",
        "[contenteditable='true'][data-placeholder]",
        "[contenteditable='true']"
      ],
      fallbackSelectors: [
        "textarea[name='search']",
        "#chat-input",
        "textarea[placeholder*='message' i]",
        "textarea[placeholder]",
        "textarea"
      ]
    }
  };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "PASTE_CONTEXT") {
      return false;
    }

    pasteIntoDestination(message.text, message.destination)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  });

  async function pasteIntoDestination(text, destinationId) {
    const destination = getDestination(destinationId);
    if (!destination) {
      throw new Error("This AI destination is not supported.");
    }

    if (!text?.trim()) {
      throw new Error(`No text was provided for ${destination.name}.`);
    }

    const input = await findDestinationInput(destination);
    if (!input) {
      showFallbackModal(text.trim(), destination.name);
      throw new Error(`${destination.name} message input element could not be found.`);
    }

    setEditorText(input, text.trim());

    const sampleText = text.trim().slice(0, 20);
    const textContent = input.value || input.innerText || input.textContent || "";
    if (!textContent.includes(sampleText)) {
      showFallbackModal(text.trim(), destination.name);
      throw new Error(`Paste operation failed to populate the ${destination.name} editor.`);
    }
  }

  function getDestination(destinationId) {
    if (destinationId && DESTINATIONS[destinationId]) {
      return DESTINATIONS[destinationId];
    }

    return Object.values(DESTINATIONS).find((destination) => {
      return window.location.hostname === destination.host || window.location.hostname.endsWith(`.${destination.host}`);
    });
  }

  async function findDestinationInput(destination) {
    const startTime = Date.now();
    while (Date.now() - startTime < 10000) {
      const contenteditable = findElement(destination.contenteditableSelectors);
      if (contenteditable) {
        return contenteditable;
      }

      const fallback = findElement(destination.fallbackSelectors);
      if (fallback) {
        return fallback;
      }

      await new Promise((resolve) => setTimeout(resolve, 300));
    }

    return findElement(destination.fallbackSelectors);
  }

  function findElement(selectors) {
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
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function showFallbackModal(text, destinationName) {
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
      desc.id = "context-generator-fallback-desc";
      desc.style.fontSize = "14px";
      desc.style.color = "#c5c5c5";

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

    const desc = document.getElementById("context-generator-fallback-desc");
    if (desc) {
      desc.textContent = `We couldn't automatically paste the context into ${destinationName}. Please copy it below and paste it manually:`;
    }

    const textarea = document.getElementById("context-generator-fallback-text");
    if (textarea) {
      textarea.value = text;
    }
  }

  function isVisible(element) {
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }
})();
