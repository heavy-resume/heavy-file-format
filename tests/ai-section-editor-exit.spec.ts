import { expect, test } from '@playwright/test';

for (const flavor of ['linear', 'tableform']) {
  for (const exitLabel of ['Done', 'Cancel']) {
    for (const addBeforeExit of [true, false]) {
      test(`${exitLabel} restores the ${flavor} publication section with a record added ${addBeforeExit ? 'before' : 'after'} exit`, async ({ page }) => {
        test.setTimeout(5_000);
        await page.goto('/');
        await page.locator('.document-menu').evaluate((menu: HTMLDetailsElement) => { menu.open = true; });
        await page.locator('.document-menu-panel').getByRole('button', { name: 'Resume Template', exact: true }).click();
        await page.getByRole('button', { name: 'AI', exact: true }).click();
        await page.locator('#aiReaderDocument [data-field="reusable-section-type"][data-section-key="__top_level__"]').selectOption('section-def:Publications');
        await page.locator('#aiReaderDocument [data-action="add-top-level-section"]').click();
        await page.locator(`[data-modal-action="choose-section-template-flavor"][data-section-template-flavor="${flavor}"]`).click();

        const exitSectionEditor = async () => {
          await page.locator('#aiReaderDocument .editor-block-done-row').getByRole('button', { name: exitLabel, exact: true }).click();
          await expect(page.locator('#aiReaderDocument .editor-block')).toHaveCount(0);
        };
        if (!addBeforeExit) await exitSectionEditor();
        await page.locator('#aiReaderDocument [data-action="add-component-list-item"]', { hasText: 'Add Publication' }).click();
        await page.locator('[data-template-variable="name"]').fill('Fake Publication');
        await page.locator('[data-modal-action="insert-reusable-template"]').click();
        await expect(page.locator('#aiReaderDocument .editor-block', { hasText: 'List type:' })).toHaveCount(0);
        await expect(page.locator(`#aiReaderDocument .reader-block[data-component="${flavor === 'linear' ? 'publication-linear-record' : 'publication-record'}"]`)).toHaveCount(1);
        await expect(page.locator('#aiReaderDocument .editor-block[data-active-editor-block="true"]')).toHaveCount(addBeforeExit ? 1 : 0);
        if (addBeforeExit) await exitSectionEditor();

        await expect(page.locator('#aiReaderDocument .editor-block')).toHaveCount(0);
        await expect(page.locator('#aiReaderDocument').getByText('Fake Publication', { exact: true }).first()).toBeVisible();
        await page.locator('#aiReaderDocument').getByText('Fake Publication', { exact: true }).first().click({ button: 'right' });
        await page.getByRole('button', { name: 'Edit component', exact: true }).click();
        await expect(page.locator('#aiReaderDocument .editor-block-done-row').getByRole('button', { name: 'Done', exact: true })).toBeVisible();
      });
    }
  }
}
