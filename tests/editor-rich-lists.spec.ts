import { expect, test, type Locator, type Page } from '@playwright/test';

const activeEditorBlockSelector = '.editor-block[data-active-editor-block="true"]';
const defaultDocumentText = 'This default HVY document is a lightweight workspace';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

async function openDefaultDocument(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.editor-block-passive').first()).toContainText(defaultDocumentText);
}

async function storeRichSelection(editor: Locator): Promise<void> {
  await editor.evaluate((node) => {
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
}

async function showAllTextControls(activeEditorBlock: Locator): Promise<void> {
  await activeEditorBlock.getByRole('button', { name: 'Show all text controls' }).first().click();
}

async function openNestedGridTextEditor(
  page: Page,
  answerText = 'Expected result'
): Promise<{ activeTextBlock: Locator; editor: Locator }> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:grid {"id":"answer-grid","gridColumns":2,"gridStackWidth":"never"}-->
  <!--hvy:grid:0 {"id":"answer-cell"}-->
   <!--hvy:text {"id":"answer-text"}-->
${answerText.split('\n').map((line) => `    ${line}`).join('\n')}

  <!--hvy:grid:1 {"id":"reference-cell"}-->
   <!--hvy:text {"id":"reference-text"}-->
    <!--hvy:radio-group expected result group-->
    ( ) Reference cell

    ( ) Second reference cell
    <!--hvy:radio-group-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive', {
    has: page.locator(':scope > .editor-block-content[data-component-id="answer-grid"]'),
  }).click();
  const firstVisibleAnswerText = answerText.split('\n').find((line) => !line.trim().startsWith('<!--'))
    ?.replace(/^(?:\[[ xX]\]|\([ xX]\))\s*/, '') ?? '';
  await page.locator('.grid-field-row .editor-block-passive', { hasText: firstVisibleAnswerText }).click();

  const activeTextBlock = page.locator('.editor-block[data-active-editor-block="true"]', {
    has: page.locator(':scope > .editor-block-content[data-component-id="answer-text"]'),
  });
  return { activeTextBlock, editor: activeTextBlock.locator('.rich-editor').first() };
}

test('checkbox action inserts a single inline checkbox without coercing content into a full checklist', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();
  await activeEditorBlock.getByRole('button', { name: 'Show all text controls' }).first().click();
  const editorHandle = await editor.elementHandle();
  expect(editorHandle).not.toBeNull();

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<p>First item</p><p>Second item</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await storeRichSelection(editor);
  await activeEditorBlock.getByRole('button', { name: 'Checkbox' }).click();

  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(editor.locator('p').nth(0)).toHaveClass(/hvy-inline-checkbox-line/);
  await expect(editor.locator('p').nth(0)).toContainText('First item');
  await expect(editor.locator('p').nth(1)).toContainText('Second item');
  await expect(editor.locator('ul, li')).toHaveCount(0);
});

