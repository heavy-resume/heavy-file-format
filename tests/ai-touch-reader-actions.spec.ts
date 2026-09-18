import { expect, test } from '@playwright/test';

test.use({ hasTouch: true });

for (const expanded of [false, true]) {
  test(`AI touch double tap preserves expanded=${expanded} and single tap still toggles`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.goto('/');
    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

   <!--hvy:expandable {"expandableExpanded":${expanded}}-->

    <!--hvy:expandable:stub {}-->

     <!--hvy:text {}-->
      Open details

    <!--hvy:expandable:content {}-->

     <!--hvy:text {}-->
      Hidden details

   <!--hvy:text {}-->
    Another block
`);
    await page.getByRole('button', { name: 'Apply' }).click();
    await page.getByRole('button', { name: 'AI' }).click();

    await page.getByRole('button', { name: 'Phone 390' }).click();
    const toggle = page.locator('#aiReaderDocument [data-reader-action="toggle-expandable"]').first();
    await expect(toggle).toHaveAttribute('aria-expanded', String(expanded));

    await toggle.tap();
    await toggle.tap();

    await expect(page.locator('.hvy-context-popover')).toContainText('Request changes');
    await page.waitForTimeout(400);
    await expect(toggle).toHaveAttribute('aria-expanded', String(expanded));
    await page.locator('.hvy-context-popover-backdrop-target').tap({ position: { x: 12, y: 12 } });
    await expect(page.locator('.hvy-context-popover')).toHaveCount(0);
    await toggle.tap();
    await expect(toggle).toHaveAttribute('aria-expanded', String(!expanded));
  });
}
