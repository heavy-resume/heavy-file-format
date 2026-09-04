import { expect, test } from '@playwright/test';

test('expected result: reference app publishes and runs document WebMCP tools', async ({ page }) => {
  await page.goto('/');
  await page.locator('#editorTree').waitFor();

  const expectedResult = await page.evaluate(async () => {
    const context = (document as Document & {
      modelContext?: {
        getTools(): Promise<Array<{ name: string }>>;
        executeTool(tool: { name: string }, input: string): Promise<string>;
      };
    }).modelContext;
    if (!context) return { available: false, names: [], walk: '', patch: '' };
    const tools = await context.getTools();
    const walkTool = tools.find((tool) => tool.name === 'walk_hvy_document');
    const patchTool = tools.find((tool) => tool.name === 'apply_hvy_patch');
    if (!walkTool || !patchTool) {
      return { available: true, names: tools.map((tool) => tool.name), walk: '', patch: '' };
    }
    const walk = await context.executeTool(walkTool, JSON.stringify({ limit: 1 }));
    const patch = await context.executeTool(patchTool, JSON.stringify({
      patch: `*** Begin Patch
*** Update File: /body/overview/text-0/text.txt
@@
-This default HVY document is a lightweight workspace for tracking a job search. It mixes narrative sections with a SQLite-backed plugin block whose rows are expected to come from the attached database.
+This default HVY document is a lightweight WebMCP workspace for tracking a job search. It mixes narrative sections with a SQLite-backed plugin block whose rows are expected to come from the attached database.
*** End Patch`,
    }));
    return { available: true, names: tools.map((tool) => tool.name), walk, patch };
  });

  expect(expectedResult.available).toBe(true);
  expect(expectedResult.names.sort()).toEqual([
    'apply_hvy_patch',
    'run_hvy_cli',
    'search_hvy_document',
    'walk_hvy_document',
  ]);
  expect(expectedResult.walk).toContain('lightweight workspace for tracking a job search');
  expect(expectedResult.patch).toContain('"appliedFileCount":1');
  await expect(page.locator('#editorTree')).toContainText('lightweight WebMCP workspace');
});