test('checkbox action inserts a checkbox at the current line and backspace removes it', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();
  await activeEditorBlock.getByRole('button', { name: 'Show all text controls' }).first().click();

  await editor.evaluate((node) => {
    node.focus();
    node.innerHTML = '<p>Draft task</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await storeRichSelection(editor);
  await activeEditorBlock.getByRole('button', { name: 'Checkbox' }).click();

  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(editor.locator('p').first()).toHaveClass(/hvy-inline-checkbox-line/);
  await expect(editor.locator('p').first()).toContainText('Draft task');

  const caret = await editor.evaluate((node) => {
    const selection = window.getSelection();
    const anchorNode = selection?.anchorNode;
    return {
      anchorText: anchorNode?.textContent ?? '',
      offset: selection?.anchorOffset ?? -1,
    };
  });
  expect(caret.anchorText.startsWith('Draft task')).toBe(true);
  expect(caret.offset).toBe(0);

  await editor.evaluate((node) => {
    node.focus();
    const textNode = Array.from(node.querySelector('p')?.childNodes ?? []).find(
      (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').includes('Draft task')
    );
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await editor.focus();
  await page.keyboard.press('Backspace');

  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(0);
  await expect(editor.locator('p')).toHaveCount(1);
});

test('a checkbox inserted inside a grid can immediately be changed to a radio', async ({ page }) => {
  const { activeTextBlock, editor } = await openNestedGridTextEditor(page);
  await activeTextBlock.getByRole('button', { name: 'Show all text controls' }).first().click();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Expected result</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const text = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await storeRichSelection(editor);

  await activeTextBlock.getByRole('button', { name: 'Checkbox' }).click();
  await editor.locator('input.hvy-inline-checkbox').click();

  const answerType = activeTextBlock.getByRole('dialog', { name: 'Selected answer block type' });
  await expect(answerType).toBeVisible();
  const expectedGroup = answerType.locator('.choice-mode-group-option', { hasText: 'expected result group' });
  await expect(expectedGroup).toBeVisible();
  expect(await expectedGroup.locator('span').evaluate((label) => {
    const range = document.createRange();
    range.selectNodeContents(label);
    return range.getClientRects().length;
  })).toBe(1);
  await expectedGroup.click();

  await expect(activeTextBlock.locator('.rich-editor input[type="radio"]')).toHaveCount(1);
});

test('changing one checkbox to a radio leaves neighboring answers unchanged', async ({ page }) => {
  const { activeTextBlock, editor } = await openNestedGridTextEditor(page, '[ ] Foo\n[ ] Bar\n[ ] Moo');
  await editor.locator('input.hvy-inline-checkbox').first().click();

  const answerType = activeTextBlock.getByRole('dialog', { name: 'Selected answer block type' });
  await answerType.locator('[data-field="inline-answer-new-group"]').click();
  await expect(answerType.locator('.choice-mode-name-input')).not.toHaveAttribute('placeholder');
  await expect(answerType.locator('.choice-mode-name-input')).toHaveValue('');
  await answerType.locator('.choice-mode-name-input').fill('expected group');
  await answerType.locator('.choice-mode-name-confirm').click();

  await expect(editor.locator('input.hvy-inline-checkbox')).toHaveCount(3);
  expect(await editor.locator('input.hvy-inline-checkbox').evaluateAll((inputs) => (
    inputs.map((input) => (input as HTMLInputElement).type)
  ))).toEqual(['radio', 'checkbox', 'checkbox']);
});

test('assigning an existing radio group preserves the active editor, caret, and scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 560 });
  const { activeTextBlock, editor } = await openNestedGridTextEditor(page, '[ ] Foo\n[ ] Bar');
  const editorHandle = await editor.elementHandle();
  expect(editorHandle).not.toBeNull();
  const editorTree = page.locator('#editorTree');
  await editor.locator('input.hvy-inline-checkbox').first().click();
  const existingGroup = activeTextBlock.getByRole('dialog', { name: 'Selected answer block type' })
    .locator('.choice-mode-group-option', { hasText: 'expected result group' });
  await expect(existingGroup).toBeVisible();
  await existingGroup.scrollIntoViewIfNeeded();
  const scrollBefore = await editorTree.evaluate((node) => node.scrollTop);
  const renderCountBefore = await page.evaluate(async () => (await import('/src/state.ts')).renderCount);

  await existingGroup.click();

  expect(await page.evaluate(async () => (await import('/src/state.ts')).renderCount)).toBe(renderCountBefore);
  expect(await editorHandle!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((node) => {
    const selection = window.getSelection();
    return Boolean(selection?.anchorNode && node.contains(selection.anchorNode));
  })).toBe(true);
  expect(await editorTree.evaluate((node) => node.scrollTop)).toBe(scrollBefore);
});

test('creating a radio group preserves the active editor, caret, and scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 560 });
  const { activeTextBlock, editor } = await openNestedGridTextEditor(page, '[ ] Foo\n[ ] Bar');
  const editorHandle = await editor.elementHandle();
  expect(editorHandle).not.toBeNull();
  const editorTree = page.locator('#editorTree');
  await editor.locator('input.hvy-inline-checkbox').nth(1).click();
  const answerType = activeTextBlock.getByRole('dialog', { name: 'Selected answer block type' });
  await answerType.locator('[data-field="inline-answer-new-group"]').click();
  await answerType.locator('.choice-mode-name-input').fill('new group');
  const scrollBefore = await editorTree.evaluate((node) => node.scrollTop);
  const renderCountBefore = await page.evaluate(async () => (await import('/src/state.ts')).renderCount);
  await answerType.locator('.choice-mode-name-confirm').click();

  expect(await page.evaluate(async () => (await import('/src/state.ts')).renderCount)).toBe(renderCountBefore);
  expect(await editorHandle!.evaluate((node) => node.isConnected)).toBe(true);
  await expect(editor).toBeFocused();
  expect(await editor.evaluate((node) => {
    const selection = window.getSelection();
    return Boolean(selection?.anchorNode && node.contains(selection.anchorNode));
  })).toBe(true);
  expect(await editorTree.evaluate((node) => node.scrollTop)).toBe(scrollBefore);
});

test('radio conversion preserves a caret away from the selected answer', async ({ page }) => {
  const { activeTextBlock, editor } = await openNestedGridTextEditor(page, '[ ] Foo\n[ ] Bar');
  await editor.locator('input.hvy-inline-checkbox').first().click();
  const existingGroup = activeTextBlock.getByRole('dialog', { name: 'Selected answer block type' })
    .locator('.choice-mode-group-option', { hasText: 'expected result group' });
  await expect(existingGroup).toBeVisible();
  await editor.evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let text = walker.nextNode();
    while (text && !(text.textContent ?? '').includes('Bar')) text = walker.nextNode();
    const range = document.createRange();
    range.setStart(text!, 2);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await existingGroup.click();

  expect(await editor.evaluate(() => ({
    text: window.getSelection()?.anchorNode?.textContent,
    offset: window.getSelection()?.anchorOffset,
  }))).toEqual({ text: ' Bar', offset: 2 });
});

test('checkboxes inserted on bare grid text lines use consistently aligned row containers', async ({ page }) => {
  const { activeTextBlock, editor } = await openNestedGridTextEditor(page);
  await activeTextBlock.getByRole('button', { name: 'Show all text controls' }).first().click();

  await editor.evaluate((node) => {
    node.innerHTML = 'Expected result<div></div><div>Second result</div>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(node.firstChild!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await storeRichSelection(editor);
  await activeTextBlock.getByRole('button', { name: 'Checkbox' }).click();

  await editor.evaluate((node) => {
    const text = node.querySelector('div:last-child')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await storeRichSelection(editor);
  await activeTextBlock.getByRole('button', { name: 'Checkbox' }).click();

  const expectedResult = await editor.evaluate((node) => Array.from(
    node.querySelectorAll<HTMLInputElement>('input.hvy-inline-checkbox')
  ).map((input) => ({
      parentIsEditor: input.parentElement === node,
      rowClass: input.parentElement?.classList.contains('hvy-inline-checkbox-line') ?? false,
  })));
  expect(expectedResult).toEqual([
    { parentIsEditor: false, rowClass: true },
    { parentIsEditor: false, rowClass: true },
  ]);
});

test('radio rows use consistent margins across markdown line and paragraph boundaries', async ({ page }) => {
  const { activeTextBlock } = await openNestedGridTextEditor(page);
  await activeTextBlock.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.grid-field-row .editor-block-passive', { hasText: 'Second reference cell' }).click();

  const referenceEditor = page.locator('.editor-block[data-active-editor-block="true"]', {
    has: page.locator(':scope > .editor-block-content[data-component-id="reference-text"]'),
  }).locator('.rich-editor');
  const expectedResult = await referenceEditor.locator('.hvy-inline-checkbox-line').evaluateAll((rows) => rows.map((row) => {
    const inputBox = row.querySelector('input.hvy-inline-checkbox')!.getBoundingClientRect();
    const textNode = [...row.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0
    )!;
    const textRange = document.createRange();
    textRange.selectNodeContents(textNode);
    const textBox = textRange.getBoundingClientRect();
    return {
      tagName: row.tagName,
      marginTop: getComputedStyle(row).marginTop,
      marginBottom: getComputedStyle(row).marginBottom,
      centerDelta: Math.abs(
        ((inputBox.top + inputBox.bottom) / 2) - ((textBox.top + textBox.bottom) / 2)
      ),
    };
  }));
  expect(expectedResult).toEqual([
    { tagName: 'P', marginTop: '0px', marginBottom: '0px', centerDelta: expect.any(Number) },
    { tagName: 'P', marginTop: '0px', marginBottom: '0px', centerDelta: expect.any(Number) },
  ]);
  expect(expectedResult.every(({ centerDelta }) => centerDelta <= 1)).toBe(true);
});

test('the caret beside an answer control uses the editor text color', async ({ page }) => {
  const { activeTextBlock } = await openNestedGridTextEditor(page);
  await activeTextBlock.getByRole('button', { name: 'Done', exact: true }).click();
  await page.locator('.grid-field-row .editor-block-passive', { hasText: 'Reference cell' }).click();

  const editor = page.locator('.editor-block[data-active-editor-block="true"]', {
    has: page.locator(':scope > .editor-block-content[data-component-id="reference-text"]'),
  }).locator('.rich-editor');
  const expectedResult = await editor.evaluate((node) => {
    const row = node.querySelector<HTMLElement>('.hvy-inline-checkbox-line')!;
    const input = row.querySelector('input.hvy-inline-checkbox')!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(row, [...row.childNodes].indexOf(input));
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    node.focus();
    return {
      caretColor: getComputedStyle(row).caretColor,
      controlColor: getComputedStyle(input).color,
      textColor: getComputedStyle(row).color,
    };
  });
  expect(expectedResult).toEqual({
    caretColor: expectedResult.textColor,
    controlColor: expectedResult.textColor,
    textColor: expectedResult.textColor,
  });
});

test('the caret can stay left of an answer control without overlapping it', async ({ page }) => {
  const { editor } = await openNestedGridTextEditor(page, '[ ] Expected result');
  const expectedResult = await editor.evaluate((node) => {
    const answerRow = node.querySelector<HTMLElement>('.hvy-inline-checkbox-line')!;
    const walker = document.createTreeWalker(answerRow, NodeFilter.SHOW_TEXT);
    let label: Node | null = walker.nextNode();
    while (label && !(label.textContent ?? '').includes('Expected result')) label = walker.nextNode();
    node.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(label!, 1);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowLeft' }));
    const anchor = selection?.anchorNode;
    const control = answerRow.querySelector<HTMLInputElement>('input.hvy-inline-checkbox')!;
    return {
      caretIsBeforeControl: Boolean(
        selection?.rangeCount
        && selection.getRangeAt(0).startContainer === control.parentNode
        && selection.getRangeAt(0).startOffset === [...control.parentNode!.childNodes].indexOf(control)
      ),
      controlClearance: control.getBoundingClientRect().left - answerRow.getBoundingClientRect().left,
      selectionIsInsideEditor: Boolean(anchor && node.contains(anchor)),
    };
  });
  expect({
    caretIsBeforeControl: expectedResult.caretIsBeforeControl,
    selectionIsInsideEditor: expectedResult.selectionIsInsideEditor,
  }).toEqual({
    caretIsBeforeControl: true,
    selectionIsInsideEditor: true,
  });
  expect(expectedResult.controlClearance).toBeGreaterThanOrEqual(3);
});

test('clicking right of an empty trailing radio places the caret after the control', async ({ page }) => {
  const { editor } = await openNestedGridTextEditor(
    page,
    '<!--hvy:radio-group expected group-->\n( ) Foo\n( )\n<!--hvy:radio-group-->'
  );
  const emptyRow = editor.locator('.hvy-inline-checkbox-line').last();
  await emptyRow.scrollIntoViewIfNeeded();
  const inputBox = await emptyRow.locator('input.hvy-inline-checkbox').boundingBox();
  expect(inputBox).not.toBeNull();
  await page.mouse.click(inputBox!.x + inputBox!.width + 24, inputBox!.y + inputBox!.height / 2);

  const expectedResult = await emptyRow.evaluate((row) => {
    const input = row.querySelector<HTMLInputElement>('input.hvy-inline-checkbox')!;
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const anchor = range?.startContainer ?? null;
    const anchorProbe = range?.cloneRange() ?? null;
    if (anchorProbe && anchor instanceof Text && range!.startOffset > 0) {
      anchorProbe.setStart(anchor, range!.startOffset - 1);
    }
    return {
      caretIsAfterControl: anchor instanceof Text
        && anchor.previousSibling === input
        && range?.startOffset === anchor.length,
      caretLeft: anchorProbe?.getBoundingClientRect().right ?? 0,
      inputRight: input.getBoundingClientRect().right,
      selectionIsInEmptyRow: Boolean(anchor && row.contains(anchor)),
    };
  });
  expect({
    caretIsAfterControl: expectedResult.caretIsAfterControl,
    selectionIsInEmptyRow: expectedResult.selectionIsInEmptyRow,
  }).toEqual({
    caretIsAfterControl: true,
    selectionIsInEmptyRow: true,
  });
  expect(expectedResult.caretLeft).toBeGreaterThanOrEqual(expectedResult.inputRight);
  await page.keyboard.type('Expected result');
  await expect(emptyRow).toContainText('Expected result');
});

test('down left up navigation stays inside answer content and returns to the previous line', async ({ page }) => {
  const { editor } = await openNestedGridTextEditor(page, '<!--hvy:radio-group expected group-->\n( ) Foo\n( ) Bar\n( ) Moo ( ) Cow\n<!--hvy:radio-group-->');
  const expectedResult = await editor.evaluate((node) => {
    const control = node.querySelector<HTMLInputElement>('.hvy-inline-checkbox-line input.hvy-inline-checkbox')!;
    node.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStartBefore(control);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const readCaretPosition = () => {
      const activeSelection = window.getSelection();
      const anchor = activeSelection?.anchorNode;
      let directChild = anchor instanceof Element ? anchor : anchor?.parentElement;
      while (directChild?.parentElement && directChild.parentElement !== node) {
        directChild = directChild.parentElement;
      }
      const activeRange = activeSelection?.rangeCount ? activeSelection.getRangeAt(0) : null;
      const activeControl = directChild?.querySelector('input.hvy-inline-checkbox') ?? null;
      const controlIndex = activeControl?.parentNode
        ? [...activeControl.parentNode.childNodes].indexOf(activeControl)
        : -1;
      return {
        activeElementIsEditor: document.activeElement === node,
        caretBlockIndex: [...node.children].indexOf(directChild as Element),
        caretIsBeforeControl: Boolean(
          activeRange
          && activeControl
          && (
            activeRange.startContainer === activeControl.parentNode && activeRange.startOffset === controlIndex
          )
        ),
        selectionIsInsideEditor: Boolean(anchor && node.contains(anchor)),
      };
    };
    const press = (key: string) => node.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key,
    }));
    const beforeDown = readCaretPosition();
    press('ArrowDown');
    const afterDown = readCaretPosition();
    press('ArrowLeft');
    const afterLeft = readCaretPosition();
    press('ArrowUp');
    const afterUp = readCaretPosition();
    return { beforeDown, afterDown, afterLeft, afterUp };
  });

  expect(expectedResult).toEqual({
    beforeDown: { activeElementIsEditor: true, caretBlockIndex: 0, caretIsBeforeControl: true, selectionIsInsideEditor: true },
    afterDown: { activeElementIsEditor: true, caretBlockIndex: 1, caretIsBeforeControl: true, selectionIsInsideEditor: true },
    afterLeft: { activeElementIsEditor: true, caretBlockIndex: 1, caretIsBeforeControl: true, selectionIsInsideEditor: true },
    afterUp: { activeElementIsEditor: true, caretBlockIndex: 0, caretIsBeforeControl: true, selectionIsInsideEditor: true },
  });
});

test('enter at the start of a radio label inserts a line without splitting the answer row', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:text {"id":"answers"}-->
  <!--hvy:radio-group expected result group-->
  ( ) Expected result
  <!--hvy:radio-group-->

  [ ] Second result
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Expected result' }).click();

  const editor = page.locator('.editor-block[data-active-editor-block="true"]', {
    has: page.locator(':scope > .editor-block-content[data-component-id="answers"]'),
  }).locator('.rich-editor');
  const radioRow = editor.locator('.hvy-inline-checkbox-line').first();
  const afterEnter = await editor.evaluate((node) => {
    const row = node.querySelector<HTMLElement>('.hvy-inline-checkbox-line')!;
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    let label: Node | null = walker.nextNode();
    while (label && (
      !(label.textContent ?? '').includes('Expected result')
      || label.parentElement?.closest('.hvy-radio-group-marker')
    )) label = walker.nextNode();
    node.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(label!, label?.textContent?.startsWith(' ') ? 1 : 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    node.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' }));
    const selectionElement = selection?.anchorNode instanceof Element
      ? selection.anchorNode
      : selection?.anchorNode?.parentElement;
    return {
      caretBlockIndex: [...node.children].indexOf(selectionElement?.closest('p') as Element),
      children: [...node.children].map((child) => ({
        answerRow: child.classList.contains('hvy-inline-checkbox-line'),
        text: (child.textContent ?? '').replaceAll('\u200b', '').replace(/\s+/g, ' ').trim(),
        inputs: [...child.querySelectorAll<HTMLInputElement>('input.hvy-inline-checkbox')].map((input) => input.type),
        groupStarts: child.querySelectorAll('.hvy-radio-group-marker:not(.is-group-end)').length,
        groupEnds: child.querySelectorAll('.hvy-radio-group-marker.is-group-end').length,
      })),
    };
  });
  expect(afterEnter).toEqual({
    caretBlockIndex: 0,
    children: [
      { answerRow: false, text: '', inputs: [], groupStarts: 0, groupEnds: 0 },
      { answerRow: true, text: 'expected result group Expected result end group', inputs: ['radio'], groupStarts: 1, groupEnds: 1 },
      { answerRow: true, text: 'Second result', inputs: ['checkbox'], groupStarts: 0, groupEnds: 0 },
    ],
  });

  await editor.press('Backspace');
  await expect(radioRow.locator('input[type="radio"]')).toHaveCount(1);
  await expect(radioRow.locator('.hvy-radio-group-marker.is-group-end')).toHaveCount(1);
  await expect(radioRow).toContainText('Expected result');
});

test('empty toolbar answer rows keep line geometry and survive radio conversion as separate lines', async ({ page }) => {
  const { activeTextBlock, editor } = await openNestedGridTextEditor(page, '[ ] Foo\n[ ] Bar');
  await activeTextBlock.getByRole('button', { name: 'Show all text controls' }).first().click();

  const barRow = editor.locator('.hvy-inline-checkbox-line', { hasText: 'Bar' });
  await barRow.click();
  await editor.press('End');
  await editor.press('Enter');
  await editor.press('Enter');
  await activeTextBlock.getByRole('button', { name: 'Checkbox', exact: true }).click();

  const emptyRow = editor.locator('.hvy-inline-checkbox-line').last();
  const emptyRowHasLineHeight = await emptyRow.evaluate((row) => {
    const style = getComputedStyle(row);
    return row.getBoundingClientRect().height >= Number.parseFloat(style.lineHeight) - 1;
  });

  await editor.type('Moo');
  await editor.press('End');
  await editor.press('Enter');
  await activeTextBlock.getByRole('button', { name: 'Checkbox', exact: true }).click();
  await editor.type('Cow');
  await editor.press('End');
  await editor.press('Enter');
  await activeTextBlock.getByRole('button', { name: 'Checkbox', exact: true }).click();

  const populatedRowGeometry = await editor.locator('.hvy-inline-checkbox-line').evaluateAll((rows) => rows.filter((row) => (
    row.querySelector('input.hvy-inline-checkbox')
    && [...row.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0)
  )).slice(0, 4).map((row) => {
    const inputBox = row.querySelector('input.hvy-inline-checkbox')!.getBoundingClientRect();
    const textNode = [...row.childNodes].find(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 0
    )!;
    const textRange = document.createRange();
    textRange.selectNodeContents(textNode);
    const textBox = textRange.getBoundingClientRect();
    return {
      inputLeft: inputBox.left,
      textLeft: textBox.left,
      centerDelta: Math.abs(
        ((inputBox.top + inputBox.bottom) / 2) - ((textBox.top + textBox.bottom) / 2)
      ),
    };
  }));
  const firstPopulatedRow = populatedRowGeometry[0]!;
  const populatedRowsAreAligned = populatedRowGeometry.every((row) => (
    Math.abs(row.inputLeft - firstPopulatedRow.inputLeft) <= 1
    && Math.abs(row.textLeft - firstPopulatedRow.textLeft) <= 1
    && row.centerDelta <= 1
  ));

  await editor.locator('input.hvy-inline-checkbox').first().click();
  const answerType = activeTextBlock.getByRole('dialog', { name: 'Selected answer block type' });
  await answerType.locator('[data-field="inline-answer-new-group"]').click();
  await answerType.locator('.choice-mode-name-input').fill('animals');
  await answerType.locator('.choice-mode-name-confirm').click();

  const rowTexts = await editor.locator('.hvy-inline-checkbox-line').evaluateAll((rows) => rows.map((row) => (
    (row as HTMLElement).innerText ?? ''
  ).replaceAll('\u200b', '').trim()));

  await page.getByRole('button', { name: 'Raw' }).click();
  const sourceText = await page.locator('#rawEditor').inputValue();
  expect({
    emptyRowHasLineHeight,
    populatedRowsAreAligned,
    rowTexts,
    insertedMarkersHaveSeparators: sourceText.includes('[ ] Moo\n    [ ] Cow\n    [ ]'),
  }).toEqual({
    emptyRowHasLineHeight: true,
    populatedRowsAreAligned: true,
    rowTexts: ['Foo', 'Bar', 'Moo', 'Cow', ''],
    insertedMarkersHaveSeparators: true,
  });
});

test('a checkbox added to a new empty text component consumes the placeholder line', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:text {"id":"existing-text"}-->
  Existing
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.editor-block-passive', { hasText: 'Existing' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Section component type' }).click();
  await page.getByRole('button', { name: 'Text multipurpose' }).click();

  const activeTextBlock = page.locator('.editor-block[data-active-editor-block="true"]', {
    has: page.locator('.rich-editor'),
  });
  const editor = activeTextBlock.locator('.rich-editor');
  await activeTextBlock.getByRole('button', { name: 'Show all text controls' }).first().click();
  await activeTextBlock.getByRole('button', { name: 'Checkbox', exact: true }).click();

  const expectedResult = await editor.evaluate((node) => {
    const editorBox = node.getBoundingClientRect();
    const row = node.querySelector<HTMLElement>(':scope > .hvy-inline-checkbox-line');
    const rowBox = row?.getBoundingClientRect();
    return {
      childElements: [...node.children].map((child) => (
        child.matches('.hvy-inline-checkbox-line') ? 'answer-row' : child.tagName
      )),
      inputIsInRow: Boolean(row?.querySelector(':scope > input.hvy-inline-checkbox')),
      rowStartsAtEditorPadding: Boolean(rowBox)
        && rowBox!.top - editorBox.top <= Number.parseFloat(getComputedStyle(node).paddingTop) + 2,
    };
  });
  expect(expectedResult).toEqual({
    childElements: ['answer-row'],
    inputIsInRow: true,
    rowStartsAtEditorPadding: true,
  });
});

