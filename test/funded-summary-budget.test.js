const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const http = require("node:http");
const test = require("node:test");
const { clockTest } = require("./helpers/clock");
const { reserveFundedSummaryBudget: reserve } = require("../api/funded-summary-budget");
const handler = require("../api/summarize");
const { acquireRequestSlot, RATE_LIMIT_MAX_CONCURRENT } = require("../api/request-security");
const STORE = "https://funded-budget.invalid";
const env = { KV_REST_API_URL: STORE, KV_REST_API_TOKEN: "test-budget" };
const conversation = "User: Keep the Windows build and pending Linux check.\n".repeat(50);
let requestId = 1;
function request() {
  const ip = `192.0.2.${requestId++}`;
  return Object.assign(new EventEmitter(), { method: "POST", body: { conversation }, headers: {
    "content-type": "application/json", "x-cap-context-client": "cap-context-extension/1",
    "x-vercel-forwarded-for": ip, "x-forwarded-for": ip
  } });
}
function response() {
  return Object.assign(new EventEmitter(), { writableEnded: false, setHeader() {},
    status(code) { this.code = code; return this; }, json(body) { this.body = body; this.writableEnded = true; } });
}
function isolate(t, values = {}) {
  const names = ["KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
    "FUNDED_SUMMARY_IP_DAILY_UNITS", "FUNDED_SUMMARY_GLOBAL_DAILY_UNITS", "GEMINI_API_KEY",
    "MISTRAL_API_KEY", "MISTRAL_ENABLED", "OPENROUTER_API_KEY", "OPENROUTER_ENABLED", "OPENROUTER_LING_ENABLED"];
  const saved = names.map(name => process.env[name]);
  const originalFetch = global.fetch;
  names.forEach(name => { delete process.env[name]; });
  Object.assign(process.env, { ...env, OPENROUTER_ENABLED: "false", MISTRAL_ENABLED: "true", ...values });
  t.after(() => {
    global.fetch = originalFetch;
    names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; });
  });
  return originalFetch;
}

test("shared reservations charge both hashed-IP and global daily allowances atomically", async () => {
  const calls = [], counts = new Map();
  const fetchImpl = async (url, options) => {
    assert.equal(url, STORE);
    const command = JSON.parse(options.body);
    calls.push(command);
    assert.equal(command[0], "EVAL");
    assert.equal(command[2], 2);
    const keys = command.slice(3, 5), units = command[5], limits = command.slice(7);
    const allowed = keys.every((key, i) => (counts.get(key) || 0) + units <= limits[i]);
    if (allowed) keys.forEach(key => counts.set(key, (counts.get(key) || 0) + units));
    return new Response(JSON.stringify({ result: Number(allowed) }));
  };
  const options = { env: { ...env, FUNDED_SUMMARY_IP_DAILY_UNITS: "10", FUNDED_SUMMARY_GLOBAL_DAILY_UNITS: "15" }, fetchImpl, now: 0 };
  const first = { headers: { "x-vercel-forwarded-for": "203.0.113.1", "x-forwarded-for": "spoofed" } };
  const second = { headers: { "x-vercel-forwarded-for": "203.0.113.2" } };
  assert.equal(await reserve(first, 6, options), true);
  assert.equal(await reserve(first, 6, options), false);
  assert.equal(await reserve(second, 6, options), true);
  assert.equal(await reserve({ headers: { "x-vercel-forwarded-for": "203.0.113.3" } }, 6, options), false);
  assert.equal(counts.get(calls[0][4]), 12, "a denied reservation must not partially charge the global budget");
  assert.equal(calls[0][6], 86460);
  assert.doesNotMatch(JSON.stringify(calls), /203\.0\.113|spoofed|test-budget/);
  assert.equal(await reserve(first, 6, { ...options, now: 86400000 }), true);
  assert.notEqual(calls[0][4], calls.at(-1)[4]);
});

test("missing, invalid, zero, rejected and malformed shared accounting cannot admit funded work", async () => {
  for (const settings of [{}, { ...env, FUNDED_SUMMARY_IP_DAILY_UNITS: "0" },
    { ...env, FUNDED_SUMMARY_GLOBAL_DAILY_UNITS: "NaN" }, { ...env, KV_REST_API_URL: "http://bad" }]) {
    assert.equal(await reserve({ headers: {} }, 1, { env: settings, fetchImpl() { assert.fail("invalid config must not fetch"); } }), false);
  }
  for (const fetchImpl of [async () => new Response("{}", { status: 503 }),
    async () => new Response("not JSON"), async () => new Response('{"result":"1"}'),
    async () => { throw new Error("private store error"); }]) {
    assert.equal(await reserve({ headers: {} }, 1, { env, fetchImpl }), false);
  }
});

clockTest("accounting deadline covers a stalled response body and aborts its fetch", async () => {
  let signal;
  assert.equal(await reserve({ headers: {} }, 1, { env, fetchImpl: async (_url, options) => {
    signal = options.signal;
    return { ok: true, json: () => new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) };
  } }), false);
  assert.equal(signal.aborted, true);
});

