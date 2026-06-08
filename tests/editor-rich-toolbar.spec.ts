import { expect, test } from '@playwright/test';

const defaultDocumentText = 'This default HVY document is a lightweight workspace';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test('toolbar exposes quote and code block actions', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.editor-block-passive').first()).toContainText(defaultDocumentText);

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const quoteButton = page.locator('[data-rich-action="quote"]').first();
  const codeBlockButton = page.locator('[data-rich-action="code-block"]').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Quoted</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await quoteButton.click();
  await expect(editor.locator('blockquote')).toContainText('Quoted');
  await expect(quoteButton).toHaveClass(/secondary/);

  await quoteButton.click();
  await expect(editor.locator('blockquote')).toHaveCount(0);
  await expect(editor.locator('p')).toContainText('Quoted');
  await expect(quoteButton).not.toHaveClass(/secondary/);

  await editor.evaluate((node) => {
    node.innerHTML = '<p><br></p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await quoteButton.click();
  await expect(editor).toBeFocused();
  await page.keyboard.type('Quote typing works');
  await expect(editor.locator('blockquote')).toContainText('Quote typing works');
  await expect(quoteButton).toHaveClass(/secondary/);

  await editor.evaluate((node) => {
    node.innerHTML = '<p>plain</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, textNode!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await quoteButton.click();
  await expect(editor).toBeFocused();
  await page.keyboard.type(' quote tail');
  await expect(editor.locator('blockquote')).toContainText('plain quote tail');

  await editor.evaluate((node) => {
    node.innerHTML = '<blockquote></blockquote>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const quote = node.querySelector('blockquote');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(quote!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.keyboard.press('Backspace');
  await expect(editor.locator('blockquote')).toHaveCount(0);
  await expect(quoteButton).not.toHaveClass(/secondary/);

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Removed</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Strikethrough' }).first().click();
  await expect(editor.locator('s, strike, del')).toContainText('Removed');
  await expect(page.locator('[data-rich-action="link"] .link-icon').first()).toBeEmpty();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Underlined</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: 'Underline' }).first().click();
  await expect(editor.locator('u')).toContainText('Underlined');

  await editor.evaluate((node) => {
    node.innerHTML = '<p></p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await codeBlockButton.click();
  await expect(editor.locator('pre code')).toHaveCount(1);
  await expect(editor.locator('pre')).toHaveAttribute('data-code-language', '');
  await expect(codeBlockButton).toHaveClass(/secondary/);

  await editor.evaluate((node) => {
    node.innerHTML = '<pre data-code-language="js"><code class="language-js" contenteditable="true">const value = 1;</code></pre>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const textNode = node.querySelector('code')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, textNode!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await codeBlockButton.click();
  await expect(editor.locator('pre')).toHaveCount(0);
  await expect(editor.locator('p')).toHaveText('const value = 1;');
  await expect(codeBlockButton).not.toHaveClass(/secondary/);
});

test('italic toolbar action serializes multi-paragraph and list selections', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.editor-block-passive').first()).toContainText(defaultDocumentText);

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Alpha</p><ul><li>Bravo</li><li>Charlie</li></ul><p>Delta</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const firstText = node.querySelector('p')?.firstChild;
    const lastText = node.querySelector('p:last-child')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(firstText!, 0);
    range.setEnd(lastText!, lastText!.textContent!.length);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  await page.getByRole('button', { name: 'Italic' }).first().click();

  const expectedResult = await editor.evaluate((node) => ({
    emphasized: Array.from(node.querySelectorAll('em')).map((element) => element.textContent),
    emptyEmphasis: Array.from(node.querySelectorAll('em')).filter((element) => (element.textContent ?? '').trim().length === 0).length,
  }));
  expect(expectedResult).toEqual({
    emphasized: ['Alpha', 'Bravo', 'Charlie', 'Delta'],
    emptyEmphasis: 0,
  });

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('_Alpha_');
  await expect(page.locator('#rawEditor')).toContainText('- _Bravo_');
  await expect(page.locator('#rawEditor')).toContainText('- _Charlie_');
  await expect(page.locator('#rawEditor')).toContainText('_Delta_');
  await expect(page.locator('#rawEditor')).not.toContainText('__');
});

test('quote toolbar action formats every selected paragraph and list block', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.editor-block-passive').first()).toContainText(defaultDocumentText);

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Alpha</p><ul><li>Bravo</li><li>Charlie</li></ul><p>Delta</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const firstText = node.querySelector('p')?.firstChild;
    const lastText = node.querySelector('p:last-child')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(firstText!, 0);
    range.setEnd(lastText!, lastText!.textContent!.length);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  await page.getByRole('button', { name: 'Quote' }).first().click();

  const expectedResult = await editor.evaluate((node) => ({
    topLevelTags: Array.from(node.children).map((child) => child.tagName),
    quotes: Array.from(node.querySelectorAll('blockquote')).map((element) => element.textContent),
  }));
  expect(expectedResult).toEqual({
    topLevelTags: ['BLOCKQUOTE', 'BLOCKQUOTE', 'BLOCKQUOTE'],
    quotes: ['Alpha', 'BravoCharlie', 'Delta'],
  });

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('> Alpha');
  await expect(page.locator('#rawEditor')).toContainText('> - Bravo');
  await expect(page.locator('#rawEditor')).toContainText('> - Charlie');
  await expect(page.locator('#rawEditor')).toContainText('> Delta');
});

test('toolbar heading buttons transform text and preserve typing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.editor-block-passive').first()).toContainText(defaultDocumentText);

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const textButton = page.locator('[data-rich-action="paragraph"]').first();

  for (const item of [
    { button: 'H1', tag: 'h1' },
    { button: 'H2', tag: 'h2' },
    { button: 'H3', tag: 'h3' },
    { button: 'H4', tag: 'h4' },
  ]) {
    const headingButton = page.locator(`[data-rich-action="${item.tag.replace('h', 'heading-')}"]`).first();
    await editor.evaluate((node) => {
      node.innerHTML = '<p>Heading text</p>';
      node.dispatchEvent(new InputEvent('input', { bubbles: true }));
      const paragraph = node.querySelector('p');
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(paragraph!);
      selection?.removeAllRanges();
      selection?.addRange(range);
      (node as HTMLElement).focus();
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await headingButton.click();
    await expect(editor.locator(item.tag)).toContainText('Heading text');
    await expect(headingButton).toHaveClass(/secondary/);
    await expect(textButton).not.toHaveClass(/secondary/);

    await headingButton.click();
    await expect(editor.locator('p')).toContainText('Heading text');
    await expect(textButton).toHaveClass(/secondary/);
    await expect(headingButton).not.toHaveClass(/secondary/);

    await editor.evaluate((node) => {
      node.innerHTML = '<p>ab</p>';
      node.dispatchEvent(new InputEvent('input', { bubbles: true }));
      const textNode = node.querySelector('p')?.firstChild;
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(textNode!, 1);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      (node as HTMLElement).focus();
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await headingButton.click();
    await page.keyboard.type('X');
    await expect(editor.locator(item.tag)).toHaveText('aXb');
    await expect(headingButton).toHaveClass(/secondary/);
  }
});

test('text line style editor feeds the rich text toolbar', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Add Style' }).click();
  await page.locator('[data-field="text-line-style-name"]').fill('role');
  await page.locator('[data-field="text-line-style-label"]').fill('Role heading');
  await page.locator('[data-field="text-line-style-css"]').fill('margin: 12px 0 4px; padding-left: 18px; font-weight: 700;');
  await page.getByRole('button', { name: 'Document Meta' }).click();

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('[data-field="block-rich"]').first();
  await editor.evaluate((node) => {
    node.innerHTML = '<p>Foo</p><p>moo cow</p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  await expect(page.locator('.text-line-style-toolbar-label').filter({ hasText: 'Paragraph Style' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Normal' }).first()).toBeVisible();
  await page.getByRole('button', { name: /Role heading/ }).first().click();

  const styled = editor.locator('[data-hvy-text-line-style="role"]');
  const activeEditorBlock = editor.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " editor-block ")][1]');
  await expect(styled).toContainText('Foo');
  await expect(styled).toHaveCSS('margin-top', '12px');
  await expect(styled).toHaveCSS('padding-left', '18px');
  await expect(styled.locator('.hvy-text-line-style-marker')).toBeHidden();
  await expect(activeEditorBlock.getByRole('button', { name: 'Role heading' }).first()).toHaveClass(/is-selected/);
});

test('paragraph style picker shows two recent choices and opens the full list', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();

  for (const style of [
    { name: 'alpha', label: 'Alpha Heading', css: 'font-weight: 700;' },
    { name: 'beta', label: 'Beta Detail', css: 'padding-left: 12px;' },
    { name: 'gamma', label: 'Gamma Note', css: 'margin: 8px 0;' },
  ]) {
    await page.getByRole('button', { name: 'Add Style' }).click();
    const row = page.locator('.text-line-style-row').last();
    await row.locator('[data-field="text-line-style-name"]').fill(style.name);
    await row.locator('[data-field="text-line-style-label"]').fill(style.label);
    await row.locator('[data-field="text-line-style-css"]').fill(style.css);
  }

  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.locator('[data-action="activate-block"]').first().click();

  const activeEditorBlock = page.locator('[data-field="block-rich"]').first().locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " editor-block ")][1]');
  const toolbar = activeEditorBlock.locator('.paragraph-style-toolbar').first();
  await expect(toolbar.locator('.paragraph-style-recent [data-rich-action="text-line-style"]')).toHaveCount(2);
  await toolbar.getByRole('button', { name: 'More paragraph styles' }).click();
  await expect(toolbar.locator('.paragraph-style-modal')).toBeVisible();
  await expect(toolbar.locator('.paragraph-style-modal-list [data-rich-action="text-line-style"]')).toHaveCount(4);

  await toolbar.getByRole('button', { name: 'Gamma Note' }).click();
  await expect(toolbar.locator('.paragraph-style-recent [data-rich-action="text-line-style"]').first()).toHaveText('Gamma Note');
  await expect(toolbar.getByRole('button', { name: 'Gamma Note' }).first()).toHaveClass(/is-selected/);

  await toolbar.getByRole('button', { name: 'Gamma Note' }).first().click({ button: 'right' });
  await expect(toolbar.locator('.paragraph-style-edit-modal')).toBeVisible();
  await expect(toolbar.locator('.paragraph-style-edit-panel:not([hidden])')).toContainText('Gamma Note');
  await toolbar.locator('.paragraph-style-edit-panel:not([hidden]) [data-css-property="margin-bottom"]').fill('14px');
  await expect(toolbar.locator('.paragraph-style-edit-panel:not([hidden]) [data-field="text-line-style-css"]')).toHaveValue(/margin-bottom: 14px;/);
});

