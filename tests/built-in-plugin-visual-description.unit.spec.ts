import { afterEach, expect, test } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { dbTablePlugin } from '../src/plugins/db-table/db-table-component';
import {
  clearScriptingResults,
  scriptingPlugin,
  storeScriptingResult,
} from '../src/plugins/scripting/scripting';
import { formPlugin } from '../src/plugins/form';
import { progressBarPlugin } from '../src/plugins/progress-bar';
import { graphPlugin } from '../src/plugins/graph';
import { diagramPlugin } from '../src/plugins/diagram';
import { qrCodePlugin } from '../src/plugins/qr-code/qr-code';
import { videoPlugin } from '../src/plugins/video/video';
import { editableTextPlugin } from '../src/plugins/editable-text/editable-text';

afterEach(() => {
  clearScriptingResults();
});

function createPluginDocument(plugin: string, text = '') {
  return deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"runtime"}-->
#! Runtime

<!--hvy:plugin {"id":"runtime-output","plugin":"${plugin}"}-->
${text}
`, '.hvy');
}

test('DB table visual description starts empty before its first data snapshot', () => {
  const document = createPluginDocument('hvy.db-table');
  const block = document.sections[0]!.blocks[0]!;
  const describe = dbTablePlugin.visualDescription!.describe;

  // BEFORE
  expect(describe({ block, rawDocument: document })).toBe('');

  expect(dbTablePlugin).toMatchObject({ id: 'hvy.db-table', version: '0.2.0' });
});

test('scripting visual description exposes only failed runtime output', () => {
  const document = createPluginDocument('hvy.scripting', 'raise Exception("broken")');
  const block = document.sections[0]!.blocks[0]!;
  const describe = scriptingPlugin.visualDescription!.describe;

  // BEFORE
  expect(describe({ block, rawDocument: document })).toBe('');

  // TOOL CALL
  storeScriptingResult(document.sections[0]!.key, block.id, {
    ok: false,
    error: 'broken',
    errorDetail: 'Exception: broken at line 1',
    stepsExecuted: 1,
    stepBudget: 100_000,
    toolCalls: 0,
    logs: ['starting'],
  }, block.text);

  // AFTER
  expect(describe({ block, rawDocument: document })).toBe([
    'Script error: broken',
    'Logs:',
    '1: starting',
    'Details: Exception: broken at line 1',
  ].join('\n'));

  storeScriptingResult(document.sections[0]!.key, block.id, {
    ok: true,
    stepsExecuted: 1,
    stepBudget: 100_000,
    toolCalls: 0,
    logs: ['complete'],
  }, block.text);
  expect(describe({ block, rawDocument: document })).toBe('');
});

test('built-ins backed by plugin text and config do not add visual descriptions', () => {
  expect([
    formPlugin,
    progressBarPlugin,
    graphPlugin,
    diagramPlugin,
    qrCodePlugin,
    videoPlugin,
    editableTextPlugin,
  ].every((plugin) => plugin.visualDescription === undefined)).toBe(true);
});
