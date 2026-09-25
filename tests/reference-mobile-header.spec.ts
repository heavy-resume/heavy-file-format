import { expect, test } from '@playwright/test';

test('expected result: mobile reference controls expand from a compact header', async ({ page }) => {
  test.setTimeout(5_000);
  await page.setViewportSize({ width: 390, height: 760 });
  await page.goto('/');

  const toggle = page.getByRole('button', { name: 'HVY Reference Implementation' });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeHidden();
  await expect(page.locator('.workspace-shell')).toBeVisible();

  await toggle.click();

  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();

  await toggle.click();

  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeHidden();
});

test('expected result: desktop reference controls remain visible without the expander', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'HVY Reference Implementation' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'New', exact: true })).toBeVisible();
});
