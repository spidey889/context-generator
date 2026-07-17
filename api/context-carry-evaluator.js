"use strict";

// This evaluator is intentionally deterministic. It protects developer handoffs from
// invented high-signal facts without adding a second provider request to the normal path.
const EVALUATOR_VERSION = "developer-grounding-v1";
const FACT_KINDS = [
  "url",
  "filePath",
  "command",
  "commitHash",
  "version",
  "modelId",
  "errorCode",
  "codeIdentifier",
  "numberWithUnit"
];
const BLOCKING_FACT_KINDS = new Set([
  "url",
  "filePath",
  "command",
  "commitHash",
  "version",
  "modelId",
  "errorCode",
  "codeIdentifier"
]);
const TOKEN_LIMIT_FINISH_REASONS = new Set([
  "length",
  "max_tokens",
  "max_token",
  "max_output_tokens",
  "token_limit",
  "max_tokens_reached",
  "max_tokens_exceeded"
]);
const DEVELOPER_FILE_EXTENSIONS = [
  "c",
  "cc",
  "cpp",
  "css",
  "env",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "json",
  "lock",
  "md",
  "mjs",
  "php",
  "ps1",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "toml",
  "ts",
  "tsx",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zip"
];
const DEVELOPER_FILE_EXTENSION_PATTERN = DEVELOPER_FILE_EXTENSIONS.join("|");
const DEVELOPER_FILE_PATH_PATTERN = new RegExp(
  `^(?:[A-Za-z]:[\\\\/])?(?:\\.{0,2}[\\\\/])?(?:[A-Za-z0-9_@.-]+[\\\\/])*[A-Za-z0-9_@.-]+\\.(?:${DEVELOPER_FILE_EXTENSION_PATTERN})$`,
  "i"
);
const COMMAND_PREFIX_PATTERN = /^(?:npm|npx|pnpm|yarn|bun|git|node|deno|python|python3|pip|pip3|pytest|cargo|go|dotnet|mvn|gradle|docker|docker-compose|kubectl|curl|wget|powershell|pwsh|cmd|rg|grep|ls|cd|vercel|supabase)\b/;

function evaluateContextCarryGrounding({ conversation, summary, finishReason = null }) {
  const startedAt = nowMs();
  const sourceFacts = extractDeveloperFacts(conversation);
  const summaryFacts = extractDeveloperFacts(summary);
  const unsupportedFacts = findUnsupportedFacts(sourceFacts, summaryFacts);
  const blockingUnsupportedFacts = unsupportedFacts.filter((fact) => BLOCKING_FACT_KINDS.has(fact.kind));
  const warningFacts = unsupportedFacts.filter((fact) => !BLOCKING_FACT_KINDS.has(fact.kind));
  const latestUserFacts = extractDeveloperFacts(getLatestUserMessage(conversation));
  const missingLatestUserFacts = findMissingFacts(summaryFacts, latestUserFacts);
  const cutoffDetected = isTokenLimitFinishReason(finishReason);
  const score = Math.max(
    0,
    100
      - (cutoffDetected ? 50 : 0)
      - (blockingUnsupportedFacts.length * 25)
      - (warningFacts.length * 4)
      - (missingLatestUserFacts.length * 2)
  );

  return {
    version: EVALUATOR_VERSION,
    passed: !cutoffDetected && blockingUnsupportedFacts.length === 0,
    score,
    cutoffDetected,
    unsupportedFacts,
    blockingUnsupportedFacts,
    warningFacts,
    missingLatestUserFacts,
    evaluatorMs: Math.max(0, Math.round(nowMs() - startedAt))
  };
}

function getEvaluationMetadata(evaluation) {
  const unsupportedKinds = unique(evaluation.blockingUnsupportedFacts.map((fact) => fact.kind));
  const warningKinds = unique(evaluation.warningFacts.map((fact) => fact.kind));
  const missingLatestUserKinds = unique(evaluation.missingLatestUserFacts.map((fact) => fact.kind));

  return {
    version: evaluation.version,
    mode: "deterministic",
    passed: evaluation.passed,
    score: evaluation.score,
    evaluatorMs: evaluation.evaluatorMs,
    cutoffDetected: evaluation.cutoffDetected,
    unsupportedCount: evaluation.blockingUnsupportedFacts.length,
    unsupportedKinds,
    warningCount: evaluation.warningFacts.length,
    warningKinds,
    missingLatestUserFactCount: evaluation.missingLatestUserFacts.length,
    missingLatestUserKinds
  };
}

