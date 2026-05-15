import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { createChatProxyPlugin } from './proxy/chat-proxy';

const require = createRequire(import.meta.url);
const BRYTHON_MINIMAL_VFS_ID = 'virtual:hvy-brython-minimal-vfs';
const BRYTHON_MINIMAL_VFS_RESOLVED_ID = `\0${BRYTHON_MINIMAL_VFS_ID}`;
const BUILT_IN_PLUGINS_ID = 'virtual:hvy-built-in-plugins';
const BUILT_IN_PLUGINS_RESOLVED_ID = `\0${BUILT_IN_PLUGINS_ID}`;
const IMPORT_REFERENCE_API_PATH = '/api/import-reference-document';
const IMPORT_REFERENCE_FILE_PATH = resolve(process.cwd(), 'src/ai-import-hvy-format-reference.hvy');

export const HVY_BUILT_IN_PLUGIN_IDS = [
  'dev.hvy.db-table',
  'dev.hvy.form',
  'dev.hvy.progress-bar',
  'dev.hvy.scripting',
] as const;

type HvyBuiltInPluginId = (typeof HVY_BUILT_IN_PLUGIN_IDS)[number];

interface HvyBuildPluginObjectConfig {
  plugins?: HvyBuiltInPluginId[] | 'all';
  include?: HvyBuiltInPluginId[];
  exclude?: HvyBuiltInPluginId[];
}

interface HvyBuiltInPluginDefinition {
  id: HvyBuiltInPluginId;
  key: string;
  exportName: string;
  modulePath: string;
}

const HVY_BUILT_IN_PLUGIN_DEFINITIONS: HvyBuiltInPluginDefinition[] = [
  {
    id: 'dev.hvy.db-table',
    key: 'dbTable',
    exportName: 'dbTablePlugin',
    modulePath: 'src/plugins/db-table-plugin.ts',
  },
  {
    id: 'dev.hvy.form',
    key: 'form',
    exportName: 'formPlugin',
    modulePath: 'src/plugins/form.ts',
  },
  {
    id: 'dev.hvy.progress-bar',
    key: 'progressBar',
    exportName: 'progressBarPlugin',
    modulePath: 'src/plugins/progress-bar.ts',
  },
  {
    id: 'dev.hvy.scripting',
    key: 'scripting',
    exportName: 'scriptingPlugin',
    modulePath: 'src/plugins/scripting/scripting.ts',
  },
];

function isBuiltInPluginId(value: unknown): value is HvyBuiltInPluginId {
  return typeof value === 'string' && (HVY_BUILT_IN_PLUGIN_IDS as readonly string[]).includes(value);
}

function normalizePluginIds(values: unknown, fieldName: string): HvyBuiltInPluginId[] {
  if (!Array.isArray(values)) {
    throw new Error(`HVY build config field "${fieldName}" must be an array of built-in plugin ids.`);
  }
  const normalized: HvyBuiltInPluginId[] = [];
  for (const value of values) {
    if (!isBuiltInPluginId(value)) {
      throw new Error(`Unknown HVY built-in plugin id in "${fieldName}": ${String(value)}`);
    }
    if (!normalized.includes(value)) {
      normalized.push(value);
    }
  }
  return normalized;
}

export function resolveBuiltInPluginIds(config: unknown, envPluginList?: string): HvyBuiltInPluginId[] {
  if (typeof envPluginList === 'string' && envPluginList.trim().length > 0) {
    const ids = envPluginList.trim() === 'all' ? [...HVY_BUILT_IN_PLUGIN_IDS] : envPluginList.split(',').map((id) => id.trim()).filter(Boolean);
    return normalizePluginIds(ids, 'HVY_BUILD_PLUGINS');
  }
  if (config === null || typeof config === 'undefined') {
    return [...HVY_BUILT_IN_PLUGIN_IDS];
  }
  if (Array.isArray(config)) {
    return normalizePluginIds(config, 'plugins');
  }
  if (typeof config !== 'object') {
    throw new Error('HVY build config must be an object or an array of built-in plugin ids.');
  }
  const buildConfig = config as HvyBuildPluginObjectConfig;
  const base = Array.isArray(buildConfig.plugins)
    ? normalizePluginIds(buildConfig.plugins, 'plugins')
    : buildConfig.plugins === 'all' || typeof buildConfig.plugins === 'undefined'
      ? [...HVY_BUILT_IN_PLUGIN_IDS]
      : (() => {
          throw new Error('HVY build config field "plugins" must be "all" or an array of built-in plugin ids.');
        })();
  const include = 'include' in buildConfig ? normalizePluginIds(buildConfig.include ?? [], 'include') : [];
  const exclude = new Set('exclude' in buildConfig ? normalizePluginIds(buildConfig.exclude ?? [], 'exclude') : []);
  const selected = base.filter((id) => !exclude.has(id));
  for (const id of include) {
    if (!selected.includes(id)) {
      selected.push(id);
    }
  }
  return selected;
}

function readHvyBuildConfig(env: Record<string, string>): unknown {
  const configPath = resolve(process.cwd(), env.HVY_BUILD_CONFIG || 'hvy.build.json');
  if (!existsSync(configPath)) {
    return undefined;
  }
  return JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
}

