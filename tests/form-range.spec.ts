import { expect, test, type Page } from '@playwright/test';

function documentWithFormBody(formBody: string, pluginConfig = '{"version":"0.1","submitLabel":"Fake submit"}'): string {
  return `---
hvy_version: 0.1
plugins:
  - id: hvy.form
---

<!--hvy: {"id":"fake-form-section"}-->
#! Fake form

<!--hvy:plugin {"id":"fake-form","plugin":"hvy.form","pluginConfig":${pluginConfig}}-->
${formBody}
`;
}

async function applyDocument(page: Page, source: string): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(source);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
}

async function openViewer(page: Page, source: string): Promise<void> {
  await applyDocument(page, source);
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
}

test('renders a labelled slider and reports the value to submit scripts', async ({ page }) => {
  test.setTimeout(5000);
  await openViewer(page, documentWithFormBody(`fields:
  - label: Fake volume
    type: range
    value: 20
    min: 0
    max: 40
    step: 5
scripts:
  submit: |
    doc.header.set("fake_volume", doc.form.get_value("Fake volume"))
`, '{"version":"0.1","submitLabel":"Fake submit","submitScript":"submit"}'));
  const field = page.locator('.hvy-form-field-range');
  const slider = page.getByRole('slider', { name: 'Fake volume', exact: true });

  await expect(field.locator('.hvy-form-field-label')).toHaveText('Fake volume');
  await expect(slider).toHaveAttribute('min', '0');
  await expect(slider).toHaveAttribute('max', '40');
  await expect(slider).toHaveAttribute('step', '5');
  await expect(slider).toHaveValue('20');
  await expect(field.locator('output')).toHaveText('20');

  await slider.press('ArrowRight');

  await expect(slider).toHaveValue('25');
  await expect(field.locator('output')).toHaveText('25');
  await page.getByRole('button', { name: 'Fake submit' }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.meta.fake_volume ?? null;
  })).toBe('25');
});

test('moving the slider updates in place without rebuilding the form', async ({ page }) => {
  test.setTimeout(5000);
  await openViewer(page, documentWithFormBody(`fields:
  - label: Fake volume
    type: range
`));
  const slider = page.getByRole('slider', { name: 'Fake volume', exact: true });
  await slider.evaluate((input: HTMLInputElement) => { input.dataset.fakeOriginalNode = 'true'; });

  await slider.press('ArrowRight');
  await slider.press('ArrowRight');

  await expect(slider).toHaveValue('52');
  await expect(slider).toHaveAttribute('data-fake-original-node', 'true');
  await expect(slider).toBeFocused();
  expect(await slider.evaluate((input: HTMLInputElement) => input.style.getPropertyValue('--hvy-form-range-fill'))).toBe('52%');
});

test('a document-editing input script waits for release so the drag continues, then input and change both run', async ({ page }) => {
  test.setTimeout(5000);
  await openViewer(page, documentWithFormBody(`fields:
  - label: Fake volume
    type: range
    value: 0
    triggers:
      input: record_input
      change: record_change
scripts:
  record_input: |
    doc.header.set("fake_input_saw", doc.form.get_value("Fake volume"))
  record_change: |
    doc.header.set("fake_change_saw", doc.form.get_value("Fake volume"))
`));
  const readHeader = (key: string) => page.evaluate(async (headerKey) => {
    const { state } = await import('/src/state.ts');
    return state.document.meta[headerKey] ?? null;
  }, key);
  const slider = page.getByRole('slider', { name: 'Fake volume', exact: true });
  const box = (await slider.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + 8, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.25, y);

  // Pause past the input trigger's 250ms debounce with the pointer still held.
  await page.waitForTimeout(600);
  expect(await readHeader('fake_input_saw')).toBeNull();

  await page.mouse.move(box.x + box.width * 0.75, y);
  const expectedResult = await slider.inputValue();
  expect(Number(expectedResult)).toBeGreaterThan(60);
  await page.mouse.up();

  await expect.poll(() => readHeader('fake_input_saw')).toBe(expectedResult);
  await expect.poll(() => readHeader('fake_change_saw')).toBe(expectedResult);
  await expect(page.getByRole('slider', { name: 'Fake volume', exact: true })).toHaveValue(expectedResult);
});

test('scripts setting a slider value see and show the resolved value', async ({ page }) => {
  test.setTimeout(5000);
  await openViewer(page, documentWithFormBody(`fields:
  - label: Fake volume
    type: range
    max: 10
scripts:
  init: |
    doc.form.set_value("Fake volume", 500)
    doc.header.set("fake_read_back", doc.form.get_value("Fake volume"))
`, '{"version":"0.1","initialScript":"init"}'));
  const slider = page.getByRole('slider', { name: 'Fake volume', exact: true });

  await expect(slider).toHaveValue('10');
  await expect(page.locator('.hvy-form-field-range output')).toHaveText('10');
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.meta.fake_read_back ?? null;
  })).toBe('10');
});

test('changing a field type shows that type\'s inputs while focus is inside the form', async ({ page }) => {
  test.setTimeout(5000);
  await applyDocument(page, documentWithFormBody(`fields:
  - label: Fake choice
    type: text
`));
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive').first().click();
  await expect(page.locator('.hvy-form-plugin textarea').first()).toBeFocused();
  const typeSelect = page.locator('select[data-form-field-prop="type"]');

  await typeSelect.selectOption('select');

  await expect(page.locator('textarea[data-form-field-prop="options"]')).toBeVisible();
  await expect(typeSelect).toBeFocused();
  await expect(typeSelect).toHaveValue('select');
});

test('the editor configures range bounds without losing focus while typing', async ({ page }) => {
  test.setTimeout(5000);
  await applyDocument(page, documentWithFormBody(`fields:
  - label: Fake volume
    type: text
`));
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive').first().click();
  // Activation moves focus two frames after the click, which would otherwise land mid-typing.
  await expect(page.locator('.hvy-form-plugin textarea').first()).toBeFocused();
  const typeSelect = page.locator('select[data-form-field-prop="type"]');
  await typeSelect.selectOption('range');
  await expect(typeSelect).toBeFocused();
  const maxInput = page.locator('[data-form-field-prop="max"]');
  await expect(page.locator('[data-form-field-prop="min"]')).toHaveValue('0');
  await expect(maxInput).toHaveValue('100');
  await expect(page.locator('[data-form-field-prop="step"]')).toHaveValue('1');
  await expect(page.locator('.hvy-form-field-editor [data-form-field-prop="placeholder"]')).toHaveCount(0);

  await maxInput.fill('');
  await maxInput.pressSequentially('250');
  await page.locator('[data-form-field-prop="step"]').fill('0.5');

  await expect(page.locator('[data-form-field-prop="step"]')).toBeFocused();
  await expect(maxInput).toHaveValue('250');
  const expectedResult = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const find = (blocks: { text: string; schema: { component: string } }[]) => blocks.find((block) => block.schema.component === 'plugin');
    return find(state.document.sections[0].blocks)?.text;
  });
  expect(expectedResult).toBe(`fields:
  - label: Fake volume
    type: range
    min: 0
    max: 250
    step: 0.5`);
});
