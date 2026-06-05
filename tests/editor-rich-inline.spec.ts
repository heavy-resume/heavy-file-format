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
  await expect(editor.locator('p')).toHaveCSS('overflow-wrap', 'normal');
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

test('external rich paste strips text and background color presentation', async ({ page }) => {
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
      '<p><span style="color: rgb(255, 0, 0); background-color: yellow; font-weight: 700;">External</span> <mark style="background: lime;">Mark</mark></p>'
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
  expect(expectedResult.html).toContain('font-weight: 700');
  expect(expectedResult.html).not.toContain('color: rgb(255, 0, 0)');
  expect(expectedResult.html).not.toContain('background-color');
  expect(expectedResult.html).not.toContain('background: lime');
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

test('cmd shift v pastes plain text instead of rich html', async ({ page }) => {
  await page.goto('/');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        readText: async () => 'Plain <not bold>',
      },
    });
  });
  await editor.evaluate((node) => {
    node.innerHTML = '<p>Before </p>';
    const paragraph = node.querySelector('p')!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+V' : 'Control+Shift+V');

  const expectedResult = await editor.evaluate((node) => ({
    html: node.innerHTML,
    text: node.textContent,
  }));
  expect(expectedResult.text).toContain('Before Plain <not bold>');
  expect(expectedResult.html).toContain('Plain &lt;not bold&gt;');
  expect(expectedResult.html).not.toContain('<strong>');
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
