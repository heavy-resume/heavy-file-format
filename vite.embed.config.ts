import { defineConfig, type Plugin, type UserConfig } from 'vite';
import { createBrythonMinimalVfsPlugin } from './src/plugins/scripting/brython-minimal-vfs-plugin';
import { createHvyBuiltInPluginsPlugin } from './vite.config';

export const HVY_EMBED_ENVIRONMENT_BOUNDARY = {
  envDir: false,
  envPrefix: [],
} satisfies Pick<UserConfig, 'envDir' | 'envPrefix'>;

export default defineConfig(() => {
  return {
    ...HVY_EMBED_ENVIRONMENT_BOUNDARY,
    plugins: [
      createBrythonMinimalVfsPlugin(),
      createHvyBuiltInPluginsPlugin({ HVY_LAZY_BUILT_INS: 'true' }),
    ],
    build: {
      outDir: 'dist-embed',
      emptyOutDir: true,
      lib: {
        entry: 'src/embed.ts',
        name: 'HVY',
        formats: ['es'],
        fileName: () => 'hvy-embed.js',
      },
      rollupOptions: {
        output: {
          chunkFileNames: 'assets/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
          manualChunks(id) {
            if (id.includes('/src/editor/components/image/image-preset-css.ts')) {
              return 'image-preset-css';
            }
            if (id.includes('virtual:hvy-built-in-plugins')) {
              return 'embed-builtins';
            }
            if (id.includes('/src/plugins/form.ts')) {
              return 'form';
            }
            if (
              id.includes('/src/icons.ts') ||
              id.includes('/src/attachments.ts') ||
              id.includes('/src/plugins/db-table-format.ts') ||
              id.includes('/src/plugins/db-table-model.ts') ||
              id.includes('/src/plugins/db-table-fragment.ts') ||
              id.includes('/src/plugins/db-table-identifiers.ts')
            ) {
              return 'embed-core';
            }
            if (id.includes('/src/plugins/db-table.ts')) {
              return 'db-table-runtime';
            }
            if (
              id.includes('/src/serialization.ts') ||
              id.includes('/src/hvy/') ||
              id.includes('/src/types.ts')
            ) {
              return 'embed-core';
            }
            if (id.includes('node_modules/brython')) {
              return 'vendor-brython';
            }
            return undefined;
          },
        },
      },
    },
  };
});
