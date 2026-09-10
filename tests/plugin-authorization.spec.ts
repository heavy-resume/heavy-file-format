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

  await expect(page.getByText('Conditional Example is blocked')).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __conditionalLoads?: number }).__conditionalLoads)).toBe(0);

  await page.getByRole('button', { name: 'Allow Conditional Example' }).click();
  await expect(page.getByText('Conditional plugin loaded.')).toBeVisible();
  expect(await page.evaluate(() => (window as Window & { __conditionalLoads?: number }).__conditionalLoads)).toBe(1);
});
