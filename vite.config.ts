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
const HVY_GUIDE_API_PATH = '/api/hvy-guide-document';
const HVY_GUIDE_FILE_PATH = resolve(process.cwd(), 'hvy-guide.hvy');
const SCRIPTING_HELP_API_PATH = '/api/scripting-help-document';
const SCRIPTING_HELP_FILE_PATH = resolve(process.cwd(), 'src/plugins/scripting/help.hvy');

export const HVY_BUILT_IN_PLUGIN_IDS = [
  'hvy.db-table',
  'hvy.form',
  'hvy.progress-bar',
  'hvy.scripting',
  'hvy.graph',
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
  displayName: string;
}

const HVY_BUILT_IN_PLUGIN_DEFINITIONS: HvyBuiltInPluginDefinition[] = [
  {
    id: 'hvy.db-table',
    key: 'dbTable',
    exportName: 'dbTablePlugin',
    modulePath: 'src/plugins/db-table-plugin.ts',
    displayName: 'DB Table',
  },
  {
    id: 'hvy.form',
    key: 'form',
    exportName: 'formPlugin',
    modulePath: 'src/plugins/form.ts',
    displayName: 'Form',
  },
  {
    id: 'hvy.progress-bar',
    key: 'progressBar',
    exportName: 'progressBarPlugin',
    modulePath: 'src/plugins/progress-bar.ts',
    displayName: 'Progress Bar',
  },
  {
    id: 'hvy.scripting',
    key: 'scripting',
    exportName: 'scriptingPlugin',
    modulePath: 'src/plugins/scripting/scripting.ts',
    displayName: 'Scripting',
  },
  {
    id: 'hvy.graph',
    key: 'graph',
    exportName: 'graphPlugin',
    modulePath: 'src/plugins/graph.ts',
    displayName: 'Graph',
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

function normalizeRuntimeEnv(env: Record<string, string>): Record<string, string> {
  const runtimeEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      runtimeEnv[key] = value;
    }
  }
  return { ...runtimeEnv, ...env };
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
  const resolvedEnv = normalizeRuntimeEnv(env);
  const selectedIds = resolveBuiltInPluginIds(readHvyBuildConfig(resolvedEnv), resolvedEnv.HVY_BUILD_PLUGINS);
  const source = resolvedEnv.HVY_LAZY_BUILT_INS === 'true'
    ? createLazyHvyBuiltInPluginsModuleSource(selectedIds)
    : createHvyBuiltInPluginsModuleSource(selectedIds);
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
    name: 'hvy-source-document-save',
    configureServer(server) {
      server.middlewares.use(handleSourceDocumentRequest);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleSourceDocumentRequest);
    },
  };
}

function handleSourceDocumentRequest(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  const sourceDocument = getSourceDocumentForRequest(req.url);
  if (!sourceDocument) {
    next();
    return;
  }
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(readFileSync(sourceDocument.filePath, 'utf8'));
    return;
  }
  if (req.method === 'PUT') {
    void readRequestText(req)
      .then((body) => {
        writeFileSync(sourceDocument.filePath, body, 'utf8');
        res.statusCode = 200;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: true }));
      })
      .catch((error: unknown) => {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: error instanceof Error ? error.message : `Could not save ${sourceDocument.label}.` }));
      });
    return;
  }
  res.statusCode = 405;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error: 'Method not allowed.' }));
}