function toViteRootImportPath(modulePath: string): string {
  return `/${modulePath.replace(/^\/+/, '')}`;
}

export function createBrythonMinimalVfsPlugin(): Plugin {
  return {
    name: 'hvy-brython-minimal-vfs',
    resolveId(id) {
      return id === BRYTHON_MINIMAL_VFS_ID ? BRYTHON_MINIMAL_VFS_RESOLVED_ID : null;
    },
    load(id) {
      if (id !== BRYTHON_MINIMAL_VFS_RESOLVED_ID) {
        return null;
      }
      const stdlibPath = require.resolve('brython/brython_stdlib.js');
      const stdlibSource = readFileSync(stdlibPath, 'utf8');
      const marker = 'var scripts = ';
      const start = stdlibSource.indexOf(marker);
      const end = stdlibSource.lastIndexOf('\n__BRYTHON__.update_VFS');
      if (start < 0 || end < 0) {
        throw new Error('Unable to extract Brython VFS metadata.');
      }
      const vfs = Function(`return ${stdlibSource.slice(start + marker.length, end).trim().replace(/;$/, '')}`)() as Record<string, unknown>;
      const minimalVfs = {
        $timestamp: vfs.$timestamp,
        browser: vfs.browser,
        sys: vfs.sys,
      };
      const source = [
        '__BRYTHON__.use_VFS = true;',
        `__BRYTHON__.update_VFS(${JSON.stringify(minimalVfs)});`,
      ].join('\n');
      return `export default ${JSON.stringify(source)};`;
    },
  };
}

export function createHvyBuiltInPluginsPlugin(env: Record<string, string>): Plugin {
  const selectedIds = resolveBuiltInPluginIds(readHvyBuildConfig(env), env.HVY_BUILD_PLUGINS);
  const source = createHvyBuiltInPluginsModuleSource(selectedIds);
  return {
    name: 'hvy-built-in-plugins',
    resolveId(id) {
      return id === BUILT_IN_PLUGINS_ID ? BUILT_IN_PLUGINS_RESOLVED_ID : null;
    },
    load(id) {
      if (id !== BUILT_IN_PLUGINS_RESOLVED_ID) {
        return null;
      }
      return source;
    },
  };
}

export function createImportReferenceDocumentPlugin(): Plugin {
  return {
    name: 'hvy-import-reference-document',
    configureServer(server) {
      server.middlewares.use(handleImportReferenceDocumentRequest);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleImportReferenceDocumentRequest);
    },
  };
}

function handleImportReferenceDocumentRequest(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  if (!req.url?.startsWith(IMPORT_REFERENCE_API_PATH)) {
    next();
    return;
  }
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(readFileSync(IMPORT_REFERENCE_FILE_PATH, 'utf8'));
    return;
  }
  if (req.method === 'PUT') {
    void readRequestText(req)
      .then((body) => {
        writeFileSync(IMPORT_REFERENCE_FILE_PATH, body, 'utf8');
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true }));
      })
      .catch((error: unknown) => {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Could not save import reference document.' }));
      });
    return;
  }
  res.statusCode = 405;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: 'Method not allowed.' }));
}

function readRequestText(req: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolveText, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on('end', () => resolveText(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function createHvyBuiltInPluginsModuleSource(selectedIds: readonly HvyBuiltInPluginId[]): string {
  const selected = HVY_BUILT_IN_PLUGIN_DEFINITIONS.filter((definition) => selectedIds.includes(definition.id));
  const imports = selected.map((definition, index) => {
    const importPath = JSON.stringify(toViteRootImportPath(definition.modulePath));
    return `import { ${definition.exportName} as plugin${index} } from ${importPath};`;
  });
  return [
    ...imports,
    `export const builtInPluginIds = ${JSON.stringify(selectedIds)};`,
    `export const builtInPlugins = [${selected.map((_definition, index) => `plugin${index}`).join(', ')}];`,
    `export const builtInPluginMap = Object.freeze({`,
    ...selected.map((definition, index) => `  ${definition.key}: plugin${index},`),
    `});`,
    `export const builtInPluginById = Object.freeze({`,
    ...selected.map((definition, index) => `  ${JSON.stringify(definition.id)}: plugin${index},`),
    `});`,
  ].join('\n');
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [
      createChatProxyPlugin(env),
      createImportReferenceDocumentPlugin(),
      createBrythonMinimalVfsPlugin(),
      createHvyBuiltInPluginsPlugin(env),
    ],
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/highlight.js')) {
              return 'vendor-highlight';
            }
            if (
              id.includes('node_modules/marked') ||
              id.includes('node_modules/dompurify') ||
              id.includes('node_modules/turndown')
            ) {
              return 'vendor-markdown';
            }
            if (id.includes('node_modules/yaml')) {
              return 'vendor-yaml';
            }
            if (id.includes('/src/editor/')) {
              return 'app-editor';
            }
            if (id.includes('/src/reader/')) {
              return 'app-reader';
            }
            if (
              id.includes('/src/chat') ||
              id.includes('/src/ai-') ||
              id.includes('/src/chat-')
            ) {
              return 'app-ai-chat';
            }
            return undefined;
          },
        },
      },
    },
    server: {
      host: true,
      port: 5173,
    },
  };
});
