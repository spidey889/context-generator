const MISTRAL_MAX_ATTEMPTS = 2;
const MISTRAL_RETRY_INTERVAL_MS = 450;
const MISTRAL_TIMEOUT_MS = 80000;
const MISTRAL_CHAT_COMPLETIONS_URL = "https://api.mistral.ai/v1/chat/completions";
const MISTRAL_FAST_MODEL = "ministral-3b-2512";
const MISTRAL_QUALITY_MODEL = "mistral-large-2512";
const SUMMARY_PROFILES = [
  {
    id: "tiny",
    model: MISTRAL_FAST_MODEL,
    maxInputChars: 1200,
    targetWords: 180,
    minWords: 0,
    maxTokens: 700,
    allowExpansion: false,
    sectionBudget: "WHO I AM 1 short line; WHAT WE WERE DOING 2-3 lines; WHERE WE LEFT OFF 1-2 lines; DECISIONS MADE 0-3 bullets; OPEN QUESTIONS 0-2 bullets; KEY CONTEXT 2-4 dense bullets; NEXT STEP exactly as instructed.",
    templateHints: {
      who: "1 short line: user/project only if present",
      doing: "2-3 lines: the immediate task and why it matters",
      left: "1-2 lines: exact stopping point",
      decisions: "0-3 bullets: only real decisions",
      questions: "0-2 bullets, or None",
      context: "2-4 dense bullets: exact details worth carrying"
    }
  },
  {
    id: "small",
    model: MISTRAL_FAST_MODEL,
    maxInputChars: 8000,
    targetWords: 350,
    minWords: 0,
    maxTokens: 1000,
    allowExpansion: false,
    sectionBudget: "WHO I AM 30-60 words; WHAT WE WERE DOING 60-90; WHERE WE LEFT OFF 40-70; DECISIONS MADE 3-6 compact bullets; OPEN QUESTIONS 1-4 bullets or None; KEY CONTEXT 80-140 words in compact bullets; NEXT STEP exactly as instructed.",
    templateHints: {
      who: "30-60 words: user/project/preferences that matter",
      doing: "60-90 words: actual task and concrete direction",
      left: "40-70 words: latest state and next validation point",
      decisions: "3-6 compact bullets if available",
      questions: "1-4 compact bullets, or None",
      context: "80-140 words in compact bullets: files, constraints, exact copy, commands, risks"
    }
  },
  {
    id: "medium",
    model: MISTRAL_FAST_MODEL,
    maxInputChars: 60000,
    targetWords: 700,
    minWords: 0,
    maxTokens: 1900,
    allowExpansion: false,
    sectionBudget: "WHO I AM 50-90 words; WHAT WE WERE DOING 110-160; WHERE WE LEFT OFF 80-120; DECISIONS MADE 5-9 compact bullets; OPEN QUESTIONS 2-6 bullets or None; KEY CONTEXT 180-280 words in dense bullets; NEXT STEP exactly as instructed.",
    templateHints: {
      who: "50-90 words: durable user/project context",
      doing: "110-160 words: task, product/repo/platform, attempts, direction",
      left: "80-120 words: latest state, blocker, next validation",
      decisions: "5-9 compact bullets preserving tradeoffs",
      questions: "2-6 compact bullets, or None",
      context: "180-280 words in dense bullets: files, functions, commands, errors, tests, deployment state, constraints"
    }
  },
  {
    id: "large",
    model: MISTRAL_QUALITY_MODEL,
    maxInputChars: Infinity,
    targetWords: 1200,
    minWords: 1100,
    maxTokens: 4200,
    allowExpansion: true,
    sectionBudget: "WHO I AM 80-140 words; WHAT WE WERE DOING 170-240; WHERE WE LEFT OFF 120-180; DECISIONS MADE 180-280; OPEN QUESTIONS 100-180; KEY CONTEXT 350-500; NEXT STEP exactly as instructed.",
    templateHints: {
      who: "80-140 words: user's name if mentioned, what they are building or trying to do, role/background/preferences that matter, and any durable context the next AI must know",
      doing: "170-240 words: the actual task, product/repo/platform, why it mattered, what was tried or discussed, and the concrete direction the user wanted",
      left: "120-180 words: exact stopping point, latest state, latest user instruction, current blocker or next validation point",
      decisions: "180-280 words in compact bullets: every important decision, tradeoff, deferred choice, accepted risk, rejected option, and reason when available",
      questions: "100-180 words in compact bullets: unresolved risks, validation gaps, review concerns, things deferred by the user, or None only when truly nothing remains",
      context: "350-500 words in dense bullets: exact files, functions, constants, commands, errors, tests, deployment state, APIs, model IDs, payload sizes, user constraints, tone/copy requirements, and anything that prevents repeating work"
    }
  }
];
const CONTEXT_CARRY_TITLE = "CONTEXT CARRY — READY TO PASTE";
const CONTEXT_CARRY_BOX_HEADER = [
  "╔══════════════════════════════════════════╗",
  `║         ${CONTEXT_CARRY_TITLE}        ║`,
  "╚══════════════════════════════════════════╝"
].join("\n");
const CONTEXT_CARRY_HEADER_PATTERN = /(?:^|\n)\s*(?:#{1,6}\s*)?(?:\*\*)?CONTEXT\s+CARRY\s*(?:—|–|-|--)\s*READY\s+TO\s+PASTE(?:\*\*)?\s*:?\s*/i;
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
  const summaryProfile = getSummaryProfile(conversation);

  try {
    const mistralStartedAt = Date.now();
    const mistralResponse = await requestMistralSummary(apiKey, getInitialSummaryMessages(conversation, summaryProfile), summaryProfile);

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

    if (shouldExpandSummary(conversation, summaryWordCount, summaryProfile)) {
      expansion.attempted = true;
      try {
        const expansionResponse = await requestMistralSummary(
          apiKey,
          getExpansionSummaryMessages(conversation, summary, summaryWordCount, summaryProfile),
          summaryProfile
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
        model: summaryProfile.model,
        profile: summaryProfile.id,
        maxTokens: summaryProfile.maxTokens,
        targetWords: summaryProfile.targetWords,
        minWords: summaryProfile.minWords,
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
  shouldExpandSummary,
  getSummaryProfile,
  getContextCarryTemplate
};

function requestMistralSummary(apiKey, messages, profile) {
  return fetchWithRetry(MISTRAL_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: profile.model,
      temperature: 0.1,
      max_tokens: profile.maxTokens,
      messages,
    }),
  });
}

function getInitialSummaryMessages(conversation, profile) {
  return [
    {
      role: "system",
      content: getSummarySystemPrompt(profile),
    },
    {
      role: "user",
      content: `Create a dense continuation handoff from this conversation. Another AI should be able to continue the exact work without asking the user to repeat context:\n\n${conversation}`,
    },
  ];
}

function getExpansionSummaryMessages(conversation, draftSummary, wordCount, profile) {
  return [
    {
      role: "system",
      content: getSummarySystemPrompt(profile),
    },
    {
      role: "user",
      content: `The previous Context Carry was too short at about ${wordCount} words. Rewrite it into a fuller ${profile.targetWords}-word continuation handoff.

Rules for this rewrite:
- Output only the final Context Carry block.
- Preserve the exact template and NEXT STEP instruction.
- Expand KEY CONTEXT first, then DECISIONS MADE and OPEN QUESTIONS.
- Include concrete details from the original conversation, not generic filler.
- Target ${Math.max(profile.minWords, profile.targetWords - 100)}-${profile.targetWords + 100} words if the source conversation has enough real information.

Previous draft:
${draftSummary}

Original conversation:
${conversation}`,
    },
  ];
}

function getSummarySystemPrompt(profile) {
  return `You are the context-generator backend summarizer.
Your output must match the Context Generator SKILL.md template exactly.

Hard rules:
- Output only the filled context block. No intro, no commentary, no markdown fence.
- Start with the boxed header exactly as shown in the template.
- Keep every section heading exactly, including the emoji and capitalization.
- Do not rename, reorder, remove, or add sections.
- Replace bracket instructions with concrete, continuation-ready content from the conversation.
- Target about ${profile.targetWords} useful words for this conversation size. Do not duplicate or pad short chats.
- Use the ${profile.id} profile. Section budget: ${profile.sectionBudget}
- Do not be concise when useful continuation context exists, but do not manufacture detail when the chat itself is short.
- Make the result feel like a serious handoff to another capable AI, not a thin executive summary.
- Preserve exact names, files, APIs, model IDs, commands, error text, copy requirements, constraints, and latest working state when they matter.
- Prioritize what helps the next AI continue without re-asking the user or repeating work.
- For coding/product chats, include the concrete repo/app/platform, exact files/functions/constants, commands run, errors seen, tests or verification, deployment state, and user constraints.
- The KEY CONTEXT section should usually be the densest section. Use compact bullets there when that preserves more specifics, and include at least 6 bullets when enough details exist.
- DECISIONS MADE should preserve tradeoffs and deferred choices, not only final choices.
- OPEN QUESTIONS should include unresolved risks, review concerns, validation gaps, or decisions deferred by the user. Write "None" only when the transcript truly leaves no unresolved issue.
- Do not invent, correct, or infer project facts. If the transcript is unclear, say what is uncertain instead of guessing.
- Avoid broad labels like "security discussion", "early development", or platform names unless the transcript actually supports them.
- Do not pad or write generic filler; every line should carry useful context.
- If a section has no information, write "None" under that exact section.
- Do not add the closing footer from SKILL.md: no "PASTE THIS AT THE TOP OF YOUR NEW CHAT" and no "Continue from where we left off."
- The 🔁 NEXT STEP section must be exactly: ${DESTINATION_CONFIRMATION_INSTRUCTION}
- Before finalizing, silently check the total word count. If this is a large profile and the output is below ${profile.minWords || 0} words, expand KEY CONTEXT, DECISIONS MADE, and OPEN QUESTIONS with concrete details from the transcript.

Required template:
${getContextCarryTemplate(profile)}`;
}

function countWords(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function shouldExpandSummary(_conversation, wordCount, profile = SUMMARY_PROFILES[SUMMARY_PROFILES.length - 1]) {
  return Boolean(profile.allowExpansion && profile.minWords > 0 && wordCount > 0 && wordCount < profile.minWords);
}

function getSummaryProfile(conversation) {
  const inputChars = String(conversation || "").length;
  return SUMMARY_PROFILES.find((profile) => inputChars <= profile.maxInputChars) || SUMMARY_PROFILES[SUMMARY_PROFILES.length - 1];
}

function getContextCarryTemplate(profile) {
  const hints = profile.templateHints;
  return `${CONTEXT_CARRY_BOX_HEADER}

🧠 WHO I AM
[${hints.who}]

🎯 WHAT WE WERE DOING
[${hints.doing}]

📍 WHERE WE LEFT OFF
[${hints.left}]

✅ DECISIONS MADE
[${hints.decisions}]

⚠️ OPEN QUESTIONS
[${hints.questions}]

📦 KEY CONTEXT
[${hints.context}]

🔁 NEXT STEP
[One clear sentence: exactly what the user needs to do or ask next]`;
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
