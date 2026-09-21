import { expect, test } from '@playwright/test';

for (const choice of ['ignore', 'delete', 'escape'] as const) {
  test(`attachment review ${choice} completes without opening document meta`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 670 });
    await page.goto('/');
    await page.evaluate(async () => {
      const { mountHvy, deserializeDocumentBytes } = await import('/src/embed.ts');
      document.body.innerHTML = '<div id="reviewMount"></div>';
      const mount = mountHvy({
        root: document.querySelector<HTMLElement>('#reviewMount')!,
        document: deserializeDocumentBytes(new TextEncoder().encode('---\nhvy_version: 0.1\n---\n\n<!--hvy: {"id":"fake-section"}-->\n#! Fake section\n'), '.hvy'),
        mode: 'editor',
        attachmentStore: {
          list: () => [{ id: 'image:fake-unused.png', meta: { mediaType: 'image/png' }, length: 1 }],
          recall: () => new Uint8Array([1]),
          store: () => {},
          remove: async () => {},
        },
      });
      await mount.setMode('editor');
      (window as any).reviewMount = mount;
      (window as any).reviewFinished = false;
      void mount.reviewUnusedEmbeddedFiles().then(() => { (window as any).reviewFinished = true; });
    });
    const modal = page.getByRole('dialog', { name: 'Remove unused files?' });
    await expect(modal).toBeVisible();
    await expect(page.locator('.document-meta-pane')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).reviewFinished)).toBe(false);
    if (choice === 'escape') await modal.getByRole('button', { name: 'Ignore and save', exact: true }).press('Escape');
    else await modal.getByRole('button', { name: choice === 'ignore' ? 'Ignore and save' : 'Delete 1 file', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as any).reviewFinished)).toBe(true);
    await expect(modal).toHaveCount(0);
    await expect(page.locator('.document-meta-pane')).toHaveCount(0);
    expect(await page.evaluate(() => (window as any).reviewMount.getDocument().attachments.length)).toBe(choice === 'delete' ? 0 : 1);
  });
}
