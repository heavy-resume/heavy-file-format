import { expect, test } from '@playwright/test';

function readDeleteControlVisualStyle(node: HTMLElement) {
  const style = getComputedStyle(node);
  return {
    backgroundColor: style.backgroundColor,
    borderColor: style.borderColor,
    borderRadius: style.borderRadius,
    boxShadow: style.boxShadow,
    display: style.display,
    height: style.height,
    padding: style.padding,
    width: style.width,
  };
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Advanced' }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();
});

test('before, upload files, expected result: attachments remain visible and can be named', async ({ page }) => {
  const manager = page.locator('[data-document-attachment-manager="true"]');
  await expect(manager).toContainText('No document attachments');
  await expect(manager.locator('.document-attachment-add')).toHaveCSS('display', 'flex');
  await expect(manager.locator('.document-attachment-add')).toHaveCSS('flex-direction', 'row');
  await expect(manager.locator('.document-attachment-add')).toHaveCSS('white-space', 'nowrap');
  expect(await manager.evaluate((node) => node.parentElement?.lastElementChild === node)).toBe(true);
  expect(await manager.evaluate((node) => node.closest('.meta-panel') === null)).toBe(true);
  await expect(manager.locator('xpath=..')).toHaveClass(/document-meta-view/);

  await manager.locator('[data-document-attachment-upload="true"]').setInputFiles([
    { name: 'employee-handbook.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-test') },
    { name: 'office-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Expected notes') },
  ]);

  const handbookName = manager.locator('[data-document-attachment-name="true"]').first();
  await expect(manager.locator('[data-document-attachment-row="true"]')).toHaveCount(2);
  await expect(handbookName).toHaveValue('employee-handbook');
  await expect(manager).toContainText('Not linked');
  await expect(manager.getByRole('button', { name: 'PDF', exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Text', exact: true })).toBeVisible();
  await expect(manager.getByRole('button', { name: 'Images', exact: true })).toHaveCount(0);
  await expect(manager.getByRole('button', { name: 'Audio', exact: true })).toHaveCount(0);
  await expect(manager.getByRole('button', { name: 'Video', exact: true })).toHaveCount(0);
  await expect(manager.getByRole('button', { name: 'Other', exact: true })).toHaveCount(0);

  await handbookName.fill('Employee Handbook');
  await handbookName.press('Tab');
  await expect(handbookName).toHaveValue('Employee Handbook');

  const expectedResult = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const { listUserFileAttachments } = await import('/src/document-attachments.ts');
    return listUserFileAttachments(state.document).map(({ id: _id, meta: _meta, ...attachment }) => attachment);
  });
  expect(expectedResult).toEqual([
    {
      name: 'Employee Handbook',
      filename: 'employee-handbook.pdf',
      mediaType: 'application/pdf',
      length: 9,
    },
    {
      name: 'office-notes',
      filename: 'office-notes.txt',
      mediaType: 'text/plain',
      length: 14,
    },
  ]);

  await manager.getByRole('button', { name: 'PDF', exact: true }).click();
  await expect(manager.locator('[data-document-attachment-row="true"]:visible')).toHaveCount(1);
  await expect(manager.locator('[data-document-attachment-row="true"]:visible')).toContainText('employee-handbook.pdf');
});

test('before, add attachment, expected result: undo and redo restore the attachment', async ({ page }) => {
  const manager = page.locator('[data-document-attachment-manager="true"]');
  await manager.locator('[data-document-attachment-upload="true"]').setInputFiles({
    name: 'undo-guide.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-undo'),
  });
  await expect(manager.locator('[data-document-attachment-row="true"]')).toHaveCount(1);

  await manager.getByText('Attachments', { exact: true }).click();
  await page.keyboard.press('ControlOrMeta+z');
  await expect(manager.locator('[data-document-attachment-row="true"]')).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(manager.locator('[data-document-attachment-row="true"]')).toHaveCount(1);
  await expect(manager.locator('[data-document-attachment-name="true"]')).toHaveValue('undo-guide');
});