function createSkippedEvaluationMetadata(reason) {
  return {
    version: EVALUATOR_VERSION,
    mode: "deterministic",
    passed: true,
    score: 100,
    evaluatorMs: 0,
    cutoffDetected: false,
    unsupportedCount: 0,
    unsupportedKinds: [],
    warningCount: 0,
    warningKinds: [],
    missingLatestUserFactCount: 0,
    missingLatestUserKinds: [],
    skipped: true,
    reason
  };
}

function getEvaluationFailureReason(evaluation) {
  if (evaluation.cutoffDetected) return "provider output stopped at its token limit";
  const kinds = unique(evaluation.blockingUnsupportedFacts.map((fact) => fact.kind));
  return kinds.length
    ? `deterministic grounding check found unsupported developer facts (${kinds.join(", ")})`
    : "deterministic grounding check failed";
}

function extractDeveloperFacts(text) {
  const value = String(text || "");
  const facts = createFactStore();

  collectMatches(facts, "url", value, /\bhttps?:\/\/[^\s<>"'`]+/gi, normalizeUrl);
  collectFilePathFacts(facts, value);

  collectMatches(facts, "commitHash", value, /\b[0-9a-f]{7,40}\b/gi, normalizeLower, (candidate) => {
    return /[a-f]/i.test(candidate) && /\d/.test(candidate);
  });
  collectMatches(facts, "version", value, /\bv?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/g, normalizeLower);
  collectMatches(
    facts,
    "modelId",
    value,
    /\b(?:gpt|gemini|claude|mistral|ministral|llama|deepseek|grok|qwen|codex)[A-Za-z0-9._:-]*\b/gi,
    normalizeLower,
    (candidate) => /^(?:gpt|gemini|claude|mistral|ministral|llama|deepseek|grok|qwen|codex)(?:\d|.*[-_.:]v?\d)/i.test(candidate)
  );
  collectMatches(
    facts,
    "errorCode",
    value,
    /\b(?:ERR_[A-Z0-9_]+|E[A-Z][A-Z0-9_]{2,}|[A-Z][A-Z0-9]+(?:_[A-Z0-9]+)*_ERROR)\b/g,
    normalizeExact
  );
  collectMatches(
    facts,
    "codeIdentifier",
    value,
    /\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*\(\)/g,
    normalizeCodeIdentifier
  );
  collectMatches(
    facts,
    "codeIdentifier",
    value,
    /\b[A-Z][A-Z0-9]{1,}(?:_[A-Z0-9]+)+\b/g,
    normalizeCodeIdentifier
  );
  collectMatches(
    facts,
    "numberWithUnit",
    value,
    /\b\d[\d,]*(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|minutes?|hours?|days?|bytes?|kb|mb|gb|characters?|chars?|tokens?|words?|turns?|requests?|percent)\b|\b\d[\d,]*(?:\.\d+)?\s*%/gi,
    normalizeNumberWithUnit
  );

  collectInlineCodeFacts(facts, value);
  collectCommandLines(facts, value);

  return facts;
}

function collectInlineCodeFacts(facts, text) {
  for (const match of String(text || "").matchAll(/`([^`\r\n]+)`/g)) {
    const candidate = cleanFactValue(match[1]);
    if (!candidate) continue;
    if (COMMAND_PREFIX_PATTERN.test(stripCommandPrompt(candidate))) {
      addFact(facts, "command", candidate, normalizeCommand);
      continue;
    }
    if (
      /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\(\))?$/.test(candidate) ||
      /^[A-Z][A-Z0-9]{1,}(?:_[A-Z0-9]+)+$/.test(candidate)
    ) {
      addFact(facts, "codeIdentifier", candidate, normalizeCodeIdentifier);
    }
  }
}

function collectFilePathFacts(facts, text) {
  for (const token of String(text || "").split(/\s+/)) {
    // Long prose/code blobs are not credible standalone paths and should not be
    // handed to an expensive path expression.
    if (!token || token.length > 1024) continue;
    const candidate = cleanFactValue(token);
    if (!candidate || /^https?:\/\//i.test(candidate)) continue;
    if (DEVELOPER_FILE_PATH_PATTERN.test(candidate)) {
      addFact(facts, "filePath", candidate, normalizeFilePath);
    }
  }
}

function collectCommandLines(facts, text) {
  for (const line of String(text || "").split(/\r?\n/)) {
    const cleaned = stripCommandPrompt(line.replace(/^\s*(?:[-*+]\s+|>\s*)/, "").trim());
    if (!COMMAND_PREFIX_PATTERN.test(cleaned)) continue;
    addFact(facts, "command", cleaned, normalizeCommand);
  }
}

function findUnsupportedFacts(sourceFacts, summaryFacts) {
  const unsupported = [];
  for (const kind of FACT_KINDS) {
    for (const [normalized, original] of summaryFacts[kind]) {
      if (!sourceFacts[kind].has(normalized)) unsupported.push({ kind, value: original, normalized });
    }
  }
  return unsupported;
}

function findMissingFacts(summaryFacts, expectedFacts) {
  const missing = [];
  for (const kind of FACT_KINDS) {
    for (const [normalized, original] of expectedFacts[kind]) {
      if (!summaryFacts[kind].has(normalized)) missing.push({ kind, value: original, normalized });
    }
  }
  return missing;
}

function getLatestUserMessage(conversation) {
  const text = String(conversation || "");
  const matches = Array.from(text.matchAll(/(?:^|\n)User:\s*([\s\S]*?)(?=\n(?:User|Assistant):\s*|$)/gi));
  return matches.length ? matches[matches.length - 1][1].trim() : "";
}

function isTokenLimitFinishReason(finishReason) {
  const normalized = String(finishReason || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return TOKEN_LIMIT_FINISH_REASONS.has(normalized) || /(?:^|_)max_(?:output_)?tokens?(?:_|$)/.test(normalized);
}

function createFactStore() {
  return Object.fromEntries(FACT_KINDS.map((kind) => [kind, new Map()]));
}

function collectMatches(facts, kind, text, pattern, normalizer, predicate = null) {
  for (const match of String(text || "").matchAll(pattern)) {
    const candidate = cleanFactValue(match[0]);
    if (!candidate || (predicate && !predicate(candidate))) continue;
    addFact(facts, kind, candidate, normalizer);
  }
}

function addFact(facts, kind, original, normalizer) {
  const cleaned = cleanFactValue(original);
  const normalized = normalizer(cleaned);
  if (!normalized || facts[kind].has(normalized)) return;
  facts[kind].set(normalized, cleaned);
}

function cleanFactValue(value) {
  return String(value || "")
    .trim()
    .replace(/^[`'"([{<]+/, "")
    .replace(/[`'"\])}>.,;:!?]+$/, "")
    .trim();
}

function normalizeUrl(value) {
  const cleaned = cleanFactValue(value);
  try {
    const parsed = new URL(cleaned);
    return `${parsed.protocol.toLowerCase()}//${parsed.host.toLowerCase()}${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (_error) {
    return cleaned;
  }
}

function normalizeFilePath(value) {
  const normalized = cleanFactValue(value).replace(/\\/g, "/").replace(/^\.\//, "");
  return /^[A-Za-z]:\//.test(normalized) ? normalized.toLowerCase() : normalized;
}

function normalizeCommand(value) {
  return stripCommandPrompt(cleanFactValue(value)).replace(/\s+/g, " ").trim();
}

function stripCommandPrompt(value) {
  return String(value || "").replace(/^\s*(?:\$|>)\s*/, "").replace(/^PS\s+[^>\r\n]*>\s*/i, "").trim();
}

function normalizeNumberWithUnit(value) {
  return cleanFactValue(value).toLowerCase().replace(/,/g, "").replace(/\s+/g, " ");
}

function normalizeCodeIdentifier(value) {
  return cleanFactValue(value).replace(/\(\)$/, "");
}

function normalizeLower(value) {
  return cleanFactValue(value).toLowerCase();
}

function normalizeExact(value) {
  return cleanFactValue(value);
}

function unique(values) {
  return Array.from(new Set(values));
}

function nowMs() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

module.exports = {
  EVALUATOR_VERSION,
  evaluateContextCarryGrounding,
  extractDeveloperFacts,
  getEvaluationMetadata,
  createSkippedEvaluationMetadata,
  getEvaluationFailureReason,
  getLatestUserMessage,
  isTokenLimitFinishReason
};
