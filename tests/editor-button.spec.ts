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

  await expect(page.locator('[data-component-id="resume-pronunciation"]').first()).toBeHidden({ timeout: 1_000 });
  await expect(page.locator('[data-action="run-button-ai-generate"]')).toBeHidden();

  await page.getByRole('button', { name: 'Raw' }).click();

  const raw = page.locator('#rawEditor');
  await raw.fill((await raw.inputValue()).replace('# <!-- value {"placeholder":"Name"} -->', '# Avery Hart'));
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  const generateButton = page.locator('[data-action="run-button-ai-generate"]');
  await expect(generateButton).toBeVisible({ timeout: 1_000 });

  await generateButton.click();
  await expect(page.locator('#editorTree')).toContainText('[AY-vuh-ree HART]');
  await expect(generateButton).toBeHidden({ timeout: 1_000 });

  await page.getByRole('button', { name: 'Viewer' }).click();
  await expect(page.locator('[data-action="run-button-ai-generate"]')).toHaveCount(0);
  await expect(page.locator('#readerDocument')).toContainText('[AY-vuh-ree HART]');
});

test('generate button runs on the first click after completing a fill-in', async ({ page }) => {
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

  await page.locator('.editor-block-passive .editor-block-content[data-component-id="resume-name"] .text-fill-in-box').click();
  const nameFillIn = page.locator('.editor-block:has(.editor-block-content[data-component-id="resume-name"]) [data-field="text-fill-in-value"]');
  await nameFillIn.fill('Avery Hart');

  const generateButton = page.locator('[data-action="run-button-ai-generate"]');
  await expect(generateButton).toBeVisible({ timeout: 1_000 });
  await generateButton.click();

  await expect(page.locator('#editorTree')).toContainText('[AY-vuh-ree HART]');
});

