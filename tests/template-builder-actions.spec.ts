import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: fake-card
    baseType: text
    template:
      id: fake-root
      text: "${Array.from({ length: 12 }, (_, index) => `{% fake-value-${index} | text %}`).join(' ')}"
      schema:
        component: text
---

#! Fake body
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
});

for (const action of ['X', 'Cancel', 'Save Template']) {
  test(`${action} works on the first click after renaming a template value`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.getByRole('button', { name: 'Document Meta', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Template', exact: true }).click();
    const modal = page.locator('.reusable-definition-modal');
    const name = modal.locator('[data-field="builder-template-variable-name"]').first();
    await name.fill('fake-renamed');
    await expect(name).toBeFocused();
    await (action === 'X'
      ? modal.locator('.modal-head .remove-x')
      : modal.getByRole('button', { name: action, exact: true })).click();
    if (action === 'X') {
      const confirmation = page.getByRole('dialog', { name: 'Discard changes?' });
      await expect(confirmation).toBeVisible();
      await confirmation.getByRole('button', { name: 'Keep editing' }).click();
      await expect(name).toHaveValue('fake-renamed');
      await modal.locator('.modal-head .remove-x').click();
      await confirmation.getByRole('button', { name: 'Discard', exact: true }).click();
    }
    await expect(modal).toHaveCount(0);
    const template = await page.evaluate(async () => {
      const { state } = await import('/src/state.ts');
      return JSON.stringify(state.document.meta.component_defs);
    });
    if (action === 'Save Template') {
      expect(template).toContain('fake-renamed');
      expect(template).not.toContain('fake-value-0 |');
    } else {
      expect(template).not.toContain('fake-renamed');
      expect(template).toContain('fake-value-0 |');
    }
  });
}

test('X closes unchanged templates directly, including a reverted edit', async ({ page }) => {
  test.setTimeout(5_000);
  await page.getByRole('button', { name: 'Document Meta', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Template', exact: true }).click();
  const modal = page.locator('.reusable-definition-modal');
  await modal.locator('.modal-head .remove-x').click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Edit Template', exact: true }).click();
  await modal.locator('[data-field="builder-definition-name"]').fill('fake-renamed');
  await modal.locator('[data-field="builder-definition-name"]').fill('fake-card');
  await modal.locator('.modal-head .remove-x').click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toHaveCount(0);
});

for (const kind of ['Component', 'Section']) {
  test(`new ${kind.toLowerCase()} template X prompts only after editing`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.getByRole('button', { name: 'Document Meta', exact: true }).click();
    await page.getByRole('button', { name: `New ${kind} Template`, exact: true }).click();
    const modal = page.locator('.reusable-definition-modal');
    await modal.locator('.modal-head .remove-x').click();
    await expect(modal).toHaveCount(0);
    await page.getByRole('button', { name: `New ${kind} Template`, exact: true }).click();
    await modal.locator('[data-field="builder-definition-name"]').fill('fake-new-name');
    await modal.locator('.modal-head .remove-x').click();
    const confirmation = page.getByRole('dialog', { name: 'Discard changes?' });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Keep editing' }).press('Escape');
    await expect(confirmation).toHaveCount(0);
    await expect(modal.locator('[data-field="builder-definition-name"]')).toHaveValue('fake-new-name');
    await modal.locator('.modal-head .remove-x').click();
    await confirmation.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.locator('.template-def-row', { hasText: 'fake-new-name' })).toHaveCount(0);
  });
}

for (const preview of ['Full', '390px window']) {
  test(`template actions stay centered and visible while scrolling in ${preview}`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.getByRole('button', { name: 'Document Meta', exact: true }).click();
    await page.getByRole('button', { name: 'Edit Template', exact: true }).click();
    if (preview !== 'Full') {
      await page.setViewportSize({ width: 390, height: 844 });
    }
    const modal = page.locator('.reusable-definition-modal');
    const bounds = await modal.boundingBox();
    const cancel = await modal.getByRole('button', { name: 'Cancel', exact: true }).boundingBox();
    const save = await modal.getByRole('button', { name: 'Save Template', exact: true }).boundingBox();
    expect(bounds).not.toBeNull();
    expect(cancel).not.toBeNull();
    expect(save).not.toBeNull();
    expect(cancel!.y).toBeGreaterThan(bounds!.y);
    expect(save!.y + save!.height).toBeLessThan(bounds!.y + bounds!.height);
    expect(Math.abs((cancel!.x + save!.x + save!.width) / 2 - (bounds!.x + bounds!.width / 2))).toBeLessThan(2);
    expect(await modal.locator('.reusable-definition-scroll-body').evaluate(body => {
      body.scrollTop = body.scrollHeight;
      return body.scrollTop;
    })).toBeGreaterThan(0);
    expect(await modal.getByRole('button', { name: 'Cancel', exact: true }).boundingBox()).toEqual(cancel);
    expect(await modal.getByRole('button', { name: 'Save Template', exact: true }).boundingBox()).toEqual(save);
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(modal).toHaveCount(0);
  });
}
