import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(projectRoot, '..');
const archifyRoot = process.argv[2];
if (!archifyRoot) throw new Error('Pass the installed Archify skill directory: npm run generate -- /path/to/archify');
const artifact = 'architecture/.archify/viewer.html';
const result = spawnSync(process.execPath, [
  resolve(archifyRoot, 'bin/archify.mjs'), 'finalize', 'architecture',
  'architecture/diagram.json', artifact, '--repo-root', repoRoot,
  '--quality', 'showcase', '--out-dir', 'architecture/.archify/evidence', '--json',
], { cwd: repoRoot, encoding: 'utf8' });
process.stdout.write(result.stdout || '');
process.stderr.write(result.stderr || '');
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const html = readFileSync(resolve(repoRoot, artifact), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const styles = [...html.matchAll(/<style\b([^>]*)>([\s\S]*?)<\/style>/gi)];
const executableScripts = scripts.filter(match => !/application\/json/i.test(match[1]));
if (executableScripts.length !== 2 || styles.length !== 2) {
  throw new Error('Archify output structure changed; inspect it before extracting the viewer.');
}
// Preserve the source/i18n JSON blocks in the body. Astro bundles only the runtime,
// while the font style remains inline because SVG/raster exports read its text.
const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1];
if (!body) throw new Error('Archify output has no body.');
const target = resolve(projectRoot, 'src/generated');
mkdirSync(target, { recursive: true });
const files = {
  'diagram.html': body.replace(executableScripts[1][0], '').trim(),
  'fonts.css': styles[0][2].trim(),
  'viewer.css': styles[1][2].trim().replace(/^[ \t]+$/gm, ''),
  'theme.js': executableScripts[0][2].trim(),
  'viewer.js': executableScripts[1][2].trim(),
};
for (const [name, content] of Object.entries(files)) writeFileSync(resolve(target, name), content + '\n');
console.log('Extracted the checked diagram into Astro source assets.');
