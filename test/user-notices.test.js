const assert = require("node:assert/strict");
const test = require("node:test");
const { create, validNotice } = require("../extension/user-notices");
const { createHandler, noticeForUser } = require("../backend/user-notices");

const INSTALL = "11111111-1111-4111-8111-111111111111";
const KEY = "context-generator-user-notices-v1";
const entries = { 49: "Your transfer is ready to try again. 🙂", 50: "A different user's message." };
const notice = noticeForUser(49, entries);
const sender = tabId => ({ tab: { id: tabId }, documentId: `document-${tabId}` });
const json = value => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

function delivery({ storage = { "context-generator-install-id-v1": INSTALL }, fetchImpl, sendMessage, ...options } = {}) {
  const sent = [], fetched = [];
  const client = create({
    chrome: { storage: { local: {
      get: async () => structuredClone(storage),
      set: async values => Object.assign(storage, structuredClone(values))
    } }, tabs: { sendMessage: async (...args) => { sent.push(args); return sendMessage ? sendMessage(...args) : { shown: true }; } } },
    endpoint: () => "https://example.invalid/api/user-notices",
    fetchImpl: async (...args) => { fetched.push(args); return fetchImpl ? fetchImpl(...args) : json({ notice }); },
    ...options
  });
  return { client, storage, sent, fetched };
}

test("notice delivery is once across tabs/restarts and reuses a persistent backend cache", async () => {
  const first = delivery();
  const replies = await Promise.all([first.client.check(sender(1)), first.client.check(sender(2))]);
  assert.equal(replies.filter(r => r.shown).length, 1);
  assert.equal(first.sent.length, 1);
  assert.deepEqual(first.sent[0], [1, { type: "SHOW_USER_NOTICE", notice }, { documentId: "document-1" }]);
  assert.equal(first.fetched.length, 1);
  const request = first.fetched[0][1];
  assert.deepEqual(JSON.parse(request.body), { install_id: INSTALL });
  assert.equal(request.credentials, "omit");
  const restarted = delivery({ storage: first.storage });
  assert.equal((await restarted.client.check(sender(3))).shown, false);
  assert.equal(restarted.fetched.length, 0);
  assert.equal(restarted.sent.length, 0);
});

test("busy/hidden documents explicitly refuse without consuming the pending notice", async () => {
  let ready = false;
  const run = delivery({ sendMessage: async () => ({ shown: ready }) });
  assert.equal((await run.client.check(sender(1))).shown, false);
  assert.deepEqual(run.storage[KEY].seen, []);
  ready = true;
  assert.equal((await run.client.check(sender(2))).shown, true);
  assert.equal(run.fetched.length, 1);
});

test("new messages arrive on a later check; removing a message clears the cached pending notice", async () => {
  let now = Date.now(), current = notice;
  const run = delivery({ now: () => now, fetchImpl: async () => json({ notice: current }) });
  await run.client.check(sender(1));
  current = noticeForUser(49, { 49: "A new message" });
  now += 300001;
  assert.equal((await run.client.check(sender(1))).shown, true);
  assert.equal(run.sent[1][1].notice.message, "A new message");
  current = null; now += 300001;
  await run.client.check(sender(1));
  assert.equal(run.storage[KEY].notice, null);
  assert.equal(run.sent.length, 2);
});

test("offline checks retain pending notices and throttle failures instead of interrupting transfers", async () => {
  const now = Date.now();
  const storage = { "context-generator-install-id-v1": INSTALL, [KEY]: { installId: INSTALL, checkedAt: now - 600000, notice, seen: [] } };
  const run = delivery({ storage, now: () => now, fetchImpl: async () => { throw new Error("PRIVATE_NETWORK_ERROR"); } });
  assert.equal((await run.client.check(sender(1))).shown, true);
  assert.equal((await run.client.check(sender(2))).shown, false);
  assert.equal(run.fetched.length, 1);
});

test("missing identities and declined Firefox diagnostics produce no notice traffic or new identity", async () => {
  for (const options of [{ storage: {} }, { hasConsent: async () => false }]) {
    const run = delivery(options);
    const before = structuredClone(run.storage);
    await run.client.check(sender(1));
    assert.deepEqual(run.storage, before);
    assert.equal(run.fetched.length + run.sent.length, 0);
  }
});

test("legacy #49 acknowledgement prevents the original message repeating after upgrade", async () => {
  const original = noticeForUser(49);
  const run = delivery({ storage: { "context-generator-install-id-v1": INSTALL,
    "context-generator-deepseek-retry-notice-seen-v1": true }, fetchImpl: async () => json({ notice: original }) });
  assert.equal((await run.client.check(sender(1))).shown, false);
  assert.equal(run.sent.length, 0);
  assert.ok(run.storage[KEY].seen.includes(original.id));
});

