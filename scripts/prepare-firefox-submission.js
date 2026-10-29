const fs = require("node:fs");
const path = require("node:path");
const { prepareFirefoxExtension } = require("./prepare-firefox-extension");

// Folder preparation only. The owner creates both ZIPs after reviewing them.
function prepareFirefoxSubmission() {
  const root = fs.realpathSync(path.resolve(__dirname, ".."));
  const upload = prepareFirefoxExtension(root);
  const source = path.join(root, "dist", "firefox-source");
  fs.rmSync(source, { recursive: true, force: true });
  fs.mkdirSync(path.join(source, "scripts"), { recursive: true });
  fs.cpSync(path.join(root, "extension"), path.join(source, "extension"), {
    recursive: true, filter: file => !file.toLowerCase().endsWith(".zip") && path.basename(file) !== "local-preview-auth.js"
  });
  fs.copyFileSync(path.join(__dirname, "prepare-firefox-extension.js"), path.join(source, "scripts", "prepare-firefox-extension.js"));
  fs.writeFileSync(path.join(source, "README.md"), `# Cap Context Firefox source\n\nVersion ${JSON.parse(fs.readFileSync(path.join(upload, "manifest.json"))).version}.\n\n## Reproduce the submitted files\n\nUse Node.js 22 or later (https://nodejs.org/). The packaging script uses only Node built-ins and works on Windows, macOS and Linux. No dependency installation, credentials or network calls are required.\n\nFrom this folder run:\n\n\`\`\`sh\nnode scripts/prepare-firefox-extension.js\n\`\`\`\n\nThe result is in dist/firefox/. Its contents must match the submitted extension. Zip the contents of that folder with manifest.json at archive root.\n\nThe JavaScript is original, readable source: there is no transpilation, minification, bundling, obfuscation or remotely loaded executable code. The script copies extension/ unchanged except for manifest.json: Chromium's service worker is replaced by ordered Firefox background scripts, the existing Gecko ID is retained, desktop Firefox 153+ is required, private-window use is disabled, and Firefox's chat-data/optional-diagnostics declarations are added.\n\nThe separately hosted summarization backend is not part of the browser package. Its responses are data, never executable code.\n`);
  // Rebuild using the submitted source itself, then compare every upload byte.
  const reproduced = prepareFirefoxExtension(source);
  const files = fs.readdirSync(upload, { recursive: true }).filter(file => fs.statSync(path.join(upload, file)).isFile()).sort();
  const rebuiltFiles = fs.readdirSync(reproduced, { recursive: true }).filter(file => fs.statSync(path.join(reproduced, file)).isFile()).sort();
  if (JSON.stringify(files) !== JSON.stringify(rebuiltFiles)) throw new Error("Source rebuild file list differs");
  for (const file of files) if (!fs.readFileSync(path.join(upload, file)).equals(fs.readFileSync(path.join(reproduced, file))))
    throw new Error(`Source rebuild differs: ${file}`);
  fs.rmSync(path.join(source, "dist"), { recursive: true, force: true });
  console.log(`Upload folder: ${upload}\nSource folder: ${source}\nVerified ${files.length} files reproduce exactly. No ZIP created.`);
}

if (require.main === module) prepareFirefoxSubmission();
