import { expect, test, type Page } from '@playwright/test';

const STUB_ROW_DOCUMENT = `---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:expandable {"id":"fake-card"}-->
 <!--hvy:expandable:stub {"css":"display: flex; flex-wrap: nowrap; align-items: center; gap: 0.75rem;"}-->
  <!--hvy:text {"id":"fake-title","css":"flex: 0 1 auto; min-width: 0; margin: 0; overflow: hidden; white-space: nowrap;"}-->
   A very long fake title that keeps going well past the width of the narrow fake card it has been placed inside

  <!--hvy:text {"id":"fake-badge","css":"flex: 0 0 auto; margin: 0;"}-->
   73%

  <!--hvy:text {"id":"fake-action","css":"flex: 0 0 auto; margin: 0 0 0 auto;"}-->
   Fake action
 <!--hvy:expandable:content {}-->
  <!--hvy:text {}-->
   Fake details
`;

async function applyStubRowDocument(page: Page): Promise<void> {
  await page.setViewportSize({ width: 520, height: 700 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(STUB_ROW_DOCUMENT);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
}

test('expected result: viewer lays out stub blocks as one row with the title shrunk to fit', async ({ page }) => {
  await applyStubRowDocument(page);
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();

  const stubBox = (await page.locator('.expand-stub').boundingBox())!;
  const titleBox = (await page.locator('#fake-title').boundingBox())!;
  const badgeBox = (await page.locator('#fake-badge').boundingBox())!;
  const actionBox = (await page.locator('#fake-action').boundingBox())!;

  expect(badgeBox.y).toBe(titleBox.y);
  expect(actionBox.y).toBe(titleBox.y);
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(badgeBox.x);
  expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(actionBox.x);
  expect(actionBox.x + actionBox.width).toBeCloseTo(stubBox.x + stubBox.width, 0);
});

test('expected result: editor passive stub keeps stub css on the element holding the blocks', async ({ page }) => {
  await applyStubRowDocument(page);
  await page.getByRole('button', { name: 'Basic', exact: true }).click();

  await expect(page.locator('.expand-stub').first()).toHaveCSS('display', 'flex');
  await expect(page.locator('.expand-stub-toggle').first()).toHaveCSS('display', 'block');
});

test('expected result: clicking a stub laid out as a row still toggles the expandable', async ({ page }) => {
  await applyStubRowDocument(page);
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  await expect(page.locator('.expand-stub-toggle')).toHaveAttribute('aria-expanded', 'false');

  await page.locator('#fake-badge').click();

  await expect(page.getByText('Fake details')).toBeVisible();
});
