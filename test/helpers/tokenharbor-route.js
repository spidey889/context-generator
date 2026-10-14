const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");

// Keep regressions for paused routes executable without changing runtime flags
// or introducing a model override in the production API.
function loadTokenHarborRoute(model) {
  const filename = require.resolve("../../api/summarize");
  const models = [];
  const source = fs.readFileSync(filename, "utf8").replace(
    /(\{ model: "([^"]+)", enabled: )(true|false)( \})/g,
    (_match, prefix, candidate, _enabled, suffix) => {
      models.push(candidate);
      return `${prefix}${candidate === model}${suffix}`;
    });
  assert.ok(models.includes(model), "Test route must be a pinned TokenHarbor model");
  const isolated = new Module(filename, module);
  isolated.filename = filename;
  isolated.paths = module.paths;
  isolated._compile(source, filename);
  return isolated.exports.__test;
}

module.exports = { loadTokenHarborRoute };
