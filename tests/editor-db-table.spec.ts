import { expect, test, type Page } from '@playwright/test';

async function openCrmExample(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.document-menu').evaluate((menu) => {
    if (menu instanceof HTMLDetailsElement) menu.open = true;
  });
  await page.locator('.document-menu-panel').getByRole('button', { name: 'CRM Example', exact: true }).click();
}

async function openFirstDbTableEditor(page: Page): Promise<void> {
  await page
    .locator('.editor-block-passive', { hasText: 'Table or view "job_applications" does not exist.' })
    .first()
    .click();
}

function columnNames(page: Page): Promise<string[]> {
  return page.locator('.db-table-column-name-input').evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).value)
  );
}

test('db table editor creates a missing table from the configured name', async ({ page }) => {
  await openCrmExample(page);
  await openFirstDbTableEditor(page);

  await expect(page.locator('[data-db-table-field="table"]').first()).toHaveValue('job_applications');
  await expect(page.getByText('Table or view "job_applications" does not exist.')).toBeVisible();

  await page.getByRole('button', { name: 'Create Basic Table' }).click();

  await expect(page.getByText('Table or view "job_applications" does not exist.')).toHaveCount(0);
  await expect(page.locator('.db-table-column-name-input')).toHaveCount(2);
  expect(await columnNames(page)).toEqual(['Column 1', 'Column 2']);
});

test('db table editor deletes columns with confirmation', async ({ page }) => {
  await openCrmExample(page);
  await openFirstDbTableEditor(page);
  await page.getByRole('button', { name: 'Create Basic Table' }).click();
  await expect(page.locator('.db-table-column-name-input')).toHaveCount(2);

  // Column deletion lives in the Columns settings panel.
  await page.getByRole('button', { name: 'Columns' }).first().click();
  const deleteButtons = page.locator('[data-db-table-action="delete-column"]');
  await expect(deleteButtons.first()).toBeVisible();
  const dialog = page.locator('.remove-confirmation-modal');

  // Cancelling leaves the schema untouched.
  await deleteButtons.first().click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  expect(await columnNames(page)).toEqual(['Column 1', 'Column 2']);

  await deleteButtons.first().click();
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(page.locator('.db-table-column-name-input')).toHaveCount(1);
  expect(await columnNames(page)).toEqual(['Column 2']);
});