test('list action still creates a normal list without checkbox coercion', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();
  await showAllTextControls(activeEditorBlock);

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<p>Plain item</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    range.collapse(false);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await storeRichSelection(editor);

  await activeEditorBlock.locator('[data-rich-action="list"]').click();

  await expect(editor.locator('ul')).toHaveCount(1);
  await expect(editor.locator('li')).toHaveCount(1);
  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(0);
});

test('list action converts the first paragraph when the caret is on the first line', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();
  await showAllTextControls(activeEditorBlock);

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<p>First item</p><p>Second item</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await storeRichSelection(editor);

  await activeEditorBlock.locator('[data-rich-action="list"]').click();

  const expectedResult = await editor.evaluate((node) => ({
    listCount: node.querySelectorAll('ul').length,
    items: Array.from(node.querySelectorAll('li')).map((item) => item.textContent ?? ''),
    paragraphs: Array.from(node.querySelectorAll('p')).map((paragraph) => paragraph.textContent ?? ''),
  }));
  expect(expectedResult).toEqual({
    listCount: 1,
    items: ['First item'],
    paragraphs: ['Second item'],
  });
});

test('list action creates a bullet on an empty first line', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();
  await showAllTextControls(activeEditorBlock);

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<p><br></p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await storeRichSelection(editor);

  await activeEditorBlock.locator('[data-rich-action="list"]').click();

  const expectedResult = await editor.evaluate((node) => ({
    listCount: node.querySelectorAll('ul').length,
    itemCount: node.querySelectorAll('li').length,
    paragraphCount: node.querySelectorAll('p').length,
    text: (node.querySelector('li')?.textContent ?? '').replace(/\u200b/g, ''),
  }));
  expect(expectedResult).toEqual({
    listCount: 1,
    itemCount: 1,
    paragraphCount: 0,
    text: '',
  });
});

