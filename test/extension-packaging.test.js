const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { prepareFirefoxExtension } = require("../scripts/prepare-firefox-extension");

test("Chromium loads only its worker; Firefox packaging preserves identity and current source files", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cap-context-packaging-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "extension");
  fs.cpSync(path.join(__dirname, "../extension"), source, { recursive: true });
  const original = fs.readFileSync(path.join(source, "manifest.json"), "utf8");
  const chromium = JSON.parse(original);
  assert.equal(chromium.manifest_version, 3);
  assert.deepEqual(chromium.background, { service_worker: "background.js" });
  assert.equal(Object.hasOwn(chromium, "browser_specific_settings"), false);

  const output = prepareFirefoxExtension(root);
  fs.writeFileSync(path.join(output, "stale.js"), "old generated file");
  fs.writeFileSync(path.join(source, "chrome.zip"), "old package");
  prepareFirefoxExtension(root);
  assert.equal(fs.existsSync(path.join(output, "stale.js")), false);
  assert.equal(fs.existsSync(path.join(output, "chrome.zip")), false);
  const firefox = JSON.parse(fs.readFileSync(path.join(output, "manifest.json"), "utf8"));
  assert.deepEqual(firefox.background, { scripts: ["transfer-diagnostics.js", "background.js"] });
  assert.deepEqual(firefox.browser_specific_settings, { gecko: {
    id: "{8f4d7c20-9f3b-4b7e-9c11-2f4cbe2d41a9}",
    data_collection_permissions: { required: ["personalCommunications"] }
  } });
  const { background, browser_specific_settings, ...firefoxShared } = firefox;
  const { background: worker, ...chromiumShared } = chromium;
  assert.deepEqual(firefoxShared, chromiumShared, "permissions, version and injection wiring stay aligned");
  for (const file of fs.readdirSync(output, { recursive: true })) {
    if (file === "manifest.json" || fs.statSync(path.join(output, file)).isDirectory()) continue;
    assert.deepEqual(fs.readFileSync(path.join(output, file)), fs.readFileSync(path.join(source, file)), file);
  }
  assert.equal(fs.readFileSync(path.join(source, "manifest.json"), "utf8"), original);
});
