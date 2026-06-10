import postcss, { type Rule } from 'postcss';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { createBrythonMinimalVfsPlugin, createHvyBuiltInPluginsPlugin } from './vite.config';

const EMBED_SCOPE = ':where(.hvy-document)';

function splitSelectors(selector: string): string[] {
  const selectors: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (quote) {
      if (char === '\\') {
        index += 1;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === '(' || char === '[') {
      depth += 1;
      continue;
    }
    if (char === ')' || char === ']') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === ',' && depth === 0) {
      selectors.push(selector.slice(start, index).trim());
      start = index + 1;
    }
  }
  selectors.push(selector.slice(start).trim());
  return selectors.filter(Boolean);
}

function scopeSelector(selector: string): string {
  if (selector.includes(EMBED_SCOPE)) {
    return selector;
  }
  if (selector.startsWith(':root')) {
    return selector.replace(/^:root\b/, EMBED_SCOPE);
  }
  if (selector === 'html' || selector === 'body') {
    return EMBED_SCOPE;
  }
  if (selector.startsWith('html ') || selector.startsWith('body ')) {
    return `${EMBED_SCOPE} ${selector.slice(selector.indexOf(' ') + 1)}`;
  }
  return `${EMBED_SCOPE} ${selector}`;
}

function isInsideKeyframes(rule: Rule): boolean {
  let parent = rule.parent;
  while (parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) {
      return true;
    }
    parent = parent.parent;
  }
  return false;
}

function createEmbedCssScopePlugin(): Plugin {
  return {
    name: 'hvy-embed-css-scope',
    enforce: 'post' as const,
    async generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.css')) {
          continue;
        }
        const result = await postcss([
          {
            postcssPlugin: 'hvy-embed-css-scope',
            Rule(rule) {
              if (isInsideKeyframes(rule)) {
                return;
              }
              rule.selector = splitSelectors(rule.selector).map(scopeSelector).join(',');
            },
          },
        ]).process(String(asset.source), { from: undefined });
        asset.source = result.css;
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, '.', ''), HVY_LAZY_BUILT_INS: 'true' };

  return {
    plugins: [createBrythonMinimalVfsPlugin(), createHvyBuiltInPluginsPlugin(env), createEmbedCssScopePlugin()],
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