test('list action works after clicking into the first visible line', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();
  await showAllTextControls(activeEditorBlock);

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<p>First item</p><p>Second item</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await editor.locator('p').first().click({ position: { x: 4, y: 8 } });

  await activeEditorBlock.locator('[data-rich-action="list"]').click();

  const expectedResult = await editor.evaluate((node) => ({
    listCount: node.querySelectorAll('ul').length,
    items: Array.from(node.querySelectorAll('li')).map((item) => item.textContent ?? ''),
    paragraphs: Array.from(node.querySelectorAll('p')).map((paragraph) => paragraph.textContent ?? ''),
  }));
  expect(expectedResult).toEqual({
    listCount: 1,
    items: ['First item'],
    paragraphs: ['Second item'],
  });
});

test('list action converts bare first-line editor text into a bullet', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();
  await showAllTextControls(activeEditorBlock);

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.textContent = 'First item';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = node.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await storeRichSelection(editor);

  await activeEditorBlock.locator('[data-rich-action="list"]').click();

  const expectedResult = await editor.evaluate((node) => ({
    listCount: node.querySelectorAll('ul').length,
    items: Array.from(node.querySelectorAll('li')).map((item) => item.textContent ?? ''),
    directText: Array.from(node.childNodes)
      .filter((child) => child.nodeType === Node.TEXT_NODE)
      .map((child) => child.textContent ?? '')
      .filter((text) => text.trim().length > 0),
  }));
  expect(expectedResult).toEqual({
    listCount: 1,
    items: ['First item'],
    directText: [],
  });
});

