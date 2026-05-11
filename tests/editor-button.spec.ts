import { expect, test } from '@playwright/test';

test('editor-only generate button applies pronunciation and stays out of viewer', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    const payload = route.request().postDataJSON() as { context?: string };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: payload.context?.includes('Avery Hart') ? 'AY-vuh-ree HART' : 'UNKNOWN',
      }),
    });
  });

  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();

  const raw = page.locator('#rawEditor');
  await raw.fill((await raw.inputValue()).replace('# <!-- value -->', '# Avery Hart'));
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const generateButton = page.locator('[data-action="run-button-ai-generate"]');
  await expect(generateButton).toBeVisible({ timeout: 10000 });
  const anchor = page.locator('[data-component-id="resume-pronunciation"][data-hvy-button-anchor="true"]').first();
  await expect(anchor).toHaveCSS('position', 'relative');
  await expect(generateButton.locator('xpath=ancestor::*[contains(@class, "hvy-button-overlay-layer")]')).toHaveCount(1);

  await generateButton.click();

  await expect(page.locator('#editorTree')).toContainText('[AY-vuh-ree HART]');
  await expect(generateButton).toBeHidden({ timeout: 10000 });

  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('[data-action="run-button-ai-generate"]')).toHaveCount(0);
  await expect(page.locator('#readerDocument')).toContainText('[AY-vuh-ree HART]');
});

test('generated pronunciation can be converted back into a clean fill-in', async ({ page }) => {
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output: 'AY-vuh-ree HART' }),
    });
  });

  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();

  const raw = page.locator('#rawEditor');
  await raw.fill((await raw.inputValue()).replace('# <!-- value -->', '# Avery Hart'));
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('[data-action="run-button-ai-generate"]').click();
  await expect(page.locator('#editorTree')).toContainText('[AY-vuh-ree HART]');

  await page.locator('[data-component-id="resume-pronunciation"]').first().click();
  await expect(page.locator('.rich-editor[data-field="block-rich"]')).toBeVisible();
  await page.locator('.rich-editor[data-field="block-rich"]').evaluate((editable) => {
    editable.innerHTML = '<p>[FILL ME IN]</p>';
    editable.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT).nextNode();
    if (!textNode?.textContent) return;
    const start = textNode.textContent.indexOf('FILL ME IN');
    const range = document.createRange();
    range.setStart(textNode, start);
    range.setEnd(textNode, start + 'FILL ME IN'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.locator('.rich-editor[data-field="block-rich"]').dispatchEvent('keyup');
  await page.getByRole('button', { name: 'Convert to Fill-in' }).click();

  await expect(page.locator('[data-field="text-fill-in-value"]')).toHaveAttribute('data-placeholder', 'FILL ME IN');
  await expect(page.locator('.text-fill-in-editor')).toHaveText('[]');
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('\\[<!-- value -->\\]');
  await expect(page.locator('#rawEditor')).toContainText('"placeholder":"FILL ME IN"');
  await expect(page.locator('#rawEditor')).not.toContainText('"placeholder":"pronunciation"');
});
