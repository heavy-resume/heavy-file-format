import { expect, test, vi } from 'vitest';

import { deserializeDocument } from '../src/serialization';
import { scriptingPlugin } from '../src/plugins/scripting/scripting';
import { runUserScript } from '../src/plugins/scripting/wrapper';
import type { HvyDocumentHookContext, HvyPluginHookHandler } from '../src/plugins/types';

vi.mock('../src/plugins/scripting/wrapper', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/plugins/scripting/wrapper')>();
  return {
    ...original,
    runUserScript: vi.fn(async () => ({
      ok: true,
      stepsExecuted: 1,
      stepBudget: 100_000,
      linesExecuted: 1,
      toolCalls: 0,
    })),
  };
});

function createScriptingDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"scripts"}-->
#! Scripts

<!--hvy:plugin {"id":"editor-script","editorOnly":true,"plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
print("editor")

<!--hvy:plugin {"id":"document-script","plugin":"hvy.scripting","pluginConfig":{"version":"0.1"}}-->
print("document")
`, '.hvy');
}

function getScriptingLoadHook(): HvyPluginHookHandler {
  const hook = scriptingPlugin.hooks?.documentLoad;
  if (!hook || Array.isArray(hook)) {
    throw new Error('Expected scripting documentLoad hook');
  }
  return hook;
}

test('scripting document hook runs editor-only scripts in editor view', async () => {
  const document = createScriptingDocument();
  const runUserScriptMock = vi.mocked(runUserScript);
  runUserScriptMock.mockClear();

  await getScriptingLoadHook().run({
    document,
    view: 'editor',
    changeReason: 'load',
    refreshPlugins: vi.fn(),
    requestRerender: vi.fn(),
    isCurrentDocument: () => true,
  } satisfies HvyDocumentHookContext);

  expect(runUserScriptMock).toHaveBeenCalledTimes(1);
  expect(runUserScriptMock.mock.calls[0]?.[0].source).toContain('print("editor")');
  expect(runUserScriptMock.mock.calls[0]?.[0].changeReason).toBe('load');
});

test('scripting document hook runs editor-only scripts in AI view', async () => {
  const document = createScriptingDocument();
  const runUserScriptMock = vi.mocked(runUserScript);
  runUserScriptMock.mockClear();

  await getScriptingLoadHook().run({
    document,
    view: 'ai',
    changeReason: 'load',
    refreshPlugins: vi.fn(),
    requestRerender: vi.fn(),
    isCurrentDocument: () => true,
  } satisfies HvyDocumentHookContext);

  expect(runUserScriptMock).toHaveBeenCalledTimes(1);
  expect(runUserScriptMock.mock.calls[0]?.[0].source).toContain('print("editor")');
});

test('scripting document hook skips editor-only scripts in viewer view', async () => {
  const document = createScriptingDocument();
  const runUserScriptMock = vi.mocked(runUserScript);
  runUserScriptMock.mockClear();

  await getScriptingLoadHook().run({
    document,
    view: 'viewer',
    changeReason: 'load',
    refreshPlugins: vi.fn(),
    requestRerender: vi.fn(),
    isCurrentDocument: () => true,
  } satisfies HvyDocumentHookContext);

  expect(runUserScriptMock).toHaveBeenCalledTimes(1);
  expect(runUserScriptMock.mock.calls[0]?.[0].source).toContain('print("document")');
});
