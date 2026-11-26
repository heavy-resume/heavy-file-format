import { expect, test, type Page } from '@playwright/test';

const ROW_CSS = 'display: flex; align-items: center; gap: 0.75rem; border: 1px solid var(--hvy-border); padding: 0.5rem;';

const CONTAINER_AND_STUB_DOCUMENT = `---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:container {"id":"fake-container","css":"${ROW_CSS}","containerTitle":"Fake Title","containerExpanded":true}-->
 <!--hvy:text {"id":"fake-container-first","css":"margin: 0;"}-->
  Fake first

 <!--hvy:text {"id":"fake-container-second","css":"margin: 0;"}-->
  Fake second

<!--hvy:container {"id":"fake-narrow","css":"display: flex; flex-wrap: nowrap; gap: 0.5rem;"}-->
 <!--hvy:text {"id":"fake-long","css":"flex: 0 1 auto; min-width: 0; margin: 0; overflow: hidden; white-space: nowrap;"}-->
  ${'A very long fake title that keeps going '.repeat(8)}

 <!--hvy:text {"id":"fake-badge","css":"flex: 0 0 auto; margin: 0;"}-->
  73%

<!--hvy:expandable {"id":"fake-expandable"}-->
 <!--hvy:expandable:stub {"css":"${ROW_CSS}"}-->
  <!--hvy:text {"id":"fake-stub-first","css":"margin: 0;"}-->
   Fake first

  <!--hvy:text {"id":"fake-stub-second","css":"margin: 0;"}-->
   Fake second
 <!--hvy:expandable:content {}-->
  <!--hvy:text {}-->
   Fake details
`;

const COLLAPSED_CONTAINER_DOCUMENT = `---
hvy_version: 0.1
---

<!--hvy: {"id":"fake-section"}-->
#! Fake Section

<!--hvy:container {"id":"fake-collapsed","css":"${ROW_CSS}","containerExpanded":false}-->
 <!--hvy:text {"id":"fake-collapsed-first","css":"margin: 0;"}-->
  Fake first

 <!--hvy:text {"id":"fake-collapsed-second","css":"margin: 0;"}-->
  Fake second
`;

async function applyDocument(page: Page, document = CONTAINER_AND_STUB_DOCUMENT): Promise<void> {
  await page.setViewportSize({ width: 720, height: 700 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(document);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
}

test('expected result: container css lays out its children like the same css on an expandable stub', async ({ page }) => {
  await applyDocument(page);
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();

  const containerFirst = (await page.locator('#fake-container-first').boundingBox())!;
  const containerSecond = (await page.locator('#fake-container-second').boundingBox())!;
  const stubFirst = (await page.locator('#fake-stub-first').boundingBox())!;
  const stubSecond = (await page.locator('#fake-stub-second').boundingBox())!;

  expect(containerSecond.y).toBe(containerFirst.y);
  expect(containerSecond.x - containerFirst.x).toBeCloseTo(stubSecond.x - stubFirst.x, 0);
  expect(containerSecond.width).toBeCloseTo(stubSecond.width, 0);
});

test('expected result: container title stays above the row and the container keeps its full width', async ({ page }) => {
  await applyDocument(page);
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();

  const shell = (await page.locator('#fake-container').boundingBox())!;
  const section = (await page.locator('#fake-expandable').boundingBox())!;
  const title = (await page.locator('#fake-container .reader-container-title').boundingBox())!;
  const first = (await page.locator('#fake-container-first').boundingBox())!;

  expect(shell.width).toBeCloseTo(section.width, 0);
  expect(title.y + title.height).toBeLessThanOrEqual(first.y);
  await expect(page.locator('#fake-container')).toHaveCSS('border-top-width', '1px');
  await expect(page.locator('#fake-container .reader-container-body')).toHaveCSS('border-top-width', '0px');
});

test('expected result: a long no-wrap child shrinks inside the container instead of widening it', async ({ page }) => {
  await applyDocument(page);
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();

  const shell = (await page.locator('#fake-narrow').boundingBox())!;
  const badge = (await page.locator('#fake-badge').boundingBox())!;

  expect(badge.x + badge.width).toBeLessThanOrEqual(shell.x + shell.width + 0.5);
});

test('expected result: a collapsed bordered container keeps its row and still expands on click', async ({ page }) => {
  await applyDocument(page, COLLAPSED_CONTAINER_DOCUMENT);
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  await expect(page.locator('#fake-collapsed .reader-container')).toHaveClass(/is-collapsed-preview/);

  const first = (await page.locator('#fake-collapsed-first').boundingBox())!;
  const second = (await page.locator('#fake-collapsed-second').boundingBox())!;
  expect(second.y).toBe(first.y);

  await page.locator('#fake-collapsed-second').click();

  await expect(page.locator('#fake-collapsed .reader-container')).toHaveClass(/is-expanded/);
});

test('expected result: editor passive container keeps child layout on the element holding the blocks', async ({ page }) => {
  await applyDocument(page);
  await page.getByRole('button', { name: 'Basic', exact: true }).click();

  await expect(page.locator('.reader-container-body').first()).toHaveCSS('display', 'flex');
});
