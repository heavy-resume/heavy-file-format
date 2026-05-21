import { expect, test } from 'vitest';

import { createHvyBuiltInPluginsModuleSource, createLazyHvyBuiltInPluginsModuleSource, HVY_BUILT_IN_PLUGIN_IDS, resolveBuiltInPluginIds } from '../vite.config';

test('resolveBuiltInPluginIds defaults to every built-in plugin', () => {
  expect(resolveBuiltInPluginIds(undefined)).toEqual([...HVY_BUILT_IN_PLUGIN_IDS]);
  expect(HVY_BUILT_IN_PLUGIN_IDS).toContain('hvy.diagram');
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
  const expectedResult = createHvyBuiltInPluginsModuleSource(['hvy.db-table', 'hvy.scripting', 'hvy.graph', 'hvy.diagram']);

  expect(expectedResult).toContain('from "/src/plugins/db-table-plugin.ts"');
  expect(expectedResult).toContain('from "/src/plugins/scripting/scripting.ts"');
  expect(expectedResult).toContain('from "/src/plugins/graph.ts"');
  expect(expectedResult).toContain('from "/src/plugins/diagram.ts"');
  expect(expectedResult).not.toContain('/Users/');
  expect(expectedResult).not.toContain(process.cwd());
});

test('createLazyHvyBuiltInPluginsModuleSource defers built-in plugin implementations', () => {
  const expectedResult = createLazyHvyBuiltInPluginsModuleSource(['hvy.db-table', 'hvy.scripting']);

  expect(expectedResult).toContain('() => import("/src/plugins/db-table-plugin.ts")');
  expect(expectedResult).toContain('() => import("/src/plugins/scripting/scripting.ts")');
  expect(expectedResult).not.toContain('"importPath":"/src/plugins/db-table-plugin.ts"');
  expect(expectedResult).not.toContain('"importPath":"/src/plugins/scripting/scripting.ts"');
  expect(expectedResult).not.toContain('from "/src/plugins/db-table-plugin.ts"');
  expect(expectedResult).not.toContain('from "/src/plugins/scripting/scripting.ts"');
});

test('createLazyHvyBuiltInPluginsModuleSource skips lazy hooks when document does not use the plugin', () => {
  const expectedResult = createLazyHvyBuiltInPluginsModuleSource(['hvy.scripting']);

  expect(expectedResult).toContain('documentUsesPlugin(ctx.document, definition.id)');
  expect(expectedResult).toContain('await runHook(await loadPlugin(definition), \'documentLoad\', ctx)');
  expect(expectedResult).toContain('await runHook(await loadPlugin(definition), \'documentChange\', ctx)');
});
