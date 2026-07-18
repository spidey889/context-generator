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
    read("OLD_README.md"),
    read("extension/README.md"),
    read("index.html"),
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