test('before, delete attachment, expected result: confirmation precedes removal', async ({ page }) => {
  const manager = page.locator('[data-document-attachment-manager="true"]');
  await manager.locator('[data-document-attachment-upload="true"]').setInputFiles({
    name: 'temporary.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-temporary'),
  });
  await expect(manager.locator('[data-document-attachment-row="true"]')).toHaveCount(1);
  const attachmentDelete = manager.getByRole('button', { name: 'Delete attachment temporary' });
  await expect(attachmentDelete).toHaveClass(/\bhvy-delete-control\b/);
  const attachmentDeleteStyle = await attachmentDelete.evaluate(readDeleteControlVisualStyle);

  await attachmentDelete.click();
  await expect(page.getByRole('heading', { name: 'Confirm deletion?' })).toBeVisible();
  await expect(manager.locator('[data-document-attachment-row="true"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  await expect(manager.locator('[data-document-attachment-row="true"]')).toHaveCount(0);
  await expect(manager).toContainText('No document attachments');

  await page.getByRole('button', { name: 'Basic', exact: true }).click();
  await page.locator('[data-action="activate-block"]').first().click();
  const editorDelete = page.locator('.editor-block-remove-button').first();
  await expect(editorDelete).toHaveClass(/\bhvy-delete-control\b/);
  expect(await editorDelete.evaluate(readDeleteControlVisualStyle)).toEqual(attachmentDeleteStyle);
});

test('expected result: Document Meta attachments remain reachable from basic editing', async ({ page }) => {
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();

  await expect(page.getByRole('button', { name: 'Document Meta' })).toBeVisible();
  await page.getByRole('button', { name: 'Document Meta' }).click();

  await expect(page.locator('[data-document-attachment-manager="true"]')).toBeVisible();
});

test('before, random PDF drop, expected result: confirmation controls whether the attachment is added', async ({ page }) => {
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();

  const dropPdf = () => page.locator('#editorTree').evaluate((target) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['%PDF-random-drop'], 'employee-handbook.pdf', { type: 'application/pdf' }));
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });

  await dropPdf();
  await expect(page.getByRole('heading', { name: 'Add “employee-handbook.pdf” as an attachment?' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Attachment name for employee-handbook.pdf' })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const { listUserFileAttachments } = await import('/src/document-attachments.ts');
    return listUserFileAttachments(state.document).length;
  })).toBe(0);

  await dropPdf();
  await page.getByRole('textbox', { name: 'Attachment name for employee-handbook.pdf' }).fill('Employee Handbook');
  await page.getByRole('button', { name: 'Add attachment', exact: true }).click();

  const manager = page.locator('[data-document-attachment-manager="true"]');
  await expect(manager).toBeVisible();
  await expect(manager.locator('[data-document-attachment-name="true"]')).toHaveValue('Employee Handbook');
  await expect(manager.locator('[data-document-attachment-row="true"]')).toHaveClass(/is-new/);
});

test('before, review multiple dropped files, expected result: invalid names roll back the whole addition', async ({ page }) => {
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();
  await page.locator('#editorTree').evaluate((target) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['first'], 'first.pdf', { type: 'application/pdf' }));
    transfer.items.add(new File(['second'], 'second.txt', { type: 'text/plain' }));
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  });

  const names = page.locator('[data-document-attachment-drop-name]');
  await expect(names).toHaveCount(2);
  await names.nth(0).fill('Duplicate');
  await names.nth(1).fill('Duplicate');
  await page.getByRole('button', { name: 'Add attachments', exact: true }).click();

  await expect.poll(() => page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const { listUserFileAttachments } = await import('/src/document-attachments.ts');
    return listUserFileAttachments(state.document).length;
  })).toBe(0);
});

