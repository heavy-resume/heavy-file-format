import { expect, test } from '@playwright/test';

test('undo inside active rich text editor keeps focus on text changes', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]').first();
  const editor = activeBlock.locator('.rich-editor').first();
  await editor.evaluate((node) => {
    node.innerHTML = '<p>Base text</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, textNode!.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await page.keyboard.type(' added');
  await expect(editor).toContainText('Base text added');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');
  await expect(activeBlock).toHaveCount(1);
  await expect(editor).toContainText('Base text');
  await expect(editor).not.toContainText('added');
});

test('inline toolbar buttons wrap and unwrap selected text', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  const cases = [
    { button: 'Bold', tag: 'strong' },
    { button: 'Italic', tag: 'em' },
    { button: 'Underline', tag: 'u' },
    { button: 'Strikethrough', tag: 's, strike, del' },
  ];

  for (const item of cases) {
    await editor.evaluate((node) => {
      node.innerHTML = '<p>Selected text</p>';
      const textNode = node.querySelector('p')?.firstChild;
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(textNode!);
      selection?.removeAllRanges();
      selection?.addRange(range);
      (node as HTMLElement).focus();
    });
    await page.getByRole('button', { name: item.button }).first().click();
    await expect(editor.locator(item.tag)).toContainText('Selected text');

    await editor.locator(item.tag).first().evaluate((node) => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(node);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    await page.getByRole('button', { name: item.button }).first().click();
    await expect(editor.locator(item.tag)).toHaveCount(0);
    await expect(editor).toContainText('Selected text');
  }
});

test('image caption rich editor keeps italic and bold markers distinct', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:image {"id":"photo","imageFile":"","imageAlt":"","caption":{"text":"Caption text","schema":{"kind":"text","component":"text","align":"center"}}}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('[data-action="activate-block"]').first().click();
  await page.locator('.image-caption-edit-button', { hasText: 'Edit caption' }).click();

  const captionEditor = page.locator('.caption-text-modal .rich-editor');
  await expect(captionEditor).toBeVisible();
  await captionEditor.locator('p').evaluate((node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node.closest('.rich-editor') as HTMLElement | null)?.focus();
  });

  const captionModal = page.locator('.caption-text-modal');
  await captionModal.getByRole('button', { name: 'Italic' }).click();
  await expect(captionEditor.locator('em')).toHaveText('Caption text');
  await expect(captionModal.getByRole('button', { name: 'Italic' })).toHaveClass(/secondary/);

  await captionModal.getByRole('button', { name: 'Bold' }).click();
  await expect(captionEditor.locator('strong em, em strong')).toHaveText('Caption text');
  await expect(captionModal.getByRole('button', { name: 'Bold' })).toHaveClass(/secondary/);

  await captionModal.getByRole('button', { name: 'Bold' }).click();
  await expect(captionEditor.locator('strong')).toHaveCount(0);
  await expect(captionEditor.locator('em')).toHaveText('Caption text');
  await expect(captionModal.getByRole('button', { name: 'Bold' })).not.toHaveClass(/secondary/);

  await captionModal.getByRole('button', { name: 'Underline' }).click();
  await expect(captionEditor.locator('u em, em u')).toHaveText('Caption text');

  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Raw' }).click();
  const rawEditor = page.locator('#rawEditor');
  await expect(rawEditor).toContainText('___');
  await expect(rawEditor).toContainText('_Caption text_');
  await expect(rawEditor).not.toContainText('*****');
  await expect(rawEditor).not.toContainText('**_Caption text_**');
});

test('active text editor wraps prose without widening the editor block', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Phone 390' }).click();
  await page.locator('[data-action="activate-block"]').first().click();

  const editor = page.locator('.editor-block[data-active-editor-block="true"] .rich-editor');
  await editor.evaluate((node) => {
    node.innerHTML = '<p>HVY is a multiple purpose file format built around information consumption.</p>';
    const paragraph = node.querySelector('p');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph!);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await page.keyboard.type(
    ' Sections and components define consumable portions of information. Sections define the root document, subsections can live in sections, and components can live in sections and subsections.'
  );

  await expect.poll(async () =>
    editor.evaluate((node) => {
      const content = node.closest<HTMLElement>('.editor-block-content');
      const tree = node.closest<HTMLElement>('.editor-tree');
      return {
        editorOverflow: node.scrollWidth - node.clientWidth,
        contentOverflow: content ? content.scrollWidth - content.clientWidth : 0,
        treeOverflow: tree ? tree.scrollWidth - tree.clientWidth : 0,
      };
    })
  ).toEqual({ editorOverflow: 0, contentOverflow: 0, treeOverflow: 0 });
  await expect.poll(async () => editor.locator('p').evaluate((node) => node.innerHTML)).not.toContain('&nbsp;Sections');
  await expect.poll(async () => editor.locator('p').evaluate((node) => node.innerHTML)).not.toContain('sub&nbsp;sections');
});

