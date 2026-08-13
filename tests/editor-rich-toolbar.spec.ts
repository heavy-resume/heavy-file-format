import { expect, test, type Page } from '@playwright/test';

const defaultDocumentText = 'This default HVY document is a lightweight workspace';

/**
 * Waits until a mount stops re-rendering. Switching example modes remounts the document,
 * and focusing or typing into a node that is about to be replaced loses the input.
 */
async function waitForMountIdle(page: Page, selector: string, quietMs = 250): Promise<void> {
  await page.locator(selector).evaluate((root, quiet) => new Promise<void>((resolve) => {
    let timer = window.setTimeout(finish, quiet as number);
    const observer = new MutationObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(finish, quiet as number);
    });
    function finish(): void {
      observer.disconnect();
      resolve();
    }
    observer.observe(root, { subtree: true, childList: true, attributes: true });
  }), quietMs);
}


test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
});

test('toolbar exposes quote and code block actions', async ({ page }) => {
  await page.goto('/');
  await loadRichTextDocument(page, 'Quoted');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const quoteButton = page.locator('[data-rich-action="quote"]').first();
  const codeBlockButton = page.locator('[data-rich-action="code-block"]').first();

  await editor.evaluate((node) => {
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

test('double Enter keeps paragraph break inside one text component', async ({ page }) => {
  await page.goto('/');
  await loadRichTextDocument(page, 'First paragraph');

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
  await editor.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));

  await page.keyboard.type('Alpha paragraph');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Beta paragraph');

  await expect(editor).toBeFocused();
  await expect(editor.locator('p').filter({ hasText: 'Alpha paragraph' })).toHaveCount(1);
  await expect(editor.locator('p').filter({ hasText: 'Beta paragraph' })).toHaveCount(1);

  const expectedResult = await page.evaluate(async () => {
    const [{ state }, { serializeDocument }] = await Promise.all([
      import('/src/state.ts'),
      import('/src/serialization.ts'),
    ]);
    const block = state.document.sections[0]?.blocks[0];
    return {
      blockCount: state.document.sections[0]?.blocks.length ?? 0,
      text: block?.text ?? '',
      serialized: serializeDocument(state.document),
    };
  });

  expect(expectedResult.blockCount).toBe(1);
  expect(expectedResult.text).toBe('Alpha paragraph\n\nBeta paragraph');
  expect(expectedResult.serialized).toContain('Alpha paragraph');
  expect(expectedResult.serialized).toContain('Beta paragraph');
});

test('isolated embed example exposes matching text editors for plugin authors', async ({ page }) => {
  await page.goto('/examples/embed-text-editor-plugin.html');

  await expect(page.getByRole('heading', { name: 'Embedded Plugin Text Editor' })).toBeVisible();
  await expect(page.getByText('Plugin "hvy.editable-text" is not available.')).toHaveCount(0);
  await expect(page.getByText('Full embed')).toBeVisible();
  await expect(page.getByText('Lightweight embed')).toBeVisible();
  await expect(page.locator('[data-example-mode="editor"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.example-rich-note-editor')).toContainText('Write plugin-owned Markdown here. This body is stored with ctx.setText.');
  await expect(page.locator('#embedTextEditorMount .hvy-editable-text')).toContainText('This plugin text editor stays editable in Viewer mode.');
  const lightweightEditor = page.locator('#lightweightTextEditorMount .hvy-editable-text-reader [data-field="hvy-plugin-text-editor"]');
  const lightweightToolbar = page.locator('#lightweightTextEditorMount .hvy-editable-text-reader .rich-toolbar');
  await expect(lightweightEditor).toBeVisible();
  await expect(lightweightEditor).toContainText('This lightweight editable text should show the text editor toolbar.');
  await expect(lightweightToolbar).toBeHidden();
  await lightweightEditor.click();
  await expect(lightweightToolbar).toBeVisible();
  const editorModeViewerNote = page.locator('#embedTextEditorMount .hvy-editable-text .hvy-plugin-text-editor.is-disabled [data-field="hvy-plugin-text-editor"]');
  await expect(editorModeViewerNote).toBeVisible();
  await expect(editorModeViewerNote).toHaveAttribute('contenteditable', 'false');
  await expect(editorModeViewerNote).toHaveAttribute('aria-disabled', 'true');
  await expect(editorModeViewerNote.locator('..').locator('.rich-toolbar')).toBeHidden();
  await expect(page.locator('.example-disabled-text-placeholder')).toContainText('Disabled text editor placeholder');
  await expect(page.locator('.example-disabled-text-placeholder .hvy-plugin-text-editor.is-disabled [data-field="hvy-plugin-text-editor"]')).toBeVisible();
  await expect(page.locator('.example-disabled-text-placeholder .hvy-plugin-text-editor.is-disabled .rich-toolbar')).toBeHidden();

  await page.locator('.editor-block-passive', { hasText: 'This is a normal HVY text component.' }).click();
  const normalEditor = page.locator('[data-field="block-rich"]').first();
  await normalEditor.evaluate((node) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await page.keyboard.type('Normal editor updated');
  await expect(normalEditor).toBeFocused();
  await expect(normalEditor).toContainText('Normal editor updated');

  await page.locator('.editor-block-passive', { hasText: 'Write plugin-owned Markdown here. This body is stored with ctx.setText.' }).click();
  const pluginToolbar = page.locator('.example-rich-note-editor .hvy-plugin-text-editor:not(.is-disabled) .rich-toolbar');
  await expect(pluginToolbar).toBeHidden();
  const pluginEditor = page.locator('.example-rich-note-editor .hvy-plugin-text-editor:not(.is-disabled) [data-field="hvy-plugin-text-editor"]');
  await expect(pluginEditor).toBeVisible();
  await expect(pluginEditor).toHaveAttribute('data-placeholder', 'Write plugin-owned Markdown here. This body is stored with ctx.setText.');
  await pluginEditor.evaluate((node) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(node);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await expect(pluginToolbar).toBeVisible();
  await page.keyboard.type('Plugin editor updated');
  await expect(pluginEditor).toBeFocused();
  await expect(page.locator('.example-rich-note-editor .example-plugin-rendered-preview')).toContainText('Plugin editor updated');

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await expect(pluginEditor).toBeFocused();
  await expect(pluginEditor).toHaveText('');
  await expect(page.locator('.example-rich-note-editor .example-plugin-rendered-preview')).toContainText('Write plugin-owned Markdown here. This body is stored with ctx.setText.');

  const emptyExpectedResult = await page.evaluate(() => {
    const exampleWindow = window as Window & {
      embedTextEditorExample: {
        serialize(): string;
      };
    };
    return {
      serialized: exampleWindow.embedTextEditorExample.serialize(),
    };
  });
  expect(emptyExpectedResult.serialized).not.toContain('Write plugin-owned Markdown here. This body is stored with ctx.setText.');

  await page.keyboard.type('Plugin editor updated');
  await expect(pluginEditor).toBeFocused();
  await expect(page.locator('.example-rich-note-editor .example-plugin-rendered-preview')).toContainText('Plugin editor updated');

  await page.locator('.editor-block-passive', { hasText: 'Disabled text editor placeholder' }).click();
  const disabledPluginEditor = page.locator('.example-disabled-text-placeholder .hvy-plugin-text-editor.is-disabled [data-field="hvy-plugin-text-editor"]');
  await expect(disabledPluginEditor).toBeVisible();
  await expect(disabledPluginEditor).toHaveAttribute('contenteditable', 'false');
  await expect(disabledPluginEditor).toHaveAttribute('aria-disabled', 'true');
  await expect(disabledPluginEditor).toHaveAttribute('data-placeholder', 'This text field is disabled until the document enters another state.');

  await page.locator('[data-example-mode="viewer"]').click();
  await expect(page.locator('[data-example-mode="viewer"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.example-rich-note-editor [data-field="hvy-plugin-text-editor"]')).toHaveCount(0);
  await expect(page.locator('.example-rich-note-editor')).toContainText('Plugin editor updated');
  const editableTextEditor = page.locator('#embedTextEditorMount .hvy-editable-text-reader [data-field="hvy-plugin-text-editor"]');
  const editableTextToolbar = page.locator('#embedTextEditorMount .hvy-editable-text-reader .rich-toolbar');
  await expect(editableTextEditor).toBeVisible();
  await expect(editableTextEditor).toContainText('This plugin text editor stays editable in Viewer mode.');
  await expect(editableTextToolbar).toBeHidden();
  await waitForMountIdle(page, '#embedTextEditorMount');
  await editableTextEditor.evaluate((node) => {
    const paragraph = node.querySelector('p')!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await expect(editableTextToolbar).toBeVisible();
  await page.keyboard.type(' Edited from viewer.');
  await expect(editableTextEditor).toBeFocused();
  await expect(editableTextEditor).toContainText('This plugin text editor stays editable in Viewer mode. Edited from viewer.');
  await expect(page.locator('.example-disabled-text-placeholder .hvy-plugin-text-editor.is-disabled [data-field="hvy-plugin-text-editor"]')).toBeVisible();
  await expect(page.locator('.example-disabled-text-placeholder .hvy-plugin-text-editor.is-disabled [data-field="hvy-plugin-text-editor"]')).toHaveAttribute('data-placeholder', 'This text field is disabled until the document enters another state.');

  await page.locator('[data-example-mode="ai"]').click();
  await expect(page.locator('[data-example-mode="ai"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.example-rich-note-editor')).toContainText('Plugin editor updated');
  await expect(page.locator('.example-disabled-text-placeholder .hvy-plugin-text-editor.is-disabled [data-field="hvy-plugin-text-editor"]')).toBeVisible();

  await page.locator('[data-example-mode="editor"]').click();
  await expect(page.locator('[data-example-mode="editor"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.example-rich-note-editor')).toContainText('Plugin editor updated');
  const returnedEditorModeViewerNote = page.locator('#embedTextEditorMount .hvy-editable-text .hvy-plugin-text-editor.is-disabled [data-field="hvy-plugin-text-editor"]');
  await expect(returnedEditorModeViewerNote).toBeVisible();
  await expect(returnedEditorModeViewerNote).toContainText('This plugin text editor stays editable in Viewer mode. Edited from viewer.');
  await expect(returnedEditorModeViewerNote).toHaveAttribute('contenteditable', 'false');
  await expect(returnedEditorModeViewerNote.locator('..').locator('.rich-toolbar')).toBeHidden();

  const expectedResult = await page.evaluate(() => {
    const exampleWindow = window as Window & {
      embedTextEditorExample: {
        serialize(): string;
      };
    };
    return {
      serialized: exampleWindow.embedTextEditorExample.serialize(),
    };
  });

  expect(expectedResult.serialized).toContain('Normal editor updated');
  expect(expectedResult.serialized).toContain('Plugin editor updated');
  expect(expectedResult.serialized).toContain('Edited from viewer.');
});

test('plugins can mount the shared text editor helper', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Raw' })).toBeVisible();
  await page.evaluate(async () => {
    const { setHostPlugins } = await import('/src/plugins/registry.ts');
    setHostPlugins([{
      id: 'example.text-editor',
      uuid: 'example-plugin-text-editor',
      version: '1.0.0',
      hvyApiVersion: '0.1',
      displayName: 'Text Editor Plugin',
      create: (ctx) => {
        const root = document.createElement('div');
        root.className = 'example-plugin-text-editor';
        const editor = ctx.textEditor.mount({
          value: typeof ctx.block.schema.pluginConfig.note === 'string' ? ctx.block.schema.pluginConfig.note : '',
          placeholder: 'Plugin note',
          onChange: (markdown) => ctx.setConfig({ note: markdown }),
        });
        root.appendChild(editor.element);
        return {
          element: root,
          refresh() {
            editor.setValue(typeof ctx.block.schema.pluginConfig.note === 'string' ? ctx.block.schema.pluginConfig.note : '');
          },
          unmount() {
            editor.unmount();
          },
        };
      },
    }]);
  });

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toBeVisible();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
text_line_styles:
  document-note:
    label: Document note
    css: "font-weight: 700;"
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:plugin {"id":"plugin-note","plugin":"example.text-editor","pluginConfig":{"note":"Alpha"}}-->
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.waitForFunction(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0]?.blocks[0]?.schema.plugin === 'example.text-editor';
  }, null, { timeout: 1000 });
  await page.getByRole('button', { name: 'Basic' }).click();

  await page.locator('[data-action="activate-block"]').first().click();
  const pluginEditor = page.locator('.example-plugin-text-editor [data-field="hvy-plugin-text-editor"]');
  const pluginToolbar = page.locator('.example-plugin-text-editor .rich-toolbar');
  await expect(pluginEditor).toBeVisible();
  await expect(pluginToolbar).toBeVisible();
  await expect(pluginToolbar.locator('.paragraph-style-toolbar')).toHaveCount(0);
  const pluginShell = page.locator('.example-plugin-text-editor .text-editor-shell');
  await page.waitForFunction(() => {
    const shell = document.querySelector<HTMLElement>('.example-plugin-text-editor .text-editor-shell');
    const toolbar = shell?.querySelector<HTMLElement>('.text-editor-toolbar-slot > .rich-toolbar');
    const spacer = shell?.querySelector<HTMLElement>('.text-editor-toolbar-spacer');
    const editor = shell?.querySelector<HTMLElement>('.rich-editor');
    if (!shell || !toolbar || !spacer || !editor) {
      return false;
    }
    const toolbarHeight = toolbar.getBoundingClientRect().height;
    const spacerBox = spacer.getBoundingClientRect();
    const editorBox = editor.getBoundingClientRect();
    return toolbarHeight > 0
      && spacerBox.height === 0
      && Math.abs(editorBox.top - shell.getBoundingClientRect().top) <= 1;
  }, null, { timeout: 1000 });
  const toolbarMetrics = await pluginShell.evaluate((shell) => {
    const toolbar = shell.querySelector<HTMLElement>('.text-editor-toolbar-slot > .rich-toolbar');
    const spacer = shell.querySelector<HTMLElement>('.text-editor-toolbar-spacer');
    const editor = shell.querySelector<HTMLElement>('.rich-editor');
    if (!toolbar || !spacer || !editor) {
      return null;
    }
    const toolbarBox = toolbar.getBoundingClientRect();
    const spacerBox = spacer.getBoundingClientRect();
    const editorBox = editor.getBoundingClientRect();
    return {
      toolbarHeight: toolbarBox.height,
      spacerHeight: spacerBox.height,
      shellTop: shell.getBoundingClientRect().top,
      editorTop: editorBox.top,
    };
  });
  expect(toolbarMetrics).not.toBeNull();
  expect(toolbarMetrics!.toolbarHeight).toBeGreaterThan(0);
  expect(toolbarMetrics!.spacerHeight).toBe(0);
  expect(Math.abs(toolbarMetrics!.editorTop - toolbarMetrics!.shellTop)).toBeLessThanOrEqual(1);
  await pluginEditor.evaluate((node) => {
    node.innerHTML = '<p>Plugin alpha</p><p>Plugin beta</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });

  const expectedResult = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const block = state.document.sections[0]?.blocks[0];
    return block?.schema.pluginConfig.note;
  });
  expect(expectedResult).toBe('Plugin alpha\n\nPlugin beta');
});

test('built-in editable text plugin remains editable from viewer mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Raw' })).toBeVisible();

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toBeVisible();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:plugin {"id":"editable-text","plugin":"hvy.editable-text"}-->
Initial editable text
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.waitForFunction(async () => {
    const { state } = await import('/src/state.ts');
    return state.document.sections[0]?.blocks[0]?.schema.plugin === 'hvy.editable-text';
  }, null, { timeout: 1000 });
  await page.getByRole('button', { name: 'Basic' }).click();
  const editorPluginEditor = page.locator('#editorTree .hvy-editable-text .hvy-plugin-text-editor.is-disabled [data-field="hvy-plugin-text-editor"]');
  const editorPluginToolbar = page.locator('#editorTree .hvy-editable-text .hvy-plugin-text-editor.is-disabled .rich-toolbar');
  await expect(editorPluginEditor).toBeVisible();
  await expect(editorPluginEditor).toContainText('Initial editable text');
  await expect(editorPluginEditor).toHaveAttribute('contenteditable', 'false');
  await expect(editorPluginToolbar).toBeHidden();

  await page.getByRole('button', { name: 'Viewer' }).click();

  const viewerPluginEditor = page.locator('#readerDocument .hvy-editable-text-reader [data-field="hvy-plugin-text-editor"]');
  const viewerPluginShell = page.locator('#readerDocument .hvy-editable-text-reader .hvy-plugin-text-editor');
  const viewerPluginToolbar = viewerPluginShell.locator('.rich-toolbar');
  await expect(viewerPluginEditor).toBeVisible();
  await expect(viewerPluginToolbar).toBeHidden();
  await expect(viewerPluginEditor).toContainText('Initial editable text');

  await viewerPluginEditor.click();
  await expect(viewerPluginToolbar).toBeVisible();
  await expect(viewerPluginToolbar.locator('.paragraph-style-toolbar')).toHaveCount(0);
  await page.locator('#readerDocument').click({ position: { x: 4, y: 4 } });
  await expect(viewerPluginToolbar).toBeHidden();
  await viewerPluginEditor.click();
  await expect(viewerPluginToolbar).toBeVisible();
  await viewerPluginShell.getByRole('button', { name: 'Hide text controls' }).click();
  await expect(viewerPluginToolbar).toBeHidden();
  await viewerPluginEditor.click();
  await expect(viewerPluginToolbar).toBeVisible();

  await viewerPluginEditor.evaluate((node) => {
    const paragraph = node.querySelector('p')!;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await page.keyboard.type(' updated from viewer');

  await expect(viewerPluginEditor).toBeFocused();
  await expect(viewerPluginEditor).toContainText('Initial editable text updated from viewer');

  const expectedResult = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const block = state.document.sections[0]?.blocks[0];
    return {
      view: state.currentView,
      text: block?.text,
    };
  });
  expect(expectedResult).toEqual({
    view: 'viewer',
    text: 'Initial editable text updated from viewer',
  });
});

