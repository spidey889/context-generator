# DeepSeek file-download investigation

Investigated one previously selected failed transfer on October 23, 2026. No
other transfer records were inspected for this investigation. This note omits
installation, attempt and file identities.

## Confirmed evidence

- Both the initial capture and its automatic retry used DeepSeek adapter v19.
- Each read the history successfully, then recorded `network_error` at
  `attachment_body`, with zero downloaded file bytes.
- The descriptors passed validation and their combined declared size was below
  the supported-file budget. No file-size guard was recorded.
- The source reported online. This does not establish internet connectivity or
  identify the cause of a particular failed request.
- DOM fallback later reached the six-minute transfer deadline. That timeout is
  separate from the earlier file-download failures.

## What cannot be recovered

Adapter v19 did not record the failing file's position, native error type,
response status or whether the failure occurred before the response or while
reading its body. Its `http_status: 200` can belong to the successful history
request; it does not prove that a file returned 200.

A rejected file fetch and an interrupted first body read can both produce the
saved label. The record cannot distinguish them or prove a specific server,
browser policy, redirect or connectivity cause. It also cannot identify the
filename or prove that the complete transcript exceeded the character limit.
Do not turn these possibilities into a historical diagnosis.

## Next useful step

The source already includes detailed file observations in v20 and later hooks.
The targeted diagnosis test passes for fetch rejection, an HTTP 403 response and
an interrupted body; these are simulated cases, not a reproduction of this
transfer.

Read-only checks of the hosted project found migration
`20261023123334_deepseek_file_diagnostics` absent and the active client-diagnostics
validator missing `failure_phase` and `failure_http_status`. Complete the
documented migration, compatible Edge/relay and updated-extension rollout before
reproducing the failure. Merely merging source does not enable these observations
in installed clients or the hosted validator. Even the new fields cannot reveal
browser-hidden CORS/DNS/redirect details without a browser network trace.

No runtime fix or hosted change was made: the original file failure's root cause
remains unproven. Status: **DONE_WITH_CONCERNS**.
