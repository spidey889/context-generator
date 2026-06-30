const MISTRAL_MAX_ATTEMPTS = 3;
const MISTRAL_RETRY_INTERVAL_MS = 700;

module.exports = async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "MISTRAL_API_KEY is not configured" });
  }

  let body = req.body || {};
  if (typeof req.body === "string") {
    try {
      body = JSON.parse(req.body || "{}");
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  const conversation = body.conversation;

  if (!conversation || typeof conversation !== "string") {
    return res.status(400).json({ error: "Missing conversation text" });
  }

  try {
    const mistralResponse = await fetchWithRetry("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `Summarize conversations for continuation by another AI assistant. Return the summary in exactly this format:
╔══════════════════════════════════════════╗
║         CONTEXT CARRY — READY TO PASTE        ║
╚══════════════════════════════════════════╝
🧠 WHO I AM
[2-3 lines: user's name if mentioned, what they're building, their background/role]
🎯 WHAT WE WERE DOING
[2-4 lines: the main goal or task of this conversation]
📍 WHERE WE LEFT OFF
[2-3 lines: the exact point the conversation stopped — last decision made, last thing discussed]
✅ DECISIONS MADE
[Bullet list of every important decision, choice, or conclusion reached]
⚠️ OPEN QUESTIONS
[Bullet list of things still unresolved or mid-discussion — if none, write "None"]
📦 KEY CONTEXT
[Any important details the new AI must know to help properly — tools being used, constraints, preferences, style, tone, etc.]
🔁 NEXT STEP
[One clear sentence: exactly what the user needs to do or ask next]
---
💬 PASTE THIS AT THE TOP OF YOUR NEW CHAT
Then write: "Continue from where we left off."`,
          },
          {
            role: "user",
            content: `Summarize this conversation so another AI can continue helping the user:\n\n${conversation}`,
          },
        ],
      }),
    });

    if (!mistralResponse.ok) {
      const details = await mistralResponse.text();
      console.error("Mistral API error:", details);
      return res.status(502).json({ error: "Failed to summarize conversation" });
    }

    const data = await mistralResponse.json();
    const summary = data.choices?.[0]?.message?.content?.trim();

    if (!summary) {
      return res.status(502).json({ error: "Mistral returned an empty summary" });
    }

    return res.status(200).json({ summary });
  } catch (error) {
    console.error("Summarize error:", error);
    return res.status(500).json({ error: "Unexpected summarization error" });
  }
};

async function fetchWithRetry(url, options) {
  let lastError = null;

  for (let attempt = 1; attempt <= MISTRAL_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.ok || !isRetryableMistralStatus(response.status) || attempt === MISTRAL_MAX_ATTEMPTS) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === MISTRAL_MAX_ATTEMPTS) throw error;
    }

    await delay(MISTRAL_RETRY_INTERVAL_MS * attempt);
  }

  throw lastError || new Error("Mistral request failed");
}

function isRetryableMistralStatus(status) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}
