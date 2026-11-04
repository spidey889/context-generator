// Keep runtime catalogs closed and self-contained in Node, Deno and MV3.
// Generated literals avoid adding a new loader or deployment dependency there.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const ROOT = path.join(__dirname, "..");
const PROVIDERS = ["tokenharbor", "openrouter", "gemini", "mistral"];
const BEGIN = "// BEGIN GENERATED SUMMARY MODELS — npm run models:sync";
const END = "// END GENERATED SUMMARY MODELS";

function catalogs(config) {
  const ids = new Set();
  for (const model of config.models) {
    assert.match(model.id, /^[a-z0-9][a-z0-9/_.:-]{0,159}$/);
    assert.ok(!ids.has(model.id), `Duplicate model: ${model.id}`);
    ids.add(model.id);
    assert.ok(typeof model.label === "string" && model.label.length > 0 && model.label.length <= 120);
    assert.ok([...PROVIDERS, "local", "apodex"].includes(model.provider), "Unknown provider");
    assert.ok(model.legacyOnly === undefined || model.legacyOnly === true);
    if (model.reasoningTokens !== undefined) assert.ok(Number.isInteger(model.reasoningTokens) && model.reasoningTokens >= 0 && model.reasoningTokens <= 100000);
    if (model.firstAnswerTimeoutMs !== undefined) assert.ok(Number.isInteger(model.firstAnswerTimeoutMs) && model.firstAnswerTimeoutMs > 0 && model.firstAnswerTimeoutMs <= 90000);
    if (model.thinkingLevel !== undefined) assert.ok(["MINIMAL", "LOW", "MEDIUM", "HIGH"].includes(model.thinkingLevel));
    if (model.allowLargeChatDataCollection !== undefined) assert.equal(model.allowLargeChatDataCollection, true);
    if (model.largeChatSampling !== undefined) {
      assert.ok(Object.keys(model.largeChatSampling).every(key => ["temperature", "top_p"].includes(key)));
      for (const [key, value] of Object.entries(model.largeChatSampling)) assert.ok(Number.isFinite(value) && value >= 0 && value <= (key === "top_p" ? 1 : 2));
    }
  }
  const route = (id, provider) => assert.ok(config.models.some(model => model.id === id && model.provider === provider && !model.legacyOnly), `Unknown ${provider} route: ${id}`);
  const summary = config.summary;
  assert.equal(typeof summary.tokenharborEnabled, "boolean");
  assert.ok(summary.openrouter.length > 0 && summary.tokenharbor.length > 0);
  const switches = new Set();
  for (const entry of summary.openrouter) {
    route(entry.model, "openrouter");
    assert.match(entry.enabledEnv, /^OPENROUTER_[A-Z0-9_]+_ENABLED$/);
    assert.ok(!switches.has(entry.enabledEnv), `Duplicate switch: ${entry.enabledEnv}`);
    switches.add(entry.enabledEnv);
    assert.equal(typeof entry.defaultEnabled, "boolean");
  }
  for (const entry of summary.tokenharbor) { route(entry.model, "tokenharbor"); assert.equal(typeof entry.enabled, "boolean"); }
  route(summary.tokenharborBackup, "tokenharbor");
  assert.equal(summary.gemini.length, 2, "Keep primary and fallback Gemini slots");
  summary.gemini.forEach(id => route(id, "gemini"));
  route(summary.mistral, "mistral");
  for (const provider of ["openrouter", "tokenharbor"]) route(config.largeSummary[provider], provider);
  return {
    reported: [...ids],
    providers: Object.fromEntries(PROVIDERS.map(provider => [provider,
      config.models.filter(model => model.provider === provider && !model.legacyOnly).map(model => model.id)]))
  };
}

function generatedFiles(root, catalog, config) {
  const array = JSON.stringify(catalog.reported, null, 2);
  const declarations = [
    ["extension/background.js", "TELEMETRY_REPORTED_MODELS", `const TELEMETRY_REPORTED_MODELS = new Set(${array});`],
    ["api/telemetry-validation.js", "REPORTED_MODELS", `const REPORTED_MODELS = new Set(${array});`],
    ["supabase/functions/transfer-telemetry/validation.mjs", "REPORTED_MODELS", `const REPORTED_MODELS = new Set(${array});`],
    ["supabase/functions/_shared/summary-proof.mjs", "LEGACY_RECEIPT_MODELS", `export const LEGACY_RECEIPT_MODELS = Object.freeze(${array});`],
    ["supabase/functions/_shared/provider-failure.js", "models", `const models = ${JSON.stringify(catalog.providers, null, 2)};`],
    ["analysis/index.html", "MODEL_DISPLAY_NAMES", `const MODEL_DISPLAY_NAMES = ${JSON.stringify(Object.fromEntries(config.models.map(model => [model.id, model.label])), null, 2).replace(/</g, "\\u003c")};`]
  ];
  return declarations.map(([file, name, code]) => {
    const source = fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");
    const pattern = new RegExp(`^([ \\t]*)(?:export )?const ${name} = [\\s\\S]*?;$`, "m");
    const match = source.match(pattern);
    assert.ok(match, `Missing generated constant: ${file}:${name}`);
    const indent = match[1];
    const block = [BEGIN, code, END].join("\n").split("\n").map(line => indent + line).join("\n");
    const start = source.indexOf(indent + BEGIN);
    const end = source.indexOf(indent + END);
    const content = start < 0 ? source.replace(pattern, block)
      : source.slice(0, start) + block + source.slice(end + indent.length + END.length);
    assert.ok(start < 0 || end > start, `Broken generated markers: ${file}`);
    return [file, content];
  });
}