test('generate button shows disabled busy state while pronunciation is generating', async ({ page }) => {
  let releaseGeneration: (() => void) | null = null;
  await page.route('**/api/chat', async (route) => {
    await new Promise<void>((resolve) => {
      releaseGeneration = resolve;
    });
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

  await page.locator('.editor-block-passive .editor-block-content[data-component-id="resume-name"] .text-fill-in-box').click();
  await page.locator('.editor-block:has(.editor-block-content[data-component-id="resume-name"]) [data-field="text-fill-in-value"]').fill('Avery Hart');

  const generateButton = page.locator('[data-action="run-button-ai-generate"]');
  await expect(generateButton).toBeVisible({ timeout: 1_000 });
  await generateButton.click();

  await expect(generateButton).toBeDisabled();
  await expect(generateButton).toHaveText('Generating...');
  await expect(generateButton).toHaveCSS('cursor', 'wait');
  const busyButtonHost = generateButton.locator('xpath=ancestor::*[@data-hvy-button="true"][1]');
  await expect(busyButtonHost).toHaveAttribute('data-busy-state', 'busy');
  await expect(busyButtonHost).toHaveAttribute('aria-busy', 'true');
  await expect(busyButtonHost).not.toHaveCSS('box-shadow', 'none');

  releaseGeneration?.();
  await expect(page.locator('#editorTree')).toContainText('[AY-vuh-ree HART]');
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
  await raw.fill((await raw.inputValue()).replace('# <!-- value {"placeholder":"Name"} -->', '# Avery Hart'));
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

  const pronunciationFillIn = page.locator('.editor-block:has(.editor-block-content[data-component-id="resume-pronunciation"]) [data-field="text-fill-in-value"]');
  await expect(pronunciationFillIn).toHaveAttribute('data-placeholder', 'FILL ME IN');
  await expect(page.locator('.editor-block:has(.editor-block-content[data-component-id="resume-pronunciation"]) .text-fill-in-editor')).toHaveText('[]');
  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('\\[<!-- value {"placeholder":"FILL ME IN"} -->\\]');
  await expect(page.locator('#rawEditor')).toContainText('"placeholder":"FILL ME IN"');
  await expect(page.locator('#rawEditor')).not.toContainText('"placeholder":"pronunciation"');
});

test('advanced editor exposes anchored button configuration as a component card', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Resume Template' }).click();
  await page.getByRole('button', { name: 'Advanced' }).click();

  const buttonCard = page.locator('.editor-block-passive', { hasText: 'Button: Generate anchored to resume-pronunciation' });
  await expect(buttonCard).toBeVisible();
  await buttonCard.click();

  const preview = page.locator('[aria-label="Button preview"]');
  const settings = page.locator('[aria-label="Button settings"]');
  await expect(preview).toBeVisible();
  await expect(page.locator('[aria-label="Button settings"]')).toBeVisible();
  await expect(page.locator('[data-field="block-button-position-target-id"]')).toHaveValue('resume-pronunciation');
  await expect(page.locator('[data-field="block-button-prompt"]')).toContainText('Generate a concise pronunciation guide');

  const previewButton = preview.locator('.hvy-button-component');
  await expect(previewButton).toBeVisible();
  await expect(preview.locator('.button-component-preview-stage')).toBeVisible();

  const previewBox = await preview.boundingBox();
  const buttonBox = await previewButton.boundingBox();
  const visibleScriptBox = await settings.locator('[data-field="block-button-visible-script"]').boundingBox();

  expect(previewBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(visibleScriptBox).not.toBeNull();
  expect(buttonBox!.y + buttonBox!.height).toBeLessThan(visibleScriptBox!.y);
  expect(buttonBox!.y).toBeGreaterThanOrEqual(previewBox!.y);
});

test('embedded editor and viewer keep independent document state', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/examples/two-embedded-docs.html');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  const firstDoc = page.locator('#docOne');
  const secondDoc = page.locator('#docTwo');
  await expect(firstDoc.locator('#editorTree')).toBeVisible({ timeout: 1_000 });
  await expect(firstDoc.locator('#editorTree')).toContainText('Current Goal');
  await expect(secondDoc.locator('#readerDocument')).toBeVisible();
  await expect(secondDoc.locator('#editorTree')).toHaveCount(0);
  await expect(secondDoc.locator('.viewer-sidebar-help-balloon')).toBeVisible();

  await secondDoc.locator('.viewer-sidebar-help-balloon').click();
  await expect(secondDoc.locator('.viewer-sidebar-help-balloon')).toHaveClass(/is-closing/);
  await page.waitForTimeout(220);
  await expect(secondDoc.locator('.viewer-sidebar-help-balloon')).toHaveCount(0);
  await secondDoc.locator('.viewer-sidebar-tab').click();
  await expect(secondDoc.locator('.viewer-shell')).toHaveClass(/is-sidebar-open/);
  await expect(secondDoc.locator('.viewer-sidebar-panel')).toContainText('Skills');
  await secondDoc.locator('.viewer-sidebar-tab').click();
  await expect(secondDoc.locator('.viewer-shell')).toHaveClass(/is-sidebar-closed/);
});

test('two embedded docs can switch example sources independently', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/examples/two-embedded-docs.html');
  await page.evaluate(() => sessionStorage.clear());
  await page.getByRole('button', { name: 'Reset sessions' }).click();
  await expect(page.locator('#eventLog')).toContainText('Reset both keyed sessions.');

  const firstDoc = page.locator('#docOne');
  const secondDoc = page.locator('#docTwo');
  await expect(firstDoc.locator('#editorTree')).toBeVisible({ timeout: 1_000 });
  await expect(firstDoc).toContainText('Current Goal');
  await expect(secondDoc.locator('#readerDocument')).toBeVisible();
  await expect(secondDoc).toContainText('Skills');

  await page.getByRole('button', { name: 'Resume' }).first().click();
  await expect(firstDoc).toContainText('Avery Hart');
  await expect(firstDoc).not.toContainText('Current Goal');

  await page.getByRole('button', { name: 'Example' }).nth(1).click();
  await expect(secondDoc).toContainText('Current Goal');
  await expect(secondDoc).not.toContainText('Avery Hart');
});

