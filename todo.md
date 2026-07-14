# Personal Task Tracker

> **Project owner only:** This file is a personal task tracker for the project owner. It is **NOT** instructions for Codex and must never be read or treated as a task list to execute automatically, now or in future sessions.

1.there is a pending operation of fixing the scraper it is not properly scraping long chats it just does that in like one shot which is bad and needs to be solved

2.the whole scraper is not working itself like it is working but it is not pasting etc

3.update the firefox

4.Research when Chrome can complete verification for the extention.

5.website removal of useless things

6. Initial zero-message capture retries are Claude-only. ChatGPT, Gemini, Grok, and DeepSeek currently use a zero-millisecond scrape retry timeout, so if their messages are still mounting during the first capture attempt they immediately show "Nothing to carry yet". Later fix: give every supported platform a short bounded wait/retry before declaring the chat empty. This is documented only and was not fixed in the fuller-sweep-result pass.

7. **Unresolved — ChatGPT under-captures long chats despite visually sweeping top → middle → end.** Confirmed on a 40-turn chat that captured only 27 turns, and again on a separate 120+ turn chat (the exact captured count was not confirmed). Investigate later: the sweep may be exiting too early, or a stale/quiet check may be misfiring specifically on ChatGPT's DOM structure, similar to the earlier turn-count/stale-exit bug class already fixed in other cases. This is documented only and has not been investigated or fixed.

8. **Rare, non-urgent edge case:** If a pre-opened destination tab navigates to a different page while waiting for the backend summary, paste is not rechecked against the new page and could be attempted on the wrong site. Investigate later when user scale warrants it; this is documented only and has not been fixed.
