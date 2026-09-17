import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: fake-link
    baseType: text
    templateVariables:
      fake_url:
        label: Fake URL
        type: url
    template:
      id: fake-link-template
      text: "[Fake link]({% fake_url %})"
      schema:
        component: text
---

#! Fake body
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();
});

test('expected result: Add form uses the same link destination conversion as selected text', async ({ page }) => {
  test.setTimeout(5_000);
  await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const { openReusableTemplateModalIfNeeded } = await import('/src/bind/actions/reusable-template.ts');
    openReusableTemplateModalIfNeeded('fake-link', { kind: 'section', sectionKey: state.document.sections[0].key });
  });
  await page.getByLabel('Fake URL', { exact: true }).fill('Pub URL');
  await page.locator('[data-modal-action="insert-reusable-template"]').click();

  await expect(page.locator('a[href="Pub%20URL"]').first()).toHaveText('Fake link');
  expect(await page.evaluate(async () => (await import('/src/state.ts')).state.document.sections[0].blocks[0].text))
    .toBe('[Fake link](Pub%20URL)');
});

test('expected result: template type picker stores URL in metadata and preserves the token', async ({ page }) => {
  test.setTimeout(5_000);
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('button', { name: 'Document Meta', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Template', exact: true }).click();
  const modal = page.locator('.reusable-definition-modal');
  await expect(modal.locator('[data-field="builder-template-variable-type"]')).toHaveValue('url');
  await modal.locator('[data-field="builder-template-variable-type"]').selectOption('text');
  await modal.locator('[data-field="builder-template-variable-type"]').selectOption('url');
  await modal.getByRole('button', { name: 'Save Template', exact: true }).click();

  expect(await page.evaluate(async () => (await import('/src/state.ts')).state.document.meta.component_defs))
    .toEqual(expect.arrayContaining([expect.objectContaining({
      templateVariables: { fake_url: { label: 'Fake URL', type: 'url' } },
      template: expect.objectContaining({ text: '[Fake link]({% fake_url | text %})' }),
    })]));
});
