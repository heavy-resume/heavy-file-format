import { expect, test } from '@playwright/test';

const formDocument = `---
hvy_version: 0.1
plugins:
  - id: hvy.form
---

<!--hvy: {"id":"fake-run-notice-section"}-->
#! Fake run notice

<!--hvy:plugin {"id":"fake-run-notice-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitLabel":"Fake submit","submitScript":"submit"}}-->
fields:
  - label: Fake loop count
    type: text
scripts:
  submit: |
    total = 0
    for index in range(int(doc.form.get_value("Fake loop count") or "0")):
        total += index
    doc.header.set("fake_runs", (doc.header.get("fake_runs") or 0) + 1)
`;

async function readRuns(page: import('@playwright/test').Page): Promise<unknown> {
  return page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.meta.fake_runs ?? null;
  });
}

test('script run notice stays hidden for cheap runs and floats over the form for expensive runs', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(formDocument);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  const form = page.locator('.hvy-form-plugin').first();
  const formHeightBefore = (await form.boundingBox())!.height;

  await form.getByRole('button', { name: 'Fake submit' }).click();
  await expect.poll(() => readRuns(page)).toBe(1);

  await expect(form.locator('.hvy-form-status')).toHaveCount(0);
  await expect(form.locator('.hvy-form-run-notice')).toHaveCount(0);

  await form.getByLabel('Fake loop count').fill('2000');
  await form.getByRole('button', { name: 'Fake submit' }).click();
  await expect.poll(() => readRuns(page)).toBe(2);

  const notice = form.locator('.hvy-form-run-notice');
  await expect(notice).toContainText('Script ran');
  await expect(notice).toHaveCSS('position', 'absolute');
  await expect(notice).toHaveCSS('animation-name', 'hvy-form-run-notice-fade');
  await expect(form.locator('.hvy-form-status')).toHaveCount(0);
  expect((await form.boundingBox())!.height).toBe(formHeightBefore);
});
