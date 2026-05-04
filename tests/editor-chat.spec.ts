import { expect, test } from '@playwright/test';

test('chat uses document editing mode in editor and ai views only', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Open chat' }).click();
  await expect(page.getByRole('heading', { name: 'Edit This Document' })).toBeVisible();
  await expect(page.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Describe how the document should change...');

  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  await expect(page.getByRole('heading', { name: 'Edit This Document' })).toBeVisible();
  await expect(page.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Describe how the document should change...');

  await page.locator('[data-action="switch-view"][data-view="viewer"]').click();
  await expect(page.getByRole('heading', { name: 'Ask This Document' })).toBeVisible();
  await expect(page.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Ask about the current HVY document...');
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
