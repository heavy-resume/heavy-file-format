import { expect, test } from '@playwright/test';

test('chat uses document editing mode in editor and ai views only', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Open chat' }).click();
  await expect(page.getByRole('heading', { name: 'Edit This Document' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open search' })).toBeHidden();
  await expect(page.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Describe how the document should change...');
  await expect(page.locator('.chat-panel')).toHaveClass(/is-document-edit/);
  await expect(page.locator('.chat-panel')).toBeVisible();
  const editChatWidth = await page.locator('.chat-panel').evaluate((panel) => panel.getBoundingClientRect().width);

  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  await expect(page.getByRole('heading', { name: 'Edit This Document' })).toBeVisible();
  await expect(page.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Describe how the document should change...');

  await page.locator('[data-action="switch-view"][data-view="viewer"]').click();
  await expect(page.getByRole('heading', { name: 'Ask This Document' })).toBeVisible();
  await expect(page.locator('.chat-panel')).toHaveClass(/is-question-answer/);
  await expect(page.locator('[data-field="chat-input"]')).toHaveAttribute('placeholder', 'Ask about the current HVY document...');
  await expect.poll(() => page.locator('.chat-panel').evaluate((panel) => panel.getBoundingClientRect().width)).toBe(editChatWidth);

  await page.getByRole('button', { name: 'Close chat' }).click();
  await expect(page.getByRole('button', { name: 'Open search' })).toBeVisible();
});

test('large chat paste becomes a restorable session attachment without losing focus', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open chat' }).click();
  const prompt = page.locator('[data-field="chat-input"]');
  await prompt.fill('Update this document.');

  await prompt.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', 'S'.repeat(1_999));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  });
  await expect(page.locator('.chat-attachment-chip')).toHaveCount(0);

  await prompt.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', `${'A'.repeat(1_999)}\nB`);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  });

  await expect(page.locator('.chat-attachment-chip')).toContainText('Pasted text 1.txt');
  await expect(page.locator('.chat-attachment-chip')).toContainText('2,001 characters');
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveValue('Update this document.');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Edit This Document' })).toBeVisible();
  await expect(page.locator('.chat-attachment-chip')).toContainText('Pasted text 1.txt');
  await page.getByRole('button', { name: 'Restore as text' }).click();
  await expect(prompt).toBeFocused();
  await expect(prompt).toHaveValue(/A{20}/);
  await expect(page.locator('.chat-attachment-chip')).toHaveCount(0);
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

test('search launcher aligns with chat launcher in phone viewer preview', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 620 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Phone 390' }).click();
  await page.locator('[data-action="switch-view"][data-view="viewer"]').click();

  const pane = page.locator('.full-pane');
  const searchLauncher = page.getByRole('button', { name: 'Open search' });
  const chatLauncher = page.getByRole('button', { name: 'Open chat' });
  const expectedResult = await Promise.all([
    pane.boundingBox(),
    searchLauncher.boundingBox(),
    chatLauncher.boundingBox(),
  ]);
  const [paneBox, searchBox, chatBox] = expectedResult;
  expect(paneBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(chatBox).not.toBeNull();
  const searchRight = searchBox!.x + searchBox!.width;
  const searchBottom = searchBox!.y + searchBox!.height;
  const chatBottom = chatBox!.y + chatBox!.height;
  const paneRight = paneBox!.x + paneBox!.width;
  const paneBottom = paneBox!.y + paneBox!.height;

  expect(Math.round(searchBottom)).toBe(Math.round(chatBottom));
  expect(Math.round(chatBox!.x - searchRight)).toBeGreaterThanOrEqual(6);
  expect(Math.round(chatBox!.x - searchRight)).toBeLessThanOrEqual(12);
  expect(searchRight).toBeLessThanOrEqual(paneRight);
  expect(searchBottom).toBeLessThanOrEqual(paneBottom);
  const launcherStyles = await Promise.all([
    searchLauncher.evaluate((button) => {
      const styles = getComputedStyle(button);
      return {
        borderRadius: styles.borderRadius,
        paddingInline: `${styles.paddingLeft} ${styles.paddingRight}`,
      };
    }),
    chatLauncher.evaluate((button) => {
      const styles = getComputedStyle(button);
      return {
        borderRadius: styles.borderRadius,
        paddingInline: `${styles.paddingLeft} ${styles.paddingRight}`,
      };
    }),
  ]);
  expect(launcherStyles).toEqual([
    { borderRadius: '999px', paddingInline: '0px 0px' },
    { borderRadius: '999px', paddingInline: '0px 0px' },
  ]);
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

  await scroller.evaluate(async (node) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    node.scrollTop = 0;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBe(0);
  const latestButton = page.locator('.chat-scroll-bottom');
  await expect(latestButton).toBeVisible();
  const [scrollerBox, latestBox] = await Promise.all([scroller.boundingBox(), latestButton.boundingBox()]);
  expect(scrollerBox).not.toBeNull();
  expect(latestBox).not.toBeNull();
  expect(latestBox!.x + latestBox!.width).toBeLessThanOrEqual(scrollerBox!.x + scrollerBox!.width);
  expect(latestBox!.y + latestBox!.height).toBeLessThanOrEqual(scrollerBox!.y + scrollerBox!.height);
  expect(scrollerBox!.y + scrollerBox!.height - (latestBox!.y + latestBox!.height)).toBeLessThanOrEqual(16);
});

test('viewer question shows pending feedback and anchors Latest to the scroll surface', async ({ page }) => {
  test.setTimeout(5_000);
  let finishResponse!: () => void;
  const responseStarted = new Promise<void>((resolve) => {
    finishResponse = resolve;
  });
  await page.route('**/api/chat', async (route) => {
    await responseStarted;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ output: 'Finished answer.', toolCalls: [], nativeMessages: [], toolState: { provider: 'openai', input: [] } }),
    });
  });
  await page.goto('/');
  await page.locator('[data-action="switch-view"][data-view="viewer"]').click();
  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.locator('[data-field="chat-input"]').fill('A question that takes a while');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByRole('status', { name: 'Preparing an answer' })).toContainText('Reading the document and preparing an answer...');
  await expect(page.locator('.chat-scroll-bottom')).toHaveCSS('position', 'sticky');

  finishResponse();
  await expect(page.locator('.chat-bubble', { hasText: 'Finished answer.' })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Preparing an answer' })).toHaveCount(0);
});

test('viewer streams host output as text before rendering the completed HVY response', async ({ page }) => {
  test.setTimeout(5_000);
  await page.goto('/');
  await page.evaluate(async () => {
    const { setHostChatClient } = await import(/* @vite-ignore */ '/src/chat/chat.ts');
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    (window as typeof window & { finishHvyChatStream?: () => void }).finishHvyChatStream = finish;
    setHostChatClient({
      async complete() {
        return { output: 'Unexpected fallback.' };
      },
      async *streamToolTurn() {
        yield { type: 'output_delta' as const, delta: '<!--hvy:text {"id":"streamed-answer"}-->\n**Partial' };
        await finished;
        yield { type: 'output_delta' as const, delta: ' answer**' };
        yield {
          type: 'response' as const,
          response: {
            output: '<!--hvy:text {"id":"streamed-answer"}-->\n**Partial answer**',
            toolCalls: [],
            nativeMessages: [],
            toolState: { provider: 'openai' as const, input: [] },
          },
        };
      },
    });
  });
  await page.locator('[data-action="switch-view"][data-view="viewer"]').click();
  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.locator('[data-field="chat-input"]').fill('Stream an HVY answer');
  await page.getByRole('button', { name: 'Send' }).click();

  const answer = page.locator('[data-chat-message-id].chat-bubble-streaming');
  await expect(answer).toContainText('<!--hvy:text');
  await expect(answer.locator('.chat-hvy-response')).toHaveCount(0);

  await page.evaluate(() => {
    (window as typeof window & { finishHvyChatStream?: () => void }).finishHvyChatStream?.();
  });
  await expect(page.locator('.chat-bubble-streaming')).toHaveCount(0);
  await expect(page.locator('.chat-hvy-response')).toContainText('Partial answer');
});

test('viewer question updates chat without rerendering the app', async ({ page }) => {
  let renderAppLogCount = 0;
  page.on('console', (message) => {
    if (message.text().includes('[hvy:perf]') && message.text().includes('renderApp')) {
      renderAppLogCount += 1;
    }
  });
  await page.route('**/api/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: 'Viewer answer without full rerender.',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    });
  });

  await page.goto('/');
  await page.locator('.document-menu').evaluate((menu) => {
    if (menu instanceof HTMLDetailsElement) {
      menu.open = true;
    }
  });
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Resume Example', exact: true }).click({ force: true });
  await expect(page.locator('#downloadName')).toHaveValue('resume.hvy');
  await page.locator('[data-action="switch-view"][data-view="viewer"]').click();
  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.locator('[data-field="chat-input"]').fill('What is this document?');

  renderAppLogCount = 0;
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.chat-bubble', { hasText: 'Viewer answer without full rerender.' })).toBeVisible();

  expect(renderAppLogCount).toBe(0);
});

test('Viewer follow-up inspects a known path inside the cache-stable read-only agent', async ({ page }) => {
  const chatRequests: Array<{
    mode?: string;
    context?: string;
    messages?: Array<{ role?: string; content?: string }>;
    tools?: Array<{ name?: string }>;
    toolState?: unknown;
  }> = [];
  await page.route('**/api/chat', async (route) => {
    chatRequests.push(route.request().postDataJSON());
    const response = chatRequests.length === 1
      ? {
        output: 'The answer choices may affect the response.',
        reasoningSummary: '',
        toolCalls: [],
        nativeMessages: [],
        toolState: { provider: 'openai', input: [] },
      }
      : chatRequests.length === 2
        ? {
          output: '',
          reasoningSummary: '',
          toolCalls: [{
            id: 'inspect-choices',
            name: 'inspect_hvy_path',
            arguments: { path: '/id/top-skills-list' },
          }],
          nativeMessages: [{
            type: 'function_call',
            call_id: 'inspect-choices',
            name: 'inspect_hvy_path',
            arguments: '{"path":"/id/top-skills-list"}',
          }],
          toolState: { provider: 'openai', input: [] },
        }
        : {
          output: 'The requested content is already present in the inspected component.',
          reasoningSummary: '',
          toolCalls: [],
          nativeMessages: [],
          toolState: { provider: 'openai', input: [] },
        };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...response,
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      }),
    });
  });

  await page.goto('/');
  await page.locator('.document-menu').evaluate((menu) => {
    if (menu instanceof HTMLDetailsElement) {
      menu.open = true;
    }
  });
  await page.locator('.document-menu-panel').getByRole('button', { name: 'Resume Example', exact: true }).click({ force: true });
  await page.locator('[data-action="switch-view"][data-view="viewer"]').click();
  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.getByLabel('Chat context method').selectOption('full-document');

  await page.locator('[data-field="chat-input"]').fill('Do the answer choices introduce bias?');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.chat-bubble', { hasText: 'The answer choices may affect the response.' })).toBeVisible();

  await page.locator('[data-field="chat-input"]').fill('They are already in the document.');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('.chat-bubble', { hasText: 'The requested content is already present in the inspected component.' })).toBeVisible();

  expect(chatRequests).toHaveLength(3);
  expect(chatRequests.every((request) => request.mode === 'qa')).toBe(true);
  expect(chatRequests[1]?.context).toBe(chatRequests[0]?.context);
  expect(chatRequests[2]?.context).toBe(chatRequests[1]?.context);
  expect(chatRequests[1]?.tools?.map((tool) => tool.name)).toEqual([
    'search_hvy_document',
    'walk_hvy_document',
    'inspect_hvy_path',
    'query_db_table',
    'answer_user',
  ]);
  expect(chatRequests[1]?.tools?.map((tool) => tool.name)).not.toContain('run_hvy_cli');
  expect(chatRequests[1]?.tools?.map((tool) => tool.name)).not.toContain('apply_hvy_patch');
  expect(chatRequests[1]?.messages).toEqual(expect.arrayContaining([
    expect.objectContaining({ role: 'user', content: 'Do the answer choices introduce bias?' }),
    expect.objectContaining({ role: 'assistant', content: 'The answer choices may affect the response.' }),
    expect.objectContaining({ role: 'user', content: 'They are already in the document.' }),
  ]));
  expect(JSON.stringify(chatRequests[2]?.toolState)).toContain('Component preview');
});

