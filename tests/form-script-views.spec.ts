import { expect, test } from '@playwright/test';

const formDocument = `---
hvy_version: 0.1
plugins:
  - id: hvy.form
---

<!--hvy: {"id":"fake-form-section"}-->
#! Fake form

<!--hvy:plugin {"id":"fake-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","initialScript":"init","submitLabel":"Fake submit"}}-->
fields:
  - label: Fake field
    type: text
scripts:
  init: |
    doc.header.set("fake_init_runs", (doc.header.get("fake_init_runs") or 0) + 1)
`;

async function readInitRuns(page: import('@playwright/test').Page): Promise<unknown> {
  return page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.meta.fake_init_runs ?? null;
  });
}

test('form initialScript skips the editor and runs once on first viewer or AI display', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(formDocument);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();
  await expect(page.locator('.hvy-form-plugin').first()).toBeAttached();

  expect(await readInitRuns(page)).toBeNull();

  await page.getByRole('button', { name: 'Viewer', exact: true }).click();

  await expect.poll(() => readInitRuns(page)).toBe(1);

  await page.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(page.locator('#aiReaderDocument .hvy-form-plugin').first()).toBeAttached();

  expect(await readInitRuns(page)).toBe(1);
});
