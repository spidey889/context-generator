memory.md — CapContext
I'm Vinit, solo non-technical founder, building via AI coding tools (Codex/Cursor/Claude Code), no formal CS background.
Project: CapContext — Chrome extension that transfers chat context between AI platforms (Claude, ChatGPT, Gemini, Grok, DeepSeek) so users can continue conversations across tools without re-explaining everything.
Key decisions (from logic.md, don't re-litigate):

One summarization path only: Vercel + Mistral backend. No prompting the source AI itself.
Model routing: ministral-3b-2512 for ≤20k char convos, mistral-large-2512 above that.
Groq (llama-3.1-8b-instant) is fallback if Mistral fails.
Paste-only — never auto-send/submit on destination.
ChatGPT button: page-root fixed position (not composer-mounted) — this was a hard-won fix, don't revert.
Claude button: composer-mounted, anchored near voice mode control.

Current focus: Making transfers fast and high quality — reducing latency, improving summary richness, prepping for Chrome Web Store submission.
Preference: Keep replies as-is, no style changes needed.
