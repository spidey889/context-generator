const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { CdpSession, waitForProcessExit } = require("../scripts/run-extension-smoke.js");

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
