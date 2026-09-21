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
