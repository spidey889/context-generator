const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { CdpSession } = require("../scripts/run-extension-smoke.js");

class FakeSocket {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  send(data) { this.sent = JSON.parse(data); }
  reply(data) { this.listeners.get("message")({ data: JSON.stringify(data) }); }
}

test("smoke palette expression preserves escapes and compiles before browser execution", () => {
  const source = fs.readFileSync(path.join(__dirname, "../scripts/run-extension-smoke.js"), "utf8");
  const start = source.indexOf("const clickResult = await sourceSession.evaluate(") + "const clickResult = await sourceSession.evaluate(".length;
  const end = source.indexOf("})`);", start) + 3;
  const expression = vm.runInNewContext(source.slice(start, end));
  assert.doesNotThrow(() => new vm.Script(expression));
});

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
