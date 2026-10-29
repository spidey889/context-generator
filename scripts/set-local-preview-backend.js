// Temporarily point the unpacked extension at one exact Vercel preview host.
// Restore production before committing or packaging the extension.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "extension");
const backgroundPath = path.join(root, "background.js");
const manifestPath = path.join(root, "manifest.json");
const authPath = path.join(root, "local-preview-auth.js");
const production = "https://context-generator-five.vercel.app";
const previewImport = 'if (typeof importScripts === "function") importScripts("local-preview-auth.js");';

function configure(host) {
  if (host !== production && !/^https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(host)) {
    throw new Error("Provide an exact HTTPS vercel.app origin without a path or port.");
  }
  let authSource = null;
  if (host !== production) {
    const token = process.env.VERCEL_OIDC_TOKEN;
    if (!token) throw new Error("Set VERCEL_OIDC_TOKEN in the current process environment.");
    let expiry;
    try { expiry = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).exp * 1000; } catch {}
    if (!Number.isFinite(expiry) || expiry <= Date.now()) throw new Error("The OIDC token has no valid future expiry.");
    authSource = `globalThis.CapLocalPreviewAuth = ${JSON.stringify({ origin: host, expiresAt: expiry, token })};\n`;
  }
  let background = fs.readFileSync(backgroundPath, "utf8");
  // Chromium caches worker dependencies during installation: even a caught
  // import of a missing file can prevent startup. Include it only with authSource.
  background = background.replace(previewImport + "\r\n", "").replace(previewImport + "\n", "");
  if (authSource) background = previewImport + (background.includes("\r\n") ? "\r\n" : "\n") + background;
  let manifestText = fs.readFileSync(manifestPath, "utf8");
  const summary = /const SUMMARY_BACKEND_URL = "https:\/\/[a-z0-9.-]+\/api\/summarize";/g;
  const telemetry = /const TELEMETRY_ENDPOINT_URL = "https:\/\/[a-z0-9.-]+\/api\/telemetry";/g;
  if ((background.match(summary) || []).length !== 1 || (background.match(telemetry) || []).length !== 1) {
    throw new Error("Expected exactly one summary and telemetry endpoint.");
  }
  background = background.replace(summary, `const SUMMARY_BACKEND_URL = "${host}/api/summarize";`)
    .replace(telemetry, `const TELEMETRY_ENDPOINT_URL = "${host}/api/telemetry";`);
  const productionPermission = `"${production}/*"`;
  if (!manifestText.includes(productionPermission)) throw new Error("Production permission missing.");
  const newline = manifestText.includes("\r\n") ? "\r\n" : "\n";
  const oldSummary = fs.readFileSync(backgroundPath, "utf8").match(summary)[0];
  const previous = oldSummary.match(/https:\/\/[a-z0-9.-]+/)[0];
  const oldTelemetry = fs.readFileSync(backgroundPath, "utf8").match(telemetry)[0];
  if (!oldTelemetry.includes(`"${previous}/api/telemetry"`)) throw new Error("Summary and telemetry hosts differ.");
  if (previous !== production) {
    const temporaryPermission = `,${newline}    "${previous}/*"`;
    if (!manifestText.includes(productionPermission + temporaryPermission)) throw new Error("Previous preview permission is missing or moved.");
    manifestText = manifestText.replace(productionPermission + temporaryPermission, productionPermission);
  }
  if (host !== production) manifestText = manifestText.replace(productionPermission, `${productionPermission},${newline}    "${host}/*"`);
  JSON.parse(manifestText);
  if (authSource) fs.writeFileSync(authPath, authSource, { mode: 0o600 });
  fs.writeFileSync(backgroundPath, background);
  fs.writeFileSync(manifestPath, manifestText);
  if (!authSource) fs.rmSync(authPath, { force: true });
  console.log(host === production ? "Production backend restored. Reload the unpacked extension." : `Preview backend set to ${host}. Reload the unpacked extension. Restore production before committing or packaging.`);
}

try {
  const argument = process.argv[2];
  if (!argument || process.argv.length !== 3) throw new Error("Usage: node scripts/set-local-preview-backend.js <https://exact-host.vercel.app|production>");
  configure(argument === "production" ? production : argument);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