test('mobile adjustment mode writes text edits as alt annotations', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Phone 390' }).click();
  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Tools &amp; Technologies</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.getByRole('button', { name: 'Mobile Adjustment' }).click();
  await expect(page.getByRole('button', { name: 'Mobile Adjustment' })).toHaveClass(/secondary/);
  await expect(page.getByRole('button', { name: 'Alt' })).toHaveCount(0);
  await expect(page.locator('.ghost-label', { hasText: 'Add Text' })).toHaveCount(0);

  const mobileEditor = page.locator('.rich-editor').first();
  await mobileEditor.locator('p').first().evaluate((node) => {
    node.textContent = 'Tools & Tech';
    node.closest('.rich-editor')?.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await expect(mobileEditor).toHaveText('Tools & Tech');

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText(
    'Tools & <!--hvy:alt {"compact":"Tech"}-->Technologies<!--/hvy:alt-->'
  );
});

test('mobile adjustment mode keeps heading syntax outside alt annotations', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Phone 390' }).click();
  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<h2>Summary</h2>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await page.getByRole('button', { name: 'Mobile Adjustment' }).click();
  const mobileEditor = page.locator('.rich-editor').first();
  await expect(mobileEditor.locator('h2')).toHaveText('Summary');

  await mobileEditor.locator('h2').evaluate((node) => {
    node.textContent = 'Sum';
    node.closest('.rich-editor')?.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText(
    '## <!--hvy:alt {"compact":"Sum"}-->Summary<!--/hvy:alt-->'
  );

  await page.getByRole('button', { name: 'Basic' }).click();
  await expect(page.locator('.rich-editor h2').first()).toContainText('Summary');
  await expect(page.locator('.rich-editor').first()).not.toContainText('## Summary');
});

test('mobile adjustment mode removes alt annotation when text matches full value', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Phone 390' }).click();
  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  await editor.evaluate((node) => {
    node.innerHTML =
      '<p><span class="hvy-alt" data-hvy-alt="true"><span class="hvy-alt-full">Tools &amp; Technologies</span><span class="hvy-alt-compact">Tools &amp; Tech</span></span></p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await page.getByRole('button', { name: 'Mobile Adjustment' }).click();
  const mobileEditor = page.locator('.rich-editor').first();
  await expect(mobileEditor.locator('.hvy-alt-full')).toBeHidden();
  await expect(mobileEditor.locator('.hvy-alt-compact')).toBeVisible();
  await expect(mobileEditor.locator('.hvy-alt-compact')).toHaveText('Tools & Tech');

  await mobileEditor.locator('.hvy-alt-compact').evaluate((node) => {
    node.textContent = 'Tools & Technologies';
    node.closest('.rich-editor')?.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).not.toContainText('<!--hvy:alt');
  await expect(page.locator('#rawEditor')).toContainText('Tools & Technologies');
});

test('mobile adjustment preview width switches between full and alt annotation text', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:text {"id":"tools"}-->
  ## Tools & <!--hvy:alt {"compact":"Tech"}-->Technologies<!--/hvy:alt-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.getByRole('button', { name: 'Phone 390' }).click();
  await page.getByRole('button', { name: 'Mobile Adjustment' }).click();
  await page.locator('.editor-block-passive', { has: page.locator('#tools') }).click();
  const editor = page.locator('.rich-editor').first();

  await expect(editor.locator('.hvy-alt-full')).toBeHidden();
  await expect(editor.locator('.hvy-alt-compact')).toBeVisible();
  await expect(editor.locator('.hvy-alt-compact')).toHaveText('Tech');

  await page.getByRole('button', { name: 'Desktop' }).click();
  await expect(editor.locator('.hvy-alt-full')).toBeVisible();
  await expect(editor.locator('.hvy-alt-compact')).toBeHidden();
  await expect(editor.locator('h2')).toContainText('Tools & Technologies');
});

test('inline toolbar actions toggle typing mode at a collapsed caret', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const boldButton = page.getByRole('button', { name: 'Bold' }).first();
  const italicButton = page.getByRole('button', { name: 'Italic' }).first();
  const underlineButton = page.getByRole('button', { name: 'Underline' }).first();
  const strikethroughButton = page.getByRole('button', { name: 'Strikethrough' }).first();

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
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await boldButton.click();
  await expect(boldButton).toHaveClass(/secondary/);
  await page.keyboard.type('Bold');
  await expect(editor.locator('strong')).toContainText('Bold');

  await boldButton.click();
  await expect(boldButton).not.toHaveClass(/secondary/);
  await page.keyboard.type(' plain');
  await expect(editor.locator('strong')).toHaveText('Bold');
  await expect(editor).toContainText('Bold plain');

  await page.keyboard.press('Control+B');
  await expect(boldButton).toHaveClass(/secondary/);
  await page.keyboard.type(' shortcut');
  await expect(editor.locator('strong').last()).toContainText('shortcut');

  await page.keyboard.press('Control+B');
  await expect(boldButton).not.toHaveClass(/secondary/);

  await page.keyboard.press('Control+I');
  await expect(italicButton).toHaveClass(/secondary/);
  await page.keyboard.type(' italic');
  await expect(editor.locator('em')).toContainText('italic');

  await page.keyboard.press('Control+I');
  await expect(italicButton).not.toHaveClass(/secondary/);

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
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await page.keyboard.press('Control+I');
  await page.keyboard.press('Control+U');
  await page.keyboard.type('both');
  await expect(italicButton).toHaveClass(/secondary/);
  await expect(underlineButton).toHaveClass(/secondary/);
  await page.keyboard.press('Control+I');
  await expect(italicButton).not.toHaveClass(/secondary/);
  await expect(underlineButton).toHaveClass(/secondary/);
  await page.keyboard.type(' underline-only');
  await expect(editor.locator('em')).toHaveText('both');
  await expect(editor.locator('p')).toHaveText('both underline-only');
  await expect(editor.locator('u').first()).toContainText('both');
  await expect(editor.locator('u').last()).toContainText('underline-only');
  await page.keyboard.press('Control+U');
  await expect(underlineButton).not.toHaveClass(/secondary/);

  await page.keyboard.press('Control+U');
  await expect(underlineButton).toHaveClass(/secondary/);
  await page.keyboard.type(' underline');
  await expect(editor.locator('u').last()).toContainText('underline');

  await underlineButton.click();
  await expect(underlineButton).not.toHaveClass(/secondary/);

  await strikethroughButton.click();
  await expect(strikethroughButton).toHaveClass(/secondary/);
  await page.keyboard.type(' strike');
  await expect(editor.locator('s, strike, del')).toContainText('strike');

  await strikethroughButton.click();
  await expect(strikethroughButton).not.toHaveClass(/secondary/);
  await page.keyboard.press('Enter');
  await page.keyboard.type('plain next line');
  await expect(editor.locator('s, strike, del')).toHaveText(/strike/);
  await expect(editor.locator('p').last()).toHaveText('plain next line');
  await expect(editor.locator('p').last().locator('s, strike, del')).toHaveCount(0);
});

test('rich editor uses normal spaces while typing prose', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

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

  await page.keyboard.type('Hello ');
  await expect(editor).toContainText('Hello');
  await expect(editor.locator('p')).toHaveJSProperty('innerHTML', 'Hello&nbsp;');

  await page.keyboard.type('world');
  await expect(editor).toContainText('Hello world');
  await expect(editor.locator('p')).toHaveJSProperty('innerHTML', 'Hello world');
});

test('rich editor wraps long text without expanding its block', async ({ page }) => {
  await page.setViewportSize({ width: 520, height: 720 });
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const block = page.locator('.editor-block').first();

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

  const widthBefore = await block.evaluate((node) => node.getBoundingClientRect().width);
  await page.keyboard.type('supercalifragilisticexpialidocious'.repeat(8));
  const widthAfter = await block.evaluate((node) => node.getBoundingClientRect().width);

  expect(widthAfter).toBeLessThanOrEqual(widthBefore + 1);
  await expect.poll(async () =>
    editor.evaluate((node) => {
      const content = node.closest<HTMLElement>('.editor-block-content');
      const tree = node.closest<HTMLElement>('.editor-tree');
      return {
        editorOverflow: node.scrollWidth - node.clientWidth,
        contentOverflow: content ? content.scrollWidth - content.clientWidth : 0,
        treeOverflow: tree ? tree.scrollWidth - tree.clientWidth : 0,
      };
    })
  ).toEqual({ editorOverflow: 0, contentOverflow: 0, treeOverflow: 0 });
  await expect(editor.locator('p')).toHaveCSS('overflow-wrap', 'anywhere');
});

test('inline code autoformats from backticks and escapes with arrow or click', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

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

  await page.keyboard.type('Use `foobar`');
  await expect(editor.locator('p code')).toHaveText('foobar');
  await expect(editor.locator('p')).not.toContainText('`');

  await editor.locator('p code').evaluate((node) => {
    const textNode = node.firstChild!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node.parentElement?.closest('.rich-editor') as HTMLElement | null)?.focus();
  });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type(' plain');
  await expect(editor.locator('p code')).toHaveText('foobar');
  await expect(editor.locator('p')).toContainText('Use foobar plain');

  await editor.evaluate((node) => {
    node.innerHTML = '<p><code>clickme</code></p>';
    const code = node.querySelector('code')!;
    const textNode = code.firstChild!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode, textNode.textContent!.length);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  const codeBox = await editor.locator('p code').boundingBox();
  expect(codeBox).not.toBeNull();
  await page.mouse.click(codeBox!.x + codeBox!.width + 8, codeBox!.y + codeBox!.height / 2);
  await page.keyboard.type(' plain');
  await expect(editor.locator('p code')).toHaveText('clickme');
  await expect(editor.locator('p')).toContainText('clickme plain');
});

