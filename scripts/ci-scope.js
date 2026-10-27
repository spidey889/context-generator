const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { isDeepStrictEqual } = require("node:util");

const PUBLIC_PAGES = new Set(["privacy.html"]);
const DOCUMENTS = new Set(["README.md", "LOGIC.md", "CHANGELOG.md", "PRIVACY.md", "LICENSE", "CNAME"]);
const SHA = /^[0-9a-f]{40}$/;

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
}

function pageStructure(source) {
  const scripts = [];
  // Capture scripts before stripping HTML comments: a comment-like string in
  // JavaScript must never conceal a behavioral change from the classifier.
  const markup = source.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, script => {
    scripts.push(script);
    return "<script></script>";
  }).replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<style\b([^>]*)>[\s\S]*?<\/style\s*>/gi, (_, attributes) => `<style${attributes}></style>`);
  // Keep tags and wiring attributes unchanged. Only text, comments and CSS
  // qualify; adding/removing markup, changing links or event handlers does not.
  const tags = (markup.match(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g) || []).map(tag =>
    tag.replace(/\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g,
      (attribute, name) => name.toLowerCase() === "style" ? "" : attribute));
  return JSON.stringify({ scripts, tags });
}

function manifestVersion(value) {
  // Chrome compares up to four integer components, padding missing ones with 0.
  // https://developer.chrome.com/docs/extensions/reference/manifest/version
  if (typeof value !== "string" || !/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){0,3}$/.test(value)) return null;
  const parts = value.split(".").map(Number);
  if (parts.some(part => part > 65535) || parts.every(part => part === 0)) return null;
  return [...parts, ...Array(4 - parts.length).fill(0)];
}

function isVersionOnlyBump(baseSource, headSource) {
  try {
    const before = JSON.parse(baseSource);
    const after = JSON.parse(headSource);
    const oldVersion = manifestVersion(before?.version);
    const newVersion = manifestVersion(after?.version);
    if (!oldVersion || !newVersion) return false;
    const firstDifference = newVersion.findIndex((part, index) => part !== oldVersion[index]);
    // Comparing the whole parsed manifest keeps permissions, scripts and every
    // other field on the full gate even when a version bump accompanies them.
    return firstDifference !== -1 && newVersion[firstDifference] > oldVersion[firstDifference]
      && isDeepStrictEqual({ ...before, version: after.version }, after);
  } catch { return false; }
}

function classifyChanges(changes, readFile) {
  for (const change of changes) {
    const { path, oldMode, newMode } = change;
    // Symlinks/submodules must not masquerade as harmless images or docs.
    if (![oldMode, newMode].every(mode => mode === "100644" || mode === "000000")) return "full";
    if (path === "extension/manifest.json") {
      if (oldMode === "000000" || newMode === "000000" || typeof readFile !== "function"
          || !isVersionOnlyBump(readFile(path, "base"), readFile(path, "head"))) return "full";
      continue;
    }
    if (DOCUMENTS.has(path) || /^docs\/[^\n]+\.md$/.test(path)
        || /^brag\/[^\n]+\.(?:png|jpe?g|webp|avif|gif|mp4|webm)$/.test(path)) continue;
    if (!PUBLIC_PAGES.has(path) || oldMode === "000000" || newMode === "000000") return "full";
    if (pageStructure(readFile(path, "base")) !== pageStructure(readFile(path, "head"))) return "full";
  }
  return "light";
}

function getScope({ eventName, event, head, ref, cwd = process.cwd() }) {
  // Manual validation stays comprehensive. Missing/forced/unknown history also
  // keeps the full gate rather than guessing that the latest commit is enough.
  if (!["push", "pull_request"].includes(eventName) || !SHA.test(head) || event?.forced) return { mode: "full", base: "" };
  try {
    let base = eventName === "pull_request" ? event.pull_request?.base?.sha : event.before;
    if (eventName === "push") {
      const defaultBranch = event.repository?.default_branch;
      if (!defaultBranch || !SHA.test(base || "") || !ref?.startsWith("refs/heads/")) return { mode: "full", base: "" };
      if (ref !== `refs/heads/${defaultBranch}`) {
        // Compare every feature-branch push with production. A docs-only push
        // after failed/unmerged code must not give that code a lightweight pass.
        // This also handles a new verification branch's all-zero "before" SHA.
        git(["fetch", "--no-tags", "--depth=1", "origin", `refs/heads/${defaultBranch}`], cwd);
        base = git(["rev-parse", "FETCH_HEAD"], cwd).trim();
      }
    }
    if (!SHA.test(base || "") || base === "0".repeat(40)) return { mode: "full", base: "" };
    try { git(["cat-file", "-e", `${base}^{commit}`], cwd); }
    catch { git(["fetch", "--no-tags", "--depth=1", "origin", base], cwd); }
    // No rename inference: both the removed and added path must qualify.
    // NUL delimiters preserve filenames containing whitespace or newlines.
    const records = git(["diff", "--raw", "--no-renames", "--no-abbrev", "-z", base, head, "--"], cwd).split("\0");
    const changes = [];
    for (let index = 0; index < records.length - 1; index += 2) {
      const modes = /^:(\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ [A-Z]$/.exec(records[index]);
      if (!modes || !records[index + 1]) return { mode: "full", base };
      changes.push({ path: records[index + 1], oldMode: modes[1], newMode: modes[2] });
    }
    const mode = classifyChanges(changes, (path, side) => git(["show", `${side === "base" ? base : head}:${path}`], cwd));
    return { mode, base };
  } catch {
    console.warn("Could not classify the complete diff; running full checks.");
    return { mode: "full", base: "" };
  }
}

if (require.main === module) {
  let scope = { mode: "full", base: "" };
  try {
    scope = getScope({
      eventName: process.env.GITHUB_EVENT_NAME,
      event: JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8")),
      head: process.env.GITHUB_SHA,
      ref: process.env.GITHUB_REF
    });
  } catch { console.warn("Event metadata unavailable; running full checks."); }
  console.log(`Offline checks: ${scope.mode === "light" ? "lightweight manifest/site/documentation validation" : "full regression suite"}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `mode=${scope.mode}\nbase=${scope.base}\n`);
}

module.exports = { classifyChanges, getScope, pageStructure };
