import { expect, test, type Page } from '@playwright/test';

test('xref list additions exclude used targets while preserving focus and reuse in another list', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeXrefLists(page);
  await page.locator('[data-action="add-component-list-item"]').first().click();
  const picker = page.locator('select[data-field="block-xref-target"]').last();
  await expect(picker.locator('option[value="fake-one"]')).toHaveCount(0);
  await expect(picker.locator('option[value="fake-two"]')).toHaveCount(1);
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await picker.focus();
  await picker.selectOption('fake-two');
  await expect(picker).toBeFocused();
  await expect(picker).toHaveValue('fake-two');
  await expect(page.locator('[data-field="block-xref-title"]')).toHaveText('Fake Two');
  await picker.selectOption('');
  await expect(picker.locator('option[value="fake-two"]')).toHaveCount(1);
  await picker.selectOption('fake-two');
  await page.locator('[data-action="add-component-list-item"]').first().click();
  await expect(picker).toBeDisabled();
  await expect(page.locator('.xref-target-empty:visible')).toHaveText('No fake targets available.');
  await page.locator('[data-action="add-component-list-item"]').last().click();
  await expect(picker).toBeEnabled();
  await expect(picker.locator('option[value="fake-one"]')).toHaveCount(1);
  await expect(picker.locator('option[value="fake-two"]')).toHaveCount(1);
});

test('xref template picker filters used targets and rejects manually entered duplicates', async ({ page }) => {
  test.setTimeout(5_000);
  await mountFakeXrefLists(page, true);
  await page.locator('[data-action="add-component-list-item"]').first().click();
  const field = page.locator('[data-template-variable="fake_target"]');
  await expect(page.locator('datalist option[value="fake-one"]')).toHaveCount(0);
  await expect(page.locator('datalist option[value="fake-two"]')).toHaveCount(1);
  await field.fill('fake-one');
  await page.locator('[data-modal-action="insert-reusable-template"]').click();
  await expect(field).toBeVisible();
  expect(await field.evaluate((node: HTMLInputElement) => node.validationMessage)).toContain('already used in this list');
  await field.fill('fake-two');
  await page.locator('[data-modal-action="insert-reusable-template"]').click();
  await expect(field).toHaveCount(0);
  await page.locator('[data-action="add-component-list-item"]').first().click();
  await expect(field).toBeDisabled();
  await expect(page.locator('[data-modal-action="insert-reusable-template"]')).toBeDisabled();
});

async function mountFakeXrefLists(page: Page, template = false): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (template) => {
    const { mountHvy } = await import('/src/embed-full.ts');
    const { deserializeDocument } = await import('/src/serialization.ts');
    document.body.innerHTML = '<div id="fake-xref-host"></div>';
    mountHvy({
      root: document.getElementById('fake-xref-host')!, mode: 'editor',
      document: deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-reference
    baseType: xref-card
    schema:
      xrefTargetTagFilter: fake
${template ? '      xrefTarget: "{% fake_target %}"' : ''}
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section
 <!--hvy:text {"id":"fake-one","tags":"fake"}-->
  Fake One
 <!--hvy:text {"id":"fake-two","tags":"fake"}-->
  Fake Two
 <!--hvy:component-list {"id":"fake-list","componentListComponent":"fake-reference"}-->
  <!--hvy:component-list:0 {}-->
   <!--hvy:fake-reference {"xrefTitle":"First","xrefTarget":"fake-one"}-->
 <!--hvy:component-list {"id":"fake-other-list","componentListComponent":"fake-reference"}-->
`, '.hvy'),
    });
  }, template);
}
