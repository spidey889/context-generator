# Privacy Policy for Cap Context

This Privacy Policy explains how Cap Context ("we", "our", or "us") handles user data.

## Information Collection and Use

- **Picker Privacy**: Opening, browsing, closing, or cancelling the destination picker does not capture or upload conversation text. The picker may preconnect to supported AI websites to make a later transfer faster, but those preconnections do not include chat content.
- **Data Transmission**: Cap Context captures and sends the current chat conversation to our backend only after the user selects a destination and starts the real transfer.
- **Processing**: The backend sends the captured conversation to Mistral to create the Context Carry summary. If the Mistral provider chain fails, the backend may use Groq as a fallback summarization provider.
- **Purpose**: Data is utilized solely to provide the summarization functionality.

## Data Retention and Security

- **Temporary Backend Processing**: The backend does not permanently store or intentionally log chat content. Conversation text is processed for the duration of the summary request and returned to the extension. The background worker may keep a recent exact summary in memory for up to two minutes; this disappears with the worker and is not persistent storage. Local extension retention is described below.
- **Local Diagnostics**: The extension stores one latest-run receipt in browser extension storage for the connected analysis page. It contains transfer timing, counts, provider/model/fallback details, token usage, status, and the exact captured transcript sent to the backend, but not the generated summary. The raw transcript and its expiry marker are removed after 24 hours, while the remaining diagnostics stay until the next transfer replaces the receipt. The transcript stays collapsed behind the analysis page's raw-text control until the user opens it.
- **Abuse Protection**: The backend temporarily processes ordinary request metadata, such as an IP address supplied by the hosting platform, to enforce rate limits and protect the public service from automated abuse. This metadata is not used for advertising.

## Data Sharing and Sale

- **No Sale of Data**: We do not sell user data to third parties.
- **No Advertising**: We do not use user data for advertising purposes.

## Contact Us

If you have any questions or feedback regarding this policy, please contact us at:
- Email: spreadzapp@gmail.com
