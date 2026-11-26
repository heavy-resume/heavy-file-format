import { expect, test } from '@playwright/test';

for (const kind of ['component', 'section'] as const) {
  test(`saving a ${kind} template preserves document meta scroll`, async ({ page }) => {
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
      blocks: []
      children: []
---

#! Fake body
`);
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await page.getByRole('button', { name: 'Advanced', exact: true }).click();
    await page.getByRole('button', { name: 'Document Meta', exact: true }).click();

    const scroller = page.locator('.document-meta-scroll');
    const edit = page.locator(`[data-action="open-reusable-definition-editor"][data-template-kind="${kind}"]`);
    await edit.scrollIntoViewIfNeeded();
    const scrollTopBeforeEdit = await scroller.evaluate((element) => element.scrollTop);
    expect(scrollTopBeforeEdit).toBeGreaterThan(100);

    await edit.click();
    const modal = page.locator('.reusable-definition-modal');
    await modal.locator('[data-field="builder-definition-name"]').fill(`edited-${kind}`);
    await modal.getByRole('button', { name: 'Save Template', exact: true }).click();

    await expect(modal).toHaveCount(0);
    await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBe(scrollTopBeforeEdit);
  });
}

for (const kind of ['component', 'section'] as const) {
  test(`embedded ${kind} template draft and save emit dirty document change events to its host`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.goto('/');
    await page.evaluate(async () => {
      document.body.innerHTML = '<div id="editorMount"></div>';
      const { deserializeDocumentBytes, mountHvy } = await import('/src/embed-full.ts');
      const source = `---
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
      blocks: []
      children: []
---

#! Fake body
`;
      const events: Array<{ dirty: boolean; reason?: string }> = [];
      const mount = mountHvy({
        root: document.querySelector<HTMLElement>('#editorMount')!,
        document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
        mode: 'editor',
        showAdvancedEditor: true,
        onDocumentChange: (event) => events.push(event),
      });
      mount.openDocumentMeta();
      Object.assign(window, { testTemplateMount: mount, testTemplateChangeEvents: events });
    });

    await expect(page.locator('.document-meta-scroll')).toBeVisible();
    await page.locator(`[data-action="open-reusable-definition-editor"][data-template-kind="${kind}"]`).click();
    const modal = page.locator('.reusable-definition-modal');
    await expect(page.locator('#modalRoot')).toHaveAttribute('data-template-draft-history', 'true');
    await modal.locator('[data-field="builder-definition-name"]').fill(`edited-${kind}`);
    await expect.poll(() => page.evaluate(() => {
      const testWindow = window as unknown as {
        testTemplateMount: { isDirty(): boolean };
        testTemplateChangeEvents: Array<{ dirty: boolean; reason?: string }>;
      };
      return {
        dirty: testWindow.testTemplateMount.isDirty(),
        event: testWindow.testTemplateChangeEvents.at(-1),
      };
    })).toEqual({
      dirty: true,
      event: expect.objectContaining({ dirty: true, reason: 'template:draft' }),
    });
    await modal.getByRole('button', { name: 'Save Template', exact: true }).click();

    await expect.poll(() => page.evaluate(() => {
      const testWindow = window as unknown as {
        testTemplateMount: { isDirty(): boolean };
        testTemplateChangeEvents: Array<{ dirty: boolean; reason?: string }>;
      };
      return {
        dirty: testWindow.testTemplateMount.isDirty(),
        event: testWindow.testTemplateChangeEvents.at(-1),
      };
    })).toEqual({
      dirty: true,
      event: expect.objectContaining({ dirty: true, reason: 'template:save' }),
    });
  });
}

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
    const draftName = modal.locator('[data-field="builder-definition-name"]');
    await draftName.fill('fake-canceled');
    await expect(status).toHaveText('Unsaved');
    await draftName.press('ControlOrMeta+z');
    await expect(draftName).toHaveValue(kind === 'component' ? 'fake-card' : 'fake-section');
    await expect(status).toHaveText('Saved');
    await draftName.fill('fake-canceled');
    await expect(status).toHaveText('Unsaved');
    await modal.locator('.modal-head .remove-x').click();
    await page.getByRole('dialog', { name: 'Discard changes?' }).getByRole('button', { name: 'Keep editing' }).click();
    await expect(modal.locator('[data-field="builder-definition-name"]')).toHaveValue('fake-canceled');
    await expect(status).toHaveText('Unsaved');
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
