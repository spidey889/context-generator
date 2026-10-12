const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");
const { classifyChanges, getScope } = require("../scripts/ci-scope");

const changed = path => ({ path, oldMode: "100644", newMode: "100644" });

test("CI light scope admits public media and docs while mixed/runtime/config changes stay full", () => {
  const light = ["README.md", "LOGIC.md", "CHANGELOG.md", "PRIVACY.md", "LICENSE", "CNAME", "docs/usage.md", "brag/brag.jpg", "brag/brag.mp4"];
  assert.equal(classifyChanges(light.map(changed)), "light");
  for (const file of ["extension/icon128.png", "extension/manifest.json", "extension/platform-content.js", "api/summarize.js",
    "supabase/migrations/change.sql", "package-lock.json", ".github/workflows/regression-gate.yml", "scripts/ci-scope.js",
    "test/ci-scope.test.js", "analysis/index.html", "tools/helper.js", "_config.yml", "unknown.txt", "brag/unsafe.svg"]) {
    assert.equal(classifyChanges([...light.map(changed), changed(file)]), "full", file);
  }
  for (const mode of ["120000", "160000", "100755"]) {
    assert.equal(classifyChanges([{ ...changed("brag/brag.jpg"), newMode: mode }]), "full");
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
  git("init", "-q", "-b", "master");
  // Build the same real commit graph in one import instead of repeatedly
  // spawning add/commit/rev-parse. Explicit identities/dates avoid signing,
  // hooks and machine Git configuration changing this disposable fixture.
  const data = content => `data ${Buffer.byteLength(content)}\n${content}\n`;
  const commit = (mark, parent, files, extra = "") =>
    `commit refs/heads/${mark === 1 ? "master" : "codex/light"}\nmark :${mark}\n`
    + `committer CI fixture <ci-fixture@example.invalid> ${1700000000 + mark} +0000\n`
    + data("fixture") + (parent ? `from :${parent}\n` : "")
    + Object.entries(files).map(([file, content]) => `M 100644 inline ${JSON.stringify(file)}\n${data(content)}`).join("")
    + extra + "\n";
  const history = commit(1, null, { "README.md": "Initial\n", "brag/image.png": "Initial image", "api/runtime.js": "module.exports = 1;\n" })
    + commit(2, 1, { "README.md": "New copy\n", "docs/space name.md": "Café documentation\n" })
    + commit(3, 2, { "brag/image.png": "New image" })
    + commit(4, 3, { "api/runtime.js": "module.exports = 2;\n" })
    + commit(5, 4, { "README.md": "Latest commit is docs only\n" })
    + commit(6, 5, {}, "R brag/image.png api/renamed.png\n") + "done\n";
  const marksPath = path.join(cwd, "fixture-marks");
  execFileSync("git", ["fast-import", "--quiet", "--done", `--export-marks=${marksPath}`],
    { cwd, input: history, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  const marks = new Map(fs.readFileSync(marksPath, "utf8").trim().split("\n").map(line => line.trim().split(" ")));
  const [base, docs, lightHead, runtimeHead, mixedHead, renamedHead] = [1, 2, 3, 4, 5, 6].map(mark => marks.get(`:${mark}`));
  assert.ok([base, docs, lightHead, runtimeHead, mixedHead, renamedHead].every(sha => /^[0-9a-f]{40}$/.test(sha)));
  git("remote", "add", "origin", cwd);
  const repository = { default_branch: "master" };
  const push = head => ({ eventName: "push", event: { before: base, repository }, head, ref: "refs/heads/codex/light", cwd });
  assert.deepEqual(getScope({ ...push(lightHead), event: { before: "0".repeat(40), repository } }), { mode: "light", base });
  assert.deepEqual(getScope({ ...push(lightHead), eventName: "pull_request", event: { pull_request: { base: { sha: base } } } }), { mode: "light", base });
  assert.deepEqual(getScope({ ...push(mixedHead), event: { before: runtimeHead, repository } }), { mode: "full", base },
    "a docs-only push after unmerged runtime code must still run full checks");
  assert.deepEqual(getScope({ ...push(lightHead), event: { before: docs, repository }, ref: "refs/heads/master" }), { mode: "light", base: docs });
  assert.deepEqual(getScope({ ...push(mixedHead), eventName: "pull_request", event: { pull_request: { base: { sha: docs } } } }), { mode: "full", base: docs });
  assert.deepEqual(getScope(push(renamedHead)), { mode: "full", base }, "renaming a media asset into runtime scope cannot bypass checks");
  for (const override of [{ eventName: "workflow_dispatch" }, { event: { before: base, forced: true } }, { event: {} }, { head: "invalid" }]) {
    assert.equal(getScope({ ...push(lightHead), ...override }).mode, "full");
  }
  assert.equal(getScope({ ...push(lightHead), event: { before: "0".repeat(40), repository: { default_branch: "master" } }, ref: "refs/heads/master" }).mode, "full");
});