for (const view of ['editor', 'ai']) {
  test(`${view} chat retains editing tools for questions and follow-up requests`, async ({ page }) => {
    test.setTimeout(5_000);
    const chatRequests: Array<{
      mode?: string;
      tools?: Array<{ name: string }>;
      messages?: Array<{ role?: string; content?: string }>;
    }> = [];
    await page.route('**/api/chat', async (route) => {
      chatRequests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          output: 'done Request handled.',
          reasoningSummary: '',
          toolCalls: [],
          nativeMessages: [],
          toolState: { provider: 'openai', input: [] },
        }),
      });
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'New', exact: true }).click();
    await page.getByRole('button', { name: 'HVY Document', exact: true }).click();
    await page.locator(`[data-action="switch-view"][data-view="${view}"]`).click();
    await page.getByRole('button', { name: 'Open chat' }).click();
    await page.locator('[data-field="chat-input"]').fill('What color is the heading?');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.chat-bubble', { hasText: 'Request handled.' })).toHaveCount(1);
    expect(chatRequests).toHaveLength(1);
    expect(chatRequests[0]?.mode).toBe('document-edit');
    expect(chatRequests[0]?.tools?.map((tool) => tool.name)).toContain('apply_hvy_patch');

    await page.locator('[data-field="chat-input"]').fill('Can we give it the same font color too');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.locator('.chat-bubble', { hasText: 'Request handled.' })).toHaveCount(2);
    expect(chatRequests).toHaveLength(2);
    expect(chatRequests[1]?.mode).toBe('document-edit');
    expect(chatRequests[1]?.tools?.map((tool) => tool.name)).toContain('apply_hvy_patch');
    expect(chatRequests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: 'user', content: 'What color is the heading?' }),
      expect.objectContaining({ role: 'assistant', content: 'Request handled.' }),
      expect.objectContaining({ role: 'user', content: 'Can we give it the same font color too' }),
    ]));
  });
}