test('paragraph style recents carry across active text blocks', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
text_line_styles:
  alpha:
    label: Alpha Heading
    css: "font-weight: 700;"
  beta:
    label: Beta Detail
    css: "padding-left: 12px;"
  gamma:
    label: Gamma Note
    css: "margin: 8px 0;"
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:text {"id":"first-text"}-->
  First body

 <!--hvy:text {"id":"second-text"}-->
  Second body
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('.editor-block-content[data-component-id="first-text"]').click();
  let activeEditorBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  let toolbar = activeEditorBlock.locator('.paragraph-style-toolbar').first();
  await toolbar.getByRole('button', { name: 'More paragraph styles' }).click();
  await toolbar.getByRole('button', { name: 'Gamma Note' }).click();
  await expect(toolbar.locator('.paragraph-style-recent [data-rich-action="text-line-style"]').first()).toHaveText('Gamma Note');

  await page.locator('.editor-block-content[data-component-id="second-text"]').click();
  activeEditorBlock = page.locator('.editor-block[data-active-editor-block="true"]');
  toolbar = activeEditorBlock.locator('.paragraph-style-toolbar').first();
  await expect(toolbar.locator('.paragraph-style-recent [data-rich-action="text-line-style"]').first()).toHaveText('Gamma Note');
});

