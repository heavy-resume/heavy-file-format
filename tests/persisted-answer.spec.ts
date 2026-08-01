import { expect, test } from '@playwright/test';

test('survey example presents persisted single and multiple answers', async ({ page }) => {
  await page.goto('/');
  await page.locator('.document-menu').evaluate((menu) => {
    if (menu instanceof HTMLDetailsElement) menu.open = true;
  });
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Survey Example', exact: true }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  await expect(page.getByLabel('Download file name')).toHaveValue('survey.hvy');
  const reader = page.locator('#readerDocument');
  await expect(reader.getByRole('radio')).toHaveCount(7);
  await expect(reader.getByRole('checkbox')).toHaveCount(7);
  const goodRadio = reader.getByRole('radio').nth(1);
  await expect(goodRadio).toHaveCSS('appearance', 'none');
  await expect(goodRadio).toHaveCSS('border-radius', '50%');
  expect(await goodRadio.evaluate((input) => getComputedStyle(input, '::before').transform)).toBe('matrix(0, 0, 0, 0, 0, 0)');
  await goodRadio.check();
  await reader.getByRole('checkbox').nth(2).check();
  await reader.getByRole('checkbox').nth(3).check();
  await expect(goodRadio).toBeChecked();
  expect(await goodRadio.evaluate((input) => getComputedStyle(input, '::before').transform)).toBe('matrix(1, 0, 0, 1, 0, 0)');
  await expect(reader.getByRole('checkbox').nth(2)).toBeChecked();
  await expect(reader.getByRole('checkbox').nth(3)).toBeChecked();
});

test('floating answer control converts only the active consecutive text block', async ({ page }) => {
  await page.goto('/');
  await page.locator('.document-menu').evaluate((menu) => {
    if (menu instanceof HTMLDetailsElement) menu.open = true;
  });
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Survey Example', exact: true }).click();

  const choiceBlock = page.locator('.editor-block-passive', { hasText: 'Excellent' });
  await choiceBlock.click();
  const activeEditor = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor');
  await expect(activeEditor.locator('input[type="radio"]')).toHaveCount(4);
  await expect(activeEditor.locator('input[type="checkbox"]')).toHaveCount(0);
  await activeEditor.locator('input[type="radio"]').nth(1).click();
  const modeSwitch = page.getByRole('group', { name: 'Selected answer block type' });
  await expect(modeSwitch).toBeVisible();
  await expect(modeSwitch.getByRole('radio', { name: 'Radio' })).toBeChecked();
  await modeSwitch.locator('label', { hasText: 'Checkbox' }).click();
  await expect(page.locator('.editor-block[data-active-editor-block="true"] .rich-editor input[type="checkbox"]')).toHaveCount(4);
  await page.locator('.editor-block[data-active-editor-block="true"] .rich-editor input[type="checkbox"]').nth(1).click();
  await expect(modeSwitch.getByRole('radio', { name: 'Checkbox' })).toBeChecked();
  await modeSwitch.locator('label', { hasText: 'Radio' }).click();
  await expect(page.locator('.editor-block[data-active-editor-block="true"] .rich-editor input[type="radio"]')).toHaveCount(4);
  await activeEditor.locator('input[type="radio"]').nth(1).check();
  await expect(activeEditor.locator('input[type="radio"]').nth(1)).toBeChecked();
  await expect(activeEditor.locator('input[type="radio"]').first()).not.toBeChecked();
});

test('viewer selections persist into inline checkbox and radio marker source', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').evaluate((textarea, value) => {
    if (!(textarea instanceof HTMLTextAreaElement)) throw new Error('Raw editor textarea missing.');
    textarea.value = value;
    textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
  }, `---
hvy_version: 0.1
---

<!--hvy: {"id":"survey"}-->
#! Survey

 <!--hvy:text {"id":"approved"}-->
  [ ] Approved

 <!--hvy:text {"id":"contact"}-->
  - (x) Email
  - ( ) Phone
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Viewer' }).click();

  const reader = page.locator('#readerDocument');
  await reader.locator('.hvy-inline-checkbox-line', { hasText: 'Approved' }).locator('input').check();
  await reader.locator('li', { hasText: 'Phone' }).locator('input').check();
  await expect(reader.locator('li', { hasText: 'Email' }).locator('input')).not.toBeChecked();

  await page.getByRole('button', { name: 'Editor' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('[x] Approved');
  await expect(page.locator('#rawEditor')).toContainText('- ( ) Email\n  - (x) Phone');
});
