import { expect, test } from '@playwright/test';

for (const { template, advanced } of [
  { template: 'history-record', advanced: false },
  { template: 'history-linear-record', advanced: false },
  { template: 'history-record', advanced: true },
  { template: 'history-linear-record', advanced: true },
]) {
  test(`${template} heading undo/redo in ${advanced ? 'Advanced' : 'Basic'} mode`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.goto('/');
    await page.getByText('Documents', { exact: true }).click();
    await page.locator('#resumeTemplateBtn').click();
    if (advanced) await page.getByRole('button', { name: 'Advanced', exact: true }).click();
    await page.getByRole('button', { name: 'Document Meta', exact: true }).click();
    await page.locator('.template-def-row').filter({
      has: page.getByText(template, { exact: true }),
    }).getByRole('button', { name: 'Edit Template', exact: true }).click();
    const modal = page.locator('.reusable-definition-modal');
    await modal.locator('.editor-block-passive').first().click();
    await modal.locator('[data-action="toggle-expandable-editor-panel"][data-expandable-panel="expanded"]').first().click();
    await modal.getByText('Accomplishments', { exact: true }).click();
    const editor = modal.locator('.rich-editor[data-field="block-rich"]');
    await expect.poll(() => page.evaluate(async () =>
      (await import('/src/state.ts')).state.pendingEditorActivation
    )).toBeNull();
    await expect(editor).toHaveText('Accomplishments', { useInnerText: true });
    await editor.press('ControlOrMeta+End');
    await editor.pressSequentially('!!!', { delay: 100 });
    await expect(editor).toHaveText('Accomplishments!!!', { useInnerText: true });
    await editor.press('Meta+z');
    await expect(editor).toHaveText('Accomplishments', { useInnerText: true });
    await expect(editor).toBeFocused();
    await editor.press('Meta+Shift+z');
    await expect(editor).toHaveText('Accomplishments!!!', { useInnerText: true });
  });
}
