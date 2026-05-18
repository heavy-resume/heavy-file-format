import { expect, test } from '@playwright/test';

test('chat uses document editing mode in editor and ai views only', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Open chat' }).click();
  await expect(page.getByRole('heading', { name: 'Edit This Document' })).toBeVisible();
  await expect(page.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Describe how the document should change...');
  const editChatWidth = await page.locator('.chat-panel').evaluate((panel) => panel.getBoundingClientRect().width);

  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  await expect(page.getByRole('heading', { name: 'Edit This Document' })).toBeVisible();
  await expect(page.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Describe how the document should change...');

  await page.locator('[data-action="switch-view"][data-view="viewer"]').click();
  await expect(page.getByRole('heading', { name: 'Ask This Document' })).toBeVisible();
  await expect(page.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Ask about the current HVY document...');
  await expect.poll(() => page.locator('.chat-panel').evaluate((panel) => panel.getBoundingClientRect().width)).toBe(editChatWidth);
});

test('chat panel stays compact in phone viewer preview', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 620 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Phone 390' }).click();
  await page.locator('[data-action="switch-view"][data-view="viewer"]').click();
  await page.getByRole('button', { name: 'Open chat' }).click();

  await expect.poll(() =>
    page.locator('.chat-panel').evaluate((panel) => Math.round(panel.getBoundingClientRect().height))
  ).toBeLessThanOrEqual(320);
  await expect.poll(() =>
    page.locator('[data-field="chat-input"]').evaluate((input) => Math.round(input.getBoundingClientRect().height))
  ).toBeLessThanOrEqual(72);
});

test('chat stays scrolled to latest across full rerenders', async ({ page }) => {
  let responseIndex = 0;
  await page.setViewportSize({ width: 900, height: 640 });
  await page.route('**/api/chat', async (route) => {
    responseIndex += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: [`Mock reply ${responseIndex}`, ...Array.from({ length: 18 }, (_value, index) => `reply ${responseIndex} line ${index + 1}`)].join('\n'),
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      }),
    });
  });
  await page.goto('/');
  await page.locator('[data-action="switch-view"][data-view="viewer"]').click();
  await page.getByRole('button', { name: 'Open chat' }).click();

  for (let index = 0; index < 5; index += 1) {
    await page.locator('[data-field="chat-input"]').fill(`Question ${index + 1}`);
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.chat-bubble')).toHaveCount((index + 1) * 2);
  }

  const scroller = page.locator('[data-chat-scroll-container]');
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect.poll(() =>
    scroller.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)
  ).toBeLessThanOrEqual(4);

  await page.locator('[data-field="chat-input"]').fill('One more');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.chat-bubble')).toHaveCount(12);

  await expect.poll(() =>
    scroller.evaluate((node) => node.scrollHeight - node.scrollTop - node.clientHeight)
  ).toBeLessThanOrEqual(12);
});

test('right click AI change request uses CLI sim when enabled', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.getByRole('button', { name: 'CLI Sim Off' }).evaluate((button) => {
    (button as HTMLButtonElement).click();
  });
  await expect(page.getByRole('button', { name: 'CLI Sim On' })).toBeVisible();

  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  const targetBlock = page.locator('.reader-block[data-section-key][data-block-id]').first();
  await targetBlock.dispatchEvent('contextmenu', {
    clientX: 240,
    clientY: 220,
    button: 2,
  });
  await page.getByRole('button', { name: 'Request changes' }).click();

  await expect(page.locator('.ai-edit-popover')).toBeVisible();
  await page.locator('[data-field="ai-edit-input"]').fill('Tighten this wording.');
  await page.locator('#aiEditComposer').evaluate((form) => {
    (form as HTMLFormElement).requestSubmit();
  });

  await expect(page.locator('.ai-edit-popover')).toHaveCount(0);
  await expect(page.locator('.chat-cli-sim')).toBeVisible();
  await expect(page.locator('.chat-cli-sim summary', { hasText: 'Request JSON' })).toBeVisible();
  await expect(page.locator('.chat-cli-sim pre').first()).toContainText('Tighten this wording.');
  await expect(page.locator('.chat-cli-sim pre').first()).toContainText('Selected component focus');
});
