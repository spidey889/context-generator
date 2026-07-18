# Privacy Policy for Cap Context

This Privacy Policy explains how Cap Context ("we", "our", or "us") handles user data.

## Information Collection and Use

- **Picker Privacy**: Opening, browsing, closing, or cancelling the destination picker does not capture or upload conversation text. The picker may preconnect to supported AI websites to make a later transfer faster, but those preconnections do not include chat content.
- **Data Transmission**: Cap Context captures and sends the current chat conversation to our backend only after the user selects a destination and starts the real transfer.
- **Processing**: The backend sends the captured conversation to Google Gemini to create the Context Carry summary. If Gemini fails, the backend uses the preserved Mistral model chain and may use Groq as the final fallback summarization provider.
- **Purpose**: Conversation data is used to provide summarization. Metadata-only transfer analytics is used to measure usage and diagnose transfer reliability.
- **Transfer Analytics**: Each transfer attempt sends metadata to our Supabase analytics system: a random extension-install identifier, a random attempt identifier, timestamp, source and destination platform, captured character count when known, success or failure status, the last predefined pipeline stage reached, a predefined non-sensitive failure category, and extension version. The closed stages cover intent, capture, summary request/response/completion, paste, and completion. Telemetry never includes chat text, generated summaries, page URLs, stack traces, arbitrary error messages, or provider response bodies. The random install identifier is created once in local extension storage and is not tied to a Cap Context account, name, email address, or AI account. For internal usage review, each install is shown only as a stable label such as `User 1`, with UTC daily transfer counts and metadata-only character counts; this does not create a user account or identify the person.

## Data Retention and Security

- **Temporary Backend Processing**: The backend does not permanently store or intentionally log chat content. Conversation text is processed for the duration of the summary request and returned to the extension. The background worker may keep a recent exact summary in memory for up to two minutes; this disappears with the worker and is not persistent storage. Local extension retention is described below.
- **Local Diagnostics**: The extension stores one latest-run receipt in browser extension storage for the connected analysis page. It contains transfer timing, counts, provider/model/fallback details, token usage, status, and the exact captured transcript sent to the backend, but not the generated summary. The raw transcript and its expiry marker are removed after 24 hours, while the remaining diagnostics stay until the next transfer replaces the receipt. The transcript stays collapsed behind the analysis page's raw-text control until the user opens it.
- **Telemetry Delivery**: Undelivered metadata-only telemetry is kept in local extension storage and retried after the extension starts again. A telemetry outage never blocks or changes the transfer itself.
- **Abuse Protection**: The backend temporarily processes ordinary request metadata, such as an IP address supplied by the hosting platform, to enforce rate limits and protect the public service from automated abuse. This metadata is not used for advertising.

## Data Sharing and Sale

- **No Sale of Data**: We do not sell user data to third parties.
- **No Advertising**: We do not use user data for advertising purposes.

## Contact Us

If you have any questions or feedback regarding this policy, please contact us at:
- Email: spreadzapp@gmail.com
