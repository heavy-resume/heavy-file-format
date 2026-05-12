import { expect, test } from '@playwright/test';

test('section add component affordance is a compact single row', async ({ page }) => {
  await page.goto('/');

  const addComponent = page.locator('.compact-add-component-ghost').first();
  const box = await addComponent.boundingBox();

  await expect(addComponent.getByRole('button', { name: 'Section component type' })).toBeVisible();
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
  await picker.locator('[data-picker-pane="plugins"] .component-picker-row-leaf', { hasText: 'DB Table' }).evaluate((button) => {
    if (button instanceof HTMLElement) button.click();
  });

  await expect(page.locator('.editor-block-title', { hasText: 'DB Table' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use Plugin' })).toHaveCount(0);
});

test('selected component shows insert above and below component affordances', async ({ page }) => {
  await page.goto('/');

  await page.locator('.editor-block-passive').first().click();

  await expect(page.locator('.active-component-insert-ghost-before')).toBeVisible();
  await expect(page.locator('.active-component-insert-ghost-before')).toContainText('Insert Above');
  await expect(page.locator('.active-component-insert-ghost-before').getByRole('button', { name: 'Insert component above' })).toBeVisible();
  await expect(page.locator('.active-component-insert-ghost-after')).toBeVisible();
  await expect(page.locator('.active-component-insert-ghost-after')).toContainText('Insert Below');
  await expect(page.locator('.active-component-insert-ghost-after').getByRole('button', { name: 'Insert component below' })).toBeVisible();
});

test('selected component insert below adds picked components', async ({ page }) => {
  await page.goto('/');

  await page.locator('.editor-block-passive').first().click();
  await page.locator('.active-component-insert-label', { hasText: 'Insert Below' }).click();
  await page.locator('.active-component-insert-ghost-after .component-picker-row-direct[data-component="text"]').click();

  await expect(page.locator('.active-component-insert-ghost-after .component-picker[data-open="true"]')).toHaveCount(0);
  await expect(page.locator('.editor-block .rich-editor').first()).toBeVisible();

  await page.locator('.editor-block-passive').first().click();
  await page.locator('.active-component-insert-ghost-after').getByRole('button', { name: 'Insert component below' }).click();
  await page.locator('.active-component-insert-ghost-after .component-picker-row-category', { hasText: 'Plugin' }).click();
  await page.locator('.active-component-insert-ghost-after [data-picker-pane="plugins"] .component-picker-row-leaf', { hasText: 'DB Table' }).evaluate((button) => {
    if (button instanceof HTMLElement) button.click();
  });

  await expect(page.locator('.active-component-insert-ghost-after .component-picker[data-open="true"]')).toHaveCount(0);
  await expect(page.locator('.editor-block-title', { hasText: 'DB Table' }).first()).toBeVisible();
});

test('selected component insert picker remains clickable after trigger loses focus', async ({ page }) => {
  await page.goto('/');

  await page.locator('.editor-block-passive').first().click();
  await page.locator('.active-component-insert-ghost-after').getByRole('button', { name: 'Insert component below' }).click();
  await page.locator('.active-component-insert-ghost-after .component-picker-trigger').evaluate((button) => {
    if (button instanceof HTMLElement) {
      button.blur();
    }
  });
  await expect(page.locator('.active-component-insert-ghost-after .component-picker[data-open="true"]')).toHaveCount(1);
  await expect(page.locator('.active-component-insert-ghost-after .component-picker-popover')).toBeVisible();

  await page.locator('.active-component-insert-ghost-after .component-picker-row-direct[data-component="text"]').click();

  await expect(page.locator('.active-component-insert-ghost-after .component-picker[data-open="true"]')).toHaveCount(0);
  await expect(page.locator('.editor-block .rich-editor').first()).toBeVisible();
});

test('locked sections do not show selected component insert affordances', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.locator('.editor-block-passive:visible').first().click();

  await expect(page.locator('.active-component-insert-ghost-before')).toHaveCount(0);
  await expect(page.locator('.active-component-insert-ghost-after')).toHaveCount(0);
});
