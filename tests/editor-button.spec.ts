import { expect, test } from '@playwright/test';

test('editor-only generate button applies pronunciation and stays out of viewer', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    const payload = route.request().postDataJSON() as { context?: string };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: payload.context?.includes('Avery Hart') ? 'AY-vuh-ree HART' : 'UNKNOWN',
      }),
    });
  });

  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();

  const raw = page.locator('#rawEditor');
  await raw.fill((await raw.inputValue()).replace('# <!-- value -->', '# Avery Hart'));
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const generateButton = page.locator('[data-action="run-button-ai-generate"]');
  await expect(generateButton).toBeVisible({ timeout: 10000 });
  const anchor = page.locator('[data-component-id="resume-pronunciation"][data-hvy-button-anchor="true"]').first();
  await expect(anchor).toHaveCSS('position', 'relative');
  await expect(generateButton.locator('xpath=ancestor::*[contains(@class, "hvy-button-overlay-layer")]')).toHaveCount(1);

  await generateButton.click();

  await expect(page.locator('#editorTree')).toContainText('[AY-vuh-ree HART]');
  await expect(generateButton).toBeHidden({ timeout: 10000 });

  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('[data-action="run-button-ai-generate"]')).toHaveCount(0);
  await expect(page.locator('#readerDocument')).toContainText('[AY-vuh-ree HART]');
});
