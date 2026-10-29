const test = require("node:test");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

test("local preview routing, authentication, restoration and packaging", () => {
  execFileSync(process.execPath, [path.join(__dirname, "../scripts/check-local-preview-backend.js")]);
});
