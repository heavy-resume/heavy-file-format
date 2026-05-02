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
