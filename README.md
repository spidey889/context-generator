# 🧠 Context Generator

**Hit your AI limit mid-conversation? Don't lose your progress.**

`/generate-context` summarizes your entire chat into a clean, portable block you can paste into any AI and continue exactly where you left off.

Works with Claude, ChatGPT, Gemini, or any AI.

---

## The Problem

You're deep into a conversation — building something, planning something, solving something. Then you hit the free limit. You switch to another AI and have to explain everything from scratch. Annoying.

## The Fix

Before you hit the limit, type `/generate-context`. The AI compresses everything important into one clean block. Copy it. Paste it into your new chat. Continue.

---

## How To Use

### Option 1 — Claude Skills (Recommended)
1. Go to **Claude.ai → Settings → Custom Instructions** (or Skills if available)
2. Paste the contents of [`context-generator.md`](./context-generator.md)
3. Save
4. Now in any Claude chat, type `/generate-context` when you're running low on context

### Option 2 — Manual (Any AI)
1. Open [`context-generator.md`](./context-generator.md)
2. Copy the full contents
3. Paste it at the start of any new chat as a system prompt or first message
4. Type `/generate-context` whenever you need it

---

## When To Use It

- You're at ~90% of your context/message limit
- You want to switch from Claude → ChatGPT (or vice versa)
- You want to save progress before closing a long chat
- You're handing off a conversation to someone else

---

## What The Output Looks Like

```
🧠 WHO I AM
🎯 WHAT WE WERE DOING
📍 WHERE WE LEFT OFF
✅ DECISIONS MADE
⚠️ OPEN QUESTIONS
📦 KEY CONTEXT
🔁 NEXT STEP
```

Clean. Specific. Under 400 words. Ready to paste.

---

## Files

| File | What it is |
|------|-----------|
| `context-generator.md` | The skill/prompt — this is what you actually install |
| `README.md` | This file |

---

## Contributing

Open source. If you improve the prompt or find a better structure, open a PR.

---

Made by [@spidey889](https://github.com/spidey889)
