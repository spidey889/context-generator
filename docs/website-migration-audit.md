# Website migration preflight — 2026-10-27

## Result

The homepage and finished videos can be separated from the extension/backend, but a straight move followed by a domain switch would break existing paths and tests. Do not remove the original files or switch `spreadz.in` until the routing and checks below are handled.

Audited source: `d65764facddc8d8fac93512d9438015a70817b1f`. This audit changed no website content, extension declarations, domains or DNS, and performed no manual deployment. The new repository and both new hosting URLs still contain only their setup placeholder. Committing these audit notes may trigger the existing repository's normal automated checks/deployments; that does not migrate the website.

## Minimum content set

The isolated candidate used 11 content files, totaling 41,027,720 bytes (about 39.13 MiB). This includes both finished videos, even though the homepage currently embeds only the newer one.

| Treatment in a later move | Files |
| --- | --- |
| Move homepage | `index.html` |
| Move finished videos | `brag/brag.mp4` (9,456,209 bytes, 62 s, 1920×1080); `2026-05-10 09-51-15.mp4` (31,259,253 bytes, 40.63 s, 1280×720) |
| Move required poster | `brag/brag.jpg` |
| Copy shared artwork; retain extension originals | `extension/icon128.png` and the five PNGs used by the homepage in `extension/logos/` |
| Copy existing terms; retain original | `LICENSE`, needed by the homepage's existing footer link |

The homepage's styles and scripts are inline. It has no npm build or direct backend calls. Google Fonts and the three Chrome Web Store install links are existing external dependencies; migration adds none.

Do **not** move `brag/work/`, its Python/Node scripts, `film.html`, `timeline.json`, native UI captures, audio metadata, credits, verification records, reference files or local audio/frame caches. Keep `brag/README.md` here. All 26 tracked supporting files were retained and their hashes were unchanged by the audit. Shared extension artwork and fonts must also stay here because both the extension and film sources use them.

The renderer still writes new exports into this repository's `brag/` directory. After the later move, document generating locally and publishing only the resulting MP4/JPG files to the website repository; ignore regenerated outputs here if appropriate. Do not relocate the renderer or its relative dependencies just to publish the website.

## Breakages a straight move would cause

1. **Privacy link:** `href="privacy.html"` resolves within the new website, where privacy must not be copied. The file-limited simulation returned 404. Point it to the preserved public privacy URL before publishing the real homepage.
2. **Domain paths:** the current `spreadz.in` domain is attached to this repository's GitHub Pages site (`master`, `/`), with HTTPS enforced. Its A records currently point to GitHub Pages. The new Vercel website returns 404 for `/analysis/` and `/privacy.html`. Changing DNS or attaching the domain to a homepage-only Pages site does not automatically preserve those paths.
3. **Retained-page artwork and navigation:** analysis uses `/extension/bubble-icon.png`; privacy uses that image and `/extension/icon48.png`. Routing only their HTML would leave broken images. Privacy's existing `index.html` home links must resolve to the new homepage at the preserved public origin.
4. **License and social preview:** keep the footer's `LICENSE` target available with the existing terms. The social-preview poster currently uses the old repository's GitHub Pages URL; update it to a durable new poster URL or explicitly preserve its redirect before removing the old output.
5. **CI after deletion:** both tests in `test/license.test.js` read root `index.html`. Simulating only its absence produced two `ENOENT` failures. Migrate website-specific checks to the website repository while retaining checks for this repository's license, privacy and analysis assets. `scripts/ci-scope.js` also still names the homepage; deletion correctly selects full checks, so do not weaken that gate to hide failures.

## Routing decision still required

Privacy and analysis files stay in this repository, and their public URLs must remain `https://spreadz.in/privacy.html` and `https://spreadz.in/analysis/`.

Two possible approaches remain proposals, not implemented architecture:

- Keep the existing domain/Pages attachment and retain a small root page that redirects only homepage traffic to the new website. This avoids a DNS switch but changes the address shown for the homepage and requires updating the root-page tests.
- If the homepage must continue to display `spreadz.in`, use the new Vercel website as the domain's front end and explicitly preserve the analysis/privacy routes and their dependent artwork through same-origin rewrites. The existing backend host already serves the matching analysis/privacy HTML and assets. Test that real Vercel routing before any domain cutover. Keep GitHub Pages and its legacy redirects working while transitioning.

