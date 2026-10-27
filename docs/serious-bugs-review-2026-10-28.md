# Serious bugs found in the code

Reviewed on 28 October 2026, against commit `3d6281f2437d61973fbd1532617127456af2f079`.

These three findings are supported by tracing the code. Tests and browser checks were not run, as requested. The examples below explain the failing paths; they are not claims of a live reproduction. No fixes are included.

## 1. Real instructions can disappear from the transferred chat

**What goes wrong:** When the extension reads messages from the page, it throws away any message shorter than 900 characters that contains a phrase such as `new chat`, `ask anything` or `how can i help`. It does this even after identifying the message as a real user or AI message.

For example, a user message saying **"Do not open a new chat. Continue editing the current file."** is removed because it contains `new chat`. Other messages can still transfer successfully, so the next AI receives the conversation without that instruction.

**When it happens:** Page capture of an unsaved chat, or page recovery after a failed native history download. Successful native JSON capture uses a different path.

**Why this is serious:** The transfer can silently lose a user's instruction or decision while appearing successful.

**Code evidence:**

- [The welcome-phrase list](../extension/platform-content.js#L184) includes `new chat` and other ordinary phrases.
- [The empty-message check](../extension/platform-content.js#L4716) uses `cleaned.includes(emptyText) && cleaned.length < 900`, so matching a phrase anywhere discards the whole message.
- [The useful-message filter](../extension/platform-content.js#L4700) applies this check to messages with verified speaker roles. [Transcript construction](../extension/platform-content.js#L3703) then leaves those messages out.

## 2. Changing the source chat can leave the old transfer pasting

**What goes wrong:** After a paste request has been sent, switching to another conversation in the source tab can leave that paste running. The destination can still receive the old chat even though the source has detected that the conversation changed.

**Example:** Start a transfer, then switch conversations in the source tab while the destination is still waiting for its message box. If this switch happens inside the existing page without a reload, the source's conversation guard detects it, but does not cancel the destination's pending paste. Once the message box becomes ready, the destination's source check still passes because the source tab exists.

**Why this is serious:** Old conversation content can be inserted after the source change should have stopped the attempt. The source can subsequently report a changed-conversation failure despite that insertion. This concerns insertion into the message box; the extension does not press Send.

**Code evidence:**

- [The source navigation callback](../extension/platform-content.js#L1497) calls only `stopSourceDestinationProgress(trace)`.
- [That helper](../extension/platform-content.js#L1363) sends `END_DESTINATION_PROGRESS`. [Its worker handler](../extension/background.js#L1231) explicitly stops presentation while retaining actual delivery.
- [The worker's navigation cancellation](../extension/background.js#L141) requires `changeInfo.status === "loading"`; it does not handle a same-page chat URL change.
- [The destination's active-transfer check](../extension/platform-content.js#L3117) asks the worker. [The worker check](../extension/background.js#L234) checks the cancellation token and whether the source tab exists, without checking its conversation or asking its source guard.

## 3. Large chats can freeze the page during page capture

**What goes wrong:** To match collected messages with messages on the page, capture creates a table with one cell for every possible pair of messages. It allocates this table even when both lists contain the same unchanged messages.

**Example:** If a page keeps 10,000 short messages mounted, comparing two lists of 10,000 messages allocates **400,080,004 bytes, about 382 MiB**, just for this table, and runs 100 million comparisons. Such a chat can still be well below the 1,000,000-character limit. Larger lists grow much faster than the chat itself.

**Why this is serious:** The work runs synchronously in the chat page. It can make the tab unresponsive and exhaust its memory. Escape and the transfer timeout cannot interrupt the comparison loops while they occupy the page's execution thread. The allocation size follows directly from the code; the time taken and crash threshold were not measured.

**Code evidence:**

- [Each capture sweep](../extension/platform-content.js#L3769) collects the rendered messages. [The collector](../extension/platform-content.js#L3936) passes nonempty lists to the sequence matcher.
- [The matcher](../extension/platform-content.js#L3988) allocates `(collectedLength + 1)` arrays, each containing `(renderedLength + 1)` four-byte integers, then loops over every pair without a deadline or cancellation check.
- [Final capture reconciliation](../extension/platform-content.js#L3915) uses that same collector before [the unchanged-result check](../extension/platform-content.js#L3890), so unchanged lists do not avoid the expensive comparison.
