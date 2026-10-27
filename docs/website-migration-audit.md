# Website migration preflight — 2026-10-27

## Result

**Move status:** the new website is published in public `spidey889/context-generator-website`, commit `72803e52fa74fc5a2a5ee507f4454ead4196a6f3`. GitHub Pages and Vercel production are live with the real homepage and both videos; their checks passed. The owner explicitly approved reassignment of `spreadz.in` to Vercel project `context-generator-website`, which is complete. The owner will make the remaining GoDaddy DNS change. Original homepage/video files are retained here until that change and final public verification, so the old live site continues working. The following sections retain the evidence from before publication.

Required GoDaddy change, from Vercel's current domain configuration: replace the four existing root (`@`) A records `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153` with two root A records, `216.198.79.1` and `64.29.17.1`. Keep nameservers and unrelated records unchanged. `spreadz.in` is verified and attached to `prj_bRk8c0YWcckWPoeb8OE4kNXETyzX`; Vercel currently reports DNS still pointing to GitHub Pages. No GoDaddy account is connected to the Vercel tool, and the owner chose to do that step.

Production website deployment: `dpl_7wrGo96AQEQrfEch5ZArXLKJPEfD`, source `72803e5`, target `production`, `READY`. [Vercel site](https://context-generator-website.vercel.app/), [GitHub Pages site](https://spidey889.github.io/context-generator-website/). The website workflow verifies static dependencies, both videos, existing terms, absence of rendering sources/privacy/analysis copies and all six retained-page rules. Actual Brave checks on both deployed sites passed at 1440×900 and 390×844: images, width, install/demo links, privacy and Back to home, playback and three seek positions per video. Existing `spreadz.in/analysis/` still connected to the unmodified extension and displayed a synthetic receipt. Local publication evidence: `.test-artifacts/website-move/live-results.json`.

Compatibility discovered during execution: installed content scripts' header orb links to the original backend homepage (`context-generator-five.vercel.app`). The backend must keep an exact `/` and `/index.html` redirect to `spreadz.in` when its old homepage copy is removed. Exact video/poster redirects preserve the other moved backend URLs; API endpoints and retained pages must not redirect. Do not change extension scripts or permissions just to update that public link.

Execution verification also used an isolated Brave process with `spreadz.in` temporarily mapped to Vercel's recommended `216.198.79.1` inside that test browser only. The actual public hostname loaded over valid HTTPS on the new server, with no intercepted page bodies: desktop/mobile homepage and privacy/back-home clicks passed, both videos played and sought correctly, and analysis connected to the unchanged extension. A separate `curl --resolve` request returned HTTP 200 with TLS verification result 0. Neither test changed public DNS or the owner's browser/system settings. Evidence: `.test-artifacts/website-move/domain-results.json`.

The migration code's full required **Offline checks** passed on `7bbef2e93371e0f6dd5fcb686ad7f7a4193a5479` ([run](https://github.com/spidey889/context-generator/actions/runs/40462842281)). Its ready backend preview is `dpl_3UhMtgQTMvsbDAt8xTmnWy5RJuZL`. Preview checks confirm the exact old homepage/media redirects, retained privacy/analysis responses and unchanged GET rejection on `/api/summarize`. The earlier recording's redirect source must contain `%20`; a literal space failed to match the deployed request. Keep the original four homepage/media files until the owner's DNS step and a final ordinary public-DNS check succeed.

Final checks passed for the agreed setup: the new website supplies the homepage and videos, while Vercel continues to show privacy and analysis from this repository at their existing `spreadz.in` addresses. The required page configuration was tested on an actual Vercel preview, and browser navigation plus the unchanged extension bridge passed. The move can proceed using that tested configuration and the file/test changes identified below.

Initial audited source: `d65764facddc8d8fac93512d9438015a70817b1f`; final verification followed documentation commit `a9dd17438f3c1b617ebf660049d8a75f8ac518d0`. No website files, extension declarations, domains or DNS were changed. Final verification created staging-only Vercel previews containing a small placeholder and page configuration; the real homepage/videos were not uploaded. Both new production hosting URLs still show the setup placeholder, and the original live pages remain working. Committing audit notes may trigger this repository's normal automated checks/deployments; that does not migrate the website.

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

## Agreed setup, verified on Vercel

Privacy and analysis files stay in this repository, and their public URLs must remain `https://spreadz.in/privacy.html` and `https://spreadz.in/analysis/`.

The owner selected the setup where Vercel shows the new homepage and continues to show privacy/analysis from this repository. This was already one of the approaches in the initial audit. The earlier warnings described configuration that must be included during the move; they were not a claim that this setup is impossible or that privacy has to move.

The verified configuration for the future website's `vercel.json` is:

```json
{
  "rewrites": [
    { "source": "/privacy.html", "destination": "https://context-generator-five.vercel.app/privacy.html" },
    { "source": "/analysis", "destination": "https://context-generator-five.vercel.app/analysis/index.html" },
    { "source": "/analysis/", "destination": "https://context-generator-five.vercel.app/analysis/index.html" },
    { "source": "/analysis/index.html", "destination": "https://context-generator-five.vercel.app/analysis/index.html" },
    { "source": "/extension/bubble-icon.png", "destination": "https://context-generator-five.vercel.app/extension/bubble-icon.png" },
    { "source": "/extension/icon48.png", "destination": "https://context-generator-five.vercel.app/extension/icon48.png" }
  ]
}
```

Verified preview: `dpl_9DFdNsRNj2e8M7vxeh9UktRAaNXS`, [test deployment](https://context-generator-website-nkufs0cuu-vinits-projects-9bc84d4f.vercel.app), target `staging`, status `READY`. It is separate from the production alias and retains the team's existing preview protection.

All seven privacy/analysis/image checks returned HTTP 200, with no redirect away from the preview and content matching the original files. Both `/` and `/index.html` served the test placeholder; an unknown path correctly returned 404. The query form `/analysis/?demo` also returned the correct page. The first experimental wildcard rule handled `/analysis` but missed `/analysis/`; the final explicit rules above fixed that in the test deployment. Reuse these tested forms rather than assuming a wildcard handles both.

[Vercel rewrites](https://vercel.com/docs/routing/rewrites) retain the browser URL while serving the original page behind it. Keep GitHub Pages and its legacy redirects working during the later transition. No domain switch occurred in this check.

## Permissions are a release constraint

Keep all extension API permissions, host permissions and content-script matches unchanged for the website move. In particular, retain `https://spreadz.in/analysis*`, the legacy GitHub analysis match, and the backend address `https://context-generator-five.vercel.app`. Do not add the new website or Vercel hostname to the extension manifest, including optional permissions or runtime prompts.

The actual unpacked extension, loaded in a separate headless Brave profile with its unmodified manifest, delivered a synthetic local receipt on `/analysis`, `/analysis/`, `/analysis/index.html` and `/analysis/?demo` under an intercepted `https://spreadz.in` origin. Final browser checks used the actual page/image responses fetched through the Vercel preview, displayed `Connected` and rendered the receipt at desktop and mobile sizes. The homepage and privacy page received no bridge in the original checks. This verifies the existing extension behavior with the tested Vercel page content; the live DNS cutover still belongs to the later move.

Chrome documents that new warning-triggering permissions can disable an installed extension until accepted: [permission warnings](https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings), [host and content-script declarations](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions). Before any extension release, compare the actual final package with the published package. An unpacked reload alone does not certify Chrome's packaged-update behavior.

## Verification performed

- **Live routes:** the current homepage, privacy, analysis, license and required retained-page images work. The existing Vercel host serves the same normalized homepage/privacy/analysis HTML as this checkout. The legacy GitHub analysis URL redirects to the existing `spreadz.in/analysis/` URL. Both new hosting roots still serve the placeholder.
- **Video delivery:** both current hosts returned HTTP 206 and the correct byte counts for 1 KiB range requests to each MP4. Both videos are H.264/AAC. Each is below GitHub's 100 MiB regular-file limit; the entire candidate is below Vercel's documented 100 MB Hobby CLI source-upload limit. See [GitHub file limits](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github) and [Vercel limits](https://vercel.com/docs/limits). Actual deployment of these files to the new hosts is deferred.
- **Brave layout:** the allowlisted candidate loaded at both a root-style URL and a GitHub-project-style subpath at 1440×900 and 390×844. No missing images, page exceptions or horizontal overflow; all three install links and the demo anchor worked. With existing external fonts consistently blocked, surrounding-page screenshots matched the baseline at both sizes. Native video rendering was masked for visual comparison and tested separately; the final comparison had zero differing pixels.
- **Brave media:** both videos decoded, advanced during playback, retained native controls and sought successfully near the beginning, middle and end. The existing reduced-motion pause behavior remained intact.
- **Video recreation sources:** the original composition loaded at 1920×1080 and sampled six times across Claude, handoff, ChatGPT and title scenes with no missing images or page exceptions. All five Python sources parsed, all four `.cjs` files passed syntax checks, and all three native-capture replacement anchors remain present. The saved capture's production-source hash is already older than the current extension, so follow the documented capture-first recreation sequence; do not expect the old verification record alone to validate today's extension. No full re-encode, native recapture or source rewrite was performed.
- **Focused baseline:** all nine checks across `test/license.test.js`, `test/analysis.test.js` and `test/ci-scope.test.js` passed. The Git-range test initially hit sandbox denial when creating its temporary repository; its isolated rerun outside that filesystem sandbox passed.
- **Integrity:** the manifest and all 26 retained video-support files kept their original SHA-256 values. No original website or video file was removed or moved.
- **Final navigation:** on 1440×900 and 390×844, clicking the homepage's Privacy Policy link opened the original privacy content at `spreadz.in/privacy.html`; its Back to home link returned to the new-homepage simulation at `spreadz.in/index.html`. Privacy's canonical URL stayed unchanged. All four analysis URL forms displayed a synthetic extension receipt with no missing images or page exceptions, using the real preview-fetched responses.
- **Removal/test plan:** with the four proposed moved outputs hidden by a filesystem overlay, both original-repository license/image tests passed after removing only the homepage's read/list entries in memory. The edits were not applied to the real tests; they are part of the later move. This preserves the checks for retained privacy/analysis assets and existing source terms.
- **Live-site recheck:** after preview verification, the original homepage/privacy/analysis still returned 200. The new Vercel production and GitHub Pages roots still returned their original placeholder. The original Pages configuration still uses `master`, `/`, custom domain `spreadz.in` and enforced HTTPS.

Local detailed evidence and disposable harnesses are under `.test-artifacts/website-migration-audit/`: `results.json`, `live-results.json`, `recreation-results.json`, `final-results.json`, sanitized `preview-*.headers`, public response bodies, screenshots and the scripts that produced them. Vercel CLI handled protected-preview authentication; evidence headers exclude cookies and authentication values. Browser checks use synthetic extension storage, never the owner's browser profile or private transfer contents.

## Gate before moving or deleting

During the move, publish and verify the real homepage/videos at the new hosting URLs, include the tested configuration above, repair the homepage links and update the website-dependent tests. Switch the domain only after the new copy is working, then check actual HTTPS/legacy redirects/extension behavior at `spreadz.in` before deleting the old outputs. These are the remaining execution checks during the move, not an unresolved design decision. No pre-move check can verify files that have not yet been published or DNS that has not yet changed; keep the original copy available until those actual checks pass.
