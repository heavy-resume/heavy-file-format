import { expect, test } from '@playwright/test';

for (const layout of ['phone preview', 'small window', 'full'] as const) {
  test(`component picker categories fit the editor in ${layout}`, async ({ page }) => {
    test.setTimeout(5_000);
    if (layout === 'small window') await page.setViewportSize({ width: 360, height: 1000 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Editor', exact: true }).click();
    if (layout === 'phone preview') await page.getByRole('button', { name: 'Phone 390' }).click();
    const addComponent = page.locator('.compact-add-component-ghost').first();
    await addComponent.getByRole('button', { name: 'Section component type' }).click();
    const picker = addComponent.locator('.component-picker-popover');

    for (const category of ['Images', 'Advanced', 'Containers', 'Plugin']) {
      await picker.locator('.component-picker-row-category', { hasText: category }).click();
      await expect.poll(() => picker.evaluate((popover) => {
        const menu = popover.getBoundingClientRect();
        const surface = popover.closest('.editor-tree')!.getBoundingClientRect();
        return menu.left >= Math.max(0, surface.left) + 7
          && menu.right <= Math.min(window.innerWidth, surface.right) - 7
          && popover.scrollWidth <= popover.clientWidth;
      })).toBe(true);
      await picker.locator('.component-picker-back:visible').click();
    }
    await picker.locator('.component-picker-row-category', { hasText: 'Images' }).click();
    await picker.locator('[data-picker-pane="images"] [data-component="image"]').click();
    await expect(page.locator('.editor-block-title', { hasText: 'Image' }).first()).toBeVisible();
  });
}