test('paragraph style toolbar compacts inside phone preview', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();

  for (const style of [
    { name: 'alpha', label: 'Alpha Heading', css: 'font-weight: 700;' },
    { name: 'beta', label: 'Beta Detail', css: 'padding-left: 12px;' },
    { name: 'gamma', label: 'Gamma Note', css: 'margin: 8px 0;' },
  ]) {
    await page.getByRole('button', { name: 'Add Style' }).click();
    const row = page.locator('.text-line-style-row').last();
    await row.locator('[data-field="text-line-style-name"]').fill(style.name);
    await row.locator('[data-field="text-line-style-label"]').fill(style.label);
    await row.locator('[data-field="text-line-style-css"]').fill(style.css);
  }

  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Phone 390' }).click();
  await page.locator('[data-action="activate-block"]').first().click();

  const toolbar = page.locator('[data-field="block-rich"]').first().locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " editor-block ")][1]').locator('.paragraph-style-toolbar').first();
  await expect(toolbar.locator('.text-line-style-toolbar-label')).toBeHidden();
  await expect(toolbar.locator('> [data-rich-action="text-line-style"]:visible, > .paragraph-style-recent > [data-rich-action="text-line-style"]:visible')).toHaveCount(1);
  await expect(toolbar.locator('.paragraph-style-expand')).toBeHidden();

  await toolbar.getByRole('button', { name: 'Normal' }).click();
  await expect(toolbar.locator('.paragraph-style-modal')).toBeVisible();
  await expect(toolbar.locator('.paragraph-style-modal-list').getByRole('button', { name: 'Normal' })).toBeVisible();
  await toolbar.getByRole('button', { name: 'Gamma Note' }).click();
  await expect(toolbar.locator('> [data-rich-action="text-line-style"]:visible, > .paragraph-style-recent > [data-rich-action="text-line-style"]:visible')).toHaveText('Gamma Note');

  await toolbar.getByRole('button', { name: 'Gamma Note' }).first().click();
  await expect(toolbar.locator('.paragraph-style-modal-list').getByRole('button', { name: 'Normal' })).toBeVisible();
  const modalBox = await toolbar.locator('.paragraph-style-modal').boundingBox();
  const shellBox = await page.locator('.editor-shell').boundingBox();
  expect(modalBox).not.toBeNull();
  expect(shellBox).not.toBeNull();
  expect(Math.floor(modalBox!.x)).toBeGreaterThanOrEqual(Math.floor(shellBox!.x));
  expect(Math.ceil(modalBox!.x + modalBox!.width)).toBeLessThanOrEqual(Math.ceil(shellBox!.x + shellBox!.width));
});

