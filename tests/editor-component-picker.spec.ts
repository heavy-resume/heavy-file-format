import { expect, test } from '@playwright/test';

test('section add component affordance is a compact single row', async ({ page }) => {
  await page.goto('/');

  const addComponent = page.locator('.compact-add-component-ghost').first();
  const box = await addComponent.boundingBox();

  await expect(addComponent).toContainText('+');
  await expect(addComponent.locator('select')).toHaveCount(0);
  expect(box?.height ?? 0).toBeLessThanOrEqual(46);
});

test('component picker opens categories and adds selected component', async ({ page }) => {
  await page.goto('/');

  const addComponent = page.locator('.compact-add-component-ghost').first();
  await addComponent.getByRole('button', { name: 'Section component type' }).click();

  const picker = addComponent.locator('.component-picker-popover');
  const rootPane = picker.locator('.component-picker-pane-root');
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Text' })).toBeVisible();
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Image' })).toBeVisible();
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Table' })).toBeVisible();
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Containers' })).toBeVisible();
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Custom' })).toBeVisible();
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Plugin' })).toBeVisible();
  await expect(rootPane.locator('.component-picker-row-direct[data-component="text"] .component-picker-row-description')).toBeHidden();
  await rootPane.locator('.component-picker-row-direct[data-component="text"]').hover();
  await expect(rootPane.locator('.component-picker-row-direct[data-component="text"] .component-picker-row-description')).toBeVisible();

  await picker.locator('.component-picker-row-category', { hasText: 'Containers' }).click();
  await expect(picker.locator('[data-picker-pane="containers"] .component-picker-row-title', { hasText: 'Container' })).toBeVisible();
  await addComponent.getByRole('button', { name: 'Section component type' }).click();
  await expect(rootPane.locator('.component-picker-row-title', { hasText: 'Text' })).toBeVisible();
  await expect(picker.locator('[data-picker-pane="containers"] .component-picker-row-title', { hasText: 'Container' })).toBeHidden();
  await rootPane.click({ position: { x: 112, y: 112 } });
  await expect(picker).toBeHidden();
  await addComponent.getByRole('button', { name: 'Section component type' }).click();

  await picker.locator('.component-picker-row-category', { hasText: 'Plugin' }).click();
  await expect(picker.locator('[data-picker-pane="plugins"] .component-picker-row-title', { hasText: 'DB Table' })).toBeVisible();
  await addComponent.getByRole('button', { name: 'Section component type' }).click();

  await picker.locator('.component-picker-row-direct[data-component="text"]').click();

  await expect(page.locator('.editor-block .rich-editor').first()).toBeVisible();
});

test('component picker adds a selected plugin directly', async ({ page }) => {
  await page.goto('/');

  const addComponent = page.locator('.compact-add-component-ghost').first();
  await addComponent.getByRole('button', { name: 'Section component type' }).click();

  const picker = addComponent.locator('.component-picker-popover');
  await picker.locator('.component-picker-row-category', { hasText: 'Plugin' }).click();
  await picker.locator('[data-picker-pane="plugins"] .component-picker-row-title', { hasText: 'DB Table' }).click();

  await expect(page.locator('.editor-block-title', { hasText: 'DB Table' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use Plugin' })).toHaveCount(0);
});
