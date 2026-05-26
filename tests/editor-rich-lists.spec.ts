import { expect, test, type Page } from '@playwright/test';

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

test('checkbox action inserts a single inline checkbox without coercing content into a full checklist', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();
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

test('list action still creates a normal list without checkbox coercion', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();

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

  await activeEditorBlock.locator('[data-rich-action="list"]').click();

  await expect(editor.locator('ul')).toHaveCount(1);
  await expect(editor.locator('li')).toHaveCount(1);
  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(0);
});

test('list action converts every selected paragraph into bullets', async ({ page }) => {
  await openDefaultDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const activeEditorBlock = page.locator(activeEditorBlockSelector).first();
  const editor = activeEditorBlock.locator('.rich-editor').first();

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

  await page.keyboard.press('Tab');

  await expect(editor.locator('ul ul li')).toContainText('Child');

  await page.getByRole('button', { name: 'Done' }).first().click();
  await expect(page.locator('.editor-block-passive').first().locator('ul ul li')).toContainText('Child');

  await page.locator('[data-action="activate-block"]').first().click();
  await expect(page.locator(activeEditorBlockSelector).first().locator('.rich-editor').first().locator('ul ul li')).toContainText('Child');
});
