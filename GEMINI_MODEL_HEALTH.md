# Gemini Model Health

Cap Context keeps a small shared daily status for each Gemini model so Vercel does not repeatedly call a model that is already exhausted or repeatedly failing. No conversation, prompt, URL, summary, API key, or raw provider error is stored.

## Daily rules

- `available`: the model may be used.
- `exhausted`: the model reached 20 successful summaries, or Gemini explicitly reported a daily quota. Skip it for the rest of the Pacific day.
- `bad_mood`: the model had three consecutive failed summary attempts. Skip it for the rest of the Pacific day.
- A success before `bad_mood` resets the consecutive-failure count. Once a model is `bad_mood` or `exhausted`, it stays skipped until the new Pacific day.
- The model order remains 3.8, 3.7, 3.6, 3.5, then the existing Mistral, Groq, and local-direct safety chain.
- Gemini `429` responses are not retried against the same model; Cap Context moves to the next model immediately.

The reset is based on `America/Los_Angeles`, not a fixed UTC or India time. A new date-key automatically makes every model available at midnight Pacific, including daylight-saving changes. Old counter keys expire after eight days for short-term diagnosis.

## What Redis stores

Each key is shaped like:

```text
cap-context:gemini-health:v1:<Pacific YYYY-MM-DD>:<model>
```

Each value contains only `status`, `attempts`, `successes`, `failures`, `consecutiveFailures`, `lastOutcome`, and `updatedAt`. An attempt is recorded immediately before calling the model, while its success or failure is recorded afterward. Updates are atomic so separate Vercel Function instances do not overwrite one another.

## Vercel production setup

Vercel Functions can scale across instances and deployments, so function memory is not a reliable daily counter. Connect an Upstash Redis database from the Vercel Marketplace instead:

1. Open the Cap Context project in Vercel.
2. Open **Storage** or **Marketplace**, add **Upstash Redis**, and connect it to this project.
3. Confirm the Production environment receives both `KV_REST_API_URL` and `KV_REST_API_TOKEN`. The older `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` names are also accepted.
4. Keep the token server-side. Never create a `NEXT_PUBLIC_` or extension copy of it.
5. Redeploy Production after connecting the database; environment changes do not alter an already-running deployment.
6. Confirm the Function logs contain `Gemini health updated` after a generated summary.

Official references: [Redis on Vercel](https://vercel.com/docs/redis) and [Upstash's Vercel integration](https://upstash.com/docs/redis/howto/vercelintegration).

No npm Redis package is required. The backend uses Upstash's HTTPS API directly, keeping the repository's dependency-free runtime design.

The feature activates automatically only when a supported Redis URL/token pair exists. If either value is missing, Redis times out, or Redis returns an error, Cap Context fails open and uses the existing provider order. Summarization must never fail because health tracking failed.

Emergency off switch: add `GEMINI_MODEL_HEALTH_ENABLED=false` to Vercel and redeploy. This disables only health tracking; it does not disable Gemini or the existing fallback chain.

## If routing looks wrong

1. Check the Vercel Function log for `Gemini health updated` or `Gemini health store unavailable`.
2. Confirm both Redis variables exist in the same Vercel environment as the deployment.
3. Inspect the current Pacific-date keys in Upstash and check `status`, `attempts`, `successes`, and `consecutiveFailures`.
4. Confirm Vercel was redeployed after the integration was connected.
5. Use the emergency off switch if Redis routing must be bypassed while investigating.
