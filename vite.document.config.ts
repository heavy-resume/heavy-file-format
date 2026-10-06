import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist-document',
    emptyOutDir: true,
    lib: {
      entry: 'src/document.ts',
      formats: ['es'],
      fileName: () => 'hvy-document.js',
    },
  },
});
