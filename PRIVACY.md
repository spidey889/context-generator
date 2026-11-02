# Privacy Policy for Cap Context

<!-- Keep policy wording aligned with privacy.html. -->

This Privacy Policy explains how Cap Context ("we", "our", or "us") handles user data.

## Information Collection and Use

- **Notice Dismissals**: When you click Dismiss on a Cap Context user notice, updated clients report the existing installation identifier and notice ID so the backend can log the corresponding installation's internal user number and notice ID. These logs include no notice/chat text or page URL. Automatic expiration does not report a click, and optional diagnostics consent applies.

- **Emergency Settings**: Updated extensions periodically fetch a small public settings file from our backend to pause broken features. These requests do not include conversations, installation identifiers, page URLs, AI account data or cookies. The last valid settings are cached locally and these checks operate independently of optional diagnostics.

- **Picker Privacy**: Opening the destination picker reads a saved conversation from its current AI website and keeps the capture temporarily in source-page memory. Closing the picker discards it. Picker interaction does not send conversation text to our backend or another destination. The picker may preconnect to supported AI websites; those preconnections do not include chat content.

- **Data Transmission**: Summarization and transfer start after you select a destination. Chats under 10,000 characters stay in your browser; larger chats are sent to our backend for summarization.

- **Processing**: Depending on the route, remote summaries are processed through OpenRouter, TokenHarbor, Google Gemini or Mistral. Ordinary OpenRouter requests exclude endpoints that collect user data. For chats over 1,000,000 characters, we may use NVIDIA models. According to NVIDIA’s policy, NVIDIA may use the data it receives to train or improve its models. If summarization fails, the complete captured conversation remains available for local transfer or manual copying.

- **Purpose**: Conversation data is used to provide summarization. Metadata-only transfer analytics is used to measure usage and diagnose transfer reliability.

- **Transfer Analytics**: Each transfer attempt sends metadata to our Supabase analytics system: a random extension-install identifier, a random attempt identifier, timestamp, source and destination platform, captured character count when known, success or failure status, the last predefined pipeline stage reached, a predefined non-sensitive failure category, extension version, and the serving model when recorded. The closed stages cover intent, capture, summary request/response/completion, paste, and completion. Telemetry never includes chat text, generated summaries, page URLs, stack traces, arbitrary error messages, or provider response bodies. The random install identifier is created once in local extension storage and is not tied to a Cap Context account, name, email address, or AI account. When an install's first transfer attempt reaches our database, including local carries and empty or unfinished attempts, one protected internal `users` row assigns a sequential number and cosmetic random name. It tracks lifetime and daily counts of verified summaries and new successful local transfers, plus daily reported failures. Daily counters reset at midnight in Asia/Kolkata (IST). Empty-chat attempts do not create a counted failure. These labels identify an extension installation, not a person or AI account; the aggregate row contains no conversation content.

- **Transfer Diagnostics**: Updated clients send bounded diagnostic codes, component timelines, capture method and turn/size counts, capture request steps/statuses and validation categories, summary size/timing and fixed provider failure categories/statuses, runtime error types and packaged extension filenames with numeric line references, retry/recovery counts, browser family, visibility/online flags and editor presence/connection/draft/insertion/verification observations. Successful attempts include measurements for comparison. Claude transfers can also include a fixed destination-page label (such as new chat, login, or saved chat with its ID removed), the platform/new-chat checks, and the number of detected conversation messages. These contain no chat or summary text, raw page URLs, query strings, fragments, chat/project IDs, account details, stacks, arbitrary errors or provider bodies. Draft observations record only presence/length. Unknown causes remain explicitly unknown; these are client reports, not verified identities or causes.

- **Summary Confirmation and Counting**: Updated clients attach a bounded signed receipt issued by the backend after a summary completes. It contains no chat or summary text and binds the attempt metadata. Verified backend summaries count once, even if pasting fails. New successful local transfers also count once in the lifetime and daily totals based on client reports; they remain unverified, and historical local attempts are not backfilled. Repeated reports or a later verified receipt cannot count the same attempt twice. Unsigned remote successes and cached remote summaries do not count as new server summaries. A client-reported paste outcome is not independent proof of a transfer or a person. Older counts predate receipt verification.

- **User Cancellation**: If a source or destination transfer tab is closed while a transfer is active, telemetry may classify the attempt as `user_cancelled`. This records only the safe category and last pipeline stage, not what the user was doing or any conversation content.

- **Coarse Location Diagnostics**: With transfer telemetry enabled, the backend records Vercel's country and region codes and city name inside the existing transfer diagnostics, using `unknown` when unavailable. These approximate request hints share transfer retention and are not verified physical locations. No IP address, latitude or longitude is stored in this observation.

## Data Retention and Security

- **Provider Failure Logs**: The backend saves private metadata about failed AI-provider requests inside the existing transfer diagnosis, sharing that transfer's retention: provider/model names, fixed failure stages and reasons, timing, input/output sizes and limits, and observed token counts. Random request and transfer-attempt IDs connect related errors. No conversation, summary or thinking text, credentials, raw errors or provider response bodies are stored. These logs help diagnose failures even when a fallback succeeds.

- **Temporary Backend Processing**: The backend does not permanently store or intentionally log chat content. Conversation text is processed for the duration of the summary request and returned to the extension. The background worker may keep a recent exact summary in memory for up to two minutes; this disappears with the worker and is not persistent storage. Local extension retention is described below.

- **Local Diagnostics**: The extension stores one latest-run receipt in browser extension storage for the connected analysis page. It contains transfer timing, counts, provider/model/fallback details, token usage, status, and the exact captured transcript used for the transfer, but not the generated summary. The raw transcript and its expiry marker are removed after 24 hours, while the remaining diagnostics stay until the next transfer replaces the receipt. The transcript stays collapsed behind the analysis page's raw-text control until the user opens it.

- **Telemetry Delivery**: Undelivered metadata-only telemetry is kept in local extension storage for up to seven days, with a maximum of 500 queued entries, and retried after the extension starts again. A telemetry outage never blocks or changes the transfer itself.

- **Abuse Protection**: The backend temporarily processes ordinary request metadata, such as an IP address supplied by the hosting platform, to enforce rate limits and protect the public service from automated abuse. This metadata is not used for advertising.

## Data Sharing and Sale

- **No Sale of Data**: We do not sell user data to third parties.

- **No Advertising**: We do not use user data for advertising purposes.

## Contact Us

If you have any questions or feedback regarding this policy, please contact us at:

- Email: spreadzapp@gmail.com
