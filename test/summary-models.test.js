const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { PGlite } = require("@electric-sql/pglite");
const { catalogs, generatedFiles, migrationSql, sync } = require("../scripts/sync-summary-models");
const { loadWithModelConfig } = require("./helpers/summary-models");
const config = require("../config/summary-models.json");
const root = path.join(__dirname, "..");

test("model catalogs, receipt recovery, display names and validators stay synchronized in CI", () => {
  sync({ check: true });
  assert.deepEqual(require("../supabase/functions/_shared/provider-failure").models, catalogs(config).providers);
});

test("a config-only swap reaches ordinary requests and retains only the new model's settings", async t => {
  const swapped = structuredClone(config);
  const primary = "example/new-summary:free", deepseek = config.summary.tokenharbor[0].model;
  swapped.models.push({ id: primary, provider: "openrouter", label: "New summary" });
  swapped.summary.openrouter[0].model = primary;
  swapped.summary.tokenharbor = [{ model: "new-tokenharbor-model:free", enabled: true }];
  swapped.models.push({ id: "new-tokenharbor-model:free", provider: "tokenharbor", label: "New TokenHarbor" });
  const api = loadWithModelConfig("../../api/summarize", swapped).__test;
  const oldFetch = global.fetch;
  t.after(() => { global.fetch = oldFetch; });
  let calls = 0;
  global.fetch = async (_url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    assert.equal(body.model, primary);
    assert.equal(body.provider.data_collection, "deny");
    assert.deepEqual(body.provider.max_price, { prompt: 0, completion: 0, request: 0 });
    return new Response(JSON.stringify({ model: primary, choices: [{ message: {
      content: "The accepted change is ready. Production verification remains pending." }, finish_reason: "stop" }] }));
  };
  const conversation = "x".repeat(350001);
  const result = await api.createSummaryWithFallback({ conversation, profile: api.getSummaryProfile(conversation), openrouterApiKey: "TEST_ONLY_KEY" });
  assert.equal(result.model, primary);
  assert.equal(calls, 1);
  assert.equal(api.getProviderRequestBudgetMs(primary), 90000);
  assert.equal(api.getProviderRequestBudgetMs(deepseek), 90000, "The separately pinned backup retains its full budget after a main-model swap");
  assert.equal(api.getConfiguredSummaryRoutes({ openrouterApiKey: "TEST_ONLY_KEY", largeInput: true })[0].model, primary);
  const profile = api.getSummaryProfile("x".repeat(9000));
  const messages = api.getInitialSummaryMessages("test", profile);
  assert.equal(api.getProviderRequestBody({ id: "tokenharbor" }, messages, profile, deepseek).max_tokens, profile.maxTokens + 8192);
  assert.equal(api.getProviderRequestBody({ id: "tokenharbor" }, messages, profile, "new-tokenharbor-model:free").max_tokens, profile.maxTokens);
  swapped.summary.gemini[0] = "gemini-new";
  swapped.models.push({ id: "gemini-new", provider: "gemini", label: "New Gemini", thinkingLevel: "LOW" });
  assert.equal(api.getProviderRequestBody({ id: "gemini" }, messages, profile, "gemini-new").generationConfig.thinkingConfig.thinkingLevel, "LOW");
});

test("large-chat model swaps stay separate and cannot inherit the old data-collection exception", () => {
  const swapped = structuredClone(config), id = "example/new-large:free";
  swapped.largeSummary.openrouter = id;
  swapped.models.push({ id, provider: "openrouter", label: "New large" });
  const { providerBodyBytes } = loadWithModelConfig("../../api/large-summary", swapped).__test;
  const api = loadWithModelConfig("../../api/summarize", swapped).__test;
  const profile = api.getSummaryProfile("x".repeat(350001));
  const messages = api.getInitialSummaryMessages("test", profile);
  const body = api.getProviderRequestBody({ id: "openrouter", allowLargeChatDataCollection: true }, messages, profile, id);
  assert.equal(body.provider.data_collection, "deny");
  assert.equal(body.temperature, 0.1);
  assert.equal(body.top_p, undefined);
  assert.equal(providerBodyBytes("test", profile), Buffer.byteLength(JSON.stringify({ ...body, stream: true })));
  assert.equal(api.getConfiguredSummaryRoutes({ openrouterApiKey: "TEST_ONLY_KEY" })[0].model, config.summary.openrouter[0].model);
  swapped.models.find(model => model.id === id).largeChatSampling = { temperature: 0.5 };
  const custom = api.getProviderRequestBody({ id: "openrouter", allowLargeChatDataCollection: true }, messages, profile, id);
  assert.equal(custom.temperature, 0.5, "Sampling settings do not require a collection exception");
  assert.equal(custom.provider.data_collection, "deny");
  assert.equal(api.getProviderRequestBody({ id: "openrouter" }, messages, profile, id).temperature, 0.1);
});