test('pasting a list item selected from the previous bullet boundary keeps it as a sibling bullet', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();

  const expectedResult = await editor.evaluate((node) => {
    node.innerHTML = '<ul><li>Alpha bullet</li><li>Bravo bullet</li><li>Charlie bullet</li></ul>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    node.focus();

    const first = node.querySelectorAll('li')[0].firstChild!;
    const second = node.querySelectorAll('li')[1].firstChild!;
    const selectedRange = document.createRange();
    selectedRange.setStart(first, first.textContent!.length);
    selectedRange.setEnd(second, second.textContent!.length);
    const selectedContainer = document.createElement('div');
    selectedContainer.appendChild(selectedRange.cloneContents());
    const selectedText = selectedRange.toString();

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(selectedRange);
    selectedRange.deleteContents();
    node.querySelectorAll('li').forEach((item) => {
      if ((item.textContent ?? '').trim().length === 0) {
        item.remove();
      }
    });
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));

    const pasteRange = document.createRange();
    pasteRange.selectNodeContents(node.querySelectorAll('li')[0]);
    pasteRange.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(pasteRange);

    const transfer = new DataTransfer();
    transfer.setData('text/html', selectedContainer.innerHTML);
    transfer.setData('text/plain', selectedText);
    const pasteEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste',
    });
    Object.defineProperty(pasteEvent, 'dataTransfer', { value: transfer });
    node.dispatchEvent(pasteEvent);

    return {
      pastedHtml: selectedContainer.innerHTML,
      html: node.innerHTML,
      items: Array.from(node.querySelectorAll('li')).map((item) => item.textContent),
      nestedItemCount: node.querySelectorAll('li li').length,
    };
  });

  expect(expectedResult).toEqual({
    pastedHtml: '<li></li><li>Bravo bullet</li>',
    html: '<ul><li>Alpha bullet</li><li>Bravo bullet</li><li>Charlie bullet</li></ul>',
    items: ['Alpha bullet', 'Bravo bullet', 'Charlie bullet'],
    nestedItemCount: 0,
  });
});

