import { expect, test, type Page } from '@playwright/test';

async function openFirstDbTableEditor(page: Page): Promise<void> {
  await page.locator('.editor-block-passive', { hasText: 'DB table error: table or view' }).first().click();
}

test('db table editor deletes columns with confirmation', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'CRM Example' }).click();
  await openFirstDbTableEditor(page);
  await page.getByRole('button', { name: 'Create Table' }).click();

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

test('db table editor explicitly creates a missing table', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'CRM Example' }).click();
  await openFirstDbTableEditor(page);

  const tableInput = page.locator('[data-field="block-plugin-db-table"]').first();
  await expect(tableInput).toBeVisible();
  await tableInput.fill('playwright_missing_table');

  await expect(page.getByText('Table or view "playwright_missing_table" does not exist.')).toBeVisible();
  await page.getByRole('button', { name: 'Create Table' }).click();

  await expect(page.getByRole('button', { name: 'Create Table' })).toBeHidden();
  await expect(page.locator('[data-field="sqlite-column-name"]').first()).toHaveValue('Column 1');
});
