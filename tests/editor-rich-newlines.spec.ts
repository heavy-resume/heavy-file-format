import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test('expected result: new lines in an empty embedded text editor keep uniform paragraph spacing', async ({ page }) => {
  await page.goto('/examples/lightweight-viewer-text-editor.html');

  const editor = page.locator(
    '#lightweightViewerOnlyMount .hvy-editable-text-reader [data-field="hvy-plugin-text-editor"]'
  ).first();
  await expect(editor).toBeVisible();
  await editor.click();

  await page.keyboard.type('Candlewood Ridge remainder:');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Survey 1 - 50');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Survey 2 - 30');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Survey 3 - 30');

  const expectedResult = await editor.evaluate((node) => {
    const blocks = Array.from(node.children);
    const tops = blocks.map((block) => block.getBoundingClientRect().top);
    return {
      tags: blocks.map((block) => block.tagName),
      lineOffsets: tops.slice(1).map((top, index) => Number((top - tops[index]!).toFixed(2))),
    };
  });

  expect(expectedResult.tags).toEqual(['P', 'P', 'P', 'P']);
  expect(new Set(expectedResult.lineOffsets).size).toBe(1);
});
