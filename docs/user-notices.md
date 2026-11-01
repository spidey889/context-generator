# User notices

To send a notice, edit [`backend/user-notices.json`](../backend/user-notices.json):

```json
{
  "49": "Your transfer should work now. Give it another try :)"
}
```

Use the existing Supabase `users.user_no` number as the key and the exact message as its value. Keep messages to 1,000 characters. The file contains one current message per user; preserve other users' entries when editing it. Messages are plain text, including literal markup, and are tracked repository content. Never put credentials or chat contents in them.

After the initial rollout below, deploy the backend with this file change to send the notice. An extension source edit or Chrome Store submission is unnecessary for later messages. A feature-branch push alone is not a production deployment. When the owner gives a number and message, update this file, validate it with `node --test test/user-notices.test.js`, and deploy within the owner's authorized scope. Do not claim delivery merely because the backend is deployed: the user must open a supported chat with the updated extension.

The current file preserves the previously approved notice for #49. Its old local seen flag is recognized, so users who already saw that bundled message do not see it again.

## Delivery

The worker POSTs only the existing installation UUID to `/api/user-notices`. An exact Vercel rewrite dispatches to the notice module through the existing telemetry API entry, keeping within the project's twelve-function limit. The notice module uses the existing private telemetry relay to read that installation's `users.user_no`; the client cannot choose a user number. The read neither creates a user nor changes counters or transfer diagnostics. Vercel returns only the matched notice, not the messages file or user directory. The existing relay URL, publishable key and private relay secret are reused; the database key stays in Edge.

A visible supported chat with a ready composer checks through the worker. The worker shares a five-minute cache across tabs and restarts; failed requests retry after one minute. Composer/visibility changes and a lifecycle-owned one-minute timer give an already open page another opportunity. Hidden tabs, sign-in pages, active transfers, the picker, handoff and copy/recovery notices wait. A refused display stays pending. Firefox diagnostics opt-out prevents installation-linked notice checks.

The notice uses the fallback-copy confirmation's existing glass material, 80px top/20px right position, right-side entrance, exit animation, reduced-motion behavior and ten-second lifetime. It says “Cap Context” above the exact message and offers only Dismiss. It does not focus the page, touch the composer, send a chat or include text in transfer diagnostics.

The stable notice ID hashes the user number and exact message. Changing the text makes a new notice; reusing identical text keeps the same ID and does not show it again. Delivery is serialized across tabs, with IDs retained in local extension storage across page/browser/worker restarts. The cache is tied to the installation UUID so an identity change cannot reuse another user's message. A reservation is persisted before display to avoid repeats if the acknowledgement is lost; explicit refusal or a definitely absent recipient releases it. A crash between reservation and display can therefore lose a notice rather than repeat it. Clearing extension storage resets local delivery history. There is no server delivery/read receipt.

Removing an entry stops future successful fetches from returning it. An already fetched, unseen message can still display while offline; removing an entry does not recall it. This is a small current-message system, not an inbox or a guaranteed delivery queue.

## Initial rollout

1. Deploy the updated `transfer-telemetry` Edge function, including `user-notices.mjs`. Its existing authenticated writer continues to handle ordinary telemetry; the new operation only reads a user number. No SQL migration is needed.
2. Deploy the Vercel backend, including `backend/user-notices.js` and `backend/user-notices.json`.
3. Publish one extension update containing `extension/user-notices.js` and the content/worker integration. Existing version 40 clients cannot fetch remote notices. Firefox packaging loads the same worker dependency in order.

This implementation was prepared locally; these rollout steps are separate actions.

## Verification

Five focused tests in `test/user-notices.test.js` cover authenticated targeting, once-only delivery and later messages, uncertain acknowledgements, privacy/failure handling, and legacy/installation history. The existing background/content tests cover sender boundaries, visible-page gating, exact text, Dismiss and expiry. Firefox packaging checks the new dependency.

`node scripts/run-user-notices-smoke.js` runs the actual unpacked extension in a new isolated Brave window. Synthetic lookups and a backend-only message change exercise automatic delivery, the real fallback Copy confirmation, matching notice styles/transitions, literal text, Dismiss, ten-second expiry, no-repeat after reload and another user's exclusion. It runs in regular browser CI. Optional `CAP_CONTEXT_NOTICE_SCREENSHOT_DIR` saves comparison screenshots outside the repository.
