import { expect, test } from '@playwright/test';

test('browser lint reports Python syntax without executing the script', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { createHvyCliSession, executeHvyCliCommand } = await import(/* @vite-ignore */ '/src/cli-core/commands.ts');
    const { deserializeDocument, serializeDocument } = await import(/* @vite-ignore */ '/src/serialization.ts');

    // BEFORE: an isolated document; none of its scripts should run.
    const document = deserializeDocument(`---
hvy_version: 0.1
title: Unchanged
---
<!--hvy: {"id":"syntax-probe"}-->
#! Syntax probe

<!--hvy:plugin {"id":"broken","plugin":"hvy.scripting"}-->
value = 1
value = "unfinished

<!--hvy:plugin {"id":"control-flow","plugin":"hvy.power-scripting"}-->
break

<!--hvy:plugin {"id":"valid","plugin":"hvy.scripting"}-->
doc.header.set("title", "must not run")
raise Exception("must not run")
return "valid"
`, '.hvy');
    const before = serializeDocument(document);

    // TOOL CALL
    const lint = await executeHvyCliCommand(document, createHvyCliSession(), 'hvy lint');

    // AFTER: lint is read-only, and the shared runtime still runs normally.
    const unchanged = serializeDocument(document) === before;
    const { runUserScript } = await import(/* @vite-ignore */ '/src/plugins/scripting/wrapper.ts');
    const runtimeResult = await runUserScript({ document, source: 'return 42', renderOnMutation: false });
    return { output: lint.output, unchanged, runtimeResult };
  });

  expect(result.output).toContain('/broken/script.py: line 2, column 9: SyntaxError');
  expect(result.output).toContain("/control-flow/plugin.txt: line 1, column 1: SyntaxError: 'break' outside loop");
  expect(result.output).not.toContain('/valid/');
  expect(result.unchanged).toBe(true);
  expect(result.runtimeResult.ok).toBe(true);
  expect(result.runtimeResult.returnValue).toBe(42);
});

test('cached script definitions are reused until their source changes', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { runUserScript } = await import(/* @vite-ignore */ '/src/plugins/scripting/wrapper.ts');
    const { deserializeDocument } = await import(/* @vite-ignore */ '/src/serialization.ts');
    const document = deserializeDocument(`---\nhvy_version: 0.1\n---\n`, '.hvy');
    const first = await runUserScript({
      document,
      source: 'return 1',
      componentId: 'cached-visibility-script',
      renderOnMutation: false,
      cacheDefinition: true,
    });
    const scripting = (window as Window & {
      __HVY_SCRIPTING__?: {
        compiledDefinitionSources: Map<string, string>;
        compiledDefinitions: Map<string, unknown>;
        compiledPrograms: Map<string, { execute: () => unknown }>;
      };
    }).__HVY_SCRIPTING__;
    const afterFirst = {
      sourceCount: scripting?.compiledDefinitionSources.size,
      definitionCount: scripting?.compiledDefinitions.size,
      definition: scripting?.compiledDefinitions.get('cached-visibility-script'),
      program: scripting?.compiledPrograms.get('cached-visibility-script'),
    };
    const second = await runUserScript({
      document,
      source: 'return 1',
      componentId: 'cached-visibility-script',
      renderOnMutation: false,
      cacheDefinition: true,
    });
    const afterSecond = {
      sourceCount: scripting?.compiledDefinitionSources.size,
      definitionCount: scripting?.compiledDefinitions.size,
      definitionReused: scripting?.compiledDefinitions.get('cached-visibility-script') === afterFirst.definition,
      programReused: scripting?.compiledPrograms.get('cached-visibility-script') === afterFirst.program,
    };
    const changed = await runUserScript({
      document,
      source: 'return 2',
      componentId: 'cached-visibility-script',
      renderOnMutation: false,
      cacheDefinition: true,
    });
    return {
      first: first.returnValue,
      second: second.returnValue,
      changed: changed.returnValue,
      afterFirst: { sourceCount: afterFirst.sourceCount, definitionCount: afterFirst.definitionCount },
      afterSecond,
      afterChange: {
        sourceCount: scripting?.compiledDefinitionSources.size,
        definitionCount: scripting?.compiledDefinitions.size,
        definitionReplaced: scripting?.compiledDefinitions.get('cached-visibility-script') !== afterFirst.definition,
        programReused: scripting?.compiledPrograms.get('cached-visibility-script') === afterFirst.program,
      },
    };
  });

  expect(result).toEqual({
    first: 1,
    second: 1,
    changed: 2,
    afterFirst: { sourceCount: 1, definitionCount: 1 },
    afterSecond: { sourceCount: 1, definitionCount: 1, definitionReused: true, programReused: true },
    afterChange: { sourceCount: 1, definitionCount: 1, definitionReplaced: true, programReused: true },
  });
});
