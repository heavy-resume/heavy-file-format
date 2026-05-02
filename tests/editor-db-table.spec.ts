import { expect, test } from '@playwright/test';

test('db table editor deletes columns with confirmation', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'CRM Example' }).click();
  await page.locator('.editor-block-passive', { has: page.locator('.db-table-frame') }).first().click();

  const columnInputs = page.locator('[data-field="sqlite-column-name"]');
  await expect(columnInputs.first()).toBeVisible();
  const initialColumnCount = await columnInputs.count();
  expect(initialColumnCount).toBeGreaterThan(1);

  const deleteButtons = page.locator('[data-action="sqlite-drop-column"]');
  await expect(deleteButtons.first()).toBeVisible();
  await deleteButtons.first().click();
  await expect(page.getByRole('dialog', { name: 'Confirm deletion?' })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(columnInputs).toHaveCount(initialColumnCount);

  await deleteButtons.first().click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(columnInputs).toHaveCount(initialColumnCount - 1);
});