test('code button wraps selected text as inline code and preserves angle brackets', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>Use &lt;tag&gt; now</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 4);
    range.setEnd(textNode!, 9);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.getByRole('button', { name: 'Code block' }).first().click();

  await expect(editor.locator('p code')).toHaveText('<tag>');
  await expect(editor.locator('p')).toHaveText('Use <tag> now');
  await expect(editor.locator('pre')).toHaveCount(0);

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('Use `<tag>` now');
  await page.getByRole('button', { name: 'Basic' }).click();
});

test('link keyboard shortcut opens the link modal and applies links', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p><a href="https://example.com">Link me</a></p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const anchor = node.querySelector('a[href="https://example.com"]');
    const textNode = anchor?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode!, 2);
    range.collapse(true);
    (node as HTMLElement).focus();
    selection?.removeAllRanges();
    selection?.addRange(range);
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });

  await page.keyboard.press('Control+K');
  const linkModal = page.locator('.link-inline-modal.is-open');
  const linkInput = linkModal.locator('#linkInlineInput');
  await expect(linkModal).toBeVisible();
  await expect(linkInput).toHaveValue('https://example.com');
  await linkInput.evaluate((input) => {
    (input as HTMLInputElement).value = 'https://updated.example';
  });
  await page.locator('[data-link-modal-action="apply"]').evaluate((button) => {
    (button as HTMLButtonElement).click();
  });

  await expect(editor.locator('a[href="https://updated.example"]')).toContainText('Link me');
  await expect(editor.locator('a[href="https://example.com"]')).toHaveCount(0);
});

