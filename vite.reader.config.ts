import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    outDir: 'dist-reader',
    emptyOutDir: true,
    lib: {
      entry: 'src/reader.ts',
      formats: ['es'],
      fileName: () => 'hvy-reader.js',
    },
  },
});
