# One-time apology notice

Campaign: transfer-apology-20260918. Exact recipient: production CAP_NOTICE_TARGET_INSTALL_ID. Remove that variable and redeploy to disable delivery. No other installation receives this notice.

Approved copy:

> Sorry your transfer failed earlier.
>
> We fixed a few things—give it another try when you can ✌️

The updated extension checks when a foreground AI page has a visible orb. An atomic Redis claim and persistent local check prevent repeated display across tabs, sites, refreshes, and worker restarts. OK or 30 seconds closes it. Existing 1.4.4 installs must update first.

## Check whether he clicked OK

In the connected Vercel Upstash REPL, run:

    HGETALL cap-context:notice:transfer-apology-20260918:<install-id>

- claimed_at: delivery claimed; not proof it rendered.
- displayed_at: popup rendered.
- dismissal = ok: he clicked OK, got it.
- dismissal = timeout: automatic dismissal after 30 seconds.
- dismissed_at: server receipt timestamp, potentially delayed if an offline event was retried.
- Empty record: no claim recorded yet.

A shown receipt with no dismissal means no closing event reached the server; do not infer a click. A crash between claim and render may consume delivery without display. At most once is deliberate: the apology must not nag. Redis receipts have no expiry; local acknowledgements retry using the existing telemetry alarm. No transcript is collected.