test('link modal apply with an empty value removes the selected link', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const linkModalModulePath = '/src/bind-link-modal.ts';
    const { bindLinkInlineModal, openLinkInlineModal } = await import(/* @vite-ignore */ linkModalModulePath);
    const app = document.createElement('div');
    app.innerHTML = `
      <div id="linkInlineModal" class="link-inline-modal" aria-hidden="true">
        <input id="linkInlineInput" />
        <button type="button" data-link-modal-action="apply">Apply</button>
      </div>
      <div class="rich-editor" contenteditable="true" data-field="block-rich">
        <p><a href="https://example.com">Link me</a></p>
      </div>
    `;
    document.body.replaceChildren(app);
    bindLinkInlineModal(app);

    const editor = app.querySelector<HTMLElement>('.rich-editor')!;
    const anchor = editor.querySelector<HTMLAnchorElement>('a[href="https://example.com"]')!;
    let inputEvents = 0;
    editor.addEventListener('input', () => {
      inputEvents += 1;
    });

    openLinkInlineModal(app, editor, '', null, anchor);
    app.querySelector<HTMLInputElement>('#linkInlineInput')!.value = '';
    app.querySelector<HTMLButtonElement>('[data-link-modal-action="apply"]')!.click();

    return {
      html: editor.innerHTML.trim(),
      inputEvents,
      modalOpen: app.querySelector('#linkInlineModal')!.classList.contains('is-open'),
      text: editor.textContent?.trim(),
    };
  });

  expect(result).toEqual({
    html: '<p>Link me</p>',
    inputEvents: 1,
    modalOpen: false,
    text: 'Link me',
  });
});

