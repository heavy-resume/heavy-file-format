import { expect, test } from '@playwright/test';

test('adding a section keeps the editor surface mounted and reveals the new section', async ({ page }) => {
  await page.goto('/');
  await page.locator('.document-menu').evaluate((menu) => {
    if (menu instanceof HTMLDetailsElement) menu.open = true;
  });
  const loaded = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/sepa-recreation-document');
  await page.locator('.document-menu-panel').getByRole('button', { name: 'SEPA Recreation', exact: true }).click({ force: true });
  await loaded;
  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();

  const editorTree = page.locator('#editorTree');
  const addSection = editorTree.locator('[data-action="add-top-level-section"][data-section-location="main"]');
  await addSection.scrollIntoViewIfNeeded();
  await editorTree.evaluate((element) => { element.dataset.expectedResult = 'same-editor-tree'; });

  await addSection.click();

  const expectedResult = page.locator('#editorTree[data-expected-result="same-editor-tree"]');
  await expect(expectedResult).toHaveCount(1);
  const title = expectedResult.locator('.editor-section-card:not(.editor-subsection-card)').last().locator('[data-field="section-title"]');
  await expect(title).toBeFocused();
  await expect.poll(async () => title.evaluate((input) => {
    const inputRect = input.getBoundingClientRect();
    const treeRect = input.closest('#editorTree')?.getBoundingClientRect();
    return Boolean(treeRect && inputRect.top >= treeRect.top && inputRect.bottom <= treeRect.bottom);
  })).toBe(true);
});
