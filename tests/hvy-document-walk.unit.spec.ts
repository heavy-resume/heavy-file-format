import { afterEach, expect, test, vi } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { walkHvyDocument } from '../src/search/hvy-document-walk';
import { builtInSearchProvider } from '../src/search/search-provider';
import { registerHostPlugin, setHostPlugins } from '../src/plugins/registry';
import { createHvyCliSession, executeHvyCliCommand } from '../src/cli-core/commands';

afterEach(() => {
  setHostPlugins([]);
});

test('walkHvyDocument traverses visible leaf content in document order without search filtering', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"first-note"}-->
 First visible note.

<!--hvy: {"id":"beta"}-->
#! Beta

<!--hvy:text {"id":"second-note"}-->
 Second visible note.
`, '.hvy');

  // BEFORE
  const firstBatch = walkHvyDocument({ document, limit: 1 });

  // TOOL CALL
  const secondBatch = walkHvyDocument({
    document,
    limit: 1,
    cursor: firstBatch.nextCursor,
  });

  // AFTER
  expect(firstBatch).toEqual(expect.objectContaining({
    reviewedThrough: 1,
    totalItems: 2,
    nextCursor: 'hvy-walk:1',
  }));
  expect(firstBatch.items[0]).toEqual(expect.objectContaining({
    path: '/body/alpha/first-note',
    type: 'text',
    content: expect.stringContaining('First visible note.'),
  }));
  expect(secondBatch).toEqual(expect.objectContaining({
    reviewedThrough: 2,
    totalItems: 2,
  }));
  expect(secondBatch).not.toHaveProperty('nextCursor');
  expect(secondBatch.items[0]).toEqual(expect.objectContaining({
    path: '/body/beta/second-note',
    content: expect.stringContaining('Second visible note.'),
  }));
});

test('walkHvyDocument rejects malformed and out-of-range cursors', () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"alpha"}-->
#! Alpha

<!--hvy:text {"id":"note"}-->
 Visible note.
`, '.hvy');

  expect(() => walkHvyDocument({ document, cursor: 'not-a-cursor' })).toThrow('Invalid HVY walk cursor.');
  expect(() => walkHvyDocument({ document, cursor: 'hvy-walk:99' })).toThrow('beyond the end');
});

test('plugin visual descriptions feed search and CLI display without posing as document text', async () => {
  const document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"dashboard"}-->
#! Dashboard

<!--hvy:plugin {"id":"status-chart","plugin":"example.status-chart","pluginConfig":{"state":"healthy"}}-->
`, '.hvy');
  const describe = vi.fn(({ block, rawDocument }) =>
    `A green health chart for ${String(block.schema.pluginConfig.state)} in ${rawDocument.sections[0]?.title}.`
  );
  registerHostPlugin({
    id: 'example.status-chart',
    displayName: 'Status Chart',
    visualDescription: { describe },
  });

  // BEFORE
  const searchResult = await builtInSearchProvider({
    document,
    query: 'green health chart',
    caseSensitive: false,
    categories: ['contents'],
  });

  // TOOL CALL
  const cliDisplay = walkHvyDocument({ document });
  const cliSession = createHvyCliSession();
  const virtualFile = await executeHvyCliCommand(
    document,
    cliSession,
    'cat /body/dashboard/status-chart/plugin.visual-description.txt'
  );
  const preview = await executeHvyCliCommand(
    document,
    cliSession,
    'hvy preview /body/dashboard/status-chart'
  );
  const cliSearch = await executeHvyCliCommand(
    document,
    cliSession,
    'hvy search "green health chart"'
  );

  // AFTER
  expect(searchResult).toHaveLength(1);
  expect(searchResult[0]).toEqual(expect.objectContaining({
    sourceField: 'Visual description',
    targetPath: '/body/dashboard/status-chart',
  }));
  expect(cliDisplay.items[0]?.content).toContain(
    '--- begin plugin visual description (rendered output; not serialized document text) ---'
  );
  expect(cliDisplay.items[0]?.content).toContain('A green health chart for healthy in Dashboard.');
  expect(cliDisplay.items[0]?.content).toContain('--- end plugin visual description ---');
  expect(virtualFile.output).toContain('A green health chart for healthy in Dashboard.');
  expect(preview.output).toContain('Component preview (raw HVY');
  expect(preview.output).toContain(
    '--- begin plugin visual description (rendered output; not serialized document text) ---'
  );
  expect(cliSearch.output).toContain('/body/dashboard/status-chart');
  expect(cliSearch.output).toContain(
    'visual description (derived rendered output): A green health chart for healthy in Dashboard.'
  );
  expect(describe).toHaveBeenCalledWith({ block: expect.any(Object), rawDocument: document });
});