test('link modal converts selected email text to mailto in the editor', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
    node.innerHTML = '<p>brandy.s.bilyeu@gmail.com</p>';
    const textNode = node.querySelector('p')?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(textNode!);
    (node as HTMLElement).focus();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });

  await page.keyboard.press('Control+K');
  const linkModal = page.locator('.link-inline-modal.is-open');
  const linkInput = linkModal.locator('#linkInlineInput');
  await expect(linkInput).toHaveValue('mailto:brandy.s.bilyeu@gmail.com');
  await linkModal.getByRole('button', { name: 'Apply' }).click();

  await expect(editor.locator('a[href="mailto:brandy.s.bilyeu@gmail.com"]')).toContainText('brandy.s.bilyeu@gmail.com');
});

test('link modal removes empty anchors', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const linkModalModulePath = '/src/bind-link-modal.ts';
    const { bindLinkInlineModal, openLinkInlineModal } = await import(/* @vite-ignore */ linkModalModulePath);
    const app = document.createElement('div');
    app.innerHTML = `
      <div id="linkInlineModal" class="link-inline-modal" aria-hidden="true">
        <input id="linkInlineInput" />
        <button type="button" data-link-modal-action="apply">Apply</button>
      </div>
      <div class="rich-editor" contenteditable="true" data-field="block-rich">
        <p><a>brandy.s.bilyeu@gmail.com</a></p>
      </div>
    `;
    document.body.replaceChildren(app);
    bindLinkInlineModal(app);

    const editor = app.querySelector<HTMLElement>('.rich-editor')!;
    const anchor = editor.querySelector<HTMLAnchorElement>('a')!;
    const range = document.createRange();
    range.selectNodeContents(anchor);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    editor.focus();

    openLinkInlineModal(app, editor, '', range, anchor);
    app.querySelector<HTMLInputElement>('#linkInlineInput')!.value = '';
    app.querySelector<HTMLButtonElement>('[data-link-modal-action="apply"]')!.click();

    return {
      html: editor.innerHTML.trim(),
      text: editor.textContent?.trim(),
    };
  });

  expect(result).toEqual({
    html: '<p>brandy.s.bilyeu@gmail.com</p>',
    text: 'brandy.s.bilyeu@gmail.com',
  });
});

test('external rich paste strips text background and font presentation', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  const expectedResult = await editor.evaluate((node) => {
    node.innerHTML = '<p>Before </p>';
    const paragraph = node.querySelector('p')!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();

    const transfer = new DataTransfer();
    transfer.setData(
      'text/html',
      '<p><font face="Courier New" size="4"><span style="color: rgb(255, 0, 0); background-color: yellow; font-family: monospace; font-size: 18px; font-weight: 700;">External</span></font> <mark style="background: lime;">Mark</mark></p>'
    );
    transfer.setData('text/plain', 'External Mark');
    const pasteEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste',
    });
    Object.defineProperty(pasteEvent, 'dataTransfer', { value: transfer });

    node.dispatchEvent(pasteEvent);

    return {
      html: node.innerHTML,
      prevented: pasteEvent.defaultPrevented,
      text: node.textContent,
    };
  });

  expect(expectedResult.prevented).toBe(true);
  expect(expectedResult.text).toContain('Before External Mark');
  expect(expectedResult.html).toContain('<strong>External</strong>');
  expect(expectedResult.html).not.toContain('<p><p>');
  expect(expectedResult.html).not.toContain('font-weight: 700');
  expect(expectedResult.html).not.toContain('font-family');
  expect(expectedResult.html).not.toContain('font-size');
  expect(expectedResult.html).not.toContain('face=');
  expect(expectedResult.html).not.toContain('color: rgb(255, 0, 0)');
  expect(expectedResult.html).not.toContain('background-color');
  expect(expectedResult.html).not.toContain('background: lime');
});

test('external rich paste normalizes gmail media wrappers before insertion', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  const expectedResult = await editor.evaluate((node) => {
    node.innerHTML = '<p>Before </p>';
    const paragraph = node.querySelector('p')!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();

    const transfer = new DataTransfer();
    transfer.setData(
      'text/html',
      `<div class="gmail_quote">
        <div>To whom it may concern:</div>
        <div><br></div>
        <div><b>Thank you</b> for your time,</div>
        <div style="height: 260px; min-height: 260px; background-color: rgb(64, 96, 128);">
          <img src="data:image/png;base64,AAAA" width="1200" height="260">
        </div>
      </div>`
    );
    transfer.setData('text/plain', 'To whom it may concern:\n\nThank you for your time,');
    const pasteEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste',
    });
    Object.defineProperty(pasteEvent, 'dataTransfer', { value: transfer });

    node.dispatchEvent(pasteEvent);

    return {
      html: node.innerHTML,
      prevented: pasteEvent.defaultPrevented,
      text: node.textContent,
    };
  });

  expect(expectedResult.prevented).toBe(true);
  expect(expectedResult.text).toContain('Before To whom it may concern:');
  expect(expectedResult.text).toContain('Thank you for your time,');
  expect(expectedResult.html).toContain('<strong>Thank you</strong>');
  expect(expectedResult.html).not.toContain('gmail_quote');
  expect(expectedResult.html).not.toContain('height: 260px');
  expect(expectedResult.html).not.toContain('min-height');
  expect(expectedResult.html).not.toContain('background-color');
  expect(expectedResult.html).not.toContain('<img');
});

