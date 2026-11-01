# Emergency frontend controls

`extension-controls.json` on the existing backend is the operator control file. All lists start empty (enabled). There is no database, dashboard, remote code or new extension permission. One initial extension-store update must install the guards; older installed versions cannot honor these settings.

## Operation

Edit the file in the backend's production source and deploy through the normal backend release process. Verify the actual response at `https://context-generator-five.vercel.app/extension-controls.json` afterward. A feature-branch push or preview does not change installed clients' production settings.

Example: pause Gemini transfers and automatic paste everywhere:

```json
{
  "version": 1,
  "disabled": {
    "transfers": ["gemini"],
    "inlineOrb": [],
    "jsonCapture": [],
    "automaticPaste": ["*"]
  }
}
```

| Switch | Behavior when disabled |
| --- | --- |
| `transfers` | Stop new transfers from or to these sites, cancel active source attempts when settings arrive, and remove that site's orb. Toolbar feedback explains the pause. |
| `inlineOrb` | Remove the orb and release its composer reservations on these sites. Toolbar transfers remain available. Restoring the setting remounts the orb. |
| `jsonCapture` | Stop active JSON history reads initiated by the picker/transfer on these source sites. Use existing DOM capture and its completeness limits. Already-running reads may finish, but their results are discarded after the stop arrives. Passive network hooks remain installed. |
| `automaticPaste` | Stop automatic composer writes involving these source or destination sites, including delayed recovery. Offer the complete prepared context in the existing copy dialog. |

Use `claude`, `chatgpt`, `gemini`, `grok`, `deepseek`, or `*` for all sites. Names are case sensitive. Set `transfers` to `["*"]` to stop all transfers. Remove a site or restore an empty list and deploy to re-enable it. This affects subsequent work; it does not automatically paste an already prepared manual carry.

Validate an edit before deploying with `node --test test/remote-controls.test.js`. This accepts deliberately disabled settings. Ordinary transfer fixtures use their own all-enabled configuration so an emergency stop does not break unrelated CI.

## Delivery and failure behavior

- The worker checks on startup, a one-minute alarm, and source selection/worker actions when its shared cache is due. Concurrent tabs share one request. Local storage changes update existing pages without a reload.
- One minute is the normal target, not a delivery guarantee: browser scheduling, sleep and lost connectivity can delay it. Browser and Vercel/CDN caches are bypassed.
- Fetches have a three-second deadline covering headers and body, reject redirects, and accept at most 8,192 bytes of JSON. The page-to-worker wait is bounded separately. Requests contain no chat text, installation ID, AI account data, tab URL or cookies; the URL is fixed.
- The last valid settings persist in local extension storage without automatic expiry. Offline, HTTP errors, malformed/oversized data, unknown schema versions/features/sites and invalid list types retain the last valid stop. First use without a valid cache remains enabled during an outage. Clearing extension storage clears that cache.
- Only valid settings lift a cached stop. Keep schema `version: 1` and the four packaged switch names. Additional switches require compatibility planning and a client update.
- The switch cannot undo a completed write or repair a worker that fails before the control module starts. Existing draft protection, cancellation, deadlines and capture size/completeness rules still apply. No automatic Send is added.

## Verification

```powershell
node --test test/remote-controls.test.js test/background.test.js test/platform-content.test.js test/extension-packaging.test.js test/ci-browser-checks.test.js
npm run test:remote-controls-smoke
```

Regular Brave CI includes this smoke: real worker alarms update an open chat, remove/restore the orb, block destination creation, retain shutdown through outages/invalid data, and preserve complete manual-copy context with an empty destination. Only its disposable extension copy shortens the cache interval. It uses synthetic content without hosted AI/database calls.

Chrome permits remote feature configuration when all behavior remains packaged: [Manifest V3 policy](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements). Scheduling can delay alarms: [alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms).