test('paragraph style picker fits inside compact sidebar editor', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
text_line_styles:
  alpha:
    label: Alpha Heading
    css: "font-weight: 700;"
  beta:
    label: Beta Detail
    css: "padding-left: 12px;"
  gamma:
    label: Gamma Note
    css: "margin: 8px 0;"
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:text {}-->
  Main body

<!--hvy: {"id":"side","location":"sidebar"}-->
#! Sidebar

 <!--hvy:text {}-->
  Sidebar body
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.getByRole('button', { name: 'Phone 390' }).click();
  await page.locator('.editor-sidebar-tab').click();
  await page.locator('.editor-sidebar [data-action="activate-block"]').first().click();

  const toolbar = page.locator('.editor-sidebar [data-field="block-rich"]').first().locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " editor-block ")][1]').locator('.paragraph-style-toolbar').first();
  await toolbar.getByRole('button', { name: 'Normal' }).click();
  await expect(toolbar.locator('.paragraph-style-modal')).toBeVisible();

  const modalBox = await toolbar.locator('.paragraph-style-modal').boundingBox();
  const panelBox = await page.locator('.editor-sidebar-panel').boundingBox();
  expect(modalBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  expect(Math.floor(modalBox!.x)).toBeGreaterThanOrEqual(Math.floor(panelBox!.x));
  expect(Math.ceil(modalBox!.x + modalBox!.width)).toBeLessThanOrEqual(Math.ceil(panelBox!.x + panelBox!.width));
});

