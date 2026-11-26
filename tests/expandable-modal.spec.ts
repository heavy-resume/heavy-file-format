import { expect, test, type Page } from '@playwright/test';

const fillerSections = Array.from({ length: 40 }, (_, index) => `
 <!--hvy:text {"id":"fake-filler-${index}"}-->
  Fake filler paragraph ${index}
`).join('');

async function openViewerWithModalExpandable(page: Page, expandedAttr = 'false'): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main
${fillerSections}
 <!--hvy:expandable {"id":"fake-record","expandablePresentation":"modal","expandableExpanded":${expandedAttr}}-->
  <!--hvy:expandable:stub {}-->
   <!--hvy:text {"id":"fake-stub"}-->
    Fake stub text
  <!--hvy:expandable:content {}-->
   <!--hvy:text {"id":"fake-detail"}-->
    Fake hidden detail <!-- placeholder expandable-close -->
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  await expect(page.locator('#readerDocument')).toContainText('Fake stub text');
}

test('a modal expandable opens above the document without expanding in the layout', async ({ page }) => {
  await openViewerWithModalExpandable(page);

  await page.locator('#readerDocument').getByText('Fake stub text').click();

  await expect(page.getByRole('dialog')).toContainText('Fake hidden detail');
  await expect(page.locator('#readerDocument')).not.toContainText('Fake hidden detail');
});

test('opening a modal expandable keeps the document scroll position and DOM', async ({ page }) => {
  await openViewerWithModalExpandable(page);
  await page.locator('#readerDocument').getByText('Fake stub text').scrollIntoViewIfNeeded();
  const scrollBefore = await page.locator('#readerDocument').evaluate((element) => {
    element.querySelector('.reader-section')?.setAttribute('data-fake-dom-marker', 'kept');
    return element.scrollTop;
  });

  await page.locator('#readerDocument').getByText('Fake stub text').click();
  await expect(page.getByRole('dialog')).toBeVisible();

  expect(scrollBefore).toBeGreaterThan(0);
  expect(await page.locator('#readerDocument').evaluate((element) => element.scrollTop)).toBe(scrollBefore);
  await expect(page.locator('#readerDocument [data-fake-dom-marker="kept"]')).toHaveCount(1);
});