test("no-Origin published-client request keeps exact local fallback when paid accounting is unavailable", async t => {
  isolate(t, { KV_REST_API_URL: "", GEMINI_API_KEY: "test-google", MISTRAL_API_KEY: "test-mistral" });
  global.fetch = () => { assert.fail("no funded provider may be contacted without shared accounting"); };
  const res = response();
  await handler(request(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.timing.model, "local-direct");
  assert.ok(res.body.summary.includes(conversation.trim().split("\n").map(line => `> ${line}`).join("\n")));
});

clockTest("every paid retry reserves prompt bytes plus maximum output before fetch; denial stops the chain", async t => {
  isolate(t, { GEMINI_API_KEY: "test-google", MISTRAL_API_KEY: "test-mistral" });
  const reservations = [], bodies = [], order = [];
  global.fetch = async (url, options) => {
    if (url === STORE) {
      order.push("reserve");
      reservations.push(JSON.parse(options.body)[5]);
      return new Response(JSON.stringify({ result: reservations.length < 3 ? 1 : 0 }));
    }
    order.push("provider");
    bodies.push(options.body);
    return new Response("{}", { status: 503 });
  };
  const res = response();
  await handler(request(), res);
  assert.deepEqual(order, ["reserve", "provider", "reserve", "provider", "reserve"]);
  assert.equal(reservations[0], Buffer.byteLength(bodies[0], "utf8") + JSON.parse(bodies[0]).generationConfig.maxOutputTokens);
  assert.equal(reservations[1], reservations[0]);
  assert.equal(res.body.timing.model, "local-direct");
  assert.equal(res.code, 200);
});

test("Mistral is reserved too; zero-price OpenRouter succeeds without funded accounting", async t => {
  isolate(t, { MISTRAL_API_KEY: "test-mistral" });
  let units, calls = 0;
  global.fetch = async (url, options) => {
    if (url === STORE) { units = JSON.parse(options.body)[5]; return new Response('{"result":1}'); }
    calls++;
    assert.equal(units, Buffer.byteLength(options.body, "utf8") + JSON.parse(options.body).max_tokens);
    return new Response(JSON.stringify({ choices: [{ message: { content: "Windows passed; Linux remains pending." } }] }));
  };
  const funded = response();
  await handler(request(), funded);
  assert.equal(funded.body.timing.provider, "mistral");
  assert.equal(calls, 1);
  process.env.KV_REST_API_URL = "";
  process.env.OPENROUTER_ENABLED = "true";
  process.env.OPENROUTER_API_KEY = "test-free";
  process.env.OPENROUTER_LING_ENABLED = "true";
  global.fetch = async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions");
    assert.deepEqual(JSON.parse(options.body).provider.max_price, { prompt: 0, completion: 0, request: 0 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "Windows passed; Linux remains pending." } }] }));
  };
  const free = response();
  await handler(request(), free);
  assert.equal(free.body.timing.provider, "openrouter");
});

for (const phase of ["headers", "body"]) {
  test(`caller disconnect aborts a real stalled provider ${phase} read without retry, fallback or response`, async t => {
    const nativeFetch = isolate(t, { GEMINI_API_KEY: "test-google", MISTRAL_API_KEY: "test-mistral" });
    const req = request(), res = response();
    let signal, calls = 0;
    const server = http.createServer((_req, upstream) => {
      if (phase === "body") { upstream.writeHead(200, { "Content-Type": "application/json" }); upstream.write("{"); }
      else setImmediate(() => { res.destroyed = true; res.emit("close"); });
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    global.fetch = async (url, options) => {
      if (url === STORE) return new Response('{"result":1}');
      calls++;
      signal = options.signal;
      req.emit("close"); // Normal request-body completion must not cancel the response.
      assert.equal(signal.aborted, false);
      const upstream = await nativeFetch(`http://127.0.0.1:${server.address().port}`, options);
      const readBody = upstream.json.bind(upstream);
      upstream.json = () => {
        const pending = readBody();
        res.destroyed = true; res.emit("close");
        return pending;
      };
      return upstream;
    };
    try {
      await handler(req, res);
      assert.equal(calls, 1);
      assert.equal(signal.aborted, true);
      assert.equal(res.body, undefined);
      assert.equal(res.listenerCount("close"), 0);
      const releases = Array.from({ length: RATE_LIMIT_MAX_CONCURRENT }, () => acquireRequestSlot());
      try { assert.ok(releases.every(release => typeof release === "function"), "disconnect must release summary capacity"); }
      finally { releases.forEach(release => release?.()); }
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
}

test("disconnect during a shared reservation never starts paid provider work", async t => {
  isolate(t, { GEMINI_API_KEY: "test-google" });
  const res = response();
  let signal;
  global.fetch = async (url, options) => {
    assert.equal(url, STORE);
    signal = options.signal;
    res.emit("close");
    throw signal.reason;
  };
  await handler(request(), res);
  assert.equal(signal.aborted, true);
  assert.equal(res.body, undefined);
});

test("finished response close does not abort a successful funded summary", async t => {
  isolate(t, { MISTRAL_API_KEY: "test-mistral" });
  const res = response();
  let signal;
  res.json = function(body) { this.body = body; this.writableEnded = true; this.emit("close"); };
  global.fetch = async (url, options) => {
    if (url === STORE) return new Response('{"result":1}');
    signal = options.signal;
    return new Response(JSON.stringify({ choices: [{ message: { content: "Windows passed; Linux remains pending." } }] }));
  };
  await handler(request(), res);
  assert.equal(res.body.timing.provider, "mistral");
  assert.equal(signal.aborted, false);
});

clockTest("disconnect during retry delay cancels the timer and no second reservation is made", async t => {
  isolate(t, { GEMINI_API_KEY: "test-google" });
  const res = response();
  let calls = 0;
  global.fetch = async (url) => {
    calls++;
    if (url === STORE) return new Response('{"result":1}');
    setTimeout(() => res.emit("close"), 100);
    return new Response("{}", { status: 503 });
  };
  await handler(request(), res);
  assert.equal(calls, 2);
  assert.equal(res.body, undefined);
});