test('lightweight embed includes editable text controls', async ({ page }) => {
  await page.goto('/examples/embed-text-editor-plugin.html');

  await page.waitForFunction(() => document.documentElement.scrollHeight > window.innerHeight, null, { timeout: 1000 });
  await page.locator('#lightweightTextEditorMount').scrollIntoViewIfNeeded();
  await expect(page.locator('#lightweightTextEditorMount')).toBeInViewport();

  const editor = page.locator('#lightweightTextEditorMount .hvy-editable-text-reader [data-field="hvy-plugin-text-editor"]');
  await expect(editor).toBeVisible();
  await expect(page.locator('#lightweightTextEditorMount .hvy-editable-text-reader .rich-toolbar')).toBeHidden();
  await editor.click();
  await expect(page.locator('#lightweightTextEditorMount .hvy-editable-text-reader .rich-toolbar')).toBeVisible();
  await expect(page.locator('#lightweightTextEditorMount .hvy-editable-text-reader .rich-toolbar [data-rich-action="bold"]')).toBeVisible();
  await expect(page.locator('#lightweightTextEditorMount .hvy-editable-text-reader .rich-toolbar [data-rich-action="list"]')).toBeVisible();
  await expect(editor).toContainText('This lightweight editable text should show the text editor toolbar.');
});