function getSourceDocumentForRequest(url: string | undefined): { filePath: string; label: string } | null {
  if (url?.startsWith(IMPORT_REFERENCE_API_PATH)) {
    return { filePath: IMPORT_REFERENCE_FILE_PATH, label: 'import reference document' };
  }
  if (url?.startsWith(HVY_GUIDE_API_PATH)) {
    return { filePath: HVY_GUIDE_FILE_PATH, label: 'HVY guide document' };
  }
  if (url?.startsWith(SCRIPTING_HELP_API_PATH)) {
    return { filePath: SCRIPTING_HELP_FILE_PATH, label: 'scripting help document' };
  }
  return null;
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

export function createLazyHvyBuiltInPluginsModuleSource(selectedIds: readonly HvyBuiltInPluginId[]): string {
  const selected = HVY_BUILT_IN_PLUGIN_DEFINITIONS.filter((definition) => selectedIds.includes(definition.id));
  const definitions = selected.map((definition) => ({
    id: definition.id,
    key: definition.key,
    displayName: definition.displayName,
    exportName: definition.exportName,
    importPath: toViteRootImportPath(definition.modulePath),
  }));
  const loaderEntries = definitions.map((definition, index) => {
    const importPath = JSON.stringify(definition.importPath);
    const exportName = JSON.stringify(definition.exportName);
    return `  ${JSON.stringify(definition.id)}: () => import(${importPath}).then((module) => module[${exportName}]),`;
  });
  return [
    `const definitions = ${JSON.stringify(definitions.map(({ importPath: _importPath, exportName: _exportName, ...definition }) => definition))};`,
    `const loaders = {`,
    ...loaderEntries,
    `};`,
    `const loadedPlugins = new Map();`,
    `const loadingPlugins = new Map();`,
    `function loadPlugin(definition) {`,
    `  const existing = loadedPlugins.get(definition.id);`,
    `  if (existing) return Promise.resolve(existing);`,
    `  const loading = loadingPlugins.get(definition.id);`,
    `  if (loading) return loading;`,
    `  const loader = loaders[definition.id];`,
    `  const promise = loader().then((plugin) => {`,
    `    if (!plugin) throw new Error(\`Unable to load built-in HVY plugin "\${definition.id}".\`);`,
    `    loadedPlugins.set(definition.id, plugin);`,
    `    loadingPlugins.delete(definition.id);`,
    `    return plugin;`,
    `  }).catch((error) => {`,
    `    loadingPlugins.delete(definition.id);`,
    `    throw error;`,
    `  });`,
    `  loadingPlugins.set(definition.id, promise);`,
    `  return promise;`,
    `}`,
    `async function runHook(plugin, hookName, ctx) {`,
    `  const hook = plugin.hooks?.[hookName];`,
    `  const handlers = Array.isArray(hook) ? hook : hook ? [hook] : [];`,
    `  for (const handler of handlers) {`,
    `    await handler.run(ctx);`,
    `  }`,
    `}`,
    `function documentUsesPlugin(document, pluginId) {`,
    `  const visitBlocks = (blocks) => {`,
    `    for (const block of blocks ?? []) {`,
    `      if (block?.schema?.component === 'plugin' && block.schema.plugin === pluginId) return true;`,
    `      if (visitBlocks(block?.schema?.children?.children)) return true;`,
    `      if (visitBlocks(block?.schema?.items)) return true;`,
    `      if (visitBlocks(block?.schema?.expandableStubBlocks?.children)) return true;`,
    `      if (visitBlocks(block?.schema?.expandableContentBlocks?.children)) return true;`,
    `    }`,
    `    return false;`,
    `  };`,
    `  const visitSections = (sections) => {`,
    `    for (const section of sections ?? []) {`,
    `      if (visitBlocks(section?.blocks)) return true;`,
    `      if (visitSections(section?.children)) return true;`,
    `    }`,
    `    return false;`,
    `  };`,
    `  return visitSections(document?.sections);`,
    `}`,
    `function createLazyPlugin(definition) {`,
    `  return {`,
    `    id: definition.id,`,
    `    displayName: definition.displayName,`,
    `    create(ctx) {`,
    `      const root = document.createElement('div');`,
    `      root.className = 'hvy-plugin-loading';`,
    `      root.textContent = \`Loading \${definition.displayName}...\`;`,
    `      let instance = null;`,
    `      let mounted = true;`,
    `      loadPlugin(definition).then((plugin) => {`,
    `        if (!mounted) return;`,
    `        const factory = plugin.create ?? plugin.components?.[0]?.create;`,
    `        if (!factory) {`,
    `          root.textContent = \`\${definition.displayName} is unavailable.\`;`,
    `          return;`,
    `        }`,
    `        instance = factory(ctx);`,
    `        root.replaceChildren(instance.element);`,
    `        ctx.requestRerender();`,
    `      }).catch((error) => {`,
    `        root.textContent = error instanceof Error ? error.message : \`Failed to load \${definition.displayName}.\`;`,
    `      });`,
    `      return {`,
    `        element: root,`,
    `        refresh() { instance?.refresh?.(); },`,
    `        unmount() {`,
    `          mounted = false;`,
    `          instance?.unmount?.();`,
    `        },`,
    `      };`,
    `    },`,
    `    hooks: {`,
    `      documentLoad: { async run(ctx) { if (documentUsesPlugin(ctx.document, definition.id)) await runHook(await loadPlugin(definition), 'documentLoad', ctx); } },`,
    `      documentChange: { async run(ctx) { if (documentUsesPlugin(ctx.document, definition.id)) await runHook(await loadPlugin(definition), 'documentChange', ctx); } },`,
    `    },`,
    `    aiHint(block) {`,
    `      const loaded = loadedPlugins.get(definition.id);`,
    `      const hint = loaded?.aiHint;`,
    `      return typeof hint === 'function' ? hint(block) : hint ?? definition.displayName;`,
    `    },`,
    `    aiHelp(block) {`,
    `      const loaded = loadedPlugins.get(definition.id);`,
    `      const help = loaded?.aiHelp;`,
    `      return typeof help === 'function' ? help(block) : help ?? definition.displayName;`,
    `    },`,
    `  };`,
    `}`,
    `export const builtInPluginIds = ${JSON.stringify(selectedIds)};`,
    `export const builtInPlugins = definitions.map(createLazyPlugin);`,
    `export const builtInPluginMap = Object.freeze(Object.fromEntries(builtInPlugins.map((plugin, index) => [definitions[index].key, plugin])));`,
    `export const builtInPluginById = Object.freeze(Object.fromEntries(builtInPlugins.map((plugin) => [plugin.id, plugin])));`,
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
