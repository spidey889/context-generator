# OrcaRouter Integration

Cap Context uses OrcaRouter only as a best-effort free fallback between Gemini and Mistral.

## Production contract

- Environment variable: `ORCAROUTER_API_KEY`
- Endpoint: `https://api.orcarouter.ai/v1/chat/completions`
- Model: `orcarouter/free`
- Budget: 45 seconds total, including one bounded retry for temporary server/network failure
- HTTP 429: move immediately to Mistral without retrying OrcaRouter
- Missing key or any OrcaRouter failure: fail open to the existing Mistral, Groq, and local fallbacks
- Successful calls record the concrete model from `X-Orca-Resolved-Model`; the router alias is never presented as the serving model when Orca supplies that header

Never replace `orcarouter/free` with `orcarouter/auto` without a separate cost decision. The free alias never uses wallet credit or falls through to a paid model. OrcaRouter does not publish fixed free limits: it can reject by minute, UTC day, available free capacity, or per-request prompt size. This is why Cap Context treats it as opportunistic capacity rather than a dependable primary provider.

## Data boundary

The captured transcript is sent to OrcaRouter and the upstream model it selects. OrcaRouter states that it stores request metadata but not prompt or output content. Cap Context never logs or persists OrcaRouter response bodies; Latest Run stores only the same bounded provider/model/timing metadata used for the existing providers.

## Vercel setup

Add `ORCAROUTER_API_KEY` to both Production and Preview for the linked `context-generator` project. Keep the value only in Vercel; do not commit it or place it in tracked files.

Check configuration without exposing the value:

```powershell
vercel env ls
```

If OrcaRouter must be disabled urgently, remove `ORCAROUTER_API_KEY` and redeploy. The backend will automatically continue from Gemini to Mistral.

## Diagnosis

Use the OrcaRouter Requests page and Cap Context Latest Run together:

- `OrcaRouter Free — served`: the free route produced a valid Context Carry.
- `OrcaRouter Free — failed`, followed by Mistral: OrcaRouter rejected, timed out, or returned an invalid summary; the transfer continued normally.
- No OrcaRouter entry: the key was missing from that deployment or an earlier provider served successfully.

Official references:

- https://www.orcarouter.ai/models/orcarouter/free
- https://docs.orcarouter.ai/routing/free-models
- https://docs.orcarouter.ai/operations/errors
- https://docs.orcarouter.ai/operations/data-handling