test('list action converts every selected paragraph into bullets', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();
  await showAllTextControls(activeEditorBlock);

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<p>Alpha item</p><p>Beta item</p><p>Gamma item</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const paragraphs = node.querySelectorAll('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(paragraphs[0]!.firstChild!, 0);
    range.setEnd(paragraphs[2]!.firstChild!, paragraphs[2]!.textContent!.length);
    selection?.removeAllRanges();
    selection?.addRange(range);
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  await activeEditorBlock.locator('[data-rich-action="list"]').click();

  const expectedResult = await editor.evaluate((node) => ({
    listCount: node.querySelectorAll('ul').length,
    items: Array.from(node.querySelectorAll('li')).map((item) => item.textContent ?? ''),
    paragraphCount: node.querySelectorAll('p').length,
  }));
  expect(expectedResult).toEqual({
    listCount: 1,
    items: ['Alpha item', 'Beta item', 'Gamma item'],
    paragraphCount: 0,
  });
});

test('numbered list action converts selected paragraphs into ordered list items', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();
  await showAllTextControls(activeEditorBlock);

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<p>Alpha item</p><p>Beta item</p><p>Gamma item</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const paragraphs = node.querySelectorAll('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(paragraphs[0]!.firstChild!, 0);
    range.setEnd(paragraphs[2]!.firstChild!, paragraphs[2]!.textContent!.length);
    selection?.removeAllRanges();
    selection?.addRange(range);
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  await activeEditorBlock.locator('[data-rich-action="ordered-list"]').click();

  const expectedResult = await editor.evaluate((node) => ({
    orderedListCount: node.querySelectorAll('ol').length,
    unorderedListCount: node.querySelectorAll('ul').length,
    items: Array.from(node.querySelectorAll('li')).map((item) => item.textContent ?? ''),
    paragraphCount: node.querySelectorAll('p').length,
  }));
  expect(expectedResult).toEqual({
    orderedListCount: 1,
    unorderedListCount: 0,
    items: ['Alpha item', 'Beta item', 'Gamma item'],
    paragraphCount: 0,
  });
});

