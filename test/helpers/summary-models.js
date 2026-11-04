const fs = require("node:fs");
const Module = require("node:module");

// Isolate a config-only model swap without changing production files or the
// shared require cache. The real routing/request code still executes unchanged.
function loadWithModelConfig(relativePath, config) {
  const filename = require.resolve(relativePath);
  const isolated = new Module(filename, module);
  isolated.filename = filename;
  isolated.paths = Module._nodeModulePaths(require("node:path").dirname(filename));
  isolated.require = name => {
    if (name === "../config/summary-models.json") return config;
    if (name === "./summarize" && relativePath.endsWith("large-summary")) return loadWithModelConfig("../../api/summarize", config);
    return Module.prototype.require.call(isolated, name);
  };
  isolated._compile(fs.readFileSync(filename, "utf8"), filename);
  return isolated.exports;
}

module.exports = { loadWithModelConfig };
