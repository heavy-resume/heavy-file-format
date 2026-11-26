import { expect, test } from '@playwright/test';

const formDocument = `---
hvy_version: 0.1
plugins:
  - id: hvy.form
---

<!--hvy: {"id":"fake-form-section"}-->
#! Fake form

<!--hvy:plugin {"id":"fake-form","plugin":"hvy.form","pluginConfig":{"version":"0.1","submitLabel":"Fake submit","submitScript":"submit","submitDisabled":true,"submitDisabledReason":"Fake reason: fill in Fake field first"}}-->
fields:
  - label: Fake field
    type: text
    triggers:
      input: toggle
scripts:
  toggle: |
    if doc.form.get_value("Fake field"):
        doc.form.set_submit_disabled(False)
    else:
        doc.form.set_submit_disabled(True, "Fake reason: still empty")
  submit: |
    doc.header.set("fake_submits", (doc.header.get("fake_submits") or 0) + 1)
`;

async function readSubmits(page: import('@playwright/test').Page): Promise<unknown> {
  return page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.meta.fake_submits ?? null;
  });
}

async function resolveThemeColor(page: import('@playwright/test').Page, variable: string): Promise<string> {
  return page.evaluate((name) => {
    const probe = document.createElement('div');
    probe.style.color = `var(${name})`;
    document.querySelector('.hvy-document')!.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  }, variable);
}

test('disabled submit shows its reason, blocks submit, and scripts can toggle it', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(formDocument);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  const form = page.locator('.hvy-form-plugin').first();
  const submit = form.getByRole('button', { name: 'Fake submit' });

  await expect(submit).toBeDisabled();
  await expect(submit).toHaveCSS('cursor', 'not-allowed');
  await expect(submit).toHaveCSS('background-color', await resolveThemeColor(page, '--hvy-button-disabled-bg'));
  await expect(submit).toHaveCSS('color', await resolveThemeColor(page, '--hvy-button-disabled-text'));
  await expect(form.locator('.hvy-form-submit-reason')).toHaveText('Fake reason: fill in Fake field first');
  await expect(submit).toHaveAccessibleDescription('Fake reason: fill in Fake field first');

  await form.getByLabel('Fake field').press('Enter');
  expect(await readSubmits(page)).toBeNull();

  await form.getByLabel('Fake field').pressSequentially('abc');

  await expect(submit).toBeEnabled();
  await expect(submit).toHaveCSS('cursor', 'pointer');
  await expect(submit).toHaveCSS('background-color', await resolveThemeColor(page, '--hvy-button-bg'));
  await expect(form.locator('.hvy-form-submit-reason')).toHaveCount(0);
  await expect(form.getByLabel('Fake field')).toBeFocused();
  await expect(form.getByLabel('Fake field')).toHaveValue('abc');

  await submit.click();
  await expect.poll(() => readSubmits(page)).toBe(1);

  await form.getByLabel('Fake field').fill('');

  await expect(submit).toBeDisabled();
  await expect(form.locator('.hvy-form-submit-reason')).toHaveText('Fake reason: still empty');
});
