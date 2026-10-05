# Cap Context architecture

The interactive diagram is an isolated Astro project. Its page is `src/pages/index.astro`; `diagram.json` is the editable Archify specification. The generated SVG, source links, theme controls and exports keep the original diagram's behavior.

Use Node 22.12 or newer:

```powershell
cd C:\Users\vinit\Desktop\context-generator\architecture
npm.cmd ci
npm.cmd run dev
```

Open the local address Astro prints. For a static build, run `npm.cmd run build`; `npm.cmd run preview` serves `dist/`. Astro bundles/minifies the viewer JavaScript and CSS. Fonts remain embedded for dependable diagram exports, and the page loads no framework runtime.

When the production flow changes, update `diagram.json`'s pinned repository revision, source ranges and facts, then regenerate with the installed Archify skill directory:

```powershell
npm.cmd run generate -- C:\Users\vinit\.agents\skills\archify
npm.cmd run build
```

`generate` requires passing Archify showcase, artifact and browser checks before replacing `src/generated/`. Check the finished Astro page after regeneration, including theme changes, source links and an SVG export. `LOGIC.md` remains the detailed behavior contract; the pinned diagram is a source snapshot, not proof of a hosted deployment. The marketing site's separate `website/` migration and root hosting settings are outside this project.

Generated with [Archify](https://github.com/tt-a1i/archify), under the accompanying [MIT license](ARCHIFY-LICENSE.txt). Preserve that license when redistributing the viewer. The embedded fonts include their own license notices.
