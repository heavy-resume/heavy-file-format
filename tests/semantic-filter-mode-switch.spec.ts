import { expect, test } from '@playwright/test';

test('switching away from semantic filtering does not submit the prompt', async ({ page }) => {
  await page.goto('/');
  await page.setContent('<div id="root" style="height: 720px"></div>');
  await page.evaluate(async () => {
    const modulePath = '/src/embed-full.ts';
    const { deserializeDocumentBytes, mountHvy } = await import(/* @vite-ignore */ modulePath);
    const source = `---
hvy_version: 0.1
---

<!--hvy: {"id":"summary"}-->
#! Summary

 The document has visible content.
`;
    mountHvy({
      root: document.querySelector('#root') as HTMLElement,
      document: deserializeDocumentBytes(new TextEncoder().encode(source), '.hvy'),
      mode: 'viewer',
    });
  });

  await page.locator('.search-launcher').click();
  await page.getByRole('tab', { name: /Filter/ }).click();
  await page.getByRole('button', { name: 'Semantic' }).click();
  await page.locator('[data-field="search-query"]').fill('content that is not present');

  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Semantic' }).click();
  await page.waitForTimeout(200);

  await expect(page.getByRole('button', { name: 'Filter', exact: true })).toBeEnabled();
  await expect(page.locator('.search-status')).toHaveCount(0);
});
