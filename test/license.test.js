const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("repository and public website declare proprietary source terms", () => {
  const license = read("LICENSE");
  const packageJson = JSON.parse(read("package.json"));
  const publicCopy = [
    read("README.md"),
    read("extension/README.md"),
    read("index.html"),
    read("privacy.html"),
    read("index.legacy-2026-07-15.html")
  ].join("\n");

  assert.match(license, /All rights reserved\./);
  assert.match(license, /No permission is\s+granted to use, copy, modify/);
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, "UNLICENSED");
  const forbiddenPublicClaims = new RegExp(
    "\\bM" + "IT\\b|open[ -]?sour" + "ce|View source on GitHub|Explore the source|GitHub Stars",
    "i"
  );
  assert.doesNotMatch(publicCopy, forbiddenPublicClaims);
  assert.doesNotMatch(publicCopy, /github\.com\/spidey889\/context-generator/i);
});

test("public website image references resolve to tracked assets", () => {
  for (const page of ["index.html", "privacy.html", "analysis/index.html", "index.legacy-2026-07-15.html"]) {
    const source = read(page);
    const pageDirectory = path.dirname(path.join(ROOT, page));
    const imageSources = [...source.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/gi)]
      .map((match) => match[1])
      .filter((src) => !/^https?:\/\//i.test(src));

    assert.ok(imageSources.length > 0, `${page} should contain at least one local image`);
    for (const src of imageSources) {
      assert.ok(fs.existsSync(path.resolve(pageDirectory, src)), `${page} references missing image ${src}`);
    }
  }
});