test('before, create link, expected result: attachment selector links by name without exposing syntax', async ({ page }) => {
  const manager = page.locator('[data-document-attachment-manager="true"]');
  await manager.locator('[data-document-attachment-upload="true"]').setInputFiles([
    { name: 'alpha-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Alpha') },
    { name: 'employee-handbook.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-link-picker') },
    { name: 'latest-brief.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-latest') },
  ]);
  await expect(manager.locator('[data-document-attachment-row="true"]')).toHaveCount(3);
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();
  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  await editor.evaluate((node) => {
    node.innerHTML = '<p>Employee handbook</p><p><a href="https://example.test">Ordinary link</a></p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const text = node.querySelector('p')!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.keyboard.press('Control+K');
  const modal = page.locator('.link-inline-modal.is-open');
  await expect(modal.getByRole('heading', { name: 'Add Link' })).toBeVisible();
  await expect(modal.getByRole('tab', { name: 'This Document' })).toBeVisible();
  await expect(modal.getByRole('tab', { name: 'Workspace' })).toHaveCount(0);
  await modal.getByRole('tab', { name: 'Attachment' }).click();
  await expect(modal.locator('#linkInlineInput')).not.toHaveAttribute('list');
  await expect(modal.locator('.link-target-input-wrap')).toBeHidden();
  await expect(modal.getByText('Choose an attachment')).toBeVisible();
  await expect(modal.locator('[data-link-attachment-upload], [data-link-attachment-dropzone], [data-link-attachment-category]')).toHaveCount(0);
  await expect(modal.locator('.link-attachment-option strong')).toHaveText(['latest-brief', 'employee-handbook', 'alpha-notes']);
  await modal.locator('[data-link-attachment-search="true"]').fill('employee');
  const handbookOption = modal.getByRole('button', { name: /employee-handbook employee-handbook\.pdf/ });
  await expect(handbookOption).toBeVisible();
  await handbookOption.click();
  await expect(modal.locator('#linkInlineInput')).toHaveValue('@attachment:employee-handbook');
  await expect(handbookOption).toHaveClass(/is-selected/);
  await modal.getByRole('button', { name: 'Apply' }).click();

  await expect(editor.locator('a[href="@attachment:employee-handbook"]')).toHaveText('Employee handbook');
  await page.getByRole('button', { name: 'Viewer', exact: true }).click();
  const renderedLink = page.locator('.reader-block-text a[data-hvy-link-kind="attachment"]').first();
  await expect(renderedLink).toHaveText('Employee handbook');
  await expect(renderedLink).toHaveAttribute('data-hvy-attachment-target', '@attachment:employee-handbook');
  await expect(renderedLink).toHaveAttribute('data-hvy-attachment-action', 'preview');
  const expectedLinkStyle = await page.locator('.reader-block-text a[href="https://example.test"]').evaluate((link) => {
    const style = getComputedStyle(link);
    return {
      color: style.color,
      textDecorationColor: style.textDecorationColor,
      textDecorationLine: style.textDecorationLine,
      textDecorationStyle: style.textDecorationStyle,
      textDecorationThickness: style.textDecorationThickness,
      textUnderlineOffset: style.textUnderlineOffset,
    };
  });
  expect(await renderedLink.evaluate((link) => {
    const style = getComputedStyle(link);
    return {
      color: style.color,
      textDecorationColor: style.textDecorationColor,
      textDecorationLine: style.textDecorationLine,
      textDecorationStyle: style.textDecorationStyle,
      textDecorationThickness: style.textDecorationThickness,
      textUnderlineOffset: style.textUnderlineOffset,
    };
  })).toEqual(expectedLinkStyle);

  await page.getByRole('button', { name: 'Editor', exact: true }).click();
  await page.getByRole('button', { name: 'Advanced', exact: true }).click();
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await manager.getByRole('button', { name: 'Delete attachment employee-handbook' }).click();
  await expect(manager.locator('[data-document-attachment-status="true"]')).toContainText('linked 1 time');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(manager.locator('[data-document-attachment-row="true"]')).toHaveCount(3);
});

test('expected result: attachment selector can sort by name', async ({ page }) => {
  const manager = page.locator('[data-document-attachment-manager="true"]');
  await manager.locator('[data-document-attachment-upload="true"]').setInputFiles([
    { name: 'alpha.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Alpha') },
    { name: 'zulu.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Zulu') },
  ]);
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();
  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  await editor.evaluate((node) => {
    const text = node.querySelector('p')?.firstChild;
    if (!text) throw new Error('Expected editable text');
    const range = document.createRange();
    range.selectNodeContents(text);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    (node as HTMLElement).focus();
  });
  await page.keyboard.press('Control+K');
  const modal = page.locator('.link-inline-modal.is-open');
  await modal.getByRole('tab', { name: 'Attachment' }).click();

  await expect(modal.getByRole('tab', { name: 'Attachment' })).toHaveAttribute('aria-selected', 'true');
  await expect(modal.locator('.link-attachment-option strong')).toHaveText(['zulu', 'alpha']);
  await modal.getByRole('combobox', { name: 'Sort attachments' }).selectOption('name');
  await expect(modal.locator('.link-attachment-option strong')).toHaveText(['alpha', 'zulu']);
});