test('AI mode informational question with a chat attachment uses the attachment-capable CLI loop', async ({ page }) => {
  const rawJobDescription = `Job description\n${'Restaurant service requirement. '.repeat(80)}`;
  const chatRequests: Array<{
    mode?: string;
    context?: string;
    messages?: Array<{ content?: string }>;
  }> = [];
  await page.route('**/api/chat', async (route) => {
    chatRequests.push(route.request().postDataJSON());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        output: 'done Compared the resume with the attached job description.',
        reasoningSummary: '',
        toolCalls: [],
        nativeMessages: [],
        toolState: { provider: 'openai', input: [] },
      }),
    });
  });

  await page.goto('/');
  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  await page.getByRole('button', { name: 'Open chat' }).click();
  const prompt = page.locator('[data-field="chat-input"]');
  await prompt.fill('Does this fit the job description?');
  await prompt.evaluate((element, pastedText) => {
    const transfer = new DataTransfer();
    transfer.setData('text/plain', pastedText);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
  }, rawJobDescription);
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.locator('.chat-bubble', { hasText: 'Compared the resume with the attached job description.' })).toBeVisible();
  expect(chatRequests).toHaveLength(1);
  expect(chatRequests[0]?.mode).toBe('document-edit');
  expect(chatRequests[0]?.context).toContain('Chat attachments:');
  expect(chatRequests[0]?.context).toContain('/chat-attachments/');
  expect(JSON.stringify(chatRequests[0])).not.toContain(rawJobDescription);
});

