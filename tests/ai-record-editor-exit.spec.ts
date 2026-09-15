import { expect, test } from '@playwright/test';

for (const exitLabel of ['Done', 'Cancel']) {
  test(`${exitLabel} after adding a resume job restores normal AI component clicks`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.goto('/');
    await page.locator('.document-menu').evaluate((menu: HTMLDetailsElement) => { menu.open = true; });
    await page.locator('.document-menu-panel').getByRole('button', { name: 'Resume Template', exact: true }).click();
    await page.getByRole('button', { name: 'AI', exact: true }).click();
    await page.locator('#aiReaderDocument [data-action="add-component-list-item"]', { hasText: 'Add Job' }).click();
    const dialog = page.locator('.modal-panel', { hasText: 'Add History Record' });
    await dialog.locator('[data-template-variable="organization"]').fill('Example Test Organization');
    await dialog.locator('[data-template-variable="role"]').fill('Example Test Role');
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
    await page.locator('#aiReaderDocument').getByText('Example Test Organization', { exact: true }).first().click();
    await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(0);
    await page.locator('#aiReaderDocument').getByText('Example Test Organization', { exact: true }).first().dblclick();
    await page.getByRole('button', { name: 'Edit component', exact: true }).click();

    const activeEditor = page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]');
    await expect(activeEditor).toHaveCount(1);
    await activeEditor.locator('> .editor-block-done-row').getByRole('button', { name: exitLabel, exact: true }).click();
    await expect(activeEditor).toHaveCount(0);
    await page.locator('#aiReaderDocument').getByText('Example Test Organization', { exact: true }).first().click();
    await expect(activeEditor).toHaveCount(0);
    await page.locator('#aiReaderDocument').getByText('Example Test Organization', { exact: true }).first().dblclick();
    await expect(page.getByRole('button', { name: 'Edit component', exact: true })).toBeVisible();
  });
}

test('Done on sidebar Location restores normal AI label clicks', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.locator('.document-menu').evaluate((menu: HTMLDetailsElement) => { menu.open = true; });
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Resume Template', exact: true }).click();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.locator('.viewer-sidebar-tab').click();
  await expect(page.locator('#aiSidebarSections')).toHaveCSS('opacity', '1');
  const location = page.locator('#aiSidebarSections #locations');
  await location.getByText('Location:', { exact: true }).dblclick();
  await page.getByRole('button', { name: 'Edit component', exact: true }).click();
  const editor = page.locator('#aiSidebarSections .editor-block[data-active-editor-block="true"]');
  await expect(editor).toHaveCount(1);
  await editor.locator('> .editor-block-done-row').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(editor).toHaveCount(0);
  await location.getByText('Location:', { exact: true }).click();
  await expect(editor).toHaveCount(0);
});

test('saved job Location matching its placeholder toggles the record instead of editing', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.locator('.document-menu').evaluate((menu: HTMLDetailsElement) => { menu.open = true; });
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Resume Template', exact: true }).click();
  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await page.locator('#aiReaderDocument [data-action="add-component-list-item"]', { hasText: 'Add Job' }).click();
  const dialog = page.locator('.modal-panel', { hasText: 'Add History Record' });
  await dialog.locator('[data-template-variable="organization"]').fill('Example Test Organization');
  await dialog.locator('[data-template-variable="role"]').fill('Example Test Role');
  await dialog.locator('[data-template-variable="location"]').fill('Location');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  const record = page.locator('#aiReaderDocument .reader-block[data-component="history-record"]');
  await record.getByText('Example Test Organization', { exact: true }).first().click();
  await record.getByText('Location', { exact: true }).click({ button: 'right' });
  await page.getByRole('button', { name: 'Edit component', exact: true }).click();
  await record.locator('.editor-block[data-active-editor-block="true"] > .editor-block-done-row').getByRole('button', { name: 'Done', exact: true }).click();
  await expect(record.locator('.editor-block[data-active-editor-block="true"]')).toHaveCount(0);
  await record.getByText('Location', { exact: true }).click();
  await expect(record.locator('.editor-block[data-active-editor-block="true"]')).toHaveCount(0);
  await expect(record.locator('.expandable-reader').first()).toHaveClass(/is-collapsed/);
});