test('second embedded viewer action buttons remain clickable', async ({ page }) => {
  test.setTimeout(5_000);
  const chatRequests: Array<{ mode?: string; context?: string; messages?: Array<{ role?: string; content?: string }> }> = [];
  await page.route('**/api/chat', async (route) => {
    const payload = route.request().postDataJSON() as { mode?: string; context?: string; messages?: Array<{ role?: string; content?: string }> };
    chatRequests.push(payload);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: 'API answer: Avery Hart is the resume candidate.',
      }),
    });
  });
  await page.goto('/examples/two-embedded-docs.html');
  await page.evaluate(() => sessionStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });

  const firstDoc = page.locator('#docOne');
  const secondDoc = page.locator('#docTwo');
  await expect(secondDoc.locator('#readerDocument')).toBeVisible({ timeout: 1_000 });
  const firstDocMountBox = await firstDoc.boundingBox();
  const firstDocLayoutBox = await firstDoc.locator('.hvy-embed-layout').boundingBox();
  const secondDocMountBox = await secondDoc.boundingBox();
  const secondDocLayoutBox = await secondDoc.locator('.hvy-embed-layout').boundingBox();
  expect(firstDocMountBox).not.toBeNull();
  expect(firstDocLayoutBox).not.toBeNull();
  expect(secondDocMountBox).not.toBeNull();
  expect(secondDocLayoutBox).not.toBeNull();
  expect(firstDocLayoutBox!.height).toBeGreaterThanOrEqual(firstDocMountBox!.height - 1);
  expect(secondDocLayoutBox!.height).toBeGreaterThanOrEqual(secondDocMountBox!.height - 1);

  await firstDoc.locator('.search-launcher').click();
  await expect(firstDoc.locator('.search-palette')).toBeVisible({ timeout: 1_000 });
  const firstDocSearchBox = await firstDoc.boundingBox();
  const firstSearchPaletteBox = await firstDoc.locator('.search-palette').boundingBox();
  expect(firstDocSearchBox).not.toBeNull();
  expect(firstSearchPaletteBox).not.toBeNull();
  expect(firstSearchPaletteBox!.y).toBeGreaterThanOrEqual(firstDocSearchBox!.y);
  expect(firstSearchPaletteBox!.y + firstSearchPaletteBox!.height).toBeLessThanOrEqual(firstDocSearchBox!.y + firstDocSearchBox!.height + 1);
  await firstDoc.getByRole('button', { name: 'Close search panel' }).click();
  await expect(firstDoc.locator('.search-palette')).toHaveCount(0);

  await secondDoc.locator('.viewer-sidebar-help-balloon').click();
  await page.waitForTimeout(220);
  await secondDoc.locator('.viewer-sidebar-tab').click();
  await expect(secondDoc.locator('.viewer-shell')).toHaveClass(/is-sidebar-open/);
  await expect(secondDoc.locator('.viewer-sidebar-panel')).toContainText('Skills');
  await secondDoc.locator('.viewer-sidebar-tab').click();
  await expect(secondDoc.locator('.viewer-shell')).toHaveClass(/is-sidebar-closed/);

  await secondDoc.locator('.search-launcher').click();
  await expect(secondDoc.locator('.search-palette')).toBeVisible({ timeout: 1_000 });
  await secondDoc.locator('[data-field="search-query"]').fill('Avery Hart');
  await secondDoc.locator('#searchComposer').press('Enter');
  await expect(secondDoc.locator('.search-result')).toContainText('Avery Hart', { timeout: 1_000 });
  await secondDoc.getByRole('button', { name: 'Close search panel' }).click();
  await expect(secondDoc.locator('.search-palette')).toHaveCount(0);

  await firstDoc.locator('.chat-launcher').click();
  await expect(firstDoc.locator('.chat-panel')).toBeVisible({ timeout: 1_000 });
  const firstDocBox = await firstDoc.boundingBox();
  const firstChatPanelBox = await firstDoc.locator('.chat-panel').boundingBox();
  expect(firstDocBox).not.toBeNull();
  expect(firstChatPanelBox).not.toBeNull();
  expect(firstChatPanelBox!.x).toBeGreaterThanOrEqual(firstDocBox!.x);
  expect(firstChatPanelBox!.x + firstChatPanelBox!.width).toBeLessThanOrEqual(firstDocBox!.x + firstDocBox!.width + 1);
  expect(firstChatPanelBox!.y + firstChatPanelBox!.height).toBeLessThanOrEqual(firstDocBox!.y + firstDocBox!.height + 1);
  const firstChatEmptyBox = await firstDoc.locator('.chat-empty').boundingBox();
  const firstChatComposerBox = await firstDoc.locator('.chat-composer').boundingBox();
  expect(firstChatEmptyBox).not.toBeNull();
  expect(firstChatComposerBox).not.toBeNull();
  expect(firstChatComposerBox!.y - (firstChatEmptyBox!.y + firstChatEmptyBox!.height)).toBeLessThanOrEqual(18);
  await firstDoc.locator('.chat-launcher').click();
  await expect(firstDoc.locator('.chat-panel')).toBeHidden();

  await secondDoc.locator('.chat-launcher').click();
  await expect(secondDoc.locator('.chat-panel')).toBeVisible({ timeout: 1_000 });
  await expect(secondDoc.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Ask about the current HVY document...');
  await secondDoc.locator('[data-field="chat-input"]').fill('Who is the resume candidate?');
  await secondDoc.locator('[data-field="chat-input"]').press('Enter');
  await expect(secondDoc.locator('.chat-panel')).toContainText('API answer: Avery Hart is the resume candidate.', { timeout: 3_500 });
  expect(chatRequests).toHaveLength(1);
  expect(chatRequests[0]?.mode).toBe('qa');
  expect(chatRequests[0]?.context).toContain('Avery Hart');
  expect(chatRequests[0]?.messages?.at(-1)?.content).toBe('Who is the resume candidate?');
  await expect(firstDoc).not.toContainText('API answer');
});
