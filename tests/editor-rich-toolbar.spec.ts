import { expect, test } from '@playwright/test';

test('toolbar exposes quote and code block actions', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const quoteButton = page.getByRole('button', { name: 'Quote' }).first();
  const codeBlockButton = page.getByRole('button', { name: 'Code block' }).first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Quoted</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
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
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await quoteButton.click();
  await page.keyboard.type('Quote typing works');
  await expect(editor.locator('blockquote')).toContainText('Quote typing works');
  await expect(quoteButton).toHaveClass(/secondary/);

  await editor.evaluate((node) => {
    node.innerHTML = '<blockquote></blockquote>';
    const quote = node.querySelector('blockquote');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(quote!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await page.keyboard.press('Backspace');
  await expect(editor.locator('blockquote')).toHaveCount(0);
  await expect(quoteButton).not.toHaveClass(/secondary/);

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Removed</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByRole('button', { name: 'Strikethrough' }).first().click();
  await expect(editor.locator('s, strike, del')).toContainText('Removed');
  await expect(page.locator('[data-rich-action="link"] .link-icon').first()).toBeEmpty();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Underlined</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await page.getByRole('button', { name: 'Underline' }).first().click();
  await expect(editor.locator('u')).toContainText('Underlined');

  await editor.evaluate((node) => {
    node.innerHTML = '<p></p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  await codeBlockButton.click();
  await expect(editor.locator('pre code')).toHaveCount(1);
  await expect(editor.locator('pre')).toHaveAttribute('data-code-language', '');
  await expect(codeBlockButton).toHaveClass(/secondary/);

  await codeBlockButton.click();
  await expect(editor.locator('pre')).toHaveCount(0);
  await expect(editor.locator('p').last()).toHaveText('');
  await expect(codeBlockButton).not.toHaveClass(/secondary/);

  await editor.evaluate((node) => {
    node.innerHTML = '<pre data-code-language="js"><code class="language-js" contenteditable="true">const value = 1;</code></pre>';
    const textNode = node.querySelector('code')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, textNode!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await codeBlockButton.click();
  await expect(editor.locator('pre')).toHaveCount(0);
  await expect(editor.locator('p')).toHaveText('const value = 1;');
  await expect(codeBlockButton).not.toHaveClass(/secondary/);
});

test('toolbar block style row covers text and all heading buttons', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const textButton = page.getByRole('button', { name: 'Text' }).first();

  for (const item of [
    { button: 'H1', tag: 'h1' },
    { button: 'H2', tag: 'h2' },
    { button: 'H3', tag: 'h3' },
    { button: 'H4', tag: 'h4' },
  ]) {
    const headingButton = page.getByRole('button', { name: item.button }).first();
    await editor.evaluate((node) => {
      node.innerHTML = '<p>Heading text</p>';
      const paragraph = node.querySelector('p');
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(paragraph!);
      selection?.removeAllRanges();
      selection?.addRange(range);
      (node as HTMLElement).focus();
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
      const textNode = node.querySelector('p')?.firstChild;
      const selection = window.getSelection();
      const range = document.createRange();
      range.setStart(textNode!, 1);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      (node as HTMLElement).focus();
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
  await toolbar.getByRole('button', { name: 'Gamma Note' }).click();
  await expect(toolbar.locator('> [data-rich-action="text-line-style"]:visible, > .paragraph-style-recent > [data-rich-action="text-line-style"]:visible')).toHaveText('Gamma Note');

  await toolbar.getByRole('button', { name: 'Gamma Note' }).first().click();
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

test('heading enter exits to normal text and updates toolbar state', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const h1Button = page.getByRole('button', { name: 'H1' }).first();
  const textButton = page.getByRole('button', { name: 'Text' }).first();

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
      const paragraph = node.querySelector('p');
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(paragraph!);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      (node as HTMLElement).focus();
    });

    const headingButton = page.getByRole('button', { name: item.button }).first();
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