test('undo after external rich paste restores text without duplicating pasted content', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]').first();
  const editor = activeBlock.locator('.rich-editor').first();

  await editor.evaluate(async (node) => {
    node.innerHTML = '<p>Reach out to </p>';
    const paragraph = node.querySelector('p')!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const modulePath = '/src/history.ts';
    const { commitHistorySnapshot } = await import(/* @vite-ignore */ modulePath);
    commitHistorySnapshot();
  });

  await editor.evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.setData(
      'text/html',
      '<span style="font-family: Courier New, monospace;">chohlbein@kingcounty.gov</span>'
    );
    transfer.setData('text/plain', 'chohlbein@kingcounty.gov');
    const pasteEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste',
    });
    Object.defineProperty(pasteEvent, 'dataTransfer', { value: transfer });
    node.dispatchEvent(pasteEvent);
  });

  await expect(editor).toContainText('Reach out to chohlbein@kingcounty.gov');
  await expect(editor.locator('[style*="font-family"]')).toHaveCount(0);

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z');

  await expect(activeBlock).toHaveCount(1);
  await expect(editor).toContainText('Reach out to');
  await expect(editor).not.toContainText('chohlbein@kingcounty.gov');
});

test('rich copy inside the document preserves HVY-origin color presentation on paste', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  const expectedResult = await editor.evaluate((node) => {
    node.innerHTML = '<p><span style="color: rgb(10, 20, 30); background-color: rgb(240, 240, 0);">Internal</span></p><p>Target </p>';
    const source = node.querySelector('span')!;
    const selection = window.getSelection();
    const selectedRange = document.createRange();
    selectedRange.selectNode(source);
    selection?.removeAllRanges();
    selection?.addRange(selectedRange);
    (node as HTMLElement).focus();

    const transfer = new DataTransfer();
    const copyEvent = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: transfer });
    node.dispatchEvent(copyEvent);

    const target = node.querySelectorAll('p')[1]!;
    const pasteRange = document.createRange();
    pasteRange.selectNodeContents(target);
    pasteRange.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(pasteRange);

    const pasteEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste',
    });
    Object.defineProperty(pasteEvent, 'dataTransfer', { value: transfer });
    node.dispatchEvent(pasteEvent);

    return {
      copyPrevented: copyEvent.defaultPrevented,
      hasHvyClipboardType: transfer.types.includes('application/x-hvy-rich-html'),
      html: node.innerHTML,
      pastePrevented: pasteEvent.defaultPrevented,
    };
  });

  expect(expectedResult.copyPrevented).toBe(true);
  expect(expectedResult.hasHvyClipboardType).toBe(true);
  expect(expectedResult.pastePrevented).toBe(true);
  expect(expectedResult.html).toContain('color: rgb(10, 20, 30)');
  expect(expectedResult.html).toContain('background-color: rgb(240, 240, 0)');
});

test('viewer copy omits inherited theme color and preserves explicit inline color', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Viewer' }).click();

  const expectedResult = await page.locator('#readerDocument').evaluate((reader) => {
    const shell = reader.closest<HTMLElement>('.viewer-shell')!;
    shell.style.color = 'rgb(120, 120, 120)';
    reader.innerHTML = `
      <div class="reader-document-body">
        <div class="reader-block reader-block-text">
          <p id="inheritedCopySource">Inherited gray</p>
          <p><span id="explicitCopySource" style="color: rgb(10, 20, 30);">Explicit color</span></p>
        </div>
      </div>
    `;

    const copyElement = (element: HTMLElement) => {
      const selection = window.getSelection();
      const selectedRange = document.createRange();
      selectedRange.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(selectedRange);

      const transfer = new DataTransfer();
      const copyEvent = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: transfer });
      reader.dispatchEvent(copyEvent);
      return {
        copyPrevented: copyEvent.defaultPrevented,
        html: transfer.getData('text/html'),
        plainText: transfer.getData('text/plain'),
      };
    };

    return {
      inherited: copyElement(reader.querySelector<HTMLElement>('#inheritedCopySource')!),
      explicit: copyElement(reader.querySelector<HTMLElement>('#explicitCopySource')!),
    };
  });

  expect(expectedResult.inherited.copyPrevented).toBe(true);
  expect(expectedResult.inherited.plainText).toBe('Inherited gray');
  expect(expectedResult.inherited.html).toContain('Inherited gray');
  expect(expectedResult.inherited.html).not.toContain('rgb(120, 120, 120)');
  expect(expectedResult.inherited.html).not.toContain('color:');
  expect(expectedResult.explicit.copyPrevented).toBe(true);
  expect(expectedResult.explicit.plainText).toBe('Explicit color');
  expect(expectedResult.explicit.html).toContain('color: rgb(10, 20, 30)');
});

