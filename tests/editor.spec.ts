import { expect, test } from '@playwright/test';

test('can add section and undo/redo', async ({ page }) => {
  await page.goto('/');

  const sections = page.locator('input[data-field="section-title"]');
  const initialCount = await sections.count();

  await page.locator('[data-action="spawn-root-ghost"][data-section-key="__root__"]').click();
  await expect(sections).toHaveCount(initialCount + 1);

  await page.locator('[data-action="undo"]').click();
  await expect(sections).toHaveCount(initialCount);

  await page.keyboard.press('Control+y');
  await expect(sections).toHaveCount(initialCount + 1);
});
