import { expect, test } from '@playwright/test';

const formDocument = `---
hvy_version: 0.1
plugins:
  - id: hvy.form
---

<!--hvy: {"id":"fake-form-section"}-->
#! Fake form

<!--hvy:plugin {"id":"fake-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitLabel":"Fake submit"}}-->
fields:
  - label: Fake field
    type: text
    triggers:
      input: validate
scripts:
  validate: |
    doc.form.set_error("Fake field", "Fake error for " + doc.form.get_value("Fake field"))
`;

test('input trigger scripts that rerender the form keep focus and caret in the typed field', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(formDocument);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  const field = page.locator('.hvy-form-plugin').first().getByLabel('Fake field');
  await field.pressSequentially('abcd');
  await field.press('ArrowLeft');
  await field.press('ArrowLeft');
  await field.pressSequentially('X');

  await expect(page.locator('.hvy-form-field-error')).toHaveText('Fake error for abXcd');
  await expect(field).toBeFocused();
  expect(await field.evaluate((input: HTMLInputElement) => [input.selectionStart, input.selectionEnd])).toEqual([3, 3]);
});
