// Existing provider fixtures must admit funded attempts without a real Redis
// store or network. Keep this wrapper scoped so quota regressions can deny them.
async function withFundedBudget(operation) {
  const fetchImpl = global.fetch;
  const names = ["KV_REST_API_URL", "KV_REST_API_TOKEN", "FUNDED_SUMMARY_IP_DAILY_UNITS", "FUNDED_SUMMARY_GLOBAL_DAILY_UNITS"];
  const saved = names.map(name => process.env[name]);
  Object.assign(process.env, { KV_REST_API_URL: "https://funded-budget.invalid", KV_REST_API_TOKEN: "test-budget",
    FUNDED_SUMMARY_IP_DAILY_UNITS: "2000000", FUNDED_SUMMARY_GLOBAL_DAILY_UNITS: "10000000" });
  global.fetch = async (url, options) => url === process.env.KV_REST_API_URL
    ? new Response('{"result":1}') : fetchImpl(url, options);
  try { return await operation(); } finally {
    global.fetch = fetchImpl;
    names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; });
  }
}
module.exports = { withFundedBudget };