test("sync generates every new-model contract once, keeps old receipts and detects stale output", t => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "cap-summary-models-"));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(temporary).startsWith("cap-summary-models-"));
    fs.rmSync(temporary, { recursive: true, force: true });
  });
  const files = ["config/summary-models.json", "config/summary-models-db.json", ...generatedFiles(root, catalogs(config), config).map(([file]) => file)];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(temporary, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(temporary, file));
  }
  fs.mkdirSync(path.join(temporary, "supabase/migrations"), { recursive: true });
  const swapped = structuredClone(config), id = "example/new-summary:free";
  swapped.models.push({ id, provider: "openrouter", label: "New </script> model" });
  swapped.summary.openrouter[0].model = id;
  fs.writeFileSync(path.join(temporary, "config/summary-models.json"), JSON.stringify(swapped));
  assert.throws(() => sync({ root: temporary, check: true }), /models:sync/);
  assert.equal(fs.readdirSync(path.join(temporary, "supabase/migrations")).length, 0, "Checking must not write migrations");
  const changed = sync({ root: temporary });
  assert.ok(changed.includes("extension/background.js"));
  assert.ok(changed.includes("supabase/functions/_shared/summary-proof.mjs"));
  assert.equal(changed.filter(file => file.endsWith("_summary_models.sql")).length, 1);
  assert.deepEqual(sync({ root: temporary }), []);
  const contractContext = {};
  vm.runInNewContext(fs.readFileSync(path.join(temporary, "supabase/functions/_shared/provider-failure.js"), "utf8"), contractContext);
  assert.ok(contractContext.CapProviderFailure.models.openrouter.includes(id));
  const proof = fs.readFileSync(path.join(temporary, "supabase/functions/_shared/summary-proof.mjs"), "utf8");
  assert.ok(proof.includes(config.summary.openrouter[0].model) && proof.includes(id));
  const analysis = fs.readFileSync(path.join(temporary, "analysis/index.html"), "utf8");
  assert.ok(analysis.includes("New \\u003c/script> model"), "Config labels cannot terminate the inline script");
  fs.appendFileSync(path.join(temporary, "extension/background.js"), "\n");
  // Content outside generated blocks remains owned by its file, not the sync tool.
  sync({ root: temporary, check: true });
  fs.writeFileSync(path.join(temporary, "extension/background.js"), fs.readFileSync(path.join(temporary, "extension/background.js"), "utf8").replace(id, "stale-model"));
  assert.throws(() => sync({ root: temporary, check: true }), /stale files/);
});

test("invalid routes and removal of historical IDs fail before writing files", () => {
  const invalid = structuredClone(config);
  invalid.summary.openrouter[0].model = "missing-model";
  assert.throws(() => catalogs(invalid), /Unknown openrouter route/);
  const oldCatalog = catalogs(config), next = structuredClone(oldCatalog);
  next.reported.shift();
  assert.throws(() => migrationSql(oldCatalog, next), /Keep retired model/);
  next.reported = oldCatalog.reported;
  next.providers.openrouter.shift();
  assert.throws(() => migrationSql(oldCatalog, next), /Keep historical openrouter diagnostics/);
});

test("generated SQL extends transfer attribution and provider diagnostics while preserving rows and function access", async () => {
  const db = new PGlite();
  try {
    const previous = catalogs(config), updated = structuredClone(config), id = "example/new-summary:free";
    updated.models.push({ id, provider: "openrouter", label: "New summary" });
    const quote = text => "'" + text.replace(/'/g, "''") + "'";
    const allowed = previous.reported.map(quote).join(",");
    const signature = "uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb";
    await db.exec(`create table public.transfers(model text constraint transfers_model_attribution check(model in (${allowed})));
      insert into public.transfers values('local-direct');
      create function public.record_transfer_event(${signature}) returns void language plpgsql as $body$
      begin if $14 not in (${allowed}) or $15 not in (${allowed}) then raise exception 'invalid model'; end if; end; $body$;
      revoke all on function public.record_transfer_event(${signature}) from public;
      create function public.is_valid_provider_failure(payload jsonb) returns boolean language plpgsql as $body$
      declare rules constant jsonb := '${JSON.stringify({ model: { values: Object.values(previous.providers).flat() } })}'::jsonb;
        models constant jsonb := '${JSON.stringify(previous.providers)}'::jsonb;
      begin return models->(payload->>'provider') ? (payload->>'model'); end; $body$;`);
    const snapshot = () => db.query("select oid,proacl::text from pg_proc where proname in ('record_transfer_event','is_valid_provider_failure') order by oid");
    const before = (await snapshot()).rows;
    await db.exec(migrationSql(previous, catalogs(updated)));
    assert.deepEqual((await snapshot()).rows, before);
    assert.deepEqual((await db.query("select * from public.transfers")).rows, [{ model: "local-direct" }]);
    await db.query("insert into public.transfers values($1)", [id]);
    const result = await db.query("select public.is_valid_provider_failure($1::jsonb) valid", [JSON.stringify({ provider: "openrouter", model: id })]);
    assert.equal(result.rows[0].valid, true);
    assert.equal((await db.query("select public.is_valid_provider_failure($1::jsonb) valid", [JSON.stringify({ provider: "gemini", model: id })])).rows[0].valid, false);
    const definition = (await db.query(`select pg_get_functiondef('public.record_transfer_event(${signature})'::regprocedure) value`)).rows[0].value;
    assert.ok(definition.includes(id));
    await assert.rejects(() => db.query("insert into public.transfers values('unlisted-model')"), error => error.code === "23514");
  } finally { await db.close(); }
});