test('tab nests numbered list items as ordered alpha subitems', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<ol><li>Parent</li><li>Child</li></ol>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = node.querySelectorAll('li')[1]?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await page.keyboard.press('Tab');

  await expect(editor.locator('ol ol li')).toContainText('Child');
  await expect(editor.locator('ul')).toHaveCount(0);
  await expect(editor.locator('ol ol')).toHaveCSS('list-style-type', 'lower-alpha');
});

test('tab indents list items inside the rich editor', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<ul><li>Parent</li><li>Child</li></ul>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = node.querySelectorAll('li')[1]?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await editor.focus();
  await page.keyboard.press('Tab');

  await expect(editor.locator('ul ul li')).toContainText('Child');

  await page.getByRole('button', { name: 'Done' }).first().click();
  await expect(page.locator('.editor-block-passive').first().locator('ul ul li')).toContainText('Child');

  await page.locator('[data-action="activate-block"]').first().click();
  await expect(page.locator(activeEditorBlockSelector).first().locator('.rich-editor').first().locator('ul ul li')).toContainText('Child');
});

test('enter on an empty trailing bullet exits the list', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<ul><li>Parent</li><li><br></li></ul>';
    const emptyItem = node.querySelectorAll('li')[1];
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(emptyItem!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await editor.evaluate((node) => {
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });

  const expectedResult = await editor.evaluate((node) => {
    const anchorNode = window.getSelection()?.anchorNode;
    return {
      listItems: Array.from(node.querySelectorAll('li')).map((item) => item.textContent ?? ''),
      paragraphCount: node.querySelectorAll('p').length,
      html: node.innerHTML,
      caretBlock: anchorNode instanceof Element
        ? anchorNode.closest('p, li')?.tagName
        : anchorNode?.parentElement?.closest('p, li')?.tagName,
    };
  });
  expect(expectedResult.listItems).toEqual(['Parent']);
  expect(expectedResult.paragraphCount).toBe(1);
  expect(expectedResult.html).not.toContain('<li><br></li><li>');
  expect(expectedResult.caretBlock).toBe('P');
});

test('enter on an empty middle bullet splits the list', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<ul><li>Before</li><li><br></li><li>After</li></ul>';
    const emptyItem = node.querySelectorAll('li')[1];
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(emptyItem!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await editor.focus();
  await page.keyboard.press('Enter');

  const expectedResult = await editor.evaluate((node) => {
    const anchorNode = window.getSelection()?.anchorNode;
    return {
      childTags: Array.from(node.children).map((child) => child.tagName),
      lists: Array.from(node.querySelectorAll('ul')).map((list) =>
        Array.from(list.querySelectorAll(':scope > li')).map((item) => item.textContent ?? '')
      ),
      paragraphCount: node.querySelectorAll(':scope > p').length,
      caretBlock: anchorNode instanceof Element
        ? anchorNode.closest('p, li')?.tagName
        : anchorNode?.parentElement?.closest('p, li')?.tagName,
    };
  });
  expect(expectedResult).toEqual({
    childTags: ['UL', 'P', 'UL'],
    lists: [['Before'], ['After']],
    paragraphCount: 1,
    caretBlock: 'P',
  });
});

test('enter on a nested empty bullet escapes indentation and splits the root list', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<ul><li>Before<ul><li>Nested before</li><li><br></li><li>Nested after</li></ul></li><li>After</li></ul>';
    const emptyItem = node.querySelectorAll('ul ul li')[1];
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(emptyItem!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await editor.focus();
  await page.keyboard.press('Enter');

  const expectedResult = await editor.evaluate((node) => {
    const escapeParagraph = node.querySelector(':scope > p');
    const anchorNode = window.getSelection()?.anchorNode;
    return {
      childTags: Array.from(node.children).map((child) => child.tagName),
      escapeIsIndented: Boolean(escapeParagraph?.closest('li')),
      rootParagraphCount: node.querySelectorAll(':scope > p').length,
      rootListTexts: Array.from(node.querySelectorAll(':scope > ul')).map((list) => list.textContent ?? ''),
      emptyWrapperBulletsAfterEscape: Array.from(node.querySelectorAll(':scope > p + ul > li')).filter((item) =>
        (item.firstChild instanceof HTMLUListElement || item.firstChild instanceof HTMLOListElement) &&
        Array.from(item.childNodes).every((child) =>
          child instanceof HTMLUListElement ||
          child instanceof HTMLOListElement ||
          child instanceof HTMLBRElement ||
          (child instanceof Text && child.data.replace(/\u200b/g, '').trim().length === 0)
        )
      ).length,
      caretBlock: anchorNode instanceof Element
        ? anchorNode.closest('p, li')?.tagName
        : anchorNode?.parentElement?.closest('p, li')?.tagName,
    };
  });
  expect(expectedResult).toEqual({
    childTags: ['UL', 'P', 'UL'],
    escapeIsIndented: false,
    rootParagraphCount: 1,
    rootListTexts: ['BeforeNested before', 'Nested afterAfter'],
    emptyWrapperBulletsAfterEscape: 0,
    caretBlock: 'P',
  });
});

