import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';
import { build, type Rollup } from 'vite';

import { createBrythonMinimalVfsPlugin } from '../src/plugins/scripting/brython-minimal-vfs-plugin';
import { canvasPlugin } from '../src/plugins/canvas/canvas';
import { dbTablePlugin } from '../src/plugins/db-table/db-table-component';
import { diagramPlugin } from '../src/plugins/diagram';
import { editableTextPlugin } from '../src/plugins/editable-text/editable-text';
import { formPlugin } from '../src/plugins/form';
import { graphPlugin } from '../src/plugins/graph';
import { model3dPlugin } from '../src/plugins/model-3d/model-3d';
import { powerScriptingPlugin } from '../src/plugins/power-scripting/power-scripting';
import { progressBarPlugin } from '../src/plugins/progress-bar';
import { qrCodePlugin } from '../src/plugins/qr-code/qr-code';
import { scriptingPlugin } from '../src/plugins/scripting/scripting';
import type { HvyPlugin } from '../src/plugins/types';
import { videoPlugin } from '../src/plugins/video/video';
import { createHvyBuiltInPluginsModuleSource, createLazyHvyBuiltInPluginsModuleSource, HVY_BUILT_IN_PLUGIN_IDS, resolveBuiltInPluginIds } from '../vite-built-in-plugins';

test('resolveBuiltInPluginIds defaults to every built-in plugin', () => {
  expect(resolveBuiltInPluginIds(undefined)).toEqual([...HVY_BUILT_IN_PLUGIN_IDS]);
  expect(HVY_BUILT_IN_PLUGIN_IDS).toContain('hvy.diagram');
  expect(HVY_BUILT_IN_PLUGIN_IDS).toContain('hvy.qr-code');
  expect(HVY_BUILT_IN_PLUGIN_IDS).toContain('hvy.video');
  expect(HVY_BUILT_IN_PLUGIN_IDS).toContain('hvy.editable-text');
  expect(HVY_BUILT_IN_PLUGIN_IDS).toContain('hvy.canvas');
  expect(HVY_BUILT_IN_PLUGIN_IDS).toContain('hvy.power-scripting');
  expect(HVY_BUILT_IN_PLUGIN_IDS).toContain('hvy.db-table');
  expect(HVY_BUILT_IN_PLUGIN_IDS).not.toContain('hvy.db-table-v2');
});

test('default build config includes every built-in plugin', () => {
  const buildConfig = JSON.parse(readFileSync('hvy.build.json', 'utf8')) as { plugins?: string[] };

  expect(buildConfig.plugins).toEqual([...HVY_BUILT_IN_PLUGIN_IDS]);
});

test('resolveBuiltInPluginIds accepts an explicit plugin list', () => {
  const expectedResult = resolveBuiltInPluginIds({
    plugins: ['hvy.form', 'hvy.progress-bar'],
  });

  expect(expectedResult).toEqual(['hvy.form', 'hvy.progress-bar']);
});

test('resolveBuiltInPluginIds supports include and exclude config', () => {
  const expectedResult = resolveBuiltInPluginIds({
    plugins: ['hvy.db-table', 'hvy.form', 'hvy.scripting'],
    exclude: ['hvy.form'],
    include: ['hvy.progress-bar'],
  });

  expect(expectedResult).toEqual(['hvy.db-table', 'hvy.scripting', 'hvy.progress-bar']);
});

test('resolveBuiltInPluginIds lets HVY_BUILD_PLUGINS override file config', () => {
  const expectedResult = resolveBuiltInPluginIds(
    { plugins: ['hvy.db-table'] },
    'hvy.form, hvy.scripting'
  );

  expect(expectedResult).toEqual(['hvy.form', 'hvy.scripting']);
});

test('resolveBuiltInPluginIds rejects unknown plugin ids', () => {
  expect(() =>
    resolveBuiltInPluginIds({
      plugins: ['hvy.form', 'hvy.unknown'],
    })
  ).toThrow('Unknown HVY built-in plugin id');
});

test('createHvyBuiltInPluginsModuleSource uses Vite web-root imports', () => {
  const expectedResult = createHvyBuiltInPluginsModuleSource(['hvy.db-table', 'hvy.scripting', 'hvy.graph', 'hvy.diagram', 'hvy.qr-code', 'hvy.video', 'hvy.editable-text']);

  expect(expectedResult).toContain('from "/src/plugins/db-table/db-table-component.ts"');
  expect(expectedResult).toContain('from "/src/plugins/scripting/scripting.ts"');
  expect(expectedResult).toContain('from "/src/plugins/graph.ts"');
  expect(expectedResult).toContain('from "/src/plugins/diagram.ts"');
  expect(expectedResult).toContain('from "/src/plugins/qr-code/qr-code.ts"');
  expect(expectedResult).toContain('from "/src/plugins/video/video.ts"');
  expect(expectedResult).toContain('from "/src/plugins/editable-text/editable-text.ts"');
  expect(expectedResult).not.toContain('/Users/');
  expect(expectedResult).not.toContain(process.cwd());
});

