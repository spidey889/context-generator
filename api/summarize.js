const MISTRAL_MAX_ATTEMPTS = 2;
const MISTRAL_RETRY_INTERVAL_MS = 450;
const MISTRAL_TIMEOUT_MS = 80000;
const MISTRAL_CHAT_COMPLETIONS_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_MODEL = "mistral-large-2512";
const CONTEXT_CARRY_TARGET_WORDS = 1200;
const CONTEXT_CARRY_MIN_WORDS = 1100;
const SUMMARY_EXPANSION_MIN_INPUT_CHARS = 4000;
const MISTRAL_MAX_TOKENS = Number(process.env.MISTRAL_MAX_TOKENS || 4200);
const CONTEXT_CARRY_TITLE = "CONTEXT CARRY — READY TO PASTE";
const CONTEXT_CARRY_BOX_HEADER = [
  "╔══════════════════════════════════════════╗",
  `║         ${CONTEXT_CARRY_TITLE}        ║`,
  "╚══════════════════════════════════════════╝"
].join("\n");
const CONTEXT_CARRY_HEADER_PATTERN = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?CONTEXT\s+CARRY\s*(?:—|–|-|--)\s*READY\s+TO\s+PASTE(?:\*\*)?\s*:?\s*/i;
const CONTEXT_CARRY_TEMPLATE = `${CONTEXT_CARRY_BOX_HEADER}

🧠 WHO I AM
[80-140 words: user's name if mentioned, what they are building or trying to do, role/background/preferences that matter, and any durable context the next AI must know]

🎯 WHAT WE WERE DOING
[170-240 words: the actual task, product/repo/platform, why it mattered, what was tried or discussed, and the concrete direction the user wanted]

📍 WHERE WE LEFT OFF
[120-180 words: exact stopping point, latest state, latest user instruction, current blocker or next validation point]

✅ DECISIONS MADE
[180-280 words in compact bullets: every important decision, tradeoff, deferred choice, accepted risk, rejected option, and reason when available]

⚠️ OPEN QUESTIONS
[100-180 words in compact bullets: unresolved risks, validation gaps, review concerns, things deferred by the user, or "None" only when truly nothing remains]

📦 KEY CONTEXT
[350-500 words in dense bullets: exact files, functions, constants, commands, errors, tests, deployment state, APIs, model IDs, payload sizes, user constraints, tone/copy requirements, and anything that prevents repeating work]

🔁 NEXT STEP
[One clear sentence: exactly what the user needs to do or ask next]`;
const CONTEXT_CARRY_SECTIONS = [
  { title: "WHO I AM", heading: "🧠 WHO I AM" },
  { title: "WHAT WE WERE DOING", heading: "🎯 WHAT WE WERE DOING" },
  { title: "WHERE WE LEFT OFF", heading: "📍 WHERE WE LEFT OFF" },
  { title: "DECISIONS MADE", heading: "✅ DECISIONS MADE" },
  { title: "OPEN QUESTIONS", heading: "⚠️ OPEN QUESTIONS" },
  { title: "KEY CONTEXT", heading: "📦 KEY CONTEXT" },
  { title: "NEXT STEP", heading: "🔁 NEXT STEP" }
];
const DESTINATION_CONFIRMATION_INSTRUCTION =
  'Reply only: "Context loaded. Let\'s pick up right where you left off." Then wait for the user.';

async function handler(req, res) {
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
    const mistralResponse = await requestMistralSummary(apiKey, getInitialSummaryMessages(conversation));

    if (!mistralResponse.ok) {
      const details = await mistralResponse.text();
      console.error("Mistral API error:", details);
      return res.status(502).json({ error: "Failed to summarize conversation" });
    }

    const data = await mistralResponse.json();
    let summary = normalizeContextCarrySummary(data.choices?.[0]?.message?.content);

    if (!summary) {
      return res.status(502).json({ error: "Mistral returned an empty summary" });
    }

    const expansion = {
      attempted: false,
      used: false,
      error: null
    };
    let summaryWordCount = countWords(summary);

    if (shouldExpandSummary(conversation, summaryWordCount)) {
      expansion.attempted = true;
      try {
        const expansionResponse = await requestMistralSummary(
          apiKey,
          getExpansionSummaryMessages(conversation, summary, summaryWordCount)
        );

        if (expansionResponse.ok) {
          const expansionData = await expansionResponse.json();
          const expandedSummary = normalizeContextCarrySummary(expansionData.choices?.[0]?.message?.content);
          const expandedWordCount = countWords(expandedSummary);
          expansion.wordCount = expandedWordCount;

          if (expandedSummary && expandedWordCount > summaryWordCount) {
            summary = expandedSummary;
            summaryWordCount = expandedWordCount;
            expansion.used = true;
          }
        } else {
          expansion.error = await expansionResponse.text();
          console.error("Mistral expansion error:", expansion.error);
        }
      } catch (error) {
        expansion.error = error?.message || "Expansion request failed";
        console.error("Mistral expansion failed:", error);
      }
    }

    const mistralMs = Date.now() - mistralStartedAt;

    return res.status(200).json({
      summary,
      timing: {
        totalMs: Date.now() - startedAt,
        mistralMs,
        model: MISTRAL_MODEL,
        maxTokens: MISTRAL_MAX_TOKENS,
        targetWords: CONTEXT_CARRY_TARGET_WORDS,
        minWords: CONTEXT_CARRY_MIN_WORDS,
        summaryWordCount,
        mistralPasses: expansion.attempted ? 2 : 1,
        expansion,
        inputChars: conversation.length,
        outputChars: summary.length
      }
    });
  } catch (error) {
    console.error("Summarize error:", error);
    return res.status(500).json({ error: "Unexpected summarization error" });
  }
}

