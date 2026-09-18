import { expect, test } from '@playwright/test';

const source = `---
hvy_version: 0.1
---
<!--hvy: {"id":"text-ai-test"}-->
#! Text test
<!--hvy:text {"id":"selected"}-->
Thsi is teh original.

<!--hvy:text {"id":"unrelated"}-->
Unrelated private content.
`;

test.beforeEach(async ({ page }) => {
  test.setTimeout(5_000);
  page.setDefaultTimeout(1_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(source);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();
  await page.locator('.editor-block-passive', { hasText: 'Thsi is teh original.' }).first().click();
  await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    state.chat.settings.textProcessingProvider = 'openai';
    state.chat.settings.textProcessingModel = 'fake-text-model';
  });
  await page.getByRole('button', { name: 'Process with AI', exact: true }).click();
});

test('cleanup sends only text guidance and selected value, replaces text, and supports undo', async ({ page }) => {
  let payload = '';
  await page.route('**/api/chat', async route => {
    payload = route.request().postData() ?? '';
    await route.fulfill({ json: { output: 'This is the original.' } });
  });
  await page.getByText('Custom Instructions', { exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Custom Instructions' })).toHaveValue('');
  const placeholder = await page.getByRole('textbox', { name: 'Custom Instructions' }).getAttribute('placeholder');
  await page.getByRole('button', { name: 'Clean Up', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'AI Clean-up' })).toHaveCount(0);
  expect(JSON.parse(payload).messages.find((message: { role: string }) => message.role === 'user').content).toBe(placeholder);
  await expect(page.locator('[data-field="block-rich"]')).toHaveText('This is the original.');
  expect(payload).toContain('Thsi is teh original.');
  expect(payload).toContain('HVY text component guidance');
  expect(payload).toContain('written on a phone');
  expect(payload).toContain('meaning and structure');
  expect(payload).not.toContain('Unrelated private content.');
  await page.evaluate(async () => {
    const { undoState } = await import('/src/history.ts');
    const { getRenderApp } = await import('/src/state.ts');
    undoState();
    getRenderApp()();
  });
  await expect(page.locator('[data-field="block-rich"]')).toHaveText('Thsi is teh original.');
});

test('custom instructions retain focus and work inside a phone preview', async ({ page }) => {
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Phone 390', exact: true }).click();
  await page.getByRole('button', { name: 'Process with AI', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'AI Clean-up' });
  await expect(modal.getByRole('textbox')).toBeHidden();
  await modal.getByText('Custom Instructions', { exact: true }).click();
  await modal.getByRole('textbox').pressSequentially('Make this concise.');
  await expect(modal.getByRole('textbox')).toBeFocused();
  await expect(modal.getByRole('textbox')).toHaveValue('Make this concise.');
  expect(await modal.evaluate(element => {
    const frame = element.closest('.editor-shell, .viewer-shell')!.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const action = element.querySelector('[data-text-ai-clean]')!.getBoundingClientRect();
    return bounds.left >= frame.left && bounds.right <= frame.right
      && action.top >= bounds.top && action.bottom <= bounds.bottom;
  })).toBe(true);
  await page.route('**/api/chat', async route => {
    expect(route.request().postData()).toContain('Make this concise.');
    await route.fulfill({ json: { output: 'Original.' } });
  });
  await modal.getByRole('button', { name: 'Clean Up', exact: true }).click();
  await expect(page.locator('[data-field="block-rich"]')).toHaveText('Original.');
});

test('closing a pending request leaves the original text intact', async ({ page }) => {
  let finish!: () => Promise<void>;
  await page.route('**/api/chat', route => { finish = () => route.fulfill({ json: { output: 'Late response.' } }); });
  const request = page.waitForRequest('**/api/chat');
  await page.getByRole('button', { name: 'Clean Up', exact: true }).click();
  await request;
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await finish();
  await expect(page.locator('[data-field="block-rich"]')).toHaveText('Thsi is teh original.');
});

test('request errors keep the custom draft available for retry', async ({ page }) => {
  await page.route('**/api/chat', route => route.fulfill({ status: 500, json: { error: 'Expected service failure' } }));
  const modal = page.getByRole('dialog', { name: 'AI Clean-up' });
  await modal.getByText('Custom Instructions', { exact: true }).click();
  await modal.getByRole('textbox').fill('Preserve my wording.');
  await modal.getByRole('button', { name: 'Clean Up', exact: true }).click();
  await expect(modal.getByRole('status')).toContainText('Expected service failure');
  await expect(modal.getByRole('textbox')).toHaveValue('Preserve my wording.');
  await expect(modal.getByRole('button', { name: 'Clean Up', exact: true })).toBeEnabled();
  await expect(page.locator('[data-field="block-rich"]')).toHaveText('Thsi is teh original.');
});

test('text processing model controls persist independently and select the request model', async ({ page }) => {
  const originalChatSettings = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return { provider: state.chat.settings.provider, model: state.chat.settings.model };
  });
  const modal = page.getByRole('dialog', { name: 'AI Clean-up' });
  await modal.getByText('Model settings', { exact: true }).click();
  await modal.getByRole('textbox', { name: 'Text processing provider' }).fill('');
  await modal.getByRole('textbox', { name: 'Text processing provider' }).pressSequentially('fake-text-provider');
  await expect(modal.getByRole('textbox', { name: 'Text processing provider' })).toBeFocused();
  await modal.getByRole('textbox', { name: 'Text processing model' }).fill('');
  await modal.getByRole('textbox', { name: 'Text processing model' }).pressSequentially('fake-text-model');
  await expect(modal.getByRole('textbox', { name: 'Text processing model' })).toBeFocused();
  expect(await page.evaluate(async () => {
    const { loadChatSettings } = await import('/src/chat/chat.ts');
    const settings = loadChatSettings();
    return { provider: settings.provider, model: settings.model, textProcessingProvider: settings.textProcessingProvider, textProcessingModel: settings.textProcessingModel };
  })).toEqual({ ...originalChatSettings, textProcessingProvider: 'fake-text-provider', textProcessingModel: 'fake-text-model' });
  let payload: { provider?: string; model?: string } = {};
  await page.route('**/api/chat', async route => {
    payload = route.request().postDataJSON();
    await route.fulfill({ json: { output: 'This is the original.' } });
  });
  await modal.getByRole('button', { name: 'Clean Up', exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(payload.provider).toBe('fake-text-provider');
  expect(payload.model).toBe('fake-text-model');
  expect(await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return { provider: state.chat.settings.provider, model: state.chat.settings.model };
  })).toEqual(originalChatSettings);
});

