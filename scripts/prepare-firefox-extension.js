const fs = require("node:fs");
const path = require("node:path");

function prepareFirefoxExtension(root = path.resolve(__dirname, "..")) {
  root = fs.realpathSync(root);
  const source = path.join(root, "extension");
  if (fs.existsSync(path.join(source, "local-preview-auth.js"))) throw new Error("Restore the production backend before packaging.");
  if (!fs.readFileSync(path.join(source, "background.js"), "utf8").includes('const SUMMARY_BACKEND_URL = "https://context-generator-five.vercel.app/api/summarize";')) throw new Error("Restore the production backend before packaging.");
  const manifest = JSON.parse(fs.readFileSync(path.join(source, "manifest.json"), "utf8"));
  // A combined manifest loads, but Chromium reports the Firefox scripts as an
  // MV2 warning. Keep the unpacked/Store source Chromium-only and derive Firefox.
  manifest.background = { scripts: ["transfer-diagnostics.js", "large-transfer.js", manifest.background.service_worker] };
  manifest.browser_specific_settings = {
    gecko: {
      id: "{8f4d7c20-9f3b-4b7e-9c11-2f4cbe2d41a9}",
      data_collection_permissions: { required: ["personalCommunications"] }
    }
  };

  const dist = path.join(root, "dist");
  fs.mkdirSync(dist, { recursive: true });
  // Only replace this generated directory; never follow a redirected dist path.
  if (fs.realpathSync(dist) !== dist) throw new Error("dist must be a directory inside this checkout.");
  const output = path.join(dist, "firefox");
  fs.rmSync(output, { recursive: true, force: true });
  fs.cpSync(source, output, { recursive: true, filter: file => !file.toLowerCase().endsWith(".zip") && path.basename(file) !== "local-preview-auth.js" });
  fs.writeFileSync(path.join(output, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return output;
}

if (require.main === module) console.log(`Firefox extension prepared in ${prepareFirefoxExtension()}`);

module.exports = { prepareFirefoxExtension };
