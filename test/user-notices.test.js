const assert = require("node:assert/strict");
const test = require("node:test");
const { create } = require("../extension/user-notices");
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


function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    status(status) { this.code = status; return this; }, json(body) { this.body = body; return this; }, end() { return this; } };
}
const env = { SUPABASE_TELEMETRY_FUNCTION_URL: "https://example.invalid/relay",
  SUPABASE_TELEMETRY_PUBLISHABLE_KEY: "public-test-key", TELEMETRY_RELAY_SECRET: "private-test-relay-secret-0123456789abcdef" };
const request = changes => ({ method: "POST", headers: { "content-type": "application/json",
  "x-cap-context-client": "cap-context-extension/1" }, body: { install_id: INSTALL }, ...changes });


test("notice backend authenticates its lookup and returns only the matching user message", async () => {
  const { createTelemetryHandler } = await import("../supabase/functions/transfer-telemetry/handler.mjs");
  let selectedUser, queries = 0;
  const edge = createTelemetryHandler({
    getEnv: name => ({ ...env, SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "private-test-key" })[name],
    createClient: () => ({ from: table => ({ select: column => ({ eq: (key, id) => ({ maybeSingle: async () => {
      assert.deepEqual({ table, column, key, id }, { table: "users", column: "user_no", key: "install_id", id: INSTALL });
      queries++; return { data: selectedUser === null ? null : { user_no: selectedUser } };
    } }) }) }) })
  });
  for (const userNumber of [49, 50, null]) {
    selectedUser = userNumber;
    const calls = [];
    const handler = createHandler({ entries, env, rateLimit: async () => ({ allowed: true }), fetchImpl: async (...args) => {
      calls.push(args); return edge(new Request(args[0], args[1]));
    } });
    const res = response(); await handler(request(), res);
    assert.equal(res.code, 200);
    assert.equal(res.headers["cache-control"], "no-store");
    assert.deepEqual(res.body, { notice: noticeForUser(userNumber, entries) });
    assert.deepEqual(JSON.parse(calls[0][1].body), { kind: "user_notice_lookup", install_id: INSTALL });
    assert.equal(calls[0][1].headers["X-Cap-Context-Relay"], env.TELEMETRY_RELAY_SECRET);
    assert.doesNotMatch(JSON.stringify(res.body), /install_id|userNumber|private-test|public-test/);
  }
  const unauthorized = await edge(new Request(env.SUPABASE_TELEMETRY_FUNCTION_URL, { method: "POST",
    headers: { "content-type": "application/json", "x-cap-context-relay": "public-test-key" },
    body: JSON.stringify({ kind: "user_notice_lookup", install_id: INSTALL }) }));
  assert.equal(unauthorized.status, 401);
  const rejected = response();
  await createHandler({ entries, env, fetchImpl: () => assert.fail("Client cannot select another user") })(
    request({ body: { install_id: INSTALL, userNumber: 50 } }), rejected);
  assert.equal(rejected.code, 400);
  assert.equal(queries, 3);
  const config = require("../vercel.json");
  assert.deepEqual(config.rewrites.find(rule => rule.source === "/api/user-notices"),
    { source: "/api/user-notices", destination: "/api/telemetry?cap_user_notices=1" });
});

test("notice delivery waits for a free tab, survives restarts and accepts later messages", async () => {
  let ready = false;
  const first = delivery({ sendMessage: async () => ({ shown: ready }) });
  assert.equal((await first.client.check(sender(1))).shown, false);
  ready = true;
  const replies = await Promise.all([first.client.check(sender(1)), first.client.check(sender(2))]);
  assert.equal(replies.filter(r => r.shown).length, 1);
  assert.equal(first.sent.length, 2);
  assert.deepEqual(first.sent[1], [1, { type: "SHOW_USER_NOTICE", notice }, { documentId: "document-1" }]);
  assert.equal(first.fetched.length, 1);
  const request = first.fetched[0][1];
  assert.deepEqual(JSON.parse(request.body), { install_id: INSTALL });
  assert.equal(request.credentials, "omit");
  const restarted = delivery({ storage: first.storage });
  assert.equal((await restarted.client.check(sender(3))).shown, false);
  assert.equal(restarted.fetched.length, 0);
  assert.equal(restarted.sent.length, 0);
  const newer = noticeForUser(49, { 49: "A later backend message" });
  const refreshed = delivery({ storage: first.storage, now: () => Date.now() + 300001,
    fetchImpl: async () => json({ notice: newer }) });
  assert.equal((await refreshed.client.check(sender(4))).shown, true);
  assert.equal(refreshed.sent[0][1].notice.message, "A later backend message");
});

test("notice delivery retries a missing recipient but never repeats an uncertain display", async () => {
  const first = delivery({ displayTimeoutMs: 5, sendMessage: () => new Promise(() => {}) });
  assert.equal((await first.client.check(sender(1))).shown, false);
  const restarted = delivery({ storage: first.storage });
  await restarted.client.check(sender(2));
  assert.equal(restarted.sent.length, 0);
  const absent = delivery({ sendMessage: async () => { throw new Error("No document with id document-1"); } });
  assert.equal((await absent.client.check(sender(1))).shown, false);
  assert.equal((await delivery({ storage: absent.storage }).client.check(sender(2))).shown, true);
});

test("notice checks respect privacy choices and fail quietly when the backend is unavailable", async () => {
  for (const options of [{ storage: {} }, { hasConsent: async () => false }]) {
    const run = delivery(options);
    const before = structuredClone(run.storage);
    await run.client.check(sender(1));
    assert.deepEqual(run.storage, before);
    assert.equal(run.fetched.length + run.sent.length, 0);
  }
  const offline = delivery({ timeoutMs: 5, fetchImpl: () => new Promise(() => {}) });
  assert.equal((await offline.client.check(sender(1))).shown, false);
  assert.equal(offline.sent.length, 0);
  const res = response();
  await createHandler({ env, rateLimit: async () => ({ allowed: true }), fetchImpl: async () => {
    throw new Error("PRIVATE_DATABASE_ERROR");
  } })(request(), res);
  assert.equal(res.code, 503);
  assert.deepEqual(res.body, { code: "notices_unavailable" });
});

test("notice history survives upgrades and a changed installation cannot receive the old cached message", async () => {
  const original = noticeForUser(49);
  const run = delivery({ storage: { "context-generator-install-id-v1": INSTALL,
    "context-generator-deepseek-retry-notice-seen-v1": true }, fetchImpl: async () => json({ notice: original }) });
  assert.equal((await run.client.check(sender(1))).shown, false);
  assert.equal(run.sent.length, 0);
  assert.ok(run.storage[KEY].seen.includes(original.id));
  let ready = false;
  const other = noticeForUser(50, entries);
  const changed = delivery({ fetchImpl: async (_url, options) => json({
    notice: JSON.parse(options.body).install_id === INSTALL ? notice : other
  }), sendMessage: async () => ({ shown: ready }) });
  await changed.client.check(sender(1));
  changed.storage["context-generator-install-id-v1"] = "22222222-2222-4222-8222-222222222222";
  ready = true;
  assert.equal((await changed.client.check(sender(2))).shown, true);
  assert.deepEqual(changed.sent[1][1].notice, other);
  assert.equal(changed.fetched.length, 2);
});
