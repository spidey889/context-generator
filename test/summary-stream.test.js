const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const handler = require("../api/summarize");
const { createSummaryWithFallback, getSummaryProfile } = handler.__test;

const encoder = new TextEncoder();
const frame = data => `data: ${JSON.stringify(data)}\r\n\r\n`;
const chatChunk = (text, finish_reason = null) => ({ choices: [{ index: 0, delta: { content: text }, finish_reason }] });
function responseFrom(text) {
  const bytes = encoder.encode(text);
  return new Response(new ReadableStream({ start(controller) {
    // Split inside Unicode, CRLF and JSON tokens, rather than one event per read.
    for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
    controller.close();
  } }), { headers: { "content-type": "text/event-stream" } });
}
function configure(t) {
  const values = { OPENROUTER_ENABLED: "true", OPENROUTER_LING_ENABLED: "true",
    OPENROUTER_QWEN_ENABLED: "false", OPENROUTER_DOTS_ENABLED: "false", OPENROUTER_GEMMA_ENABLED: "false",
    MISTRAL_ENABLED: "true", OPENROUTER_API_KEY: "STREAM_TEST_KEY", GEMINI_API_KEY: undefined,
    MISTRAL_API_KEY: undefined, TELEMETRY_SIGNING_KEY: "STREAM_TEST_SECRET_0123456789abcdef" };
  const saved = Object.keys(values).map(name => [name, process.env[name]]);
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
  const fetch = global.fetch;
  t.after(() => {
    global.fetch = fetch;
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
}
const conversation = "User: Preserve our agreed project state and résumé 🧠.\n".repeat(45);

test("all provider routes stream one request, preserving Unicode, usage and answer-only text", async t => {
  configure(t);
  for (const provider of ["openrouter", "gemini", "mistral"]) {
    const deltas = [], calls = [];
    global.fetch = async (url, options) => {
      calls.push({ url, body: JSON.parse(options.body) });
      return responseFrom(provider === "gemini"
        ? frame({ candidates: [{ index: 0, content: { parts: [{ text: "HIDDEN_THINKING", thought: true }, { text: "Preserve résumé 🧠. " }] } }] })
          + frame({ candidates: [{ index: 0, content: { parts: [{ text: "Continue the agreed work." }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 12, thoughtsTokenCount: 3, totalTokenCount: 65 } })
        : ": processing\r\n\r\n" + frame({ choices: [{ index: 0, delta: { reasoning: "HIDDEN_THINKING" } }] })
          + frame(chatChunk("Preserve résumé 🧠. ")) + frame(chatChunk("Continue the agreed work.", "stop"))
          + frame({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 12, total_tokens: 62 } }) + "data: [DONE]\r\n\r\n");
    };
    const result = await createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation),
      openrouterApiKey: provider === "openrouter" ? "test" : undefined,
      geminiApiKey: provider === "gemini" ? "test" : undefined,
      mistralApiKey: provider === "mistral" ? "test" : undefined,
      requestContext: { onDelta: text => deltas.push(text) } });
    assert.equal(calls.length, 1, provider);
    assert.equal(result.provider, provider);
    assert.equal(deltas.join(""), "Preserve résumé 🧠. Continue the agreed work.");
    assert.doesNotMatch(result.summary, /HIDDEN_THINKING/);
    assert.equal(result.usage.promptTokens, 50);
    assert.equal(result.usage.completionTokens, provider === "gemini" ? 15 : 12);
    if (provider === "gemini") assert.match(calls[0].url, /:streamGenerateContent\?alt=sse$/);
    else assert.equal(calls[0].body.stream, true);
  }
});

test("Mistral mixed string and text-block deltas preserve the answer without reasoning", async t => {
  configure(t);
  const deltas = [];
  let calls = 0;
  global.fetch = async () => {
    calls++;
    return responseFrom(frame(chatChunk("Preserve "))
      + frame(chatChunk([
        { type: "thinking", thinking: [{ type: "text", text: "HIDDEN_THINKING" }] },
        { type: "text", text: "résumé 🧠. " },
        { type: "text", text: "Deployment must wait for Linux tests." }
      ], "stop"))
      + frame({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 12, total_tokens: 62 } })
      + "data: [DONE]\r\n\r\n");
  };
  const result = await createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation),
    mistralApiKey: "test", requestContext: { onDelta: text => deltas.push(text) } });
  const answer = "Preserve résumé 🧠. Deployment must wait for Linux tests.";
  assert.equal(calls, 1);
  assert.equal(result.provider, "mistral");
  assert.equal(deltas.join(""), answer);
  assert.ok(result.summary.includes(answer));
  assert.doesNotMatch(result.summary, /HIDDEN_THINKING/);
  assert.equal(result.usage.totalTokens, 62);
});

