const MISTRAL_MAX_ATTEMPTS = 2;
const MISTRAL_RETRY_INTERVAL_MS = 450;
const MISTRAL_TIMEOUT_MS = 18000;
const MISTRAL_MODEL = process.env.MISTRAL_MODEL || "ministral-3b-2512";
const MISTRAL_MAX_TOKENS = Number(process.env.MISTRAL_MAX_TOKENS || 650);
const CONTEXT_CARRY_HEADER = "CONTEXT CARRY — READY TO PASTE";
const CONTEXT_CARRY_HEADER_PATTERN = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?CONTEXT\s+CARRY\s*(?:—|–|-|--)\s*READY\s+TO\s+PASTE(?:\*\*)?\s*:?\s*/i;

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

  const startedAt = Date.now();

  try {
    const mistralStartedAt = Date.now();
    const mistralResponse = await fetchWithRetry("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MISTRAL_MODEL,
        temperature: 0.2,
        max_tokens: MISTRAL_MAX_TOKENS,
        messages: [
          {
            role: "system",
            content: `Summarize conversations for continuation by another AI assistant.
Return only this compact, information-dense structure.
The first line must be exactly:
${CONTEXT_CARRY_HEADER}
WHO I AM: 2-3 lines if known.
WHAT WE WERE DOING: 2-4 specific lines.
WHERE WE LEFT OFF: 2-3 lines with the last decision/action.
DECISIONS MADE: bullets, only important decisions.
OPEN QUESTIONS: bullets, or "None".
KEY CONTEXT: constraints, tools, repo paths, preferences, exact strings, gotchas.
NEXT STEP: one clear sentence.
DESTINATION AI: Briefly confirm you have the context, e.g. "Context loaded. Let's pick up right where you left off.", instead of giving a long response right away.
Do not add a closing footer like "PASTE THIS AT THE TOP OF YOUR NEW CHAT" or "Continue from where we left off."
Keep it rich enough to continue the work, but under 350 words. No intro. Do not wrap the header in markdown or replace the dash.`,
          },
          {
            role: "user",
            content: `Summarize this conversation so another AI can continue helping the user:\n\n${conversation}`,
          },
        ],
      }),
    });
    const mistralMs = Date.now() - mistralStartedAt;

    if (!mistralResponse.ok) {
      const details = await mistralResponse.text();
      console.error("Mistral API error:", details);
      return res.status(502).json({ error: "Failed to summarize conversation" });
    }

    const data = await mistralResponse.json();
    const summary = normalizeContextCarrySummary(data.choices?.[0]?.message?.content);

    if (!summary) {
      return res.status(502).json({ error: "Mistral returned an empty summary" });
    }

    return res.status(200).json({
      summary,
      timing: {
        totalMs: Date.now() - startedAt,
        mistralMs,
        model: MISTRAL_MODEL,
        maxTokens: MISTRAL_MAX_TOKENS,
        inputChars: conversation.length,
        outputChars: summary.length
      }
    });
  } catch (error) {
    console.error("Summarize error:", error);
    return res.status(500).json({ error: "Unexpected summarization error" });
  }
};

async function fetchWithRetry(url, options) {
  let lastError = null;

  for (let attempt = 1; attempt <= MISTRAL_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MISTRAL_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      if (response.ok || !isRetryableMistralStatus(response.status) || attempt === MISTRAL_MAX_ATTEMPTS) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === MISTRAL_MAX_ATTEMPTS) throw error;
    } finally {
      clearTimeout(timeout);
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

function normalizeContextCarrySummary(text) {
  const withoutFooter = stripContextCarryFooter(String(text || ""));
  const body = stripExistingContextCarryHeader(withoutFooter);
  if (!withoutFooter.trim()) return "";

  return body ? `${CONTEXT_CARRY_HEADER}\n${body}` : CONTEXT_CARRY_HEADER;
}

function stripExistingContextCarryHeader(text) {
  const trimmed = text.trim();
  const match = trimmed.match(CONTEXT_CARRY_HEADER_PATTERN);
  if (!match) return trimmed;

  return trimmed.slice(match.index + match[0].length).trim();
}

function stripContextCarryFooter(text) {
  const lines = text.trim().split(/\r?\n/);
  const footerIndex = lines.findIndex((line) => isContextCarryFooterLine(line));
  const keptLines = footerIndex === -1 ? lines : lines.slice(0, footerIndex);

  return keptLines.join("\n").trim();
}

function isContextCarryFooterLine(line) {
  const normalized = line
    .replace(/^[\s#>*_`-]+/, "")
    .replace(/[\s*_`]+$/, "")
    .trim()
    .toLowerCase();

  return (
    normalized.startsWith("paste this at the top of your new chat") ||
    normalized.startsWith("continue from where we left off")
  );
}
