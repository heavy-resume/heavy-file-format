import { expect, test, vi } from 'vitest';

import {
  createHvyWebMcpDocumentTools,
  registerHvyWebMcpTools,
  type HvyWebMcpModelContext,
  type HvyWebMcpTool,
} from '../src/webmcp';
import { deserializeDocument, serializeDocument } from '../src/serialization';

function testDocument() {
  return deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

<!--hvy:text {"id":"delivery"}-->
Moves software quickly.
`, '.hvy');
}

test('expected result: default WebMCP tools only operate on the mounted document', async () => {
  const document = testDocument();
  const beforeMutation = vi.fn();
  const onMutation = vi.fn();
  const tools = createHvyWebMcpDocumentTools({ getDocument: () => document, beforeMutation, onMutation });

  expect(tools.map((tool) => tool.name)).toEqual([
    'run_hvy_cli',
    'search_hvy_document',
    'walk_hvy_document',
    'apply_hvy_patch',
  ]);
  expect(tools.some((tool) => 'path' in ((tool.inputSchema?.properties ?? {}) as object))).toBe(false);

  const patchTool = tools.find((tool) => tool.name === 'apply_hvy_patch')!;
  const result = await patchTool.execute({
    patch: `*** Begin Patch
*** Update File: /body/summary/delivery/text.txt
@@
-Moves software quickly.
+Moves software reliably.
*** End Patch`,
  });

  expect(result).toMatchObject({ appliedFileCount: 1, failedFileCount: 0 });
  expect(serializeDocument(document)).toContain('Moves software reliably.');
  expect(beforeMutation).toHaveBeenCalledOnce();
  expect(onMutation).toHaveBeenCalledOnce();
});

test('expected result: host callback can extend or replace default WebMCP behavior', async () => {
  const registered: HvyWebMcpTool[] = [];
  let registrationSignal: AbortSignal | undefined;
  const modelContext: HvyWebMcpModelContext = {
    registerTool: vi.fn((tool, options) => {
      registered.push(tool);
      registrationSignal = options?.signal;
    }),
  };
  const custom: HvyWebMcpTool = {
    name: 'host_review_document',
    description: 'Use the host review flow.',
    execute: () => ({ reviewed: true }),
  };
  const registration = registerHvyWebMcpTools({
    modelContext,
    tools: (defaults) => [
      ...defaults.filter((tool) => tool.name !== 'apply_hvy_patch'),
      custom,
    ],
  }, { getDocument: testDocument });

  expect(registration.registered).toBe(true);
  expect(registered.map((tool) => tool.name)).toEqual([
    'run_hvy_cli',
    'search_hvy_document',
    'walk_hvy_document',
    'host_review_document',
  ]);
  expect(await registered.at(-1)!.execute({})).toEqual({ reviewed: true });
  expect(registrationSignal?.aborted).toBe(false);

  registration.destroy();
  expect(registrationSignal?.aborted).toBe(true);

  const replacement = registerHvyWebMcpTools({ modelContext, tools: [custom] }, { getDocument: testDocument });
  expect(replacement.tools.map((tool) => tool.name)).toEqual(['host_review_document']);
  replacement.destroy();
});

test('expected result: WebMCP quietly remains unavailable without a model context', () => {
  const registration = registerHvyWebMcpTools({ modelContext: null }, { getDocument: testDocument });
  expect(registration.registered).toBe(false);
  expect(registration.tools).toHaveLength(4);
});

test('expected result: WebMCP follows the host when its active document changes', async () => {
  let document = testDocument();
  const tools = createHvyWebMcpDocumentTools({ getDocument: () => document });
  const walk = tools.find((tool) => tool.name === 'walk_hvy_document')!;

  expect(JSON.stringify(await walk.execute({}))).toContain('Moves software quickly.');

  document = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"replacement"}-->
#! Replacement

<!--hvy:text {"id":"note"}-->
The active document changed.
`, '.hvy');

  expect(JSON.stringify(await walk.execute({}))).toContain('The active document changed.');
});