test('normal after enter from paragraph style keeps the previous line styled', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Add Style' }).click();
  await page.locator('[data-field="text-line-style-name"]').fill('role');
  await page.locator('[data-field="text-line-style-label"]').fill('Role heading');
  await page.locator('[data-field="text-line-style-css"]').fill('font-weight: 700;');
  await page.getByRole('button', { name: 'Document Meta' }).click();

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('[data-field="block-rich"]').first();
  await editor.evaluate((node) => {
    node.innerHTML = '<p>Styled line</p>';
    const text = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text!, text!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.getByRole('button', { name: 'Role heading' }).first().click();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Normal' }).first().click();
  await page.keyboard.type('Normal line');

  await expect(editor.locator('[data-hvy-text-line-style="role"]')).toContainText('Styled line');
  await expect(editor.locator('[data-hvy-text-line-style="role"]')).toHaveCount(1);
  await expect(editor.locator('p').last()).toContainText('Normal');
});

test('paragraph style after enter keeps caret on the empty new line', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Add Style' }).click();
  await page.locator('[data-field="text-line-style-name"]').fill('role');
  await page.locator('[data-field="text-line-style-label"]').fill('Role heading');
  await page.locator('[data-field="text-line-style-css"]').fill('font-weight: 700;');
  await page.getByRole('button', { name: 'Document Meta' }).click();

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('[data-field="block-rich"]').first();
  await editor.evaluate((node) => {
    node.innerHTML = '<p><br></p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.keyboard.type('Plain line');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Role heading' }).first().click();
  const caretAfterStyle = await editor.evaluate((node) => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const parent = range?.startContainer instanceof Element
      ? range.startContainer
      : range?.startContainer.parentElement;
    const styled = parent?.closest('[data-hvy-text-line-style]');
    const styledBlock = styled?.querySelector(':scope > :not(.hvy-text-line-style-marker)') as HTMLElement | null;
    return {
      selectedStyle: styled?.getAttribute('data-hvy-text-line-style') ?? '',
      selectedText: styled?.textContent?.replace(/\^role\^/g, '').replace(/\u200b/g, '') ?? '',
      styledBlockBreakCount: styledBlock?.querySelectorAll('br').length ?? -1,
      styledBlockChildNodes: styledBlock?.childNodes.length ?? -1,
      styledBlockHeight: styledBlock?.getBoundingClientRect().height ?? 0,
      previousText: node.querySelector('p')?.textContent ?? '',
    };
  });
  expect(caretAfterStyle).toMatchObject({
    selectedStyle: 'role',
    selectedText: '',
    styledBlockBreakCount: 0,
    styledBlockChildNodes: 0,
    previousText: 'Plain line',
  });
  expect(caretAfterStyle.styledBlockHeight).toBeGreaterThan(0);
  await page.keyboard.type('Styled line');

  const expectedResult = await editor.evaluate((node) => ({
    plainText: node.querySelector('p')?.textContent ?? '',
    styledLines: Array.from(node.querySelectorAll('[data-hvy-text-line-style="role"]')).map((line) => ({
      text: (line.textContent ?? '').replace(/\^role\^/g, '').replace(/\u200b/g, ''),
      breakCount: line.querySelectorAll('br').length,
      hasCaretAnchor: (line.textContent ?? '').includes('\u200b'),
    })),
  }));

  expect(expectedResult).toEqual({
    plainText: 'Plain line',
    styledLines: [{
      text: 'Styled line',
      breakCount: 0,
      hasCaretAnchor: false,
    }],
  });
});