[Vercel rewrites](https://vercel.com/docs/routing/rewrites) can serve another origin while retaining the browser URL. A redirect to a new analysis hostname would not preserve the extension's current content-script match. No routing choice or domain mutation was made during this audit.

## Permissions are a release constraint

Keep all extension API permissions, host permissions and content-script matches unchanged for the website move. In particular, retain `https://spreadz.in/analysis*`, the legacy GitHub analysis match, and the backend address `https://context-generator-five.vercel.app`. Do not add the new website or Vercel hostname to the extension manifest, including optional permissions or runtime prompts.

The actual unpacked extension, loaded in a separate headless Brave profile with its unmodified manifest, delivered a synthetic local receipt on `/analysis`, `/analysis/` and `/analysis/index.html` under an intercepted `https://spreadz.in` origin. The homepage and privacy page received no bridge. This proves the existing match/bridge behavior under the simulated routing; it does not certify an undeployed Vercel rewrite or DNS cutover.

Chrome documents that new warning-triggering permissions can disable an installed extension until accepted: [permission warnings](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings), [host and content-script declarations](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions). Before any extension release, compare the actual final package with the published package. An unpacked reload alone does not certify Chrome's packaged-update behavior.

## Verification performed

- **Live routes:** the current homepage, privacy, analysis, license and required retained-page images work. The existing Vercel host serves the same normalized homepage/privacy/analysis HTML as this checkout. The legacy GitHub analysis URL redirects to the existing `spreadz.in/analysis/` URL. Both new hosting roots still serve the placeholder.
- **Video delivery:** both current hosts returned HTTP 206 and the correct byte counts for 1 KiB range requests to each MP4. Both videos are H.264/AAC. Each is below GitHub's 100 MiB regular-file limit; the entire candidate is below Vercel's documented 100 MB Hobby CLI source-upload limit. See [GitHub file limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) and [Vercel limits](https://vercel.com/docs/limits). Actual deployment of these files to the new hosts is deferred.
- **Brave layout:** the allowlisted candidate loaded at both a root-style URL and a GitHub-project-style subpath at 1440×900 and 390×844. No missing images, page exceptions or horizontal overflow; all three install links and the demo anchor worked. With existing external fonts consistently blocked, surrounding-page screenshots matched the baseline at both sizes. Native video rendering was masked for visual comparison and tested separately; the final comparison had zero differing pixels.
- **Brave media:** both videos decoded, advanced during playback, retained native controls and sought successfully near the beginning, middle and end. The existing reduced-motion pause behavior remained intact.
- **Video recreation sources:** the original composition loaded at 1920×1080 and sampled six times across Claude, handoff, ChatGPT and title scenes with no missing images or page exceptions. All five Python sources parsed, all four `.cjs` files passed syntax checks, and all three native-capture replacement anchors remain present. The saved capture's production-source hash is already older than the current extension, so follow the documented capture-first recreation sequence; do not expect the old verification record alone to validate today's extension. No full re-encode, native recapture or source rewrite was performed.
- **Focused baseline:** all nine checks across `test/license.test.js`, `test/analysis.test.js` and `test/ci-scope.test.js` passed. The Git-range test initially hit sandbox denial when creating its temporary repository; its isolated rerun outside that filesystem sandbox passed.
- **Integrity:** the manifest and all 26 retained video-support files kept their original SHA-256 values. No original website or video file was removed or moved.

Local detailed evidence and disposable harnesses are under `.test-artifacts/website-migration-audit/`: `results.json`, `live-results.json`, `recreation-results.json`, screenshots and the scripts that produced them. They use synthetic extension storage, never the owner's browser profile or private transfer contents.

## Gate before moving or deleting

Publish and verify the candidate on the new hosting URLs first, preserve privacy/analysis routing and dependent images, repair homepage links, and update the website-dependent tests. Then verify the actual HTTPS/redirect/bridge behavior at the intended public URLs before deleting old outputs. These deployment/cutover checks remain intentionally unperformed because this request authorized verification only.