module.exports = handler;
module.exports.__test = {
  normalizeContextCarrySummary,
  normalizeContextCarrySections,
  stripContextCarryFooter,
  countWords,
  shouldExpandSummary
};

function requestMistralSummary(apiKey, messages) {
  return fetchWithRetry(MISTRAL_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MISTRAL_MODEL,
      temperature: 0.1,
      max_tokens: MISTRAL_MAX_TOKENS,
      messages,
    }),
  });
}

function getInitialSummaryMessages(conversation) {
  return [
    {
      role: "system",
      content: getSummarySystemPrompt(),
    },
    {
      role: "user",
      content: `Create a dense continuation handoff from this conversation. Another AI should be able to continue the exact work without asking the user to repeat context:\n\n${conversation}`,
    },
  ];
}

function getExpansionSummaryMessages(conversation, draftSummary, wordCount) {
  return [
    {
      role: "system",
      content: getSummarySystemPrompt(),
    },
    {
      role: "user",
      content: `The previous Context Carry was too short at about ${wordCount} words. Rewrite it into a fuller ${CONTEXT_CARRY_TARGET_WORDS}-word continuation handoff.

Rules for this rewrite:
- Output only the final Context Carry block.
- Preserve the exact template and NEXT STEP instruction.
- Expand KEY CONTEXT first, then DECISIONS MADE and OPEN QUESTIONS.
- Include concrete details from the original conversation, not generic filler.
- Target 1150-1300 words if the source conversation has enough real information.

Previous draft:
${draftSummary}

Original conversation:
${conversation}`,
    },
  ];
}

function getSummarySystemPrompt() {
  return `You are the context-generator backend summarizer.
Your output must match the Context Generator SKILL.md template exactly.

Hard rules:
- Output only the filled context block. No intro, no commentary, no markdown fence.
- Start with the boxed header exactly as shown in the template.
- Keep every section heading exactly, including the emoji and capitalization.
- Do not rename, reorder, remove, or add sections.
- Replace bracket instructions with concrete, continuation-ready content from the conversation.
- Target about ${CONTEXT_CARRY_TARGET_WORDS} useful words when the conversation has enough real context. A substantial multi-turn conversation should not be under 1000 words.
- Do not be concise when useful continuation context exists. Use the token budget to preserve specifics.
- Make the result feel like a serious handoff to another capable AI, not a thin executive summary.
- Preserve exact names, files, APIs, model IDs, commands, error text, copy requirements, constraints, and latest working state when they matter.
- Prioritize what helps the next AI continue without re-asking the user or repeating work.
- For coding/product chats, include the concrete repo/app/platform, exact files/functions/constants, commands run, errors seen, tests or verification, deployment state, and user constraints.
- Use this section budget for substantial chats: WHO I AM 80-140 words; WHAT WE WERE DOING 170-240; WHERE WE LEFT OFF 120-180; DECISIONS MADE 180-280; OPEN QUESTIONS 100-180; KEY CONTEXT 350-500; NEXT STEP exactly as instructed.
- The KEY CONTEXT section should usually be the densest section. Use compact bullets there when that preserves more specifics, and include at least 6 bullets when enough details exist.
- DECISIONS MADE should preserve tradeoffs and deferred choices, not only final choices.
- OPEN QUESTIONS should include unresolved risks, review concerns, validation gaps, or decisions deferred by the user. Write "None" only when the transcript truly leaves no unresolved issue.
- Do not invent, correct, or infer project facts. If the transcript is unclear, say what is uncertain instead of guessing.
- Avoid broad labels like "security discussion", "early development", or platform names unless the transcript actually supports them.
- Do not pad or write generic filler; every line should carry useful context.
- If a section has no information, write "None" under that exact section.
- Do not add the closing footer from SKILL.md: no "PASTE THIS AT THE TOP OF YOUR NEW CHAT" and no "Continue from where we left off."
- The 🔁 NEXT STEP section must be exactly: ${DESTINATION_CONFIRMATION_INSTRUCTION}
- Before finalizing, silently check the total word count. If it is below 1100 words for a substantial conversation, expand KEY CONTEXT, DECISIONS MADE, and OPEN QUESTIONS with concrete details from the transcript.

Required template:
${CONTEXT_CARRY_TEMPLATE}`;
}

