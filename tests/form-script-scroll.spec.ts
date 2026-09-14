import { expect, test } from '@playwright/test';

for (const view of ['Viewer', 'AI']) {
  test(`form script preserves ${view} scroll after a document mutation`, async ({ page }) => {
    test.setTimeout(5000);
    await page.goto('/');
    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
plugins:
  - id: hvy.form
---

<!--hvy: {"id":"fake-form-section"}-->
#! Fake form

<!--hvy:plugin {"id":"fake-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitScript":"submit","submitLabel":"Run fake script"}}-->
fields:
${Array.from({ length: 24 }, (_, index) => `  - label: Fake field ${index}\n    type: text`).join('\n')}
scripts:
  submit: |
    doc.header.set("fake_result", "done")
`);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.getByRole('button', { name: view, exact: true }).click();
    const submit = page.getByRole('button', { name: 'Run fake script', exact: true });
    await submit.scrollIntoViewIfNeeded();
    const before = await page.locator('.reader-document').evaluate((element) => element.scrollTop);
    expect(before).toBeGreaterThan(500);

    await submit.click();

    await expect.poll(() => page.evaluate(async () => {
      const { state } = await import('/src/state.ts');
      return state.document.meta.fake_result;
    })).toBe('done');
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await page.locator('.reader-document').evaluate((element) => element.scrollTop)).toBeCloseTo(before, 0);
  });
}