test('createLazyHvyBuiltInPluginsModuleSource defers built-in plugin implementations', () => {
  const expectedResult = createLazyHvyBuiltInPluginsModuleSource(['hvy.db-table', 'hvy.scripting']);

  expect(expectedResult).toContain('() => import("/src/plugins/db-table/db-table-component.ts")');
  expect(expectedResult).toContain('() => import("/src/plugins/scripting/scripting.ts")');
  expect(expectedResult).not.toContain('"importPath":"/src/plugins/db-table/db-table-component.ts"');
  expect(expectedResult).not.toContain('"importPath":"/src/plugins/scripting/scripting.ts"');
  expect(expectedResult).not.toContain('from "/src/plugins/db-table/db-table-component.ts"');
  expect(expectedResult).not.toContain('from "/src/plugins/scripting/scripting.ts"');
});

test('createLazyHvyBuiltInPluginsModuleSource skips lazy hooks when document does not use the plugin', () => {
  const expectedResult = createLazyHvyBuiltInPluginsModuleSource(['hvy.scripting']);

  expect(expectedResult).toContain('documentUsesPlugin(ctx.document, definition.id)');
  expect(expectedResult).toContain('await runHook(await loadPlugin(definition), \'documentLoad\', ctx)');
  expect(expectedResult).toContain('await runHook(await loadPlugin(definition), \'documentChange\', ctx)');
});

test('createLazyHvyBuiltInPluginsModuleSource exposes static PDF rendering only for capable plugins', () => {
  const expectedResult = createLazyHvyBuiltInPluginsModuleSource(['hvy.diagram', 'hvy.qr-code']);

  expect(expectedResult).toContain('"pdfStatic":true');
  expect(expectedResult).toContain('...(definition.pdfStatic ? { pdf: {');
  expect(expectedResult).toContain('plugin.pdf.renderStatic(ctx)');
});

test('lazy built-in plugin placeholders match real built-in plugin static metadata', () => {
  const realBuiltInPlugins: HvyPlugin[] = [
    dbTablePlugin,
    formPlugin,
    progressBarPlugin,
    scriptingPlugin,
    graphPlugin,
    diagramPlugin,
    qrCodePlugin,
    videoPlugin,
    editableTextPlugin,
    canvasPlugin,
    model3dPlugin,
    powerScriptingPlugin,
  ];
  const source = createLazyHvyBuiltInPluginsModuleSource(HVY_BUILT_IN_PLUGIN_IDS);
  const evaluateLazyModule = new Function(
    `${source.replaceAll('export const ', 'const ')}\nreturn { builtInPlugins };`
  ) as () => { builtInPlugins: HvyPlugin[] };
  const lazyBuiltInPlugins = evaluateLazyModule().builtInPlugins;

  const pickStaticMetadata = (plugin: HvyPlugin) => ({
    id: plugin.id,
    version: plugin.version,
    hvyApiVersion: plugin.hvyApiVersion,
    displayName: plugin.displayName,
    advancedComponent: plugin.advancedComponent === true,
    minimumEditorWidth: plugin.minimumEditorWidth,
    preferredEditorWidth: plugin.preferredEditorWidth,
    mount: plugin.mount,
    pdfStatic: typeof plugin.pdf?.renderStatic === 'function',
  });

  expect(lazyBuiltInPlugins.map(pickStaticMetadata)).toEqual(realBuiltInPlugins.map(pickStaticMetadata));
});

test('createBrythonMinimalVfsPlugin does not bundle regex dependency modules', async () => {
  const plugin = createBrythonMinimalVfsPlugin();
  const resolvedId = await (plugin.resolveId as (id: string) => string | null)('virtual:hvy-brython-minimal-vfs');
  const moduleSource = await (plugin.load as (id: string) => string | null)(resolvedId ?? '');
  const exportedSource = JSON.parse(String(moduleSource).replace(/^export default /, '').replace(/;$/, '')) as string;
  const vfsSource = exportedSource.match(/__BRYTHON__\.update_VFS\((.*)\);/)?.[1];
  const expectedResult = Object.keys(JSON.parse(vfsSource ?? '{}')).sort();

  expect(expectedResult).toEqual(['$timestamp', 'browser', 'sys']);
  expect(exportedSource).not.toContain('"re"');
  expect(exportedSource).not.toContain('"python_re"');
  expect(exportedSource).not.toContain('"enum"');
});

test('production build of Brython loader includes the minimal VFS module', async () => {
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    plugins: [
      createBrythonMinimalVfsPlugin(),
      {
        name: 'hvy-brython-loader-build-test-entry',
        resolveId(id) {
          return id === 'virtual:hvy-brython-loader-build-test-entry' ? id : null;
        },
        load(id) {
          if (id !== 'virtual:hvy-brython-loader-build-test-entry') {
            return null;
          }
          return 'import { loadBrython } from "/src/plugins/scripting/brython-loader.ts"; window.__hvyTestLoadBrython = loadBrython;';
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: 'virtual:hvy-brython-loader-build-test-entry',
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => (
    'output' in item ? item.output : []
  )) as Rollup.OutputBundle[string][];
  const chunkCodes = outputs
    .filter((item): item is Rollup.OutputChunk => item.type === 'chunk')
    .map((item) => item.code);
  const expectedResult = chunkCodes.find((code) => code.includes('__BRYTHON__.update_VFS({"$timestamp"')) ?? '';

  expect(chunkCodes.some((code) => code.includes('var __BRYTHON__=globalThis.__BRYTHON__'))).toBe(true);
  expect(expectedResult).toContain('__BRYTHON__.update_VFS({"$timestamp"');
  expect(expectedResult).toContain('"browser"');
  expect(expectedResult).toContain('"sys"');
  expect(expectedResult).not.toContain('"python_re"');
  expect(expectedResult).not.toContain('"enum"');
}, 15_000);
