import { expect, test } from '@playwright/test';

test('undo and redo restore the exact xref field, selection, and document state', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"undo-context"}-->
#! Undo Context

 <!--hvy:xref-card {"id":"reference","xrefTitle":"Custom title","xrefDetail":"Custom detail","xrefTarget":"undo-context"}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();

  await page.locator('.editor-block-passive', { has: page.locator('[data-component-id="reference"]') }).click();
  let detail = page.locator('.editor-block[data-active-editor-block="true"] [data-field="block-xref-detail"]');
  await detail.evaluate((node) => {
    const text = node.firstChild!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 13);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  const expectedDocument = await page.evaluate(async () =>
    JSON.parse(JSON.stringify((await import('/src/state.ts')).state.document))
  );

  await page.keyboard.press('Backspace');
  await expect(detail).toHaveText('Custom ');
  const editedDocument = await page.evaluate(async () =>
    JSON.parse(JSON.stringify((await import('/src/state.ts')).state.document))
  );

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
  await expect.poll(() => page.evaluate(async () =>
    JSON.parse(JSON.stringify((await import('/src/state.ts')).state.document))
  )).toEqual(expectedDocument);
  detail = page.locator('.editor-block[data-active-editor-block="true"] [data-field="block-xref-detail"]');
  await expect(detail).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('detail');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
  await expect.poll(() => page.evaluate(async () =>
    JSON.parse(JSON.stringify((await import('/src/state.ts')).state.document))
  )).toEqual(editedDocument);
  detail = page.locator('.editor-block[data-active-editor-block="true"] [data-field="block-xref-detail"]');
  expect(await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.field ?? null)).toBe('block-xref-detail');
  expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
});

test('raw editor typing uses clustered history without losing its focus or caret', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();

  let editor = page.locator('#rawEditor');
  await editor.evaluate((node: HTMLTextAreaElement) => {
    node.focus();
    node.setSelectionRange(node.value.length, node.value.length);
  });
  const expectedState = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return {
      document: JSON.parse(JSON.stringify(state.document)),
      rawEditorText: state.rawEditorText,
    };
  });

  for (const key of ['Enter', '#', 'Space', 'n', 'o', 't', 'e']) {
    await page.keyboard.press(key);
  }
  const editedText = await editor.inputValue();

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    return {
      document: JSON.parse(JSON.stringify(state.document)),
      rawEditorText: state.rawEditorText,
    };
  })).toEqual(expectedState);
  editor = page.locator('#rawEditor');
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((node: HTMLTextAreaElement) => node.selectionStart)).toBe(expectedState.rawEditorText.length);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
  await expect(editor).toHaveValue(editedText);
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((node: HTMLTextAreaElement) => node.selectionStart)).toBe(editedText.length);
});

