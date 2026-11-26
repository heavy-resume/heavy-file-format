import { expect, test } from '@playwright/test';

test('conditional plugin code does not load until the file is allowed', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="conditionalPluginMount"></div>';
    const embedPath = '/src/embed.ts';
    const conditionalPath = '/src/plugins/authorization/conditional-plugin.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ embedPath);
    const { createConditionallyAllowedPlugin } = await import(/* @vite-ignore */ conditionalPath);
    const source = `---
hvy_version: 1.0
plugins:
  - id: example.conditional
    uuid: conditional-primary
---

<!--hvy: {"id":"demo"}-->
#! Demo

<!--hvy:plugin {"id":"conditional-block","plugin":"example.conditional"}-->
`;
    const root = document.querySelector<HTMLElement>('#conditionalPluginMount');
    if (!root) throw new Error('Mount root missing.');
    (window as Window & { __conditionalLoads?: number }).__conditionalLoads = 0;
    mountHvy({
      root,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'viewer',
      plugins: [createConditionallyAllowedPlugin({
        id: 'example.conditional',
        uuid: 'conditional-primary',
        version: '1.0.0',
        hvyApiVersion: '0.1',
        displayName: 'Conditional Example',
        load: async () => {
          (window as Window & { __conditionalLoads?: number }).__conditionalLoads! += 1;
          return {
            id: 'example.conditional',
            uuid: 'conditional-primary',
            version: '1.0.0',
            hvyApiVersion: '0.1',
            displayName: 'Conditional Example',
            create: () => {
              const element = document.createElement('div');
              element.textContent = 'Conditional plugin loaded.';
              return { element };
            },
          };
        },
      })],
    });
  });

  await expect(page.getByText('Conditional Example needs your approval')).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __conditionalLoads?: number }).__conditionalLoads)).toBe(0);

  await page.getByRole('button', { name: 'Allow Conditional Example' }).click();
  await expect(page.getByText('Conditional plugin loaded.')).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __conditionalLoads?: number }).__conditionalLoads)).toBe(1);
});

async function mountHostHiddenPlugin(
  page: import('@playwright/test').Page,
  options: { mode: 'viewer' | 'editor'; showAdvancedEditor: boolean }
): Promise<void> {
  await page.goto('/');
  await page.evaluate(async (mountOptions) => {
    document.body.innerHTML = '<div id="hostHiddenPluginMount"></div>';
    const embedPath = '/src/embed.ts';
    const conditionalPath = '/src/plugins/authorization/conditional-plugin.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ embedPath);
    const { createConditionallyAllowedPlugin } = await import(/* @vite-ignore */ conditionalPath);
    const source = `---
hvy_version: 1.0
plugins:
  - id: example.conditional
    uuid: conditional-primary
---

<!--hvy: {"id":"demo"}-->
#! Demo

<!--hvy:text {"id":"visible-text"}-->
Text beside the plugin.

<!--hvy:plugin {"id":"conditional-block","plugin":"example.conditional"}-->
`;
    const root = document.querySelector<HTMLElement>('#hostHiddenPluginMount');
    if (!root) throw new Error('Mount root missing.');
    mountHvy({
      root,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: mountOptions.mode,
      showAdvancedEditor: mountOptions.showAdvancedEditor,
      pluginAuthorization: 'hidden',
      plugins: [createConditionallyAllowedPlugin({
        id: 'example.conditional',
        uuid: 'conditional-primary',
        version: '1.0.0',
        hvyApiVersion: '0.1',
        displayName: 'Conditional Example',
        load: async () => { throw new Error('Host-hidden plugin must not load.'); },
      })],
    });
  }, options);
  await expect(page.getByText('Text beside the plugin.')).toBeVisible();
}

test('host-hidden plugin renders nothing in the viewer', async ({ page }) => {
  await mountHostHiddenPlugin(page, { mode: 'viewer', showAdvancedEditor: false });

  await expect(page.locator('.hvy-plugin-mount[data-plugin-id="example.conditional"]')).toHaveCount(0);
});

test('host-hidden plugin is hidden in the regular editor', async ({ page }) => {
  await mountHostHiddenPlugin(page, { mode: 'editor', showAdvancedEditor: false });

  await expect(page.locator('.hvy-plugin-mount[data-plugin-id="example.conditional"]')).toHaveCount(0);
});

test('host-hidden plugin shows an unavailable placeholder in the advanced editor', async ({ page }) => {
  await mountHostHiddenPlugin(page, { mode: 'editor', showAdvancedEditor: true });

  await expect(page.getByText("Conditional Example isn't available in this app.")).toBeVisible();
});
