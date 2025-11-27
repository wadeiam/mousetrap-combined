import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// IMPORTANT: base './' so built files use relative URLs (works under /app/ and /tunnel/<MAC>/app/)
export default defineConfig({
  base: './',
  plugins: [svelte()],
  build: { outDir: 'dist', assetsDir: 'assets' }
});
