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

test('xref Done does not refresh reader panels or rehydrate unrelated images', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.evaluate(async () => {
    const [{ mountHvy }, { deserializeDocument }, { setImageAttachment }] = await Promise.all([
      import('/src/embed-full.ts'),
      import('/src/serialization.ts'),
      import('/src/attachments.ts'),
    ]);
    const win = window as Window & { __xrefDonePerfEvents?: Array<{ event?: string }> };
    win.__xrefDonePerfEvents = [];
    const originalDebug = console.debug.bind(console);
    console.debug = (...args: unknown[]) => {
      if (args[0] === '[hvy:perf]') {
        win.__xrefDonePerfEvents?.push((args[1] ?? {}) as { event?: string });
      }
      originalDebug(...args);
    };
    const hvyDocument = deserializeDocument(`---
hvy_version: 0.1
component_defs:
  - name: fake-reference
    baseType: xref-card
    schema:
      xrefTargetTagFilter: fake
---
<!--hvy: {"id":"fake-section"}-->
#! Fake Section
 <!--hvy:text {"id":"fake-target","tags":"fake"}-->
  Fake target
 <!--hvy:component-list {"id":"fake-list","componentListComponent":"fake-reference"}-->
 <!--hvy:image {"id":"unrelated-image","imageFile":"unrelated.svg"}-->
`, '.hvy');
    setImageAttachment(
      hvyDocument,
      'unrelated.svg',
      'image/svg+xml',
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2"/></svg>')
    );
    document.body.innerHTML = '<div id="xref-perf-host"></div>';
    mountHvy({ root: document.getElementById('xref-perf-host')!, mode: 'ai', document: hvyDocument });
  });

  await page.locator('[data-action="add-component-list-item"]').click();
  await page.locator('select[data-field="block-xref-target"]').selectOption('fake-target');
  await expect(page.locator('img[data-image-filename="unrelated.svg"]')).toHaveJSProperty('complete', true);
  await page.evaluate(() => {
    (window as Window & { __xrefDonePerfEvents?: Array<{ event?: string }> }).__xrefDonePerfEvents = [];
  });

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.reader-xref-card')).toBeVisible();
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  const events = await page.evaluate(() => (
    (window as Window & { __xrefDonePerfEvents?: Array<{ event?: string }> }).__xrefDonePerfEvents ?? []
  ).map((event) => event.event));
  expect(events.filter((event) => event === 'refreshReaderPanels')).toHaveLength(0);
  expect(events.filter((event) => event === 'renderApp')).toHaveLength(0);
  expect(events.filter((event) => event === 'image-lazy-hydration:src-set')).toHaveLength(0);
  expect(events.filter((event) => event === 'image-lazy-hydration:load')).toHaveLength(0);
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
