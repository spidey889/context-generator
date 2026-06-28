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
    const mistralResponse = await fetch("https://api.mistral.ai/v1/chat/completions", {
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
            content:
              "Summarize conversations for continuation by another AI assistant. Preserve user goals, key decisions, constraints, open questions, and any important technical details.",
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