test('rich copy omits editor caret anchors from copied line', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  const expectedResult = await editor.evaluate((node) => {
    node.innerHTML = '<p>\u200bCopied line</p><p>Target </p>';

    const before = {
      sourceText: node.querySelector('p')?.textContent ?? '',
    };

    const source = node.querySelector('p')!;
    const selection = window.getSelection();
    const selectedRange = document.createRange();
    selectedRange.selectNodeContents(source);
    selection?.removeAllRanges();
    selection?.addRange(selectedRange);
    (node as HTMLElement).focus();

    const transfer = new DataTransfer();
    const copyEvent = new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: transfer });
    node.dispatchEvent(copyEvent);

    const target = node.querySelectorAll('p')[1]!;
    const pasteRange = document.createRange();
    pasteRange.selectNodeContents(target);
    pasteRange.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(pasteRange);

    const pasteEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste',
    });
    Object.defineProperty(pasteEvent, 'dataTransfer', { value: transfer });
    node.dispatchEvent(pasteEvent);

    const after = {
      clipboardHtml: transfer.getData('text/html'),
      clipboardText: transfer.getData('text/plain'),
      pastePrevented: pasteEvent.defaultPrevented,
      targetText: target.textContent ?? '',
    };

    return { before, after };
  });

  expect(expectedResult.before.sourceText).toBe('\u200bCopied line');
  expect(expectedResult.after.clipboardText).toBe('Copied line');
  expect(expectedResult.after.clipboardHtml).not.toContain('\u200b');
  expect(expectedResult.after.pastePrevented).toBe(true);
  expect(expectedResult.after.targetText).toBe('Target Copied line');
});

test('native plain paste uses text instead of rich html', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  const expectedResult = await editor.evaluate((node) => {
    node.innerHTML = '<p>Before </p>';
    const paragraph = node.querySelector('p')!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();

    const transfer = new DataTransfer();
    transfer.setData('application/x-hvy-rich-html', '<strong>Rich clipboard payload</strong>');
    transfer.setData('text/html', '<strong>Plain &lt;not bold&gt;</strong>');
    transfer.setData('text/plain', 'Plain <not bold>');
    const pasteEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPasteAsQuotation',
    });
    Object.defineProperty(pasteEvent, 'inputType', { value: 'insertFromPasteAsQuotation' });
    Object.defineProperty(pasteEvent, 'dataTransfer', { value: transfer });
    node.dispatchEvent(pasteEvent);

    return {
      html: node.innerHTML,
      pastePrevented: pasteEvent.defaultPrevented,
      text: node.textContent,
    };
  });
  expect(expectedResult.pastePrevented).toBe(true);
  expect(expectedResult.text).toContain('Before Plain <not bold>');
  expect(expectedResult.html).toContain('Plain &lt;not bold&gt;');
  expect(expectedResult.html).not.toContain('<strong>');
});