test('off-screen undo scrolls to the edited block without animating the restore', async ({ page }) => {
  test.setTimeout(5000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw', exact: true }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"history-viewport"}-->
#! History Viewport

${Array.from({ length: 24 }, (_, index) =>
    ` <!--hvy:xref-card {"id":"reference-${index}","xrefTitle":"Reference ${index}","xrefDetail":"Detail ${index}","xrefTarget":"history-viewport"}-->`
  ).join('\n\n')}
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();

  await page.locator('.editor-block-passive', { has: page.locator('[data-component-id="reference-0"]') }).click();
  let detail = page.locator('.editor-block[data-active-editor-block="true"] [data-field="block-xref-detail"]');
  await detail.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' changed');
  await expect(detail).toHaveText('Detail 0 changed');

  await page.evaluate(() => {
    const trace: Array<{ kind: string; text: string }> = [];
    (window as typeof window & { historyViewportTrace: typeof trace }).historyViewportTrace = trace;
    const originalScrollTo = HTMLElement.prototype.scrollTo;
    HTMLElement.prototype.scrollTo = function (...args: Parameters<HTMLElement['scrollTo']>) {
      const options = args[0];
      if (typeof options === 'object' && options?.behavior === 'smooth') {
        trace.push({
          kind: 'smooth-scroll',
          text: document.querySelector<HTMLElement>('[data-field="block-xref-detail"]')?.textContent ?? '',
        });
      }
      return originalScrollTo.apply(this, args);
    };
    const originalAnimate = Element.prototype.animate;
    Element.prototype.animate = function (...args: Parameters<Element['animate']>) {
      const animation = originalAnimate.apply(this, args);
      queueMicrotask(() => {
        if (animation.id.startsWith('hvy-history-')) {
          trace.push({ kind: animation.id, text: this.textContent ?? '' });
        }
      });
      return animation;
    };
  });
  await page.locator('.editor-shell .editor-tree').evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect.poll(() => detail.evaluate((node) => {
    const viewport = node.closest('.editor-tree')!.getBoundingClientRect();
    return node.getBoundingClientRect().bottom < viewport.top;
  })).toBe(true);
  const expectedUndoScrollTop = await detail.evaluate((node) => {
    const scrollContainer = node.closest<HTMLElement>('.editor-tree')!;
    const targetRect = node.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    return Math.max(
      0,
      scrollContainer.scrollTop
        + targetRect.top
        - containerRect.top
        - (scrollContainer.clientHeight - targetRect.height) / 2
    );
  });

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { historyViewportTrace?: Array<{ kind: string; text: string }> })
      .historyViewportTrace?.map(({ kind }) => kind) ?? []
  )).toEqual(['smooth-scroll']);
  expect(await page.evaluate(() =>
    (window as typeof window & { historyViewportTrace: Array<{ kind: string; text: string }> })
      .historyViewportTrace
  )).toEqual([
    { kind: 'smooth-scroll', text: 'Detail 0 changed' },
  ]);
  detail = page.locator('.editor-block[data-active-editor-block="true"] [data-field="block-xref-detail"]');
  await expect(detail).toHaveText('Detail 0');
  expect(await page.locator('.editor-shell .editor-tree').evaluate(
    (node, expectedScrollTop) => Math.abs(node.scrollTop - expectedScrollTop),
    expectedUndoScrollTop
  )).toBeLessThanOrEqual(1);
  expect(await detail.evaluate((node) => {
    const viewport = node.closest('.editor-tree')!.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    return rect.top >= viewport.top && rect.bottom <= viewport.bottom;
  })).toBe(true);

  await page.evaluate(() => {
    (window as typeof window & { historyViewportTrace: Array<{ kind: string; text: string }> })
      .historyViewportTrace.length = 0;
    document.querySelector<HTMLElement>('.editor-shell .editor-tree')!.scrollTop =
      document.querySelector<HTMLElement>('.editor-shell .editor-tree')!.scrollHeight;
  });
  await expect.poll(() => detail.evaluate((node) => {
    const viewport = node.closest('.editor-tree')!.getBoundingClientRect();
    return node.getBoundingClientRect().bottom < viewport.top;
  })).toBe(true);
  const expectedRedoScrollTop = await detail.evaluate((node) => {
    const scrollContainer = node.closest<HTMLElement>('.editor-tree')!;
    const targetRect = node.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    return Math.max(
      0,
      scrollContainer.scrollTop
        + targetRect.top
        - containerRect.top
        - (scrollContainer.clientHeight - targetRect.height) / 2
    );
  });

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y');
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { historyViewportTrace?: Array<{ kind: string; text: string }> })
      .historyViewportTrace?.map(({ kind }) => kind) ?? []
  )).toEqual(['smooth-scroll']);
  expect(await page.evaluate(() =>
    (window as typeof window & { historyViewportTrace: Array<{ kind: string; text: string }> })
      .historyViewportTrace
  )).toEqual([
    { kind: 'smooth-scroll', text: 'Detail 0' },
  ]);
  detail = page.locator('.editor-block[data-active-editor-block="true"] [data-field="block-xref-detail"]');
  await expect(detail).toHaveText('Detail 0 changed');
  expect(await page.locator('.editor-shell .editor-tree').evaluate(
    (node, expectedScrollTop) => Math.abs(node.scrollTop - expectedScrollTop),
    expectedRedoScrollTop
  )).toBeLessThanOrEqual(1);
});
