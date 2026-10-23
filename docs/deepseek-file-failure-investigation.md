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

## October 24: native-code comparison and matching reproduction

Inspected DeepSeek's public October 24 JavaScript, independently of any user's
chat. Its [native URL builder](https://fe-static.deepseek.com/chat/static/main.85762178e1.js)
appends `ty=r` without reserializing the existing signed query. Its
[text-preview component](https://fe-static.deepseek.com/chat/static/previewAll.b480bed194.js)
uses ordinary `fetch(url)` and reads the text, allowing the default redirect
behavior. These are current site assets, not a captured version from the
historical transfer.

Our archived v19 hook instead passes `redirect: "error"` to every owned request.
A local HTTP server returning a real 302 to an otherwise readable text file
reproduced the saved observations through that hook: `network_error`,
`attachment_body`, zero file bytes, and the earlier history's status 200.
The same address with the native preview's ordinary fetch followed the redirect,
returned 200 and read the complete original text. Retrying the strict download
would fail the same way while the server kept redirecting. This establishes a
concrete redirect incompatibility, not evidence that this user's file redirected.

A second comparison found that `url.searchParams.set("ty", "r")` can rewrite the
existing query encoding, for example `%20` to `+` and `~` to `%7E`. DeepSeek's
append-only builder preserves it. A local URL probe confirms that difference;
there is no evidence that the historical link contained these characters or
that DeepSeek signs the raw query bytes. It is an unconfirmed risk, not a proven
signature failure.

The same archived-hook harness also reproduced the broad saved label for a
rejected fetch, a first-body-read failure and a locked reader. An exposed HTTP
403 instead produced `http_error`; an unsupported response type produced
`non_json_response`. These alternatives prevent uniquely identifying the
historical cause from this record. During that comparison, no runtime policy was changed and no other user's
files or additional transfer records were read.

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

## Owner-approved compatibility fix

The worktree branch now lets only validated DeepSeek file GETs follow redirects,
with credentials omitted and no source referrer. History/RPC requests remain
redirect-strict. Original signed query bytes are preserved when appending the
file type. File identity, exact byte/UTF-8 validation, raw/transcript limits,
cancellation and bounded download concurrency remain in place. The DeepSeek
hook and bridge advance together to v23 so stale injected hooks are replaced.

The two new regressions failed before this change and passed afterward: a real
redirect now returns the exact file text (including measurement), short/excess
bodies still fail, and signed query encoding stays intact. The ordinary Brave
fixture now redirects file requests to a different loopback origin with CORS,
checks credential/referrer isolation on both hops, and retains exact capture,
four-way overlap and destination checks.

Validation passed: 742 deterministic tests, both long-capture checks, the ordinary
Brave redirected-file transfer and the Brave background-size rejection case.

This fixes a demonstrated compatibility issue. The historical transfer's actual
cause remains unproven, and no hosted migration or extension publication is
implied. Status: **DONE_WITH_CONCERNS**.
