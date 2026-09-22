import { expect, test } from '@playwright/test';

test('viewport plugin activates when its detached host is attached later', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.evaluate(async () => {
    const { createPluginMount } = await import('/src/plugins/viewport-plugin-mount.ts');
    const host = document.createElement('div');
    host.className = 'reader-document';
    host.style.cssText = 'height: 300px; overflow: auto;';
    const instance = createPluginMount(() => {
      const element = document.createElement('div');
      element.textContent = 'Fake plugin mounted';
      return { element };
    });
    host.append(instance.element);
    // Embedded hosts may finish mounting before attaching their root.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    document.body.replaceChildren(host);
  });
  await expect(page.getByText('Fake plugin mounted', { exact: true })).toBeVisible({ timeout: 1000 });
  await expect(page.locator('.hvy-plugin-viewport-placeholder')).toHaveCount(0);
});

for (const scrollerClass of ['reader-document', 'editor-tree', 'viewer-sidebar-panel']) {
  test(`plugins preload near the ${scrollerClass} viewport while distant plugins stay deferred`, async ({ page }) => {
    test.setTimeout(5000);
    await page.goto('/');
    await page.evaluate(async (className) => {
      const { createPluginMount } = await import('/src/plugins/viewport-plugin-mount.ts');
      document.body.innerHTML = `<div class="${className}" style="height: 300px; overflow: auto;">
        <div style="height: 800px;"></div><div id="near-plugin"></div>
        <div style="height: 1200px;"></div><div id="far-plugin"></div>
      </div>`;
      for (const id of ['near-plugin', 'far-plugin']) {
        const instance = createPluginMount(() => {
          const element = document.createElement('div');
          element.textContent = `Mounted ${id}`;
          return { element };
        });
        document.getElementById(id)!.replaceWith(instance.element);
      }
    }, scrollerClass);

    await expect(page.getByText('Mounted near-plugin', { exact: true })).toHaveCount(1);
    await expect(page.getByText('Mounted far-plugin', { exact: true })).toHaveCount(0);
    await page.locator(`.${scrollerClass}`).evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(page.getByText('Mounted far-plugin', { exact: true })).toBeVisible();
  });
}