test('document edit CLI does not record history when a reported mutation leaves the document unchanged', async ({ page }) => {
  let chatRequestCount = 0;
  let recordHistoryLogCount = 0;
  let resolveSecondChatRequest!: () => void;
  const secondChatRequest = new Promise<void>((resolve) => {
    resolveSecondChatRequest = resolve;
  });
  page.on('console', (message) => {
    if (message.text().includes('[hvy:perf] recordHistory')) {
      recordHistoryLogCount += 1;
    }
  });
  await page.route('**/api/chat', async (route) => {
    chatRequestCount += 1;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(chatRequestCount === 1 ? {
        output: 'What: Check whether the requested section exists.\nWhy: The removal is safe when the path is absent.\nUnsure: Nothing.',
        reasoningSummary: '',
        toolCalls: [{
          id: 'call_remove_missing',
          name: 'run_hvy_cli',
          arguments: { command: 'rm -rf /body/missing-section' },
        }],
        nativeMessages: [{
          type: 'function_call',
          call_id: 'call_remove_missing',
          name: 'run_hvy_cli',
          arguments: '{"command":"rm -rf /body/missing-section"}',
        }],
        toolState: { provider: 'openai', input: [] },
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      } : {
        output: 'done No document change was needed.',
        reasoningSummary: '',
        toolCalls: [],
        nativeMessages: [],
        toolState: { provider: 'openai', input: [] },
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
      }),
    });
    if (chatRequestCount === 2) {
      resolveSecondChatRequest();
    }
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'New' }).click();
  await page.getByRole('button', { name: 'HVY Document' }).click();
  await page.locator('[data-action="switch-view"][data-view="ai"]').click();
  await page.getByRole('button', { name: 'Open chat' }).click();
  const documentBefore = await page.evaluate(async () => {
    const [{ state }, { serializeDocument }] = await Promise.all([
      import(/* @vite-ignore */ '/src/state.ts'),
      import(/* @vite-ignore */ '/src/serialization.ts'),
    ]);
    return serializeDocument(state.document);
  });

  recordHistoryLogCount = 0;
  await page.locator('[data-field="chat-input"]').fill('Remove the missing section if it exists.');
  await page.getByRole('button', { name: 'Send' }).click();

  await secondChatRequest;
  await expect(page.locator('.chat-bubble', { hasText: 'rm -rf /body/missing-section' })).toBeVisible();
  await expect(page.locator('.chat-bubble', { hasText: 'No document change was needed.' })).toBeVisible();
  expect(await page.evaluate(async () => {
    const [{ state }, { serializeDocument }] = await Promise.all([
      import(/* @vite-ignore */ '/src/state.ts'),
      import(/* @vite-ignore */ '/src/serialization.ts'),
    ]);
    return serializeDocument(state.document);
  })).toBe(documentBefore);
  expect(recordHistoryLogCount).toBe(0);
});

test('right click AI change request uses CLI sim when enabled', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Open chat' }).click();
  await page.getByRole('button', { name: 'CLI Sim Off' }).click();
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
