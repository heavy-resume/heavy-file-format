import { expect, test } from '@playwright/test';

test('chat uses document editing mode in editor and ai views only', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Open chat' }).click();
  await expect(page.getByRole('heading', { name: 'Edit This Document' })).toBeVisible();
  await expect(page.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Describe how the document should change...');

  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  await expect(page.getByRole('heading', { name: 'Edit This Document' })).toBeVisible();
  await expect(page.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Describe how the document should change...');

  await page.locator('[data-action="switch-view"][data-view="viewer"]').click();
  await expect(page.getByRole('heading', { name: 'Ask This Document' })).toBeVisible();
  await expect(page.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Ask about the current HVY document...');
});