test('lightweight viewer-only text editor applies heading toolbar actions', async ({ page }) => {
  await page.goto('/examples/lightweight-viewer-text-editor.html');

  const editor = page.locator('#lightweightViewerOnlyMount .hvy-editable-text-reader [data-field="hvy-plugin-text-editor"]').first();
  const editorWithInput = page.locator('#lightweightViewerOnlyMount .hvy-editable-text-reader').nth(1);
  const extraInput = editorWithInput.locator('.viewer-note-input-field');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveText('');
  await expect(editorWithInput.locator('[data-field="hvy-plugin-text-editor"]')).toBeVisible();
  await expect(extraInput).toBeVisible();
  await extraInput.fill('Input fixture value');
  await expect(extraInput).toHaveValue('Input fixture value');

  await editor.click();
  await page.locator('#lightweightViewerOnlyMount .hvy-editable-text-reader').first().getByRole('button', { name: 'Hide text controls' }).click();
  await editor.click();
  await page.keyboard.type('Viewer toolbar target');
  await expect(editor).toContainText('Viewer toolbar target');
  await expect(editor).toBeFocused();
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await editor.evaluate((node) => {
    const paragraph = node.querySelector('p') ?? node;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  const firstViewerNote = page.locator('#lightweightViewerOnlyMount .hvy-editable-text-reader').first();
  await firstViewerNote.locator('[data-rich-action="heading-1"]').click();

  await expect(editor.locator('h1')).toContainText('Viewer toolbar target');
  const viewerTextButton = firstViewerNote.locator('[data-rich-action="paragraph"]').first();
  const viewerHeadingButton = firstViewerNote.locator('[data-rich-action="heading-1"]').first();
  await expect(viewerHeadingButton).toHaveClass(/secondary/);
  await editor.evaluate((node) => {
    const heading = node.querySelector('h1');
    const textNode = heading?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode ?? heading ?? node, textNode?.textContent?.length ?? (heading?.childNodes.length ?? node.childNodes.length));
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await page.keyboard.press('Enter');
  for (const char of 'Plain viewer line') {
    await page.keyboard.type(char);
    await expect(viewerTextButton).toHaveClass(/secondary/);
    await expect(viewerHeadingButton).not.toHaveClass(/secondary/);
  }
  await expect(editor).toContainText('Plain viewer line');
  await expect(viewerTextButton).toHaveClass(/secondary/);
  await expect(viewerHeadingButton).not.toHaveClass(/secondary/);
  await page.locator('#lightweightViewerOnlyMount .hvy-editable-text-reader').first().getByRole('button', { name: 'Hide text controls' }).click();

  const secondEditor = editorWithInput.locator('[data-field="hvy-plugin-text-editor"]');
  const secondTextButton = editorWithInput.locator('[data-rich-action="paragraph"]').first();
  const secondHeadingButton = editorWithInput.locator('[data-rich-action="heading-1"]').first();
  await secondEditor.click();
  await editorWithInput.getByRole('button', { name: 'Hide text controls' }).click();
  await secondEditor.click();
  await page.keyboard.type('Input sibling target');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await secondEditor.evaluate((node) => {
    const paragraph = node.querySelector('p') ?? node;
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await secondHeadingButton.click();
  await expect(secondHeadingButton).toHaveClass(/secondary/);
  await secondEditor.evaluate((node) => {
    const heading = node.querySelector('h1');
    const textNode = heading?.firstChild;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(textNode ?? heading ?? node, textNode?.textContent?.length ?? (heading?.childNodes.length ?? node.childNodes.length));
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plain before input');
  await expect(secondTextButton).toHaveClass(/secondary/);
  await expect(secondHeadingButton).not.toHaveClass(/secondary/);
  await extraInput.fill('');
  for (const char of 'abc') {
    await extraInput.type(char);
    await expect(secondTextButton).toHaveClass(/secondary/);
    await expect(secondHeadingButton).not.toHaveClass(/secondary/);
  }

  const expectedResult = await page.evaluate(() => {
    const exampleWindow = window as Window & {
      lightweightViewerTextEditorExample: {
        serialize(): string;
      };
    };
    return exampleWindow.lightweightViewerTextEditorExample.serialize();
  });
  expect(expectedResult).toContain('# Viewer toolbar target');
});

test('italic toolbar action serializes multi-paragraph and list selections', async ({ page }) => {
  await page.goto('/');
  await loadToolbarSelectionDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
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
  await loadToolbarSelectionDocument(page);

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();

  await editor.evaluate((node) => {
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
    quotes: Array.from(node.querySelectorAll('blockquote')).map((element) => (element.textContent ?? '').replace(/\s+/g, ' ').trim()),
    quoteChildren: Array.from(node.querySelector('blockquote')?.children ?? []).map((child) => child.tagName),
  }));
  expect(expectedResult).toEqual({
    topLevelTags: ['BLOCKQUOTE'],
    quotes: ['Alpha Bravo Charlie Delta'],
    quoteChildren: ['P', 'UL', 'P'],
  });

  const quoteBox = await editor.locator('blockquote').boundingBox();
  const bulletBox = await editor.locator('blockquote li').first().boundingBox();
  expect(quoteBox).not.toBeNull();
  expect(bulletBox).not.toBeNull();
  expect(bulletBox!.x).toBeGreaterThan(quoteBox!.x + 12);

  await page.getByRole('button', { name: 'Raw' }).click();
  await expect(page.locator('#rawEditor')).toContainText('> Alpha');
  await expect(page.locator('#rawEditor')).toContainText('> - Bravo');
  await expect(page.locator('#rawEditor')).toContainText('> - Charlie');
  await expect(page.locator('#rawEditor')).toContainText('> Delta');
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.getByRole('button', { name: 'Done' }).first().click();
  const passiveBlock = page.locator('.editor-block-passive').first();
  await expect(passiveBlock.locator('blockquote')).toHaveCount(1);
  await expect(passiveBlock.locator('blockquote')).toContainText('Alpha');
  await expect(passiveBlock.locator('blockquote li')).toHaveText(['Bravo', 'Charlie']);
  await expect(passiveBlock).not.toContainText('> Alpha');
});

test('link toolbar only defaults selected text that looks like a link target', async ({ page }) => {
  await page.goto('/');
  await loadRichTextDocument(page, 'Foo bar foo.com https://example.test/path person@example.com');

  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  const linkButton = page.getByRole('button', { name: 'Link' }).first();
  const linkInput = page.locator('#linkInlineInput');

  await editor.evaluate((node) => {
    const textNode = node.querySelector('p')?.firstChild;
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.setEnd(textNode!, 'Foo bar'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await linkButton.click();
  await expect(linkInput).toHaveValue('');
  await page.locator('#linkInlineModal').getByRole('button', { name: 'Cancel' }).click();

  await editor.evaluate((node) => {
    const textNode = node.querySelector('p')?.firstChild;
    const text = textNode!.textContent!;
    const start = text.indexOf('foo.com');
    const range = document.createRange();
    range.setStart(textNode!, start);
    range.setEnd(textNode!, start + 'foo.com'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await linkButton.click();
  await expect(linkInput).toHaveValue('https://foo.com');
  await page.locator('#linkInlineModal').getByRole('button', { name: 'Cancel' }).click();

  await editor.evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let textNode: Node | null = null;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent?.includes('https://example.test/path')) {
        textNode = walker.currentNode;
        break;
      }
    }
    const text = textNode!.textContent!;
    const start = text.indexOf('https://example.test/path');
    const range = document.createRange();
    range.setStart(textNode!, start);
    range.setEnd(textNode!, start + 'https://example.test/path'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await linkButton.click();
  await expect(linkInput).toHaveValue('https://example.test/path');
  await page.locator('#linkInlineModal').getByRole('button', { name: 'Cancel' }).click();

  await editor.evaluate((node) => {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    let textNode: Node | null = null;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent?.includes('person@example.com')) {
        textNode = walker.currentNode;
        break;
      }
    }
    const text = textNode!.textContent!;
    const start = text.indexOf('person@example.com');
    const range = document.createRange();
    range.setStart(textNode!, start);
    range.setEnd(textNode!, start + 'person@example.com'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await linkButton.click();
  await expect(linkInput).toHaveValue('mailto:person@example.com');
});

async function loadToolbarSelectionDocument(page: Page): Promise<void> {
  await loadRichTextDocument(page, `Alpha

- Bravo
- Charlie

Delta`);
  await expect(page.locator('.editor-block-passive li')).toHaveText(['Bravo', 'Charlie']);
}

async function loadRichTextDocument(page: Page, markdown: string): Promise<void> {
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:text {"id":"quote-target"}-->
${markdown.split('\n').map((line) => `  ${line}`).join('\n')}
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  const expectedText = markdown.split(/\r?\n/).find((line) => line.trim())?.replace(/^[-*+]\s+/, '') ?? '';
  await expect(page.locator('.editor-block-passive', { hasText: expectedText }).first()).toBeVisible();
}

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

  await activeEditorBlock.getByRole('button', { name: 'Hide text controls' }).click();
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

test('floating text toolbar is centered, shrink-wrapped, and keeps alignment beside block styles', async ({ page }) => {
  await page.goto('/');
  await loadRichTextDocument(page, 'Expected result toolbar inset');

  await page.locator('[data-action="activate-block"]').first().click();

  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]').first();
  const metrics = await activeBlock.locator('.text-editor-shell').evaluate((shell) => {
    const toolbar = shell.querySelector<HTMLElement>('.text-editor-toolbar-slot');
    const richToolbar = toolbar?.querySelector<HTMLElement>('.rich-toolbar');
    const blockStyles = toolbar?.querySelector<HTMLElement>('.block-style-buttons');
    const formatButtons = toolbar?.querySelector<HTMLElement>('.format-buttons');
    const headingButton = blockStyles?.querySelector<HTMLElement>('[data-rich-action="heading-1"]');
    const alignButton = blockStyles?.querySelector<HTMLElement>('[data-action="set-block-align"]');
    const alignButtons = blockStyles?.querySelector<HTMLElement>('.align-buttons');
    const dismissButton = richToolbar?.querySelector<HTMLElement>('[data-text-toolbar-dismiss]');
    if (!toolbar || !richToolbar || !blockStyles || !formatButtons || !headingButton || !alignButton || !alignButtons || !dismissButton) {
      return null;
    }
    const shellBox = shell.getBoundingClientRect();
    const toolbarBox = toolbar.getBoundingClientRect();
    const richToolbarBox = richToolbar.getBoundingClientRect();
    const widestButtonRow = Math.max(blockStyles.scrollWidth, formatButtons.scrollWidth);
    const headingBox = headingButton.getBoundingClientRect();
    const alignBox = alignButton.getBoundingClientRect();
    const alignButtonsBox = alignButtons.getBoundingClientRect();
    const dismissBox = dismissButton.getBoundingClientRect();
    return {
      centerDelta: Math.abs((toolbarBox.left + (toolbarBox.width / 2)) - (shellBox.left + (shellBox.width / 2))),
      unusedWidth: richToolbarBox.width - widestButtonRow,
      headingTop: headingBox.top,
      alignTop: alignBox.top,
      headingHeight: headingBox.height,
      alignHeight: alignBox.height,
      alignRightGap: richToolbarBox.right - alignButtonsBox.right,
      dismissOverlap: alignButtonsBox.right - dismissBox.left,
      dismissShapeDelta: Math.abs(dismissBox.width - dismissBox.height),
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.centerDelta).toBeLessThanOrEqual(1);
  expect(metrics!.unusedWidth).toBeLessThanOrEqual(16);
  expect(Math.abs(metrics!.headingTop - metrics!.alignTop)).toBeLessThanOrEqual(1);
  expect(Math.abs(metrics!.headingHeight - metrics!.alignHeight)).toBeLessThanOrEqual(1);
  expect(metrics!.alignRightGap).toBeGreaterThanOrEqual(12);
  expect(metrics!.dismissOverlap).toBeLessThanOrEqual(-4);
  expect(metrics!.dismissShapeDelta).toBeLessThanOrEqual(1);
});

test('short text near the top places its floating toolbar below the component without reserving space', async ({ page }) => {
  await page.goto('/');
  await loadRichTextDocument(page, 'Expected result toolbar below');
  await page.getByRole('button', { name: 'Phone 390' }).click();
  const passiveBlock = page.locator('[data-action="activate-block"]').first();
  await passiveBlock.evaluate((block) => {
    const scroller = block.closest<HTMLElement>('.editor-tree');
    if (scroller) {
      scroller.scrollTop += block.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 2;
    }
  });
  await passiveBlock.click();

  const shell = page.locator('.editor-block[data-active-editor-block="true"] .text-editor-shell').first();
  await expect(shell).toHaveClass(/is-text-toolbar-below/);
  const metrics = await shell.evaluate((shell) => {
    const toolbar = shell.querySelector<HTMLElement>('.text-editor-toolbar-slot > .rich-toolbar');
    const editor = shell.querySelector<HTMLElement>('.rich-editor');
    const spacer = shell.querySelector<HTMLElement>('.text-editor-toolbar-spacer');
    if (!toolbar || !editor || !spacer) {
      return null;
    }
    return {
      toolbarTop: toolbar.getBoundingClientRect().top,
      editorBottom: editor.getBoundingClientRect().bottom,
      spacerHeight: spacer.getBoundingClientRect().height,
      isBelow: shell.classList.contains('is-text-toolbar-below'),
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.isBelow).toBe(true);
  expect(metrics!.toolbarTop).toBeGreaterThanOrEqual(metrics!.editorBottom + 4);
  expect(metrics!.spacerHeight).toBe(0);
});

test('floating text toolbar can be hidden and returns when the text is clicked', async ({ page }) => {
  await page.goto('/');
  await loadRichTextDocument(page, 'Expected result dismissible controls');
  await page.locator('[data-action="activate-block"]').first().click();

  const shell = page.locator('.editor-block[data-active-editor-block="true"] .text-editor-shell').first();
  const editor = shell.locator('.rich-editor');
  const toolbar = shell.locator('.text-editor-toolbar-slot > .rich-toolbar');
  await editor.focus();
  await expect(editor).toBeFocused();
  await shell.getByRole('button', { name: 'Hide text controls' }).click();

  await expect(toolbar).toBeHidden();
  await expect(editor).toBeFocused();
  await editor.click();
  await expect(shell).not.toHaveClass(/is-text-toolbar-hidden/);
  await expect(toolbar).toBeVisible();
});

test('grid text editor uses an unsquashed floating toolbar that stays inside the editor surface', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Raw' }).click();
  await page.locator('#rawEditor').fill(`---
hvy_version: 0.1
---

<!--hvy: {"id":"main"}-->
#! Main

 <!--hvy:grid {"id":"layout","gridColumns":3,"gridStackWidth":"never"}-->
  <!--hvy:grid:0 {"id":"first-cell"}-->
   <!--hvy:text {"id":"first-text"}-->
    First cell

  <!--hvy:grid:1 {"id":"second-cell"}-->
   <!--hvy:text {"id":"second-text"}-->
    Second cell

  <!--hvy:grid:2 {"id":"third-cell"}-->
   <!--hvy:text {"id":"grid-text"}-->
${Array.from({ length: 16 }, (_, index) => `    Expected result line ${index + 1}`).join('\n\n')}
`);
  await page.getByRole('button', { name: 'Apply' }).click();
  await page.getByRole('button', { name: 'Basic' }).click();
  await page.locator('.reader-grid-cell .editor-block-passive', { hasText: 'Expected result line 1' }).click();

  const activeTextBlock = page.locator('.editor-block[data-active-editor-block="true"]', {
    has: page.locator(':scope > .editor-block-content[data-component-id="grid-text"]'),
  });
  const metrics = await activeTextBlock.evaluate((block) => {
    const toolbar = block.querySelector<HTMLElement>('.text-editor-toolbar-slot');
    const gridCell = block.closest<HTMLElement>('.grid-field-row');
    const editorBody = block.closest<HTMLElement>('.editor-tree-body');
    const scroller = block.closest<HTMLElement>('.editor-tree');
    if (!toolbar || !gridCell || !editorBody || !scroller) {
      return null;
    }
    const toolbarBox = toolbar.getBoundingClientRect();
    const gridCellBox = gridCell.getBoundingClientRect();
    const editorBodyBox = editorBody.getBoundingClientRect();
    scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + 180);
    const scrolledToolbarBox = toolbar.getBoundingClientRect();
    const scrollerBox = scroller.getBoundingClientRect();
    return {
      toolbarWidth: toolbarBox.width,
      gridCellWidth: gridCellBox.width,
      toolbarLeft: toolbarBox.left,
      toolbarRight: toolbarBox.right,
      gridCellRight: gridCellBox.right,
      editorBodyLeft: editorBodyBox.left,
      editorBodyRight: editorBodyBox.right,
      scrolledToolbarTop: scrolledToolbarBox.top,
      scrollerTop: scrollerBox.top,
      scrollerBottom: scrollerBox.bottom,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.toolbarWidth).toBeGreaterThan(metrics!.gridCellWidth);
  expect(metrics!.toolbarLeft).toBeGreaterThanOrEqual(metrics!.editorBodyLeft);
  expect(metrics!.toolbarRight).toBeLessThanOrEqual(metrics!.editorBodyRight);
  expect(Math.abs(metrics!.toolbarRight - metrics!.gridCellRight)).toBeLessThanOrEqual(1);
  expect(metrics!.scrolledToolbarTop).toBeGreaterThanOrEqual(metrics!.scrollerTop);
  expect(metrics!.scrolledToolbarTop).toBeLessThan(metrics!.scrollerBottom);

  await page.getByRole('button', { name: 'Done', exact: true }).last().click();
  await page.locator('.reader-grid-cell .editor-block-passive', { hasText: 'First cell' }).click();
  const leftGridMetrics = await page.locator('.editor-block[data-active-editor-block="true"]', {
    has: page.locator(':scope > .editor-block-content[data-component-id="first-text"]'),
  }).evaluate((block) => {
    const toolbar = block.querySelector<HTMLElement>('.text-editor-toolbar-slot');
    const gridCell = block.closest<HTMLElement>('.grid-field-row');
    return toolbar && gridCell
      ? {
          toolbarLeft: toolbar.getBoundingClientRect().left,
          gridCellLeft: gridCell.getBoundingClientRect().left,
        }
      : null;
  });
  expect(leftGridMetrics).not.toBeNull();
  expect(Math.abs(leftGridMetrics!.toolbarLeft - leftGridMetrics!.gridCellLeft)).toBeLessThanOrEqual(1);
});

test('floating text toolbar reserves no space above the editor and keeps bottom clearance while scrolling', async ({ page }) => {
  await page.goto('/');
  await loadRichTextDocument(page, Array.from({ length: 16 }, (_, index) => `Expected result line ${index + 1}`).join('\n\n'));

  await page.locator('[data-action="activate-block"]').first().click();
  const activeBlock = page.locator('.editor-block[data-active-editor-block="true"]').first();

  const metrics = await activeBlock.locator('.text-editor-shell').evaluate((shell) => {
    const toolbarBounds = shell.querySelector<HTMLElement>('.text-editor-toolbar-bounds');
    const toolbarSlot = shell.querySelector<HTMLElement>('.text-editor-toolbar-slot');
    const toolbar = toolbarSlot?.querySelector<HTMLElement>('.rich-toolbar');
    const spacer = shell.querySelector<HTMLElement>('.text-editor-toolbar-spacer');
    const editor = shell.querySelector<HTMLElement>('.rich-editor');
    if (!toolbarBounds || !toolbarSlot || !toolbar || !spacer || !editor) {
      return null;
    }
    const toolbarBoundsBox = toolbarBounds.getBoundingClientRect();
    const toolbarBox = toolbar.getBoundingClientRect();
    const spacerBox = spacer.getBoundingClientRect();
    const shellBox = shell.getBoundingClientRect();
    const editorBox = editor.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
    return {
      boundsGap: editorBox.bottom - toolbarBoundsBox.bottom,
      spacerHeight: spacerBox.height,
      toolbarHeight: toolbarBox.height,
      editorTopGap: editorBox.top - shellBox.top,
      minimumGap: lineHeight * 5,
      toolbarTop: toolbarBox.top,
      editorTop: editorBox.top,
    };
  });

  expect(metrics).not.toBeNull();
  expect(metrics!.boundsGap).toBeGreaterThanOrEqual(metrics!.minimumGap);
  expect(metrics!.spacerHeight).toBe(0);
  expect(Math.abs(metrics!.editorTopGap)).toBeLessThanOrEqual(1);
  expect(metrics!.toolbarTop).toBeLessThan(metrics!.editorTop);

  const scrolledMetrics = await activeBlock.evaluate((block) => {
    const scroller = block.closest<HTMLElement>('.editor-tree');
    const toolbar = block.querySelector<HTMLElement>('.text-editor-toolbar-slot > .rich-toolbar');
    const editor = block.querySelector<HTMLElement>('.rich-editor');
    const lastParagraph = editor?.querySelector<HTMLElement>('p:last-child');
    if (!scroller || !toolbar || !lastParagraph || !editor) {
      return null;
    }
    scroller.scrollTop = Math.min(scroller.scrollHeight, scroller.scrollTop + 180);
    const toolbarBox = toolbar.getBoundingClientRect();
    const stickyToolbarTop = toolbarBox.top;
    const scrollerTop = scroller.getBoundingClientRect().top;
    scroller.scrollTop = scroller.scrollHeight;
    const bottomToolbarBox = toolbar.getBoundingClientRect();
    const lastParagraphBox = lastParagraph.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
    return {
      toolbarBottom: bottomToolbarBox.bottom,
      stickyToolbarTop,
      scrollerTop,
      lastParagraphTop: lastParagraphBox.top,
      minimumGap: lineHeight * 4,
    };
  });

  expect(scrolledMetrics).not.toBeNull();
  expect(scrolledMetrics!.stickyToolbarTop).toBeGreaterThanOrEqual(scrolledMetrics!.scrollerTop);
  expect(scrolledMetrics!.stickyToolbarTop - scrolledMetrics!.scrollerTop).toBeLessThanOrEqual(48);
  expect(scrolledMetrics!.lastParagraphTop - scrolledMetrics!.toolbarBottom).toBeGreaterThanOrEqual(scrolledMetrics!.minimumGap);
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
