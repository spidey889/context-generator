const assert = require("node:assert/strict");
const { loadWithModelConfig } = require("./summary-models");

// Keep regressions for paused routes executable without changing runtime flags
// or introducing a model override in the production API.
function loadTokenHarborRoute(model) {
  const config = structuredClone(require("../../config/summary-models.json"));
  assert.ok(config.summary.tokenharbor.some(route => route.model === model), "Test route must be a pinned TokenHarbor model");
  config.summary.tokenharbor.forEach(route => { route.enabled = route.model === model; });
  return loadWithModelConfig("../../api/summarize", config).__test;
}

module.exports = { loadTokenHarborRoute };
