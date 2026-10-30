const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const vm = require("node:vm");
const { CdpSession, dispatchTrustedFixtureInput, waitForProcessExit } = require("../scripts/run-extension-smoke.js");

function nativeInputPage(deliveries, { obscured = false, closeOnInput = false } = {}) {
  const listeners = new Map();
  const calls = [];
  let inputs = 0, closed = false;
  const element = { contains: target => target === element,
    focus: () => { document.activeElement = element; },
    getBoundingClientRect: () => ({ x: 10, y: 20, width: 30, height: 40 }) };
  const document = { querySelector: () => element, visibilityState: "visible", hasFocus: () => true,
    elementFromPoint: () => obscured ? {} : element };
  const window = { addEventListener: (type, listener) => listeners.set(type, listener),
    removeEventListener: type => listeners.delete(type) };
  const context = vm.createContext({ window, document, requestAnimationFrame: setImmediate, Promise });
  return {
    calls, listeners, get closed() { return closed; },
    async evaluate(expression) {
      if (closed) throw new Error("DevTools connection closed");
      return vm.runInContext(expression, context);
    },
    async call(method, params = {}) {
      calls.push({ method, params });
      if (method !== "Input.dispatchKeyEvent" && !(method === "Input.dispatchMouseEvent" && params.type === "mouseReleased")) return;
      const delivery = deliveries[inputs++];
      if (!delivery) return;
      const type = method === "Input.dispatchKeyEvent" ? "keydown" : "click";
      listeners.get(type)?.({ isTrusted: true, key: params.key, target: delivery === "wrong" ? {} : element });
      if (closeOnInput) { closed = true; throw new Error("DevTools connection closed"); }
    }
  };
}

test("native smoke input retries a missing click, but never repeats a delivered product action", async () => {
  const page = nativeInputPage([false, true]);
  const previous = nativeInputPage([]);
  await dispatchTrustedFixtureInput(page, { selector: "button", previousSession: previous });
  assert.equal(page.calls.filter(call => call.params.type === "mouseReleased").length, 2);
  assert.deepEqual(previous.calls, [{ method: "Emulation.setFocusEmulationEnabled", params: { enabled: false } }]);
  assert.equal(page.listeners.size, 0);
});

test("native smoke input fails on an obscured or wrong target instead of retrying real actions", async () => {
  for (const obscured of [false, true]) {
    const page = nativeInputPage(["wrong", true], { obscured });
    await assert.rejects(dispatchTrustedFixtureInput(page, { selector: "button" }),
      obscured ? /button is obscured/ : /intended element/);
    assert.equal(page.calls.filter(call => call.params.type === "mouseReleased").length, obscured ? 0 : 1);
    assert.equal(page.listeners.size, 0);
  }
});

test("native smoke Escape retries only missing key delivery and accepts destination closure before acknowledgement", async () => {
  for (const closeOnInput of [false, true]) {
    const page = nativeInputPage([false, true], { closeOnInput });
    await dispatchTrustedFixtureInput(page, { selector: "textarea", key: "Escape", isClosed: async () => page.closed });
    assert.equal(page.calls.filter(call => call.method === "Input.dispatchKeyEvent").length, 2);
  }
});

test("native smoke input stays red when Brave never delivers input", async () => {
  const page = nativeInputPage([]);
  await assert.rejects(dispatchTrustedFixtureInput(page, { selector: "textarea", key: "Escape" }), /after three attempts/);
  assert.equal(page.calls.filter(call => call.method === "Input.dispatchKeyEvent").length, 3);
  assert.equal(page.listeners.size, 0);
});

class FakeSocket {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  send(data) { this.sent = JSON.parse(data); }
  reply(data) { this.listeners.get("message")({ data: JSON.stringify(data) }); }
}

test("smoke DevTools commands time out and discard late responses", async () => {
  const socket = new FakeSocket();
  const session = new CdpSession(socket);
  await assert.rejects(session.call("Runtime.evaluate", {}, 10), /DevTools command timed out: Runtime.evaluate/);
  assert.equal(session.pending.size, 0);
  assert.doesNotThrow(() => socket.reply({ id: socket.sent.id, result: {} }));
});

test("smoke DevTools replies and socket closures clear pending commands", async () => {
  const socket = new FakeSocket();
  const session = new CdpSession(socket);
  const result = session.call("Runtime.evaluate");
  socket.reply({ id: socket.sent.id, result: { value: 42 } });
  assert.deepEqual(await result, { value: 42 });
  const closed = session.call("Runtime.evaluate");
  socket.listeners.get("close")();
  await assert.rejects(closed, /DevTools connection closed/);
  assert.equal(session.pending.size, 0);
});

test("smoke rejects malformed expressions and synchronous socket failures locally", async () => {
  const socket = new FakeSocket();
  const session = new CdpSession(socket);
  await assert.rejects(session.evaluate("'literal with\nnewline'"), /Invalid or unexpected token/);
  assert.equal(socket.sent, undefined);
  socket.send = () => { throw new Error("Socket not open"); };
  await assert.rejects(session.call("Runtime.evaluate"), /Socket not open/);
  assert.equal(session.pending.size, 0);
});

test("smoke shutdown handles exited, signalled and hung browsers without leftover listeners", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const child = () => Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
  await waitForProcessExit(null, 20);
  for (const outcome of [{ exitCode: 0 }, { signalCode: "SIGTERM" }]) {
    const stopped = Object.assign(child(), outcome);
    await waitForProcessExit(stopped, 20);
    assert.equal(stopped.listenerCount("exit"), 0);
  }
  const exiting = child();
  const exited = waitForProcessExit(exiting, 20);
  assert.equal(exiting.listenerCount("exit"), 1);
  exiting.emit("exit", 0);
  await exited;
  assert.equal(exiting.listenerCount("exit"), 0);

  const hung = child();
  let finished = false;
  const deadline = waitForProcessExit(hung, 20).then(() => { finished = true; });
  t.mock.timers.tick(19);
  await Promise.resolve();
  assert.equal(finished, false, "A running browser retains its shutdown grace period.");
  t.mock.timers.tick(1);
  await deadline;
  assert.equal(hung.listenerCount("exit"), 0);
  assert.doesNotThrow(() => hung.emit("exit", null, "SIGTERM"));
});
