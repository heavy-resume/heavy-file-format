import { expect, test } from '@playwright/test';

for (const field of ['block-placeholder', 'block-description', 'block-custom-css']) {
  test(`resume metadata ${field} preserves focus and caret while typing`, async ({ page }) => {
    test.setTimeout(5_000);
    await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
    await page.goto('/');
    await page.locator('.document-menu').evaluate((menu) => { (menu as HTMLDetailsElement).open = true; });
    await page.getByRole('button', { name: 'Resume Example', exact: true }).click();
    await page.getByRole('button', { name: 'Advanced', exact: true }).click();
    await page.locator('.editor-block-passive:visible').first().click();
    await page.getByLabel('Component options').getByRole('button', { name: 'Meta', exact: true }).click();
    const input = page.locator(`[data-field="${field}"]`);
    await input.fill('');
    const originalInput = await input.elementHandle();

    await input.pressSequentially('Fake value', { delay: 35 });

    await expect(input).toHaveValue('Fake value');
    await expect(input).toBeFocused();
    expect(await originalInput!.evaluate((node) => node.isConnected)).toBe(true);
    await input.evaluate((node: HTMLInputElement | HTMLTextAreaElement) => node.setSelectionRange(5, 5));
    await page.keyboard.type('new ');
    await expect(input).toHaveValue('Fake new value');
    expect(await input.evaluate((node: HTMLInputElement | HTMLTextAreaElement) => node.selectionStart)).toBe(9);
    await page.locator('.component-meta-modal').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Component options').getByRole('button', { name: 'Meta', exact: true }).click();
    await expect(input).toHaveValue('Fake new value');
  });
}

test('empty text placeholder does not displace the insertion line', async ({ page }) => {
  test.setTimeout(5_000);
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---
<!--hvy: {"id":"fake-section"}-->
#! Fake section

<!--hvy:text {"id":"fake-text","placeholder":"Fake placeholder"}-->
`);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.locator('.editor-block-passive').click();
  const editor = page.locator('.rich-editor[data-field="block-rich"]');

  for (const html of ['', '<br>', '<p></p>', '<p><br></p>']) {
    expect(await editor.evaluate((node, emptyHtml) => {
      node.innerHTML = emptyHtml;
      const range = document.createRange();
      range.selectNodeContents(node);
      const withPlaceholder = [...range.getClientRects()].map((rect) => [rect.x, rect.y, rect.height]);
      const placeholderContent = getComputedStyle(node, '::before').content;
      node.removeAttribute('data-placeholder');
      const withoutPlaceholder = [...range.getClientRects()].map((rect) => [rect.x, rect.y, rect.height]);
      node.setAttribute('data-placeholder', 'Fake placeholder');
      return { placeholderContent, sameInsertionLine: JSON.stringify(withPlaceholder) === JSON.stringify(withoutPlaceholder) };
    }, html)).toEqual({ placeholderContent: '"Fake placeholder"', sameInsertionLine: true });
  }

  await editor.click();
  await page.keyboard.type('Fake text');
  await expect(editor).toHaveText('Fake text');
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((node) => getComputedStyle(node, '::before').content)).toBe('none');
});