test("failed and truncated streams cannot become summaries; retry resets and complete local recovery survive", async t => {
  configure(t);
  let calls = 0, resets = 0;
  global.fetch = async () => ++calls === 1
    ? responseFrom(frame(chatChunk("REJECTED_PARTIAL")) + frame({ error: { code: 503, message: "PRIVATE_PROVIDER_ERROR" } }))
    : responseFrom(frame(chatChunk("Keep the accepted project plan.", "stop")) + "data: [DONE]\n\n");
  const result = await createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation), openrouterApiKey: "test",
    requestContext: { onDelta() {}, onStart: () => resets++ } });
  assert.equal(calls, 2);
  assert.equal(resets, 2);
  assert.doesNotMatch(result.summary, /REJECTED_PARTIAL|PRIVATE_PROVIDER_ERROR/);
  for (const stream of [frame(chatChunk("TRUNCATED")), "data: {broken}\n\n",
    frame(chatChunk("TRUNCATED", "stop")), frame({ error: { code: 403 } })]) {
    global.fetch = async () => responseFrom(stream);
    const recovered = await createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation),
      mistralApiKey: "test", requestContext: { onDelta() {} } });
    assert.equal(recovered.model, "local-direct");
    assert.ok(recovered.summary.includes(conversation.trim().split("\n").map(line => `> ${line}`).join("\n")));
    assert.doesNotMatch(recovered.summary, /TRUNCATED/);
  }
});

test("a stalled streamed provider remains bounded by the existing deadline", async t => {
  configure(t);
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse("2026-10-08T10:00:00Z") });
  let aborted = false, requests = 0;
  global.fetch = async (_url, options) => {
    requests++;
    return new Response(new ReadableStream({ start(controller) {
      controller.enqueue(encoder.encode(frame(chatChunk("UNACCEPTED_PARTIAL"))));
      options.signal.addEventListener("abort", () => { aborted = true; controller.error(options.signal.reason); }, { once: true });
    } }), { headers: { "content-type": "text/event-stream" } });
  };
  const result = await createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation), mistralApiKey: "test",
    requestContext: { onDelta: () => t.mock.timers.setTime(Date.now() + 90000) } });
  assert.equal(aborted, true);
  assert.equal(requests, 1);
  assert.equal(result.model, "local-direct");
  assert.doesNotMatch(result.summary, /UNACCEPTED_PARTIAL/);
});

test("one HTTP call delivers real deltas before completion and the signed final result after completion", async t => {
  configure(t);
  let upstreamCalls = 0, release;
  const finish = new Promise(resolve => { release = resolve; });
  global.fetch = async () => {
    upstreamCalls++;
    return new Response(new ReadableStream({ async start(controller) {
      controller.enqueue(encoder.encode(frame(chatChunk("Preserve résumé 🧠. "))));
      await finish;
      controller.enqueue(encoder.encode(frame(chatChunk("Continue the agreed work.", "stop")) + "data: [DONE]\n\n"));
      controller.close();
    } }), { headers: { "content-type": "text/event-stream" } });
  };
  let apiCalls = 0;
  const server = http.createServer(async (req, res) => {
    apiCalls++;
    let body = ""; for await (const chunk of req) body += chunk;
    req.body = body;
    res.status = code => { res.statusCode = code; return res; };
    res.json = payload => { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(payload)); };
    await handler(req, res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => { release(); server.closeAllConnections(); server.close(); });
  let notePreview;
  const preview = new Promise(resolve => { notePreview = resolve; });
  let wire = "", completed = false;
  const complete = new Promise((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: server.address().port, method: "POST", headers: {
      "content-type": "application/json", accept: "application/x-ndjson", "x-cap-context-client": "cap-context-extension/1",
      "x-forwarded-for": "203.0.113.244"
    } }, response => {
      response.setEncoding("utf8");
      response.on("data", chunk => { wire += chunk; if (wire.includes('"type":"delta"')) notePreview(); });
      response.on("end", () => { completed = true; resolve(); });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end(JSON.stringify({ conversation, telemetry: {
      attempt_id: "11111111-1111-4111-8111-111111111111", install_id: "22222222-2222-4222-8222-222222222222",
      attempted_at: new Date().toISOString(), source_platform: "claude", destination_platform: "chatgpt", extension_version: "1.4.11",
      character_count: conversation.length, status: "started", last_stage: "summary_request_started", failure_reason: null
    } }));
  });
  await Promise.race([preview, complete.then(() => { throw new Error(`No streamed preview: ${wire}`); })]);
  assert.equal(completed, false);
  assert.ok(!wire.includes('"type":"result"'));
  release(); await complete;
  const events = wire.trim().split("\n").map(JSON.parse);
  const final = events.at(-1);
  assert.equal(final.type, "result");
  assert.match(final.data.summary, /Preserve résumé 🧠\. Continue the agreed work/);
  assert.ok(final.data.summaryProofV3);
  assert.equal(apiCalls, 1);
  assert.equal(upstreamCalls, 1);
});