test("lost display acknowledgements cannot repeat a notice after a worker restart", async () => {
  const first = delivery({ displayTimeoutMs: 5, sendMessage: () => new Promise(() => {}) });
  assert.equal((await first.client.check(sender(1))).shown, false);
  const restarted = delivery({ storage: first.storage });
  await restarted.client.check(sender(2));
  assert.equal(restarted.sent.length, 0);
});

test("a missing recipient stays pending, while an ambiguous closed reply port cannot repeat", async () => {
  for (const [message, retry] of [["Could not establish connection. Receiving end does not exist.", true],
    ["No document with id document-1", true], ["The message port closed before a response was received.", false]]) {
    let ready = false;
    const run = delivery({ sendMessage: async () => { if (!ready) throw new Error(message); return { shown: true }; } });
    assert.equal((await run.client.check(sender(1))).shown, false);
    ready = true;
    assert.equal((await run.client.check(sender(2))).shown, retry);
  }
});

test("an installation change cannot receive the old installation's cached notice", async () => {
  let ready = false;
  const other = noticeForUser(50, entries);
  const run = delivery({ fetchImpl: async (_url, options) => json({
    notice: JSON.parse(options.body).install_id === INSTALL ? notice : other
  }), sendMessage: async () => ({ shown: ready }) });
  await run.client.check(sender(1));
  run.storage["context-generator-install-id-v1"] = "22222222-2222-4222-8222-222222222222";
  ready = true;
  assert.equal((await run.client.check(sender(2))).shown, true);
  assert.deepEqual(run.sent[1][1].notice, other);
  assert.equal(run.fetched.length, 2);
});

test("failed persistence prevents display and a hanging lookup has a firm timeout", async () => {
  const stalled = delivery({ timeoutMs: 5, fetchImpl: () => new Promise(() => {}) });
  assert.equal((await stalled.client.check(sender(1))).shown, false);
  assert.equal(stalled.sent.length, 0);
  const chrome = { storage: { local: { get: async () => ({ "context-generator-install-id-v1": INSTALL }),
    set: async () => { throw new Error("quota"); } } }, tabs: { sendMessage: () => assert.fail("must persist before showing") } };
  const client = create({ chrome, endpoint: () => "https://example.invalid", fetchImpl: async () => json({ notice }) });
  assert.equal((await client.check(sender(1))).shown, false);
});

test("malformed notice responses are ignored", async () => {
  for (const bad of [{ id: "bad", message: "Message" }, { id: notice.id, message: " " },
    { id: notice.id, message: "x".repeat(1001) }, { id: {}, message: "Message" }]) {
    assert.equal(Boolean(validNotice(bad)), false);
    const run = delivery({ fetchImpl: async () => json({ notice: bad }) });
    await run.client.check(sender(1));
    assert.equal(run.sent.length, 0);
  }
});

function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(status) { this.code = status; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}
const env = { SUPABASE_TELEMETRY_FUNCTION_URL: "https://example.invalid/relay",
  SUPABASE_TELEMETRY_PUBLISHABLE_KEY: "public-test-key", TELEMETRY_RELAY_SECRET: "private-test-relay-secret-0123456789abcdef" };
const request = changes => ({ method: "POST", headers: { "content-type": "application/json",
  "x-cap-context-client": "cap-context-extension/1" }, body: { install_id: INSTALL }, ...changes });

test("the exact notice rewrite reaches its separate handler without another Vercel function", async () => {
  const config = require("../vercel.json");
  assert.deepEqual(config.rewrites.find(rule => rule.source === "/api/user-notices"),
    { source: "/api/user-notices", destination: "/api/telemetry?cap_user_notices=1" });
  const relay = require("../api/telemetry");
  const res = response();
  await relay(request({ query: { cap_user_notices: "1" }, body: { install_id: INSTALL, userNumber: 50 } }), res);
  assert.equal(res.code, 400);
  assert.deepEqual(res.body, { code: "invalid_payload" });
});

