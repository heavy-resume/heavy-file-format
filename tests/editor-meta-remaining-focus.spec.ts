import { expect, test } from '@playwright/test';

for (const { field, value } of [
  { field: 'meta-reader-max-width', value: '61rem' },
  { field: 'meta-sidebar-max-width', value: '41rem' },
  { field: 'meta-paragraph-spacing', value: '0.6rem' },
  { field: 'meta-database-table-max-column-width', value: '42rem' },
  { field: 'meta-section-default-css', value: 'padding: 2px;' },
  { field: 'meta-pdf-margin-left', value: '0.75' },
  { field: 'text-line-style-label', value: 'Fake label' },
  { field: 'text-line-style-css', value: 'padding: 2px;' },
  { field: 'text-line-style-spacing', value: '2px' },
  { field: 'heading-style-label', value: 'Fake heading' },
  { field: 'heading-style-css', value: 'padding: 2px;' },
  { field: 'heading-style-spacing', value: '2px' },
  { field: 'heading-style-after-margin-top', value: '2px' },
]) {
  test(`resume document metadata ${field} keeps focus while typing`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto('/');
    await page.locator('.document-menu').evaluate((menu) => { (menu as HTMLDetailsElement).open = true; });
    await page.getByRole('button', { name: field.startsWith('meta-pdf-margin-') ? 'PDF Template Example' : 'Resume Example', exact: true }).click();
    await page.getByRole('button', { name: 'Advanced', exact: true }).click();
    await page.getByRole('button', { name: 'Document Meta', exact: true }).click();
    const input = page.locator(`[data-field="${field}"]`).first();
    await input.evaluate((node) => {
      for (let ancestor = node.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
      }
    });
    await input.fill('');
    const originalInput = await input.elementHandle();

    await input.pressSequentially(value, { delay: 35 });

    await expect(input).toHaveValue(value);
    await expect(input).toBeFocused();
    expect(await originalInput!.evaluate((node) => node.isConnected)).toBe(true);
  });
}

test('renaming a paragraph style preserves typing and its controls and document references', async ({ page }) => {
  test.setTimeout(5_000);
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
text_line_styles:
  fake-old:
    label: ''
    css: 'font-weight: 700;'
---
<!--hvy: {"id":"fake-section"}-->
#! Fake section

<!--hvy:text {}-->
 ^fake-old^ Fake body
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('button', { name: 'Document Meta', exact: true }).click();
  await page.locator('.text-line-style-row > summary').click();
  const input = page.locator('[data-field="text-line-style-name"]');
  const originalInput = await input.elementHandle();
  await input.fill('');

  await input.pressSequentially('fake-new', { delay: 35 });

  await expect(input).toHaveValue('fake-new');
  await expect(input).toBeFocused();
  expect(await originalInput!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(page.locator('.text-line-style-row > summary')).toContainText('fake-new');
  await page.locator('[data-field="text-line-style-label"]').fill('Fake renamed style');
  await page.locator('[data-field="text-line-style-css"]').fill('padding-left: 7px;');
  await page.getByRole('button', { name: 'Document Meta', exact: true }).click();
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(page.locator('#rawEditor')).toHaveValue(/\^fake-new\^ Fake body/);
  await expect(page.locator('#rawEditor')).toHaveValue(/label: Fake renamed style/);
  await expect(page.locator('#rawEditor')).toHaveValue(/padding-left: 7px/);
  await expect(page.locator('#rawEditor')).not.toHaveValue(/fake-old/);
});

test('list item label keeps focus and updates the add control', async ({ page }) => {
  test.setTimeout(5_000);
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---
<!--hvy: {"id":"fake-section"}-->
#! Fake section

<!--hvy:component-list {"id":"fake-list","componentListComponent":"text"}-->

 <!--hvy:text {}-->
  Fake item
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.locator('.editor-block-passive', { hasText: 'Fake item' }).first().click({ position: { x: 4, y: 4 } });
  await page.locator('.editor-block[data-active-editor-block="true"] [data-action="open-component-meta"]').click();
  const input = page.getByLabel('List Item Label', { exact: true });
  const originalInput = await input.elementHandle();

  await input.pressSequentially('Fake record', { delay: 35 });

  await expect(input).toHaveValue('Fake record');
  await expect(input).toBeFocused();
  expect(await originalInput!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(page.locator('.editor-block[data-active-editor-block="true"] [data-action="add-component-list-item"] .ghost-label').last()).toHaveText('Add Fake Record');
});

test('resume section CSS keeps focus while typing', async ({ page }) => {
  test.setTimeout(5_000);
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/');
  await page.locator('.document-menu').evaluate((menu) => { (menu as HTMLDetailsElement).open = true; });
  await page.getByRole('button', { name: 'Resume Example', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.locator('[data-action="focus-modal"]:visible').first().click();
  const input = page.locator('#modalCssInput');
  await input.fill('');
  const originalInput = await input.elementHandle();

  await input.pressSequentially('padding: 2px;', { delay: 35 });

  await expect(input).toHaveValue('padding: 2px;');
  await expect(input).toBeFocused();
  expect(await originalInput!.evaluate((node) => node.isConnected)).toBe(true);
});
