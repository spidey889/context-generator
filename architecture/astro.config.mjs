import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  compressHTML: true,
  build: { inlineStylesheets: 'never' },
  devToolbar: { enabled: false },
  vite: { build: { minify: true, cssMinify: true } },
});
