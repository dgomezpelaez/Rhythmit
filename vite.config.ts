import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the same build works on GitHub Pages subpaths and itch.io zips.
  base: './',
});