test('arrowing back to a continued paragraph style line keeps caret after typed text', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Add Style' }).click();
  await page.locator('[data-field="text-line-style-name"]').fill('indented');
  await page.locator('[data-field="text-line-style-label"]').fill('Indented');
  await page.locator('[data-field="text-line-style-css"]').fill('padding-left: 1rem;');
  await page.getByRole('button', { name: 'Document Meta' }).click();

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('[data-field="block-rich"]').first();
  await editor.evaluate((node) => {
    node.innerHTML = '<p><br></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.keyboard.type('Seatac Disc Golf');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Indented' }).first().click();
  await page.keyboard.type('20 - ');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.type('3');

  const expectedResult = await editor.evaluate((node) => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    return {
      lines: Array.from(node.querySelectorAll('[data-hvy-text-line-style="indented"]')).map((line) => ({
        text: (line.textContent ?? '').replace(/\^indented\^/g, '').replace(/\u200b/g, ''),
        breakCount: line.querySelectorAll('br').length,
        hasCaretAnchor: (line.textContent ?? '').includes('\u200b'),
      })),
      selectionTextOffset: range?.startContainer instanceof Text
        ? range.startOffset
        : null,
      selectionText: range?.startContainer.textContent?.replace(/\u200b/g, '') ?? '',
    };
  });

  expect(expectedResult).toEqual({
    lines: [
      { text: '20 - 3', breakCount: 0, hasCaretAnchor: false },
      { text: '', breakCount: 0, hasCaretAnchor: false },
    ],
    selectionTextOffset: '20 - 3'.length,
    selectionText: '20 - 3',
  });
});