test('before, thousands of document IDs, expected result: search filters data before rendering bounded options', async ({ page }) => {
  const expectedResult = await page.evaluate(async () => {
    const { state } = await import('/src/state.ts');
    const { renderLinkDocumentPicker, refreshLinkDocumentPicker } = await import('/src/editor/components/link-document-picker/link-document-picker.ts');
    const root = document.createElement('div');
    root.innerHTML = renderLinkDocumentPicker();
    const picker = root.firstElementChild as HTMLElement;
    const source = state.document.sections[0];
    const documentWithManyIds = {
      ...state.document,
      sections: Array.from({ length: 2_000 }, (_, index) => ({
        ...source,
        key: `section-${index}`,
        customId: `target-${index}`,
        title: `Target ${index}`,
        blocks: [],
        children: [],
      })),
    };
    refreshLinkDocumentPicker(picker, documentWithManyIds);
    const initialCount = picker.querySelectorAll('[data-link-document-target]').length;
    const initialStatus = picker.querySelector<HTMLElement>('[data-link-document-result-status]')?.textContent;
    const search = picker.querySelector<HTMLInputElement>('[data-link-document-search]')!;
    search.value = 'Target 1999';
    refreshLinkDocumentPicker(picker, documentWithManyIds);
    return {
      initialCount,
      initialStatus,
      filteredTargets: Array.from(picker.querySelectorAll<HTMLElement>('[data-link-document-target]')).map((option) => option.dataset.linkDocumentTarget),
    };
  });

  expect(expectedResult).toEqual({
    initialCount: 50,
    initialStatus: 'Showing 50 of 2000 targets. Type more to narrow the list.',
    filteredTargets: ['#target-1999'],
  });
});

test('before, add a document link, expected result: target names filter and select without exposing IDs in the field', async ({ page }) => {
  await page.getByRole('button', { name: 'Document Meta' }).click();
  await page.getByRole('button', { name: 'Basic', exact: true }).click();
  await page.locator('[data-action="activate-block"]').first().click();
  const editor = page.locator('.rich-editor').first();
  await editor.evaluate((node) => {
    node.innerHTML = '<p>Application details</p>';
    node.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const range = document.createRange();
    range.selectNodeContents(node.querySelector('p')!.firstChild!);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    (node as HTMLElement).focus();
  });

  await page.keyboard.press('Control+K');
  const modal = page.locator('.link-inline-modal.is-open');
  await modal.getByRole('tab', { name: 'This Document' }).click();
  await expect(modal.locator('.link-target-input-wrap')).toBeHidden();
  const search = modal.getByRole('searchbox', { name: 'Target in this document' });
  await search.fill('application pipeline');
  const target = modal.locator('[data-link-document-target="#application-pipeline"]');
  await expect(target).toBeVisible();
  await target.click();
  await expect(modal.locator('#linkInlineInput')).toHaveValue('#application-pipeline');
  await modal.getByRole('button', { name: 'Apply' }).click();

  await expect(editor.locator('a[href="#application-pipeline"]')).toHaveText('Application details');
});

test('before, enable workspace links, expected result: add link offers workspace file paths separately', async ({ page }) => {
  const expectedResult = await page.evaluate(async () => {
    const { state, getRenderApp } = await import('/src/state.ts');
    state.crossDocumentLinksEnabled = true;
    getRenderApp()();
    return {
      enabled: state.crossDocumentLinksEnabled,
      hasWorkspace: document.querySelector('[data-link-target-mode="workspace"]') !== null,
    };
  });
  expect(expectedResult).toEqual({ enabled: true, hasWorkspace: true });
  const modal = page.locator('#linkInlineModal');
  const workspaceTab = modal.locator('[data-link-target-mode="workspace"]');
  await expect(workspaceTab).toHaveCount(1);
  await workspaceTab.evaluate((button: HTMLButtonElement) => button.click());
  await expect(modal.getByText('Workspace file path')).toHaveCount(1);
  await expect(modal.locator('#linkInlineInput')).toHaveAttribute(
    'placeholder',
    './notes.hvy, ../folder/document.hvy, or /workspace/document.hvy',
  );
});
