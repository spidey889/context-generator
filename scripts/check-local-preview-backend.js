const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { prepareFirefoxExtension } = require("./prepare-firefox-extension");

const repo = path.resolve(__dirname, "..");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "cap-preview-test-"));
try {
  fs.mkdirSync(path.join(temp, "scripts"));
  fs.cpSync(path.join(repo, "extension"), path.join(temp, "extension"), { recursive: true, filter: file => path.basename(file) !== "local-preview-auth.js" });
  fs.copyFileSync(path.join(__dirname, "set-local-preview-backend.js"), path.join(temp, "scripts", "set-local-preview-backend.js"));
  const script = path.join(temp, "scripts", "set-local-preview-backend.js");
  const backgroundPath = path.join(temp, "extension", "background.js");
  const manifestPath = path.join(temp, "extension", "manifest.json");
  const originalBackground = fs.readFileSync(backgroundPath, "utf8");
  assert.doesNotMatch(originalBackground, /importScripts\("local-preview-auth\.js"\)/);
  const originalManifest = fs.readFileSync(manifestPath, "utf8");
  const token = `e30.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url")}.test`;
  const origin = "https://test-preview.vercel.app";
  execFileSync(process.execPath, [script, origin], { env: { ...process.env, VERCEL_OIDC_TOKEN: token } });
  assert.throws(() => prepareFirefoxExtension(temp), /Restore the production backend/);
  const worker = fs.readFileSync(backgroundPath, "utf8");
  assert.match(worker, /importScripts\("local-preview-auth\.js"\)/);
  assert.ok(fs.existsSync(path.join(temp, "extension/local-preview-auth.js")));
  const helper = worker.match(/function localPreviewAuthHeaders\(url\) \{[\s\S]*?\n\}/)[0];
  const context = { URL, Date, CapLocalPreviewAuth: { origin, token, expiresAt: Date.now() + 10000 } };
  vm.runInNewContext(`${helper}; globalThis.result = localPreviewAuthHeaders;`, context);
  assert.equal(context.result(`${origin}/api/summarize`)["x-vercel-trusted-oidc-idp-token"], token);
  assert.equal(Object.keys(context.result("https://context-generator-five.vercel.app/api/summarize")).length, 0);
  assert.equal(Object.keys(context.result("https://test-preview.vercel.app.evil.example/api/summarize")).length, 0);
  assert.equal(Object.keys(context.result("https://other-preview.vercel.app/api/telemetry")).length, 0);
  context.CapLocalPreviewAuth.expiresAt = Date.now() - 1;
  assert.equal(Object.keys(context.result(`${origin}/api/telemetry`)).length, 0);
  delete context.CapLocalPreviewAuth;
  assert.equal(Object.keys(context.result(`${origin}/api/telemetry`)).length, 0);
  execFileSync(process.execPath, [script, "production"]);
  assert.equal(fs.readFileSync(backgroundPath, "utf8"), originalBackground);
  assert.equal(fs.readFileSync(manifestPath, "utf8"), originalManifest);
  assert.equal(fs.existsSync(path.join(temp, "extension", "local-preview-auth.js")), false);
  const output = prepareFirefoxExtension(temp);
  assert.equal(fs.existsSync(path.join(output, "local-preview-auth.js")), false);
  console.log("Local preview routing, token binding, expiry, restore and package checks passed.");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