test('enter keeps paragraph style active on the new line', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Add Style' }).click();
  await page.locator('[data-field="text-line-style-name"]').fill('role');
  await page.locator('[data-field="text-line-style-label"]').fill('Role heading');
  await page.locator('[data-field="text-line-style-css"]').fill('font-weight: 700;');
  await page.getByRole('button', { name: 'Document Meta' }).click();

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('[data-field="block-rich"]').first();
  await editor.evaluate((node) => {
    node.innerHTML = '<p>Styled line</p>';
    const text = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text!, text!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.getByRole('button', { name: 'Role heading' }).first().click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('Still styled');

  await expect(editor.locator('[data-hvy-text-line-style="role"]')).toHaveCount(2);
  await expect(editor.locator('[data-hvy-text-line-style="role"]').last()).toContainText('Still styled');
  await expect(page.getByRole('button', { name: 'Role heading' }).first()).toHaveClass(/is-selected/);
});

test('enter on a styled continuation line inserts one styled line', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Add Style' }).click();
  await page.locator('[data-field="text-line-style-name"]').fill('role');
  await page.locator('[data-field="text-line-style-label"]').fill('Role heading');
  await page.locator('[data-field="text-line-style-css"]').fill('font-weight: 700;');
  await page.getByRole('button', { name: 'Document Meta' }).click();

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('[data-field="block-rich"]').first();
  await editor.evaluate((node) => {
    node.innerHTML = '<p>Styled line</p>';
    const text = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text!, text!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.getByRole('button', { name: 'Role heading' }).first().click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');

  const expectedResult = await editor.evaluate((node) => ({
    styledLines: Array.from(node.querySelectorAll('[data-hvy-text-line-style="role"]')).map((line) =>
      (line.textContent ?? '').replace(/\u200b/g, '').trim()
    ),
  }));

  expect(expectedResult).toEqual({
    styledLines: ['^role^Styled line', '^role^', '^role^'],
  });
});

test('enter in the middle of a paragraph style splits into two styled lines', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Add Style' }).click();
  await page.locator('[data-field="text-line-style-name"]').fill('role');
  await page.locator('[data-field="text-line-style-label"]').fill('Role heading');
  await page.locator('[data-field="text-line-style-css"]').fill('font-weight: 700;');
  await page.getByRole('button', { name: 'Document Meta' }).click();

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('[data-field="block-rich"]').first();
  await editor.evaluate((node) => {
    node.innerHTML = '<p>Styled line</p>';
    const text = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(text!, 'Styled'.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.getByRole('button', { name: 'Role heading' }).first().click();
  await page.keyboard.press('Enter');
  await page.keyboard.type('continued ');

  const expectedResult = await editor.evaluate((node) => ({
    childTags: Array.from(node.children).map((child) => child.tagName),
    nestedBlocks: node.querySelectorAll('[data-hvy-text-line-style] [data-hvy-text-line-style], [data-hvy-text-line-style] div').length,
    styledLines: Array.from(node.querySelectorAll('[data-hvy-text-line-style="role"]')).map((line) =>
      (line.textContent ?? '').replace(/\^role\^/g, '').replace(/\u200b/g, '')
    ),
  }));

  expect(expectedResult).toEqual({
    childTags: ['DIV', 'DIV'],
    nestedBlocks: 0,
    styledLines: ['Styled', 'continued line'],
  });
});

test('heading enter exits to normal text and updates toolbar state', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.editor-block-passive').first()).toContainText(defaultDocumentText);

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const h1Button = page.locator('[data-rich-action="heading-1"]').first();
  const textButton = page.locator('[data-rich-action="paragraph"]').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p><br></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await h1Button.click();
  await page.keyboard.type('Heading');
  await expect(h1Button).toHaveClass(/secondary/);
  await page.keyboard.press('Enter');

  await expect(h1Button).not.toHaveClass(/secondary/);
  await expect(textButton).toHaveClass(/secondary/);
  await page.keyboard.type('Body');
  await expect(editor.locator('h1')).toHaveText('Heading');
  await expect(editor.locator('p').last()).toHaveText('Body');
});

test('empty heading buttons keep the caret available for typing', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.editor-block-passive').first()).toContainText(defaultDocumentText);

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  for (const item of [
    { button: 'H1', tag: 'h1' },
    { button: 'H2', tag: 'h2' },
    { button: 'H3', tag: 'h3' },
    { button: 'H4', tag: 'h4' },
  ]) {
    await editor.evaluate((node) => {
      node.innerHTML = '<p><br></p>';
      node.dispatchEvent(new InputEvent('input', { bubbles: true }));
      const paragraph = node.querySelector('p');
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(paragraph!);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      (node as HTMLElement).focus();
      node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const headingButton = page.locator(`[data-rich-action="${item.tag.replace('h', 'heading-')}"]`).first();
    await headingButton.click();
    await expect(headingButton).toHaveClass(/secondary/);
    await page.keyboard.type(item.button);
    await expect(editor.locator(item.tag)).toHaveText(item.button);
  }
});

test('toolbar alignment buttons update alignment and selected state', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();

  for (const item of [
    { button: 'Align center', value: 'center' },
    { button: 'Align right', value: 'right' },
    { button: 'Align left', value: 'left' },
  ]) {
    await page.getByRole('button', { name: item.button }).first().click();
    const button = page.getByRole('button', { name: item.button }).first();
    await expect(button).toHaveClass(/secondary/);
    await expect(page.locator('.rich-editor').first()).toHaveAttribute('style', new RegExp(`text-align: ${item.value}`));
    await expect(page.locator('.rich-editor').first()).toBeFocused();
  }
});

test('toolbar buttons expose platform hotkeys in titles', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();

  await expect(page.getByRole('button', { name: 'Bold' }).first()).toHaveAttribute('title', /Bold \((Cmd|Ctrl)\+B\)/);
  await expect(page.getByRole('button', { name: 'Italic' }).first()).toHaveAttribute('title', /Italic \((Cmd|Ctrl)\+I\)/);
  await expect(page.getByRole('button', { name: 'Underline' }).first()).toHaveAttribute('title', /Underline \((Cmd|Ctrl)\+U\)/);
  await expect(page.getByRole('button', { name: 'Link' }).first()).toHaveAttribute('title', /Link \((Cmd|Ctrl)\+K\)/);
});
