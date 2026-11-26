import { expect, test, type Page } from '@playwright/test';

async function applyDocument(page: Page, formBody: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
plugins:
  - id: hvy.form
---

<!--hvy: {"id":"fake-form-section"}-->
#! Fake form

<!--hvy:plugin {"id":"fake-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitLabel":"Fake submit","submitScript":"submit"}}-->
${formBody}
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
}

async function readHeader(page: Page, key: string): Promise<unknown> {
  return page.evaluate(async (headerKey) => {
    const { state } = await import('/src/state.ts');
    return state.document.meta[headerKey] ?? null;
  }, key);
}

test('disabled fields cannot be changed but still submit their values', async ({ page }) => {
  test.setTimeout(5000);
  await applyDocument(page, `fields:
  - label: Fake text
    value: Fake fixed text
    disabled: true
  - label: Fake empty required
    required: true
    disabled: true
  - label: Fake choice
    type: select
    options: [Fake first, Fake second]
    value: Fake second
    disabled: true
  - label: Fake radio
    type: radio
    options: [Fake left, Fake right]
    value: Fake right
    disabled: true
  - label: Fake check
    type: checkbox
    value: true
    disabled: true
  - label: Fake slider
    type: range
    value: 30
    disabled: true
  - label: Fake photo
    type: photo
    disabled: true
scripts:
  submit: |
    doc.header.set("fake_values", doc.form.get_values())
`);
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  const form = page.locator('.hvy-form-plugin').first();

  await expect(form.getByLabel('Fake text')).toBeDisabled();
  await expect(form.getByLabel('Fake text')).toHaveCSS('cursor', 'not-allowed');
  await expect(form.getByLabel('Fake empty required')).toBeDisabled();
  await expect(form.getByLabel('Fake choice')).toBeDisabled();
  await expect(form.getByRole('radio', { name: 'Fake left' })).toBeDisabled();
  await expect(form.getByRole('radio', { name: 'Fake right' })).toBeDisabled();
  await expect(form.getByLabel('Fake check')).toBeDisabled();
  await expect(form.getByRole('slider', { name: 'Fake slider' })).toBeDisabled();
  await expect(form.locator('input[type="file"][name="Fake photo"]')).toBeDisabled();

  await form.getByRole('radio', { name: 'Fake left' }).click({ force: true });
  await form.getByLabel('Fake check').click({ force: true });
  await form.getByRole('button', { name: 'Fake submit' }).click();

  await expect.poll(() => readHeader(page, 'fake_values')).toEqual({
    'Fake text': 'Fake fixed text',
    'Fake empty required': '',
    'Fake choice': 'Fake second',
    'Fake radio': 'Fake right',
    'Fake check': true,
    'Fake slider': '30',
    'Fake photo': null,
  });
});

test('scripts toggle a field disabled while focus stays on the typed field', async ({ page }) => {
  test.setTimeout(5000);
  await applyDocument(page, `fields:
  - label: Fake gate
    triggers:
      input: toggle
  - label: Fake target
    value: Fake starting value
    disabled: true
scripts:
  toggle: |
    unlocked = doc.form.get_value("Fake gate") == "open"
    doc.form.set_field_disabled("Fake target", not unlocked)
    doc.header.set("fake_target_disabled", doc.form.get_field_disabled("Fake target"))
  submit: |
    pass
`);
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  const form = page.locator('.hvy-form-plugin').first();
  await expect(form.getByLabel('Fake target')).toBeDisabled();

  await form.getByLabel('Fake gate').pressSequentially('open');

  await expect(form.getByLabel('Fake target')).toBeEnabled();
  await expect(form.getByLabel('Fake gate')).toBeFocused();
  await expect(form.getByLabel('Fake gate')).toHaveValue('open');
  await expect.poll(() => readHeader(page, 'fake_target_disabled')).toBe(false);

  await form.getByLabel('Fake gate').press('Backspace');

  await expect(form.getByLabel('Fake target')).toBeDisabled();
  await expect(form.getByLabel('Fake target')).toHaveValue('Fake starting value');
  await expect.poll(() => readHeader(page, 'fake_target_disabled')).toBe(true);
});

test('the editor Disabled checkbox writes the field disabled flag without losing focus', async ({ page }) => {
  test.setTimeout(5000);
  await applyDocument(page, `fields:
  - label: Fake field
    type: text`);
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive').first().click();
  // Activation moves focus two frames after the click, which would otherwise land on the checkbox mid-test.
  await expect(page.locator('.hvy-form-plugin textarea').first()).toBeFocused();
  const disabledCheckbox = page.locator('input[data-form-field-prop="disabled"]');

  await disabledCheckbox.check();

  await expect(disabledCheckbox).toBeFocused();
  await expect(disabledCheckbox).toBeChecked();
  const expectedResult = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0].blocks.find((block: { schema: { component: string } }) => block.schema.component === 'plugin')?.text;
  });
  expect(expectedResult).toBe(`fields:
  - label: Fake field
    type: text
    disabled: true`);
});
