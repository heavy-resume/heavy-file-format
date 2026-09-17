import { expect, test } from '@playwright/test';

for (const kind of ['component', 'section'] as const) {
  test(`${kind} template opening and unchanged save stay saved; edits support cancel and undo`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.goto('/');
    await page.getByRole('button', { name: 'Raw', exact: true }).click();
    await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
component_defs:
  - name: fake-card
    baseType: text
    template:
      id: fake-card-root
      text: Fake text
      schema:
        component: text
section_defs:
  - name: fake-section
    template:
      key: fake-section-root
      title: Fake section
      level: 1
      blocks: []
      children: []
---

#! Fake body
`);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.getByRole('button', { name: 'Advanced', exact: true }).click();
    await page.getByRole('button', { name: 'Document Meta', exact: true }).click();
    await page.evaluate(async () => {
      const { resetReferenceDocumentDirtyBaseline } = await import('/src/reference-document-dirty.ts');
      resetReferenceDocumentDirtyBaseline();
    });
    const snapshot = () => page.evaluate(async () => {
      const { state } = await import('/src/state.ts');
      const { serializeDocument } = await import('/src/serialization.ts');
      return serializeDocument(state.document);
    });
    const before = await snapshot();
    const status = page.locator('[data-reference-save-state]');
    const edit = page.locator(`[data-action="open-reusable-definition-editor"][data-template-kind="${kind}"]`);
    const modal = page.locator('.reusable-definition-modal');

    await expect(status).toHaveText('Saved');
    await edit.click();
    await expect(status).toHaveText('Saved');
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(status).toHaveText('Saved');
    expect(await snapshot()).toBe(before);

    await edit.click();
    await modal.getByRole('button', { name: 'Save Template', exact: true }).click();
    await expect(status).toHaveText('Saved');
    expect(await snapshot()).toBe(before);

    await edit.click();
    await modal.locator('[data-field="builder-definition-name"]').fill('fake-canceled');
    await modal.locator('.modal-head .remove-x').click();
    await page.getByRole('dialog', { name: 'Discard changes?' }).getByRole('button', { name: 'Keep editing' }).click();
    await expect(modal.locator('[data-field="builder-definition-name"]')).toHaveValue('fake-canceled');
    await modal.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(status).toHaveText('Saved');
    expect(await snapshot()).toBe(before);

    await edit.click();
    await modal.locator('[data-field="builder-definition-name"]').fill('fake-edited');
    await modal.getByRole('button', { name: 'Save Template', exact: true }).click();
    await expect(status).toHaveText('Unsaved');
    expect(await snapshot()).toContain('fake-edited');
    await page.evaluate(async () => (await import('/src/history.ts')).undoState());
    await expect(status).toHaveText('Saved');
    expect(await snapshot()).toBe(before);
  });
}
