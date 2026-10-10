# Privacy Policy for Cap Context

This Privacy Policy explains how Cap Context ("we", "our", or "us") handles user data.

## Information Collection and Use

- **Picker Privacy**: With Speed enabled, opening the destination picker reads a saved conversation from its current AI website and keeps the capture temporarily in source-page memory. Closing the picker or turning Speed off discards it. Picker interaction does not send conversation text to our backend or another destination. The picker may preconnect to supported AI websites; those preconnections do not include chat content.
- **Data Transmission**: Summarization and destination transfer start only after the user selects a destination or explicitly starts a transfer from the extension toolbar. Chats under 10,000 characters or from 350,001 to 500,000 characters are carried entirely in the browser. Chats from 10,000 to 350,000 characters are sent to our backend for summarization.
- **Processing**: For remote summaries, the backend sends the captured conversation to configured AI providers: OpenRouter (currently Ling 3.1 Flash), Google Gemini and Mistral. OpenRouter requests use a provider filter that excludes endpoints which collect user data. If all configured providers fail, the full conversation is carried over locally.
- **Purpose**: Conversation data is used to provide summarization. Metadata-only transfer analytics is used to measure usage and diagnose transfer reliability.
- **Transfer Analytics**: Each transfer attempt sends metadata to our Supabase analytics system: a random extension-install identifier, a random attempt identifier, timestamp, source and destination platform, captured character count when known, success or failure status, the last predefined pipeline stage reached, a predefined non-sensitive failure category, extension version, and the serving model when recorded. The closed stages cover intent, capture, summary request/response/completion, paste, and completion. Telemetry never includes chat text, generated summaries, page URLs, stack traces, arbitrary error messages, or provider response bodies. The random install identifier is created once in local extension storage and is not tied to a Cap Context account, name, email address, or AI account. When an install's first transfer attempt reaches our database, including local carries and empty or unfinished attempts, one protected internal `users` row assigns a sequential number and cosmetic random name. It tracks lifetime and daily counts of verified summaries and new successful local transfers, plus daily reported failures. Daily counters reset at midnight in Asia/Kolkata (IST). Empty-chat attempts do not create a counted failure. These labels identify an extension installation, not a person or AI account; the aggregate row contains no conversation content.
- **Summary Confirmation and Counting**: Updated clients attach a bounded signed receipt issued by the backend after a summary completes. It contains no chat or summary text and binds the attempt metadata. Verified backend summaries count once, even if pasting fails. New successful local transfers also count once in the lifetime and daily totals based on client reports; they remain unverified, and historical local attempts are not backfilled. Repeated reports or a later verified receipt cannot count the same attempt twice. Unsigned remote successes and cached remote summaries do not count as new server summaries. A client-reported paste outcome is not independent proof of a transfer or a person. Older counts predate receipt verification.
- **User Cancellation**: If a source or destination transfer tab is closed while a transfer is active, telemetry may classify the attempt as `user_cancelled`. This records only the safe category and last pipeline stage, not what the user was doing or any conversation content.

## Data Retention and Security

- **Transfer Diagnostics**: Updated clients also send bounded diagnostic codes, component timelines, capture method and turn/size counts, summary size and timing, retry/recovery counts, browser family, visibility/online flags, and editor presence/connection/draft/insertion/verification observations. Successful attempts include basic measurements for comparison. These contain no chat or summary text, page URLs, account details, stack traces, arbitrary error messages or provider bodies. A draft observation records only presence/length, never its contents. Unknown causes remain explicitly unknown; diagnostics are client reports, not verified identities or causes.

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
