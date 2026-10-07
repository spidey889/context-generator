const assert = require("node:assert/strict");
const test = require("node:test");
const { createSummaryWithFallback, getSummaryProfile } = require("../api/summarize.js").__test;

const conversation = "Build passed; José owns the rollout. ".repeat(100);
const text = "Build passed; José owns the rollout. 中文 🚀 Literal replacement character: �.";

function configure(t, provider) {
  const flags = { OPENROUTER_ENABLED: provider === "OpenRouter", OPENROUTER_LING_ENABLED: true,
    OPENROUTER_QWEN_ENABLED: false, OPENROUTER_DOTS_ENABLED: false, OPENROUTER_GEMMA_ENABLED: false,
    MISTRAL_ENABLED: provider === "Mistral" };
  const previous = Object.keys(flags).map(name => [name, process.env[name]]);
  const originalFetch = global.fetch;
  for (const [name, enabled] of Object.entries(flags)) process.env[name] = String(enabled);
  t.after(() => {
    global.fetch = originalFetch;
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  });
  return { geminiApiKey: provider === "Mistral" ? undefined : "TEST_ONLY_GOOGLE",
    mistralApiKey: provider === "Mistral" ? "TEST_ONLY_MISTRAL" : undefined,
    openrouterApiKey: provider === "OpenRouter" ? "TEST_ONLY_OPENROUTER" : undefined };
}

function payload(url, content = text) {
  return JSON.stringify(url.includes("generativelanguage.googleapis.com")
    ? { candidates: [{ content: { parts: [{ text: content }] }, finishReason: "STOP" }] }
    : { choices: [{ message: { content }, finish_reason: "stop" }] });
}

// Both response formats and remote/local fallback exercise the shared decoder.
for (const provider of ["Gemini", "Mistral"]) {
  test(`${provider} rejects malformed UTF-8 instead of silently corrupting a summary name`, async t => {
    const keys = configure(t, provider);
    let requests = 0;
    global.fetch = async url => {
      const bytes = Buffer.from(payload(url));
      if (++requests === 1) bytes[bytes.indexOf(0xc3) + 1] = 0xff;
      return new Response(bytes);
    };
    const result = await createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation), ...keys });
    const fallbackModel = provider === "Gemini" ? "gemini-3.5-flash-lite" : "local-direct";
    assert.equal(result.model, fallbackModel);
    assert.equal(requests, provider === "Mistral" ? 1 : 2, "Malformed successful bodies must not retry the same provider call.");
    assert.ok(result.summary.includes("José owns the rollout."));
    if (provider === "Mistral") assert.ok(result.summary.includes(conversation.trim()));
    else assert.equal((result.summary.match(/�/g) || []).length, 1, "Only the valid literal replacement character survives.");
  });
}

for (const provider of ["Gemini", "OpenRouter"]) {
  test(`${provider} preserves split Unicode, a leading BOM and literal replacement characters`, async t => {
    const keys = configure(t, provider);
    let requests = 0;
    global.fetch = async url => {
      requests++;
      const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(payload(url))]);
      // One byte per chunk splits the BOM, accents, CJK, emoji and U+FFFD.
      let offset = 0;
      return new Response(new ReadableStream({ pull(controller) {
        if (offset < bytes.length) controller.enqueue(bytes.subarray(offset, ++offset));
        else controller.close();
      } }));
    };
    const result = await createSummaryWithFallback({ conversation, profile: getSummaryProfile(conversation), ...keys });
    const model = provider === "Gemini" ? "gemini-3.6-flash" : "inclusionai/ling-3.1-flash";
    assert.equal(result.model, model);
    assert.equal(requests, 1);
    assert.ok(result.summary.startsWith(text));
  });
}
