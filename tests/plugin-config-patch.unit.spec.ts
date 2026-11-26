import { expect, test } from 'vitest';

import { mergePluginConfigPatch } from '../src/plugins/mount';

test('a config patch overrides set keys and removes keys patched to undefined', () => {
  const before = { title: 'Fake title', yAxisMin: 0, yAxisMax: 40 };

  const after = mergePluginConfigPatch(before, { title: 'Fake renamed', yAxisMax: undefined });

  expect(after).toEqual({ title: 'Fake renamed', yAxisMin: 0 });
  expect(before).toEqual({ title: 'Fake title', yAxisMin: 0, yAxisMax: 40 });
});
