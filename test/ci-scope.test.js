const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { classifyChanges, getScope } = require("../scripts/ci-scope");

const changed = path => ({ path, oldMode: "100644", newMode: "100644" });

test("CI light scope admits public media and docs while mixed/runtime/config changes stay full", () => {
  const light = ["README.md", "LOGIC.md", "CHANGELOG.md", "PRIVACY.md", "LICENSE", "CNAME", "docs/usage.md", "brag/picker-preview.png", "brag/brag.mp4"];
  assert.equal(classifyChanges(light.map(changed)), "light");
  for (const file of ["extension/icon128.png", "extension/manifest.json", "extension/platform-content.js", "api/summarize.js",
    "supabase/migrations/change.sql", "package-lock.json", ".github/workflows/regression-gate.yml", "scripts/ci-scope.js",
    "test/ci-scope.test.js", "analysis/index.html", "tools/helper.js", "_config.yml", "unknown.txt", "brag/unsafe.svg"]) {
    assert.equal(classifyChanges([...light.map(changed), changed(file)]), "full", file);
  }
  for (const mode of ["120000", "160000", "100755"]) {
    assert.equal(classifyChanges([{ ...changed("brag/picker-preview.png"), newMode: mode }]), "full");
  }
});

test("homepage copy/CSS qualify, while scripts, handlers, links and markup remain full", () => {
  const original = '<style>.hero{color:red}</style><p id="hero" style="color:red">Old copy</p><script>const note="<!-- old -->";</script>';
  const scope = source => classifyChanges([changed("index.html")], (_, side) => side === "base" ? original : source);
  assert.equal(scope(original.replace("Old copy", "New copy")), "light");
  assert.equal(scope(original.replace(/color:red/g, "color:blue")), "light");
  assert.equal(scope(`<!-- ordinary documentation -->${original}`), "light");
  for (const source of [original.replace("<!-- old -->", "<!-- new -->"), original.replace('id="hero"', 'id="other"'),
    original.replace("<p ", '<p onclick="alert(1)" '), `${original}<img src="missing.png">`,
    original.replace("<script>", '<script src="external.js">')]) assert.equal(scope(source), "full");
  const handler = '<button onclick="show(\' style=red\')">Text</button>';
  assert.equal(classifyChanges([changed("index.html")], (_, side) => side === "base" ? handler : handler.replace("red", "blue")), "full");
  assert.equal(classifyChanges([{ ...changed("index.html"), oldMode: "000000" }]), "full");
});

test("complete Git ranges, first branch pushes, PRs and ambiguous metadata select the correct gate", t => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "cap-context-ci-scope-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(cwd)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(cwd).startsWith("cap-context-ci-scope-"));
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const git = (...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (file, content) => {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), content);
  };
  const commit = () => { git("add", "--all"); git("commit", "-qm", "fixture"); return git("rev-parse", "HEAD"); };
  git("init", "-q", "-b", "master");
  git("config", "user.email", "ci-fixture@example.invalid");
  git("config", "user.name", "CI fixture");
  write("README.md", "Initial\n");
  write("brag/image.png", "Initial image");
  write("api/runtime.js", "module.exports = 1;\n");
  const base = commit();
  git("remote", "add", "origin", cwd);
  git("checkout", "-qb", "codex/light");
  write("README.md", "New copy\n");
  const docs = commit();
  write("brag/image.png", "New image");
  const lightHead = commit();
  const repository = { default_branch: "master" };
  const push = head => ({ eventName: "push", event: { before: base, repository }, head, ref: "refs/heads/codex/light", cwd });
  assert.equal(getScope(push(lightHead)).mode, "light");
  assert.equal(getScope({ ...push(lightHead), event: { before: "0".repeat(40), repository: { default_branch: "master" } } }).mode, "light");
  assert.equal(getScope({ ...push(lightHead), eventName: "pull_request", event: { pull_request: { base: { sha: base } } } }).mode, "light");
  write("api/runtime.js", "module.exports = 2;\n");
  const runtimeHead = commit();
  write("README.md", "Latest commit is docs only\n");
  const mixedHead = commit();
  assert.equal(getScope(push(mixedHead)).mode, "full", "earlier runtime changes cannot hide behind the latest docs commit");
  assert.equal(getScope({ ...push(mixedHead), event: { before: runtimeHead, repository } }).mode, "full",
    "a docs-only push after unmerged runtime code must still run full checks");
  assert.equal(getScope({ ...push(lightHead), event: { before: docs, repository }, ref: "refs/heads/master" }).mode, "light");
  assert.equal(getScope({ ...push(mixedHead), event: { before: "0".repeat(40), repository: { default_branch: "master" } } }).mode, "full");
  assert.equal(getScope({ ...push(mixedHead), eventName: "pull_request", event: { pull_request: { base: { sha: docs } } } }).mode, "full");
  git("mv", "brag/image.png", "api/renamed.png");
  assert.equal(getScope(push(commit())).mode, "full", "renaming a media asset into runtime scope cannot bypass checks");
  for (const override of [{ eventName: "workflow_dispatch" }, { event: { before: base, forced: true } }, { event: {} }, { head: "invalid" }]) {
    assert.equal(getScope({ ...push(lightHead), ...override }).mode, "full");
  }
  assert.equal(getScope({ ...push(lightHead), event: { before: "0".repeat(40), repository: { default_branch: "master" } }, ref: "refs/heads/master" }).mode, "full");
});