function migrationSql(previous, next) {
  // Never remove historical IDs: queued receipts and existing rows still use them.
  for (const id of previous.reported) assert.ok(next.reported.includes(id), `Keep retired model ${id} in models`);
  for (const provider of PROVIDERS) for (const id of previous.providers[provider])
    assert.ok(next.providers[provider].includes(id), `Keep historical ${provider} diagnostics for ${id}`);
  const additions = next.reported.filter(id => !previous.reported.includes(id));
  const quote = value => "'" + value.replace(/'/g, "''") + "'";
  const extend = additions.length ? `
  original := pg_get_functiondef('public.record_transfer_event(uuid,text,timestamptz,text,text,integer,text,text,text,text,boolean,timestamptz,timestamptz,text,text,jsonb)'::regprocedure);
  updated := replace(original, '''local-direct''', '''local-direct'',${additions.map(quote).join(",").replace(/'/g, "''")}');
  if updated = original then raise exception 'Transfer model allowlist was not found'; end if;
  execute updated;
  select pg_get_constraintdef(oid) into strict original from pg_constraint
    where conrelid='public.transfers'::regclass and conname='transfers_model_attribution';
  updated := replace(original, '''local-direct''', '''local-direct'',${additions.map(quote).join(",").replace(/'/g, "''")}');
  if updated = original then raise exception 'Transfer model constraint was not found'; end if;
  alter table public.transfers drop constraint transfers_model_attribution;
  execute 'alter table public.transfers add constraint transfers_model_attribution ' || updated;
` : "";
  return `-- Generated by npm run models:sync; deploy before enabling new model routes.
-- Extend existing metadata contracts; preserve rows, counters and privileges.
begin;
do $migration$
declare original text; updated text; rules_text text; models_text text; rules jsonb;
begin${extend}
  original := pg_get_functiondef('public.is_valid_provider_failure(jsonb)'::regprocedure);
  rules_text := substring(original from $pattern$rules constant jsonb := '([^']+)'::jsonb$pattern$);
  models_text := substring(original from $pattern$models constant jsonb := '([^']+)'::jsonb$pattern$);
  if rules_text is null or models_text is null then raise exception 'Provider model contracts were not found'; end if;
  rules := jsonb_set(rules_text::jsonb, '{model,values}', ${quote(JSON.stringify(Object.values(next.providers).flat()))}::jsonb);
  execute replace(replace(original, quote_literal(rules_text), quote_literal(rules::text)),
    quote_literal(models_text), quote_literal(${quote(JSON.stringify(next.providers))}));
end;
$migration$;
commit;
`;
}

function sync({ root = ROOT, check = false, now = new Date() } = {}) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "config/summary-models.json"), "utf8"));
  const next = catalogs(config);
  const snapshotFile = "config/summary-models-db.json";
  const previous = JSON.parse(fs.readFileSync(path.join(root, snapshotFile), "utf8"));
  const files = generatedFiles(root, next, config);
  if (JSON.stringify(previous) !== JSON.stringify(next)) {
    const sql = migrationSql(previous, next);
    // Dates name append-only migrations; never rewrite a deployed SQL file.
    const stamp = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const file = `supabase/migrations/${stamp}_summary_models.sql`;
    assert.ok(!fs.existsSync(path.join(root, file)), "Migration timestamp already exists; rerun a second later");
    files.push([file, sql], [snapshotFile, JSON.stringify(next, null, 2) + "\n"]);
  }
  const changed = files.filter(([file, content]) => !fs.existsSync(path.join(root, file))
    || fs.readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n") !== content);
  if (check) assert.equal(changed.length, 0, `Run npm run models:sync; stale files: ${changed.map(([file]) => file).join(", ")}`);
  else for (const [file, content] of changed) fs.writeFileSync(path.join(root, file), content);
  return changed.map(([file]) => file);
}

if (require.main === module) {
  try {
    const changed = sync({ check: process.argv.includes("--check") });
    console.log(changed.length ? `Updated ${changed.join(", ")}` : "Summary model configuration is in sync.");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { catalogs, generatedFiles, migrationSql, sync };