test('cmd shift v pastes plain text without requesting clipboard read permission', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));

  await page.goto('/');
  await page.evaluate(() => {
    (window as typeof window & { __hvyUnhandledRejections?: string[] }).__hvyUnhandledRejections = [];
    window.addEventListener('unhandledrejection', (event) => {
      const reason = event.reason;
      (window as typeof window & { __hvyUnhandledRejections: string[] }).__hvyUnhandledRejections.push(
        reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason)
      );
    });
  });

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await page.evaluate(() => {
    (window as typeof window & { __hvyClipboardReadTextCalls?: number }).__hvyClipboardReadTextCalls = 0;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: async () => {
          (window as typeof window & { __hvyClipboardReadTextCalls: number }).__hvyClipboardReadTextCalls += 1;
          throw new DOMException('Permission denied', 'NotAllowedError');
        },
      },
    });
  });
  await editor.evaluate((node) => {
    node.innerHTML = '<p>Before</p>';
    const paragraph = node.querySelector('p')!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+V' : 'Control+Shift+V');
  const expectedResult = await editor.evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.setData('text/html', '<strong>Plain &lt;not bold&gt;</strong>');
    transfer.setData('text/plain', 'Plain <not bold>');
    const pasteEvent = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, 'clipboardData', { value: transfer });
    node.dispatchEvent(pasteEvent);
    return {
      html: node.innerHTML,
      pastePrevented: pasteEvent.defaultPrevented,
      text: node.textContent,
    };
  });

  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __hvyClipboardReadTextCalls?: number }).__hvyClipboardReadTextCalls ?? 0
  )).toBe(0);
  await expect(page.locator('main.layout')).toHaveCount(1);
  await expect(page.getByText('Startup Problem')).toHaveCount(0);
  expect(expectedResult.pastePrevented).toBe(true);
  expect(expectedResult.text).toContain('BeforePlain <not bold>');
  expect(expectedResult.html).toContain('Plain &lt;not bold&gt;');
  expect(expectedResult.html).not.toContain('<strong>');
  await expect.poll(() => page.evaluate(() =>
    (window as typeof window & { __hvyUnhandledRejections?: string[] }).__hvyUnhandledRejections ?? []
  )).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('cmd shift v beforeinput does not make the next normal paste plain', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  const expectedResult = await editor.evaluate((node) => {
    node.innerHTML = '<p>Before </p>';
    const paragraph = node.querySelector('p')!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();

    (node as HTMLElement).dataset.hvyPlainPasteUntil = String(Date.now() + 2000);

    const plainTransfer = new DataTransfer();
    plainTransfer.setData('text/html', '<strong>Plain Alpha</strong>');
    plainTransfer.setData('text/plain', 'Plain Alpha');
    const plainPasteEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPasteAsQuotation',
    });
    Object.defineProperty(plainPasteEvent, 'inputType', { value: 'insertFromPasteAsQuotation' });
    Object.defineProperty(plainPasteEvent, 'dataTransfer', { value: plainTransfer });
    node.dispatchEvent(plainPasteEvent);

    const richTransfer = new DataTransfer();
    richTransfer.setData('text/html', '<strong>Bold Beta</strong>');
    richTransfer.setData('text/plain', 'Bold Beta');
    const richPasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(richPasteEvent, 'clipboardData', { value: richTransfer });
    node.dispatchEvent(richPasteEvent);
    let richBeforeInputPrevented = false;
    if (!richPasteEvent.defaultPrevented) {
      const richBeforeInputEvent = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        inputType: 'insertFromPaste',
      });
      Object.defineProperty(richBeforeInputEvent, 'dataTransfer', { value: richTransfer });
      node.dispatchEvent(richBeforeInputEvent);
      richBeforeInputPrevented = richBeforeInputEvent.defaultPrevented;
    }

    const secondRichTransfer = new DataTransfer();
    secondRichTransfer.setData('text/html', '<strong>Bold Gamma</strong>');
    secondRichTransfer.setData('text/plain', 'Bold Gamma');
    const secondRichPasteEvent = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertFromPaste',
    });
    Object.defineProperty(secondRichPasteEvent, 'dataTransfer', { value: secondRichTransfer });
    node.dispatchEvent(secondRichPasteEvent);

    return {
      html: node.innerHTML,
      plainPastePrevented: plainPasteEvent.defaultPrevented,
      richPastePrevented: richPasteEvent.defaultPrevented,
      richBeforeInputPrevented,
      secondRichPastePrevented: secondRichPasteEvent.defaultPrevented,
    };
  });

  expect(expectedResult.plainPastePrevented).toBe(true);
  expect(expectedResult.richPastePrevented).toBe(false);
  expect(expectedResult.richBeforeInputPrevented).toBe(true);
  expect(expectedResult.secondRichPastePrevented).toBe(true);
  expect(expectedResult.html).toContain('Plain Alpha');
  expect(expectedResult.html).not.toContain('<strong>Plain Alpha</strong>');
  expect(expectedResult.html).toContain('<strong>Bold Beta</strong>');
  expect(expectedResult.html).toContain('<strong>Bold Gamma</strong>');
});

test('markdown editor auto-upgrades raw task markers', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

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
  await editor.click();
  await page.keyboard.type('[ ] Draft task');

  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(editor.locator('input[type="checkbox"]').first()).not.toBeChecked();

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
  await editor.click();
  await page.keyboard.type('[x] Done task');

  await expect(editor.locator('input[type="checkbox"]')).toHaveCount(1);
  await expect(editor.locator('input[type="checkbox"]').first()).toBeChecked();
});