test("backend resolves the installation and returns only that user's current text", async () => {
  for (const userNumber of [49, 50, 51, null]) {
    const calls = [];
    const handler = createHandler({ entries, env, rateLimit: async () => ({ allowed: true }), fetchImpl: async (...args) => {
      calls.push(args); return json({ userNumber });
    } });
    const res = response(); await handler(request(), res);
    assert.equal(res.code, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.deepEqual(res.body, { notice: noticeForUser(userNumber, entries) });
    assert.deepEqual(JSON.parse(calls[0][1].body), { kind: "user_notice_lookup", install_id: INSTALL });
    assert.equal(calls[0][1].headers["X-Cap-Context-Relay"], env.TELEMETRY_RELAY_SECRET);
    assert.doesNotMatch(JSON.stringify(res.body), /install_id|userNumber|private-test|public-test/);
  }
});

test("backend rejects public origins, user-number overrides and oversized requests before lookup", async () => {
  const handler = createHandler({ entries, env, fetchImpl: () => assert.fail("lookup not allowed") });
  for (const [req, expected] of [[request({ method: "GET" }), 405],
    [request({ headers: { origin: "https://evil.example", "content-type": "application/json" } }), 403],
    [request({ body: { install_id: INSTALL, userNumber: 50 } }), 400],
    [request({ body: { install_id: "bad" } }), 400], [request({ body: "x".repeat(257) }), 413],
    [request({ headers: { "x-cap-context-client": "cap-context-extension/1" } }), 415]]) {
    const res = response(); await handler(req, res); assert.equal(res.code, expected);
  }
});

test("backend handles preflight, rate limits and unavailable/stalled upstreams without leaking errors", async () => {
  const preflight = response();
  await createHandler()({ method: "OPTIONS", headers: { origin: `chrome-extension://${"a".repeat(32)}`,
    "access-control-request-method": "POST", "access-control-request-headers": "content-type,x-cap-context-client" } }, preflight);
  assert.equal(preflight.code, 204);
  const limited = response();
  await createHandler({ env, rateLimit: async () => ({ allowed: false, retryAfterSeconds: 60 }) })(request(), limited);
  assert.equal(limited.code, 429);
  assert.equal(limited.headers["retry-after"], "60");
  for (const options of [{ env: {} }, { fetchImpl: () => new Promise(() => {}) },
    { fetchImpl: async () => new Response("PRIVATE_DATABASE_ERROR", { status: 503 }) },
    { fetchImpl: async () => json({ userNumber: "49" }) }]) {
    const res = response();
    await createHandler({ env, timeoutMs: 5, rateLimit: async () => ({ allowed: true }), ...options })(request(), res);
    assert.equal(res.code, 503);
    assert.deepEqual(res.body, { code: "notices_unavailable" });
  }
});

test("notice file contains only valid user numbers and plain messages with stable IDs", () => {
  const file = require("../backend/user-notices.json");
  for (const [key, message] of Object.entries(file)) {
    assert.match(key, /^[1-9]\d*$/);
    assert.ok(Number.isSafeInteger(Number(key)));
    assert.equal(typeof message, "string");
    assert.equal(Boolean(validNotice(noticeForUser(Number(key)))), true);
  }
  assert.notEqual(noticeForUser(49, entries).id, noticeForUser(50, { 50: entries[49] }).id);
});

test("authenticated Edge lookup only reads the matching user number and never writes", async () => {
  const { createTelemetryHandler } = await import("../supabase/functions/transfer-telemetry/handler.mjs");
  const calls = [];
  const handler = createTelemetryHandler({
    getEnv: name => ({ TELEMETRY_RELAY_SECRET: env.TELEMETRY_RELAY_SECRET, SUPABASE_URL: "https://example.invalid",
      SUPABASE_SERVICE_ROLE_KEY: "private-test-key" })[name],
    createClient: () => ({ from: table => ({ select: column => ({ eq: (key, id) => ({ maybeSingle: async () => {
      calls.push({ table, column, key, id }); return { data: { user_no: 49 }, error: null };
    } }) }) }) })
  });
  const send = (body, relay = env.TELEMETRY_RELAY_SECRET) => handler(new Request("https://example.invalid/relay", {
    method: "POST", headers: { "content-type": "application/json", "x-cap-context-relay": relay }, body: JSON.stringify(body)
  }));
  const input = { kind: "user_notice_lookup", install_id: INSTALL };
  assert.equal((await send(input, "public-key")).status, 401);
  assert.equal((await send({ ...input, userNumber: 50 })).status, 400);
  assert.deepEqual(calls, []);
  const res = await send(input);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { userNumber: 49 });
  assert.deepEqual(calls, [{ table: "users", column: "user_no", key: "install_id", id: INSTALL }]);
});

test("Edge notice lookup handles unknown users, database errors and stalled reads safely", async () => {
  const { lookupNoticeUser } = await import("../supabase/functions/transfer-telemetry/user-notices.mjs");
  for (const result of [{ data: null }, { data: { user_no: "49" } }, { error: { message: "PRIVATE_DATABASE_ERROR" } }, null]) {
    const res = await lookupNoticeUser({ kind: "user_notice_lookup", install_id: INSTALL }, {
      getEnv: () => "synthetic-private-config", timeoutMs: 5,
      createClient: () => ({ from: () => ({ select: () => ({ eq: () => ({
        maybeSingle: () => result === null ? new Promise(() => {}) : Promise.resolve(result)
      }) }) }) })
    }, {});
    assert.equal(res.status, result?.data === null ? 200 : 503);
    assert.deepEqual(await res.json(), result?.data === null ? { userNumber: null } : { code: "notices_unavailable" });
  }
});
