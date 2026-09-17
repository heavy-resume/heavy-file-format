import { expect, test, type Page } from '@playwright/test';

async function openViewerWithCollapsedExpandable(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:expandable {"id":"record","expandableAlwaysShowStub":true,"expandableExpanded":false}-->
  <!--hvy:expandable:stub {}-->
   <!--hvy:text {"id":"record-title"}-->
    Sample stub text for copying
  <!--hvy:expandable:content {}-->
   <!--hvy:text {"id":"record-detail"}-->
    Sample hidden detail.
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  await expect(page.locator('#readerDocument')).toContainText('Sample stub text for copying');
  await expect(page.locator('#readerDocument')).not.toContainText('Sample hidden detail.');
}

test('quick click on an expandable stub expands it', async ({ page }) => {
  await openViewerWithCollapsedExpandable(page);

  await page.locator('#readerDocument').getByText('Sample stub text for copying').click();

  await expect(page.locator('#readerDocument')).toContainText('Sample hidden detail.');
});

test('click and hold on an expandable stub does not toggle it', async ({ page }) => {
  await openViewerWithCollapsedExpandable(page);
  const box = (await page.locator('#readerDocument').getByText('Sample stub text for copying').boundingBox())!;

  await page.mouse.move(box.x + 4, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(450);
  await page.mouse.up();

  await expect(page.locator('#readerDocument')).not.toContainText('Sample hidden detail.');
});

test('drag selecting text on an expandable stub does not toggle it and keeps the selection', async ({ page }) => {
  await openViewerWithCollapsedExpandable(page);
  const box = (await page.locator('#readerDocument').getByText('Sample stub text for copying').boundingBox())!;

  await page.mouse.move(box.x + 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  await expect(page.locator('#readerDocument')).not.toContainText('Sample hidden detail.');
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('stub text');
});
