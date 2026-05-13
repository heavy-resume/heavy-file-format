import { expect, test } from 'vitest';

import { HVY_BUILT_IN_PLUGIN_IDS, resolveBuiltInPluginIds } from '../vite.config';

test('resolveBuiltInPluginIds defaults to every built-in plugin', () => {
  expect(resolveBuiltInPluginIds(undefined)).toEqual([...HVY_BUILT_IN_PLUGIN_IDS]);
});

test('resolveBuiltInPluginIds accepts an explicit plugin list', () => {
  const expectedResult = resolveBuiltInPluginIds({
    plugins: ['dev.heavy.form', 'dev.heavy.progress-bar'],
  });

  expect(expectedResult).toEqual(['dev.heavy.form', 'dev.heavy.progress-bar']);
});

test('resolveBuiltInPluginIds supports include and exclude config', () => {
  const expectedResult = resolveBuiltInPluginIds({
    plugins: ['dev.heavy.db-table', 'dev.heavy.form', 'dev.heavy.scripting'],
    exclude: ['dev.heavy.form'],
    include: ['dev.heavy.progress-bar'],
  });

  expect(expectedResult).toEqual(['dev.heavy.db-table', 'dev.heavy.scripting', 'dev.heavy.progress-bar']);
});

test('resolveBuiltInPluginIds lets HVY_BUILD_PLUGINS override file config', () => {
  const expectedResult = resolveBuiltInPluginIds(
    { plugins: ['dev.heavy.db-table'] },
    'dev.heavy.form, dev.heavy.scripting'
  );

  expect(expectedResult).toEqual(['dev.heavy.form', 'dev.heavy.scripting']);
});

test('resolveBuiltInPluginIds rejects unknown plugin ids', () => {
  expect(() =>
    resolveBuiltInPluginIds({
      plugins: ['dev.heavy.form', 'dev.heavy.unknown'],
    })
  ).toThrow('Unknown HVY built-in plugin id');
});
