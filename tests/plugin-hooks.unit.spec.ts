import { beforeEach, expect, test } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { initState, state } from '../src/state';
import { resetPluginDocumentHookState, runPluginDocumentHooks } from '../src/plugins/hooks';
import { setHostPlugins } from '../src/plugins/registry';
import type { HvyPlugin } from '../src/plugins/types';
import type { AppState } from '../src/types';

function createHookPlugin(id: string, hooks: NonNullable<HvyPlugin['hooks']>): HvyPlugin {
  return {
    id,
    displayName: id,
    create: () => ({ element: document.createElement('div') }),
    hooks,
  };
}

function bootstrap(hvy = '---\nhvy_version: 1.0\n---\n\n#! First\n\nText\n'): void {
  initState({ document: deserializeDocument(hvy, '.hvy') } as unknown as AppState);
}

beforeEach(() => {
  setHostPlugins([]);
  resetPluginDocumentHookState();
});

test('document hooks run higher priority first with stable tie ordering', async () => {
  const expectedResult: string[] = [];
  setHostPlugins([
    createHookPlugin('first-plugin', {
      documentLoad: [
        { priority: 10, run: () => { expectedResult.push('first high'); } },
        { priority: 0, run: () => { expectedResult.push('first default'); } },
      ],
    }),
    createHookPlugin('second-plugin', {
      documentLoad: [
        { priority: 10, run: () => { expectedResult.push('second high'); } },
        { priority: 0, run: () => { expectedResult.push('second default'); } },
      ],
    }),
  ]);
  bootstrap();

  await runPluginDocumentHooks('load');

  expect(expectedResult).toEqual(['first high', 'second high', 'first default', 'second default']);
});

test('documentLoad runs for new document identity and documentChange runs for same-document edits', async () => {
  const expectedResult: string[] = [];
  setHostPlugins([
    createHookPlugin('lifecycle-plugin', {
      documentLoad: { run: (ctx) => { expectedResult.push(`load:${ctx.changeReason}`); } },
      documentChange: { run: (ctx) => { expectedResult.push(`change:${ctx.changeReason}`); } },
    }),
  ]);
  bootstrap();

  await runPluginDocumentHooks('load');
  await runPluginDocumentHooks('unknown');
  expectedResult.push('before edit');
  const section = state.document.sections[0];
  if (!section) throw new Error('Expected section');
  section.title = 'Changed';
  await runPluginDocumentHooks('edit');
  bootstrap('---\nhvy_version: 1.0\n---\n\n#! Second\n\nText\n');
  await runPluginDocumentHooks('load');

  expect(expectedResult).toEqual(['load:load', 'before edit', 'change:edit', 'load:load']);
});
