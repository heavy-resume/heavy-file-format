import { expect, test } from '@playwright/test';

test('section meta shows Start on new page only for PHVY documents and saves it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Advanced' }).click();

  await page.locator('[data-action="focus-modal"]').first().click();
  await expect(page.locator('.section-meta-modal').getByLabel('Start on new page')).toHaveCount(0);
  await page.locator('.section-meta-modal').getByRole('button', { name: 'Close' }).click();

  await page.evaluate(async () => {
    const { getRenderApp, state } = await import('/src/state.ts');
    state.document.extension = '.phvy';
    getRenderApp()();
  });
  await page.locator('[data-action="focus-modal"]').first().click();
  await page.locator('.section-meta-modal').getByLabel('Start on new page').check();
  await page.locator('.section-meta-modal').getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(page.locator('#rawEditor')).toContainText('"startOnNewPage":true');
});