test('the backdrop closes a modal expandable but a click inside does not', async ({ page }) => {
  await openViewerWithModalExpandable(page);
  await page.locator('#readerDocument').getByText('Fake stub text').click();

  await page.getByRole('dialog').getByText('Fake hidden detail').click();
  await expect(page.getByRole('dialog')).toBeVisible();

  await page.locator('.expandable-modal-backdrop').click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the built-in close button and Escape close a modal expandable', async ({ page }) => {
  await openViewerWithModalExpandable(page);

  await page.locator('#readerDocument').getByText('Fake stub text').click();
  await page.locator('.expandable-modal-close').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.locator('#readerDocument').getByText('Fake stub text').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the expandable-close placeholder closes a modal expandable from its content', async ({ page }) => {
  await openViewerWithModalExpandable(page);
  await page.locator('#readerDocument').getByText('Fake stub text').click();

  await page.getByRole('dialog').locator('button.hvy-expandable-close').click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('expandableExpanded does not open a modal expandable on load', async ({ page }) => {
  await openViewerWithModalExpandable(page, 'true');

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#readerDocument')).not.toContainText('Fake hidden detail');
});

test('a modal expandable stays inside the phone preview frame', async ({ page }) => {
  await openViewerWithModalExpandable(page);
  await page.getByRole('button', { name: 'Phone 390' }).click();
  await page.locator('#readerDocument').getByText('Fake stub text').click();
  await expect(page.getByRole('dialog')).toBeVisible();

  const frame = (await page.locator('.viewer-shell').boundingBox())!;
  const root = (await page.locator('.expandable-modal-root').boundingBox())!;
  const panel = (await page.getByRole('dialog').boundingBox())!;

  expect(root).toEqual(frame);
  expect(panel.x).toBeGreaterThanOrEqual(frame.x);
  expect(panel.x + panel.width).toBeLessThanOrEqual(frame.x + frame.width);
});

test('the editor toggle writes the modal presentation and keeps editing inline', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:expandable {"id":"fake-record","expandableExpanded":false}-->
  <!--hvy:expandable:stub {}-->
   <!--hvy:text {"id":"fake-stub"}-->
    Fake stub text
  <!--hvy:expandable:content {}-->
   <!--hvy:text {"id":"fake-detail"}-->
    Fake hidden detail
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive', { has: page.locator('.expandable-reader') }).first().click();
  const activeBlock = page.locator('.editor-block', { has: page.locator('.expand-chooser-grid') }).first();

  await activeBlock.locator('[data-expandable-panel="expanded"]').first().click();
  await activeBlock.locator('[data-field="block-expandable-modal"]').check();

  await expect(activeBlock.locator('[data-field="block-expandable-modal"]')).toBeChecked();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await expect(page.locator('#rawEditor')).toContainText('"expandablePresentation":"modal"');
});

const embeddedEntries = [
  { entry: 'embed-full', mountName: 'mountHvy', mountOptions: { mode: 'viewer' } },
  { entry: 'embed', mountName: 'mountHvyViewer', mountOptions: {} },
] as const;

for (const { entry, mountName, mountOptions } of embeddedEntries) {
  test(`${mountName} opens and closes a modal expandable`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async ({ entry, mountName, mountOptions }) => {
      const embedModule = await import(`/src/${entry}.ts`);
      const { deserializeDocument } = await import('/src/serialization.ts');
      const doc = deserializeDocument(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:expandable {"id":"fake-record","expandablePresentation":"modal"}-->
  <!--hvy:expandable:stub {}-->
   <!--hvy:text {"id":"fake-stub"}-->
    Fake stub text
  <!--hvy:expandable:content {}-->
   <!--hvy:text {"id":"fake-detail"}-->
    Fake hidden detail
`, '.hvy');
      document.body.innerHTML = '<div id="fake-embed-root" style="height: 600px"></div>';
      embedModule[mountName]({ root: document.querySelector('#fake-embed-root'), document: doc, persistSessionState: false, ...mountOptions });
    }, { entry, mountName, mountOptions });

    await page.locator('#fake-embed-root').getByText('Fake stub text').click();
    await expect(page.getByRole('dialog')).toContainText('Fake hidden detail');

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.locator('#fake-embed-root').getByText('Fake stub text').click();
    await page.locator('.expandable-modal-close').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
}

async function openViewerWithSearchableModal(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:text {"id":"fake-link-source"}-->
  fakeneedle before. [Fake jump](#fake-detail)

 <!--hvy:expandable {"id":"fake-record","expandablePresentation":"modal"}-->
  <!--hvy:expandable:stub {}-->
   <!--hvy:text {"id":"fake-stub"}-->
    Fake stub text
  <!--hvy:expandable:content {}-->
   <!--hvy:text {"id":"fake-detail"}-->
    Fake hidden fakeneedle

 <!--hvy:text {"id":"fake-after"}-->
  fakeneedle after
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  await expect(page.locator('#readerDocument')).toContainText('Fake stub text');
}

async function searchFor(page: Page, query: string): Promise<void> {
  await page.locator('[data-action="open-search"]').click();
  await page.locator('[data-field="search-query"]').fill(query);
  await page.locator('[data-field="search-query"]').press('Enter');
  await expect(page.locator('[data-action="select-search-result"]').first()).toBeVisible();
  await page.locator('[data-action="select-search-result"]').first().click();
}

test('a link to content inside a modal expandable opens the modal', async ({ page }) => {
  await openViewerWithSearchableModal(page);

  await page.locator('#readerDocument').getByRole('link', { name: 'Fake jump' }).click();

  await expect(page.getByRole('dialog')).toContainText('Fake hidden fakeneedle');
  await expect(page.locator('#readerDocument')).not.toContainText('Fake hidden fakeneedle');
});

test('searching into a modal expandable opens it and searching past it closes it', async ({ page }) => {
  await openViewerWithSearchableModal(page);
  await searchFor(page, 'fakeneedle');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.locator('[data-action="next-search-result"]').click();
  await expect(page.getByRole('dialog').locator('.search-match-marker.is-current, .search-match-marker')).toHaveCount(1);
  await expect(page.locator('#readerDocument')).not.toContainText('Fake hidden fakeneedle');

  await page.locator('[data-action="next-search-result"]').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#readerDocument')).not.toContainText('Fake hidden fakeneedle');
});

test('a search match in the stub does not open the modal', async ({ page }) => {
  await openViewerWithSearchableModal(page);

  await searchFor(page, 'Fake stub');

  await expect(page.locator('#readerDocument').locator('.search-match-marker').first()).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