test('enter on a nested empty bullet removes stale empty wrapper bullets from the continuation list', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<ul><li>Before<ul><li>Nested before</li><li><br></li><li><p><br></p><ul><li>Nested after</li></ul></li></ul></li><li>After</li></ul>';
    const emptyItem = node.querySelectorAll('ul ul li')[1];
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(emptyItem!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await editor.focus();
  await page.keyboard.press('Enter');

  const expectedResult = await editor.evaluate((node) => ({
    childTags: Array.from(node.children).map((child) => child.tagName),
    afterSplitRootItems: Array.from(node.querySelectorAll(':scope > p + ul > li')).map((item) => ({
      text: item.textContent ?? '',
      onlyWrapsNestedList: (item.firstElementChild instanceof HTMLUListElement || item.firstElementChild instanceof HTMLOListElement) &&
        Array.from(item.childNodes).every((child) =>
          child instanceof HTMLUListElement ||
          child instanceof HTMLOListElement ||
          child instanceof HTMLBRElement ||
          (child instanceof Text && child.data.replace(/\u200b/g, '').trim().length === 0)
        ),
    })),
  }));
  expect(expectedResult).toEqual({
    childTags: ['UL', 'P', 'UL'],
    afterSplitRootItems: [
      { text: 'Nested after', onlyWrapsNestedList: false },
      { text: 'After', onlyWrapsNestedList: false },
    ],
  });
});

test('enter on a nested empty bullet removes direct empty bullets from the continuation list', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<ul><li>Before<ul><li>Nested before</li><li><br></li><li><br></li><li>Nested after</li></ul></li><li>After</li></ul>';
    const emptyItem = node.querySelectorAll('ul ul li')[1];
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(emptyItem!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await editor.focus();
  await page.keyboard.press('Enter');

  const expectedResult = await editor.evaluate((node) => ({
    childTags: Array.from(node.children).map((child) => child.tagName),
    afterSplitRootItems: Array.from(node.querySelectorAll(':scope > p + ul > li')).map((item) => item.textContent ?? ''),
  }));
  expect(expectedResult).toEqual({
    childTags: ['UL', 'P', 'UL'],
    afterSplitRootItems: ['Nested after', 'After'],
  });
});

test('deleting a first-level item after a nested item removes the empty shell bullet', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<ul><li>Parent<ul><li>Child</li></ul></li><li>Delete me</li><li>After</li></ul>';
    const textNode = node.querySelectorAll(':scope > ul > li')[1]?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await editor.focus();
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(20);

  const expectedResult = await editor.evaluate((node) => ({
    rootItems: Array.from(node.querySelectorAll(':scope > ul > li')).map((item) => ({
      text: (item.textContent ?? '').replace(/\s+/g, ''),
      isEmpty: (item.textContent ?? '').replace(/\u200b/g, '').trim().length === 0,
      nestedCount: item.querySelectorAll('ul, ol').length,
    })),
  }));
  expect(expectedResult).toEqual({
    rootItems: [
      { text: 'ParentChild', isEmpty: false, nestedCount: 1 },
      { text: 'After', isEmpty: false, nestedCount: 0 },
    ],
  });
});

test('cutting selected first-level items after a nested item removes empty shell bullets', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native clipboard shortcut coverage is chromium-only here.');
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<ul><li>Parent<ul><li>Child</li></ul></li><li>Cut one</li><li>Cut two</li><li>After</li></ul>';
    const items = node.querySelectorAll(':scope > ul > li');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStartBefore(items[1]!);
    range.setEndAfter(items[2]!);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await editor.focus();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+X' : 'Control+X');
  await page.waitForTimeout(20);

  const expectedResult = await editor.evaluate((node) => ({
    rootItems: Array.from(node.querySelectorAll(':scope > ul > li')).map((item) => ({
      text: (item.textContent ?? '').replace(/\s+/g, ''),
      isEmpty: (item.textContent ?? '').replace(/\u200b/g, '').trim().length === 0,
      nestedCount: item.querySelectorAll('ul, ol').length,
    })),
  }));
  expect(expectedResult).toEqual({
    rootItems: [
      { text: 'ParentChild', isEmpty: false, nestedCount: 1 },
      { text: 'After', isEmpty: false, nestedCount: 0 },
    ],
  });
});

test('list action removes the current middle item without moving it above the list', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();
  await showAllTextControls(activeEditorBlock);

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<ul><li>Before</li><li>Plain line</li><li>After</li></ul>';
    const textNode = node.querySelectorAll('li')[1]?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await storeRichSelection(editor);

  await activeEditorBlock.locator('[data-rich-action="list"]').click();

  const expectedResult = await editor.evaluate((node) => ({
    childTags: Array.from(node.children).map((child) => child.tagName),
    lists: Array.from(node.querySelectorAll('ul')).map((list) =>
      Array.from(list.querySelectorAll(':scope > li')).map((item) => item.textContent ?? '')
    ),
    paragraphs: Array.from(node.querySelectorAll(':scope > p')).map((paragraph) => paragraph.textContent ?? ''),
  }));
  expect(expectedResult).toEqual({
    childTags: ['UL', 'P', 'UL'],
    lists: [['Before'], ['After']],
    paragraphs: ['Plain line'],
  });
});

test('text action flattens a heading inside a list item back into normal list item text', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();
  await showAllTextControls(activeEditorBlock);

  await editor.evaluate((node) => {
    (node as HTMLElement).focus();
    node.innerHTML = '<ul><li>Before</li><li><h2>Stuck heading</h2></li><li>After</li></ul>';
    const textNode = node.querySelector('h2')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, textNode!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await storeRichSelection(editor);

  await activeEditorBlock.locator('[data-rich-action="paragraph"]').click();

  const expectedResult = await editor.evaluate((node) => ({
    items: Array.from(node.querySelectorAll('li')).map((item) => item.textContent ?? ''),
    nestedParagraphCount: node.querySelectorAll('li p').length,
    headingCount: node.querySelectorAll('h2').length,
  }));
  expect(expectedResult).toEqual({
    items: ['Before', 'Stuck heading', 'After'],
    nestedParagraphCount: 0,
    headingCount: 0,
  });
});
