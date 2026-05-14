import { expect, test } from 'vitest';

import { createHvyBuiltInPluginsModuleSource, HVY_BUILT_IN_PLUGIN_IDS, resolveBuiltInPluginIds } from '../vite.config';

test('resolveBuiltInPluginIds defaults to every built-in plugin', () => {
  expect(resolveBuiltInPluginIds(undefined)).toEqual([...HVY_BUILT_IN_PLUGIN_IDS]);
});

test('resolveBuiltInPluginIds accepts an explicit plugin list', () => {
  const expectedResult = resolveBuiltInPluginIds({
    plugins: ['dev.hvy.form', 'dev.hvy.progress-bar'],
  });

  expect(expectedResult).toEqual(['dev.hvy.form', 'dev.hvy.progress-bar']);
});

test('resolveBuiltInPluginIds supports include and exclude config', () => {
  const expectedResult = resolveBuiltInPluginIds({
    plugins: ['dev.hvy.db-table', 'dev.hvy.form', 'dev.hvy.scripting'],
    exclude: ['dev.hvy.form'],
    include: ['dev.hvy.progress-bar'],
  });

  expect(expectedResult).toEqual(['dev.hvy.db-table', 'dev.hvy.scripting', 'dev.hvy.progress-bar']);
});

test('resolveBuiltInPluginIds lets HVY_BUILD_PLUGINS override file config', () => {
  const expectedResult = resolveBuiltInPluginIds(
    { plugins: ['dev.hvy.db-table'] },
    'dev.hvy.form, dev.hvy.scripting'
  );

  expect(expectedResult).toEqual(['dev.hvy.form', 'dev.hvy.scripting']);
});

test('resolveBuiltInPluginIds rejects unknown plugin ids', () => {
  expect(() =>
    resolveBuiltInPluginIds({
      plugins: ['dev.hvy.form', 'dev.hvy.unknown'],
    })
  ).toThrow('Unknown HVY built-in plugin id');
});

test('createHvyBuiltInPluginsModuleSource uses Vite web-root imports', () => {
  const expectedResult = createHvyBuiltInPluginsModuleSource(['dev.hvy.db-table', 'dev.hvy.scripting']);

  expect(expectedResult).toContain('from "/src/plugins/db-table-plugin.ts"');
  expect(expectedResult).toContain('from "/src/plugins/scripting/scripting.ts"');
  expect(expectedResult).not.toContain('/Users/');
  expect(expectedResult).not.toContain(process.cwd());
});
