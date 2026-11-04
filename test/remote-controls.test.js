const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const controls = require("../extension/remote-controls");
const { STORAGE_KEY, INTERVAL_MS, defaults, validate, disabled, create } = controls;
const json = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const stopped = { version: 1, disabled: { transfers: ["gemini"], automaticPaste: ["*"] } };

function harness({ storage = {}, fetchImpl = async () => json(stopped), ...options } = {}) {
  const calls = [];
  let time = 1000000;
  const chrome = { storage: { local: {
    get: async () => structuredClone(storage),
    set: async values => Object.assign(storage, structuredClone(values))
  } } };
  const client = create({ chrome, endpoint: () => "https://example.invalid/extension-controls.json",
    now: () => time, fetchImpl: (...args) => { calls.push(args); return fetchImpl(...args); }, ...options });
  return { client, calls, storage, advance: () => { time += INTERVAL_MS; } };
}

test("controls accept only packaged features and sites; missing lists enable and explicit invalid lists reject", () => {
  assert.deepEqual(validate({ version: 1, disabled: {} }), defaults());
  const config = validate(stopped);
  assert.equal(disabled(config, "transfers", "claude", "gemini"), true);
  assert.equal(disabled(config, "transfers", "claude"), false);
  assert.equal(disabled(config, "automaticPaste", "grok"), true);
  for (const bad of [null, [], { version: 2, disabled: {} }, { version: 1, disabled: {}, script: "anything" },
    { version: 1, disabled: { arbitraryCode: ["*"] } }, { version: 1, disabled: { transfers: null } },
    { version: 1, disabled: { transfers: true } }, { version: 1, disabled: { transfers: ["Gemini"] } }])
    assert.equal(validate(bad), null);
});

test("anonymous bounded checks deduplicate across tabs and persist across worker restarts", async () => {
  const h = harness();
  const [one, two] = await Promise.all([h.client.refresh(), h.client.refresh()]);
  assert.deepEqual(one, validate(stopped)); assert.deepEqual(two, one);
  assert.equal(h.calls.length, 1);
  const [url, options] = h.calls[0];
  assert.equal(url, "https://example.invalid/extension-controls.json");
  assert.equal(options.method, "GET"); assert.equal(options.credentials, "omit");
  assert.equal(options.redirect, "error"); assert.equal(options.cache, "no-store");
  assert.equal(options.body, undefined); assert.deepEqual(options.headers, {});
  const restart = harness({ storage: h.storage, fetchImpl: () => assert.fail("fresh durable cache must avoid a request") });
  assert.deepEqual(await restart.client.refresh(), one);
});

test("HTTP, malformed, oversize and offline responses cannot undo a cached stop; a valid response can", async () => {
  for (const fetchImpl of [() => { throw Error("offline"); }, () => new Response("{}", { status: 503 }),
    () => new Response("not json", { headers: { "Content-Type": "application/json" } }),
    () => new Response("{}", { headers: { "Content-Type": "text/html" } }),
    () => json({ version: 2, disabled: {} }), () => json({ version: 1, disabled: { transfers: null } }),
    () => new Response(" ".repeat(8193), { headers: { "Content-Type": "application/json" } })]) {
    const h = harness({ storage: { [STORAGE_KEY]: { config: stopped, checkedAt: 1 } }, fetchImpl });
    assert.deepEqual(await h.client.refresh(), validate(stopped));
    assert.deepEqual(h.storage[STORAGE_KEY].config, validate(stopped));
    await h.client.refresh(); assert.equal(h.calls.length, 1, "failures also respect the one-minute retry limit");
  }
  const h = harness({ storage: { [STORAGE_KEY]: { config: stopped, checkedAt: 1 } }, fetchImpl: () => json(defaults()) });
  assert.deepEqual(await h.client.refresh(), defaults());
});

test("timeouts cover both headers and streamed body; late completion never changes accepted controls", async () => {
  let release;
  const h = harness({ timeoutMs: 15, storage: { [STORAGE_KEY]: { config: stopped, checkedAt: 1 } },
    fetchImpl: () => new Promise(resolve => { release = resolve; }) });
  assert.deepEqual(await h.client.refresh(), validate(stopped));
  release(json(defaults()));
  await new Promise(setImmediate);
  assert.deepEqual(h.client.current(), validate(stopped));
  const body = harness({ timeoutMs: 15, storage: h.storage, fetchImpl: () => new Response(new ReadableStream({ start() {} }),
    { headers: { "Content-Type": "application/json" } }) });
  body.advance();
  assert.deepEqual(await body.client.refresh(), validate(stopped));
  assert.equal(body.calls[0][1].signal.aborted, true);
});

test("first-install outage uses bundled defaults and a backward clock triggers a new bounded check", async () => {
  const h = harness({ fetchImpl: () => { throw Error("offline"); } });
  assert.deepEqual(await h.client.refresh(), defaults());
  const future = harness({ storage: { [STORAGE_KEY]: { config: stopped, checkedAt: 9000000 } } });
  await future.client.refresh(); assert.equal(future.calls.length, 1);
});

test("the published controls are valid, bypass CDN caches and add no host or API permissions", () => {
  const root = path.join(__dirname, "..");
  assert.notEqual(validate(require("../extension-controls.json")), null,
    "Emergency edits may intentionally disable features; CI must validate them without requiring enabled settings.");
  const vercel = require("../vercel.json");
  const headers = vercel.headers.find(entry => entry.source === "/extension-controls.json").headers;
  for (const key of ["Cache-Control", "CDN-Cache-Control", "Vercel-CDN-Cache-Control"])
    assert.equal(headers.find(header => header.key === key).value, "no-store");
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "extension/manifest.json")));
  assert.deepEqual(manifest.permissions, ["alarms", "clipboardWrite", "scripting", "storage"]);
  assert.equal(manifest.host_permissions.length, 6);
  assert.deepEqual(manifest.content_scripts.find(entry => entry.js.includes("platform-content.js")).js,
    ["transfer-diagnostics.js", "remote-controls.js", "platform-content.js"]);
});
