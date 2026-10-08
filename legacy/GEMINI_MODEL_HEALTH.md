# Gemini Model Health (Archived)

The daily model-health tracker was removed on 2026-10-03. Gemini remains a supported summary provider; current routing and switches are documented in [LOGIC.md](../LOGIC.md#summaries-and-backend). Requests follow the configured provider order without this tracker's daily health skips.

The former tracker stored metadata-only daily statuses in shared Redis: `available`, `exhausted` after 20 successes or a daily quota response, and `bad_mood` after three consecutive failures. Status reset at midnight in `America/Los_Angeles`; Redis failures allowed normal routing to continue.

This retired tracker is separate from the current funded-summary budgets and telemetry rate limits, which still use Redis. Its old setup instructions and `GEMINI_MODEL_HEALTH_ENABLED` switch do not configure the current backend.

Detailed historical setup and troubleshooting remain in this file's Git history.