test('not set blocks processing and clearing the provider persists without a default', async ({ page }) => {
  const modal = page.getByRole('dialog', { name: 'AI Clean-up' });
  await modal.getByText('Model settings', { exact: true }).click();
  await modal.getByRole('textbox', { name: 'Text processing provider' }).fill('');
  await modal.getByRole('textbox', { name: 'Text processing model' }).fill('');
  await expect(modal.getByRole('status')).toContainText('Select a provider and model');
  await expect(modal.getByRole('button', { name: 'Clean Up', exact: true })).toBeDisabled();
  await modal.getByText('Custom Instructions', { exact: true }).click();
  await modal.getByRole('textbox', { name: 'Custom Instructions' }).fill('Fix typos.');
  await expect(modal.getByRole('button', { name: 'Clean Up', exact: true })).toBeDisabled();
  expect(await page.evaluate(async () => {
    const { loadChatSettings } = await import('/src/chat/chat.ts');
    const settings = loadChatSettings();
    return [settings.textProcessingProvider, settings.textProcessingModel];
  })).toEqual([null, null]);
  await modal.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Process with AI', exact: true }).click();
  await expect(modal.getByRole('textbox', { name: 'Text processing provider' })).toHaveValue('');
  await modal.getByRole('textbox', { name: 'Text processing provider' }).fill('openai');
  await expect(modal.getByRole('textbox', { name: 'Text processing model' })).toHaveValue('');
  await expect(modal.getByRole('button', { name: 'Clean Up', exact: true })).toBeDisabled();
  await modal.getByRole('textbox', { name: 'Text processing model' }).fill('fake-explicit-model');
  await expect(modal.getByRole('button', { name: 'Clean Up', exact: true })).toBeEnabled();
});


test('AI is first inside the surrounding brackets and disappears when expanded', async ({ page }) => {
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  const toolbar = page.locator('.text-editor-toolbar-slot > .rich-toolbar').first();
  const compact = toolbar.locator('.text-toolbar-compact');
  expect(await compact.evaluate(element => [...element.children].map(child => child.className)))
    .toEqual([
      'ghost icon-button text-toolbar-expand text-toolbar-expand-left',
      'text-ai-toolbar-segment',
      'text-toolbar-compact-actions',
      'ghost icon-button text-toolbar-expand text-toolbar-expand-right',
    ]);
  await expect(compact.getByRole('button', { name: 'Process with AI' })).toBeVisible();
  await compact.getByRole('button', { name: 'Show all text controls' }).last().click();
  await expect(toolbar).toHaveClass(/is-text-toolbar-expanded/);
  await expect(toolbar.locator('[data-text-ai]')).toBeHidden();
});