function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function shouldExpandSummary(conversation, wordCount) {
  return conversation.length >= SUMMARY_EXPANSION_MIN_INPUT_CHARS && wordCount > 0 && wordCount < CONTEXT_CARRY_MIN_WORDS;
}

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
  const withoutFence = stripWrappingCodeFence(String(text || ""));
  const withoutFooter = stripContextCarryFooter(withoutFence);
  const body = stripExistingContextCarryHeader(withoutFooter);
  if (!withoutFooter.trim()) return "";
  const normalizedBody = normalizeContextCarrySections(body);

  return normalizedBody ? `${CONTEXT_CARRY_BOX_HEADER}\n\n${normalizedBody}` : CONTEXT_CARRY_BOX_HEADER;
}

function stripExistingContextCarryHeader(text) {
  const lines = text.trim().split(/\r?\n/);
  let index = 0;
  while (index < lines.length && !lines[index].trim()) index += 1;

  if (isContextCarryBoxLine(lines[index])) {
    while (index < lines.length && (isContextCarryBoxLine(lines[index]) || !lines[index].trim())) {
      index += 1;
    }
    return lines.slice(index).join("\n").trim();
  }

  const trimmed = lines.slice(index).join("\n").trim();
  const match = trimmed.match(CONTEXT_CARRY_HEADER_PATTERN);
  if (!match) return trimmed;

  return trimmed.slice(match.index + match[0].length).trim();
}

function stripWrappingCodeFence(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines[0]?.trim().startsWith("```")) return text.trim();

  lines.shift();
  if (lines[lines.length - 1]?.trim().startsWith("```")) {
    lines.pop();
  }

  return lines.join("\n").trim();
}

function stripContextCarryFooter(text) {
  const lines = text.trim().split(/\r?\n/);
  const footerIndex = lines.findIndex((line) => isContextCarryFooterLine(line));
  let endIndex = footerIndex === -1 ? lines.length : footerIndex;
  while (endIndex > 0 && isContextCarryFooterSeparator(lines[endIndex - 1])) {
    endIndex -= 1;
  }
  const keptLines = lines.slice(0, endIndex);

  return keptLines.join("\n").trim();
}

function normalizeContextCarrySections(text) {
  const sections = new Map();
  const introLines = [];
  let currentSection = null;
  let currentLines = [];

  const flushSection = () => {
    if (!currentSection) return;
    sections.set(currentSection.title, currentLines.join("\n").trim());
    currentSection = null;
    currentLines = [];
  };

  text.split(/\r?\n/).forEach((line) => {
    if (isContextCarryFooterLine(line) || isUnsupportedInstructionLine(line) || isContextCarryFooterSeparator(line)) return;

    const headingMatch = getContextCarrySectionMatch(line);
    if (headingMatch) {
      flushSection();
      currentSection = headingMatch.section;
      currentLines = headingMatch.inlineContent ? [headingMatch.inlineContent] : [];
      return;
    }

    if (currentSection) {
      currentLines.push(line.trimEnd());
    } else if (line.trim()) {
      introLines.push(line.trimEnd());
    }
  });
  flushSection();

  if (!sections.size) {
    sections.set("KEY CONTEXT", text.trim() || "None");
    sections.set("NEXT STEP", "Context loaded. Let's pick up right where you left off.");
  } else if (introLines.length && !sections.get("KEY CONTEXT")) {
    sections.set("KEY CONTEXT", introLines.join("\n").trim());
  }
  sections.set("NEXT STEP", DESTINATION_CONFIRMATION_INSTRUCTION);

  return CONTEXT_CARRY_SECTIONS
    .map((section) => `${section.heading}\n${sections.get(section.title)?.trim() || "None"}`)
    .join("\n\n")
    .trim();
}

function getContextCarrySectionMatch(line) {
  const withoutMarkdown = line
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .replace(/^[-*]\s+/, "")
    .replace(/^(?:🧠|🎯|📍|✅|⚠️|⚠|📦|🔁)\s*/u, "")
    .trim();
  const normalized = withoutMarkdown
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/\s+/g, " ")
    .toUpperCase();

  for (const section of CONTEXT_CARRY_SECTIONS) {
    if (normalized === section.title) {
      return { section, inlineContent: "" };
    }
    if (normalized.startsWith(`${section.title}:`)) {
      return {
        section,
        inlineContent: withoutMarkdown.slice(section.title.length + 1).trim()
      };
    }
  }

  return null;
}

function isContextCarryBoxLine(line = "") {
  const trimmed = line.trim();
  return (
    /^╔═+╗$/.test(trimmed) ||
    /^╚═+╝$/.test(trimmed) ||
    /^║\s*CONTEXT\s+CARRY\s*(?:—|–|-|--)\s*READY\s+TO\s+PASTE\s*║$/i.test(trimmed)
  );
}

function isContextCarryFooterSeparator(line) {
  return /^-{3,}$/.test(line.trim());
}

function isUnsupportedInstructionLine(line) {
  return /^DESTINATION\s+AI\s*:/i.test(line.trim());
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
